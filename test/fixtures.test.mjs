import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
const base=process.env.TEST_BASE_URL ?? 'http://localhost:3000';
async function call(path,body,cookie,method=body===undefined?'GET':'POST') {
 return fetch(base+path,{method,headers:{'content-type':'application/json',connection:'close',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
async function admin() {return (await call('/api/auth/login',{email:'admin@betfake.local',password:process.env.DEMO_ADMIN_PASSWORD ?? 'AdminDemo123!'})).headers.get('set-cookie');}
async function team(cookie,overall=80) {
 const created=await (await call('/api/teams',{name:`Partida ${randomUUID()}`},cookie)).json();
 const ids=[];
 for(let n=0;n<11;n++) ids.push((await (await call(`/api/teams/${created.id}/players`,{name:`Titular ${n}`,position:n===0?'goleiro':'atacante',overall},cookie)).json()).id);
 assert.equal((await call(`/api/teams/${created.id}/lineup`,{playerIds:ids},cookie,'PUT')).status,200);
 return {...created,ids};
}
test('publication immediately exposes scheduled fixture with fixed lineups and coherent 5% markets',async()=>{
 const cookie=await admin(),home=await team(cookie),away=await team(cookie);
 const response=await call('/api/fixtures',{homeTeamId:home.id,awayTeamId:away.id,scheduledAt:'2027-01-20T18:00:00-03:00'},cookie);
 assert.equal(response.status,201);
 const fixture=await response.json();
 const detail=await (await call(`/api/fixtures/${fixture.id}`)).json();
 assert.equal(detail.status,'scheduled');assert.equal(detail.homeTeamName,home.name);assert.equal(detail.homeOverall,80);
 assert.equal(detail.lineups.length,22);assert.equal(detail.scheduledAt,'2027-01-20T21:00:00.000Z');
 assert.ok((await (await call('/api/fixtures')).json()).some(f=>f.id===fixture.id));
 assert.equal(detail.markets.result.selections.length,3);assert.equal(detail.markets.exactScore.selections.length,37);
 assert.equal(new Set(detail.markets.exactScore.selections.map(s=>s.key)).size,37);
 for(let h=0;h<=5;h++)for(let a=0;a<=5;a++)assert.ok(detail.markets.exactScore.selections.some(s=>s.key===`${h}-${a}`));
 assert.ok(detail.markets.exactScore.selections.find(s=>s.key==='other').probability>0);
 const result=detail.markets.result.selections;
 // Independent reference: equal Poisson rates 1.35 give P(draw)=0.2581801236492902.
 assert.ok(Math.abs(result[1].probability-0.2581801236492902)<1e-9);
 assert.equal(result[0].odd,'2.57');assert.equal(result[1].odd,'3.69');assert.equal(result[2].odd,'2.57');
 assert.ok(Math.abs(result[0].probability-result[2].probability)<1e-12);
 const exact=detail.markets.exactScore.selections;
 assert.ok(Math.abs(exact.find(s=>s.key==='0-0').probability-0.06720551274)<1e-10);
 for(const market of Object.values(detail.markets)) {
  assert.equal(market.open,true);
  assert.ok(Math.abs(market.selections.reduce((sum,s)=>sum+s.probability,0)-1)<1e-12);
  for(const s of market.selections) {assert.match(s.odd,/^\d+\.\d{2}$/);assert.ok(Math.abs(Number(s.odd)-1/(1.05*s.probability))<=0.00501);}
 }
});

test('published names, player attributes, strengths and markets survive edits and archiving; only schedule changes',async()=>{
 const cookie=await admin(),home=await team(cookie,100),away=await team(cookie,1);
 const fixture=await (await call('/api/fixtures',{homeTeamId:home.id,awayTeamId:away.id,scheduledAt:'2027-03-20T12:00:00Z'},cookie)).json();
 assert.ok(fixture.markets.result.selections[0].probability>fixture.markets.result.selections[2].probability);
 for(const market of Object.values(fixture.markets)) for(const selection of market.selections) {assert.ok(Number.isFinite(Number(selection.odd)));assert.ok(Number(selection.odd)>=1);}
 assert.equal((await call(`/api/teams/${home.id}`,{name:'Nome posterior '+randomUUID()},cookie,'PATCH')).status,200);
 assert.equal((await call(`/api/teams/${home.id}/players/${home.ids[0]}`,{name:'Jogador posterior',position:'defensor',overall:1},cookie,'PATCH')).status,200);
 assert.equal((await call(`/api/teams/${home.id}/players/${home.ids[1]}/archive`,{},cookie)).status,201);
 assert.equal((await call(`/api/teams/${home.id}/archive`,{},cookie)).status,201);
 assert.equal((await (await call(`/api/teams/${home.id}`)).json()).archived,true);
 assert.deepEqual(await (await call(`/api/fixtures/${fixture.id}`)).json(),fixture);
 assert.equal((await call(`/api/fixtures/${fixture.id}`,{homeTeamId:away.id},cookie,'PATCH')).status,400);
 assert.equal((await call(`/api/fixtures/${fixture.id}`,{scheduledAt:'2027-04-20T09:00:00-03:00'},undefined,'PATCH')).status,401);
 const bettor=(await call('/api/auth/login',{email:'apostador@betfake.local',password:process.env.DEMO_BETTOR_PASSWORD ?? 'ApostadorDemo123!'})).headers.get('set-cookie');
 assert.equal((await call(`/api/fixtures/${fixture.id}`,{scheduledAt:'2027-04-20T09:00:00-03:00'},bettor,'PATCH')).status,403);
 assert.equal((await fetch(`${base}/api/fixtures/${fixture.id}`,{method:'PATCH',headers:{cookie,'content-type':'application/json',origin:'https://untrusted.example'},body:JSON.stringify({scheduledAt:'2027-04-20T09:00:00-03:00'})})).status,403);
 const changed=await (await call(`/api/fixtures/${fixture.id}`,{scheduledAt:'2027-04-20T09:00:00-03:00'},cookie,'PATCH')).json();
 assert.deepEqual(changed,{...fixture,scheduledAt:'2027-04-20T12:00:00.000Z'});
 const reversed=await (await call('/api/fixtures',{homeTeamId:away.id,awayTeamId:away.id,scheduledAt:'2027-03-20T12:00:00Z'},cookie)).json();
 assert.match(reversed.message,/diferentes/);
 assert.equal((await call('/api/fixtures/missing')).status,404);
});

test('publication rejects unauthorized access, inactive or invalid teams and impossible dates',async()=>{
 const cookie=await admin(),home=await team(cookie),away=await team(cookie);
 const valid={homeTeamId:home.id,awayTeamId:away.id,scheduledAt:'2027-01-20T18:00:00-03:00'};
 assert.equal((await call('/api/fixtures',valid)).status,401);
 const bettor=(await call('/api/auth/login',{email:'apostador@betfake.local',password:process.env.DEMO_BETTOR_PASSWORD ?? 'ApostadorDemo123!'})).headers.get('set-cookie');
 assert.equal((await call('/api/fixtures',valid,bettor)).status,403);
 for(const scheduledAt of ['2027-01-20T24:00:00Z','2027-02-29T12:00:00Z','2027-02-30T12:00:00Z','2027-04-31T12:00:00Z','2027-01-20T12:60:00Z','2027-01-20T12:00:00+24:00','2027-01-20T18:00','invalid',null]) {
  const response=await call('/api/fixtures',{...valid,scheduledAt},cookie);
  assert.equal(response.status,400,`invalid date ${scheduledAt}`);assert.match((await response.json()).message,/data|hora/i);
 }
 assert.equal((await call('/api/fixtures',{...valid,awayTeamId:home.id},cookie)).status,400);
 const empty=await (await call('/api/teams',{name:randomUUID()},cookie)).json();
 assert.equal((await call('/api/fixtures',{...valid,awayTeamId:empty.id},cookie)).status,400);
 assert.equal((await call(`/api/teams/${away.id}/players/${away.ids[0]}`,{name:'Virou defensor',position:'defensor',overall:80},cookie,'PATCH')).status,200);
 assert.equal((await call('/api/fixtures',valid,cookie)).status,400);
 assert.equal((await call(`/api/teams/${away.id}/players/${away.ids[0]}`,{name:'Goleiro restaurado',position:'goleiro',overall:80},cookie,'PATCH')).status,200);
 assert.equal((await call(`/api/teams/${home.id}/archive`,{},cookie)).status,201);
 assert.equal((await call('/api/fixtures',valid,cookie)).status,400);
});

