function showTab(name) {
  const isLogin = name === 'login';
  document.getElementById('form-login').style.display    = isLogin ? '' : 'none';
  document.getElementById('form-register').style.display = isLogin ? 'none' : '';
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-register').classList.toggle('active', !isLogin);
  document.getElementById('login-error').textContent = '';
  document.getElementById('reg-error').textContent   = '';
  const first = isLogin ? 'login-username' : 'reg-username';
  setTimeout(() => document.getElementById(first).focus(), 50);
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.textContent = loading
    ? (btnId === 'login-btn' ? 'Signing in…' : 'Creating account…')
    : (btnId === 'login-btn' ? 'Sign in' : 'Create account');
}

async function submitLogin(e) {
  e.preventDefault();
  const errEl   = document.getElementById('login-error');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  errEl.textContent = '';
  setLoading('login-btn', true);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.detail || 'Login failed'; return; }
    window.location.href = '/';
  } catch {
    errEl.textContent = 'Network error — please try again.';
  } finally {
    setLoading('login-btn', false);
  }
}

async function submitRegister(e) {
  e.preventDefault();
  const errEl    = document.getElementById('reg-error');
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-confirm').value;
  errEl.textContent = '';
  if (password !== confirm) { errEl.textContent = 'Passwords do not match'; return; }
  setLoading('reg-btn', true);
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.detail || 'Registration failed'; return; }
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (loginRes.ok) {
      window.location.href = '/';
    } else {
      showTab('login');
      document.getElementById('login-username').value = username;
    }
  } catch {
    errEl.textContent = 'Network error — please try again.';
  } finally {
    setLoading('reg-btn', false);
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const fn = t.dataset.action;
  const arg = t.dataset.arg;
  if (fn === 'showTab') showTab(arg);
});

document.addEventListener('submit', (e) => {
  const t = e.target.closest('[data-action-submit]');
  if (!t) return;
  const fn = t.dataset.actionSubmit;
  if (fn === 'submitLogin')    submitLogin(e);
  if (fn === 'submitRegister') submitRegister(e);
});
