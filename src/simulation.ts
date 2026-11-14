import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { Database } from './database';
import { MATCH_DURATION_MS, MATCH_MINUTES, SimulationBoundary } from './simulation-boundary';
import { LiveGateway } from './live-gateway';

@Injectable()
export class Simulation implements OnApplicationBootstrap,OnModuleDestroy {
 private leader?:PoolClient;
 private leaderError?:()=>void;
 private previous?:number;
 private seen=new Set<string>();
 private recover=true;
 private busy?:Promise<void>;
 private stop?:()=>void;
 private closing=false;
 constructor(private readonly db:Database,private readonly boundary:SimulationBoundary,private readonly gateway:LiveGateway) {}
 onApplicationBootstrap(){this.stop=this.boundary.schedule(()=>this.run());}
 async onModuleDestroy(){this.closing=true;this.stop?.();await this.busy;await this.release();}
 private async release() {
  const leader=this.leader;this.leader=undefined;this.previous=undefined;this.seen.clear();this.recover=true;
  if(leader){try{await leader.query('SELECT pg_advisory_unlock(942008)');}catch{}finally{if(this.leaderError)leader.removeListener('error',this.leaderError);this.leaderError=undefined;leader.release(true);}}
 }
 private run() {
  if(this.closing)return Promise.resolve();
  if(this.busy)return this.busy;
  this.busy=this.tick().catch(async error=>{
   console.error('Simulação pausada:',error instanceof Error?error.message:error);
   await this.release();
  }).then(()=>this.gateway.publish()).finally(()=>{this.busy=undefined;});
  return this.busy;
 }
 private async tick() {
  if(!this.leader) {
   const client=await this.db.pool.connect();
   // A checked-out connection needs its own error listener during database outages.
   const onError=()=>{if(this.leader===client){this.leader=undefined;this.previous=undefined;this.seen.clear();this.leaderError=undefined;client.removeListener('error',onError);client.release(true);}};
   client.on('error',onError);
   try {
    const lock=await client.query('SELECT pg_try_advisory_lock(942008) AS acquired');
    if(!lock.rows[0].acquired){client.removeListener('error',onError);client.release();return;}
    this.leader=client;this.leaderError=onError;this.previous=this.boundary.now();
   }catch(error){client.removeListener('error',onError);client.release(true);throw error;}
  }
  const client=this.leader;
  const now=this.boundary.now(),delta=Math.max(0,Math.min(1000,Math.floor(now-(this.previous??now))));
  this.previous=now;
  // A single elected leader owns live fixture writes. Compute and persist each
  // complete snapshot in one atomic statement to avoid a read/write round trip.
  const result=await client.query<{id:string;status:string;elapsed_ms:number}>(`WITH scored AS (
   SELECT f.id,f.home_team_id,f.away_team_id,
    LEAST(${MATCH_DURATION_MS},f.elapsed_ms+CASE WHEN f.id=ANY($2::text[]) THEN $1::integer ELSE 0 END) AS elapsed_ms,
    f.goal_plan
   FROM fixtures f WHERE f.status='in_progress' AND f.goal_plan IS NOT NULL
  ), totals AS (
   SELECT s.*,
    (SELECT count(*)::integer FROM jsonb_array_elements(s.goal_plan) AS goal(value) WHERE (goal.value->>'at')::numeric<=s.elapsed_ms AND goal.value->>'side'='home') AS home_score,
    (SELECT count(*)::integer FROM jsonb_array_elements(s.goal_plan) AS goal(value) WHERE (goal.value->>'at')::numeric<=s.elapsed_ms AND goal.value->>'side'='away') AS away_score
   FROM scored s
  ), snapshots AS (
   SELECT t.*,
    jsonb_build_array(jsonb_build_object('type','kickoff','minute',0)) ||
    COALESCE((SELECT jsonb_agg(jsonb_build_object('type','goal','minute',CEIL((goal.value->>'at')::numeric/${MATCH_DURATION_MS}*${MATCH_MINUTES})::integer,'teamId',CASE WHEN goal.value->>'side'='home' THEN t.home_team_id ELSE t.away_team_id END) ORDER BY (goal.value->>'at')::numeric)
     FROM jsonb_array_elements(t.goal_plan) AS goal(value) WHERE (goal.value->>'at')::numeric<=t.elapsed_ms),'[]'::jsonb) AS events
   FROM totals t
  )
  UPDATE fixtures f SET elapsed_ms=s.elapsed_ms,home_score=s.home_score,away_score=s.away_score,events=s.events
  FROM snapshots s WHERE f.id=s.id RETURNING f.id,f.status,f.elapsed_ms`,[delta,[...this.seen]]);
  this.seen=new Set(result.rows.filter(row=>row.status==='in_progress'&&row.elapsed_ms<MATCH_DURATION_MS).map(row=>row.id));
  const finished=new Set(result.rows.filter(row=>row.elapsed_ms>=MATCH_DURATION_MS).map(row=>row.id));
  if(this.recover){
   const pending=await client.query<{id:string}>(`SELECT f.id FROM fixtures f WHERE
    (f.status='in_progress' AND f.elapsed_ms>=${MATCH_DURATION_MS}) OR
    (f.status='finished' AND EXISTS(SELECT 1 FROM bets b WHERE b.fixture_id=f.id AND b.status='pending')) ORDER BY f.id`);
   for(const row of pending.rows)finished.add(row.id);
   this.recover=false;
  }
  for(const id of [...finished].sort())await this.settle(client,id);
 }
 private async settle(client:PoolClient,id:string) {
  await client.query('BEGIN');
  try {
   const fixture=(await client.query<{home_score:number;away_score:number;status:string;elapsed_ms:number}>
    ('SELECT home_score,away_score,status,elapsed_ms FROM fixtures WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!fixture||!(fixture.status==='finished'||(fixture.status==='in_progress'&&fixture.elapsed_ms>=MATCH_DURATION_MS))){await client.query('COMMIT');return;}
   type Pending={id:string;user_id:string;market:string;selection:string;potential_return_cents:string};
   const bets=(await client.query<Pending>(`SELECT id,user_id,market,selection,potential_return_cents FROM bets
    WHERE fixture_id=$1 AND status='pending' ORDER BY user_id,id FOR UPDATE`,[id])).rows;
   const balances=new Map<string,bigint>();
   for(const owner of [...new Set(bets.map(bet=>bet.user_id))].sort()){
    const wallet=(await client.query<{balance_cents:string}>
     ('SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE',[owner])).rows[0];
    if(!wallet)throw new Error('Carteira ausente durante liquidação.');
    balances.set(owner,BigInt(wallet.balance_cents));
   }
   for(const bet of bets){
    const {home_score:home,away_score:away}=fixture;
    const winner=bet.market==='result'
     ?bet.selection===(home>away?'home':home<away?'away':'draw')
     :bet.selection==='other'?(home>5||away>5):bet.selection===`${home}-${away}`;
    await client.query('UPDATE bets SET status=$2 WHERE id=$1',[bet.id,winner?'won':'lost']);
    if(!winner)continue;
    const amount=BigInt(bet.potential_return_cents),balance=balances.get(bet.user_id)!+amount;
    balances.set(bet.user_id,balance);
    await client.query('UPDATE wallets SET balance_cents=$2 WHERE user_id=$1',[bet.user_id,balance.toString()]);
    await client.query(`INSERT INTO wallet_entries(id,user_id,kind,amount_cents,balance_after_cents,operation_key,bet_id,fixture_id,created_at)
     VALUES($1,$2,'payout',$3,$4,$5,$6,$7,clock_timestamp())`,
     [randomUUID(),bet.user_id,amount.toString(),balance.toString(),`payout:${bet.id}`,bet.id,id]);
   }
   if(fixture.status==='in_progress')await client.query(`UPDATE fixtures SET status='finished',events=events || jsonb_build_array(jsonb_build_object('type','end','minute',${MATCH_MINUTES})) WHERE id=$1`,[id]);
   await client.query('COMMIT');
  }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
 }
}
