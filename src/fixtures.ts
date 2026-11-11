import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Database } from './database';
import { Auth } from './auth';
import { pregameMarkets } from './markets';
type Request={headers:Record<string,string|undefined>};
function input(raw:unknown) {
 if(!raw || typeof raw!=='object'||Array.isArray(raw)) throw new BadRequestException('Dados inválidos.');
 return raw as Record<string,unknown>;
}
function scheduledDate(value:unknown) {
 // Require an explicit offset and reject normalized impossible calendar dates.
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) throw new BadRequestException('Informe data e hora válidas com fuso horário.');
 const date=new Date(value), parts=value.slice(0,10).split('-').map(Number);
 const calendar=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));
 if(!Number.isFinite(date.getTime())||calendar.getUTCFullYear()!==parts[0]||calendar.getUTCMonth()!==parts[1]-1||calendar.getUTCDate()!==parts[2]) throw new BadRequestException('Informe data e hora válidas com fuso horário.');
 return date;
}
@Injectable()
export class Fixtures {
 constructor(private readonly db:Database) {}
 async list() {
  const rows=(await this.db.pool.query('SELECT id FROM fixtures ORDER BY scheduled_at,id')).rows;
  return Promise.all(rows.map(row=>this.detail(row.id)));
 }
 async detail(id:string) {
  const fixture=(await this.db.pool.query(`SELECT id,home_team_id AS "homeTeamId",away_team_id AS "awayTeamId",home_team_name AS "homeTeamName",away_team_name AS "awayTeamName",scheduled_at AS "scheduledAt",status FROM fixtures WHERE id=$1`,[id])).rows[0];
  if(!fixture) throw new NotFoundException('Partida não encontrada.');
  const lineups=(await this.db.pool.query(`SELECT team_id AS "teamId",player_id AS "playerId",name,position,overall FROM fixture_lineups WHERE fixture_id=$1 ORDER BY team_id,player_id`,[id])).rows;
  const overall=(teamId:string)=>lineups.filter(p=>p.teamId===teamId).reduce((sum,p)=>sum+p.overall,0)/11;
  const homeOverall=overall(fixture.homeTeamId),awayOverall=overall(fixture.awayTeamId);
  return {...fixture,lineups,homeOverall,awayOverall,markets:pregameMarkets(homeOverall,awayOverall)};
 }
 async publish(raw:unknown) {
  const body=input(raw),scheduledAt=scheduledDate(body.scheduledAt);
  if(Object.keys(body).some(key=>!['homeTeamId','awayTeamId','scheduledAt'].includes(key))) throw new BadRequestException('Informe somente os times e o horário previsto.');
  if(typeof body.homeTeamId!=='string'||typeof body.awayTeamId!=='string'||!body.homeTeamId||!body.awayTeamId||body.homeTeamId===body.awayTeamId) throw new BadRequestException('Selecione dois times diferentes.');
  const client=await this.db.pool.connect(),id=randomUUID();
  try {
   await client.query('BEGIN');
   // Every lineup/player/archive edit locks its team; deterministic order avoids deadlocks.
   const teams=(await client.query('SELECT id,name,archived FROM teams WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[[body.homeTeamId,body.awayTeamId]])).rows;
   const players=(await client.query(`SELECT p.id,p.team_id,p.name,p.position,p.overall,p.archived FROM current_lineups l JOIN players p ON p.id=l.player_id AND p.team_id=l.team_id WHERE l.team_id=ANY($1::text[])`,[[body.homeTeamId,body.awayTeamId]])).rows;
   if(teams.length!==2||teams.some(t=>t.archived)||teams.some(t=>{const lineup=players.filter(p=>p.team_id===t.id);return lineup.length!==11||lineup.some(p=>p.archived)||lineup.filter(p=>p.position==='goleiro').length!==1;})) throw new BadRequestException('Cada time deve estar ativo e ter 11 titulares ativos: 1 goleiro e 10 jogadores de linha.');
   await client.query(`INSERT INTO fixtures(id,home_team_id,away_team_id,home_team_name,away_team_name,scheduled_at,status) VALUES($1,$2,$3,$4,$5,$6,'scheduled')`,[id,body.homeTeamId,body.awayTeamId,teams.find(t=>t.id===body.homeTeamId).name,teams.find(t=>t.id===body.awayTeamId).name,scheduledAt]);
   await client.query(`INSERT INTO fixture_lineups(fixture_id,team_id,player_id,name,position,overall) SELECT $1,p.team_id,p.id,p.name,p.position,p.overall FROM players p JOIN current_lineups l ON l.player_id=p.id AND l.team_id=p.team_id WHERE l.team_id=ANY($2::text[])`,[id,[body.homeTeamId,body.awayTeamId]]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  return this.detail(id);
 }
 async reschedule(id:string,raw:unknown) {
  const body=input(raw);
  if(Object.keys(body).length!==1||!('scheduledAt' in body)) throw new BadRequestException('Somente o horário previsto pode ser alterado.');
  const date=scheduledDate(body.scheduledAt);
  const result=await this.db.pool.query("UPDATE fixtures SET scheduled_at=$2 WHERE id=$1 AND status='scheduled' RETURNING id",[id,date]);
  if(!result.rowCount) {await this.detail(id);throw new BadRequestException('Somente partidas agendadas podem mudar de horário.');}
  return this.detail(id);
 }
}
@Controller('api/fixtures')
export class FixturesController {
 constructor(private readonly fixtures:Fixtures,private readonly auth:Auth) {}
 @Get() list(){return this.fixtures.list();}
 @Get(':id') detail(@Param('id') id:string){return this.fixtures.detail(id);}
 @Post() async publish(@Req() request:Request,@Body() raw:unknown){await this.auth.authenticate(request,'admin');return this.fixtures.publish(raw);}
 @Patch(':id') async reschedule(@Req() request:Request,@Param('id') id:string,@Body() raw:unknown){await this.auth.authenticate(request,'admin');return this.fixtures.reschedule(id,raw);}
}
