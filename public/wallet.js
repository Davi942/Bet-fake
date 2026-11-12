const walletStatus = document.querySelector('#wallet-status');
const walletEntries = document.querySelector('#wallet-entries');
let walletOwner = null;
let walletGeneration = 0;
let walletSession = 0;
let pendingOperation = null;
let walletBusy = false;
const walletForm = document.querySelector('#wallet-form');
const walletSubmit = document.querySelector('#wallet-submit');
const money = formatMoneyCents;
const entryLabels = { initial_balance: 'Saldo inicial', deposit: 'Depósito simulado', withdrawal: 'Saque simulado', bet: 'Aposta', payout: 'Retorno', refund: 'Estorno' };

function renderWallet(wallet) {
  document.querySelector('#balance').textContent = `Saldo disponível: ${money(wallet.balanceCents)}`;
  walletEntries.replaceChildren(...wallet.entries.map(entry => {
    const row = document.createElement('tr');
    const values = [new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(entry.createdAt)), entryLabels[entry.kind] ?? entry.kind, money(entry.amountCents), money(entry.balanceAfterCents)];
    for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
    if (entry.betId) {
      const link = document.createElement('a'); link.href = `#bet-${entry.betId}`; link.textContent = 'Ver aposta';
      const fixture = document.createElement('a'); fixture.href = `#fixture-${entry.fixtureId}`; fixture.textContent = 'Ver partida';
      row.children[1].append(document.createElement('br'), link, document.createTextNode(' · '), fixture);
    }
    return row;
  }));
}
async function loadWallet() {
  if (!walletOwner) return;
  const generation = ++walletGeneration;
  try {
    const wallet = await walletApi('/api/wallet');
    if (generation !== walletGeneration) return;
    renderWallet(wallet);
  } catch (error) { if (generation === walletGeneration) walletStatus.textContent = error.message; }
}
document.addEventListener('session-changed', event => {
  const owner = event.detail?.role === 'bettor' ? event.detail.email : null;
  if (owner === walletOwner) { if (owner) loadWallet(); return; }
  walletOwner = owner;
  walletSession++;
  walletGeneration++;
  pendingOperation = null;
  walletBusy = false;
  walletForm.reset();
  updateWalletForm();
  walletEntries.replaceChildren();
  document.querySelector('#balance').textContent = '';
  walletStatus.textContent = '';
  if (owner) loadWallet();
});
document.querySelector('#wallet-refresh').addEventListener('click', loadWallet);
document.addEventListener('bet-accepted', loadWallet);

async function walletApi(path, body) {
  const session = walletSession;
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (response.status === 401 && session === walletSession) clearSession();
  if (!response.ok) { const error = new Error(data.message ?? 'Não foi possível concluir.'); error.status = response.status; throw error; }
  return data;
}
function updateWalletForm() {
  for (const field of walletForm.querySelectorAll('input,select')) field.disabled = walletBusy || Boolean(pendingOperation);
  walletSubmit.disabled = walletBusy;
  walletSubmit.textContent = pendingOperation ? 'Repetir a mesma operação' : 'Confirmar operação simulada';
}
walletForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!walletOwner || walletBusy) return;
  const session = walletSession;
  if (!pendingOperation) {
    const text = document.querySelector('#wallet-amount').value.trim();
    if (!/^\d+([,.]\d{1,2})?$/.test(text) || text.length > 20) { walletStatus.textContent = 'Informe reais e no máximo dois centavos, por exemplo 10,50.'; return; }
    const [reais, centavos = ''] = text.split(/[,.]/);
    const cents = BigInt(reais) * 100n + BigInt(centavos.padEnd(2, '0'));
    const kind = document.querySelector('#wallet-kind').value;
    if (cents < 100n || cents > BigInt(Number.MAX_SAFE_INTEGER) || (kind === 'deposit' && cents > 100000n)) {
      walletStatus.textContent = 'Depósito: R$ 1,00 a R$ 1.000,00. Saque: a partir de R$ 1,00, dentro do saldo disponível.'; return;
    }
    pendingOperation = { kind, amountCents: Number(cents), operationKey: crypto.randomUUID() };
  }
  walletBusy = true;
  walletGeneration++;
  updateWalletForm();
  walletStatus.textContent = 'Confirmando operação simulada…';
  try {
    await walletApi('/api/wallet/operations', pendingOperation);
    if (session !== walletSession) return;
    pendingOperation = null;
    walletForm.reset();
    walletStatus.textContent = 'Operação simulada confirmada.';
    await loadWallet();
  } catch (error) {
    if (session !== walletSession) return;
    if (error.status && error.status < 500) { pendingOperation = null; walletStatus.textContent = error.message; }
    else walletStatus.textContent = 'Não foi possível confirmar a resposta. Repita a mesma operação para consultar o resultado sem duplicar a movimentação.';
  } finally {
    if (session === walletSession) { walletBusy = false; updateWalletForm(); }
  }
});
