import { Pool } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { migrateAuthentication } from './auth-migration';
import { hashPassword } from './password';
import { migrateTeams } from './teams-migration';

async function connectForStartup(pool: Pool) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await pool.connect();
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      const transient = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', '57P03'].includes(failure.code ?? '')
        || failure.message === 'Connection terminated due to connection timeout'
        || failure.message === 'Connection terminated unexpectedly';
      // Reserve enough time for the next normal connection attempt. Runtime
      // health checks keep their short timeout; no transaction is retried.
      const connectionTimeout = pool.options.connectionTimeoutMillis ?? 3000;
      if (!transient || Date.now() + 250 + connectionTimeout > deadline) throw error;
      await delay(250);
    }
  }
}

// One transaction prevents a partially seeded demonstration after an interruption.
export async function initializeDatabase(pool: Pool) {
  const client = await connectForStartup(pool);
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(942001)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY, display_name text NOT NULL, email text UNIQUE NOT NULL,
        password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('admin', 'bettor')),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS wallets (
        user_id text PRIMARY KEY REFERENCES users(id),
        balance_cents bigint NOT NULL CHECK (balance_cents >= 0)
      );
      CREATE TABLE IF NOT EXISTS wallet_entries (
        id text PRIMARY KEY, user_id text NOT NULL REFERENCES wallets(user_id),
        kind text NOT NULL, amount_cents bigint NOT NULL,
        balance_after_cents bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS teams (id text PRIMARY KEY, name text UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS players (
        id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams(id), name text NOT NULL,
        position text NOT NULL CHECK (position IN ('goleiro', 'defensor', 'meio-campista', 'atacante')),
        overall integer NOT NULL CHECK (overall BETWEEN 1 AND 100)
      );
      CREATE TABLE IF NOT EXISTS fixtures (
        id text PRIMARY KEY, home_team_id text NOT NULL REFERENCES teams(id),
        away_team_id text NOT NULL REFERENCES teams(id), scheduled_at timestamptz NOT NULL,
        status text NOT NULL CHECK (status IN ('scheduled', 'in_progress', 'finished', 'cancelled')),
        CHECK (home_team_id <> away_team_id)
      );
      CREATE TABLE IF NOT EXISTS fixture_lineups (
        fixture_id text NOT NULL REFERENCES fixtures(id), team_id text NOT NULL REFERENCES teams(id),
        player_id text NOT NULL REFERENCES players(id), name text NOT NULL, position text NOT NULL,
        overall integer NOT NULL CHECK (overall BETWEEN 1 AND 100),
        PRIMARY KEY (fixture_id, player_id)
      );
    `);
    await migrateAuthentication(client);
    await client.query(`ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS home_team_name text;
      ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS away_team_name text;`);
    for (const user of [
      { id: 'demo-admin', name: 'Administrador de demonstração', email: 'admin@betfake.local', role: 'admin', password: process.env.DEMO_ADMIN_PASSWORD ?? 'AdminDemo123!' },
      { id: 'demo-bettor', name: 'Apostador de demonstração', email: 'apostador@betfake.local', role: 'bettor', password: process.env.DEMO_BETTOR_PASSWORD ?? 'ApostadorDemo123!' },
    ]) {
      const existing = await client.query('SELECT id FROM users WHERE id = $1', [user.id]);
      if (!existing.rowCount) {
        if (user.password.length < 8) throw new Error('Demo passwords must contain at least 8 characters');
        await client.query('INSERT INTO users(id, display_name, email, role, password_hash) VALUES ($1,$2,$3,$4,$5)',
          [user.id, user.name, user.email, user.role, await hashPassword(user.password)]);
      }
    }
    const wallet = await client.query(`INSERT INTO wallets(user_id, balance_cents) VALUES ('demo-bettor', 10000) ON CONFLICT DO NOTHING RETURNING user_id`);
    if (wallet.rowCount) {
      await client.query(`INSERT INTO wallet_entries(id,user_id,kind,amount_cents,balance_after_cents) VALUES ('demo-initial-balance','demo-bettor','initial_balance',10000,10000)`);
    }
    const names = ['Aurora FC', 'Estrela do Sul', 'Atlético do Vale', 'União da Serra'];
    const positions = ['goleiro', 'defensor', 'defensor', 'defensor', 'defensor', 'meio-campista', 'meio-campista', 'meio-campista', 'atacante', 'atacante', 'atacante'];
    for (let team = 1; team <= 4; team++) {
      await client.query('INSERT INTO teams(id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [`demo-team-${team}`, names[team - 1]]);
      for (let player = 1; player <= 11; player++) {
        await client.query('INSERT INTO players(id,team_id,name,position,overall) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
          [`demo-player-${team}-${player}`, `demo-team-${team}`, `Jogador ${player} — ${names[team - 1]}`, positions[player - 1], 65 + team + player]);
      }
    }
    for (let fixture = 1; fixture <= 2; fixture++) {
      const home = `demo-team-${fixture * 2 - 1}`;
      const away = `demo-team-${fixture * 2}`;
      const inserted = await client.query(`INSERT INTO fixtures(id,home_team_id,away_team_id,scheduled_at,status,home_team_name,away_team_name)
        VALUES ($1,$2,$3,now() + $4 * interval '1 day','scheduled',
          (SELECT name FROM teams WHERE id=$2),(SELECT name FROM teams WHERE id=$3)) ON CONFLICT DO NOTHING RETURNING id`,
        [`demo-fixture-${fixture}`, home, away, fixture]);
      if (inserted.rowCount) {
        await client.query(`INSERT INTO fixture_lineups(fixture_id,team_id,player_id,name,position,overall)
          SELECT $1,team_id,id,name,position,overall FROM players WHERE team_id IN ($2,$3)`,
          [`demo-fixture-${fixture}`, home, away]);
      }
    }
    await migrateTeams(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Supported local maintenance command; never returns password hashes.
async function seedCommand() {
  const pool = new Pool();
  try {
    await initializeDatabase(pool);
    const accounts = await pool.query(`SELECT u.id,u.email,u.role,u.created_at,w.balance_cents
      FROM users u LEFT JOIN wallets w ON u.id = w.user_id WHERE u.id IN ('demo-admin','demo-bettor') ORDER BY u.id`);
    console.log(JSON.stringify({ accounts: accounts.rows }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  seedCommand().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
