import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
async function request(path, body, cookie) {
  return fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function bettor() {
  const user = { displayName: 'Carteira', email: `${randomUUID()}@example.com`, password: 'Password123!' };
  assert.equal((await request('/api/auth/signup', user)).status, 201);
  const login = await request('/api/auth/login', user);
  assert.equal(login.status, 200);
  return login.headers.get('set-cookie');
}

test('new bettor sees initial fictitious balance and dated immutable statement', async () => {
  const cookie = await bettor();
  const response = await request('/api/wallet', undefined, cookie);
  assert.equal(response.status, 200);
  const wallet = await response.json();
  assert.equal(wallet.balanceCents, 10000);
  assert.equal(wallet.entries.length, 1);
  assert.equal(wallet.entries[0].kind, 'initial_balance');
  assert.equal(wallet.entries[0].amountCents, 10000);
  assert.equal(wallet.entries[0].balanceAfterCents, 10000);
  assert.ok(Number.isFinite(Date.parse(wallet.entries[0].createdAt)));
  const update = await fetch(`${base}/api/wallet/entries/${wallet.entries[0].id}`, {
    method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ amountCents: 99999 }),
  });
  assert.equal(update.status, 404);
  assert.deepEqual(await (await request('/api/wallet', undefined, cookie)).json(), wallet);
});

test('simulated deposits and withdrawals keep exact cents and append resulting balances', async () => {
  const cookie = await bettor();
  const initial = (await (await request('/api/wallet', undefined, cookie)).json()).entries[0];
  const deposit = await request('/api/wallet/operations', { kind: 'deposit', amountCents: 123, operationKey: randomUUID() }, cookie);
  assert.equal(deposit.status, 201);
  const withdrawal = await request('/api/wallet/operations', { kind: 'withdrawal', amountCents: 10001, operationKey: randomUUID() }, cookie);
  assert.equal(withdrawal.status, 201);
  const wallet = await (await request('/api/wallet', undefined, cookie)).json();
  assert.equal(wallet.balanceCents, 122);
  assert.deepEqual(wallet.entries.map(({ kind, amountCents, balanceAfterCents }) => ({ kind, amountCents, balanceAfterCents })), [
    { kind: 'withdrawal', amountCents: -10001, balanceAfterCents: 122 },
    { kind: 'deposit', amountCents: 123, balanceAfterCents: 10123 },
    { kind: 'initial_balance', amountCents: 10000, balanceAfterCents: 10000 },
  ]);
  assert.deepEqual(wallet.entries[2], initial);
  assert.equal((await (await request('/api/account', undefined, cookie)).json()).balanceCents, 122);
});

test('repeated concurrent operations and later retries move money once and reject a changed payload', async () => {
  const cookie = await bettor();
  const operation = { kind: 'deposit', amountCents: 1000, operationKey: randomUUID() };
  const responses = await Promise.all(Array.from({ length: 8 }, () => request('/api/wallet/operations', operation, cookie)));
  assert.deepEqual(responses.map(response => response.status), Array(8).fill(201));
  const movements = await Promise.all(responses.map(response => response.json()));
  for (const movement of movements) assert.deepEqual(movement, movements[0]);
  const spend = { kind: 'withdrawal', amountCents: 11000, operationKey: randomUUID() };
  assert.equal((await request('/api/wallet/operations', spend, cookie)).status, 201);
  // A retry succeeds even after subsequent movements leave no available money.
  assert.deepEqual(await (await request('/api/wallet/operations', operation, cookie)).json(), movements[0]);
  assert.equal((await request('/api/wallet/operations', spend, cookie)).status, 201);
  for (const change of [{ amountCents: 1001 }, { kind: 'withdrawal' }]) {
    assert.equal((await request('/api/wallet/operations', { ...operation, ...change }, cookie)).status, 409);
  }
  const wallet = await (await request('/api/wallet', undefined, cookie)).json();
  assert.equal(wallet.balanceCents, 0);
  assert.equal(wallet.entries.length, 3);
});

