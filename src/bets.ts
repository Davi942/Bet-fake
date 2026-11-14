import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Post, Query, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Auth } from './auth';
import { Database } from './database';
import { liveMarkets, pregameMarkets } from './markets';
import { MATCH_DURATION_MS } from './simulation-boundary';

type Request={headers:Record<string,string|undefined>};
interface BetRow {
 id:string; fixture_id:string; market:string; selection:string; selection_label:string;
 stake_cents:string; accepted_odd:string; potential_return_cents:string; status:string;
 created_at:Date; home_team_name:string; away_team_name:string;
}
function bet(row:BetRow) {
 return {id:row.id,fixtureId:row.fixture_id,homeTeamName:row.home_team_name,awayTeamName:row.away_team_name,
  market:row.market,selection:row.selection,selectionLabel:row.selection_label,stakeCents:Number(row.stake_cents),
  acceptedOdd:row.accepted_odd,potentialReturnCents:Number(row.potential_return_cents),status:row.status,createdAt:row.created_at};
}
@Injectable()
export class Bets {
 constructor(private readonly db:Database,private readonly auth:Auth) {}
 async list(request:Request,filters:{fixtureId?:unknown;status?:unknown}={}) {
  const {user}=await this.auth.authenticate(request,'bettor');
  if((filters.fixtureId!==undefined&&typeof filters.fixtureId!=='string')||(filters.status!==undefined&&(typeof filters.status!=='string'||!['pending','won','lost','refunded'].includes(filters.status)))) throw new BadRequestException('Filtro de apostas inválido.');
  const rows=await this.db.pool.query(`SELECT b.*,f.home_team_name,f.away_team_name FROM bets b JOIN fixtures f ON f.id=b.fixture_id WHERE b.user_id=$1 AND ($2::text IS NULL OR b.fixture_id=$2) AND ($3::text IS NULL OR b.status=$3) ORDER BY b.created_at DESC,b.id`,[user.id,filters.fixtureId??null,filters.status??null]);
  return rows.rows.map(bet);
 }
 async accept(request:Request,raw:unknown) {
  const {user}=await this.auth.authenticate(request,'bettor');
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw new BadRequestException('Informe uma aposta simples.');
  const body=raw as Record<string,unknown>;
  if(Object.keys(body).some(key=>!['fixtureId','market','selection','stakeCents','confirmedOdd','operationKey'].includes(key))||
   typeof body.fixtureId!=='string'||!body.fixtureId||typeof body.market!=='string'||!['result','exactScore'].includes(body.market)||
   typeof body.selection!=='string'||!body.selection||!Number.isSafeInteger(body.stakeCents)||(body.stakeCents as number)<100||(body.stakeCents as number)>10000||
   typeof body.confirmedOdd!=='string'||!/^\d+\.\d{2}$/.test(body.confirmedOdd)||
   typeof body.operationKey!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(body.operationKey)) throw new BadRequestException('Escolha um resultado de uma partida, odd com duas casas e valor de R$ 1,00 a R$ 100,00 em centavos inteiros. Informe um identificador válido.');
  const stake=body.stakeCents as number;
  const client=await this.db.pool.connect();
  try {
   await client.query('BEGIN');
   // Lock order for every fixture financial operation: fixture, then wallet.
   const fixture=(await client.query('SELECT * FROM fixtures WHERE id=$1 FOR UPDATE',[body.fixtureId])).rows[0];
   const wallet=(await client.query('SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE',[user.id])).rows[0];
   const previous=(await client.query(`SELECT b.*,f.home_team_name,f.away_team_name FROM bets b JOIN fixtures f ON f.id=b.fixture_id WHERE b.user_id=$1 AND b.operation_key=$2`,[user.id,body.operationKey])).rows[0];
   if(previous) {
    if(previous.fixture_id!==body.fixtureId||previous.market!==body.market||previous.selection!==body.selection||Number(previous.stake_cents)!==body.stakeCents||previous.accepted_odd!==body.confirmedOdd)
     throw new ConflictException('Identificador já usado para outra aposta. Revise os dados.');
    await client.query('COMMIT');return bet(previous);
   }
   if((await client.query('SELECT id FROM wallet_entries WHERE user_id=$1 AND operation_key=$2',[user.id,body.operationKey])).rowCount)
    throw new ConflictException('Identificador já usado para outra operação financeira.');
   if(!fixture) throw new NotFoundException('Partida não encontrada.');
   if(!['scheduled','in_progress'].includes(fixture.status)) throw new BadRequestException('A partida não está aberta para apostas.');
   const lineups=(await client.query('SELECT team_id,overall FROM fixture_lineups WHERE fixture_id=$1',[body.fixtureId])).rows;
   const overall=(id:string)=>lineups.filter(p=>p.team_id===id).reduce((sum,p)=>sum+p.overall,0)/11;
   const markets=fixture.status==='scheduled'
    ?pregameMarkets(overall(fixture.home_team_id),overall(fixture.away_team_id))
    :liveMarkets(overall(fixture.home_team_id),overall(fixture.away_team_id),fixture.home_score,fixture.away_score,(MATCH_DURATION_MS-fixture.elapsed_ms)/MATCH_DURATION_MS);
   const market=markets[body.market as 'result'|'exactScore'];
   const quote=market.selections.find(s=>s.key===body.selection);
   if(!market.open||!quote||quote.probability<=0) throw new BadRequestException('Mercado fechado ou resultado indisponível.');
   if(quote.odd!==body.confirmedOdd) throw new ConflictException({message:'A odd mudou. Revise a nova cotação e confirme novamente.',code:'ODD_CHANGED',currentOdd:quote.odd});
   const count=await client.query('SELECT count(*) FROM bets WHERE user_id=$1 AND fixture_id=$2',[user.id,body.fixtureId]);
   if(Number(count.rows[0].count)>=10) throw new BadRequestException('Limite de 10 apostas aceitas nesta partida.');
   if(BigInt(wallet.balance_cents)<BigInt(stake)) throw new BadRequestException('Saldo disponível insuficiente.');
   const total=(BigInt(stake)*BigInt(quote.odd.replace('.',''))+50n)/100n;
   const balance=BigInt(wallet.balance_cents)-BigInt(stake),id=randomUUID();
   const result=await client.query(`INSERT INTO bets(id,user_id,fixture_id,market,selection,selection_label,stake_cents,accepted_odd,potential_return_cents,operation_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[id,user.id,body.fixtureId,body.market,body.selection,quote.label,body.stakeCents,quote.odd,total.toString(),body.operationKey]);
   await client.query('UPDATE wallets SET balance_cents=$2 WHERE user_id=$1',[user.id,balance.toString()]);
   await client.query(`INSERT INTO wallet_entries(id,user_id,kind,amount_cents,balance_after_cents,operation_key,bet_id,fixture_id,created_at)
    VALUES($1,$2,'bet',$3,$4,$5,$6,$7,clock_timestamp())`,[randomUUID(),user.id,-stake,balance.toString(),body.operationKey,id,body.fixtureId]);
   await client.query('COMMIT');
   return bet({...result.rows[0],home_team_name:fixture.home_team_name,away_team_name:fixture.away_team_name});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
}
@Controller('api/bets')
export class BetsController {
 constructor(private readonly bets:Bets) {}
 @Get() list(@Req() request:Request,@Query() filters:{fixtureId?:unknown;status?:unknown}){return this.bets.list(request,filters);}
 @Post() accept(@Req() request:Request,@Body() body:Parameters<Bets['accept']>[1]){return this.bets.accept(request,body);}
}
