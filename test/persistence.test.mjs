import assert from 'node:assert/strict';
import test from 'node:test';
import { compose } from './compose.mjs';

const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const seed = () => JSON.parse(compose('exec', '-T', 'app', 'node', 'dist/seed.js'));

test('seed preserves demo accounts and wallets through repeated runs', () => {
  const before = seed();
  assert.deepEqual(before.accounts.map(({ email, role, balance_cents }) => ({ email, role, balance_cents })), [
    { email: 'admin@betfake.local', role: 'admin', balance_cents: null },
    { email: 'apostador@betfake.local', role: 'bettor', balance_cents: '10000' },
  ]);
  assert.deepEqual(seed(), before);
});

test('normal stop and start preserve stored fixture dates and lineups and existing accounts', async () => {
  const accounts = seed();
  const before = await fetch(`${baseUrl}/api/demo`).then(response => response.json());
  compose('down');
  compose('up', '-d', '--wait', '--wait-timeout', '120');
  const after = await fetch(`${baseUrl}/api/demo`).then(response => response.json());
  assert.deepEqual(after, before);
  assert.deepEqual(seed(), accounts);
});
