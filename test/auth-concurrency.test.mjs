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

async function concurrentLoginWithDatabaseLatency() {
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const { createServer, connect } = require('node:net');
  const { createApplication } = require('./dist/main');
  const upstreamAddress = { host: process.env.PGHOST, port: Number(process.env.PGPORT) };
  const sockets = new Set();
  const timers = new Set();
  let delayEnabled = false;
  let delayedResponses = 0;
  const track = socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  const proxy = createServer(socket => {
    track(socket);
    const upstream = track(connect(upstreamAddress));
    let sql = false;
    socket.on('data', data => {
      // Q starts a simple query; P starts the extended Parse/Bind protocol
      // used for parameterized queries. Authentication is neither message.
      if (data[0] === 81 || data[0] === 80) sql = true;
      upstream.write(data);
    });
    upstream.on('data', data => {
      if (!delayEnabled || !sql) { socket.write(data); return; }
      delayedResponses++;
      const timer = setTimeout(() => { timers.delete(timer); socket.write(data); }, 650);
      timers.add(timer);
    });
    socket.once('close', () => upstream.destroy());
    upstream.once('close', () => socket.destroy());
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  process.env.PGHOST = '127.0.0.1';
  process.env.PGPORT = String(proxy.address().port);
  let app;
  try {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = (path, body) => fetch(base + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const user = { displayName: 'Latência', email: randomUUID() + '@example.com', password: 'Password123!' };
    assert.equal((await request('/api/auth/signup', user)).status, 201);
    // Initialization is complete. Only interactive SQL responses now incur
    // latency; no crypto delay, private SQL inspection or extended deadline.
    delayEnabled = true;
    const responses = await Promise.all(Array.from({ length: 5 }, () => request('/api/auth/login', { ...user, password: 'wrong' })));
    const statuses = responses.map(response => response.status).sort();
    console.log('delayed-database-login-statuses: ' + JSON.stringify(statuses));
    assert.ok(delayedResponses > 0, 'The database-boundary delay must actually be exercised');
    assert.deepEqual(statuses, [401, 401, 401, 401, 429]);
    assert.equal((await request('/api/auth/login', user)).status, 429);
    console.log('database-latency-concurrency-ok');
  } finally {
    if (app) await app.close();
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
  }
}

test('concurrent incorrect passwords lock the account despite database response latency', () => {
  const output = compose('exec', '-T', 'app', 'node', '-e', `(${concurrentLoginWithDatabaseLatency.toString()})().catch(error => { console.error(error); process.exitCode = 1; })`);
  assert.match(output, /database-latency-concurrency-ok/);
});
