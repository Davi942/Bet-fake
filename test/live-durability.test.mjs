import assert from 'node:assert/strict';
import test from 'node:test';
import {liveCase} from './live-case.mjs';

async function durableCadence() {
 const assert=require('node:assert/strict');
 const {createServer,connect}=require('node:net');
 const {createApplication}=require('./dist/main');
 const {Database}=require('./dist/database');
 const original={host:process.env.PGHOST,port:Number(process.env.PGPORT)};
 const sockets=new Set();let statementDelay=0;
 // Delay every PostgreSQL ReadyForQuery response after setup. The public feed
 // must remain within its deadline when each fixture cycle writes to the database.
 const proxy=createServer(socket=>{
  const upstream=connect(original);socket.setNoDelay(true);upstream.setNoDelay(true);
  sockets.add(socket);sockets.add(upstream);let buffered=Buffer.alloc(0);
  socket.on('error',()=>{});upstream.on('error',()=>socket.destroy());
  socket.on('data',data=>upstream.write(data));
  upstream.on('data',data=>{
   buffered=Buffer.concat([buffered,data]);
   while(buffered.length>=5){
    const size=1+buffered.readInt32BE(1);if(buffered.length<size)break;
    const frame=buffered.subarray(0,size);buffered=buffered.subarray(size);
    const delay=frame[0]===90?statementDelay:0;
    if(delay)setTimeout(()=>{if(!socket.destroyed)socket.write(frame);},delay);else socket.write(frame);
   }
  });
  socket.on('close',()=>{upstream.destroy();sockets.delete(socket);});upstream.on('close',()=>{socket.destroy();sockets.delete(upstream);});
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 process.env.PGHOST='127.0.0.1';process.env.PGPORT=String(proxy.address().port);
 let app,healthTimer;const peers=[],health=[],gaps=[];
 try {
  app=await createApplication();await app.listen(0,'127.0.0.1');const base=await app.getUrl();let cookie;
  const call=async(path,body,method=body===undefined?'GET':'POST')=>{
   const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
   assert.ok(response.ok,path+' '+response.status);return response.json();
  };
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@betfake.local',password:'AdminDemo123!'})});
  cookie=login.headers.get('set-cookie');
  const client=await app.get(Database).pool.connect(),teams=Array.from({length:6},(_,n)=>'durability-team-'+n),ids=['demo-fixture-1','demo-fixture-2'];
  try {
   await client.query('BEGIN');
   await client.query(`INSERT INTO teams(id,name) SELECT 'durability-team-'||n,'Durability '||n FROM generate_series(0,5) n`);
   await client.query(`INSERT INTO players(id,team_id,name,position,overall) SELECT 'durability-player-'||n||'-'||p,'durability-team-'||n,'Player '||p,CASE WHEN p=1 THEN 'goleiro' ELSE 'atacante' END,70 FROM generate_series(0,5) n CROSS JOIN generate_series(1,11) p`);
   await client.query(`INSERT INTO current_lineups(team_id,player_id) SELECT team_id,id FROM players WHERE team_id LIKE 'durability-team-%'`);
   await client.query('COMMIT');
  }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
  for(let n=0;n<6;n+=2)ids.push((await call('/api/fixtures',{homeTeamId:teams[n],awayTeamId:teams[n+1],scheduledAt:'2099-01-01T12:00:00Z'})).id);
  for(const id of ids)await call('/api/fixtures/'+id+'/start',{});
  let measuring=false;
  for(let p=0;p<20;p++){
   const state={socket:new WebSocket(base.replace('http:','ws:')+'/ws/fixtures'),frames:0,last:0};
   state.socket.onmessage=event=>{
    const now=Date.now(),message=JSON.parse(event.data);if(message.type!=='fixtures')return;
    if(measuring&&state.last)gaps.push(now-state.last);state.last=now;state.frames++;
    for(const fixture of message.fixtures)assert.equal(fixture.events.filter(event=>event.type==='goal').length,fixture.score.home+fixture.score.away);
   };peers.push(state);
  }
  statementDelay=250;const connectionStarted=Date.now();
  const deadline=Date.now()+30000;
  while(peers.some(peer=>!peer.frames)){assert.ok(Date.now()<deadline,'all twenty readers connect');await new Promise(resolve=>setTimeout(resolve,10));}
  const initialSnapshotMs=Date.now()-connectionStarted;
  assert.ok(initialSnapshotMs<=2000,'twenty simultaneous readers receive their initial snapshot in '+initialSnapshotMs+'ms');
  statementDelay=250;measuring=true;for(const peer of peers)peer.last=Date.now();
  let busy=false;
  healthTimer=setInterval(async()=>{
   if(busy)return;busy=true;const started=Date.now();
   try {const response=await fetch(base+'/api/health');health.push({status:response.status,ms:Date.now()-started});}
   catch {health.push({status:0,ms:Date.now()-started});}
   finally {busy=false;}
  },500);
  await new Promise(resolve=>setTimeout(resolve,10000));
  measuring=false;statementDelay=0;clearInterval(healthTimer);healthTimer=undefined;
  const maxGap=Math.max(0,...gaps,...peers.map(peer=>Date.now()-peer.last));
  console.log(JSON.stringify({initialSnapshotMs,maxGapMs:maxGap,healthMaxMs:Math.max(0,...health.map(row=>row.ms)),frames:gaps.length}));
  assert.ok(health.length>5&&health.every(row=>row.status===200),'health remains available');
  assert.ok(gaps.length>=60,'all twenty readers receive repeated snapshots');
  assert.ok(maxGap<=2000,'live update gap '+maxGap+'ms exceeds 2s during PostgreSQL response latency');
  console.log('durable-cadence-ok');
 }finally{
  statementDelay=0;clearInterval(healthTimer);for(const peer of peers)peer.socket.close();
  await app?.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));
 }
}
test('live five-game cadence reaches twenty readers within two seconds despite PostgreSQL response latency',()=>{
 const output=liveCase('await ('+durableCadence.toString()+')()');
 assert.match(output,/durable-cadence-ok/);
 console.log(output.split('\n').find(line=>line.startsWith('{"initialSnapshotMs"')));
});

