# Changelog

All notable changes to FinDash are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.6.1] — 2026-05-19

### Fixed

**Test suite broken by auth/db refactor**

The refactor that split `app.py` into `auth.py`, `db.py`, `constants.py`, and `schemas.py` (commit `c180dbd`) regressed two things that the test suite caught only after rerun:

- `tests/conftest.py` was still monkeypatching `app.DB`, but the `DB` constant had moved to `constants.py` (`db.db()` reads `constants.DB` at call time). Every test errored out at fixture setup with `AttributeError: module 'app' has no attribute 'DB'`. Fixed by patching `constants.DB` instead — one-line change, plus a docstring update describing the new attachment point.
- Bad-input validation that previously raised `HTTPException(400, ...)` inline was moved into Pydantic `_In` schemas in `schemas.py`. Pydantic's default failure code is `422`, so the public contract documented in `README.md` (lines 145, 441-447) and the 0.6.0 CHANGELOG entry ("returns `400` for anything else") silently drifted. Added a `RequestValidationError` handler in `app.py` that returns `400` with the Pydantic error payload, restoring the documented status code without losing the structured error detail.

After both fixes: `./venv/bin/pytest` → **112 passed**.

### Changed

**Loan budget UX — minimum monthly payment**

The budget section's "Money in / Money out" paradigm reads naturally for current and savings accounts but is counter-intuitive for loans, where the only useful budget concept is the monthly payment. This release reframes the loan flow without changing the underlying data model — loan payments are still stored as negative monthly `budget_items`, but the user never has to think in those terms.

- `static/index.html` — **Add Account modal**: new optional `Minimum Monthly Payment (£)` field shown only when type=Loan. The existing "Opening Balance" label switches to **"Amount Owed"** for loans so the field reads as a liability rather than an asset.
- `static/index.html` — **Budget Item modal**: the direction toggle and frequency dropdown are wrapped in fields with IDs (`bim-direction-field`, `bim-frequency-field`), and the amount label gained an id (`bim-amount-label`) so they can be hidden / relabeled per account type. The account `<select>` now fires `onBudgetAccountChange()` when the user picks a different account so the form adapts live.
- `static/app.js` — `toggleAddInterest()` now also toggles the min-payment group and rewrites the balance label. `submitAddAccount()` creates the loan first, then issues a follow-up `POST /api/budget` with `amount = -minPay`, `frequency = 'monthly'`, `name = 'Minimum monthly payment'` when the min-payment field is populated.
- `static/app.js` — new `_applyBudgetModalForAccount(accountId)` helper inspects the selected account's type; for loans it hides the direction toggle and frequency field, relabels the amount as "Minimum Monthly Payment (£)", forces direction to "out" and frequency to "monthly", and defaults the description to "Minimum monthly payment" if blank. Invoked from `openAddBudgetModal`, `openEditBudgetModal`, and `onBudgetAccountChange` so the modal adapts whether opened from the toolbar, a per-account card, an edit click, or a mid-edit account switch.
- Backend untouched — `POST /api/budget`, the projection maths in `app.py`, and the existing tests in `tests/test_loans.py` all keep working because the on-disk representation of a loan payment is unchanged (negative amount, monthly frequency).

---

## [0.6.0] — 2026-05-18

### Loans & Debt Tracking

#### Added

**Backend**
- `'loan'` is now a valid account type alongside `'current'` and `'savings'`. Loans store their balance as a positive number (the amount owed) and accrue interest each month; budget items with negative amounts represent payments that reduce the balance.
- Schema migration in `init()` — uses `sqlite_master.sql` to detect tables created with the old `CHECK(type IN ('current','savings'))` constraint and recreates them with the wider `CHECK(type IN ('current','savings','loan'))` constraint, preserving all existing rows. Migration is a no-op for fresh databases.
- `GET /api/summary` now returns `total_loans` and computes `total` as **net worth** (current + savings − loans) instead of a flat sum of balances. The "Net Worth" figure in the header now reflects liabilities correctly.
- `POST /api/accounts` validates that `type` is one of `current`, `savings`, or `loan` and returns `400` for anything else (error message updated accordingly).
- `GET /api/budget/projection` response now includes a `net_worth` array — one entry per month — computed as `sum(assets) − sum(loans)`. Available even when there are no loans, so the frontend always has a single line representing overall trajectory.

