import assert from 'node:assert/strict';
import test from 'node:test';
import { compose } from './compose.mjs';

test('five concurrent incorrect passwords lock the account even when password verification is slow', () => {
  const result = compose('exec', '-T', 'app', 'node', '-e', `
    const assert = require('node:assert/strict');
    const { randomUUID } = require('node:crypto');
    const { setTimeout: delay } = require('node:timers/promises');
    const { createApplication } = require('./dist/main');
    const { verifyPassword } = require('./dist/password');
    (async () => {
      let delayedVerifications = 0;
      const app = await createApplication({
        verifyPassword: async (password, hash) => {
          // Model slow crypto without changing the real password comparison or SQL timeouts.
          delayedVerifications += 1;
          await delay(1500);
          return verifyPassword(password, hash);
        },
      });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const request = body => fetch(base + '/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      try {
        const user = { displayName: 'Concurrent bettor', email: randomUUID() + '@example.com', password: 'Password123!' };
        const signup = await fetch(base + '/api/auth/signup', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(user),
        });
        assert.equal(signup.status, 201);
        const responses = await Promise.all(Array.from({ length: 5 }, () => request({ ...user, password: 'wrong' })));
        const statuses = responses.map(response => response.status).sort();
        assert.ok(delayedVerifications > 0, 'The controlled crypto delay must actually be exercised');
        console.log('concurrent-login-statuses: ' + JSON.stringify(statuses));
        assert.deepEqual(statuses, [401, 401, 401, 401, 429]);
        const blocked = await request(user);
        assert.equal(blocked.status, 429);
        assert.ok(Number(blocked.headers.get('retry-after')) > 0);
        assert.ok(Number(blocked.headers.get('retry-after')) <= 900);
        assert.equal(blocked.headers.get('set-cookie'), null);
        console.log('slow-password-concurrency-ok');
      } finally { await app.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
  assert.match(result, /slow-password-concurrency-ok/);
});
