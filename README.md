# FinDash

A self-hosted personal finance dashboard for tracking current and savings account balances, historical trends, and projected growth from interest.

---

## Table of Contents

1. [Requirements](#requirements)
2. [Architecture](#architecture)
3. [File Structure](#file-structure)
4. [Database Schema](#database-schema)
5. [Backend — API Reference](#backend--api-reference)
6. [Authentication System](#authentication-system)
7. [Frontend](#frontend)
8. [Building and Running](#building-and-running)
9. [Network Access](#network-access)
10. [Testing](#testing)
11. [Security Notes](#security-notes)

---

## Requirements

The following requirements were captured and are met by the current implementation.

| # | Requirement | How it is met |
|---|---|---|
| R1 | Self-hosted, runs on a virtual machine | Python/FastAPI server with no cloud dependencies; all data stored in a local SQLite file |
| R2 | Accessible from any device on the network | Server binds to `0.0.0.0` so any device that can reach the host's IP and port can open the dashboard |
| R3 | Graphical interface | Single-page web app served directly by the backend; works in any modern browser |
| R4 | Track current and savings account balances | Both account types are supported with distinct display treatment |
| R5 | Add and remove accounts | Accounts can be created via the "Add Account" modal and deleted from the Edit modal with confirmation |
| R6 | Update account balances | "Update Balance" records a new balance snapshot with optional notes |
| R7 | Graphs of historical balances | Step-line chart showing all accounts over a selectable window (30 days – 1 year) |
| R8 | Projected balances | Compound-interest projection chart (1, 2, or 5 years) with per-account summary cards |
| R9 | Interest rates on savings accounts | Annual interest rate (AER %) stored per savings account; used for monthly-compounding projections |
| R10 | Login-gated access | Login page required before the dashboard is visible; session cookie enforced on every API route |
| R11 | Per-user account isolation | Every account row carries a `user_id` foreign key; all queries filter by the authenticated user |

---

## Architecture

```
Browser  ──HTTP──►  FastAPI (app.py)  ──SQL──►  SQLite (findash.db)
                         │
                    static/  (served by StaticFiles mount)
                    ├── index.html   (dashboard SPA)
                    ├── login.html   (auth page)
                    ├── style.css
                    └── app.js
```

**Backend:** Python 3.12, FastAPI, Uvicorn. All business logic lives in a single `app.py` file. The database is SQLite, accessed directly via the standard-library `sqlite3` module — no ORM.

**Frontend:** Vanilla JavaScript (no framework), Chart.js 4.4 loaded from CDN, Inter font from Google Fonts. The SPA is a single HTML + CSS + JS bundle; no build step is required.

**Database:** A single file, `findash.db`, created automatically alongside `app.py` on first run.

---

## File Structure

```
findash/
├── app.py           Backend — FastAPI application, all routes and auth helpers
├── requirements.txt Python dependencies (fastapi, uvicorn)
├── start.sh         Convenience wrapper: starts uvicorn on 0.0.0.0:8080
├── findash.db       SQLite database (auto-created; gitignore this)
├── venv/            Python virtual environment
└── static/
    ├── index.html   Dashboard single-page application
    ├── login.html   Login / register page
    ├── style.css    All styles (shared between dashboard and login page)
    └── app.js       Dashboard JavaScript — API calls, chart rendering, modals
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
| `type` | TEXT | Constrained to `'current'` or `'savings'` |
| `interest_rate` | REAL | Annual rate as a percentage (e.g. `4.5` for 4.5% AER) |
| `color` | TEXT | Hex colour used in chart lines and card borders |
| `created_at` | TEXT | UTC ISO-8601 |

### `balance_history`

Immutable log of balance snapshots. Every "Update Balance" action appends a new row; no row is ever modified.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `account_id` | INTEGER FK → `accounts.id` | Cascade-deletes when account is removed |
| `balance` | REAL | Balance in GBP at the time of recording |
| `notes` | TEXT | Optional free-text annotation |
| `recorded_at` | TEXT | UTC ISO-8601, set by the server at insert time |

### Schema migration

On startup, `init()` checks `PRAGMA table_info(accounts)`. If the `user_id` column is absent (schema predates authentication), it is added via `ALTER TABLE`. Existing rows get `user_id = NULL` and are invisible to all authenticated users, which is the safe default for a fresh install.

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
| `GET` | `/api/summary` | — | `{total, total_current, total_savings, account_count}` |
| `GET` | `/api/history/all` | `?days=90` | Array of `{id, name, color, type, history[]}` for accounts that have at least one entry in the window |
| `GET` | `/api/projections` | `?months=24` | Array of projection objects for each savings account; includes pre-computed `1yr`, `2yr`, `5yr` values and a full `points[]` array for charting |

### Projection calculation

Compound interest is calculated using monthly compounding:

```
monthly_rate = (annual_rate_percent / 100) / 12
balance(m) = initial_balance × (1 + monthly_rate)^m
```

The backend returns one data point per month for the requested horizon, plus pre-computed milestone values at 12, 24, and 60 months.

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
2. Writes `(token, user_id, expires_at)` to the `sessions` table. Expiry is 30 days from now.
3. Sets an `HttpOnly; SameSite=Lax` cookie named `findash_session` with `Max-Age=2592000`.

`HttpOnly` means JavaScript cannot read the cookie, which prevents token theft via XSS. `SameSite=Lax` provides CSRF protection for state-changing requests.

On every protected request FastAPI's `require_auth` dependency reads the cookie, queries the `sessions` table for a non-expired matching row, and either injects the `user_id` into the route handler or raises `HTTP 401`.

On logout the session row is deleted from the database and the cookie is cleared. The token is immediately invalid even if the browser retains it.

---

## Frontend

### Login page (`login.html`)

A self-contained page with no external JavaScript dependencies. It contains:

- A segmented tab control to switch between **Sign in** and **Register** forms.
- Inline validation (password confirmation match, minimum length).
- Inline error display using `role="alert"` on error elements.
- After a successful registration the page automatically posts a login request and redirects to `/`, so the user never has to sign in manually after creating their account.

### Dashboard (`index.html` + `app.js`)

The dashboard is a single-page application. On load `app.js` fires `loadAll()`, which makes three parallel requests:

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

#### Charts

All three charts use **Chart.js 4.4** in category-scale mode (no date adapter required).

| Chart | Type | Data source | Notes |
|---|---|---|---|
| Balance History | Stepped line | `GET /api/history/all` | One dataset per account. Dates are de-duplicated across all accounts and sorted; missing values for a given account are forward-filled from the previous known balance, producing an accurate step representation of how balances changed over time. |
| Distribution | Doughnut | Account list (in memory) | Accounts with no recorded balance are excluded. Shows the share of total wealth held in each account. |
| Savings Projections | Smooth line | `GET /api/projections` | One dataset per savings account. The section is hidden entirely if no savings accounts exist. |

Chart instances are stored in the `charts` object and explicitly destroyed before redrawing to prevent memory leaks when the user changes the time-window selector.

#### Modals

Four modal dialogs handle all write operations:

| Modal | Trigger | Operation |
|---|---|---|
| Add Account | Header button | Creates account; optionally records an opening balance in the same flow |
| Update Balance | "Update Balance" on account card | Appends a new `balance_history` row; pre-fills the current balance |
| Edit Account | Pencil icon on account card | Updates name, interest rate, or colour |
| Confirm Delete | "Delete Account" inside Edit modal | Two-step confirmation before deleting |

Modals close on overlay click or `Escape`. The `Enter` key submits the active modal form.

#### State management

A single plain object (`state`) holds:

- `accounts` — the last fetched account list; used by modals without a re-fetch.
- `editingId` / `updatingId` / `deletingId` — which account each modal is currently operating on.

After any write operation `loadAll()` is called to refresh the entire view.

---

## Building and Running

### Prerequisites

- Python 3.12 (installed at `/usr/bin/python3`)
- No other system-level dependencies

### First-time setup

```bash
cd /home/charlie/git/findash

# Create the virtual environment and install dependencies
python3 -m venv venv
./venv/bin/pip install fastapi "uvicorn[standard]"
```

The virtual environment and installed packages are already in place in this repository — the above only needs to be repeated if `venv/` is deleted.

### Running the server

```bash
./start.sh
```

This is equivalent to:

```bash
./venv/bin/uvicorn app:app --host 0.0.0.0 --port 8080
```

The server starts, creates `findash.db` on first run, and begins serving on port 8080. The terminal will display one log line per request.

To stop the server press `Ctrl+C`.

### First login

Navigate to `http://localhost:8080` (or the VM's IP from another device). You will be redirected to `/login`. Click **Register** to create your account. After registration you are automatically signed in and redirected to the dashboard.

### Changing the port

Edit `start.sh` and replace `--port 8080` with any available port. If the port is below 1024 the process will need to run as root (not recommended) or you can use a port above 1024 and front it with a reverse proxy.

### Running in the background (persistent)

To keep FinDash running after you close your terminal, use a process manager or `nohup`:

```bash
nohup ./start.sh > findash.log 2>&1 &
echo $! > findash.pid   # save the PID to stop it later
```

To stop it:

```bash
kill $(cat findash.pid)
```

For a more robust setup, create a systemd service:

```ini
# /etc/systemd/system/findash.service
[Unit]
Description=FinDash Finance Dashboard
After=network.target

[Service]
User=charlie
WorkingDirectory=/home/charlie/git/findash
ExecStart=/home/charlie/git/findash/venv/bin/uvicorn app:app --host 0.0.0.0 --port 8080
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now findash
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

No automated test suite is included. The application was verified through manual curl-based smoke tests during development. The test scenarios and their expected outcomes are documented below so they can be repeated after any change.

### Environment

```bash
./venv/bin/uvicorn app:app --host 0.0.0.0 --port 8080 &
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
TOKEN=$(grep findash_session "$COOKIE_JAR" | awk '{print $NF}')
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
curl -s http://localhost:8080/api/auth/me -H "Cookie: findash_session=$TOKEN"
# Expected: {"id":1,"username":"alice"}
```

**Logout invalidates the token**
```bash
curl -s -X POST http://localhost:8080/api/auth/logout -H "Cookie: findash_session=$TOKEN"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/accounts \
  -H "Cookie: findash_session=$TOKEN"
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
  -H "Cookie: findash_session=$ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Savings","type":"savings","interest_rate":4.0}'

# Login as bob, list accounts — must be empty
curl -s -X POST http://localhost:8080/api/auth/login ... # (capture BOB_TOKEN)
curl -s http://localhost:8080/api/accounts -H "Cookie: findash_session=$BOB_TOKEN"
# Expected: []
```

**Cross-user account access returns 404**
```bash
# Attempt to update alice's account (id=1) as bob
curl -s -o /dev/null -w "%{http_code}\n" \
  -X PUT http://localhost:8080/api/accounts/1 \
  -H "Cookie: findash_session=$BOB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Stolen"}'
# Expected: 404
```

### Data flow smoke tests

**Create account, record balance, verify summary**
```bash
ACC=$(curl -s -X POST http://localhost:8080/api/accounts \
  -H "Cookie: findash_session=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Monzo","type":"current","color":"#f97316"}')
AID=$(echo $ACC | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

curl -s -X POST http://localhost:8080/api/accounts/$AID/balance \
  -H "Cookie: findash_session=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"balance":1500.00}'

curl -s http://localhost:8080/api/summary -H "Cookie: findash_session=$TOKEN"
# Expected: {"total":1500.0,"total_current":1500.0,"total_savings":0.0,"account_count":1}
```

**Compound interest projection**
```bash
curl -s "http://localhost:8080/api/projections?months=12" \
  -H "Cookie: findash_session=$TOKEN"
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

**What is not protected:**

- There is no HTTPS. On a trusted LAN this is generally acceptable, but the session cookie and all data are transmitted in plaintext. Add a TLS-terminating reverse proxy for any internet-facing deployment.
- There is no rate limiting on login attempts. A password can be brute-forced over the network. This is acceptable for a home LAN but should be addressed (e.g. via nginx `limit_req`) before exposing the service to the public internet.
- There is no account lockout or two-factor authentication.
- Expired session rows are never purged from the database. This is harmless (they are ignored by all queries) but the `sessions` table will grow over time. A periodic `DELETE FROM sessions WHERE expires_at < datetime('now')` would keep it tidy.
