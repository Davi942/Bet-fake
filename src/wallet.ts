import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Auth } from './auth';
import { Database } from './database';

interface Request { headers: Record<string, string | undefined>; }
interface EntryRow {
  id: string; kind: string; amount_cents: string; balance_after_cents: string; created_at: Date;
  bet_id: string | null; fixture_id: string | null;
}
function entry(row: EntryRow) {
  return { id: row.id, kind: row.kind, amountCents: Number(row.amount_cents),
    balanceAfterCents: Number(row.balance_after_cents), createdAt: row.created_at,
    betId: row.bet_id, fixtureId: row.fixture_id };
}

@Injectable()
export class Wallet {
  constructor(private readonly db: Database, private readonly auth: Auth) {}

  async read(request: Request) {
    const { user } = await this.auth.authenticate(request, 'bettor');
    // A single statement gives balance and history the same PostgreSQL snapshot.
    const result = await this.db.pool.query(`SELECT w.balance_cents,e.* FROM wallets w
      JOIN wallet_entries e ON e.user_id=w.user_id WHERE w.user_id=$1 ORDER BY e.sequence DESC`, [user.id]);
    return { balanceCents: Number(result.rows[0].balance_cents), entries: result.rows.map(entry) };
  }

  async operate(request: Request, raw: unknown) {
    const { user } = await this.auth.authenticate(request, 'bettor');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Operação inválida.');
    const body = raw as Record<string, unknown>;
    if (typeof body.kind !== 'string' || !['deposit', 'withdrawal'].includes(body.kind) || !Number.isSafeInteger(body.amountCents) ||
        (body.amountCents as number) < 100 || (body.kind === 'deposit' && (body.amountCents as number) > 100000)) {
      throw new BadRequestException('Depósito: R$ 1,00 a R$ 1.000,00. Saque: a partir de R$ 1,00, dentro do saldo disponível. Informe centavos inteiros.');
    }
    if (typeof body.operationKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.operationKey)) {
      throw new BadRequestException('Identificador da operação inválido.');
    }
    const amount = body.kind === 'withdrawal' ? -BigInt(body.amountCents as number) : BigInt(body.amountCents as number);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const wallet = await client.query('SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE', [user.id]);
      const previous = await client.query('SELECT * FROM wallet_entries WHERE user_id=$1 AND operation_key=$2', [user.id, body.operationKey]);
      if (previous.rowCount) {
        const movement = previous.rows[0];
        if (movement.kind !== body.kind || BigInt(movement.amount_cents) !== amount) {
          throw new ConflictException('Identificador já usado para outra operação. Revise os dados.');
        }
        await client.query('COMMIT');
        return entry(movement);
      }
      const balance = BigInt(wallet.rows[0].balance_cents) + amount;
      if (balance < 0n) throw new BadRequestException('Saldo disponível insuficiente.');
      if (balance > BigInt(Number.MAX_SAFE_INTEGER)) throw new BadRequestException('Valor excede a representação monetária suportada.');
      await client.query('UPDATE wallets SET balance_cents=$2 WHERE user_id=$1', [user.id, balance.toString()]);
      const movement = await client.query(`INSERT INTO wallet_entries(id,user_id,kind,amount_cents,balance_after_cents,operation_key,created_at)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) RETURNING *`,
      [randomUUID(), user.id, body.kind, amount.toString(), balance.toString(), body.operationKey]);
      await client.query('COMMIT');
      return entry(movement.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

@Controller('api/wallet')
export class WalletController {
  constructor(private readonly wallet: Wallet) {}
  @Get() read(@Req() request: Request) { return this.wallet.read(request); }
  @Post('operations') operate(@Req() request: Request, @Body() body: unknown) { return this.wallet.operate(request, body); }
}
