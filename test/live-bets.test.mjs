import assert from 'node:assert/strict';
import test from 'node:test';
import { liveCase,liveSetup } from './live-case.mjs';

test('bettor accepts current live quote while a stale or impossible quote leaves money unchanged',()=>{
 assert.match(liveCase(`${liveSetup}
 try {
  const account={displayName:'Ao vivo',email:'live-bet@example.com',password:'Password123!'};
  assert.equal((await call('/api/auth/signup',account)).status,201);
  const bettor=(await call('/api/auth/login',account)).headers.get('set-cookie');
  const before=await (await call('/api/wallet',undefined,bettor)).json();
  assert.equal((await call('/api/fixtures/demo-fixture-1/start',{},cookie)).status,201);
  await tick();await advance(200000);
  const fixture=await detail();
  assert.ok(fixture.score.home+fixture.score.away>0);
  assert.equal(fixture.markets.exactScore.selections.find(item=>item.key==='0-0').available,false);
  assert.equal((await call('/api/bets',{fixtureId:fixture.id,market:'exactScore',selection:'0-0',stakeCents:100,confirmedOdd:'1.00',operationKey:'live-impossible'},bettor)).status,400);
  const quote=fixture.markets.result.selections.find(item=>item.available);
  const body={fixtureId:fixture.id,market:'result',selection:quote.key,stakeCents:100,confirmedOdd:'999.99',operationKey:'live-stale'};
  const stale=await call('/api/bets',body,bettor);assert.equal(stale.status,409);
  assert.equal((await stale.json()).code,'ODD_CHANGED');
  assert.equal((await (await call('/api/wallet',undefined,bettor)).json()).balanceCents,before.balanceCents);
  const accepted=await call('/api/bets',{...body,confirmedOdd:quote.odd,operationKey:'live-accepted'},bettor);
  assert.equal(accepted.status,201);assert.equal((await accepted.json()).acceptedOdd,quote.odd);
  assert.equal((await call('/api/bets',{...body,confirmedOdd:quote.odd,operationKey:'live-second'},bettor)).status,201);
  const after=await (await call('/api/wallet',undefined,bettor)).json();assert.equal(after.balanceCents,before.balanceCents-200);
  await advance(100000);
  assert.equal((await call('/api/bets',{...body,confirmedOdd:quote.odd,operationKey:'live-closed'},bettor)).status,400);
  assert.equal((await (await call('/api/wallet',undefined,bettor)).json()).balanceCents,after.balanceCents);
  console.log('live-bet-ok');
 }finally{await app.close();}
 `),/live-bet-ok/);
});
