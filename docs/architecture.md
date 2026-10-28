# Architecture

```
Browser  ──HTTP──►  FastAPI (src/app.py — thin wiring + lifespan)
                         │
                         ├──►  autopost.py  (startup catch-up + daily run ──► services/posting.py)
                         │
                         ├──►  routers/*.py  (one APIRouter per resource: HTTP handlers)
                         │          ├──►  services/*.py  (shared business logic: FX, balances,
                         │          │                     transactions, posting, projection, CSV)
                         │          ├──►  schemas.py     (Pydantic in/out models)
                         │          ├──►  auth.py        (hashing, sessions, require_auth)
                         │          ├──►  db.py          (connection + init/migrations)
                         │          ├──►  constants.py   (DB path, cookie flags, bounds)
                         │          └──►  limiter.py     (shared rate limiter)
                         │                     │
                         │                     └──SQL──►  SQLite (piledger.db)
                         │
                    static/dist/  (React SPA build, served by the pages router + StaticFiles mount)
```

**Backend:** Python 3.12, FastAPI, Uvicorn. The application source lives under `src/`. `app.py` is a thin (~100-line) wiring module: it constructs the FastAPI app, registers the security-headers middleware and the 422→400 validation handler, calls `init()`, starts the auto-post timer in its lifespan, and includes every router. The HTTP handlers themselves live in per-resource routers under `routers/` (one `APIRouter` each: `auth`, `accounts`, `transactions`, `imports`, `dashboard`, `budget`, `goals`, `subscriptions`, `prefs`, `rates`, `categories`, `tokens`, `ops`, `pages`), and business logic shared between routers, or kept apart so it can be tested without HTTP, lives in `services/`:

- `currency` — FX conversion into the base currency.
- `accounts` — balance adjustment and the latest-balance lookups.
- `transactions` — inserting and deleting transactions and transfers together with their balance effect. Shared by the transactions router and the poster, so a posted transaction moves the balance exactly as a hand-entered one does.
- `subscriptions` — recurrence date maths for scheduled items (due dates, month-end clamping).
- `posting` — turning scheduled items' due dates into real transactions, exactly once, via the `subscription_postings` log; also Post now, Skip and Undo.
- `projection` — the per-account projected balance: a pure, database-free roll-forward through scheduled items and monthly AER interest, behind `GET /api/accounts/{id}/projection`.
- `csv_import` and `import_matching` — CSV parsing, and matching import rows to transactions a schedule already posted.

**Auto-post.** `autopost.py` decides when posting runs. `app.py`'s lifespan calls `autopost.start()` at startup, which runs a catch-up for every user (in a worker thread, awaited before the first request is served) and then starts a daily asyncio task that runs again at `PILEDGER_AUTOPOST_TIME` (server-local, default `00:05`). Shutdown cancels the task. The posting itself is `services/posting.post_due_for_everyone()`; runs are idempotent, so a run that overlaps `POST /api/subscriptions/post-due` can't post a date twice. `PILEDGER_AUTOPOST_TIME=off` skips both the catch-up and the timer (the test suite runs this way). The remaining modules are shared infrastructure: `schemas.py` (Pydantic request/response models), `auth.py` (password hashing + session lifecycle + `require_auth` dependency), `db.py` (connection context manager, schema init/migrations, money helpers), `constants.py` (DB path, cookie flags, type aliases, API bounds), `security.py` (the defensive-headers middleware), and `limiter.py` (the shared rate limiter). Routers depend on these but never import `app`, so the dependency graph stays acyclic. The database is SQLite, accessed directly via the standard-library `sqlite3` module — no ORM.

**Frontend:** A React 19 single-page app written in TypeScript and built with Vite (TanStack Query for the server cache, React Router for navigation). Charts are a mix of Recharts (line/area) and hand-rolled SVG/CSS (the asset donut, the horizontal bars and the budget-vs-actual trend). Fonts — Plus Jakarta Sans (UI) and JetBrains Mono (figures) — are self-hosted from `/static/fonts/`. The SPA has seven screens — Overview, Accounts, Transactions, Budget, Goals, Scheduled and Settings — plus a page per account (`/accounts/:id`), reached through a sidebar that collapses to a bottom tab strip on narrow viewports. `npm run build` in `frontend/` emits the production bundle to `src/static/dist/`, which the backend serves for every SPA route; the login and guide (documentation) pages are separate self-contained static HTML pages. See [Frontend](frontend.md) for detail.

