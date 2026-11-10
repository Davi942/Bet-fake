import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
export async function request(path, body, cookie, origin) {
  return fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(10000),
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const credentials = () => ({ displayName: 'Nova apostadora', email: `${randomUUID()}@example.com`, password: 'Password123!' });

test('public signup creates a bettor with initial fictitious balance and rejects normalized duplicate emails', async () => {
  const user = credentials();
  const registered = await request('/api/auth/signup', user);
  assert.equal(registered.status, 201);
  assert.deepEqual(await registered.json(), { displayName: user.displayName, email: user.email, role: 'bettor' });
  const duplicate = await request('/api/auth/signup', { ...user, email: ` ${user.email.toUpperCase()} ` });
  assert.equal(duplicate.status, 409);
  const login = await request('/api/auth/login', { email: user.email, password: user.password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.equal((await (await request('/api/account', undefined, cookie)).json()).balanceCents, 10000);
});

test('signup validates required fields, password length and forbids administrative roles', async () => {
  for (const change of [{ displayName: ' ' }, { password: '1234567' }, { email: 'invalid' }, { role: 'admin' }]) {
    assert.equal((await request('/api/auth/signup', { ...credentials(), ...change })).status, 400);
  }
});

test('role boundaries, invalid sessions and logout are enforced by the HTTP API', async () => {
  assert.equal((await request('/api/auth/me')).status, 401);
  assert.equal((await request('/api/account')).status, 401);
  assert.equal((await request('/api/admin/overview')).status, 401);
  assert.equal((await request('/api/auth/me', undefined, 'bet_session=invalid')).status, 401);
  const admin = await request('/api/auth/login', { email: 'admin@betfake.local', password: process.env.DEMO_ADMIN_PASSWORD ?? 'AdminDemo123!' });
  assert.equal(admin.status, 200);
  const adminCookie = admin.headers.get('set-cookie');
  assert.equal((await request('/api/admin/overview', undefined, adminCookie)).status, 200);
  assert.equal((await request('/api/account', undefined, adminCookie)).status, 403);
  const user = credentials();
  await request('/api/auth/signup', user);
  const login = await request('/api/auth/login', user);
  const cookie = login.headers.get('set-cookie');
  assert.equal((await request('/api/admin/overview', undefined, cookie)).status, 403);
  assert.equal((await request('/api/demo', undefined, cookie)).status, 200);
  assert.equal((await request('/api/auth/me', undefined, cookie)).status, 200);
  const logout = await request('/api/auth/logout', {}, cookie);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request('/api/auth/me', undefined, cookie)).status, 401);
});

test('five consecutive failed logins block even the correct password', async () => {
  const user = credentials();
  await request('/api/auth/signup', user);
  for (let attempt = 1; attempt <= 5; attempt++) {
    assert.equal((await request('/api/auth/login', { ...user, password: 'wrong-password' })).status, attempt === 5 ? 429 : 401);
  }
  assert.equal((await request('/api/auth/login', user)).status, 429);
});

test('successful login resets the consecutive failure count', async () => {
  const user = credentials();
  await request('/api/auth/signup', user);
  for (let attempt = 0; attempt < 4; attempt++) await request('/api/auth/login', { ...user, password: 'wrong-password' });
  assert.equal((await request('/api/auth/login', user)).status, 200);
  for (let attempt = 0; attempt < 4; attempt++) assert.equal((await request('/api/auth/login', { ...user, password: 'wrong-password' })).status, 401);
  assert.equal((await request('/api/auth/login', user)).status, 200);
});

test('cross-origin mutations cannot create sessions, accounts or log out a user', async () => {
  const user = credentials();
  assert.equal((await request('/api/auth/signup', user, undefined, 'https://untrusted.example')).status, 403);
  await request('/api/auth/signup', user);
  assert.equal((await request('/api/auth/login', user, undefined, 'https://untrusted.example')).status, 403);
  const cookie = (await request('/api/auth/login', user)).headers.get('set-cookie');
  assert.equal((await request('/api/auth/logout', {}, cookie, 'https://untrusted.example')).status, 403);
  assert.equal((await request('/api/auth/me', undefined, cookie)).status, 200);
  assert.equal((await request('/api/auth/logout', {}, cookie, new URL(base).origin)).status, 200);
});
