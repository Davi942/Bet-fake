import assert from 'node:assert/strict';
import test from 'node:test';
import { liveCase, liveSetup } from './live-case.mjs';

test('successful team management is audited with author, changes and date for admins only', () => {
 assert.match(liveCase(`${liveSetup}
 try {
  const account={displayName:'Sem acesso',email:'audit-bettor@example.com',password:'Password123!'};
  assert.equal((await call('/api/auth/signup',account)).status,201);
  const bettor=(await call('/api/auth/login',account)).headers.get('set-cookie');
  assert.equal((await call('/api/admin/audit')).status,401);
  assert.equal((await call('/api/admin/audit',undefined,bettor)).status,403);
  assert.deepEqual(await (await call('/api/admin/audit',undefined,cookie)).json(),[]);
  const created=await call('/api/teams',{name:'Time Auditável'},cookie);
  assert.equal(created.status,201);
  const team=await created.json();
  const changed=await fetch(base+'/api/teams/'+team.id,{method:'PATCH',headers:{'content-type':'application/json',cookie},body:JSON.stringify({name:'Time Renomeado'})});
  assert.equal(changed.status,200);
  assert.equal((await call('/api/teams',{name:'Time Renomeado'},cookie)).status,409);
  const entries=await (await call('/api/admin/audit',undefined,cookie)).json();
  assert.equal(entries.length,2);
  assert.deepEqual(entries.map(item=>item.action),['team.updated','team.created']);
  assert.equal(entries[0].actor.displayName,'Administrador de demonstração');
  assert.equal(entries[0].actor.email,'admin@betfake.local');
  assert.equal(entries[0].target.id,team.id);
  assert.deepEqual(entries[0].changes,{before:{name:'Time Auditável'},after:{name:'Time Renomeado'}});
  assert.deepEqual(entries[1].changes,{before:null,after:{name:'Time Auditável'}});
  for(const item of entries)assert.ok(Number.isFinite(Date.parse(item.createdAt)));
  console.log('admin-audit-team-ok');
 }finally{await app.close();}
 `),/admin-audit-team-ok/);
});

test('player, lineup and fixture actions are audited with their changed fields and survive reseed',()=>{
 assert.match(liveCase(`${liveSetup}
 try {
  const send=async(path,body,method='POST')=>fetch(base+path,{method,headers:{'content-type':'application/json',cookie},body:JSON.stringify(body)});
  const team=await (await call('/api/teams',{name:'Equipe auditada'},cookie)).json();
  const player=await (await call('/api/teams/'+team.id+'/players',{name:'Atleta inicial',position:'goleiro',overall:70},cookie)).json();
  assert.equal((await send('/api/teams/'+team.id+'/players/'+player.id,{name:'Atleta final',position:'goleiro',overall:75},'PATCH')).status,200);
  assert.equal((await call('/api/teams/'+team.id+'/players/'+player.id+'/archive',{},cookie)).status,201);
  assert.equal((await call('/api/teams/'+team.id+'/archive',{},cookie)).status,201);
  const demoTeam=await (await call('/api/teams/demo-team-1')).json();
  assert.equal((await send('/api/teams/demo-team-1/lineup',{playerIds:demoTeam.lineup},'PUT')).status,200);
  const published=await call('/api/fixtures',{homeTeamId:'demo-team-1',awayTeamId:'demo-team-2',scheduledAt:'2099-05-01T12:00:00Z'},cookie);
  assert.equal(published.status,201);const fixture=await published.json();
  assert.equal((await send('/api/fixtures/'+fixture.id,{scheduledAt:'2099-05-02T12:00:00Z'},'PATCH')).status,200);
  assert.equal((await call('/api/fixtures/'+fixture.id+'/start',{},cookie)).status,201);
  assert.equal((await call('/api/fixtures/demo-fixture-2/cancel',{reason:'Campo interditado'},cookie)).status,201);
  const entries=await (await call('/api/admin/audit',undefined,cookie)).json();
  assert.deepEqual(entries.map(item=>item.action),[
   'fixture.cancelled','fixture.started','fixture.rescheduled','fixture.published','lineup.updated',
   'team.archived','player.archived','player.updated','player.created','team.created']);
  const byAction=Object.fromEntries(entries.map(item=>[item.action,item]));
  assert.deepEqual(byAction['player.updated'].changes,{before:{name:'Atleta inicial',position:'goleiro',overall:70},after:{name:'Atleta final',position:'goleiro',overall:75}});
  assert.deepEqual(byAction['fixture.rescheduled'].changes,{before:{scheduledAt:'2099-05-01T12:00:00.000Z'},after:{scheduledAt:'2099-05-02T12:00:00.000Z'}});
  assert.deepEqual(byAction['fixture.cancelled'].changes.after,{status:'cancelled',reason:'Campo interditado'});
  assert.equal(byAction['fixture.started'].target.id,fixture.id);
  assert.equal(byAction['lineup.updated'].changes.after.playerIds.length,11);
  const {createInitializationPool,initializeDatabase}=require('./dist/seed');
  const pool=createInitializationPool();try{await initializeDatabase(pool);}finally{await pool.end();}
  assert.deepEqual(await (await call('/api/admin/audit',undefined,cookie)).json(),entries);
  console.log('admin-audit-actions-ok');
 }finally{await app.close();}
 `),/admin-audit-actions-ok/);
});
