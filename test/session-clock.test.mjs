import assert from 'node:assert/strict';
import test from 'node:test';
import { compose } from './compose.mjs';

// The clock is injected only when constructing an independent application.
// All observations go through HTTP; the production server has no test routes.
test('HTTP sessions expire exactly at one hour and account lock ends at fifteen minutes', () => {
  const result = compose('exec', '-T', 'app', 'node', '-e', `
    const assert = require('node:assert/strict');
    const { randomUUID } = require('node:crypto');
    const { createApplication } = require('./dist/main');
    (async () => {
      let now = Date.now();
      const app = await createApplication({ now: () => now });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const request = (path, body, cookie) => fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      try {
        const user = { displayName: 'Relógio', email: randomUUID() + '@example.com', password: 'Password123!' };
        assert.equal((await request('/api/auth/signup', user)).status, 201);
        now = Math.floor(now / 1000) * 1000;
        const login = await request('/api/auth/login', user);
        assert.equal(login.status, 200);
        const cookie = login.headers.get('set-cookie');
        now += 3599999;
        assert.equal((await request('/api/account', undefined, cookie)).status, 200);
        now += 1;
        assert.equal((await request('/api/account', undefined, cookie)).status, 401);
        assert.equal((await request('/api/auth/logout', {}, cookie)).status, 401);
        const fresh = await request('/api/auth/login', user);
        assert.equal(fresh.status, 200);
        assert.equal((await request('/api/account', undefined, cookie)).status, 401);
        assert.equal((await request('/api/account', undefined, fresh.headers.get('set-cookie'))).status, 200);
        for (let i = 1; i <= 5; i++) {
          assert.equal((await request('/api/auth/login', { ...user, password: 'wrong' })).status, i === 5 ? 429 : 401);
        }
        now += 899999;
        assert.equal((await request('/api/auth/login', user)).status, 429);
        now += 1;
        assert.equal((await request('/api/auth/login', user)).status, 200);
        const failures = await Promise.all(Array.from({ length: 5 }, () => request('/api/auth/login', { ...user, password: 'wrong' })));
        assert.deepEqual(failures.map(r => r.status).sort(), [401,401,401,401,429]);
        assert.equal((await request('/api/auth/login', user)).status, 429);
        console.log('clock-boundaries-ok');
      } finally { await app.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
  assert.match(result, /clock-boundaries-ok/);
});
