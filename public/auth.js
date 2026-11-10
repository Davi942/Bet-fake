const authStatus = document.querySelector('#auth-status');
const access = document.querySelector('#access');
const personal = document.querySelector('#personal');
const administration = document.querySelector('#administration');
let sessionGeneration = 0;

function clearSession() {
  sessionGeneration++;
  document.dispatchEvent(new CustomEvent('session-changed', { detail: null }));
  personal.hidden = administration.hidden = true;
  document.querySelector('#current-user').textContent = '';
  document.querySelector('#admin-user').textContent = '';
  document.querySelector('#balance').textContent = '';
  document.querySelector('#personal-link').hidden = document.querySelector('#admin-link').hidden = true;
  document.querySelector('#logout').hidden = true;
  access.hidden = false;
  document.querySelector('#access-link').hidden = false;
  // New authentication always starts with empty forms; pending actions are never replayed.
  document.querySelectorAll('form').forEach(form => form.reset());
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (response.status === 401) clearSession();
  if (!response.ok) {
    const error = new Error(data.message ?? 'Não foi possível concluir. Tente novamente.');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function showSession(user) {
  const generation = ++sessionGeneration;
  const isBettor = user.role === 'bettor';
  const details = await api(isBettor ? '/api/account' : '/api/admin/overview');
  if (generation !== sessionGeneration) return;
  access.hidden = document.querySelector('#access-link').hidden = true;
  document.querySelector('#logout').hidden = false;
  personal.hidden = document.querySelector('#personal-link').hidden = !isBettor;
  administration.hidden = document.querySelector('#admin-link').hidden = isBettor;
  document.querySelector(isBettor ? '#current-user' : '#admin-user').textContent = `${user.displayName} (${user.email})`;
  document.dispatchEvent(new CustomEvent('session-changed', { detail: user }));
  if (isBettor) document.querySelector('#balance').textContent = `Saldo disponível: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(details.balanceCents / 100)}`;
}

for (const kind of ['login', 'signup']) {
  const form = document.querySelector(`#${kind}-form`);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button');
    button.disabled = true;
    authStatus.textContent = 'Aguarde…';
    try {
      const user = await api(`/api/auth/${kind}`, body);
      form.reset();
      if (kind === 'signup') {
        authStatus.textContent = 'Conta criada. Entre com seu e-mail e senha.';
        document.querySelector('#login-form input').focus();
      } else {
        await showSession(user);
        authStatus.textContent = 'Sessão iniciada. Revise e confirme novamente qualquer ação pendente.';
      }
    } catch (error) { authStatus.textContent = error.message; }
    finally { button.disabled = false; }
  });
}
document.querySelector('#logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', {}); clearSession(); authStatus.textContent = 'Sessão encerrada.'; }
  catch (error) { authStatus.textContent = error.message; }
});
async function refreshSession(initial = false) {
  try { await showSession(await api('/api/auth/me')); }
  catch (error) { authStatus.textContent = initial && error.status === 401 ? '' : error.message; }
}
refreshSession(true);
document.addEventListener('visibilitychange', () => { if (!document.hidden && access.hidden) refreshSession(); });
setInterval(() => { if (access.hidden) refreshSession(); }, 30000);
