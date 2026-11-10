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
  constructor(private readonly db: Database, private readonly clock: Clock) {}

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
    const client = await this.db.pool.connect();
    let transaction = false;
    try {
      await client.query('BEGIN');
      transaction = true;
      // Lock this account so concurrent attempts cannot bypass the five-attempt limit.
      const result = await client.query('SELECT * FROM users WHERE lower(btrim(email))=$1 FOR UPDATE', [email]);
      const user: LoginUser | undefined = result.rows[0];
      const now = this.clock.now();
      let failure: UnauthorizedException | HttpException | undefined;
      const blocked = (until: number) => {
        const seconds = Math.ceil((until - now) / 1000);
        response.setHeader('Retry-After', String(seconds));
        return new HttpException({ message: 'Conta bloqueada por 15 minutos após cinco tentativas incorretas.', retryAfterSeconds: seconds }, 429);
      };
      if (!user) failure = new UnauthorizedException('E-mail ou senha incorretos.');
      else if (user.locked_until && user.locked_until.getTime() > now) failure = blocked(user.locked_until.getTime());
      else if (!await verifyPassword(password, user.password_hash)) {
        const attempts = (user.locked_until ? 0 : user.failed_login_attempts) + 1;
        const until = attempts >= 5 ? new Date(now + 15 * 60 * 1000) : null;
        await client.query('UPDATE users SET failed_login_attempts=$2,locked_until=$3 WHERE id=$1', [user.id, attempts, until]);
        failure = until ? blocked(until.getTime()) : new UnauthorizedException('E-mail ou senha incorretos.');
      } else await client.query('UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE id=$1', [user.id]);
      await client.query('COMMIT');
      transaction = false;
      if (failure) throw failure;
      return user!;
    } catch (error) {
      if (transaction) await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
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
