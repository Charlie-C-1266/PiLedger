'use strict';

// ─── API response types (mirror Pydantic models in schemas.py) ──────────────
/** @typedef {{ id: number, username: string }} UserOut */
/** @typedef {{ theme: string, dark_mode: boolean, base_currency: string }} PrefsOut */
/** @typedef {{ id: number, user_id: number, name: string, type: 'current'|'savings'|'loan', subtype: string, currency: string, interest_rate: number, color: string, created_at: string, current_balance: ?number, last_updated: ?string }} AccountOut */
/** @typedef {{ total: number, total_current: number, total_savings: number, total_loans: number, account_count: number, base_currency: string, missing_rates: string[] }} SummaryOut */
/** @typedef {{ balance: number, notes: ?string, recorded_at: string }} BalanceEntryOut */
/** @typedef {{ balance: number, date: string }} HistoryPointOut */
/** @typedef {{ id: number, name: string, color: string, type: 'current'|'savings'|'loan', currency: string, history: HistoryPointOut[] }} HistoryAccountOut */
/** @typedef {{ id: number, user_id: number, account_id: number, name: string, amount: number, frequency: 'weekly'|'monthly'|'quarterly'|'annually', created_at: string }} BudgetItemOut */
/** @typedef {{ currency: string, rate: number, updated_at: ?string }} RateOut */
/** @typedef {{ base_currency: string, rates: RateOut[] }} RatesOut */
/** @typedef {{ date: string, balance: number }} ProjectionPoint */
/** @typedef {{ id: number, name: string, color: string, currency: string, initial_balance: number, interest_rate: number, '1yr': number, '2yr': number, '5yr': number, points: ProjectionPoint[] }} SavingsProjection */
/** @typedef {{ id: number, name: string, type: 'current'|'savings'|'loan', color: string, currency: string, current_balance: ?number, monthly_net: number, points: ProjectionPoint[], final_balance: number }} BudgetProjectionAccount */
/** @typedef {{ months: number, accounts: BudgetProjectionAccount[], net_worth: ProjectionPoint[], base_currency: string }} BudgetProjectionResult */

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

// Chart-type choices the user can flip between live. Persisted to localStorage
// so the next page load remembers their pick. `distributionAccounts` caches the
// last account list so toggling chart type doesn't need another /api/accounts.
const chartPrefs = {
  distributionType: (() => {
    try { return localStorage.getItem('piledger:distChart') || 'doughnut'; }
    catch { return 'doughnut'; }
  })(),
};
let distributionAccounts = [];

// ─── User prefs / theming ────────────────────────────────────────────────────
// Available palettes — id must match the [data-theme] hooks in style.css and
// the backend Theme literal. The swatch is what the user sees in the picker.
const THEMES = [
  { id: 'olive',   label: 'Olive',   swatch: '#708238' },
  { id: 'emerald', label: 'Emerald', swatch: '#059669' },
  { id: 'teal',    label: 'Teal',    swatch: '#0d9488' },
  { id: 'sky',     label: 'Sky',     swatch: '#0284c7' },
  { id: 'indigo',  label: 'Indigo',  swatch: '#6366f1' },
  { id: 'violet',  label: 'Violet',  swatch: '#7c3aed' },
  { id: 'rose',    label: 'Rose',    swatch: '#be185d' },
  { id: 'crimson', label: 'Crimson', swatch: '#dc2626' },
  { id: 'amber',   label: 'Amber',   swatch: '#d97706' },
  { id: 'slate',   label: 'Slate',   swatch: '#475569' },
];

const prefs = { theme: 'olive', dark_mode: false, base_currency: 'GBP' };

function themeAccent() {
  const t = THEMES.find(t => t.id === prefs.theme);
  return t ? t.swatch : '#708238';
}

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
    localStorage.setItem('piledger:theme', prefs.theme);
    localStorage.setItem('piledger:dark',  prefs.dark_mode ? '1' : '0');
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

/** Create an HTML element. Attributes are set via setAttribute; children are
 *  appended (strings become text nodes, nullish values are skipped). */
