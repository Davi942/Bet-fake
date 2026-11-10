import assert from 'node:assert/strict';
import test from 'node:test';
import { compose } from './compose.mjs';

const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

test('health confirms a real PostgreSQL connection', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'up' });
});

test('health returns HTTP 503 while PostgreSQL is stopped and recovers after it starts', async () => {
  try {
    compose('stop', 'db');
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable', database: 'down' });
  } finally {
    compose('up', '-d', '--wait', '--wait-timeout', '120');
  }
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
});
