'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  // Overview
  accounts:   [],
  editingId:  null,
  updatingId: null,
  deletingId: null,
  // null = show every account; otherwise an AccountType ('savings'|'current'|'loan')
  accountFilter: null,
  // Budget
  budgetPeriod:     6,
  budgetItems:      [],
  editingBudgetId:  null,   // null = add mode, number = edit mode
  deletingBudgetId: null,
  biDir:            'out',
};

const charts = { history: null, distribution: null, projection: null, budget: null };

// ─── User prefs / theming ────────────────────────────────────────────────────
// Available palettes — id must match the [data-theme] hooks in style.css and
// the backend Theme literal. The swatch is what the user sees in the picker.
const THEMES = [
  { id: 'olive',  label: 'Olive',  swatch: '#708238' },
  { id: 'indigo', label: 'Indigo', swatch: '#6366f1' },
  { id: 'slate',  label: 'Slate',  swatch: '#475569' },
  { id: 'rose',   label: 'Rose',   swatch: '#be185d' },
];

const prefs = { theme: 'olive', dark_mode: false, base_currency: 'GBP' };

// Supported currencies — id must match the backend Currency literal in
// constants.py. `dec` is what Intl.NumberFormat uses for minimumFractionDigits
// (JPY has no minor unit and would otherwise render fractional yen).
const CURRENCIES = [
  { id: 'GBP', label: 'GBP — British Pound',     symbol: '£',   dec: 2 },
  { id: 'USD', label: 'USD — US Dollar',         symbol: '$',   dec: 2 },
  { id: 'EUR', label: 'EUR — Euro',              symbol: '€',   dec: 2 },
  { id: 'JPY', label: 'JPY — Japanese Yen',      symbol: '¥',   dec: 0 },
  { id: 'CAD', label: 'CAD — Canadian Dollar',   symbol: 'C$',  dec: 2 },
  { id: 'AUD', label: 'AUD — Australian Dollar', symbol: 'A$',  dec: 2 },
  { id: 'CHF', label: 'CHF — Swiss Franc',       symbol: 'Fr.', dec: 2 },
  { id: 'NZD', label: 'NZD — New Zealand Dollar',symbol: 'NZ$', dec: 2 },
  { id: 'SEK', label: 'SEK — Swedish Krona',     symbol: 'kr',  dec: 2 },
  { id: 'NOK', label: 'NOK — Norwegian Krone',   symbol: 'kr',  dec: 2 },
];

function currencyMeta(code) {
  return CURRENCIES.find(c => c.id === code) || CURRENCIES[0];
}

function currencySymbol(code) {
  return currencyMeta(code).symbol;
}

// User's manual FX table. Loaded from /api/rates on boot and after edits.
// `rates` is keyed by currency code; the user's base currency is not included
// (it is implicitly 1.0).
const fxState = { base: 'GBP', rates: {} };

function applyTheme() {
  const root = document.documentElement;
  root.setAttribute('data-theme', prefs.theme);
  if (prefs.dark_mode) root.setAttribute('data-mode', 'dark');
  else                 root.removeAttribute('data-mode');
  // Keep localStorage in sync so the next page load (incl. /login) picks the
  // right theme before paint — avoids the dashboard flashing the olive default
  // for users who actually picked something else.
  try {
    localStorage.setItem('findash:theme', prefs.theme);
    localStorage.setItem('findash:dark',  prefs.dark_mode ? '1' : '0');
  } catch {}
  refreshChartDefaults();
}

// Pull the text + grid colours from CSS variables so charts follow whatever
// theme + mode is active. Re-rendering existing charts picks the new values up.
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function refreshChartDefaults() {
  Chart.defaults.color = cssVar('--muted', '#64748b');
}

// UK-market account sub-types keyed by parent type. Order here is the order
// they appear in the dropdown; the value must match the backend enum.
const SUBTYPES = {
  current: [
    ['general',   'General'],
    ['standard',  'Standard Current'],
    ['joint',     'Joint'],
    ['student',   'Student'],
    ['premier',   'Premier / Packaged'],
    ['basic',     'Basic'],
    ['business',  'Business'],
  ],
  savings: [
    ['general',           'General'],
    ['cash_isa',          'Cash ISA'],
    ['stocks_shares_isa', 'Stocks & Shares ISA'],
    ['lifetime_isa',      'Lifetime ISA'],
    ['junior_isa',        'Junior ISA'],
    ['regular_saver',     'Regular Saver'],
    ['easy_access',       'Easy Access'],
    ['fixed_term_bond',   'Fixed-term Bond'],
    ['notice_account',    'Notice Account'],
    ['premium_bonds',     'Premium Bonds'],
    ['sipp',              'SIPP (Self-Invested Pension)'],
    ['workplace_pension', 'Workplace Pension'],
  ],
  loan: [
    ['general',      'General'],
    ['bank_loan',    'Bank / Personal Loan'],
    ['credit_card',  'Credit Card'],
    ['mortgage',     'Mortgage'],
    ['student_loan', 'Student Loan'],
    ['car_finance',  'Car Finance'],
    ['overdraft',    'Overdraft'],
    ['bnpl',         'Buy Now, Pay Later'],
  ],
};

function subtypeLabel(type, subtype) {
  const list = SUBTYPES[type] || [];
  const hit  = list.find(([v]) => v === subtype);
  return hit ? hit[1] : (subtype || 'General');
}

function populateSubtypeSelect(selectEl, type, selected) {
  const list = SUBTYPES[type] || [];
  selectEl.innerHTML = list.map(([value, label]) =>
    `<option value="${value}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`
  ).join('');
}

