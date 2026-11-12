import { PoolClient } from 'pg';

export async function migrateWallet(client: PoolClient) {
  await client.query(`
    ALTER TABLE wallet_entries ADD COLUMN IF NOT EXISTS sequence bigserial;
    ALTER TABLE wallet_entries ADD COLUMN IF NOT EXISTS operation_key text;
    ALTER TABLE wallet_entries ADD COLUMN IF NOT EXISTS bet_id text;
    ALTER TABLE wallet_entries ADD COLUMN IF NOT EXISTS fixture_id text REFERENCES fixtures(id);
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_operation_key ON wallet_entries(user_id,operation_key);
    CREATE INDEX IF NOT EXISTS wallet_statement_order ON wallet_entries(user_id,sequence DESC);
    CREATE OR REPLACE FUNCTION immutable_wallet_entry() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Wallet entries are immutable'; END;
    $$;
    DROP TRIGGER IF EXISTS immutable_wallet_entry ON wallet_entries;
    CREATE TRIGGER immutable_wallet_entry BEFORE UPDATE OR DELETE ON wallet_entries
      FOR EACH ROW EXECUTE FUNCTION immutable_wallet_entry();
  `);
}
