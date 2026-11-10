import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('.env.example documents configurable and supplied runtime environment variables', async () => {
  const example = await readFile('.env.example', 'utf8');
  for (const variable of [
    'APP_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD',
    'DEMO_ADMIN_PASSWORD', 'DEMO_BETTOR_PASSWORD', 'PORT',
    'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
    'NODE_ENV', 'TEST_BASE_URL',
  ]) {
    assert.match(example, new RegExp(`^#? ?${variable}=`, 'm'), `${variable} must have a documented example`);
  }
});
