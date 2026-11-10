import 'reflect-metadata';
import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { Database } from './database';
import { initializeDatabase } from './seed';
import { Auth, AuthController, Clock } from './auth';

@Controller('api')
class ApiController {
  constructor(private readonly database: Database) {}

  @Get('demo')
  async demo() {
    const teams = await this.database.pool.query("SELECT id,name FROM teams WHERE id LIKE 'demo-team-%' ORDER BY id");
    const fixtures = await this.database.pool.query(`SELECT id,home_team_id AS "homeTeamId",
      away_team_id AS "awayTeamId",scheduled_at AS "scheduledAt",status FROM fixtures WHERE id LIKE 'demo-fixture-%' ORDER BY id`);
    const lineups = await this.database.pool.query(`SELECT fixture_id AS "fixtureId",team_id AS "teamId",
      player_id AS "playerId",name,position,overall FROM fixture_lineups WHERE fixture_id LIKE 'demo-fixture-%' ORDER BY player_id`);
    return { teams: teams.rows, fixtures: fixtures.rows.map(fixture => ({
      ...fixture, lineups: lineups.rows.filter(player => player.fixtureId === fixture.id),
    })) };
  }

  @Get('health')
  async health() {
    try {
      await this.database.pool.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'down' });
    }
  }
}

@Module({ controllers: [ApiController, AuthController], providers: [Database, Auth, Clock] })
class AppModule {}

export async function createApplication(options: { now?: () => number } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  if (options.now) app.get(Clock).now = options.now;
  app.use('/api', (request: { method: string; protocol: string; headers: Record<string, string | undefined> }, response: { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void } }, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      const expected = `${request.protocol}://${request.headers.host}`;
      if ((origin !== undefined && origin !== expected) || request.headers['sec-fetch-site'] === 'cross-site') {
        response.status(403).json({ message: 'Origem da solicitação não permitida.' });
        return;
      }
    }
    next();
  });
  await initializeDatabase(app.get(Database).pool);
  app.useStaticAssets(join(process.cwd(), 'public'));
  return app;
}

if (require.main === module) createApplication().then(app => app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0')).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
