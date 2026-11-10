import { PoolClient } from 'pg';
// Called after the demo seed in its transaction; the marker preserves user changes on restart.
export async function migrateTeams(client: PoolClient) {
 await client.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
 ALTER TABLE players ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
 CREATE TABLE IF NOT EXISTS current_lineups (
 team_id text NOT NULL REFERENCES teams(id), player_id text PRIMARY KEY REFERENCES players(id));
 CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY);`);
 const first = await client.query("INSERT INTO schema_migrations(name) VALUES('current-lineups-v1') ON CONFLICT DO NOTHING RETURNING name");
 if (first.rowCount) await client.query(`INSERT INTO current_lineups(team_id,player_id)
 SELECT team_id,id FROM players WHERE id LIKE 'demo-player-%' AND archived=false
 AND team_id IN (SELECT id FROM teams WHERE archived=false) ON CONFLICT DO NOTHING`);
 await client.query(`ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS home_team_name text;
 ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS away_team_name text;
 UPDATE fixtures f SET home_team_name=t.name FROM teams t WHERE f.home_team_id=t.id AND f.home_team_name IS NULL;
 UPDATE fixtures f SET away_team_name=t.name FROM teams t WHERE f.away_team_id=t.id AND f.away_team_name IS NULL;
 ALTER TABLE fixtures ALTER COLUMN home_team_name SET NOT NULL;
 ALTER TABLE fixtures ALTER COLUMN away_team_name SET NOT NULL;`);
}
