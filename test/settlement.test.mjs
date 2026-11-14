import assert from 'node:assert/strict';
import test from 'node:test';
import { liveCase,liveSetup } from './live-case.mjs';

test('final 0-0 settles result and exact score once, credits only winners and preserves accepted odds',()=>{
 assert.match(liveCase(`${liveSetup.replace('random:()=>0.5','random:()=>0.1')}
 try {
  const account={displayName:'Liquidação',email:'settlement@example.com',password:'Password123!'};
  assert.equal((await call('/api/auth/signup',account)).status,201);
  const bettor=(await call('/api/auth/login',account)).headers.get('set-cookie');
  const fixture=await detail();
  const choices=[['result','home'],['result','draw'],['result','away'],['exactScore','0-0'],['exactScore','other']];
  const accepted=[];
  for(const [market,selection] of choices){
   const odd=fixture.markets[market].selections.find(item=>item.key===selection).odd;
   const response=await call('/api/bets',{fixtureId:fixture.id,market,selection,stakeCents:100,confirmedOdd:odd,operationKey:market+'-'+selection},bettor);
   assert.equal(response.status,201);accepted.push(await response.json());
  }
  assert.equal((await call('/api/fixtures/'+fixture.id+'/start',{},cookie)).status,201);
  await tick();await advance(300000);
  const final=await detail();assert.equal(final.status,'finished');assert.deepEqual(final.score,{home:0,away:0});
  const history=await (await call('/api/bets',undefined,bettor)).json();
  for(const bet of history)assert.equal(bet.status,['draw','0-0'].includes(bet.selection)?'won':'lost');
  const wallet=await (await call('/api/wallet',undefined,bettor)).json();
  const paid=accepted.filter(b=>['draw','0-0'].includes(b.selection)).reduce((sum,b)=>sum+b.potentialReturnCents,0);
  assert.equal(wallet.balanceCents,10000-500+paid);
  const payouts=wallet.entries.filter(entry=>entry.kind==='payout');assert.equal(payouts.length,2);
  assert.equal(payouts.reduce((sum,entry)=>sum+entry.amountCents,0),paid);
  assert.deepEqual(payouts.map(entry=>entry.betId).sort(),accepted.filter(b=>['draw','0-0'].includes(b.selection)).map(b=>b.id).sort());
  await tick();await tick();
  assert.deepEqual(await (await call('/api/wallet',undefined,bettor)).json(),wallet);
  assert.deepEqual(await (await call('/api/bets',undefined,bettor)).json(),history);
  console.log('settlement-0-0-ok');
 }finally{await app.close();}
 `),/settlement-0-0-ok/);
});

test('a restarted leader settles a persisted final result without paying twice',()=>{
 assert.match(liveCase(`${liveSetup.replace('random:()=>0.5','random:()=>0.1')}
 let successor,closed=false,resumeTick;
 try {
  const account={displayName:'Retomada',email:'restart-settlement@example.com',password:'Password123!'};
  assert.equal((await call('/api/auth/signup',account)).status,201);
  const bettor=(await call('/api/auth/login',account)).headers.get('set-cookie');
  const fixture=await detail(),odd=fixture.markets.result.selections.find(item=>item.key==='draw').odd;
  const wager={fixtureId:fixture.id,market:'result',selection:'draw',stakeCents:100,confirmedOdd:odd,operationKey:'before-final'};
  assert.equal((await call('/api/bets',wager,bettor)).status,201);
  // Fault-injection setup: the final fixture commit survived, but settlement did not start.
  const {Database}=require('./dist/database');
  await app.get(Database).pool.query("UPDATE fixtures SET status='finished',elapsed_ms=300000,home_score=0,away_score=0,events=jsonb_build_array(jsonb_build_object('type','kickoff','minute',0),jsonb_build_object('type','end','minute',94)) WHERE id=$1",[fixture.id]);
  await app.close();closed=true;
  successor=await createApplication({simulation:{now:()=>0,random:()=>0.1,schedule:task=>{resumeTick=task;return ()=>{};}}});
  await successor.listen(0,'127.0.0.1');
  const resumedBase=await successor.getUrl();
  const resumed=path=>fetch(resumedBase+path,{headers:{cookie:bettor}});
  await resumeTick();
  const history=await (await resumed('/api/bets')).json();assert.equal(history[0].status,'won');
  const wallet=await (await resumed('/api/wallet')).json();assert.equal(wallet.entries.filter(entry=>entry.kind==='payout').length,1);
  assert.equal(wallet.balanceCents,10000-100+history[0].potentialReturnCents);
  await resumeTick();assert.deepEqual(await (await resumed('/api/wallet')).json(),wallet);
  console.log('settlement-restart-ok');
 }finally{await successor?.close();if(!closed)await app.close();}
 `),/settlement-restart-ok/);
});

for(const scenario of [
 {name:'home reaches six',random:'random:(()=>{let calls=0;return ()=>++calls<=6?0.9:0.1;})()',score:{home:6,away:0},winners:['home','other']},
 {name:'away wins 0-1',random:'random:(()=>{let calls=0;return ()=>++calls===2?0.5:0.1;})()',score:{home:0,away:1},winners:['away','0-1']},
])test(`final ${scenario.name} resolves match result and exact-score markets`,()=>{
 assert.match(liveCase(`${liveSetup.replace('random:()=>0.5',scenario.random)}
 try {
  const account={displayName:'Resultados',email:'outcomes@example.com',password:'Password123!'};
  assert.equal((await call('/api/auth/signup',account)).status,201);
  const bettor=(await call('/api/auth/login',account)).headers.get('set-cookie');
  const fixture=await detail(),choices=[['result','home'],['result','draw'],['result','away'],['exactScore','0-1'],['exactScore','5-0'],['exactScore','other']];
  const accepted=[];
  for(const [market,selection] of choices){
   const odd=fixture.markets[market].selections.find(item=>item.key===selection).odd;
   const response=await call('/api/bets',{fixtureId:fixture.id,market,selection,stakeCents:100,confirmedOdd:odd,operationKey:market+'-'+selection},bettor);
   assert.equal(response.status,201);accepted.push(await response.json());
  }
  assert.equal((await call('/api/fixtures/'+fixture.id+'/start',{},cookie)).status,201);
  await tick();await advance(300000);
  const final=await detail();assert.deepEqual(final.score,${JSON.stringify(scenario.score)});assert.equal(final.status,'finished');
  assert.equal((await call('/api/fixtures/'+fixture.id+'/start',{},cookie)).status,409);
  assert.equal((await fetch(base+'/api/fixtures/'+fixture.id,{method:'PATCH',headers:{'content-type':'application/json',cookie},body:JSON.stringify({scheduledAt:'2099-01-01T12:00:00Z'})})).status,400);
  const history=await (await call('/api/bets',undefined,bettor)).json();
  for(const bet of history)assert.equal(bet.status,${JSON.stringify(scenario.winners)}.includes(bet.selection)?'won':'lost');
  const wallet=await (await call('/api/wallet',undefined,bettor)).json();
  const paid=accepted.filter(b=>${JSON.stringify(scenario.winners)}.includes(b.selection)).reduce((sum,b)=>sum+b.potentialReturnCents,0);
  assert.equal(wallet.balanceCents,10000-600+paid);
  assert.equal(wallet.entries.filter(entry=>entry.kind==='payout').length,2);
  console.log('settlement-outcome-ok');
 }finally{await app.close();}
 `),/settlement-outcome-ok/);
});