**Frontend**
- Summary row expanded from 3 to 4 cards: Total Savings · Current Accounts · **Total Debt** · Accounts. Responsive breakpoints adjusted so the grid collapses to 2×2 below 960px and a single column below 500px.
- Add Account modal: the type dropdown gained a `Loan / Debt` option, and the interest-rate field now appears for both savings and loan accounts. The field label switches between "Annual Interest Rate (%)" and "APR (%)" based on the chosen type.
- Edit Account modal: same dynamic label behaviour; the rate field is shown for loans as well as savings.
- Account cards show loans with a red `loan` badge, label the rate as "APR" in red instead of green "AER", and replace "Updated:" with "Owed ·" so a high balance reads as a liability rather than an asset.
- Distribution doughnut chart now excludes loans — it shows where the user's **assets** are held, not their debts.
- Budget Planner projection chart includes a bold dark **Net Worth** line on top of the per-account lines, giving a single read of overall trajectory. Loan lines are rendered with a dashed stroke so a downward trend visually parses as "debt being paid down" rather than an asset losing value.
- Monthly Breakdown table totals row now shows **Net worth** (assets − liabilities) at each month, sourced from the new `net_worth` array. The monthly-net column flips the sign for loans so a payment of −£1,200 contributes +£1,200 to net worth growth.

**Tests**
- `tests/test_loans.py` — 12 new tests covering loan creation, summary inclusion, net worth subtraction, user isolation, interest accrual with no payments, balance reduction under payments, `net_worth` array shape, asset-only edge cases, and budget item round-trip on a loan account.
- `test_summary_empty` in `tests/test_dashboard.py` updated to include `total_loans: 0.0` in the expected response shape.

---

## [0.5.2] — 2026-05-17

### Security

- **`FINDASH_DB` environment variable** — the database path is now read from `FINDASH_DB` if set, falling back to `findash.db` alongside `app.py`. Prevents the path from being baked into committed code and makes it easy to point different environments at different databases without editing source.
- **`COOKIE_SECURE` environment variable** — the session cookie now sets `Secure=True` when `COOKIE_SECURE=true` (or `1` / `yes`) is present in the environment. Defaults to `False` for plain HTTP, but should be enabled whenever the app is served over HTTPS.
- **`.gitignore`** — added to exclude `*.db` (user credentials and financial data), `venv/`, `__pycache__/`, `.pytest_cache/`, `.env` files, and `.claude/settings.local.json` (per-developer Claude Code permission allowlists). Nothing sensitive is included in the initial commit.

---

## [0.5.1] — 2026-05-17

### Fixed

- **Missing spacing between dashboard sections** — when the navigation tabs were introduced in 0.5.0, all overview sections (summary cards, accounts grid, charts row, savings projections) were wrapped in a `<div id="view-overview">`. The `gap: 28px` on `.main` only applies to direct children, so once those sections were no longer direct children of `.main`, all vertical spacing between them was lost. Fixed by adding `display: flex; flex-direction: column; gap: 28px` to both `#view-overview` and `#view-budget`, restoring consistent 28px gaps between every section in both views.

---

## [0.5.0] — 2026-05-17

### Budget Planner

A full budgeting view has been added alongside the existing dashboard, accessible via a persistent navigation bar at the top of the page.

#### Added

**Navigation**
- Sticky two-tab nav bar inside the header — "Overview" (existing dashboard) and "Budget Planner" (new view). Switching is instant; the budget view lazy-loads its data on first visit and does not re-fetch the overview unnecessarily.

**Backend**
- `budget_items` table — stores recurring cash-flow items per account: `name`, `amount` (positive = money in, negative = money out), `frequency` (`weekly` / `monthly` / `quarterly` / `annually`), foreign-keyed to both `users` and `accounts` with cascade deletion.
- `FREQ_TO_MONTHLY` constant — normalises weekly, quarterly, and annual amounts to their monthly equivalent before any projection is calculated.
- `GET /api/budget` — list all budget items for the authenticated user.
- `POST /api/budget` — create a budget item; verifies the target account belongs to the current user.
- `PUT /api/budget/{id}` — update a budget item's name, amount, or frequency.
- `DELETE /api/budget/{id}` — remove a budget item.
- `GET /api/budget/projection?months=3|6|12` — compute month-by-month projected balances for all accounts. Each month applies cash flows first, then compounds savings interest: `new_balance = (old_balance + monthly_net) × (1 + monthly_rate)`. Current accounts have `monthly_rate = 0`, so they simply accumulate net cash flows. Responds with per-account `monthly_net`, `points[]`, and `final_balance`. Returns `400` for any `months` value other than 3, 6, or 12.

**Budget Planner UI**
- Period selector — segmented control to switch between 3, 6, and 12-month projections; updates the chart and breakdown table without reloading items.
- **Projected Balances chart** — line chart with one series per account; a faint dashed red zero-reference line is injected automatically if any account is projected to go negative; subtitle notes that savings interest is included.
- **Budget Items grid** — one card per account, colour-coded with the account's chosen colour. Each card shows the account's total monthly net flow (+/−) and a list of its items with signed amounts. Per-account "+ Add" button pre-selects that account; global "+ Add Budget Item" button available in the toolbar.
- **Monthly Breakdown table** — sticky first column, one column per period from Now through the final month. Negative balances rendered in red. Totals row summarises net worth and combined monthly flow. Table is horizontally scrollable on narrow viewports.
- **Budget Item modal** (shared add / edit) — account selector (add only; account is fixed on edit), description field, direction toggle ("Money out" / "Money in" styled red/green), amount, frequency dropdown. Confirmation modal for deletion.