function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs))
    if (v != null && v !== false) e.setAttribute(k, String(v));
  for (const c of children)
    if (c != null && c !== false) e.append(typeof c === 'string' ? c : c);
  return e;
}

// ─── Navigation (hash-based router) ─────────────────────────────────────────
const VIEWS = ['overview', 'budget'];

function currentView() {
  const h = location.hash.replace('#', '');
  return VIEWS.includes(h) ? h : 'overview';
}

function _applyView(name) {
  document.getElementById('view-overview').style.display = name === 'overview' ? '' : 'none';
  document.getElementById('view-budget').style.display   = name === 'budget'   ? '' : 'none';
  document.querySelectorAll('.nav-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === name)
  );
  if (name === 'budget') loadBudgetView();
}

function showView(name) {
  if (!VIEWS.includes(name)) name = 'overview';
  if (location.hash === '#' + name) { _applyView(name); return; }
  location.hash = name;
}

window.addEventListener('hashchange', () => _applyView(currentView()));

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
  const unEl = document.getElementById('dropdown-username');
  if (unEl) unEl.textContent = me.username;
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

/** @param {AccountOut} a */
function createAccountCard(a) {
  const cur = a.currency || 'GBP';
  const isLoan = a.type === 'loan';

  const nameDiv = el('div', { class: 'account-name' }, a.name);
  const typeBadge = el('span', { class: `badge badge-${a.type}` }, a.type);
  const headerLeft = el('div', null, nameDiv, typeBadge);
  if (a.subtype && a.subtype !== 'general')
    headerLeft.append(el('span', { class: 'badge badge-subtype' }, subtypeLabel(a.type, a.subtype)));
  if (cur !== prefs.base_currency)
    headerLeft.append(el('span', { class: 'badge badge-currency' }, cur));

  const editBtn = el('button', { class: 'btn-icon', 'data-action': 'openEditModal', 'data-arg': String(a.id), title: 'Edit' });
  editBtn.innerHTML = '&#9998;';

  const card = el('div', { class: 'card account-card', style: `--accent-color:${a.color}` },
    el('div', { class: 'account-header' }, headerLeft, editBtn),
    el('div', { class: 'account-balance' }, fmt(a.current_balance, cur)),
    el('div', { class: 'account-updated' }, (isLoan ? 'Owed · ' : 'Updated: ') + fmtDate(a.last_updated)),
  );
  if (a.interest_rate > 0 && (a.type === 'savings' || isLoan))
    card.append(el('div', { class: 'account-rate' + (isLoan ? ' account-rate--loan' : '') },
      `${a.interest_rate}% ${isLoan ? 'APR' : 'AER'}`));
  card.append(el('button', { class: 'btn btn-primary btn-sm mt-8', 'data-action': 'openUpdateModal', 'data-arg': String(a.id) }, 'Update Balance'));
  return card;
}

