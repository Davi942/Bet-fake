import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
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
 private busy?:Promise<void>;
 private stop?:()=>void;
 private closing=false;
 constructor(private readonly db:Database,private readonly boundary:SimulationBoundary,private readonly gateway:LiveGateway) {}
 onApplicationBootstrap(){this.stop=this.boundary.schedule(()=>this.run());}
 async onModuleDestroy(){this.closing=true;this.stop?.();await this.busy;await this.release();}
 private async release() {
  const leader=this.leader;this.leader=undefined;this.previous=undefined;this.seen.clear();
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
  const result=await client.query<{id:string;status:string}>(`WITH scored AS (
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
   SELECT t.*,CASE WHEN t.elapsed_ms=${MATCH_DURATION_MS} THEN 'finished' ELSE 'in_progress' END AS status,
    jsonb_build_array(jsonb_build_object('type','kickoff','minute',0)) ||
    COALESCE((SELECT jsonb_agg(jsonb_build_object('type','goal','minute',CEIL((goal.value->>'at')::numeric/${MATCH_DURATION_MS}*${MATCH_MINUTES})::integer,'teamId',CASE WHEN goal.value->>'side'='home' THEN t.home_team_id ELSE t.away_team_id END) ORDER BY (goal.value->>'at')::numeric)
     FROM jsonb_array_elements(t.goal_plan) AS goal(value) WHERE (goal.value->>'at')::numeric<=t.elapsed_ms),'[]'::jsonb) ||
    CASE WHEN t.elapsed_ms=${MATCH_DURATION_MS} THEN jsonb_build_array(jsonb_build_object('type','end','minute',${MATCH_MINUTES})) ELSE '[]'::jsonb END AS events
   FROM totals t
  )
  UPDATE fixtures f SET elapsed_ms=s.elapsed_ms,home_score=s.home_score,away_score=s.away_score,events=s.events,status=s.status
  FROM snapshots s WHERE f.id=s.id RETURNING f.id,f.status`,[delta,[...this.seen]]);
  this.seen=new Set(result.rows.filter(row=>row.status==='in_progress').map(row=>row.id));
 }
}