---

## [0.4.0] — 2026-05-17

### Test Suite

A complete automated test suite was introduced covering all application behaviour.

#### Added

- `tests/` directory containing 99 tests across 5 files.
- `tests/conftest.py` — shared pytest fixtures. The `app` fixture monkeypatches `app.DB` to a fresh `tmp_path` file and re-runs `app.init()`, giving each test a fully isolated SQLite database. `alice` and `bob` fixtures create authenticated `TestClient` instances that share the same test DB, enabling cross-user isolation tests.
- `tests/test_auth.py` (21 tests) — registration rules (minimum lengths, duplicate username, case-insensitivity), login, session cookie issuance, `/api/auth/me`, logout invalidation, token replay after logout, route-level redirect for unauthenticated users.
- `tests/test_accounts.py` (20 tests) — full CRUD lifecycle, creation order, partial updates, 404 on missing IDs, auth enforcement, complete cross-user isolation for list / update / delete.
- `tests/test_balances.py` (15 tests) — recording, latest-entry selection with multiple entries, notes, chronological ordering, `days` filter using back-dated `recorded_at`, cascade deletion, auth and isolation enforcement.
- `tests/test_dashboard.py` (25 tests) — summary totals across account types, correct use of latest balance only, user isolation; `history/all` inclusion / exclusion logic and date window filtering; projection maths verified against the compound-interest formula, zero-interest flat-line, point count, milestone consistency (1yr / 2yr / 5yr).
- `tests/test_edge_cases.py` (18 tests) — zero balance, very large balance, multi-account totals, special characters and Unicode in names, fractional interest rate precision, high interest rate (no crash), projection point counts for all supported periods, delete-then-create flow, password and username boundary lengths.
- `pytest.ini` — sets `testpaths = tests` and `pythonpath = .` so `import app` resolves from the project root.
- `requirements-dev.txt` — test dependencies: `pytest>=9.0`, `httpx>=0.25`.

#### Fixed

- **Stale balance returned on simultaneous inserts** — `ORDER BY recorded_at DESC LIMIT 1` in `list_accounts`, `get_summary`, and `get_projections` had no tiebreaker, causing non-deterministic results when two balance entries shared the same timestamp (reproducible in fast test runs, possible in production if two updates arrived within the same second). Fixed by adding `id DESC` as a secondary sort key: `ORDER BY recorded_at DESC, id DESC LIMIT 1`.

---

## [0.3.0] — 2026-05-17

### Documentation

#### Added

- `README.md` — comprehensive technical reference covering:
  - Requirements table mapping each original requirement (R1–R11) to its implementation.
  - Architecture overview with an ASCII request-path diagram and tech-stack rationale.
  - Annotated file-structure tree.
  - Full database schema with column-level documentation for all four tables and an explanation of the `user_id` migration strategy.
  - API reference for all routes including request / response shapes and the compound-interest projection formula.
  - Authentication system deep-dive: PBKDF2-SHA256 hashing parameters, session token entropy, cookie security flags, and logout invalidation behaviour.
  - Frontend section covering the login page flow, dashboard boot sequence, chart rendering approach (date de-duplication, forward-fill for step charts), and modal state machine.
  - Build and run instructions including `nohup` and systemd service examples.
  - Network access guidance: finding the VM's IP, firewall rules, HTTPS recommendation.
  - Testing section: complete set of curl-reproducible smoke tests with expected outputs, grouped by auth, isolation, data flow, and static assets.
  - Security notes distinguishing what is protected (parameterised queries, timing-safe comparison, HttpOnly cookies, ownership checks at the DB layer, HTML escaping) from what is not (no rate limiting, no HTTPS, no session purge).

---

## [0.2.0] — 2026-05-17

### Authentication

#### Added

