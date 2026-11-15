import assert from 'node:assert/strict';
import test from 'node:test';
import { liveCase, liveSetup } from './live-case.mjs';

test('admin dashboard counts accepted, refunded, pending and settled stakes without wallet funding', () => {
 assert.match(liveCase(`${liveSetup.replace('random:()=>0.5','random:()=>0.1')}
 try {
  const bettorAccount={displayName:'Painel',email:'finance@example.com',password:'Password123!'};
  assert.equal((await call('/api/auth/signup',bettorAccount)).status,201);
  const bettor=(await call('/api/auth/login',bettorAccount)).headers.get('set-cookie');
  const read=async()=>await (await call('/api/admin/finance',undefined,cookie)).json();
  assert.equal((await call('/api/admin/finance')).status,401);
  assert.equal((await call('/api/admin/finance',undefined,bettor)).status,403);
  assert.equal((await call('/api/wallet',undefined,cookie)).status,403);
  assert.equal((await call('/api/bets',undefined,cookie)).status,403);
  let dashboard=await read();
  assert.deepEqual(dashboard,{totalStakedCents:0,paidReturnsCents:0,refundsCents:0,pendingCents:0,houseResultCents:0,fixtures:{scheduled:2,inProgress:0,finished:0,cancelled:0}});
  assert.equal((await call('/api/wallet/operations',{kind:'deposit',amountCents:50000,operationKey:'fund'},bettor)).status,201);
  const first=await detail();
  const second=await (await call('/api/fixtures/demo-fixture-2')).json();
  const place=async(fixture,selection,stake,operationKey)=>{
   const odd=fixture.markets.result.selections.find(item=>item.key===selection).odd;
   const response=await call('/api/bets',{fixtureId:fixture.id,market:'result',selection,stakeCents:stake,confirmedOdd:odd,operationKey},bettor);
   assert.equal(response.status,201);return response.json();
  };
  const winner=await place(first,'draw',100,'winning');
  await place(first,'home',150,'losing');
  await place(second,'home',200,'refund');
  dashboard=await read();
  assert.equal(dashboard.totalStakedCents,450);assert.equal(dashboard.pendingCents,450);
  assert.equal(dashboard.houseResultCents,0);
  assert.equal((await call('/api/fixtures/'+second.id+'/cancel',{reason:'Chuva'},cookie)).status,201);
  assert.equal((await call('/api/fixtures/'+first.id+'/start',{},cookie)).status,201);
  await tick();await advance(300000);
  dashboard=await read();
  assert.equal(dashboard.totalStakedCents,450);
  assert.equal(dashboard.paidReturnsCents,winner.potentialReturnCents);
  assert.equal(dashboard.refundsCents,200);assert.equal(dashboard.pendingCents,0);
  assert.equal(dashboard.houseResultCents,250-winner.potentialReturnCents);
  assert.deepEqual(dashboard.fixtures,{scheduled:0,inProgress:0,finished:1,cancelled:1});
  console.log('admin-finance-ok');
 }finally{await app.close();}
 `),/admin-finance-ok/);
});
