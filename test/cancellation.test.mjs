import assert from 'node:assert/strict';
import test from 'node:test';
import { liveCase,liveSetup } from './live-case.mjs';

test('admin cancels only a scheduled fixture with a public reason and refunds each bettor once',()=>{
 assert.match(liveCase(`${liveSetup}
 try {
  const fixture=await detail(),bettors=[];
  for(let index=0;index<2;index++){
   const account={displayName:'Estorno '+index,email:'refund'+index+'@example.com',password:'Password123!'};
   assert.equal((await call('/api/auth/signup',account)).status,201);
   const bettor=(await call('/api/auth/login',account)).headers.get('set-cookie');
   const selection=index?'draw':'home',odd=fixture.markets.result.selections.find(item=>item.key===selection).odd;
   const wager={fixtureId:fixture.id,market:'result',selection,stakeCents:100+index,confirmedOdd:odd,operationKey:'refund-bet-'+index};
   assert.equal((await call('/api/bets',wager,bettor)).status,201);bettors.push({bettor,wager});
  }
  assert.equal((await call('/api/fixtures/'+fixture.id+'/cancel',{reason:'Chuva forte'},bettors[0].bettor)).status,403);
  assert.equal((await call('/api/fixtures/'+fixture.id+'/cancel',{reason:'   '},cookie)).status,400);
  const cancelled=await call('/api/fixtures/'+fixture.id+'/cancel',{reason:'Chuva forte'},cookie);
  assert.equal(cancelled.status,201);
  assert.equal((await cancelled.json()).status,'cancelled');
  const publicFixture=await detail();assert.equal(publicFixture.cancellationReason,'Chuva forte');
  assert.equal(publicFixture.markets.result.open,false);
  for(let index=0;index<2;index++){
   const {bettor,wager}=bettors[index];
   const history=await (await call('/api/bets',undefined,bettor)).json();assert.equal(history.length,1);assert.equal(history[0].status,'refunded');
   const wallet=await (await call('/api/wallet',undefined,bettor)).json();assert.equal(wallet.balanceCents,10000);
   const refunds=wallet.entries.filter(entry=>entry.kind==='refund');assert.equal(refunds.length,1);assert.equal(refunds[0].amountCents,wager.stakeCents);assert.equal(refunds[0].betId,history[0].id);
   assert.equal((await call('/api/bets',{...wager,operationKey:'too-late-'+index},bettor)).status,400);
  }
  assert.equal((await call('/api/fixtures/'+fixture.id+'/cancel',{reason:'Outra razão'},cookie)).status,409);
  assert.equal((await call('/api/fixtures/'+fixture.id+'/start',{},cookie)).status,409);
  assert.equal((await fetch(base+'/api/fixtures/'+fixture.id,{method:'PATCH',headers:{'content-type':'application/json',cookie},body:JSON.stringify({scheduledAt:'2099-01-01T12:00:00Z'})})).status,400);
  assert.equal((await detail()).cancellationReason,'Chuva forte');
  assert.equal((await call('/api/fixtures/demo-fixture-2/start',{},cookie)).status,201);
  assert.equal((await call('/api/fixtures/demo-fixture-2/cancel',{reason:'Tarde demais'},cookie)).status,409);
  const inProgress=await (await call('/api/fixtures/demo-fixture-2')).json();
  assert.equal(inProgress.status,'in_progress');assert.equal(inProgress.cancellationReason,null);
  console.log('cancel-refund-ok');
 }finally{await app.close();}
 `),/cancel-refund-ok/);
});
