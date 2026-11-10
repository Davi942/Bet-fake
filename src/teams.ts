import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Database } from './database';
import { Auth } from './auth';
type Request = { headers: Record<string, string | undefined> };
const positions = ['goleiro','defensor','meio-campista','atacante'];
function bodyInput(raw: unknown): Record<string, unknown> {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Dados inválidos.');
 return raw as Record<string, unknown>;
}
function nameInput(raw: unknown) {
 const value = bodyInput(raw);
 if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 100) throw new BadRequestException('Informe um nome de até 100 caracteres.');
 return value.name.trim();
}
function playerInput(raw: unknown) {
 const name = nameInput(raw), body = bodyInput(raw);
 if (!positions.includes(body.position as string) || !Number.isInteger(body.overall) || Number(body.overall)<1 || Number(body.overall)>100) throw new BadRequestException('Informe posição válida e overall inteiro de 1 a 100.');
 return {name,position:body.position,overall:body.overall};
}
@Injectable()
export class Teams {
 constructor(private readonly db: Database) {}
 async list() {
 const teams = (await this.db.pool.query('SELECT id FROM teams ORDER BY name')).rows;
 return Promise.all(teams.map(team=>this.detail(team.id)));
 }
 async detail(id: string) {
 const team = (await this.db.pool.query('SELECT id,name,archived FROM teams WHERE id=$1',[id])).rows[0];
 if (!team) throw new NotFoundException('Time não encontrado.');
 const players = (await this.db.pool.query(`SELECT p.id,p.name,p.position,p.overall,p.archived,(l.player_id IS NOT NULL) AS starter
 FROM players p LEFT JOIN current_lineups l ON l.player_id=p.id AND l.team_id=p.team_id WHERE p.team_id=$1 ORDER BY p.name,p.id`,[id])).rows;
 const lineup=players.filter(p=>p.starter);
 const lineupValid=!team.archived && lineup.length===11 && lineup.every(p=>!p.archived) && lineup.filter(p=>p.position==='goleiro').length===1;
 return {...team,players,lineup:lineup.map(p=>p.id),lineupValid,overall:lineupValid ? lineup.reduce((sum,p)=>sum+p.overall,0)/11 : null};
 }
 async create(raw: unknown) {
 const name = nameInput(raw);
 return this.unique(async()=> { const id=randomUUID(); await this.db.pool.query('INSERT INTO teams(id,name) VALUES($1,$2)',[id,name]); return this.detail(id); });
 }
 private async unique<T>(operation:()=>Promise<T>):Promise<T> {
 try { return await operation(); } catch(error) { if ((error as {code?:string}).code==='23505') throw new ConflictException('Nome de time já cadastrado.'); throw error; }
 }
 async edit(id:string,raw:unknown) {
 const name=nameInput(raw); await this.detail(id);
 return this.unique(async()=>{await this.db.pool.query('UPDATE teams SET name=$2 WHERE id=$1',[id,name]); return this.detail(id);});
 }
 async player(teamId:string,raw:unknown,id?:string) {
 const values=playerInput(raw); const client=await this.db.pool.connect();
 try {
 await client.query('BEGIN');
 const team=(await client.query('SELECT archived FROM teams WHERE id=$1 FOR UPDATE',[teamId])).rows[0];
 if (!team) throw new NotFoundException('Time não encontrado.');
 if (team.archived) throw new BadRequestException('Time arquivado não aceita jogadores.');
 if (id) {
 const updated=await client.query('UPDATE players SET name=$3,position=$4,overall=$5 WHERE id=$1 AND team_id=$2 RETURNING id,name,position,overall,archived',[id,teamId,values.name,values.position,values.overall]);
 if(!updated.rowCount) throw new NotFoundException('Jogador não encontrado.');
 await client.query('COMMIT'); return updated.rows[0];
 }
 const result=await client.query('INSERT INTO players(id,team_id,name,position,overall) VALUES($1,$2,$3,$4,$5) RETURNING id,name,position,overall,archived',[randomUUID(),teamId,values.name,values.position,values.overall]);
 await client.query('COMMIT'); return result.rows[0];
 } catch(error) { await client.query('ROLLBACK'); throw error; } finally {client.release();}
 }
 async lineup(teamId:string,raw:unknown) {
 const {playerIds}=bodyInput(raw);
 if(!Array.isArray(playerIds) || playerIds.length!==11 || playerIds.some(id=>typeof id!=='string') || new Set(playerIds).size!==11) throw new BadRequestException('Selecione exatamente 11 titulares diferentes.');
 const client=await this.db.pool.connect();
 try {
 await client.query('BEGIN');
 const team=(await client.query('SELECT archived FROM teams WHERE id=$1 FOR UPDATE',[teamId])).rows[0];
 if(!team) throw new NotFoundException('Time não encontrado.');
 const players=(await client.query('SELECT position FROM players WHERE team_id=$1 AND id=ANY($2::text[]) AND archived=false',[teamId,playerIds])).rows;
 if(team.archived || players.length!==11 || players.filter(p=>p.position==='goleiro').length!==1) throw new BadRequestException('Escalação exige time ativo, 1 goleiro e 10 jogadores de linha ativos deste time.');
 await client.query('DELETE FROM current_lineups WHERE team_id=$1',[teamId]);
 await client.query('INSERT INTO current_lineups(team_id,player_id) SELECT $1,unnest($2::text[])',[teamId,playerIds]);
 await client.query('COMMIT'); return this.detail(teamId);
 } catch(error) {await client.query('ROLLBACK'); throw error;} finally {client.release();}
 }
 async archive(teamId:string,playerId?:string) {
 const client=await this.db.pool.connect();
 try {
 await client.query('BEGIN');
 const team=await client.query('SELECT id FROM teams WHERE id=$1 FOR UPDATE',[teamId]);
 if(!team.rowCount) throw new NotFoundException('Time não encontrado.');
 if(playerId) {
 const result=await client.query('UPDATE players SET archived=true WHERE id=$1 AND team_id=$2 RETURNING id',[playerId,teamId]);
 if(!result.rowCount) throw new NotFoundException('Jogador não encontrado.');
 await client.query('DELETE FROM current_lineups WHERE team_id=$1 AND player_id=$2',[teamId,playerId]);
 } else {
 await client.query('UPDATE teams SET archived=true WHERE id=$1',[teamId]);
 await client.query('DELETE FROM current_lineups WHERE team_id=$1',[teamId]);
 }
 await client.query('COMMIT');return this.detail(teamId);
 } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
 }
}
@Controller('api/teams')
export class TeamsController {
 constructor(private readonly teams: Teams, private readonly auth: Auth) {}
 @Get() list() { return this.teams.list(); }
 @Get(':id') detail(@Param('id') id: string) { return this.teams.detail(id); }
 @Post() async create(@Req() request: Request, @Body() raw: unknown) { await this.auth.authenticate(request,'admin'); return this.teams.create(raw); }
 @Patch(':id') async edit(@Req() request:Request,@Param('id') id:string,@Body() raw:unknown) {await this.auth.authenticate(request,'admin');return this.teams.edit(id,raw);}
 @Post(':id/players') async player(@Req() request:Request,@Param('id') id:string,@Body() raw:unknown) {await this.auth.authenticate(request,'admin');return this.teams.player(id,raw);}
 @Patch(':id/players/:playerId') async editPlayer(@Req() request:Request,@Param('id') id:string,@Param('playerId') playerId:string,@Body() raw:unknown) {await this.auth.authenticate(request,'admin');return this.teams.player(id,raw,playerId);}
 @Put(':id/lineup') async lineup(@Req() request:Request,@Param('id') id:string,@Body() raw:unknown) {await this.auth.authenticate(request,'admin');return this.teams.lineup(id,raw);}
 @Post(':id/archive') async archive(@Req() request:Request,@Param('id') id:string) {await this.auth.authenticate(request,'admin');return this.teams.archive(id);}
 @Post(':id/players/:playerId/archive') async archivePlayer(@Req() request:Request,@Param('id') id:string,@Param('playerId') playerId:string) {await this.auth.authenticate(request,'admin');return this.teams.archive(id,playerId);}
}
