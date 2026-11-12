import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpException, Injectable, Post, Req, Res, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { sign, verify } from 'jsonwebtoken';
import { Database } from './database';
import { hashPassword, verifyPassword } from './password';

interface Request { headers: Record<string, string | undefined>; }
interface Response { setHeader(name: string, value: string): void; }
interface User { id: string; display_name: string; email: string; role: 'bettor' | 'admin'; password_hash: string; }
interface LoginUser extends User { failed_login_attempts: number; locked_until: Date | null; }
interface Claims { sub: string; jti: string; iat: number; exp: number; }

@Injectable()
export class Clock { now = () => Date.now(); }

@Injectable()
export class PasswordVerification { verify = verifyPassword; }

function input(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Dados inválidos.');
  return body as Record<string, unknown>;
}
function credentials(body: Record<string, unknown>) {
  if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || body.email.length > 254 ||
      typeof body.password !== 'string' || body.password.length > 1024) throw new BadRequestException('E-mail ou senha inválidos.');
  return { email: body.email.trim().toLowerCase(), password: body.password };
}
function publicUser(user: User) { return { displayName: user.display_name, email: user.email, role: user.role }; }

@Injectable()
export class Auth {
  constructor(private readonly db: Database, private readonly clock: Clock, private readonly passwords: PasswordVerification) {}

