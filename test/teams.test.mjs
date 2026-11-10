import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
async function call(path, body, cookie, method = body === undefined ? 'GET' : 'POST', origin) {
 return fetch(base + path, { method, headers: { 'content-type': 'application/json', connection: 'close', ...(cookie ? {cookie} : {}), ...(origin ? {origin} : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function admin() { return (await call('/api/auth/login', {email:'admin@betfake.local',password:process.env.DEMO_ADMIN_PASSWORD ?? 'AdminDemo123!'})).headers.get('set-cookie'); }
test('administrator registers an incomplete team and visitors can consult it', async () => {
 const cookie = await admin();
 const name = `Time ${randomUUID()}`;
 const response = await call('/api/teams', {name}, cookie);
 assert.equal(response.status,201);
 const created = await response.json();
 const detail = await (await call(`/api/teams/${created.id}`)).json();
 assert.equal(detail.name,name);
 assert.deepEqual(detail.players,[]);
 assert.equal(detail.overall,null);
 assert.equal(detail.lineupValid,false);
});
test('administrator manages players and validates eleven unique starters, one goalkeeper and team mean', async () => {
 const cookie = await admin();
 const team = await (await call('/api/teams',{name:`Elenco ${randomUUID()}`},cookie)).json();
 const path = `/api/teams/${team.id}`;
 const players=[];
 for(let n=0;n<12;n++) {
  const response=await call(`${path}/players`,{name:`Jogador ${n}`,position:n===0?'goleiro':'defensor',overall:n===0?100:78},cookie);
  assert.equal(response.status,201); players.push(await response.json());
 }
 for(const overall of [0,101,1.5,'80']) assert.equal((await call(`${path}/players`,{name:'Inválido',position:'atacante',overall},cookie)).status,400);
 assert.equal((await call(`${path}/players`,{name:'Inválido',position:'lateral',overall:80},cookie)).status,400);
 const ids=players.slice(0,11).map(p=>p.id);
 for(const playerIds of [ids.slice(1),[...ids.slice(0,10),ids[0]],players.slice(1).map(p=>p.id),[...ids.slice(0,10),'missing']]) {
  assert.equal((await call(`${path}/lineup`,{playerIds},cookie,'PUT')).status,400);
 }
 assert.equal((await call(`${path}/lineup`,{playerIds:ids},cookie,'PUT')).status,200);
 let detail=await (await call(path)).json();
 assert.equal(detail.lineupValid,true); assert.equal(detail.overall,80); assert.equal(detail.lineup.length,11);
 assert.equal((await call(`${path}/players/${players[1].id}`,{name:'Editado',position:'atacante',overall:89},cookie,'PATCH')).status,200);
 detail=await (await call(path)).json(); assert.equal(detail.overall,81); assert.equal(detail.players.find(p=>p.id===players[1].id).name,'Editado');
 assert.equal((await call(path,{name:`Editado ${randomUUID()}`},cookie,'PATCH')).status,200);
});
test('archives reject archived and foreign players without deleting their records', async () => {
 const cookie=await admin();
 const team=await (await call('/api/teams',{name:`Arquivar ${randomUUID()}`},cookie)).json();
 const path=`/api/teams/${team.id}`;
 const ids=[];
 for(let n=0;n<11;n++) {
  const response=await call(`${path}/players`,{name:`Titular ${n}`,position:n===0?'goleiro':'atacante',overall:70},cookie);
  assert.equal(response.status,201);ids.push((await response.json()).id);
 }
 assert.equal((await call(`${path}/lineup`,{playerIds:ids},cookie,'PUT')).status,200);
 const foreign=[...ids];foreign[0]='demo-player-2-1';
 assert.equal((await call(`${path}/lineup`,{playerIds:foreign},cookie,'PUT')).status,400);
 assert.equal((await call(`${path}/players/${ids[1]}/archive`,{},cookie)).status,201);
 const changed=await (await call(path)).json();
 assert.equal(changed.players.length,11);
 assert.equal(changed.players.find(p=>p.id===ids[1]).archived,true);
 assert.equal(changed.lineupValid,false);assert.equal(changed.overall,null);
 assert.equal((await call(`${path}/lineup`,{playerIds:ids},cookie,'PUT')).status,400);
 assert.equal((await call(`${path}/archive`,{},cookie)).status,201);
 assert.equal((await (await call(path)).json()).archived,true);
 assert.equal((await call(`${path}/players`,{name:'Novo',position:'goleiro',overall:70},cookie)).status,400);
 assert.equal((await call(`${path}/lineup`,{playerIds:ids},cookie,'PUT')).status,400);
});
test('only administrators may mutate teams, players and lineups; origin checks remain enforced', async () => {
 const cookie=await admin();
 const team=await (await call('/api/teams',{name:`Permissões ${randomUUID()}`},cookie)).json();
 const playerResponse=await call(`/api/teams/${team.id}/players`,{name:'Teste',position:'goleiro',overall:80},cookie);
 assert.equal(playerResponse.status,201);const player=await playerResponse.json();
 const bettorLogin=await call('/api/auth/login',{email:'apostador@betfake.local',password:process.env.DEMO_BETTOR_PASSWORD ?? 'ApostadorDemo123!'});
 assert.equal(bettorLogin.status,200);const bettor=bettorLogin.headers.get('set-cookie');
 const mutations=[['/api/teams',{name:'Sem acesso'},'POST'],[`/api/teams/${team.id}`,{name:'Sem acesso'},'PATCH'],[`/api/teams/${team.id}/players`,{name:'Sem acesso',position:'goleiro',overall:80},'POST'],[`/api/teams/${team.id}/players/${player.id}`,{name:'Sem acesso',position:'goleiro',overall:80},'PATCH'],[`/api/teams/${team.id}/lineup`,{playerIds:[]},'PUT'],[`/api/teams/${team.id}/archive`,{},'POST'],[`/api/teams/${team.id}/players/${player.id}/archive`,{},'POST']];
 for(const [path,body,method] of mutations) {
  assert.equal((await call(path,body,undefined,method)).status,401);
  assert.equal((await call(path,body,bettor,method)).status,403);
  assert.equal((await call(path,body,cookie,method,'https://untrusted.example')).status,403);
 }
 assert.equal((await call(`/api/teams/${team.id}`)).status,200);
 assert.equal((await call(`/api/teams/${team.id}`,undefined,bettor)).status,200);
 assert.equal((await call('/api/teams',{name:' '},cookie)).status,400);
 assert.equal((await call('/api/teams',{name:team.name},cookie)).status,409);
 assert.equal((await call('/api/teams/missing')).status,404);
});
test('published fixture names and player attributes stay fixed when current records change', async () => {
 const cookie=await admin();
 const before=await (await call('/api/demo')).json();
 assert.equal(typeof before.fixtures[0].homeTeamName,'string');
 const team=await (await call('/api/teams/demo-team-1')).json();const player=team.players[0];
 try {
  assert.equal((await call(`/api/teams/${team.id}`,{name:`Atual ${randomUUID()}`},cookie,'PATCH')).status,200);
  assert.equal((await call(`/api/teams/${team.id}/players/${player.id}`,{name:'Atualizado',position:'atacante',overall:1},cookie,'PATCH')).status,200);
  assert.deepEqual((await (await call('/api/demo')).json()).fixtures,before.fixtures);
 } finally {
  assert.equal((await call(`/api/teams/${team.id}`,{name:team.name},cookie,'PATCH')).status,200);
  assert.equal((await call(`/api/teams/${team.id}/players/${player.id}`,{name:player.name,position:player.position,overall:player.overall},cookie,'PATCH')).status,200);
 }
});
import { compose } from './compose.mjs';
test('seed and normal restart preserve changed demo starters rather than backfilling them again', async () => {
 const cookie=await admin();
 const path='/api/teams/demo-team-2';
 const before=await (await call(path)).json();
 const replacement=before.players.find(p=>!p.archived && p.position!=='goleiro' && !p.starter);
 let added;
 if(!replacement) {
  const response=await call(`${path}/players`,{name:`Reserva ${randomUUID()}`,position:'defensor',overall:80},cookie);
  assert.equal(response.status,201);added=await response.json();
 }
 const reserve=replacement ?? added;
 const originalIds=before.lineup;
 assert.equal(originalIds.length,11);
 const outfield=before.players.find(p=>p.starter && p.position!=='goleiro');
 const changed=originalIds.map(id=>id===outfield.id?reserve.id:id);
 try {
  assert.equal((await call(`${path}/lineup`,{playerIds:changed},cookie,'PUT')).status,200);
  compose('exec','-T','app','node','dist/seed.js');
  compose('restart','app');
  compose('up','-d','--wait','--wait-timeout','120');
  const after=await (await call(path)).json();
  assert.deepEqual([...after.lineup].sort(),[...changed].sort());
  assert.equal(after.lineupValid,true);
 } finally {
  assert.equal((await call(`${path}/lineup`,{playerIds:originalIds},cookie,'PUT')).status,200);
  if(added) assert.equal((await call(`${path}/players/${added.id}/archive`,{},cookie)).status,201);
 }
});
