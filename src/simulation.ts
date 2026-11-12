import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Database } from './database';
import { Goal, MatchEvent, MATCH_DURATION_MS, MATCH_MINUTES, SimulationBoundary } from './simulation-boundary';
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
  const ids=(await client.query("SELECT id FROM fixtures WHERE status='in_progress' AND goal_plan IS NOT NULL ORDER BY id")).rows;
  for(const {id} of ids) {
   try {
    await client.query('BEGIN');
    const fixture=(await client.query('SELECT * FROM fixtures WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(fixture.status==='in_progress') {
     const elapsed=Math.min(MATCH_DURATION_MS,fixture.elapsed_ms+(this.seen.has(id)?delta:0));
     const goals=(fixture.goal_plan as Goal[]).filter(goal=>goal.at<=elapsed);
     const events:MatchEvent[]=[{type:'kickoff',minute:0},...goals.map(goal=>({type:'goal' as const,minute:Math.ceil(goal.at/MATCH_DURATION_MS*MATCH_MINUTES),teamId:goal.side==='home'?fixture.home_team_id:fixture.away_team_id}))];
     const status=elapsed===MATCH_DURATION_MS?'finished':'in_progress';
     if(status==='finished')events.push({type:'end',minute:MATCH_MINUTES});
     await client.query('UPDATE fixtures SET elapsed_ms=$2,home_score=$3,away_score=$4,events=$5,status=$6 WHERE id=$1',[id,elapsed,goals.filter(g=>g.side==='home').length,goals.filter(g=>g.side==='away').length,JSON.stringify(events),status]);
    }
    await client.query('COMMIT');this.seen.add(id);
   }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
  }
 }
}