test('wallet rejects malformed monetary values and kinds without changing its balance or statement', async () => {
  const cookie = await bettor();
  const before = await (await request('/api/wallet', undefined, cookie)).json();
  const valid = { kind: 'deposit', amountCents: 100, operationKey: randomUUID() };
  for (const amountCents of [0, -100, 99, 100001, 100.5, '100', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await request('/api/wallet/operations', { ...valid, amountCents }, cookie)).status, 400);
  }
  for (const kind of [['deposit'], ['withdrawal'], {}, null, 'initial_balance', 'payout', 'refund', 'bet']) {
    assert.equal((await request('/api/wallet/operations', { ...valid, kind }, cookie)).status, 400);
  }
  for (const operationKey of ['', null, 123, 'x'.repeat(129), 'with space']) {
    assert.equal((await request('/api/wallet/operations', { ...valid, operationKey }, cookie)).status, 400);
  }
  assert.equal((await request('/api/wallet/operations', { ...valid, kind: 'withdrawal', amountCents: 10001 }, cookie)).status, 400);
  assert.deepEqual(await (await request('/api/wallet', undefined, cookie)).json(), before);
});

test('deposit endpoints include both limits and withdrawal can use the entire available balance', async () => {
  const cookie = await bettor();
  for (const amountCents of [100, 100000]) {
    assert.equal((await request('/api/wallet/operations', { kind: 'deposit', amountCents, operationKey: randomUUID() }, cookie)).status, 201);
  }
  assert.equal((await request('/api/wallet/operations', { kind: 'withdrawal', amountCents: 110100, operationKey: randomUUID() }, cookie)).status, 201);
  const wallet = await (await request('/api/wallet', undefined, cookie)).json();
  assert.equal(wallet.balanceCents, 0);
  assert.equal(wallet.entries[0].amountCents, -110100);
  assert.equal((await request('/api/wallet/operations', { kind: 'withdrawal', amountCents: Number.MAX_SAFE_INTEGER, operationKey: randomUUID() }, cookie)).status, 400);
});

test('simultaneous distinct withdrawals cannot spend the same available money', async () => {
  const cookie = await bettor();
  const results = await Promise.all(Array.from({ length: 2 }, () => request('/api/wallet/operations', {
    kind: 'withdrawal', amountCents: 6000, operationKey: randomUUID(),
  }, cookie)));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 400]);
  const wallet = await (await request('/api/wallet', undefined, cookie)).json();
  assert.equal(wallet.balanceCents, 4000);
  assert.equal(wallet.entries.length, 2);
  assert.equal(wallet.entries[0].balanceAfterCents, 4000);
});

test('wallet ownership comes only from the session and administrators have no wallet operations', async () => {
  const first = await bettor();
  const second = await bettor();
  const operation = { kind: 'deposit', amountCents: 123, operationKey: randomUUID(), userId: 'demo-bettor' };
  assert.equal((await request('/api/wallet/operations', operation, first)).status, 201);
  assert.equal((await request('/api/wallet/operations', { ...operation, amountCents: 456 }, second)).status, 201);
  const walletA = await (await request('/api/wallet?userId=demo-bettor', undefined, first)).json();
  const walletB = await (await request('/api/wallet', undefined, second)).json();
  assert.equal(walletA.balanceCents, 10123);
  assert.equal(walletB.balanceCents, 10456);
  assert.ok(walletA.entries.every(entry => !walletB.entries.some(other => other.id === entry.id)));
  const admin = await request('/api/auth/login', { email: 'admin@betfake.local', password: process.env.DEMO_ADMIN_PASSWORD ?? 'AdminDemo123!' });
  assert.equal(admin.status, 200);
  for (const [cookie, expected] of [[undefined, 401], [admin.headers.get('set-cookie'), 403]]) {
    assert.equal((await request('/api/wallet', undefined, cookie)).status, expected);
    assert.equal((await request('/api/wallet/operations', operation, cookie)).status, expected);
  }
});
