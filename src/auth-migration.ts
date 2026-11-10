import { PoolClient } from 'pg';

// Additive and repeatable: existing accounts, passwords and balances survive.
export async function migrateAuthentication(client: PoolClient) {
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_normalized_email ON users (lower(btrim(email)));
    CREATE TABLE IF NOT EXISTS auth_signing_key (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), secret text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL
    );
  `);
}
