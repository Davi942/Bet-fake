import assert from 'node:assert/strict';
import test from 'node:test';
import { compose } from './compose.mjs';

// Exercise the shipped entry point, with a TCP fault at the database boundary.
// The application already running in Compose and its HTTP port stay untouched.
async function startupAfterConnectionTimeout() {
  const { createServer, connect } = require('node:net');
  const { spawn } = require('node:child_process');
  const assert = require('node:assert/strict');
  const sockets = new Set();
  const track = socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  let connections = 0;
  const proxy = createServer(socket => {
    track(socket);
    connections += 1;
    // Leave the first handshake unanswered until the real client times out.
    if (connections === 1) return;
    const upstream = track(connect({ host: process.env.PGHOST, port: Number(process.env.PGPORT) }));
    socket.pipe(upstream).pipe(socket);
    socket.once('close', () => upstream.destroy());
    upstream.once('close', () => socket.destroy());
  });
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  let logs = '';
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, PORT: String(port), PGHOST: '127.0.0.1', PGPORT: String(proxy.address().port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const safeLogs = () => process.env.PGPASSWORD ? logs.replaceAll(process.env.PGPASSWORD, '<REDACTED>') : logs;
  try {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, `Production bootstrap exited before readiness:\n${safeLogs()}`);
      let response;
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
      } catch { /* The HTTP listener starts only after database initialization. */ }
      if (response?.ok) {
        assert.deepEqual(await response.json(), { status: 'ok', database: 'up' });
        assert.ok(connections > 1, 'Readiness must recover after the unanswered first PostgreSQL handshake');
        console.log(JSON.stringify({ status: 'ok', connections }));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`Production bootstrap did not become ready after the transient timeout:\n${safeLogs()}`);
  } finally {
    child.kill('SIGKILL');
    await closed;
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
  }
}

test('production bootstrap becomes healthy after a transient PostgreSQL connection timeout', () => {
  const output = compose('exec', '-T', 'app', 'node', '-e', `(${startupAfterConnectionTimeout.toString()})().catch(error => { console.error(error); process.exitCode = 1; })`);
  const result = JSON.parse(output.trim());
  assert.equal(result.status, 'ok');
  assert.ok(result.connections > 1);
});

async function startupAfterSlowQuery() {
  const { createServer, connect } = require('node:net');
  const { spawn } = require('node:child_process');
  const assert = require('node:assert/strict');
  const sockets = new Set();
  const track = socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  let delayedQueries = 0;
  let delayNextQuery = true;
  let release;
  const proxy = createServer(socket => {
    track(socket);
    const upstream = track(connect({ host: process.env.PGHOST, port: Number(process.env.PGPORT) }));
    let waiting = false;
    const held = [];
    socket.on('data', data => {
      // Q is PostgreSQL's simple-query message. Authentication packets pass
      // unchanged; delay the first SQL response without inspecting SQL text.
      if (delayNextQuery && data[0] === 81) {
        delayNextQuery = false;
        delayedQueries++;
        waiting = true;
        release = setTimeout(() => {
          waiting = false;
          for (const packet of held) socket.write(packet);
        }, 6000);
      }
      upstream.write(data);
    });
    upstream.on('data', data => waiting ? held.push(data) : socket.write(data));
    socket.once('close', () => upstream.destroy());
    upstream.once('close', () => socket.destroy());
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  let logs = '';
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, PORT: String(port), PGHOST: '127.0.0.1', PGPORT: String(proxy.address().port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const safeLogs = () => process.env.PGPASSWORD ? logs.replaceAll(process.env.PGPASSWORD, '<REDACTED>') : logs;
  try {
    const started = Date.now();
    while (Date.now() - started < 25_000) {
      assert.equal(child.exitCode, null, `Production bootstrap exited during slow initialization SQL:\n${safeLogs()}`);
      let response;
      try { response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }); }
      catch { /* The listener opens after the seed completes. */ }
      if (response?.ok) {
        assert.deepEqual(await response.json(), { status: 'ok', database: 'up' });
        assert.equal(delayedQueries, 1, 'The SQL delay must have been exercised');
        assert.ok(Date.now() - started >= 6000, 'Readiness must wait for the delayed SQL response');
        delayNextQuery = true;
        const unavailable = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(15000) });
        assert.equal(unavailable.status, 503, 'Runtime SQL must retain its shorter deadline');
        assert.deepEqual(await unavailable.json().then(({ status, database }) => ({ status, database })), { status: 'unavailable', database: 'down' });
        const recovered = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(15000) });
        assert.equal(recovered.status, 200);
        assert.equal(delayedQueries, 2);
        console.log(JSON.stringify({ status: 'ok', delayedQueries, runtimeStatus: unavailable.status }));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`Production bootstrap never became ready after slow initialization SQL:\n${safeLogs()}`);
  } finally {
    clearTimeout(release);
    child.kill('SIGKILL');
    await closed;
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
  }
}

test('production bootstrap tolerates slow initialization SQL without changing runtime query deadlines', () => {
  const output = compose('exec', '-T', 'app', 'node', '-e', `(${startupAfterSlowQuery.toString()})().catch(error => { console.error(error); process.exitCode = 1; })`);
  const result = JSON.parse(output.trim());
  assert.equal(result.status, 'ok');
  assert.equal(result.delayedQueries, 2);
  assert.equal(result.runtimeStatus, 503);
});
