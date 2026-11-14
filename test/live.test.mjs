import assert from 'node:assert/strict';
import test from 'node:test';
import { liveCase,liveSetup } from './live-case.mjs';
test('live manual start is admin only and cannot reroll or overlap a club',()=>{
 assert.match(liveCase(`${liveSetup}
 try {
 const admin=cookie;
 const fixture=await (await call('/api/fixtures',{homeTeamId:'demo-team-3',awayTeamId:'demo-team-4',scheduledAt:'2099-01-01T12:00:00Z'},admin)).json();
 assert.equal((await call('/api/fixtures/'+fixture.id+'/start',{})).status,401);
 await tick();await advance(5000);assert.equal((await (await call('/api/fixtures/'+fixture.id)).json()).status,'scheduled');
 const response=await call('/api/fixtures/'+fixture.id+'/start',{},admin);assert.equal(response.status,201);
 const started=await response.json();assert.equal(started.status,'in_progress');assert.equal(started.elapsedMs,0);assert.deepEqual(started.score,{home:0,away:0});assert.equal(started.events[0].type,'kickoff');
 assert.equal((await call('/api/fixtures/'+fixture.id+'/start',{},admin)).status,409);
 assert.equal((await call('/api/fixtures/demo-fixture-2/start',{},admin)).status,409);
 assert.deepEqual(started.events,[{type:'kickoff',minute:0}]);
 for(const key of ['goal_plan','goalPlan','timeline','random','rng'])assert.equal(key in started,false);
 console.log('manual-start-ok');
 }finally{await app.close();}
 `),/manual-start-ok/);
});
test('live production entry point resumes exact persisted score and clock after a stopped process',()=>{
 assert.match(liveCase(`${liveSetup}
 const {spawn}=require('node:child_process');
 const {once}=require('node:events');
 let processApp,observer,closed=false;
 const server=require('node:net').createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const productionBase='http://127.0.0.1:'+port;
 const productionDetail=async()=>await (await fetch(productionBase+'/api/fixtures/demo-fixture-1')).json();
 let logs='';
 const launch=async()=>{
  processApp=spawn(process.execPath,['dist/main.js'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  processApp.stdout.on('data',chunk=>logs+=chunk);processApp.stderr.on('data',chunk=>logs+=chunk);
  const deadline=Date.now()+25000;
  for(;;){assert.equal(processApp.exitCode,null,logs);try{if((await fetch(productionBase+'/api/health')).ok)break;}catch{}assert.ok(Date.now()<deadline,logs);await new Promise(r=>setTimeout(r,20));}
 };
 const stop=async()=>{const child=processApp;processApp=undefined;const ended=once(child,'exit');child.kill('SIGTERM');await ended;};
 try {
  await call('/api/fixtures/demo-fixture-1/start',{},cookie);await tick();await advance(200000);
  const before=await detail();await app.close();closed=true;
  await launch();assert.deepEqual(await productionDetail(),before);
  await new Promise(r=>setTimeout(r,1600));assert.ok((await productionDetail()).elapsedMs>200000);
  await stop();
  observer=await createApplication({simulation:{schedule:()=>()=>{}}});await observer.listen(0,'127.0.0.1');
  const saved=await (await fetch((await observer.getUrl())+'/api/fixtures/demo-fixture-1')).json();await observer.close();observer=undefined;
  await new Promise(r=>setTimeout(r,2000));
  await launch();const resumed=await productionDetail();assert.deepEqual(resumed,saved);
  await new Promise(r=>setTimeout(r,1100));const later=await productionDetail();assert.ok(later.elapsedMs>saved.elapsedMs);assert.ok(later.elapsedMs-saved.elapsedMs<=1500);assert.deepEqual(later.score,saved.score);
  console.log('production-resume-ok');
 }finally{if(processApp)await stop();await observer?.close();if(!closed)await app.close();}
 `),/production-resume-ok/);
});
test('live concurrent starts enforce five games and club exclusion, role, origin and no result controls',()=>{
 assert.match(liveCase(`${liveSetup}
 try {
  const publish=async(home,away)=>await (await call('/api/fixtures',{homeTeamId:home,awayTeamId:away,scheduledAt:'2020-01-01T12:00:00Z'},cookie)).json();
  const bettor=(await call('/api/auth/login',{email:'apostador@betfake.local',password:'ApostadorDemo123!'})).headers.get('set-cookie');
  assert.equal((await call('/api/fixtures/demo-fixture-1/start',{},bettor)).status,403);
  for(const body of [{winner:'home'},{odd:'1.01'},{goals:3},null,[]])assert.equal((await call('/api/fixtures/demo-fixture-1/start',body,cookie)).status,400);
  assert.equal((await fetch(base+'/api/fixtures/demo-fixture-1/start',{method:'POST',headers:{cookie,'content-type':'application/json',origin:'https://evil.example'},body:'{}'})).status,403);
  const overlap=await publish('demo-team-1','demo-team-3');
  const simultaneous=await Promise.all(['demo-fixture-1',overlap.id].map(id=>call('/api/fixtures/'+id+'/start',{},cookie)));
  assert.deepEqual(simultaneous.map(r=>r.status).sort(),[201,409]);
  const ids=[];
  for(let n=0;n<10;n++){
   const team=await (await call('/api/teams',{name:'Capacity '+n},cookie)).json(),players=[];
   for(let p=0;p<11;p++)players.push((await (await call('/api/teams/'+team.id+'/players',{name:'Player '+p,position:p?'atacante':'goleiro',overall:80},cookie)).json()).id);
   assert.equal((await fetch(base+'/api/teams/'+team.id+'/lineup',{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({playerIds:players})})).status,200);ids.push(team.id);
  }
  const games=[];for(let n=0;n<10;n+=2)games.push(await publish(ids[n],ids[n+1]));
  const responses=await Promise.all(games.map(f=>call('/api/fixtures/'+f.id+'/start',{},cookie)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,201,201,201,409]);
  const all=await (await call('/api/fixtures')).json();assert.equal(all.filter(f=>f.status==='in_progress').length,5);
  assert.equal((await call('/api/fixtures/missing/start',{},cookie)).status,404);
  console.log('capacity-ok');
 }finally{await app.close();}
 `),/capacity-ok/);
});
test('live persisted clock and goals resume without offline catch-up or reroll and factories cannot double tick',()=>{
 assert.match(liveCase(`${liveSetup}
 let successor,closed=false;
 try {
  await call('/api/fixtures/demo-fixture-1/start',{},cookie);await tick();await advance(200000);
  let secondTick;
  successor=await createApplication({simulation:{now:()=>now,random:()=>{throw Error('must not reroll');},schedule:task=>{secondTick=task;return ()=>{};}}});
  await successor.listen(0,'127.0.0.1');
  now+=1000;await tick();await secondTick();assert.equal((await detail()).elapsedMs,201000);
  await app.close();closed=true;now+=86400000;
  const read=async()=>await (await fetch((await successor.getUrl())+'/api/fixtures/demo-fixture-1')).json();
  const saved=await read();await secondTick();assert.deepEqual(await read(),saved);
  now+=1000;await secondTick();assert.equal((await read()).elapsedMs,202000);assert.deepEqual((await read()).score,{home:1,away:1});
  for(let i=0;i<98;i++){now+=1000;await secondTick();}
  const final=await read();assert.equal(final.status,'finished');assert.deepEqual(final.score,{home:1,away:1});
  console.log('resume-ok');
 }finally{await successor?.close();if(!closed)await app.close();}
 `),/resume-ok/);
});
test('live guaranteed other score stays open at 1.00 and accepted pregame bets keep their quote',()=>{
 assert.match(liveCase(`${liveSetup.replace('random:()=>0.5','random:()=>0.9')}
 try {
  const bettor=(await call('/api/auth/login',{email:'apostador@betfake.local',password:'ApostadorDemo123!'})).headers.get('set-cookie');
  const body={fixtureId:'demo-fixture-1',market:'result',selection:'home',stakeCents:100,confirmedOdd:'2.61',operationKey:require('node:crypto').randomUUID()};
  const accepted=await (await call('/api/bets',body,bettor)).json();
  await call('/api/fixtures/demo-fixture-1/start',{},cookie);await tick();await advance(150000);
  const fixture=await detail();assert.deepEqual(fixture.score,{home:6,away:6});
  const other=fixture.markets.exactScore.selections.find(s=>s.key==='other');
  assert.equal(fixture.markets.exactScore.open,true);assert.equal(other.available,true);assert.equal(other.probability,1);assert.equal(other.odd,'1.00');
  assert.ok(fixture.markets.exactScore.selections.filter(s=>s.key!=='other').every(s=>!s.available&&s.probability===0&&s.odd===null));
  const wallet=await (await call('/api/wallet',undefined,bettor)).json();
  assert.equal((await call('/api/bets',{...body,operationKey:require('node:crypto').randomUUID()},bettor)).status,409);
  assert.deepEqual(await (await call('/api/wallet',undefined,bettor)).json(),wallet);
  const live=await call('/api/bets',{...body,market:'exactScore',selection:'other',confirmedOdd:'1.00',operationKey:require('node:crypto').randomUUID()},bettor);
  assert.equal(live.status,201);assert.equal((await live.json()).acceptedOdd,'1.00');
  assert.deepEqual(await (await call('/api/bets',body,bettor)).json(),accepted);
  console.log('guaranteed-other-ok');
 }finally{await app.close();}
 `),/guaranteed-other-ok/);
});
test('live public WebSocket sends coherent snapshots, ignores commands and resynchronizes a reconnect',()=>{
 assert.match(liveCase(`${liveSetup}
 let socket;
 const connect=async()=>{
  socket=new WebSocket(base.replace('http:','ws:')+'/ws/fixtures');
  const messages=[];socket.addEventListener('message',event=>messages.push(JSON.parse(event.data)));
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  return messages;
 };
 const until=async(predicate)=>{const deadline=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<deadline,'snapshot within two seconds');await new Promise(r=>setTimeout(r,10));}};
 try {
  const messages=await connect();await until(()=>messages.length>0);
  assert.equal(messages[0].type,'fixtures');assert.equal(messages[0].fixtures.find(f=>f.id==='demo-fixture-1').status,'scheduled');
  socket.send(JSON.stringify({event:'start',data:{fixtureId:'demo-fixture-1'}}));
  await tick();assert.equal((await detail()).status,'scheduled');
  await call('/api/fixtures/demo-fixture-1/start',{},cookie);await tick();await advance(1000);
  await until(()=>messages.some(m=>m.fixtures?.some(f=>f.id==='demo-fixture-1'&&f.elapsedMs===1000)));
  const snapshot=messages.at(-1).fixtures.find(f=>f.id==='demo-fixture-1');
  assert.deepEqual(snapshot,await detail());for(const key of ['goal_plan','goalPlan','timeline','random','rng'])assert.equal(key in snapshot,false);
  socket.close();const fresh=await connect();await until(()=>fresh.length>0);assert.deepEqual(fresh[0].fixtures.find(f=>f.id==='demo-fixture-1'),snapshot);
  console.log('websocket-ok');
 }finally{socket?.close();await app.close();}
 `),/websocket-ok/);
});
test('live odds condition on current goals and remaining time with possible-only floor and large decimal quotes',()=>{
 assert.match(liveCase(`${liveSetup}
 try {
  await call('/api/fixtures/demo-fixture-1/start',{},cookie);await tick();await advance(200000);
  const playing=await detail(),scores=playing.markets.exactScore.selections;
  const impossible=scores.find(s=>s.key==='0-0');assert.equal(impossible.probability,0);assert.equal(impossible.available,false);assert.equal(impossible.odd,null);
  assert.equal(scores.find(s=>s.key==='1-1').odd,'2.34');
  await advance(99999);
  const late=await detail(),lateScores=late.markets.exactScore.selections;
  assert.equal(lateScores.find(s=>s.key==='1-1').odd,'1.00');
  const rare=lateScores.find(s=>s.key==='5-5');assert.equal(rare.available,true);assert.match(rare.odd,/^\\d{40,}\\.\\d{2}$/);
  const other=lateScores.find(s=>s.key==='other');assert.ok(other.probability>0);assert.equal(other.available,true);assert.match(other.odd,/^\\d+\\.\\d{2}$/);
  console.log('live-odds-ok');
 }finally{await app.close();}
 `),/live-odds-ok/);
});
test('live simulation follows fixed strengths, emits goal minutes and finishes regulation plus stoppage in five minutes',()=>{
 assert.match(liveCase(`${liveSetup}
 try {
  assert.equal((await call('/api/fixtures/demo-fixture-1/start',{},cookie)).status,201);
  assert.equal(typeof tick,'function');
  await tick();await advance(200000);
  const playing=await detail();assert.equal(playing.elapsedMs,200000);assert.equal(playing.status,'in_progress');
  assert.deepEqual(playing.score,{home:1,away:1});
  assert.deepEqual(playing.events.map(e=>e.type),['kickoff','goal','goal']);
  assert.deepEqual(playing.events.slice(1).map(e=>e.teamId),['demo-team-2','demo-team-1']);
  assert.ok(playing.events.slice(1).every(e=>Number.isInteger(e.minute)&&e.minute>0&&e.minute<94));
  await advance(100000);
  const final=await detail();assert.equal(final.status,'finished');assert.equal(final.elapsedMs,300000);assert.equal(final.minute,94);
  assert.deepEqual(final.score,{home:1,away:1});assert.equal(final.events.at(-1).type,'end');assert.equal(final.events.at(-1).minute,94);
  assert.equal(final.markets.result.open,false);assert.equal(final.markets.exactScore.open,false);
  assert.equal((await call('/api/fixtures/demo-fixture-1/start',{},cookie)).status,409);
  await advance(5000);assert.deepEqual(await detail(),final);
  console.log('simulation-ok');
 }finally{await app.close();}
 `),/simulation-ok/);
});
