import { PoolClient } from 'pg';

export async function migrateBets(client: PoolClient) {
 await client.query(`CREATE TABLE IF NOT EXISTS bets (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES wallets(user_id),
  fixture_id text NOT NULL REFERENCES fixtures(id), market text NOT NULL,
  selection text NOT NULL, selection_label text NOT NULL,
  stake_cents bigint NOT NULL CHECK (stake_cents BETWEEN 100 AND 10000),
  accepted_odd numeric(20,2) NOT NULL, potential_return_cents bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending', operation_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(user_id,operation_key)
 );
 CREATE INDEX IF NOT EXISTS bets_owner_fixture ON bets(user_id,fixture_id);
 CREATE INDEX IF NOT EXISTS bets_history ON bets(user_id,created_at DESC,id);
 `);
}
