import { Controller, Get, Injectable, Req } from '@nestjs/common';
import { Auth } from './auth';
import { Database } from './database';

type Request = { headers: Record<string, string | undefined> };

@Injectable()
export class AdminFinance {
 constructor(private readonly db: Database) {}

 async read() {
  // One statement gives every number the same committed PostgreSQL snapshot.
  const row = (await this.db.pool.query(`WITH stakes AS (
    SELECT COALESCE(sum(b.stake_cents),0) AS total,
      COALESCE(sum(b.stake_cents) FILTER (WHERE b.status='pending'),0) AS pending,
      COALESCE(sum(b.stake_cents) FILTER (WHERE f.status='finished'),0) AS finished_stakes
    FROM bets b JOIN fixtures f ON f.id=b.fixture_id
   ), movements AS (
    SELECT COALESCE(sum(e.amount_cents) FILTER (WHERE e.kind='payout'),0) AS paid,
      COALESCE(sum(e.amount_cents) FILTER (WHERE e.kind='refund'),0) AS refunded,
      COALESCE(sum(e.amount_cents) FILTER (WHERE e.kind='payout' AND f.status='finished'),0) AS finished_paid
    FROM wallet_entries e LEFT JOIN fixtures f ON f.id=e.fixture_id
   ), matches AS (
    SELECT count(*) FILTER (WHERE status='scheduled') AS scheduled,
      count(*) FILTER (WHERE status='in_progress') AS in_progress,
      count(*) FILTER (WHERE status='finished') AS finished_count,
      count(*) FILTER (WHERE status='cancelled') AS cancelled FROM fixtures
   ) SELECT stakes.*,movements.*,matches.* FROM stakes,movements,matches`)).rows[0];
  return {
   totalStakedCents:Number(row.total),paidReturnsCents:Number(row.paid),
   refundsCents:Number(row.refunded),pendingCents:Number(row.pending),
   houseResultCents:Number(BigInt(row.finished_stakes)-BigInt(row.finished_paid)),
   fixtures:{scheduled:Number(row.scheduled),inProgress:Number(row.in_progress),finished:Number(row.finished_count),cancelled:Number(row.cancelled)},
  };
 }
}

@Controller('api/admin/finance')
export class AdminFinanceController {
 constructor(private readonly finance:AdminFinance,private readonly auth:Auth) {}
 @Get() async read(@Req() request:Request) {
  await this.auth.authenticate(request,'admin');
  return this.finance.read();
 }
}
