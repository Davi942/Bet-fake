import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { compose } from './compose.mjs';
const base=process.env.TEST_BASE_URL ?? 'http://localhost:3000';
async function call(path,body,cookie) {
 return fetch(base+path,{method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json',connection:'close',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
async function bettor() {
 const user={displayName:'Apostas',email:`${randomUUID()}@example.com`,password:'Password123!'};
 assert.equal((await call('/api/auth/signup',user)).status,201);
 return (await call('/api/auth/login',user)).headers.get('set-cookie');
}
const wager=()=>({fixtureId:'demo-fixture-1',market:'result',selection:'home',stakeCents:150,confirmedOdd:'2.61',operationKey:randomUUID()});
test('accepted simple bet fixes the quote, rounds total return half up and links one debit to own history',async()=>{
 const cookie=await bettor(),body=wager();
 const response=await call('/api/bets',body,cookie);
 assert.equal(response.status,201);
 const bet=await response.json();
 assert.equal(bet.fixtureId,'demo-fixture-1');assert.equal(bet.market,'result');assert.equal(bet.selection,'home');
 assert.equal(bet.stakeCents,150);assert.equal(bet.acceptedOdd,'2.61');assert.equal(bet.potentialReturnCents,392);assert.equal(bet.status,'pending');
 assert.equal(bet.homeTeamName,'Aurora FC');assert.equal(bet.awayTeamName,'Estrela do Sul');assert.match(bet.selectionLabel,/mandante/);assert.ok(Number.isFinite(Date.parse(bet.createdAt)));
 assert.deepEqual(await (await call('/api/bets',undefined,cookie)).json(),[bet]);
 const wallet=await (await call('/api/wallet',undefined,cookie)).json();assert.equal(wallet.balanceCents,9850);
 assert.equal(wallet.entries.length,2);assert.equal(wallet.entries[0].kind,'bet');assert.equal(wallet.entries[0].amountCents,-150);
 assert.equal(wallet.entries[0].betId,bet.id);assert.equal(wallet.entries[0].fixtureId,bet.fixtureId);
});
test('concurrent duplicate clicks and a later retry accept one bet and debit once; changed payload conflicts',async()=>{
 const cookie=await bettor(),body=wager();
 const responses=await Promise.all(Array.from({length:8},()=>call('/api/bets',body,cookie)));
 assert.deepEqual(responses.map(r=>r.status),Array(8).fill(201));
 const bets=await Promise.all(responses.map(r=>r.json()));for(const bet of bets)assert.deepEqual(bet,bets[0]);
 assert.equal((await call('/api/wallet/operations',{kind:'withdrawal',amountCents:9850,operationKey:randomUUID()},cookie)).status,201);
 assert.deepEqual(await (await call('/api/bets',body,cookie)).json(),bets[0]);
 for(const change of [{stakeCents:151},{selection:'draw'},{confirmedOdd:'2.60'},{fixtureId:'demo-fixture-2'},{market:'exactScore'}])
  assert.equal((await call('/api/bets',{...body,...change},cookie)).status,409);
 const history=await (await call('/api/bets',undefined,cookie)).json();assert.equal(history.length,1);
 const wallet=await (await call('/api/wallet',undefined,cookie)).json();assert.equal(wallet.balanceCents,0);assert.equal(wallet.entries.filter(e=>e.kind==='bet').length,1);
 // Operation keys are shared by financial operations for one owner.
 assert.equal((await call('/api/wallet/operations',{kind:'deposit',amountCents:150,operationKey:body.operationKey},cookie)).status,409);
 const key=randomUUID();assert.equal((await call('/api/wallet/operations',{kind:'deposit',amountCents:150,operationKey:key},cookie)).status,201);
 assert.equal((await call('/api/bets',{...wager(),operationKey:key},cookie)).status,409);
});
test('stale quote is refused without debit and the actual quote needs a new confirmation',async()=>{
 const cookie=await bettor(),body={...wager(),confirmedOdd:'2.60'};
 const before=await (await call('/api/wallet',undefined,cookie)).json();
 const response=await call('/api/bets',body,cookie);assert.equal(response.status,409);
 const error=await response.json();assert.equal(error.code,'ODD_CHANGED');assert.equal(error.currentOdd,'2.61');
 assert.deepEqual(await (await call('/api/wallet',undefined,cookie)).json(),before);
 assert.deepEqual(await (await call('/api/bets',undefined,cookie)).json(),[]);
 assert.equal((await call('/api/bets',{...body,confirmedOdd:error.currentOdd},cookie)).status,201);
 assert.equal((await (await call('/api/wallet',undefined,cookie)).json()).balanceCents,9850);
});
test('invalid stakes, multiple or impossible selections and malformed requests leave history and money unchanged',async()=>{
 const cookie=await bettor(),before=await (await call('/api/wallet',undefined,cookie)).json();
 for(const stakeCents of [0,99,10001,-100,100.5,'100',null,Number.MAX_SAFE_INTEGER+1])
  assert.equal((await call('/api/bets',{...wager(),stakeCents},cookie)).status,400,`stake ${stakeCents}`);
 for(const change of [{market:'unknown'},{market:['result']},{selection:'6-0',market:'exactScore'},{selection:'missing'},{selection:['home','draw']},{confirmedOdd:2.61},{confirmedOdd:'2.610'},{operationKey:''},{operationKey:['x']},{fixtureId:null},{selections:['home','draw']}])
  assert.equal((await call('/api/bets',{...wager(),...change},cookie)).status,400,JSON.stringify(change));
 for(const raw of [null,[],{},'bet'])assert.equal((await call('/api/bets',raw,cookie)).status,400);
 assert.equal((await call('/api/bets',{...wager(),fixtureId:'missing'},cookie)).status,404);
 assert.deepEqual(await (await call('/api/wallet',undefined,cookie)).json(),before);
 assert.deepEqual(await (await call('/api/bets',undefined,cookie)).json(),[]);
});
test('at most ten bets per fixture are accepted under concurrency and refusals do not consume the limit',async()=>{
 const cookie=await bettor();
 for(let i=0;i<3;i++) assert.equal((await call('/api/bets',{...wager(),confirmedOdd:'2.60'},cookie)).status,409);
 const responses=await Promise.all(Array.from({length:12},()=>call('/api/bets',{...wager(),stakeCents:100},cookie)));
 assert.deepEqual(responses.map(r=>r.status).sort(),[...Array(10).fill(201),400,400]);
 const history=await (await call('/api/bets',undefined,cookie)).json();assert.equal(history.length,10);
 assert.equal((await (await call('/api/wallet',undefined,cookie)).json()).balanceCents,9000);
 // A second fixture has an independent allowance; upper stake bound may use all available money.
 const fixture=await (await call('/api/fixtures/demo-fixture-2')).json();
 const other={...wager(),fixtureId:fixture.id,confirmedOdd:fixture.markets.result.selections.find(s=>s.key==='home').odd,stakeCents:9000};
 assert.equal((await call('/api/bets',other,cookie)).status,201);
 assert.equal((await call('/api/bets',{...other,stakeCents:100,operationKey:randomUUID()},cookie)).status,400);
 assert.equal((await (await call('/api/wallet',undefined,cookie)).json()).balanceCents,0);
});
test('own history supports fixture and status filters and exposes neither another bettor nor admin access',async()=>{
 const cookie=await bettor(),other=await bettor();
 const first=await (await call('/api/bets',wager(),cookie)).json();
 const fixture=await (await call('/api/fixtures/demo-fixture-2')).json();
 const second=await (await call('/api/bets',{...wager(),fixtureId:fixture.id,confirmedOdd:fixture.markets.result.selections.find(s=>s.key==='home').odd},cookie)).json();
 assert.deepEqual(await (await call('/api/bets?fixtureId=demo-fixture-1&status=pending',undefined,cookie)).json(),[first]);
 assert.deepEqual(await (await call('/api/bets?fixtureId=demo-fixture-2',undefined,cookie)).json(),[second]);
 assert.deepEqual(await (await call('/api/bets?status=won',undefined,cookie)).json(),[]);
 assert.deepEqual(await (await call('/api/bets?userId=demo-bettor',undefined,other)).json(),[]);
 assert.equal((await call('/api/bets?status=unknown',undefined,cookie)).status,400);
 const admin=(await call('/api/auth/login',{email:'admin@betfake.local',password:process.env.DEMO_ADMIN_PASSWORD??'AdminDemo123!'})).headers.get('set-cookie');
 for(const [owner,status] of [[undefined,401],[admin,403]]) {
  assert.equal((await call('/api/bets',undefined,owner)).status,status);
  assert.equal((await call('/api/bets',wager(),owner)).status,status);
 }
 const response=await fetch(base+'/api/bets',{method:'POST',headers:{cookie,'content-type':'application/json',origin:'https://untrusted.example'},body:JSON.stringify(wager())});
 assert.equal(response.status,403);
 assert.equal((await (await call('/api/bets',undefined,cookie)).json()).length,2);
});
test('bets and withdrawals serialize the available money and the upper stake bound is accepted',async()=>{
 const cookie=await bettor();
 const responses=await Promise.all([
  call('/api/bets',{...wager(),stakeCents:6000},cookie),
  call('/api/wallet/operations',{kind:'withdrawal',amountCents:6000,operationKey:randomUUID()},cookie),
 ]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,400]);
 const wallet=await (await call('/api/wallet',undefined,cookie)).json();assert.equal(wallet.balanceCents,4000);assert.equal(wallet.entries.length,2);
 const full=await bettor();assert.equal((await call('/api/bets',{...wager(),stakeCents:10000},full)).status,201);
 assert.equal((await (await call('/api/wallet',undefined,full)).json()).balanceCents,0);
});
test('exact scores and other score are offered; the predicted time does not close pregame and closed statuses refuse money',async()=>{
 const admin=(await call('/api/auth/login',{email:'admin@betfake.local',password:process.env.DEMO_ADMIN_PASSWORD??'AdminDemo123!'})).headers.get('set-cookie');
 const publication=await call('/api/fixtures',{homeTeamId:'demo-team-1',awayTeamId:'demo-team-2',scheduledAt:'2020-01-01T12:00:00Z'},admin);assert.equal(publication.status,201);
 const fixture=await publication.json(),cookie=await bettor();assert.match(fixture.id,/^[a-f0-9-]{36}$/);
 let accepted;
 for(const selection of ['0-0','5-5','other']) {
  const body={...wager(),fixtureId:fixture.id,market:'exactScore',selection,confirmedOdd:fixture.markets.exactScore.selections.find(s=>s.key===selection).odd};
  const response=await call('/api/bets',body,cookie);assert.equal(response.status,201);accepted={body,bet:await response.json()};
 }
 const before=await (await call('/api/wallet',undefined,cookie)).json();
 const history=await (await call('/api/bets',undefined,cookie)).json();
 // Start is public since #7; final/cancelled arrangements remain until #9/#10.
 assert.equal((await call(`/api/fixtures/${fixture.id}/start`,{},admin)).status,201);
 for(const status of ['in_progress','finished','cancelled']) {
  if(status!=='in_progress')compose('exec','-T','db','psql','-U',process.env.POSTGRES_USER??'bet_fake','-d',process.env.POSTGRES_DB??'bet_fake','-v','ON_ERROR_STOP=1','-c',`UPDATE fixtures SET status='${status}' WHERE id='${fixture.id}'`);
  assert.equal((await (await call(`/api/fixtures/${fixture.id}`)).json()).status,status);
  assert.equal((await call('/api/bets',{...wager(),fixtureId:fixture.id},cookie)).status,400);
  assert.deepEqual(await (await call('/api/bets',accepted.body,cookie)).json(),accepted.bet);
  assert.deepEqual(await (await call('/api/wallet',undefined,cookie)).json(),before);
  assert.deepEqual(await (await call('/api/bets',undefined,cookie)).json(),history);
 }
});