**Backend**
- `users` table — `username` (case-insensitive unique via `COLLATE NOCASE`), `password_hash`, `created_at`.
- `sessions` table — 64-character hex token (32 random bytes, 256-bit entropy), `user_id` FK, `expires_at`; cascade-deleted when the user is removed.
- Schema migration — on startup `init()` checks `PRAGMA table_info(accounts)` and adds a `user_id` column via `ALTER TABLE` if absent, making the upgrade from the pre-auth schema non-destructive. Existing rows with `user_id = NULL` are not visible to any authenticated user.
- `hash_password` — PBKDF2-SHA256 with a 32-hex-character random salt and 260 000 iterations using only Python standard-library `hashlib` and `secrets`.
- `verify_password` — timing-safe comparison via `secrets.compare_digest`.
- `make_session` — generates a token, stores it with an expiry 30 days from now.
- `session_uid` — validates a token against the database and checks expiry.
- `require_auth` FastAPI dependency — reads the `findash_session` cookie and raises `HTTP 401` if missing or expired; injects `user_id` into all protected routes.
- `POST /api/auth/register` — validates minimum lengths (username ≥ 2 chars, password ≥ 8 chars), returns `409` on duplicate username.
- `POST /api/auth/login` — verifies credentials, sets an `HttpOnly; SameSite=Lax; Max-Age=2592000` session cookie.
- `POST /api/auth/logout` — deletes the session row from the database and clears the cookie; idempotent (safe to call without a session).
- `GET /api/auth/me` — returns `{id, username}` for the current session.
- All account, balance, summary, history, and projection routes now require authentication and filter all queries by `user_id`, preventing any cross-user data access.
- `GET /` now redirects to `/login` (HTTP 302) when no valid session cookie is present.

**Frontend**
- `static/login.html` — standalone login / register page using the shared `style.css`. Tabbed interface (Sign in / Register) with inline error messages and `role="alert"` for accessibility. Auto-logs in after successful registration so users do not need to sign in manually.
- Username and "Sign out" button added to the dashboard header.
- `apiFetch` helper updated to redirect to `/login` on any `HTTP 401` response, so any expired or missing session across any API call is handled transparently.
- `logout()` function posts to `/api/auth/logout` then navigates to `/login`.
- Dashboard loads the current username from `/api/auth/me` on boot and displays it in the header.

---

## [0.1.0] — 2026-05-17

### Initial Release

#### Added

**Backend (`app.py`)**
- FastAPI application served by Uvicorn, binding to `0.0.0.0` for LAN access.
- SQLite database (`findash.db`) auto-created on first run via `init()` using `CREATE TABLE IF NOT EXISTS`.
- `accounts` table — `name`, `type` (`current` / `savings`), `interest_rate`, `color`, `created_at`.
- `balance_history` table — immutable log of balance snapshots: `account_id`, `balance`, `notes`, `recorded_at`; cascade-deleted when the parent account is removed.
- `GET /api/accounts` — lists all accounts joined with their latest balance entry.
- `POST /api/accounts` — creates a current or savings account with optional colour and interest rate.
- `PUT /api/accounts/{id}` — updates name, interest rate, or colour.
- `DELETE /api/accounts/{id}` — removes account and all its balance history via cascade.
- `POST /api/accounts/{id}/balance` — appends a balance snapshot; accepts an optional `recorded_at` ISO timestamp for back-dating.
- `GET /api/accounts/{id}/history?days=N` — returns balance history for a rolling window.
- `GET /api/summary` — returns `total`, `total_current`, `total_savings`, `account_count`.
- `GET /api/history/all?days=N` — returns balance history for all accounts in the window, used to populate the history chart.
- `GET /api/projections?months=N` — compound-interest projections for all savings accounts using monthly compounding: `A = P × (1 + r/12)^m`. Returns pre-computed 1yr / 2yr / 5yr milestones plus a full `points[]` array.
- `GET /` — serves `static/index.html`.
- Static files mounted at `/static/`.

**Frontend**
- `static/index.html` — single-page application shell with four modals: Add Account, Update Balance, Edit Account, Confirm Delete.
- `static/style.css` — CSS custom-property–based design system; card layout with colour-coded account borders; responsive grid collapsing to single column on mobile.
- `static/app.js` — vanilla JavaScript with no framework. State held in a plain object. All API calls go through a central `apiFetch` wrapper. Charts managed via Chart.js 4.4 (CDN):
  - *Balance History* — stepped line chart per account. Dates are de-duplicated across all accounts and sorted; missing entries for a given account are forward-filled from the previous known balance, accurately representing a balance that stays constant until updated.
  - *Portfolio Distribution* — doughnut chart with each account as a segment.
  - *Savings Projections* — smooth line chart per savings account showing compound growth; per-account stat cards with 1yr / 2yr / 5yr values and interest earned. Section hidden when no savings accounts exist.
- Add Account modal records an optional opening balance in the same request flow.
- Update Balance modal pre-fills the current balance.
- Edit Account modal shows the interest rate field only for savings accounts.
- ESC key and overlay click close any open modal; Enter submits the active modal form.
- Accounts sorted by creation date; account cards show AER % for savings accounts.

**Infrastructure**
- `requirements.txt` — `fastapi>=0.104.0`, `uvicorn[standard]>=0.24.0`.
- `start.sh` — wraps `uvicorn app:app --host 0.0.0.0 --port 8080` for convenience.
- Python virtual environment created at `venv/`.
