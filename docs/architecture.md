# Architecture

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

**Frontend:** Vanilla JavaScript (no framework), Chart.js 4.4 vendored from `/static/vendor/`, Inter font self-hosted. The SPA has two views — Overview and Budget Planner — switched via a sticky nav tab inside the header. No build step is required.

**Database:** A single SQLite file. Defaults to `piledger.db` at the project root (one level above `src/`); can be overridden via the `PILEDGER_DB` environment variable. Money is stored as integer cents inside the database; the JSON API exposes plain floating-point pounds.

## Requirements

| # | Requirement | How it is met |
|---|---|---|
| R1 | Self-hosted, runs on a virtual machine | Python/FastAPI server with no cloud dependencies; all data stored in a local SQLite file |
| R2 | Accessible from any device on the network | Server binds to `0.0.0.0` so any device that can reach the host's IP and port can open the dashboard |
| R3 | Graphical interface | Single-page web app served directly by the backend; works in any modern browser |
| R4 | Track current, savings, and loan account balances | All three account types are supported with distinct display treatment; loans appear as liabilities and subtract from net worth |
| R5 | Add and remove accounts | Accounts can be created via the "Add Account" modal and deleted from the Edit modal with confirmation |
| R6 | Update account balances | "Update Balance" records a new balance snapshot with optional notes |
| R7 | Graphs of historical balances | Step-line chart showing all accounts over a selectable window (30 days - 1 year) |
| R8 | Projected balances | Compound-interest projection chart (1, 2, or 5 years) with per-account summary cards |
| R9 | Interest rates on savings accounts | Annual interest rate (AER %) stored per savings account; used for monthly-compounding projections |
| R10 | Login-gated access | Login page required before the dashboard is visible; session cookie enforced on every API route |
| R11 | Per-user account isolation | Every account row carries a `user_id` foreign key; all queries filter by the authenticated user |
| R12 | Budget planning with recurring items | `budget_items` table plus a dedicated Budget Planner view; month-by-month projections combining cash flows with interest compounding |
| R13 | Loan / debt tracking with net-worth view | `'loan'` account type; balances subtract from net worth; APR-based interest accrual; payments modelled as negative budget items |

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
├── docs/                  Documentation (you are here)
├── pyproject.toml         Dependency declarations (runtime + dev)
├── uv.lock                Locked dependency versions for reproducible installs
├── requirements.txt       Pinned runtime deps (generated from uv.lock, for pip users)
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
