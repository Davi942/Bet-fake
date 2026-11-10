import 'reflect-metadata';
import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { Database } from './database';
import { initializeDatabase } from './seed';

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

@Module({ controllers: [ApiController], providers: [Database] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  await initializeDatabase(app.get(Database).pool);
  app.useStaticAssets(join(process.cwd(), 'public'));
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