**Database:** A single SQLite file. Defaults to `piledger.db` at the project root (one level above `src/`); can be overridden via the `PILEDGER_DB` environment variable. Money is stored as integer cents inside the database; the JSON API exposes plain floating-point pounds.

## Requirements

| # | Requirement | How it is met |
|---|---|---|
| R1 | Self-hosted, runs on a virtual machine | Python/FastAPI server with no cloud dependencies; all data stored in a local SQLite file |
| R2 | Accessible from any device on the network | Server binds to `0.0.0.0` so any device that can reach the host's IP and port can open the dashboard |
| R3 | Graphical interface | Single-page web app served directly by the backend; works in any modern browser |
| R4 | Track current, savings, and loan account balances | All three account types are supported with distinct display treatment; loans appear as liabilities and subtract from net worth |
| R5 | Add and remove accounts | Accounts can be created via the "Add Account" modal and deleted from the Edit modal with confirmation |
| R6 | Update account balances | "Update Balance" records a new balance snapshot with optional notes, plus a Balance adjustment transaction for any change |
| R7 | Graphs of historical balances | Step-line chart showing all accounts over a selectable window (30 days - 1 year) |
| R8 | Projected balances | Each account's page projects its balance 1, 3, 6 and 12 months ahead from its scheduled transactions and monthly interest; the Overview's savings projections window shows each savings account at 1, 2 and 5 years |
| R9 | Interest rates on savings accounts | Annual interest rate (AER %) stored per savings account; used for monthly-compounding projections |
| R10 | Login-gated access | Login page required before the dashboard is visible; session cookie enforced on every API route |
| R11 | Per-user account isolation | Every account row carries a `user_id` foreign key; all queries filter by the authenticated user |
| R12 | Budgeting | Zero-based envelope **Budget** screen backed by the `budget_income` / `budget_group` / `budget_envelope` tables; the user assigns income across envelope groups and actual spend per envelope is computed live from transactions by category |
| R13 | Loan / debt tracking with net-worth view | `'loan'` account type; balances subtract from net worth; APR-based interest accrual |

## File Structure

```
piledger/
├── src/                   Application source (Python + frontend)
│   ├── app.py             Backend — thin FastAPI wiring: middleware, exception handler, init(), lifespan, include_router calls
│   ├── autopost.py        When auto-post runs: the startup catch-up and the daily timer
│   ├── routers/           One APIRouter per resource (auth, accounts, transactions, imports, dashboard, budget, goals, subscriptions, prefs, rates, categories, tokens, ops, pages)
│   ├── services/          Business logic shared across routers (currency, accounts, transactions, subscriptions, posting, projection, csv_import, import_matching)
│   ├── limiter.py         Shared slowapi Limiter instance (separate module so routers avoid importing app)
│   ├── auth.py            Password hashing, session lifecycle, require_auth dependency
│   ├── db.py              SQLite connection, init() + migrations, cents↔pounds helpers
│   ├── constants.py       DB path, cookie flags, type aliases, money/rate/days bounds, static dir
│   ├── schemas.py         Pydantic request/response models (validation lives here)
│   ├── security.py        SecurityHeadersMiddleware (HSTS, CSP, frame-deny, …) and the request-id middleware
│   ├── logging_config.py  Structured (JSON or text) logging setup
│   └── static/            Served under /static (plus the SPA build below)
│       ├── dist/          React SPA production build — Vite output (gitignored; built from frontend/)
│       ├── login.{html,js,css}   Standalone login / register page
│       ├── guide.{html,js,css}   Standalone documentation page (renders Markdown via vendored marked.js)
│       ├── theme-bootstrap.js    Applies the saved light/dark mode before first paint (avoids a flash)
│       ├── fonts/         Self-hosted Plus Jakarta Sans + JetBrains Mono (woff2)
│       └── vendor/        Vendored third-party JS (marked.min.js)
├── frontend/              React SPA source (TypeScript + Vite); build outputs to src/static/dist
│   ├── src/               App.tsx, screens/, components/, hooks/, api/, lib/, theme/, types.ts
│   ├── public/            Assets copied verbatim into the build (PWA icons, manifest)
│   ├── index.html         Vite entry HTML
│   ├── package.json       Frontend deps + scripts (build, lint)
│   └── vite.config.ts     Vite config (outDir → ../src/static/dist)
├── docs/                  Documentation (you are here)
├── pyproject.toml         Dependency declarations (runtime + dev)
├── uv.lock                Locked dependency versions for reproducible installs
├── requirements.txt       Pinned runtime deps (generated from uv.lock, for pip users)
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