/** @param {AccountOut[]} accounts */
function renderAccounts(accounts) {
  const grid = document.getElementById('accounts-grid');
  if (!accounts.length) {
    const empty = el('div', { class: 'empty-state' });
    empty.innerHTML = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity=".3">
      <rect x="4" y="10" width="40" height="30" rx="4" stroke="#64748b" stroke-width="2.5"/>
      <path d="M4 18h40" stroke="#64748b" stroke-width="2.5"/>
      <circle cx="13" cy="28" r="3" fill="#64748b"/>
    </svg>`;
    empty.append(el('p', null, 'No accounts yet — click ', el('strong', null, 'Add Account'), ' to get started.'));
    grid.replaceChildren(empty);
    return;
  }
  const visible = state.accountFilter
    ? accounts.filter(a => a.type === state.accountFilter)
    : accounts;
  if (!visible.length) {
    const labels = { savings: 'savings', current: 'current', loan: 'loan' };
    const showAll = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-action': 'setAccountFilter', 'data-arg': 'all' }, 'Show all');
    const empty = el('div', { class: 'empty-state' },
      el('p', null, `No ${labels[state.accountFilter] || ''} accounts to show. `, showAll));
    grid.replaceChildren(empty);
    return;
  }
  grid.replaceChildren(...visible.map(createAccountCard));
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

// Draws a thin vertical guide line at the hovered x. Pairs with LINE_OPTS'
// 'index' interaction mode so the tooltip and the line agree on which x slot
// they are showing — much easier to read balances on a specific date than
// hunting for individual point dots.
const crosshairPlugin = {
  id: 'pl_crosshair',
  afterDatasetsDraw(chart) {
    // Crosshair only makes sense on time-series line charts — doughnut/bar
    // wouldn't benefit from a vertical guide across categorical slices.
    if (chart.config.type !== 'line') return;
    const active = chart.tooltip?.getActiveElements?.();
    if (!active || !active.length) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = cssVar('--muted', '#94a3b8');
    ctx.setLineDash([3, 3]);
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.restore();
  },
};
Chart.register(crosshairPlugin);

// Shared options for the three line charts: hover anywhere on the chart and
// every series' value at that x lights up in a single tooltip.
const LINE_OPTS = {
  interaction: { mode: 'index', intersect: false, axis: 'x' },
  hover:       { mode: 'index', intersect: false },
  plugins: {
    ...BASE_OPTS.plugins,
    tooltip: {
      ...BASE_OPTS.plugins.tooltip,
      mode: 'index', intersect: false,
      backgroundColor: 'rgba(15,23,42,0.92)',
      padding: 10, cornerRadius: 6, titleFont: { weight: '600' },
    },
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
      ...LINE_OPTS,
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 11 } } },
        y: { ticks: { callback: v => fmt(v), font: { size: 11 } }, grid: { color: cssVar('--border', '#f1f5f9') } },
      },
    },
  });
}

function renderDistributionChart(accounts) {
  // Cache for setDistributionChartType() so toggling type doesn't need a refetch.
  distributionAccounts = accounts;

  // Sync the toggle's active state to whatever was loaded from localStorage —
  // the markup defaults to 'doughnut' active but the saved pref may be 'bar'.
  document.querySelectorAll('#distribution-type-toggle .chart-type-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.arg === chartPrefs.distributionType)
  );

  const canvas = document.getElementById('distribution-chart');
  if (charts.distribution) { charts.distribution.destroy(); charts.distribution = null; }

  // Loans are liabilities, not part of the asset distribution
  const with_bal = accounts.filter(a =>
    a.type !== 'loan' && a.current_balance != null && a.current_balance > 0
  );
  if (!with_bal.length) { charts.distribution = emptyChart(canvas, 'No asset balances yet'); return; }

  // Convert each slice to the base currency so values compare like with like.
  // Hover tooltip still shows the original native amount.
  const base = prefs.base_currency || 'GBP';
  const slices = with_bal.map(a => ({
    name: a.name,
    color: a.color,
    native: a.current_balance,
    currency: a.currency || base,
    converted: toBase(a.current_balance, a.currency || base),
  }));

  // Tooltip used by both renderers — pulls the matching slice by index so the
  // native-currency value (not the base-converted one) is what the user sees.
  const sliceLabel = ctx => {
    const s = slices[ctx.dataIndex];
    return s.currency === base
      ? ` ${s.name}: ${fmt(s.native, s.currency)}`
      : ` ${s.name}: ${fmt(s.native, s.currency)} (≈ ${fmt(s.converted, base)})`;
  };

  charts.distribution = chartPrefs.distributionType === 'bar'
    ? renderDistributionBar(canvas, slices, sliceLabel)
    : renderDistributionDoughnut(canvas, slices, sliceLabel);
}

function renderDistributionDoughnut(canvas, slices, sliceLabel) {
  return new Chart(canvas, {
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
        tooltip: { callbacks: { label: sliceLabel } },
      },
    },
  });
}

function renderDistributionBar(canvas, slices, sliceLabel) {
  // Sort descending so the largest account sits at the top of the bar chart.
  // (We sort a copy — slices is used as a position-stable lookup elsewhere.)
  const order = slices.map((_, i) => i)
    .sort((a, b) => slices[b].converted - slices[a].converted);
  const ordered = order.map(i => slices[i]);

  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ordered.map(s => s.name),
      datasets: [{
        data: ordered.map(s => s.converted),
        backgroundColor: ordered.map(s => s.color),
        borderWidth: 0, borderRadius: 4, maxBarThickness: 26,
      }],
    },
    options: {
      ...BASE_OPTS,
      indexAxis: 'y',
      plugins: {
        ...BASE_OPTS.plugins,
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => sliceLabel({ dataIndex: order[ctx.dataIndex] }) } },
      },
      scales: {
        x: { ticks: { callback: v => fmt(v), font: { size: 11 } }, grid: { color: cssVar('--border', '#f1f5f9') } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

// Triggered by the Doughnut / Bar toggle in the Distribution card header.
// Persists choice, re-renders from the cached accounts (no API round-trip).
function setDistributionChartType(type) {
  if (type !== 'doughnut' && type !== 'bar') return;
  chartPrefs.distributionType = type;
  try { localStorage.setItem('piledger:distChart', type); } catch {}
  document.querySelectorAll('#distribution-type-toggle .chart-type-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.arg === type)
  );
  if (distributionAccounts.length) renderDistributionChart(distributionAccounts);
}
window.setDistributionChartType = setDistributionChartType;

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
      ...LINE_OPTS,
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 11 } } },
        y: { ticks: { callback: v => fmt(v), font: { size: 11 } }, grid: { color: cssVar('--border', '#f1f5f9') } },
      },
    },
  });

  /** @param {SavingsProjection} a */
  function createProjectionStatCard(a) {
    const cur = a.currency || 'GBP';
    const row = (label, value, interest) => {
      const r = el('div', { class: 'proj-row' }, el('span', null, label), el('span', { class: 'proj-value' }, fmt(value, cur)));
      r.append(interest != null ? el('span', { class: 'proj-interest' }, '+' + fmt(interest, cur)) : el('span'));
      return r;
    };
    return el('div', { class: 'card projection-card', style: `--accent-color:${a.color}` },
      el('div', { class: 'proj-name' }, a.name),
      el('div', { class: 'proj-rate' }, `${a.interest_rate}% AER (monthly compounding)`),
      el('div', { class: 'proj-rows' },
        row('Now', a.initial_balance, null),
        row('1 year', a['1yr'], a['1yr'] - a.initial_balance),
        row('2 years', a['2yr'], a['2yr'] - a.initial_balance),
        row('5 years', a['5yr'], a['5yr'] - a.initial_balance)));
  }
  document.getElementById('projection-stats').replaceChildren(...data.map(createProjectionStatCard));
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
      ...LINE_OPTS,
      plugins: {
        ...LINE_OPTS.plugins,
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

/** @param {BudgetItemOut} item @param {string} accCur */
function createBudgetItemRow(item, accCur) {
  const editBtn = el('button', { class: 'btn-icon', 'data-action': 'openEditBudgetModal', 'data-arg': String(item.id), title: 'Edit' });
  editBtn.innerHTML = '&#9998;';
  const delBtn = el('button', { class: 'btn-icon', 'data-action': 'openDeleteBudgetConfirm', 'data-arg': String(item.id), title: 'Remove' });
  delBtn.innerHTML = '&#10005;';
  return el('div', { class: 'bi-row' },
    el('div', { class: 'bi-info' },
      el('span', { class: 'bi-name' }, item.name),
      el('span', { class: 'bi-freq' }, item.frequency)),
    el('span', { class: `bi-amount ${item.amount < 0 ? 'outflow' : 'inflow'}` }, fmtSigned(item.amount, accCur)),
    editBtn, delBtn);
}

/** @param {BudgetProjectionAccount} acc @param {BudgetItemOut[]} accItems */
function createBudgetAccountCard(acc, accItems) {
  const accCur = acc.currency || 'GBP';
  const netClass = acc.monthly_net > 0 ? 'positive' : acc.monthly_net < 0 ? 'negative' : 'neutral';
  const netLabel = acc.monthly_net !== 0 ? fmtSigned(acc.monthly_net, accCur) + '/mo' : 'No items';

  const card = el('div', { class: 'card budget-account-card', style: `--accent-color:${acc.color}` },
    el('div', { class: 'bac-header' },
      el('div', null,
        el('div', { class: 'account-name' }, acc.name),
        el('span', { class: `badge badge-${acc.type}` }, acc.type)),
      el('div', { class: 'bac-meta' },
        el('span', { class: `bac-net ${netClass}` }, netLabel),
        el('button', { class: 'btn btn-primary btn-sm', 'data-action': 'openAddBudgetModal', 'data-arg': String(acc.id) }, '+ Add'))));
  if (accItems.length)
    card.append(el('div', { class: 'bi-list' }, ...accItems.map(i => createBudgetItemRow(i, accCur))));
  else
    card.append(el('p', { class: 'bi-empty' }, 'No budget items yet.'));
  return card;
}

/** @param {BudgetItemOut[]} items @param {BudgetProjectionResult} projection */
function renderBudgetItems(items, projection) {
  const grid = document.getElementById('budget-items-grid');
  if (!projection.accounts.length) {
    grid.replaceChildren(el('div', { class: 'empty-state', style: 'grid-column:1/-1' },
      el('p', null, 'Add an account to start planning your budget.')));
    return;
  }
  const byAccount = {};
  items.forEach(i => { (byAccount[i.account_id] ||= []).push(i); });
  grid.replaceChildren(...projection.accounts.map(acc =>
    createBudgetAccountCard(acc, byAccount[acc.id] || [])));
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
  if (e.key === 'Escape') {
    _closeMenu();
    document.querySelectorAll('.modal-overlay.open').forEach(el => closeModal(el.id));
  }
});

// Add Account
function openAddAccountModal() {
  document.getElementById('add-name').value = '';
  document.getElementById('add-type').value = 'current';
  document.getElementById('add-interest').value = '';
  document.getElementById('add-min-payment').value = '';
  document.getElementById('add-balance').value = '';
  document.getElementById('add-color').value = themeAccent();
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
  document.getElementById('edit-color').value    = a.color || themeAccent();
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
  grid.replaceChildren(...THEMES.map(t =>
    el('button', {
      type: 'button',
      class: `theme-swatch${t.id === prefs.theme ? ' active' : ''}`,
      'data-theme-id': t.id, 'data-action': 'setTheme', 'data-arg': t.id,
    },
      el('span', { class: 'theme-swatch-dot', style: `background:${t.swatch}` }),
      el('span', { class: 'theme-swatch-name' }, t.label))));
}

function renderModePill() {
  document.querySelectorAll('#settings-mode-pill button').forEach(b =>
    b.classList.toggle('active',
      (b.dataset.mode === 'dark') === prefs.dark_mode)
  );
}

function openSettingsModal() {
  _closeMenu();
  renderThemeGrid();
  renderModePill();
  renderCurrencySettings();
  // Reset the password-change section each open so a stale "Password updated"
  // status or leftover values from a prior interaction don't carry across.
  ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  _setPwStatus('');
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

function createRateRow(c, base) {
  const m = currencyMeta(c);
  const r = fxState.rates[c];
  const input = el('input', {
    type: 'number', class: 'rate-input', 'data-currency': c,
    step: '0.0001', min: '0', placeholder: '—',
  });
  if (r != null) input.value = r;
  return el('div', { class: 'rate-row', 'data-currency': c },
    el('span', { class: 'rate-from' }, `1 ${c}`),
    el('span', { class: 'rate-eq' }, '='),
    input,
    el('span', { class: 'rate-to' }, base),
    el('span', { class: 'rate-name' }, m.label.replace(/^[A-Z]+ — /, '')));
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
    table.replaceChildren();
    note.textContent = 'Add an account in another currency to manage exchange rates here.';
    saveBtn.style.display = 'none';
    return;
  }

  saveBtn.style.display = '';
  note.textContent = 'Rates are how the dashboard converts to your base currency for net-worth totals.';
  table.replaceChildren(...rows.map(c => createRateRow(c, base)));
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

// ─── Password change ─────────────────────────────────────────────────────────
// Uses raw `fetch` rather than the `api` wrapper because `apiFetch` redirects
// to /login on 401, and the password-change route returns 401 specifically
// when the *current* password is wrong — which the user should see inline,
// not be silently kicked out for. The 200 response also carries a refreshed
// session cookie (every prior session for the user was rotated), so the
// browser stays logged in seamlessly after the call.
function _setPwStatus(text, kind) {
  const el = document.getElementById('pw-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('ok', 'error');
  if (kind) el.classList.add(kind);
}

async function submitPasswordChange() {
  const cur     = document.getElementById('pw-current').value;
  const next    = document.getElementById('pw-new').value;
  const confirm = document.getElementById('pw-confirm').value;

  if (!cur || !next || !confirm) {
    _setPwStatus('Fill in all three fields.', 'error');
    return;
  }
  if (next.length < 8) {
    _setPwStatus('New password must be at least 8 characters.', 'error');
    return;
  }
  if (next !== confirm) {
    _setPwStatus('New password and confirmation do not match.', 'error');
    return;
  }
  if (next === cur) {
    _setPwStatus('New password must differ from the current one.', 'error');
    return;
  }

  _setPwStatus('Updating…');
  try {
    const res = await fetch('/api/auth/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: cur, new_password: next }),
    });
    if (res.status === 401) {
      _setPwStatus('Current password is incorrect.', 'error');
      return;
    }
    if (res.status === 400) {
      _setPwStatus('New password rejected by the server.', 'error');
      return;
    }
    if (!res.ok) {
      _setPwStatus(`Unexpected error (HTTP ${res.status}).`, 'error');
      return;
    }
    document.getElementById('pw-current').value = '';
    document.getElementById('pw-new').value     = '';
    document.getElementById('pw-confirm').value = '';
    _setPwStatus('Password updated. Other devices signed out.', 'ok');
  } catch (e) {
    _setPwStatus('Network error: ' + e.message, 'error');
  }
}

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

// ─── Header dropdown menu ───────────────────────────────────────────────────
function toggleMenu() {
  const dd = document.getElementById('header-dropdown');
  const btn = document.getElementById('btn-menu');
  const opening = dd.hasAttribute('hidden');
  if (opening) dd.removeAttribute('hidden');
  else         dd.setAttribute('hidden', '');
  btn.setAttribute('aria-expanded', String(opening));
}

function _closeMenu() {
  const dd = document.getElementById('header-dropdown');
  const btn = document.getElementById('btn-menu');
  if (!dd || dd.hasAttribute('hidden')) return;
  dd.setAttribute('hidden', '');
  btn.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', e => {
  const wrap = document.querySelector('.header-menu-wrap');
  if (wrap && !wrap.contains(e.target)) _closeMenu();
});

// ─── Event delegation for data-action / data-action-change ───────────────────
// CSP-safe replacement for inline onclick=/onchange= attributes. A handler at
// the document level looks up [data-action] on the closest ancestor, parses an
// optional data-arg, and invokes the named function from the global scope.
// Functions are looked up by name from window — the action names live on
// markup we author, not on user input, so this is not an injection path.
function _parseActionArg(s) {
  if (s === undefined) return undefined;
  if (s === 'true')    return true;
  if (s === 'false')   return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const fn = window[t.dataset.action];
  if (typeof fn !== 'function') return;
  const arg = _parseActionArg(t.dataset.arg);
  arg !== undefined ? fn(arg) : fn();
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-action-change]');
  if (!t) return;
  const fn = window[t.dataset.actionChange];
  if (typeof fn !== 'function') return;
  t.hasAttribute('data-pass-value') ? fn(t.value) : fn();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  await loadPrefs();
  await loadRates();
  await loadAll();
  _applyView(currentView());
})();