function populateCurrencySelect(selectEl, selected) {
  const sel = selected || prefs.base_currency || 'GBP';
  selectEl.innerHTML = CURRENCIES.map(c =>
    `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.label)}</option>`
  ).join('');
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiFetch(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    window.location.href = '/login';
    return new Promise(() => {}); // stall — redirect is in flight
  }
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

const api = {
  get:  url       => apiFetch('GET', url),
  post: (url, b)  => apiFetch('POST', url, b),
  put:  (url, b)  => apiFetch('PUT', url, b),
  del:  url       => apiFetch('DELETE', url),
};

// ─── Formatting ───────────────────────────────────────────────────────────────
// Currency-aware formatters. The optional `code` overrides the user's base
// currency — pass the account's own currency when rendering account-level
// values (balances, history points), and omit it for portfolio-wide totals
// (net worth, summary tiles) so they format in the base currency.
function fmt(v, code) {
  if (v == null) return '—';
  const c = code || prefs.base_currency || 'GBP';
  const dec = currencyMeta(c).dec;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: c,
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(v);
}

function fmtSigned(v, code) {
  if (v == null) return '—';
  const s = fmt(Math.abs(v), code);
  return (v >= 0 ? '+' : '−') + s;
}

function fmtDate(iso) {
  if (!iso) return 'Never';
  const s = /[Z+]/.test(iso) ? iso : iso + 'Z';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtMonthYear(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function showView(name) {
  document.getElementById('view-overview').style.display = name === 'overview' ? '' : 'none';
  document.getElementById('view-budget').style.display   = name === 'budget'   ? '' : 'none';
  document.querySelectorAll('.nav-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === name)
  );
  if (name === 'budget') loadBudgetView();
}

// ─── Overview — load & render ─────────────────────────────────────────────────
async function loadAll() {
  const [accounts, summary, me] = await Promise.all([
    api.get('/api/accounts'),
    api.get('/api/summary'),
    api.get('/api/auth/me'),
  ]);
  state.accounts = accounts;
  renderSummary(summary);
  renderAccounts(accounts);
  document.getElementById('header-username').textContent = me.username;
  await Promise.all([loadHistoryChart(), loadProjectionChart()]);
  renderDistributionChart(accounts);
}

function renderSummary(s) {
  // Summary totals always render in the user's base currency. Server returns
  // both the base and any missing-rate currencies so we can warn explicitly.
  const base = s.base_currency || prefs.base_currency;
  document.getElementById('total-amount').textContent   = fmt(s.total, base);
  document.getElementById('total-savings').textContent  = fmt(s.total_savings, base);
  document.getElementById('total-current').textContent  = fmt(s.total_current, base);
  document.getElementById('total-loans').textContent    = fmt(s.total_loans || 0, base);
  document.getElementById('account-count').textContent  = s.account_count;

  // Warn once via the net-worth label tooltip when a non-base currency has
  // no rate set — those accounts contribute as if the rate were 1.0.
  const nwLabel = document.querySelector('.nw-label');
  if (nwLabel) {
    const missing = (s.missing_rates || []).filter(c => c !== base);
    if (missing.length) {
      nwLabel.title = `Missing FX rates for: ${missing.join(', ')}. Set them in Settings for an accurate total.`;
      nwLabel.classList.add('nw-label--warn');
    } else {
      nwLabel.title = '';
      nwLabel.classList.remove('nw-label--warn');
    }
  }
}

// Clicking a summary tile narrows the Accounts grid to that type. Clicking
// the active tile again, or the 'all' tile at any time, clears the filter.
// Charts stay global on purpose — you don't lose context when drilling in.
function setAccountFilter(type) {
  const next = (type === 'all' || state.accountFilter === type) ? null : type;
  state.accountFilter = next;
  // Reflect the new state on every tile (aria-pressed drives the CSS).
  document.querySelectorAll('.summary-card[data-filter]').forEach(btn => {
    const f = btn.dataset.filter;
    const active = (next === null && f === 'all') || (next !== null && f === next);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderAccounts(state.accounts);
}

function renderAccounts(accounts) {
  const grid = document.getElementById('accounts-grid');
  if (!accounts.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity=".3">
          <rect x="4" y="10" width="40" height="30" rx="4" stroke="#64748b" stroke-width="2.5"/>
          <path d="M4 18h40" stroke="#64748b" stroke-width="2.5"/>
          <circle cx="13" cy="28" r="3" fill="#64748b"/>
        </svg>
        <p>No accounts yet — click <strong>Add Account</strong> to get started.</p>
      </div>`;
    return;
  }
  // Narrow to the active type filter (if any). The summary tiles each map to
  // one AccountType; the 'all' tile is represented internally as null.
  const visible = state.accountFilter
    ? accounts.filter(a => a.type === state.accountFilter)
    : accounts;
  if (!visible.length) {
    const labels = { savings: 'savings', current: 'current', loan: 'loan' };
    grid.innerHTML = `
      <div class="empty-state">
        <p>No ${esc(labels[state.accountFilter] || '')} accounts to show.
           <button type="button" class="btn btn-ghost btn-sm" onclick="setAccountFilter('all')">Show all</button></p>
      </div>`;
    return;
  }
  grid.innerHTML = visible.map(a => {
    const sub = (a.subtype && a.subtype !== 'general')
      ? `<span class="badge badge-subtype">${esc(subtypeLabel(a.type, a.subtype))}</span>`
      : '';
    // Show the currency badge only when it differs from the base — keeps
    // single-currency users from seeing redundant GBP/GBP/GBP tags.
    const cur = a.currency || 'GBP';
    const curBadge = cur !== prefs.base_currency
      ? `<span class="badge badge-currency">${esc(cur)}</span>`
      : '';
    return `
    <div class="card account-card" style="--accent-color:${esc(a.color)}">
      <div class="account-header">
        <div>
          <div class="account-name">${esc(a.name)}</div>
          <span class="badge badge-${esc(a.type)}">${esc(a.type)}</span>${sub}${curBadge}
        </div>
        <button class="btn-icon" onclick="openEditModal(${a.id})" title="Edit">&#9998;</button>
      </div>
      <div class="account-balance">${fmt(a.current_balance, cur)}</div>
      <div class="account-updated">${a.type === 'loan' ? 'Owed · ' : 'Updated: '}${fmtDate(a.last_updated)}</div>
      ${a.interest_rate > 0 && (a.type === 'savings' || a.type === 'loan')
        ? `<div class="account-rate${a.type === 'loan' ? ' account-rate--loan' : ''}">${a.interest_rate}% ${a.type === 'loan' ? 'APR' : 'AER'}</div>`
        : ''}
      <button class="btn btn-primary btn-sm mt-8" onclick="openUpdateModal(${a.id})">Update Balance</button>
    </div>`;
  }).join('');
}

// ─── Overview charts ──────────────────────────────────────────────────────────
Chart.defaults.font.family = "'Inter', sans-serif";
refreshChartDefaults();

const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top', labels: { boxWidth: 12, padding: 14, font: { size: 12 } } },
    // Tooltips honour each dataset's own currency (stashed on `_currency`) so
    // a mixed-currency chart formats USD lines in USD, JPY in yen, etc.
    tooltip: { callbacks: { label: ctx => {
      const cur = ctx.dataset._currency;
      return ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y ?? ctx.parsed, cur)}`;
    } } },
  },
};

// Convert a native-currency amount to the user's base using the cached FX
// table. Missing rates fall back to 1.0 — matches server semantics and keeps
// the chart honest about what we don't know.
function toBase(amount, currency) {
  if (amount == null) return amount;
  const base = prefs.base_currency || 'GBP';
  if (currency === base) return amount;
  const rate = fxState.rates[currency];
  return rate != null ? amount * rate : amount;
}

async function loadHistoryChart() {
  const days = document.getElementById('history-days').value;
  renderHistoryChart(await api.get(`/api/history/all?days=${days}`));
}

function renderHistoryChart(data) {
  const canvas = document.getElementById('history-chart');
  if (charts.history) { charts.history.destroy(); charts.history = null; }

  const filled = data.filter(a => a.history.length > 0);
  if (!filled.length) { charts.history = emptyChart(canvas, 'No balance history yet'); return; }

  const dateSet = new Set();
  filled.forEach(a => a.history.forEach(h => dateSet.add(h.date.split('T')[0])));
  const rawDates = [...dateSet].sort();
  const labels   = rawDates.map(fmtShort);

  const datasets = filled.map(a => {
    const byDate = {};
    a.history.forEach(h => { byDate[h.date.split('T')[0]] = h.balance; });
    let last = null;
    return {
      label: a.name,
      data: rawDates.map(d => { if (byDate[d] != null) last = byDate[d]; return last; }),
      borderColor: a.color,
      backgroundColor: hexToRgba(a.color, 0.08),
      fill: true, stepped: true, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5,
      _currency: a.currency || 'GBP',
    };
  });

  charts.history = new Chart(canvas, {
    type: 'line', data: { labels, datasets },
    options: {
      ...BASE_OPTS,
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 11 } } },
        y: { ticks: { callback: v => fmt(v), font: { size: 11 } }, grid: { color: cssVar('--border', '#f1f5f9') } },
      },
    },
  });
}

