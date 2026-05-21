# PiLedger

A self-hosted personal finance dashboard for tracking current, savings, and loan/debt accounts — including historical balance trends, compound-interest projections on savings, monthly budget planning, and net-worth tracking against liabilities.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Requirements](#requirements)
3. [Architecture](#architecture)
4. [File Structure](#file-structure)
5. [Database Schema](#database-schema)
6. [Backend — API Reference](#backend--api-reference)
7. [Authentication System](#authentication-system)
8. [Frontend](#frontend)
9. [Building and Running](#building-and-running)
10. [Network Access](#network-access)
11. [Testing](#testing)
12. [Security Notes](#security-notes)
13. [License](#license)

---

## Getting Started

Pick the path that fits how you want to run PiLedger. Docker Compose is the lowest-friction option for trying it out; the local Python flows are better if you want to hack on the code.

| Path | Best for | Prereqs |
|---|---|---|
| [Docker Compose](#run-with-docker-compose) | Just trying it / self-hosting on a server you already use Docker on | Docker Engine + Compose v2 (`docker compose ...`) |
| [Local — `uv`](#local-setup-with-uv-fast) | Developers who want the fastest possible install | Python 3.12, [uv](https://docs.astral.sh/uv/) |
| [Local — `pip` + `venv`](#local-setup-with-pip--venv) | Developers without `uv`, or anyone who prefers the standard toolchain | Python 3.12 |

Whichever path you pick, the dashboard ends up on **http://localhost:8080**. The first visit redirects to `/login`; click **Register** to create your first account.

### Run with Docker Compose

The repository ships a `Dockerfile` and `docker-compose.yml` that build a Python 3.12 image, run the app as a non-root user, and persist your SQLite database in a named volume so it survives rebuilds.

```bash
# From the project root
docker compose up -d                # build the image and start the service in the background
docker compose logs -f piledger      # follow the application logs (Ctrl+C to detach)
```

Then open **http://localhost:8080**.

To stop the container without losing data:

```bash
docker compose down                 # keeps the piledger-data volume → your accounts persist
```

To wipe the database and start fresh:

```bash
docker compose down -v              # also drops the piledger-data volume
```

To back up your data, copy the SQLite file out of the running container:

```bash
docker compose cp piledger:/data/piledger.db ./piledger-backup.db
```

#### Configuration

Override defaults via environment variables on the host before running `docker compose up`. The most useful are:

| Variable | Default | Purpose |
|---|---|---|
| `COOKIE_SECURE` | unset | Set to `true` when fronting the container with an HTTPS-terminating proxy so session cookies only travel over TLS. |

The host port (`8080`) is set in `docker-compose.yml`; change the left half of `"8080:8080"` if 8080 is already in use on your host. The container always serves on 8080 internally.

### Local setup with `uv` (fast)

[`uv`](https://docs.astral.sh/uv/) is a Rust-based Python package manager — typically 10–100× faster than `pip` for cold installs. The commands below assume `uv` is already on your `PATH` (install with `curl -LsSf https://astral.sh/uv/install.sh | sh` if not).

```bash
# From the project root
uv venv venv                                 # create the venv/ directory
uv pip install -r requirements.txt           # install runtime deps into venv/
uv pip install -r requirements-dev.txt       # (optional) test + lint tools

./start.sh                                   # serves on 0.0.0.0:8080
```

The repository's tooling (`start.sh`, the systemd snippet in [Building and Running](#building-and-running)) expects the virtualenv at `venv/`, which is why we pass that name to `uv venv` instead of the default `.venv`.

### Local setup with `pip` + `venv`

The standard-library flow — no extra tooling required beyond Python 3.12 itself.

```bash
# From the project root
python3 -m venv venv                                 # create the virtual environment
./venv/bin/pip install -r requirements.txt           # install runtime dependencies
./venv/bin/pip install -r requirements-dev.txt       # (optional) test + lint tools

./start.sh                                           # serves on 0.0.0.0:8080
```

The full operational reference — environment variables, running headless, the systemd service unit, firewall notes — lives in [Building and Running](#building-and-running) and [Network Access](#network-access) below.

---

## Requirements

The following requirements were captured and are met by the current implementation.

| # | Requirement | How it is met |
|---|---|---|
| R1 | Self-hosted, runs on a virtual machine | Python/FastAPI server with no cloud dependencies; all data stored in a local SQLite file |
| R2 | Accessible from any device on the network | Server binds to `0.0.0.0` so any device that can reach the host's IP and port can open the dashboard |
| R3 | Graphical interface | Single-page web app served directly by the backend; works in any modern browser |
| R4 | Track current, savings, and loan account balances | All three account types are supported with distinct display treatment; loans appear as liabilities and subtract from net worth |
| R5 | Add and remove accounts | Accounts can be created via the "Add Account" modal and deleted from the Edit modal with confirmation |
| R6 | Update account balances | "Update Balance" records a new balance snapshot with optional notes |
| R7 | Graphs of historical balances | Step-line chart showing all accounts over a selectable window (30 days – 1 year) |
| R8 | Projected balances | Compound-interest projection chart (1, 2, or 5 years) with per-account summary cards |
| R9 | Interest rates on savings accounts | Annual interest rate (AER %) stored per savings account; used for monthly-compounding projections |
| R10 | Login-gated access | Login page required before the dashboard is visible; session cookie enforced on every API route |
| R11 | Per-user account isolation | Every account row carries a `user_id` foreign key; all queries filter by the authenticated user |
| R12 | Budget planning with recurring items | `budget_items` table plus a dedicated Budget Planner view; month-by-month projections combining cash flows with interest compounding |
| R13 | Loan / debt tracking with net-worth view | `'loan'` account type; balances subtract from net worth; APR-based interest accrual; payments modelled as negative budget items |

---

## Architecture

```
Browser  ──HTTP──►  FastAPI (src/app.py)  ──┬──►  schemas.py  (Pydantic in/out models)
                         │              ├──►  auth.py     (hashing, sessions)
                         │              ├──►  db.py       (connection + init/migrations)
                         │              └──►  constants.py (DB path, cookie flags, bounds)
                         │                     │
                         │                     └──SQL──►  SQLite (piledger.db)
                         │
                    static/  (served by StaticFiles mount)
                    ├── index.html   (dashboard SPA — Overview + Budget views)
                    ├── login.html   (auth page)
                    ├── style.css
                    └── app.js
```

**Backend:** Python 3.12, FastAPI, Uvicorn. The application source lives under `src/` and is split across six modules: `app.py` (routes), `schemas.py` (Pydantic request/response models), `auth.py` (password hashing + session lifecycle + `require_auth` dependency), `db.py` (connection context manager, schema init/migrations, money helpers), `constants.py` (DB path, cookie flags, type aliases, API bounds), and `security.py` (the defensive-headers middleware). The database is SQLite, accessed directly via the standard-library `sqlite3` module — no ORM.

**Frontend:** Vanilla JavaScript (no framework), Chart.js 4.4 loaded from CDN, Inter font from Google Fonts. The SPA has two views — Overview and Budget Planner — switched via a sticky nav tab inside the header. No build step is required.

**Database:** A single SQLite file. Defaults to `piledger.db` at the project root (one level above `src/`); can be overridden via the `PILEDGER_DB` environment variable. Money is stored as integer cents inside the database; the JSON API exposes plain floating-point pounds.

---

## File Structure

```
piledger/
├── src/                   Application source (Python + frontend)
│   ├── app.py             Backend — FastAPI routes
│   ├── auth.py            Password hashing, session lifecycle, require_auth dependency
│   ├── db.py              SQLite connection, init() + migrations, cents↔pounds helpers
│   ├── constants.py       DB path, cookie flags, type aliases, money/rate/days bounds
│   ├── schemas.py         Pydantic request/response models (validation lives here)
│   ├── security.py        SecurityHeadersMiddleware (HSTS, CSP, frame-deny, …)
│   └── static/
│       ├── index.html     Dashboard SPA — Overview + Budget Planner + all modals
│       ├── login.html     Login / register page
│       ├── style.css      All styles (shared between dashboard and login page)
│       ├── app.js         Dashboard JavaScript — API calls, chart rendering, modals
│       └── vendor/        Vendored Chart.js + Inter font (served self-hosted)
├── requirements.txt       Runtime dependencies (fastapi, uvicorn)
├── requirements-dev.txt   Test dependencies (pytest, httpx)
├── pytest.ini             pytest config (testpaths = tests, pythonpath = src)
├── start.sh               Convenience wrapper: starts uvicorn on 0.0.0.0:8080
├── Dockerfile             Container image definition — Python 3.12-slim, non-root user, healthcheck
├── docker-compose.yml     One-service orchestration with a persistent named volume for the DB
├── .dockerignore          Excludes venv, *.db, tests/, etc. from the image build context
├── piledger.db            SQLite database (auto-created; gitignored)
├── CHANGELOG.md           Versioned change log (Keep a Changelog format)
├── CLAUDE.md              Project instructions for the Claude Code agent
├── .gitignore             Excludes *.db, venv/, __pycache__/, .env, etc.
├── venv/                  Python virtual environment
└── tests/                 pytest suite (see Testing section)
    ├── conftest.py        Shared fixtures (isolated test DB, alice/bob clients)
    ├── e2e/               Playwright browser tests (opt-in)
    └── test_*.py          Unit / API suite — runs by default
```

---

## Database Schema

### `users`

Stores registered accounts. Usernames are case-insensitive (SQLite `COLLATE NOCASE`).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `username` | TEXT UNIQUE | Case-insensitive |
| `password_hash` | TEXT | `salt:pbkdf2_hex` — see [Authentication](#authentication-system) |
| `created_at` | TEXT | UTC ISO-8601, set by SQLite `datetime('now')` |

### `sessions`

One row per active login session. Deleted on logout; expires after 30 days.

| Column | Type | Notes |
|---|---|---|
| `token` | TEXT PK | 64-character hex string (32 random bytes) |
| `user_id` | INTEGER FK → `users.id` | Cascade-deletes when user is removed |
| `expires_at` | TEXT | UTC ISO-8601 |

### `accounts`

Financial accounts. Each row belongs to exactly one user.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK → `users.id` | Nullable to support schema migration |
| `name` | TEXT | Display name, e.g. "Barclays Current" |
| `type` | TEXT | Constrained to `'current'`, `'savings'`, or `'loan'` |
| `interest_rate` | REAL | Annual rate as a percentage (e.g. `4.5` for 4.5% AER on savings, or APR on loans) |
| `color` | TEXT | Hex colour used in chart lines and card borders |
| `created_at` | TEXT | UTC ISO-8601 |

### `balance_history`

Immutable log of balance snapshots. Every "Update Balance" action appends a new row; no row is ever modified.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `account_id` | INTEGER FK → `accounts.id` | Cascade-deletes when account is removed |
| `balance_cents` | INTEGER | Balance in GBP stored as integer cents to avoid float drift; the API exposes pounds |
| `notes` | TEXT | Optional free-text annotation |
| `recorded_at` | TEXT | UTC ISO-8601, set by the server at insert time |

### `budget_items`

Recurring cash-flow items used by the Budget Planner — one row per item, attached to a single account. Positive amounts are inflows, negative amounts are outflows; for loan accounts a negative amount represents a payment that reduces the balance.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK → `users.id` | Cascade-deletes when user is removed |
| `account_id` | INTEGER FK → `accounts.id` | Cascade-deletes when account is removed |
| `name` | TEXT | Display name, e.g. "Rent" or "Minimum monthly payment" |
| `amount_cents` | INTEGER | Signed amount in cents (+ inflow, − outflow) |
| `frequency` | TEXT | One of `'weekly'`, `'monthly'`, `'quarterly'`, `'annually'`. Normalised to a monthly equivalent via `FREQ_TO_MONTHLY` (in `constants.py`) before any projection is calculated. |
| `created_at` | TEXT | UTC ISO-8601 |

### Schema migrations

`init()` in `db.py` runs on startup and applies all migrations idempotently — `CREATE TABLE IF NOT EXISTS` for fresh databases plus four additive migrations for existing ones:

1. **`accounts.user_id` (0.2.0)** — added via `ALTER TABLE` if absent. Pre-auth rows get `user_id = NULL` and are invisible to all authenticated users, which is the safe default.
2. **`accounts.type` widening (0.6.0)** — SQLite cannot alter a `CHECK` constraint in place, so the table is recreated with the wider `CHECK(type IN ('current','savings','loan'))` constraint, preserving all rows. Detected by scanning `sqlite_master.sql` for the absence of `'loan'`.
3. **`balance_history.balance REAL` → `balance_cents INTEGER`** — table rebuilt; values converted with `CAST(ROUND(balance * 100) AS INTEGER)`.
4. **`budget_items.amount REAL` → `amount_cents INTEGER`** — same approach as (3).

All migrations are no-ops on a database that is already at the current schema.

---

## Backend — API Reference

All routes under `/api/` (except `/api/auth/register` and `/api/auth/login`) require a valid session cookie. A missing or expired cookie returns `HTTP 401`.

### Auth

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/login` | — | Serves `login.html` |
| `POST` | `/api/auth/register` | `{username, password}` | `{id, username}` or `400`/`409` |
| `POST` | `/api/auth/login` | `{username, password}` | `{ok, username}` + sets cookie, or `401` |
| `POST` | `/api/auth/logout` | — (reads cookie) | `{ok}` + deletes session + clears cookie |
| `GET` | `/api/auth/me` | — | `{id, username}` |

### Accounts

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/accounts` | — | Array of account objects, each with `current_balance` and `last_updated` joined from the latest `balance_history` row |
| `POST` | `/api/accounts` | `{name, type, interest_rate?, color?}` | Created account object |
| `PUT` | `/api/accounts/{id}` | `{name?, interest_rate?, color?}` | Updated account object |
| `DELETE` | `/api/accounts/{id}` | — | `{ok}` |

### Balance history

| Method | Path | Params | Response |
|---|---|---|---|
| `POST` | `/api/accounts/{id}/balance` | Body: `{balance, notes?, recorded_at?}` | `{ok}` |
| `GET` | `/api/accounts/{id}/history` | `?days=90` | Array of `{balance, notes, recorded_at}` |

### Dashboard

| Method | Path | Params | Response |
|---|---|---|---|
| `GET` | `/api/summary` | — | `{total, total_current, total_savings, total_loans, account_count}` — `total` is **net worth** (`total_current + total_savings − total_loans`), not a flat sum |
| `GET` | `/api/history/all` | `?days=90` | Array of `{id, name, color, type, history[]}` for accounts that have at least one entry in the window |
| `GET` | `/api/projections` | `?months=24` | Array of projection objects for each savings account; includes pre-computed `1yr`, `2yr`, `5yr` values and a full `points[]` array for charting |

### Budget Planner

All routes require auth and operate only on items owned by the calling user. The `account_id` on create / update is verified to belong to the user — a foreign account returns `404`.

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/budget` | — | Array of budget items: `{id, user_id, account_id, name, amount, frequency, created_at}` |
| `POST` | `/api/budget` | `{account_id, name, amount, frequency}` | Created item. `amount` is signed (+ inflow, − outflow). `frequency` ∈ `weekly|monthly|quarterly|annually`. |
| `PUT` | `/api/budget/{id}` | `{name?, amount?, frequency?}` | Updated item |
| `DELETE` | `/api/budget/{id}` | — | `{ok}` |
| `GET` | `/api/budget/projection` | `?months=3\|6\|12` | `{months, accounts[], net_worth[]}` — see below |

The `accounts[]` array in `/api/budget/projection` contains one entry per account with `{id, name, type, color, current_balance, monthly_net, points[], final_balance}`. The `net_worth[]` array contains one entry per month (including month 0 = today) with `{month, balance, date}`, where `balance` is `Σ(assets) − Σ(loans)` at that month.

### Projection calculation

**Savings projections** (`/api/projections`) — compound interest with monthly compounding:

```
monthly_rate = (annual_rate_percent / 100) / 12
balance(m) = initial_balance × (1 + monthly_rate)^m
```

One data point per month for the requested horizon, plus pre-computed milestones at 12, 24, and 60 months.

**Budget projections** (`/api/budget/projection`) — combines cash flows with interest compounding. For each month after month 0:

```
new_balance = (old_balance + monthly_net_cashflow) × (1 + monthly_rate)
```

Current accounts have `monthly_rate = 0`, so they accumulate cash flows linearly. Savings accounts grow on the post-cashflow balance. Loan accounts use the same formula — interest accrues on the outstanding balance each month, and negative budget items (payments) reduce that balance.

### Error responses

Bad input returns `400` with a `{"detail": ...}` body. Authentication failures return `401`. Resources owned by another user return `404`. Conflicts (e.g. duplicate username on register) return `409`.

### SPA routing

`GET /` checks the session cookie. If valid, it serves `static/index.html`. If invalid or absent, it returns a `302` redirect to `/login`. All static assets are served under the `/static/` prefix by FastAPI's `StaticFiles` mount, which is registered last so it cannot shadow any API routes.

---

## Authentication System

### Password storage

Passwords are never stored in plaintext. On registration:

1. A 16-byte (32-hex-character) random salt is generated with `secrets.token_hex(16)`.
2. The password is hashed using `hashlib.pbkdf2_hmac('sha256', password, salt, 260_000)` — 260 000 PBKDF2-SHA256 iterations, which is above the OWASP minimum recommendation.
3. The stored value is `"<salt_hex>:<key_hex>"`.

On login, the salt is extracted from the stored value, the candidate password is hashed with the same parameters, and the result is compared using `secrets.compare_digest` to prevent timing attacks.

No third-party password library is required — only Python's standard-library `hashlib` and `secrets` modules.

### Sessions

After a successful login the server:

1. Generates a 64-character hex token (`secrets.token_hex(32)`) — 256 bits of entropy.
2. Purges any session rows whose `expires_at` is in the past (cheap housekeeping on every login).
3. Writes `(token, user_id, expires_at)` to the `sessions` table. Expiry is 30 days from now.
4. Sets an `HttpOnly; SameSite=Lax` cookie named `piledger_session` with `Max-Age=2592000`. The `Secure` flag is also set when the `COOKIE_SECURE` environment variable is `true` / `1` / `yes` — turn this on whenever the app is served over HTTPS.

`HttpOnly` means JavaScript cannot read the cookie, which prevents token theft via XSS. `SameSite=Lax` provides CSRF protection for state-changing requests.

On every protected request FastAPI's `require_auth` dependency (defined in `auth.py`) reads the cookie, queries the `sessions` table for a non-expired matching row, and either injects the `user_id` into the route handler or raises `HTTP 401`.

On logout the session row is deleted from the database and the cookie is cleared. The token is immediately invalid even if the browser retains it.

### Login timing-attack mitigation

`auth.py:dummy_hash()` keeps a single PBKDF2-hashed constant in memory. If a login request arrives with a username that does not exist, the server still runs `verify_password` against this dummy hash before returning `401`. This keeps the time-to-respond statistically indistinguishable between "unknown user" and "wrong password," so an attacker cannot enumerate valid usernames by measuring response latency.

---

## Frontend

### Login page (`login.html`)

A self-contained page with no external JavaScript dependencies. It contains:

- A segmented tab control to switch between **Sign in** and **Register** forms.
- Inline validation (password confirmation match, minimum length).
- Inline error display using `role="alert"` on error elements.
- After a successful registration the page automatically posts a login request and redirects to `/`, so the user never has to sign in manually after creating their account.

### Dashboard (`index.html` + `app.js`)

The dashboard is a single-page application with two views — **Overview** and **Budget Planner** — switched via a sticky nav tab inside the header. The header also shows the signed-in username, a Sign-out button, and a live **Net Worth** total.

On load `app.js` fires `loadAll()`, which makes three parallel requests for the Overview view:

```
GET /api/accounts
GET /api/summary
GET /api/auth/me
```

If any of these returns `401` the `apiFetch` helper immediately redirects to `/login` and returns a promise that never resolves, preventing any further rendering.

Once the initial data arrives, charts are loaded in a second parallel batch:

```
GET /api/history/all
GET /api/projections
```

The distribution chart is rendered synchronously from the account data already in memory.

The Budget Planner view is lazy-loaded the first time the user opens that tab. `loadBudgetView()` makes two parallel requests:

```
GET /api/budget
GET /api/budget/projection?months=<3|6|12>
```

#### Summary cards (Overview)

Four cards across the top of the Overview view: **Total Savings**, **Current Accounts**, **Total Debt**, and **Accounts** (count). On viewports below 960px the grid collapses to 2×2; below 500px to a single column.

#### Charts

All charts use **Chart.js 4.4** in category-scale mode (no date adapter required).

| Chart | View | Type | Data source | Notes |
|---|---|---|---|---|
| Balance History | Overview | Stepped line | `GET /api/history/all` | One dataset per account. Dates are de-duplicated across all accounts and sorted; missing values for a given account are forward-filled from the previous known balance, producing an accurate step representation of how balances changed over time. |
| Distribution | Overview | Doughnut | Account list (in memory) | Accounts with no recorded balance are excluded. **Loans are excluded** — this chart shows asset distribution, not liabilities. |
| Savings Projections | Overview | Smooth line | `GET /api/projections` | One dataset per savings account. The section is hidden entirely if no savings accounts exist. |
| Projected Balances | Budget | Multi-series line | `GET /api/budget/projection` | One dataset per account plus a bold dark **Net Worth** line layered on top. Loan lines are rendered with a dashed stroke so a downward trend reads as "debt being paid down" rather than an asset losing value. A faint dashed red zero-reference line is injected automatically if any account is projected to go negative. |

Chart instances are stored in the `charts` object (`history`, `distribution`, `projection`, `budget`) and explicitly destroyed before redrawing to prevent memory leaks when the user changes the time-window selector or budget period.

#### Modals

Six modal dialogs handle all write operations:

| Modal | Trigger | Operation |
|---|---|---|
| Add Account | Header button | Creates account; optionally records an opening balance in the same flow. For loans, also accepts a "Minimum Monthly Payment" and creates a matching monthly budget item. |
| Update Balance | "Update Balance" on account card | Appends a new `balance_history` row; pre-fills the current balance |
| Edit Account | Pencil icon on account card | Updates name, interest rate, or colour. Interest-rate label switches between "AER (%)" (savings) and "APR (%)" (loan). |
| Confirm Delete Account | "Delete Account" inside Edit modal | Two-step confirmation before deleting |
| Budget Item (add / edit) | "+ Add" on toolbar or account card; pencil on an item row | Creates or edits a recurring item. Loan-aware: when the selected account is a loan, the direction toggle and frequency dropdown are hidden, and the amount field is relabeled "Minimum Monthly Payment". |
| Confirm Delete Budget Item | × icon on an item row | Two-step confirmation before removing |

Modals close on overlay click or `Escape`. The `Enter` key submits the active modal form (textareas excluded).

#### State management

A single plain object (`state`) holds:

- **Overview**: `accounts`, `editingId`, `updatingId`, `deletingId`.
- **Budget**: `budgetPeriod` (3 / 6 / 12 months), `budgetItems`, `editingBudgetId` (`null` for add mode), `deletingBudgetId`, `biDir` (`'in'` or `'out'`).

After any write operation `loadAll()` (Overview) or `loadBudgetView()` (Budget) is called to refresh the relevant view.

---

## Building and Running

This section is the deeper reference for the local-Python flow. If you just want to try the app, the [Getting Started](#getting-started) section at the top has shorter recipes including the Docker Compose path.

### Prerequisites

- Python 3.12
- No other system-level dependencies

### First-time setup

Two equivalent recipes — pick whichever package manager you prefer.

**With `pip` + `venv` (standard library only):**

```bash
cd /path/to/piledger

python3 -m venv venv
./venv/bin/pip install -r requirements.txt

# (Optional) test + lint dependencies
./venv/bin/pip install -r requirements-dev.txt
```

**With [`uv`](https://docs.astral.sh/uv/) (faster cold installs):**

```bash
cd /path/to/piledger

uv venv venv
uv pip install -r requirements.txt

# (Optional) test + lint dependencies
uv pip install -r requirements-dev.txt
```

Both flows produce the same `venv/` layout, so `./start.sh`, the systemd snippet below, and `./venv/bin/pytest` all work identically regardless of which manager you used.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PILEDGER_DB` | `piledger.db` at the project root | Absolute or relative path to the SQLite database file. Useful for pointing different environments (dev / staging / prod) at different databases without editing source. |
| `COOKIE_SECURE` | `false` | When set to `true` / `1` / `yes`, the session cookie is issued with the `Secure` flag so it is only transmitted over HTTPS. Enable this whenever you front the app with a TLS-terminating proxy. |

### Running the server

```bash
./start.sh
```

This is equivalent to:

```bash
./venv/bin/uvicorn --app-dir src app:app --host 0.0.0.0 --port 8080
```

The server starts, creates `piledger.db` on first run, and begins serving on port 8080. The terminal will display one log line per request.

To stop the server press `Ctrl+C`.

### First login

Navigate to `http://localhost:8080` (or the VM's IP from another device). You will be redirected to `/login`. Click **Register** to create your account. After registration you are automatically signed in and redirected to the dashboard.

### Changing the port

Edit `start.sh` and replace `--port 8080` with any available port. If the port is below 1024 the process will need to run as root (not recommended) or you can use a port above 1024 and front it with a reverse proxy.

### Running in the background (persistent)

To keep PiLedger running after you close your terminal, use a process manager or `nohup`:

```bash
nohup ./start.sh > piledger.log 2>&1 &
echo $! > piledger.pid   # save the PID to stop it later
```

To stop it:

```bash
kill $(cat piledger.pid)
```

For a more robust setup, create a systemd service:

```ini
# /etc/systemd/system/piledger.service
[Unit]
Description=PiLedger Finance Dashboard
After=network.target

[Service]
User=charlie
WorkingDirectory=/home/charlie/git/piledger
ExecStart=/home/charlie/git/piledger/venv/bin/uvicorn --app-dir /home/charlie/git/piledger/src app:app --host 0.0.0.0 --port 8080
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now piledger
```

---

## Network Access

The server binds to `0.0.0.0`, which means it listens on all network interfaces. Any device on the same network as the VM can reach the dashboard at:

```
http://<VM-IP-address>:8080
```

To find the VM's IP address:

```bash
ip addr show | grep 'inet ' | grep -v 127.0.0.1
```

### Firewall

If the VM runs a firewall (e.g. `ufw`), the port must be opened:

```bash
sudo ufw allow 8080/tcp
```

### HTTPS

The server currently runs over plain HTTP. This is acceptable on a trusted local network but means the session cookie and financial data are unencrypted in transit. To add HTTPS, put a reverse proxy such as **nginx** or **Caddy** in front of Uvicorn and terminate TLS there. Caddy can obtain and renew a Let's Encrypt certificate automatically if the VM has a public domain name.

---

## Testing

### Automated test suite

The project ships with **112 pytest tests** across six files in `tests/`. They run against an isolated SQLite database per test (set up by `tests/conftest.py:app`, which monkeypatches `constants.DB` to a fresh `tmp_path` file and re-runs `init()`). All API access goes through `starlette.testclient.TestClient`, so the tests exercise the real FastAPI app end-to-end without binding a network port.

```bash
./venv/bin/pytest          # full suite (≈30s on a typical machine)
./venv/bin/pytest tests/test_loans.py     # one file
./venv/bin/pytest -q -k "isolation"       # name-filtered subset
```

| File | Tests | Coverage |
|---|---|---|
| `tests/test_auth.py` | 21 | Registration rules, login, session cookie issuance, `/api/auth/me`, logout invalidation, token replay after logout, redirect for unauthenticated users |
| `tests/test_accounts.py` | 20 | Full CRUD lifecycle, partial updates, 404 on missing IDs, auth enforcement, cross-user isolation for list / update / delete |
| `tests/test_balances.py` | 15 | Recording, latest-entry selection with multiple entries, notes, chronological ordering, `?days=` window filter via back-dated `recorded_at`, cascade deletion, isolation |
| `tests/test_dashboard.py` | 25 | Summary totals across types, latest-balance selection, isolation; `history/all` inclusion/exclusion logic and date windowing; projection maths against the compound-interest formula, zero-interest flat-line, point counts, milestone consistency |
| `tests/test_loans.py` | 13 | Loan creation, summary inclusion, net-worth subtraction, isolation, interest accrual with no payments, payment-driven balance reduction, `net_worth` array shape, asset-only edge cases, budget item round-trip on a loan |
| `tests/test_edge_cases.py` | 18 | Zero balance, very large balance, multi-account totals, special characters and Unicode in names, fractional interest rate precision, high interest rate (no crash), projection point counts for all supported periods, delete-then-create flow, password / username boundary lengths |

The two shared fixtures `alice` and `bob` both depend on a single per-test `app` fixture instance, so they share one database — which is what the isolation tests need (one user must not see another's data).

### Manual smoke tests (curl)

The pytest suite is the source of truth; the curl recipes below remain useful for spot-checking a running deployment from another host.

```bash
./venv/bin/uvicorn --app-dir src app:app --host 0.0.0.0 --port 8080 &
sleep 2
```

### Auth smoke tests

**Unauthenticated request to `/` redirects to `/login`**
```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:8080/
# Expected: 302 http://localhost:8080/login
```

**Unauthenticated API request returns 401**
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/accounts
# Expected: 401
```

**Register a new user**
```bash
curl -s -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"hunter99!"}'
# Expected: {"id":1,"username":"alice"}
```

**Register with duplicate username returns 409**
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"another123"}'
# Expected: 409
```

**Register with short password returns 400**
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","password":"short"}'
# Expected: 400
```

**Login and capture session token**
```bash
COOKIE_JAR=$(mktemp)
curl -s -c "$COOKIE_JAR" -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"hunter99!"}'
TOKEN=$(grep piledger_session "$COOKIE_JAR" | awk '{print $NF}')
# Expected response body: {"ok":true,"username":"alice"}
# Expected: TOKEN is a 64-character hex string
```

**Login with wrong password returns 401**
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"wrongpass"}'
# Expected: 401
```

**Authenticated request to `/api/auth/me`**
```bash
curl -s http://localhost:8080/api/auth/me -H "Cookie: piledger_session=$TOKEN"
# Expected: {"id":1,"username":"alice"}
```

**Logout invalidates the token**
```bash
curl -s -X POST http://localhost:8080/api/auth/logout -H "Cookie: piledger_session=$TOKEN"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/accounts \
  -H "Cookie: piledger_session=$TOKEN"
# Expected second request: 401
```

### Account isolation smoke tests

**Accounts created by alice are not visible to bob**
```bash
# Register bob
curl -s -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","password":"password123"}'

# Login as alice, create an account
curl -s -X POST http://localhost:8080/api/auth/login ... # (capture ALICE_TOKEN)
curl -s -X POST http://localhost:8080/api/accounts \
  -H "Cookie: piledger_session=$ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Savings","type":"savings","interest_rate":4.0}'

# Login as bob, list accounts — must be empty
curl -s -X POST http://localhost:8080/api/auth/login ... # (capture BOB_TOKEN)
curl -s http://localhost:8080/api/accounts -H "Cookie: piledger_session=$BOB_TOKEN"
# Expected: []
```

**Cross-user account access returns 404**
```bash
# Attempt to update alice's account (id=1) as bob
curl -s -o /dev/null -w "%{http_code}\n" \
  -X PUT http://localhost:8080/api/accounts/1 \
  -H "Cookie: piledger_session=$BOB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Stolen"}'
# Expected: 404
```

### Data flow smoke tests

**Create account, record balance, verify summary**
```bash
ACC=$(curl -s -X POST http://localhost:8080/api/accounts \
  -H "Cookie: piledger_session=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Monzo","type":"current","color":"#f97316"}')
AID=$(echo $ACC | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

curl -s -X POST http://localhost:8080/api/accounts/$AID/balance \
  -H "Cookie: piledger_session=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"balance":1500.00}'

curl -s http://localhost:8080/api/summary -H "Cookie: piledger_session=$TOKEN"
# Expected: {"total":1500.0,"total_current":1500.0,"total_savings":0.0,"account_count":1}
```

**Compound interest projection**
```bash
curl -s "http://localhost:8080/api/projections?months=12" \
  -H "Cookie: piledger_session=$TOKEN"
# For a savings account with £8000 at 4.1% AER:
# Expected 1yr ≈ £8334.23  (8000 × (1 + 0.041/12)^12)
```

### Static asset tests

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/static/style.css
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/static/app.js
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/login
# All expected: 200
```

---

## Security Notes

**What is protected:**

- Passwords are hashed with PBKDF2-SHA256 at 260 000 iterations; the salt is unique per user.
- Session tokens have 256 bits of entropy and are stored `HttpOnly` so they are not accessible to JavaScript.
- All database queries use parameterised statements; SQL injection is not possible.
- Account ownership is enforced at the database query level (`WHERE user_id = ?`) on every read and write operation, not just at the route level.
- HTML output in the dashboard is escaped via a custom `esc()` function before being inserted into the DOM, preventing stored XSS from account names or notes.
- `POST /api/auth/login` is rate-limited via [SlowAPI](https://slowapi.readthedocs.io/) at a default of **5 attempts per minute** per source IP. The cap is configurable with `PILEDGER_LOGIN_RATE_LIMIT` (slowapi string syntax, e.g. `10/minute`, `100/hour`). The limiter is keyed by the socket peer IP — so behind a reverse proxy every client shares one bucket, and the proxy must still do real per-client rate limiting (see below). On the bare-metal LAN deployment this is a real defence-in-depth backstop against online brute-force.
- HTTP responses carry a strict defensive header set on every reply: HSTS (one year, `includeSubDomains`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a `Permissions-Policy` disabling geolocation/microphone/camera/payment, and a Content-Security-Policy locked to `'self'` for scripts/connect/font with no `'unsafe-inline'` on `script-src`. See `security.py`.

**What is not protected:**

- There is no built-in HTTPS. On a trusted LAN this is generally acceptable, but the session cookie and all data are transmitted in plaintext. Front the app with a TLS-terminating reverse proxy (nginx, Caddy) for any internet-facing deployment, and set `COOKIE_SECURE=true` so the session cookie is only sent over HTTPS.
- The app-layer login rate limit (above) keys on the socket peer IP. Behind a reverse proxy that means **every client shares one bucket** — the limiter still caps the *aggregate* login rate but cannot distinguish between distinct upstream IPs. Add proxy-layer rate limiting (e.g. nginx `limit_req`, Caddy `rate_limit`) before exposing the service to the public internet, since only the proxy can see real client IPs.
- There is no account lockout or two-factor authentication.
- Expired session rows are opportunistically purged inside `make_session()` (every successful login deletes any session whose `expires_at` is in the past), so the `sessions` table self-trims as long as users keep logging in. There is no scheduled cleanup for the case where no one logs in for a long time.

---

## License

PiLedger is distributed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). The full license text is in the [`LICENSE`](LICENSE) file at the root of this repository.

The AGPL adds one obligation on top of the GPL: if you run a modified version of PiLedger as a network service that other people interact with, you must offer those users the corresponding source code of your modified version. For self-hosted personal use this changes nothing in practice; it matters only if you intend to operate PiLedger as a hosted service for third parties.
