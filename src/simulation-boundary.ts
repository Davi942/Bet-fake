import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
export const MATCH_DURATION_MS=300000;
export const MATCH_MINUTES=94;
export type Goal={at:number;side:'home'|'away'};
export type MatchEvent={type:'kickoff'|'goal'|'end';minute:number;teamId?:string};
export interface SimulationOptions {
 now?:()=>number;
 random?:()=>number;
 schedule?:(task:()=>Promise<void>)=>()=>void;
}
@Injectable()
export class SimulationBoundary {
 now=()=>performance.now();
 random=()=> (randomBytes(6).readUIntBE(0,6)+0.5)/281474976710656;
 schedule=(task:()=>Promise<void>)=>{const timer=setInterval(()=>{void task();},500);return ()=>clearInterval(timer);};
 timeline(rates:{home:number;away:number}) {
  const goals:Goal[]=[];
  for(const side of ['home','away'] as const) {
   let at=0;
   for(;;) {
    const uniform=this.random();
    if(!(uniform>0&&uniform<1)) throw new Error('Random source must produce values strictly between zero and one.');
    at+=-Math.log(uniform)*MATCH_DURATION_MS/rates[side];
    if(at>=MATCH_DURATION_MS) break;
    goals.push({at,side});
   }
  }
  return goals.sort((a,b)=>a.at-b.at);
 }
}