function renderDistributionChart(accounts) {
  const canvas = document.getElementById('distribution-chart');
  if (charts.distribution) { charts.distribution.destroy(); charts.distribution = null; }

  // Loans are liabilities, not part of the asset distribution
  const with_bal = accounts.filter(a =>
    a.type !== 'loan' && a.current_balance != null && a.current_balance > 0
  );
  if (!with_bal.length) { charts.distribution = emptyChart(canvas, 'No asset balances yet'); return; }

  // Convert each slice to the base currency so the doughnut compares like with
  // like. Hover tooltip still shows the original native amount.
  const base = prefs.base_currency || 'GBP';
  const slices = with_bal.map(a => ({
    name: a.name,
    color: a.color,
    native: a.current_balance,
    currency: a.currency || base,
    converted: toBase(a.current_balance, a.currency || base),
  }));

  charts.distribution = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: slices.map(s => s.name),
      datasets: [{
        data: slices.map(s => s.converted),
        backgroundColor: slices.map(s => s.color),
        borderWidth: 2, borderColor: cssVar('--surface', '#fff'), hoverOffset: 4,
      }],
    },
    options: {
      ...BASE_OPTS, cutout: '62%',
      plugins: {
        ...BASE_OPTS.plugins,
        tooltip: { callbacks: { label: ctx => {
          const s = slices[ctx.dataIndex];
          // Show native value first; append converted only if currencies differ.
          return s.currency === base
            ? ` ${s.name}: ${fmt(s.native, s.currency)}`
            : ` ${s.name}: ${fmt(s.native, s.currency)} (≈ ${fmt(s.converted, base)})`;
        } } },
      },
    },
  });
}

async function loadProjectionChart() {
  const months = parseInt(document.getElementById('projection-months').value, 10);
  renderProjectionChart(await api.get(`/api/projections?months=${months}`), months);
}

