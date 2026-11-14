import { randomUUID } from 'node:crypto';
import { compose } from './compose.mjs';
// Only namespace provisioning uses SQL. Every behavior is observed via HTTP/WS.
export function liveCase(script) {
 const database='live_'+randomUUID().replaceAll('-','');
 const psql=(sql)=>compose('exec','-T','db','psql','-U',process.env.POSTGRES_USER??'bet_fake','-d',process.env.POSTGRES_DB??'bet_fake','-v','ON_ERROR_STOP=1','-c',sql);
 psql(`CREATE DATABASE ${database}`);
 try {
  return compose('exec','-T','-e',`PGDATABASE=${database}`,'app','node','-e',`
   const assert=require('node:assert/strict');
   const {createApplication}=require('./dist/main');
   (async()=>{${script}})().catch(error=>{console.error(error);process.exitCode=1;});
  `);
 } finally {psql(`DROP DATABASE ${database} WITH (FORCE)`);}
}
export const liveSetup=`
 let now=0,tick;
 const app=await createApplication({simulation:{now:()=>now,random:()=>0.5,schedule:task=>{tick=task;return ()=>{};}}});
 await app.listen(0,'127.0.0.1');
 const base=await app.getUrl();
 const call=(path,body,cookie)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const cookie=(await call('/api/auth/login',{email:'admin@betfake.local',password:'AdminDemo123!'})).headers.get('set-cookie');
 const detail=async()=>await (await call('/api/fixtures/demo-fixture-1')).json();
 const advance=async milliseconds=>{for(let passed=0;passed<milliseconds;passed+=1000){now+=Math.min(1000,milliseconds-passed);await tick();}};
`;