  async signup(raw: unknown) {
    const body = input(raw);
    const { email, password } = credentials(body);
    if ('role' in body && body.role !== 'bettor') throw new BadRequestException('Cadastro público permite apenas apostadores.');
    if (typeof body.displayName !== 'string' || !body.displayName.trim() || body.displayName.trim().length > 100 || password.length < 8) {
      throw new BadRequestException('Informe um nome e senha com pelo menos 8 caracteres.');
    }
    const id = randomUUID();
    const hash = await hashPassword(password);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`INSERT INTO users(id,display_name,email,password_hash,role) VALUES($1,$2,$3,$4,'bettor') RETURNING *`, [id, body.displayName.trim(), email, hash]);
      await client.query('INSERT INTO wallets(user_id,balance_cents) VALUES($1,10000)', [id]);
      await client.query(`INSERT INTO wallet_entries(id,user_id,kind,amount_cents,balance_after_cents) VALUES($1,$2,'initial_balance',10000,10000)`, [randomUUID(), id]);
      await client.query('COMMIT');
      return publicUser(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as {code?: string}).code === '23505') throw new ConflictException('E-mail já cadastrado.');
      throw error;
    } finally { client.release(); }
  }

  private async key(): Promise<string> {
    await this.db.pool.query('INSERT INTO auth_signing_key(singleton,secret) VALUES(true,$1) ON CONFLICT DO NOTHING', [randomBytes(32).toString('hex')]);
    return (await this.db.pool.query('SELECT secret FROM auth_signing_key WHERE singleton=true')).rows[0].secret;
  }

  async login(raw: unknown, response: Response) {
    const { email, password } = credentials(input(raw));
    const user = await this.checkCredentials(email, password, response);
    const issued = Math.floor(this.clock.now() / 1000);
    const claims: Claims = { sub: user.id, jti: randomUUID(), iat: issued, exp: issued + 3600 };
    const token = sign(claims, await this.key(), { algorithm: 'HS256' });
    await this.db.pool.query('INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,$3)', [claims.jti, user.id, new Date(claims.exp * 1000)]);
    response.setHeader('Set-Cookie', `bet_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`);
    return publicUser(user);
  }

  private async checkCredentials(email: string, password: string, response: Response): Promise<User> {
    const blocked = (until: number, now: number) => {
      const seconds = Math.ceil((until - now) / 1000);
      response.setHeader('Retry-After', String(seconds));
      return new HttpException({ message: 'Conta bloqueada por 15 minutos após cinco tentativas incorretas.', retryAfterSeconds: seconds }, 429);
    };
    const snapshot: LoginUser | undefined = (await this.db.pool.query('SELECT * FROM users WHERE lower(btrim(email))=$1', [email])).rows[0];
    if (!snapshot) throw new UnauthorizedException('E-mail ou senha incorretos.');
    const started = this.clock.now();
    if (snapshot.locked_until && snapshot.locked_until.getTime() > started) throw blocked(snapshot.locked_until.getTime(), started);
    // Crypto can be slow. Do not hold a database connection or account lock while it runs.
    const matches = await this.passwords.verify(password, snapshot.password_hash);
    const now = this.clock.now();
    // Autocommit releases the account lock before the response crosses the
    // network. PostgreSQL rechecks the hash/lock predicate after concurrent writes.
    const result = await this.db.pool.query(`UPDATE users SET
      failed_login_attempts = CASE WHEN $3::boolean THEN 0 WHEN locked_until IS NOT NULL THEN 1 ELSE failed_login_attempts + 1 END,
      locked_until = CASE WHEN $3::boolean THEN NULL
        WHEN (CASE WHEN locked_until IS NOT NULL THEN 0 ELSE failed_login_attempts END) + 1 >= 5 THEN $5::timestamptz
        ELSE NULL END
      WHERE id=$1 AND password_hash=$2 AND (locked_until IS NULL OR locked_until <= $4::timestamptz)
      RETURNING *`, [snapshot.id, snapshot.password_hash, matches, new Date(now), new Date(now + 15 * 60 * 1000)]);
    const user: LoginUser | undefined = result.rows[0];
    if (user) {
      if (user.locked_until) throw blocked(user.locked_until.getTime(), now);
      if (!matches) throw new UnauthorizedException('E-mail ou senha incorretos.');
      return user;
    }
    const latest: LoginUser | undefined = (await this.db.pool.query('SELECT * FROM users WHERE id=$1', [snapshot.id])).rows[0];
    if (latest?.locked_until && latest.locked_until.getTime() > now) throw blocked(latest.locked_until.getTime(), now);
    throw new UnauthorizedException('E-mail ou senha incorretos.');
  }

  async authenticate(request: Request, role?: User['role']): Promise<{ user: User; claims: Claims }> {
    try {
      const token = request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('bet_session='))?.slice(12);
      if (!token) throw new Error();
      const claims = verify(token, await this.key(), { algorithms: ['HS256'], clockTimestamp: Math.floor(this.clock.now() / 1000) }) as Claims;
      if (!Number.isInteger(claims.exp) || claims.exp * 1000 <= this.clock.now()) throw new Error();
      const result = await this.db.pool.query(`SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE s.id=$1 AND u.id=$2 AND s.expires_at>$3`, [claims.jti, claims.sub, new Date(this.clock.now())]);
      if (!result.rowCount) throw new Error();
      const user: User = result.rows[0];
      if (role && user.role !== role) throw new ForbiddenException('Seu perfil não tem acesso a esta área.');
      return { user, claims };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException('Sessão inválida ou expirada. Entre novamente e revise a ação.');
    }
  }

  async account(request: Request) {
    const { user } = await this.authenticate(request, 'bettor');
    const wallet = await this.db.pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [user.id]);
    return { ...publicUser(user), balanceCents: Number(wallet.rows[0].balance_cents) };
  }
  async logout(request: Request, response: Response) {
    const { claims } = await this.authenticate(request);
    await this.db.pool.query('DELETE FROM auth_sessions WHERE id=$1', [claims.jti]);
    response.setHeader('Set-Cookie', 'bet_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return { message: 'Sessão encerrada.' };
  }
}

@Controller('api')
export class AuthController {
  constructor(private readonly auth: Auth) {}
  @Post('auth/signup') signup(@Body() body: unknown) { return this.auth.signup(body); }
  @Post('auth/login') @HttpCode(200) login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) { return this.auth.login(body, response); }
  @Get('auth/me') async me(@Req() request: Request) { return publicUser((await this.auth.authenticate(request)).user); }
  @Post('auth/logout') @HttpCode(200) logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) { return this.auth.logout(request, response); }
  @Get('account') account(@Req() request: Request) { return this.auth.account(request); }
  @Get('admin/overview') async admin(@Req() request: Request) { const { user } = await this.auth.authenticate(request, 'admin'); return { user: publicUser(user), message: 'Área administrativa' }; }
}