function renderProjectionChart(data, months) {
  const canvas  = document.getElementById('projection-chart');
  if (charts.projection) { charts.projection.destroy(); charts.projection = null; }

  const section = document.getElementById('projections-section');
  if (!data.length) { section.style.display = 'none'; return; }
  section.style.display = '';

  const labels   = data[0].points.map(p => fmtMonthYear(p.date));
  const datasets = data.map(a => ({
    label: a.name, data: a.points.map(p => p.balance),
    borderColor: a.color, backgroundColor: hexToRgba(a.color, 0.06),
    fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
    _currency: a.currency || 'GBP',
  }));

  charts.projection = new Chart(canvas, {
    type: 'line', data: { labels, datasets },
    options: {
      ...BASE_OPTS,
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 11 } } },
        y: { ticks: { callback: v => fmt(v), font: { size: 11 } }, grid: { color: cssVar('--border', '#f1f5f9') } },
      },
    },
  });

  document.getElementById('projection-stats').innerHTML = data.map(a => {
    const cur = a.currency || 'GBP';
    return `
    <div class="card projection-card" style="--accent-color:${esc(a.color)}">
      <div class="proj-name">${esc(a.name)}</div>
      <div class="proj-rate">${a.interest_rate}% AER (monthly compounding)</div>
      <div class="proj-rows">
        <div class="proj-row"><span>Now</span><span class="proj-value">${fmt(a.initial_balance, cur)}</span><span></span></div>
        <div class="proj-row"><span>1 year</span><span class="proj-value">${fmt(a['1yr'], cur)}</span><span class="proj-interest">+${fmt(a['1yr'] - a.initial_balance, cur)}</span></div>
        <div class="proj-row"><span>2 years</span><span class="proj-value">${fmt(a['2yr'], cur)}</span><span class="proj-interest">+${fmt(a['2yr'] - a.initial_balance, cur)}</span></div>
        <div class="proj-row"><span>5 years</span><span class="proj-value">${fmt(a['5yr'], cur)}</span><span class="proj-interest">+${fmt(a['5yr'] - a.initial_balance, cur)}</span></div>
      </div>
    </div>`;
  }).join('');
}

