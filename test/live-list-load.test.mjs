import assert from 'node:assert/strict';
import test from 'node:test';
import { liveCase } from './live-case.mjs';

test('public fixture snapshots remain responsive to twenty readers with five games', () => {
 const output=liveCase(`
 const {createServer,connect}=require('node:net');
 const original={host:process.env.PGHOST,port:Number(process.env.PGPORT||5432)};
 let responseDelay=0;
 const sockets=new Set();
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
    const delay=frame[0]===90?responseDelay:0;
    if(delay)setTimeout(()=>{if(!socket.destroyed)socket.write(frame);},delay);else socket.write(frame);
   }
  });
  socket.on('close',()=>{upstream.destroy();sockets.delete(socket);});
  upstream.on('close',()=>{socket.destroy();sockets.delete(upstream);});
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 process.env.PGHOST='127.0.0.1';process.env.PGPORT=String(proxy.address().port);
 let app;
 try {
  app=await createApplication({simulation:{schedule:()=>()=>{}}});await app.listen(0,'127.0.0.1');
  const base=await app.getUrl();
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@betfake.local',password:'AdminDemo123!'})});
  const cookie=login.headers.get('set-cookie');assert.ok(cookie);
  const publish=async(home,away)=>{
   const response=await fetch(base+'/api/fixtures',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({homeTeamId:home,awayTeamId:away,scheduledAt:'2099-01-01T12:00:00Z'})});
   const result=await response.json();assert.equal(response.status,201,JSON.stringify(result));return result;
  };
  await publish('demo-team-1','demo-team-2');
  await publish('demo-team-3','demo-team-4');
  await publish('demo-team-1','demo-team-4');
  const expected=await (await fetch(base+'/api/fixtures')).json();assert.equal(expected.length,5);
  // Model modest database response latency while twenty readers request the same public snapshot.
  responseDelay=125;
  const timings=await Promise.all(Array.from({length:20},async()=>{
   const started=Date.now(),response=await fetch(base+'/api/fixtures');
   assert.equal(response.status,200);assert.equal((await response.json()).length,5);
   return Date.now()-started;
  }));
  const maxMs=Math.max(...timings);console.log(JSON.stringify({maxReaderMs:maxMs}));
  assert.ok(maxMs<=2000,'fixture snapshot took '+maxMs+'ms for one of twenty readers');
  console.log('fixture-list-load-ok');
 }finally{
  responseDelay=0;await app?.close();
  for(const socket of sockets)socket.destroy();
  await new Promise(resolve=>proxy.close(resolve));
 }
 `);
 assert.match(output,/fixture-list-load-ok/);
 console.log(output.split('\n').find(line=>line.includes('maxReaderMs')));
});