function emptyChart(canvas, msg) {
  return new Chart(canvas, {
    type: 'line',
    data: { labels: [''], datasets: [{ data: [null], borderColor: 'transparent' }] },
    options: {
      ...BASE_OPTS,
      plugins: {
        legend: { display: false }, tooltip: { enabled: false },
        title: { display: true, text: msg, color: cssVar('--muted', '#94a3b8'), font: { size: 13 } },
      },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

// ─── Budget — load & render ───────────────────────────────────────────────────
async function loadBudgetView() {
  const [items, projection] = await Promise.all([
    api.get('/api/budget'),
    api.get(`/api/budget/projection?months=${state.budgetPeriod}`),
  ]);
  state.budgetItems = items;
  renderBudgetChart(projection);
  renderBudgetItems(items, projection);
  renderBreakdownTable(projection);
}

async function setBudgetPeriod(months) {
  state.budgetPeriod = months;
  document.querySelectorAll('.period-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.months) === months)
  );
  const projection = await api.get(`/api/budget/projection?months=${months}`);
  renderBudgetChart(projection);
  renderBreakdownTable(projection);
}

// ─── Budget chart ─────────────────────────────────────────────────────────────
function renderBudgetChart(projection) {
  const canvas = document.getElementById('budget-chart');
  if (charts.budget) { charts.budget.destroy(); charts.budget = null; }

  if (!projection.accounts.length) {
    charts.budget = emptyChart(canvas, 'No accounts yet');
    document.getElementById('budget-chart-note').textContent = '';
    return;
  }

  const labels   = projection.accounts[0].points.map((p, i) =>
    i === 0 ? 'Now' : fmtMonthYear(p.date)
  );
  const datasets = projection.accounts.map(a => ({
    label: a.name,
    data:  a.points.map(p => p.balance),
    borderColor:     a.color,
    backgroundColor: hexToRgba(a.color, 0.06),
    fill: false, tension: 0.3, borderWidth: 2,
    // Dash loan lines so a downward trend visually reads as "debt reducing"
    // rather than being confused with an asset losing value.
    borderDash: a.type === 'loan' ? [6, 4] : [],
    pointRadius: 0, pointHoverRadius: 4,
    _currency: a.currency || 'GBP',
  }));

  // Bold net-worth line — the single most useful read of where things are heading
  if (projection.net_worth?.length) {
    datasets.unshift({
      label: 'Net Worth',
      data: projection.net_worth.map(p => p.balance),
      borderColor: cssVar('--text', '#1e293b'),
      backgroundColor: 'transparent',
      fill: false, tension: 0.3, borderWidth: 3,
      pointRadius: 0, pointHoverRadius: 5,
      _currency: projection.base_currency || prefs.base_currency,
    });
  }

  // Add a zero reference line annotation via a dummy dataset
  const hasNegative = projection.accounts.some(a => a.points.some(p => p.balance < 0));
  if (hasNegative) {
    datasets.push({
      label: 'Zero',
      data: Array(labels.length).fill(0),
      borderColor: 'rgba(239,68,68,0.3)', borderWidth: 1,
      borderDash: [4, 4], pointRadius: 0, fill: false,
      tooltip: { enabled: false },
    });
  }

  charts.budget = new Chart(canvas, {
    type: 'line', data: { labels, datasets },
    options: {
      ...BASE_OPTS,
      plugins: {
        ...BASE_OPTS.plugins,
        legend: {
          ...BASE_OPTS.plugins.legend,
          labels: {
            ...BASE_OPTS.plugins.legend.labels,
            filter: item => item.text !== 'Zero',
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 11 } } },
        y: { ticks: { callback: v => fmt(v), font: { size: 11 } }, grid: { color: cssVar('--border', '#f1f5f9') } },
      },
    },
  });

  const note = document.getElementById('budget-chart-note');
  note.textContent = 'Includes savings interest · based on current balances and recurring budget items';
}

// ─── Budget items list ────────────────────────────────────────────────────────
function renderBudgetItems(items, projection) {
  const grid = document.getElementById('budget-items-grid');

  if (!projection.accounts.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Add an account to start planning your budget.</p></div>`;
    return;
  }

  const byAccount = {};
  items.forEach(i => {
    if (!byAccount[i.account_id]) byAccount[i.account_id] = [];
    byAccount[i.account_id].push(i);
  });

  const freqLabel = { weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly', annually: 'annually' };

  grid.innerHTML = projection.accounts.map(acc => {
    const accItems = byAccount[acc.id] || [];
    const netClass = acc.monthly_net > 0 ? 'positive' : acc.monthly_net < 0 ? 'negative' : 'neutral';
    const netLabel = acc.monthly_net !== 0
      ? fmtSigned(acc.monthly_net, acc.currency || 'GBP') + '/mo'
      : 'No items';

    const accCur = acc.currency || 'GBP';
    const rows = accItems.map(item => {
      const isOut = item.amount < 0;
      return `
        <div class="bi-row">
          <div class="bi-info">
            <span class="bi-name">${esc(item.name)}</span>
            <span class="bi-freq">${freqLabel[item.frequency]}</span>
          </div>
          <span class="bi-amount ${isOut ? 'outflow' : 'inflow'}">${fmtSigned(item.amount, accCur)}</span>
          <button class="btn-icon" onclick="openEditBudgetModal(${item.id})" title="Edit">&#9998;</button>
          <button class="btn-icon" onclick="openDeleteBudgetConfirm(${item.id})" title="Remove">&#10005;</button>
        </div>`;
    }).join('');

    return `
      <div class="card budget-account-card" style="--accent-color:${esc(acc.color)}">
        <div class="bac-header">
          <div>
            <div class="account-name">${esc(acc.name)}</div>
            <span class="badge badge-${esc(acc.type)}">${esc(acc.type)}</span>
          </div>
          <div class="bac-meta">
            <span class="bac-net ${netClass}">${netLabel}</span>
            <button class="btn btn-primary btn-sm" onclick="openAddBudgetModal(${acc.id})">+ Add</button>
          </div>
        </div>
        ${accItems.length
          ? `<div class="bi-list">${rows}</div>`
          : `<p class="bi-empty">No budget items yet.</p>`}
      </div>`;
  }).join('');
}

// ─── Monthly breakdown table ──────────────────────────────────────────────────
function renderBreakdownTable(projection) {
  const table = document.getElementById('budget-table');
  if (!projection.accounts.length) { table.innerHTML = ''; return; }

  const accounts = projection.accounts;
  const months   = projection.months;

  // Header
  const colLabels = accounts[0].points.map((p, i) => i === 0 ? 'Now' : fmtMonthYear(p.date));
  let html = `<thead><tr>
    <th>Account</th>
    <th>Monthly net</th>
    ${colLabels.map(l => `<th>${esc(l)}</th>`).join('')}
  </tr></thead><tbody>`;

  accounts.forEach(acc => {
    const accCur = acc.currency || 'GBP';
    const netClass = acc.monthly_net > 0 ? 'positive' : acc.monthly_net < 0 ? 'negative' : '';
    const netStr   = acc.monthly_net !== 0 ? fmtSigned(acc.monthly_net, accCur) : '—';
    html += `<tr>
      <td>
        <span class="td-dot" style="background:${esc(acc.color)}"></span>${esc(acc.name)}
      </td>
      <td class="td-net ${netClass}">${netStr}</td>
      ${acc.points.map(p => `<td class="td-bal${p.balance < 0 ? ' negative' : ''}">${fmt(p.balance, accCur)}</td>`).join('')}
    </tr>`;
  });

  // Net-worth totals row — assets minus liabilities, in the user's base currency.
  // For monthly_net: a payment on a loan (e.g. -£1,200) *improves* net worth by +£1,200,
  // so we flip the sign for loan accounts before summing. Per-account nets are
  // converted to base before being added together so the total is meaningful
  // across mixed currencies.
  const base = projection.base_currency || prefs.base_currency || 'GBP';
  const totalNet = accounts.reduce((s, a) => {
    const v = toBase(a.monthly_net, a.currency || base);
    return s + (a.type === 'loan' ? -v : v);
  }, 0);
  const netClass = totalNet > 0 ? 'positive' : totalNet < 0 ? 'negative' : '';
  html += `<tr class="tr-total">
    <td>Net worth</td>
    <td class="td-net ${netClass}">${totalNet !== 0 ? fmtSigned(totalNet, base) : '—'}</td>`;
  const netWorthPoints = projection.net_worth || [];
  for (let m = 0; m <= months; m++) {
    const total = netWorthPoints[m]?.balance ?? 0;
    html += `<td class="td-bal${total < 0 ? ' negative' : ''}">${fmt(total, base)}</td>`;
  }
  html += '</tr></tbody>';
  table.innerHTML = html;
}

// ─── Overview modals ──────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape')
    document.querySelectorAll('.modal-overlay.open').forEach(el => closeModal(el.id));
});

// Add Account
function openAddAccountModal() {
  document.getElementById('add-name').value = '';
  document.getElementById('add-type').value = 'current';
  document.getElementById('add-interest').value = '';
  document.getElementById('add-min-payment').value = '';
  document.getElementById('add-balance').value = '';
  document.getElementById('add-color').value = '#6366f1';
  populateCurrencySelect(document.getElementById('add-currency'), prefs.base_currency);
  toggleAddInterest();
  openModal('add-account-modal');
  setTimeout(() => document.getElementById('add-name').focus(), 50);
}

function toggleAddInterest() {
  const t = document.getElementById('add-type').value;
  const isLoan  = t === 'loan';
  const hasRate = (t === 'savings' || isLoan);
  const cur = document.getElementById('add-currency').value || prefs.base_currency;
  const sym = currencySymbol(cur);
  // Repopulate the subtype dropdown — sub-types are scoped to the parent type,
  // so switching type must reset the available options to a valid set.
  populateSubtypeSelect(document.getElementById('add-subtype'), t, 'general');
  document.getElementById('add-interest-group').style.display = hasRate ? '' : 'none';
  document.getElementById('add-interest-label').textContent =
    isLoan ? 'APR (%)' : 'Annual Interest Rate (%)';
  document.getElementById('add-min-payment-group').style.display = isLoan ? '' : 'none';
  document.getElementById('add-min-payment-label').innerHTML =
    `Minimum Monthly Payment (${esc(sym)}) <span class="field-hint">optional</span>`;
  // For a loan, the "balance" is the amount owed — relabel so it reads as a liability.
  document.getElementById('add-balance-label').innerHTML = isLoan
    ? `Amount Owed (${esc(sym)}) <span class="field-hint">optional</span>`
    : `Opening Balance (${esc(sym)}) <span class="field-hint">optional</span>`;
}

async function submitAddAccount() {
  const name         = document.getElementById('add-name').value.trim();
  const type         = document.getElementById('add-type').value;
  const subtype      = document.getElementById('add-subtype').value || 'general';
  const currency     = document.getElementById('add-currency').value || prefs.base_currency;
  const interestRate = parseFloat(document.getElementById('add-interest').value) || 0;
  const color        = document.getElementById('add-color').value;
  const balStr       = document.getElementById('add-balance').value;
  const minPayStr    = document.getElementById('add-min-payment').value;
  if (!name) { alert('Please enter an account name.'); return; }
  try {
    const account = await api.post('/api/accounts', { name, type, subtype, currency, interest_rate: interestRate, color });
    if (balStr !== '' && !isNaN(parseFloat(balStr)))
      await api.post(`/api/accounts/${account.id}/balance`, { balance: parseFloat(balStr) });
    if (type === 'loan' && minPayStr !== '' && !isNaN(parseFloat(minPayStr))) {
      const minPay = parseFloat(minPayStr);
      if (minPay > 0) {
        await api.post('/api/budget', {
          account_id: account.id,
          name: 'Minimum monthly payment',
          amount: -minPay,
          frequency: 'monthly',
        });
      }
    }
    closeModal('add-account-modal');
    await loadAll();
  } catch (e) { alert('Error: ' + e.message); }
}

// Update Balance
function openUpdateModal(id) {
  state.updatingId = id;
  const a = state.accounts.find(a => a.id === id);
  const sym = currencySymbol(a.currency || prefs.base_currency);
  document.getElementById('update-balance-title').textContent = a.name;
  document.getElementById('update-balance-label').textContent = `New Balance (${sym})`;
  document.getElementById('update-balance-amount').value = a.current_balance ?? '';
  document.getElementById('update-balance-notes').value = '';
  openModal('update-balance-modal');
  setTimeout(() => document.getElementById('update-balance-amount').focus(), 50);
}

async function submitUpdateBalance() {
  const balance = parseFloat(document.getElementById('update-balance-amount').value);
  const notes   = document.getElementById('update-balance-notes').value.trim() || null;
  if (isNaN(balance)) { alert('Please enter a valid balance.'); return; }
  try {
    await api.post(`/api/accounts/${state.updatingId}/balance`, { balance, notes });
    closeModal('update-balance-modal');
    await loadAll();
  } catch (e) { alert('Error: ' + e.message); }
}

// Edit Account
function openEditModal(id) {
  state.editingId = id;
  const a = state.accounts.find(a => a.id === id);
  const hasRate = (a.type === 'savings' || a.type === 'loan');
  document.getElementById('edit-name').value     = a.name;
  document.getElementById('edit-interest').value = a.interest_rate;
  document.getElementById('edit-color').value    = a.color || '#6366f1';
  populateSubtypeSelect(document.getElementById('edit-subtype'), a.type, a.subtype || 'general');
  document.getElementById('edit-interest-group').style.display = hasRate ? '' : 'none';
  document.getElementById('edit-interest-label').textContent =
    a.type === 'loan' ? 'APR (%)' : 'Annual Interest Rate (%)';
  openModal('edit-account-modal');
  setTimeout(() => document.getElementById('edit-name').focus(), 50);
}

async function submitEditAccount() {
  const name         = document.getElementById('edit-name').value.trim();
  const subtype      = document.getElementById('edit-subtype').value || 'general';
  const interestRate = parseFloat(document.getElementById('edit-interest').value) || 0;
  const color        = document.getElementById('edit-color').value;
  if (!name) { alert('Please enter an account name.'); return; }
  try {
    await api.put(`/api/accounts/${state.editingId}`, { name, subtype, interest_rate: interestRate, color });
    closeModal('edit-account-modal');
    await loadAll();
  } catch (e) { alert('Error: ' + e.message); }
}

function openDeleteConfirm() {
  state.deletingId = state.editingId;
  document.getElementById('delete-account-name').textContent =
    state.accounts.find(a => a.id === state.editingId).name;
  closeModal('edit-account-modal');
  openModal('confirm-delete-modal');
}

async function confirmDelete() {
  try {
    await api.del(`/api/accounts/${state.deletingId}`);
    closeModal('confirm-delete-modal');
    state.deletingId = null;
    await loadAll();
  } catch (e) { alert('Error: ' + e.message); }
}

// ─── Budget modals ────────────────────────────────────────────────────────────
function setBiDir(dir) {
  state.biDir = dir;
  document.getElementById('dir-in').classList.toggle('active', dir === 'in');
  document.getElementById('dir-out').classList.toggle('active', dir === 'out');
}

function _populateAccountSelect(preselectId) {
  const sel = document.getElementById('bim-account');
  sel.innerHTML = state.accounts.map(a =>
    `<option value="${a.id}" ${a.id === preselectId ? 'selected' : ''}>${esc(a.name)}</option>`
  ).join('');
}

// Adapt the budget-item modal to the target account type. For loans the only
// meaningful budget item is a monthly payment, so we hide direction + frequency
// and reframe the amount field as "Minimum Monthly Payment".
function _applyBudgetModalForAccount(accountId) {
  const acc    = state.accounts.find(a => a.id === accountId);
  const isLoan = acc?.type === 'loan';
  const sym    = currencySymbol(acc?.currency || prefs.base_currency);
  document.getElementById('bim-direction-field').style.display = isLoan ? 'none' : '';
  document.getElementById('bim-frequency-field').style.display = isLoan ? 'none' : '';
  document.getElementById('bim-amount-label').textContent =
    isLoan ? `Minimum Monthly Payment (${sym})` : `Amount (${sym})`;
  if (isLoan) {
    setBiDir('out');                                          // a payment reduces the loan
    document.getElementById('bim-frequency').value = 'monthly';
    const nameInput = document.getElementById('bim-name');
    if (!nameInput.value.trim()) nameInput.value = 'Minimum monthly payment';
  }
}

function onBudgetAccountChange() {
  const id = parseInt(document.getElementById('bim-account').value, 10);
  _applyBudgetModalForAccount(id);
}

function openAddBudgetModal(accountId = null) {
  if (!state.accounts.length) { alert('Please add an account first.'); return; }
  state.editingBudgetId = null;
  const preselect = accountId || state.accounts[0].id;
  document.getElementById('bim-title').textContent      = 'Add Budget Item';
  document.getElementById('bim-submit').textContent     = 'Add Item';
  document.getElementById('bim-account-field').style.display = '';
  document.getElementById('bim-name').value             = '';
  document.getElementById('bim-amount').value           = '';
  document.getElementById('bim-frequency').value        = 'monthly';
  setBiDir('out');
  _populateAccountSelect(preselect);
  _applyBudgetModalForAccount(preselect);
  openModal('budget-item-modal');
  setTimeout(() => document.getElementById('bim-name').focus(), 50);
}

function openEditBudgetModal(id) {
  const item = state.budgetItems.find(i => i.id === id);
  state.editingBudgetId = id;
  document.getElementById('bim-title').textContent      = 'Edit Budget Item';
  document.getElementById('bim-submit').textContent     = 'Save Changes';
  document.getElementById('bim-account-field').style.display = 'none'; // account fixed on edit
  document.getElementById('bim-name').value             = item.name;
  document.getElementById('bim-amount').value           = Math.abs(item.amount);
  document.getElementById('bim-frequency').value        = item.frequency;
  setBiDir(item.amount >= 0 ? 'in' : 'out');
  _applyBudgetModalForAccount(item.account_id);
  openModal('budget-item-modal');
  setTimeout(() => document.getElementById('bim-name').focus(), 50);
}

async function submitBudgetItem() {
  const name      = document.getElementById('bim-name').value.trim();
  const rawAmount = parseFloat(document.getElementById('bim-amount').value);
  const frequency = document.getElementById('bim-frequency').value;
  if (!name) { alert('Please enter a description.'); return; }
  if (isNaN(rawAmount) || rawAmount < 0) { alert('Please enter a valid amount.'); return; }
  const amount = state.biDir === 'out' ? -rawAmount : rawAmount;
  try {
    if (state.editingBudgetId === null) {
      const account_id = parseInt(document.getElementById('bim-account').value, 10);
      await api.post('/api/budget', { account_id, name, amount, frequency });
    } else {
      await api.put(`/api/budget/${state.editingBudgetId}`, { name, amount, frequency });
    }
    closeModal('budget-item-modal');
    await loadBudgetView();
  } catch (e) { alert('Error: ' + e.message); }
}

function openDeleteBudgetConfirm(id) {
  state.deletingBudgetId = id;
  document.getElementById('dbi-name').textContent = state.budgetItems.find(i => i.id === id).name;
  openModal('confirm-delete-budget-modal');
}

async function confirmDeleteBudgetItem() {
  try {
    await api.del(`/api/budget/${state.deletingBudgetId}`);
    closeModal('confirm-delete-budget-modal');
    state.deletingBudgetId = null;
    await loadBudgetView();
  } catch (e) { alert('Error: ' + e.message); }
}

// ─── Enter key submits focused modal ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const open = document.querySelector('.modal-overlay.open');
  if (!open || e.target.tagName === 'TEXTAREA') return;
  const id = open.id;
  if      (id === 'add-account-modal')      submitAddAccount();
  else if (id === 'update-balance-modal')   submitUpdateBalance();
  else if (id === 'edit-account-modal')     submitEditAccount();
  else if (id === 'budget-item-modal')      submitBudgetItem();
});

// ─── Settings modal ──────────────────────────────────────────────────────────
function renderThemeGrid() {
  const grid = document.getElementById('theme-grid');
  grid.innerHTML = THEMES.map(t => `
    <button type="button"
            class="theme-swatch ${t.id === prefs.theme ? 'active' : ''}"
            data-theme-id="${t.id}"
            onclick="setTheme('${t.id}')">
      <span class="theme-swatch-dot" style="background:${t.swatch}"></span>
      <span class="theme-swatch-name">${esc(t.label)}</span>
    </button>`).join('');
}

function renderModePill() {
  document.querySelectorAll('#settings-mode-pill button').forEach(b =>
    b.classList.toggle('active',
      (b.dataset.mode === 'dark') === prefs.dark_mode)
  );
}

function openSettingsModal() {
  renderThemeGrid();
  renderModePill();
  renderCurrencySettings();
  openModal('settings-modal');
}

// ─── Currency settings ───────────────────────────────────────────────────────
// The settings modal exposes (1) the user's base currency and (2) a manual FX
// table. The rates table only shows currencies that are actually in use on the
// user's accounts (plus the base) — there's no point asking for a NOK rate if
// they don't hold NOK. The base itself is implicit and not editable as a row.

function _usedCurrencies() {
  const set = new Set([prefs.base_currency || 'GBP']);
  state.accounts.forEach(a => set.add(a.currency || 'GBP'));
  return [...set];
}

function renderCurrencySettings() {
  populateCurrencySelect(
    document.getElementById('settings-base-currency'),
    prefs.base_currency,
  );
  document.getElementById('rates-base-label').textContent = prefs.base_currency;
  renderRatesTable();
}

function renderRatesTable() {
  const base = prefs.base_currency || 'GBP';
  const rows = _usedCurrencies()
    .filter(c => c !== base)
    .sort();
  const table = document.getElementById('rates-table');
  const note  = document.getElementById('rates-note');
  const saveBtn = document.getElementById('rates-save-btn');

  if (!rows.length) {
    table.innerHTML = '';
    note.textContent = 'Add an account in another currency to manage exchange rates here.';
    saveBtn.style.display = 'none';
    return;
  }

  saveBtn.style.display = '';
  note.textContent = 'Rates are how the dashboard converts to your base currency for net-worth totals.';
  table.innerHTML = rows.map(c => {
    const m = currencyMeta(c);
    const r = fxState.rates[c];
    const value = r != null ? r : '';
    return `
      <div class="rate-row" data-currency="${c}">
        <span class="rate-from">1 ${esc(c)}</span>
        <span class="rate-eq">=</span>
        <input type="number" class="rate-input" data-currency="${c}"
               step="0.0001" min="0" placeholder="—"
               value="${value}" />
        <span class="rate-to">${esc(base)}</span>
        <span class="rate-name">${esc(m.label.replace(/^[A-Z]+ — /, ''))}</span>
      </div>`;
  }).join('');
}

async function saveRatesFromTable() {
  const inputs = document.querySelectorAll('#rates-table .rate-input');
  const rates = [];
  for (const inp of inputs) {
    const v = inp.value.trim();
    if (v === '') continue;                    // blank = no rate set
    const num = parseFloat(v);
    if (!isFinite(num) || num <= 0) {
      alert(`Invalid rate for ${inp.dataset.currency}.`);
      return;
    }
    rates.push({ currency: inp.dataset.currency, rate: num });
  }
  try {
    const body = await api.put('/api/rates', { rates });
    fxState.base = body.base_currency;
    fxState.rates = Object.fromEntries(body.rates.map(r => [r.currency, r.rate]));
    renderRatesTable();
    await loadAll();
  } catch (e) {
    alert('Could not save rates: ' + e.message);
  }
}

async function onBaseCurrencyChange(newBase) {
  if (newBase === prefs.base_currency) return;
  // Server re-scales the rates table if possible; if it can't, the user will
  // see blanks and re-enter what's missing.
  try {
    const updated = await api.put('/api/prefs', { base_currency: newBase });
    prefs.base_currency = updated.base_currency;
    await loadRates();
    renderCurrencySettings();
    await loadAll();
  } catch (e) {
    alert('Could not change base currency: ' + e.message);
  }
}

async function loadRates() {
  try {
    const body = await api.get('/api/rates');
    fxState.base = body.base_currency;
    fxState.rates = Object.fromEntries(body.rates.map(r => [r.currency, r.rate]));
  } catch {
    // 401 already handled by apiFetch; otherwise leave the table empty.
  }
}

// Persist a pref change and reflect it everywhere immediately. We update the
// local state and the DOM optimistically so the user sees the change without
// waiting for the round-trip; the server call is fire-and-forget aside from
// an alert on failure.
async function _savePrefs(patch) {
  Object.assign(prefs, patch);
  applyTheme();
  renderThemeGrid();
  renderModePill();
  // Re-render charts so they pick up the new --muted / --border / --surface
  // values. Cheaper than a full reload, and avoids re-fetching the data.
  await loadAll();
  if (document.getElementById('view-budget').style.display !== 'none') {
    await loadBudgetView();
  }
  try {
    await api.put('/api/prefs', patch);
  } catch (e) {
    alert('Could not save preferences: ' + e.message);
  }
}

function setTheme(themeId)   { _savePrefs({ theme: themeId }); }
function setDarkMode(on)     { _savePrefs({ dark_mode: !!on }); }
function toggleDarkMode()    { setDarkMode(!prefs.dark_mode); }

async function loadPrefs() {
  try {
    const p = await api.get('/api/prefs');
    prefs.theme         = p.theme;
    prefs.dark_mode     = !!p.dark_mode;
    prefs.base_currency = p.base_currency || 'GBP';
  } catch {
    // 401 is already handled by apiFetch (redirects to /login). Anything else,
    // fall back to whatever localStorage primed pre-paint.
  }
  applyTheme();
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  await loadPrefs();
  await loadRates();
  await loadAll();
})();
