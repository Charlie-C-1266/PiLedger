# Changelog

All notable changes to PiLedger are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.17.1] — 2026-05-21

### Tests

- **Schema migration coverage.** `db.init()` carries nine conditional, additive migrations gated by `PRAGMA table_info` checks (add `accounts.user_id`, widen `accounts.type` CHECK to allow `'loan'` via table-rewrite, add `users.theme` / `users.dark_mode`, add `accounts.subtype`, add `accounts.currency`, add `users.base_currency`, convert `balance_history.balance` REAL → `balance_cents` INTEGER, convert `budget_items.amount` REAL → `amount_cents` INTEGER). Until this release every one of these branches was dead-tested: the suite has always started from a fresh DB so the `CREATE TABLE IF NOT EXISTS` fast path runs and the migration bodies never fire. A future change that mis-orders a CAST, drops a column from the table-rewrite SELECT list, or breaks an additive ALTER would have shipped silently and only manifested when a long-deployed user upgraded — the worst possible time to discover it. New `tests/test_migrations.py` (18 cases) materialises the pre-migration ("v0") schema directly with raw `executescript`, seeds a representative row in every table (one user, two accounts, two balance-history entries with REAL balances, two budget items with REAL amounts including a negative one to pin sign preservation), then calls the real `init()` and asserts: every expected column is present after; the type CHECK now mentions `'loan'` and accepts an inserted loan row; existing accounts survive the table-rewrite with `id` / `name` / `type` / `interest_rate` / `color` preserved; default backfills land correctly (`theme='olive'`, `dark_mode=0`, `subtype='general'`, `currency='GBP'`, `base_currency='GBP'`); the riskiest migrations (the two REAL → INTEGER conversions) round exactly to cents with `1234.56 → 123456`, `8000.00 → 800000`, `3000.00 → 300000`, and crucially `-1234.55 → -123455` (negative values are the loan-payment encoding from `test_loans.py`, so a regression that absolute-valued the cast would break the budget projection in production but not in any other test). Idempotency is pinned — running `init()` a second time on the already-migrated DB must be a no-op rather than re-firing a table-rewrite or duplicating data — and a separate "fresh install" case confirms `CREATE TABLE IF NOT EXISTS` produces every column the routes expect.

Affected files: new `tests/test_migrations.py` (18 cases). After: `./venv/bin/pytest` → **203 passed** on this branch (was 185, +18); `./venv/bin/pytest tests/e2e` → **34 passed** (unchanged). No source changes. This PR is independent of #17 (test-coverage-budget-and-auth) — when both land the combined suite will be 242 unit/API tests.

---

## [0.17.0] — 2026-05-21

### Added

- **Distribution chart can switch between doughnut and horizontal bar.** A small two-button toggle ("Doughnut" / "Bar") now sits in the Distribution card header on the overview. Doughnut remains the default (existing layout, same colours, same native-currency tooltip with an "(≈ base)" suffix on cross-currency accounts). Horizontal bar mode reorders the accounts descending by base-converted balance so the largest sits at the top — much easier to read exact balances and rank accounts at a glance once there are more than four or five, which is the case the doughnut consistently loses to. The user's choice is persisted to `localStorage` under `piledger:distChart` (no backend prefs change, since this is a purely visual preference) and the toggle's active state is synced to the saved value on first render. Toggling re-renders from a cached account list rather than re-fetching `/api/accounts`. Loans are still excluded in both modes (they are liabilities, not part of the asset mix). Affected files: `static/index.html` (toggle markup in the Distribution chart-header), `static/style.css` (`.chart-type-toggle` + `.chart-type-btn` styles, mirroring `.period-btn` so it inherits theme + dark-mode colours), `static/app.js` (`chartPrefs.distributionType`, `distributionAccounts` cache, `renderDistributionDoughnut` / `renderDistributionBar` split, `setDistributionChartType` exposed on `window` for the existing `data-action` delegator).

- **Interactive crosshair tooltips on every line chart.** Hovering anywhere along the Balance History, Savings Projection, or Budget Projection charts now lights up a tooltip showing every account's value at that date in one place, instead of requiring the cursor to land directly on an individual point dot. A thin dashed vertical guide line follows the cursor at the active x-position so the tooltip and the visual selection agree on which date is being read. Implemented as a shared `LINE_OPTS` (sets Chart.js `interaction.mode = 'index'`, `intersect = false`, `axis = 'x'`, plus matching `hover` and `tooltip` modes) merged into the three line charts on top of the existing `BASE_OPTS`, and a tiny `crosshairPlugin` registered with `Chart.register()` that draws the guide line in `afterDatasetsDraw`. The plugin early-exits on non-line charts (`chart.config.type !== 'line'`) so the doughnut and horizontal-bar distribution charts aren't accidentally striped with a vertical line, and on charts with no active tooltip element (empty-state placeholder, mouse outside chart area) so it never draws a stray line in those cases. The Budget chart's existing legend filter that hides the "Zero" reference dataset is preserved by merging `LINE_OPTS.plugins` first, then overlaying the legend customisation, so neither the index-mode tooltip nor the Zero-line hiding gets lost. Tooltip styling gains a darker semi-transparent background, larger padding, and a 6px corner radius — the index-mode tooltip is much denser than the previous single-series one, so it needs the extra breathing room to stay readable. Affected files: `static/app.js` (`crosshairPlugin`, `LINE_OPTS`, three `...LINE_OPTS` spreads in `renderHistoryChart`, `renderProjectionChart`, `renderBudgetChart`).

---

## [0.16.0] — 2026-05-20

### Added

- **Login rate limiting (P0-4).** `POST /api/auth/login` is now capped at **5 attempts per minute per source IP** via [SlowAPI](https://slowapi.readthedocs.io/), addressing the "no rate limiting on login attempts" gap previously documented in README's Security Notes. PBKDF2 at 260 000 iterations puts brute-force ceiling at roughly 10 attempts/sec, which is ~36 000/hour against an 8-character password — fast enough that a determined attacker with network reach could realistically work the bottom of the password-strength distribution. The 5/min cap drops that ceiling by three orders of magnitude (300/hour). The limit is configurable via `PILEDGER_LOGIN_RATE_LIMIT` (slowapi string syntax — `10/minute`, `100/hour`, etc.) so an operator running an internal-only deployment can loosen it without code changes. The key function is the socket peer IP (`slowapi.util.get_remote_address`), not `X-Forwarded-For` parsing — chosen deliberately to avoid the trusted-proxy-allowlist footgun where a misconfigured allowlist lets an attacker spoof the header and evade the cap entirely. The README's existing "front with a reverse proxy" guidance already covers internet-facing deployments where per-client rate limiting must happen at the proxy layer (where the real client IP is visible); the app-layer limit remains a defence-in-depth backstop for LAN deployments. SlowAPI registers a default `RateLimitExceeded` exception handler that returns 429 with a JSON body and standard `Retry-After` / `X-RateLimit-*` headers — and because `SecurityHeadersMiddleware` (P0-3) runs after the handler, every 429 still carries the full defensive header set. Affected files: `requirements.txt` (new `slowapi>=0.1.9` dep), `constants.py` (new `LOGIN_RATE_LIMIT` constant with env override), `app.py` (Limiter wiring, exception handler registration, `request: Request` added to the login signature, `@limiter.limit(LOGIN_RATE_LIMIT)` decorator), `tests/conftest.py` (disables the limiter in the shared `app` fixture so suite-wide login fixtures don't trip the cap), `tests/e2e/conftest.py` (sets `PILEDGER_LOGIN_RATE_LIMIT=10000/minute` for the session-scoped Uvicorn subprocess, since the production cap would otherwise drop the e2e suite from 34 passed to ~26 once the shared 127.0.0.1 bucket runs dry), new `tests/test_rate_limit.py` (6 cases pinning: 5 under-cap logins succeed, 6th attempt returns 429 regardless of password validity, register and `GET /login` stay unaffected, and 429 responses still carry the P0-3 security headers), `README.md` (Security Notes — moves login rate-limiting from "not protected" to "protected", documents the `PILEDGER_LOGIN_RATE_LIMIT` env var and the shared-bucket-behind-proxy caveat, and adds a one-liner summarising the P0-3 header set).

---

## [0.15.0] — 2026-05-20

### Added

- **Security-headers middleware (P0-3).** New `security.py` registers a `SecurityHeadersMiddleware` on the FastAPI app that attaches a fixed set of defensive HTTP response headers to every reply: a one-year `Strict-Transport-Security` with `includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a `Permissions-Policy` that disables geolocation/microphone/camera/payment, and a strict `Content-Security-Policy` (`default-src 'self'; script-src 'self'; …`) with **no** `'unsafe-inline'` on `script-src`. The middleware uses `response.headers.setdefault(...)` so individual routes can still override a header for a specific response without it being clobbered on the way out. Without the asset and handler work below the strict CSP would have broken the dashboard at first paint, which is why P1-7 and P1-8 ship in the same change.
- **Vendored Chart.js + Inter (P1-7).** Chart.js 4.4.0 (`static/vendor/chart.umd.min.js`, 200 KB unminified) and the Inter Latin subset (`static/vendor/inter/inter-latin.woff2`, 47 KB, with five `@font-face` declarations in `static/vendor/inter/inter.css` covering weights 300–700) are now served from `/static`. The dashboard no longer reaches out to `cdn.jsdelivr.net` or `fonts.googleapis.com` on first paint, which is what makes `script-src 'self'`/`font-src 'self'` feasible — and as a side effect the SPA now boots fully offline once the page is cached.

### Changed

- **Every inline event handler removed from the SPA (P1-8).** The 44 `onclick=`/`onchange=` attributes in `static/index.html` and the 4 in `static/login.html`, plus the 7 dynamically-rendered `onclick=` strings inside `static/app.js` template literals, are now expressed as `data-action="functionName"` (plus optional `data-arg="..."` for arguments). Two document-level delegated listeners in `app.js` — one for `click`, one for `change` — look up the named function on `window` and invoke it with the parsed argument (string/number/boolean coercion is automatic). Selects that need the new value pass an additional `data-pass-value` attribute. The two `<script>` blocks in `static/login.html` (the pre-paint theme bootstrap and the ~80-line login-form logic) have been extracted to `static/theme-bootstrap.js` and `static/login.js`; `static/index.html` references the same `theme-bootstrap.js`. Net effect: every page served by PiLedger now has **zero** inline `<script>` content and **zero** `on*=` attributes, so a CSP without `'unsafe-inline'` on `script-src` is satisfiable.

### Tests

- New `tests/test_security_headers.py` (10 cases) asserts every header is present on `/login`, on the root redirect, on a 401, on an authed `/api/summary`, and on a static asset; parametrises across every CSP directive; and pins `script-src` to `'self'` only.
- New `tests/test_static_assets.py` (7 cases) treats the served HTML/JS as data and asserts: no `on*=` attributes in `index.html`, `login.html`, or any template string in `app.js`; every `<script src=…>` points at `/static/`; no `<script>` block lacks a `src`; no `cdn.jsdelivr.net`/`fonts.googleapis.com`/`fonts.gstatic.com` references survive anywhere; and the three vendored files exist on disk.

Affected files: `app.py` (one import + one `add_middleware` line), new `security.py`, `static/index.html`, `static/login.html`, `static/app.js` (template literals + new dispatcher), new `static/theme-bootstrap.js`, new `static/login.js`, new `static/vendor/chart.umd.min.js`, new `static/vendor/inter/inter.css`, new `static/vendor/inter/inter-latin.woff2`, new `tests/test_security_headers.py`, new `tests/test_static_assets.py`. After all changes: `./venv/bin/ruff check .` → **All checks passed**; `./venv/bin/pytest` → **179 passed** (158 prior + 21 new); `./venv/bin/pytest tests/e2e` → **34 passed**.

---

## [0.14.1] — 2026-05-20

### Changed

- **`CLAUDE.md` now mandates running both test suites before committing.** The previous instructions documented only the default `./venv/bin/pytest` invocation, which `pytest.ini` runs with `--ignore=tests/e2e`. As a result the Playwright e2e suite (excluded from CI for the same reason) was easy to miss during local verification, and at least one stale assertion (`test_prefs_persist_across_sessions`, broken since v0.11 added `base_currency` to the prefs response) reached the working tree unnoticed. The updated "Running tests" section now lists both invocations (`./venv/bin/pytest` plus `./venv/bin/pytest tests/e2e`), spells out why the e2e suite is opt-in by default, names the one-time `playwright install chromium` setup step, and requires both suites to pass before a change is considered complete. The stale "112 tests" count is also removed — the unit/API suite has grown past that, and pinning a number in instructions just creates drift. Affected files: `CLAUDE.md`.

---

## [0.14.0] — 2026-05-20

### Added

- **AGPL-3.0 license.** The repository now carries an explicit `LICENSE` file containing the verbatim GNU Affero General Public License v3.0 text (fetched from GitHub's canonical licenses API). Until now the project had no license declared, which under default copyright law meant "all rights reserved" — no one but the author was legally permitted to fork, modify, or redistribute the code, which is a poor fit for a self-hosted project that has been public on GitHub since its first commit. AGPL-3.0 was chosen to match the licensing of the closest comparable self-hosted finance projects (Firefly III, Actual Budget, Maybe Finance), so contributors moving between them find familiar terms, and because the AGPL's network-use clause is the right default for a project people will self-host as a service: it permits personal use and modification but requires anyone running a modified version as a public-facing service to share their changes back. Affected files: `LICENSE` (new, 662 lines, full AGPL-3.0 text), `README.md` (new top-level "License" section after "Security Notes" plus a matching Table of Contents entry).

---

## [0.13.1] — 2026-05-20

### Fixed

- **Settings header icon now renders as a gear instead of a sun.** The SVG for the settings button was a near-duplicate of the light-mode toggle icon (a circle with eight radial spokes), so the gear/cog the button claimed to represent never appeared. Replaced the path with a proper cog outline + inner circle. Affected: `static/index.html`.
- **Mobile rendering of the header and modals.** On viewports below ~500px the header tried to fit six items (logo, net worth, username, sign-out, theme toggle, settings, "+ Add Account") on a single 64px row, pushing controls offscreen or squashing the net-worth value. The header now wraps, the redundant username is hidden, net worth moves to its own row on the narrowest screens, and "+ Add Account" collapses to just "+". Charts also drop slightly in height so they don't dominate the viewport, and the settings modal stacks its label/control pairs to stop them being squashed. Affected: `static/style.css`, `static/index.html`.

---

## [0.13.0] — 2026-05-19

### Rebranded from FinDash to PiLedger

The project's prior name (FinDash) clashed with an existing commercial product in the same space, so the GitHub repository was renamed to `piledger` and every in-tree reference now reads "PiLedger" (display) / `piledger` (identifiers). This is purely a rebrand — every feature, the schema, and every API contract are unchanged.

#### Why a single coordinated rename

The two-layer alternative (rebrand the docs and display strings now, leave runtime identifiers for later) was explicitly rejected. Splitting the change would mean shipping a build where users see "PiLedger" in the browser title and header but find a `findash_session` cookie in their devtools and a `findash.db` file on disk — confusing for newcomers who're reading the README and seeing inconsistent names depending on where they look. One coordinated commit is jarring exactly once; a phased rebrand is jarring forever.

The historical changelog entries below have been rewritten in-place to match — they originally described features by their then-current names (FINDASH_DB, FinDash, etc.). Leaving them unchanged would mean a reader trying to understand "when was the env var added?" would find `FINDASH_DB` in the history but `PILEDGER_DB` in the code with no breadcrumb between them. Since nothing about the substance of those past changes shifts, a verbatim rename keeps the history accurate against the current codebase.

#### Migration for existing self-hosters

The breaking changes are all renames — there are no removed features or schema migrations. Existing deployments need to update a handful of identifiers; afterwards everything behaves as before.

| What was | What it is now | How to migrate |
|---|---|---|
| `FINDASH_DB` env var | `PILEDGER_DB` | Rename the variable in your shell profile / systemd unit / `.env` |
| Default DB filename `findash.db` | `piledger.db` | Rename the file: `mv findash.db piledger.db` (if you used the default path), or pass the old path via `PILEDGER_DB=/path/to/findash.db` |
| Session cookie `findash_session` | `piledger_session` | No action — users are logged out once and need to sign in again |
| LocalStorage keys `findash:theme` / `findash:dark` | `piledger:theme` / `piledger:dark` | No action — themes are also stored server-side in `/api/prefs`, so refreshing the page repopulates localStorage from the API |
| Dummy hash salt `__findash_dummy__` | `__piledger_dummy__` | No action — the dummy hash is regenerated on first login attempt |
| Docker image / container / service / volume names `findash*` | `piledger*` | `docker compose down`, optionally `docker volume create piledger_piledger-data` and copy data from the old volume, then `docker compose up -d`. For a clean start: `docker compose down -v && docker compose up -d` |
| Process / log / PID filenames (`findash.log`, `findash.pid`, `findash.service`) in the README's systemd snippet | `piledger.log`, `piledger.pid`, `piledger.service` | Rename your unit file and reload: `sudo systemctl daemon-reload` |

#### Changed

- **Display strings** — header logo, browser `<title>` on both `index.html` and `login.html`, FastAPI app title, module docstrings, README + CHANGELOG + CLAUDE.md all read "PiLedger".
- **Code identifiers** — `constants.py` env var key (`PILEDGER_DB`), default DB filename (`piledger.db`), `SESSION_COOKIE = "piledger_session"`, `auth.py` dummy-hash salt (`__piledger_dummy__`), `static/app.js` + `static/index.html` + `static/login.html` use `piledger:theme` / `piledger:dark` localStorage keys.
- **Docker resources** — `Dockerfile` non-root user is `piledger`, env var is `PILEDGER_DB=/data/piledger.db`. `docker-compose.yml` service / `container_name` / `image` are `piledger`, named volume is `piledger-data`.
- **Tests** — `tests/test_auth.py` cookie assertions reference `piledger_session`. `tests/e2e/conftest.py` reads `PILEDGER_DB`, `PILEDGER_E2E_HEADED`, `PILEDGER_E2E_SLOWMO`. `tests/e2e/test_theme_persistence.py` asserts on the new localStorage keys.

After all changes: `./venv/bin/ruff check .` → **All checks passed**; `./venv/bin/pytest` → **158 passed** (no behavioural changes; only identifier names moved).

---

## [0.12.0] — 2026-05-19

### One-command setup with Docker Compose + uv-friendly install instructions

Up to now the only documented way to run PiLedger was the `python3 -m venv venv && pip install ...` dance, which is fine for the existing developer but adds friction for anyone trying the project for the first time. This release ships a containerised setup path and a top-level `Getting Started` section in the README so the on-ramp is clear regardless of how someone prefers to run Python services.

#### Design — Docker layout

- **Slim base, multi-layer cache.** The `Dockerfile` uses `python:3.12-slim` and copies `requirements.txt` *before* the application source, so editing `app.py` doesn't bust the dependency layer on every rebuild. `pip install --no-cache-dir` keeps the image lean.
- **Non-root by default.** A dedicated `piledger` system user (UID 10001) owns `/app` and `/data`. The container has no shell entrypoint, no sudo, and no need for privileged mounts — running it as root would have been a one-line shortcut that wasn't worth the security regression.
- **Data lives in a named volume.** `docker-compose.yml` mounts `piledger-data` at `/data` inside the container and sets `PILEDGER_DB=/data/piledger.db` in the environment. `docker compose down` keeps user data; `docker compose down -v` wipes it. This means image rebuilds (e.g. after `git pull`) never destroy user accounts or balance history — a property the old "edit `piledger.db` in place" workflow didn't even need to think about because there was no rebuild step.
- **Built-in health check.** Both the `Dockerfile` `HEALTHCHECK` and the compose-level `healthcheck` hit `GET /login`, which returns 200 unauthenticated. Plain `GET /` returns a 302 redirect to `/login` which makes for a noisier check; `/login` is the most direct "is the SPA wired up" probe we can make without a session cookie.

#### Design — README Getting Started

The new section sits at the top of the README and presents three equally-supported install paths (Docker, `uv`, `pip` + `venv`) in a single decision table. The existing `Building and Running` section stays as the deep reference for systemd, headless deployment, and firewall config — newcomers find the short recipe up top without losing the operational notes lower down.

`uv` got first-class treatment in addition to `pip` because installing the runtime + dev dependencies via `pip` takes 20–30 seconds even on a fast connection, while `uv pip install -r requirements.txt` is usually under two. Using `uv venv venv` (rather than the default `.venv`) keeps the layout identical to the pip flow so `start.sh`, the systemd unit, and `./venv/bin/pytest` all work unchanged.

#### Added

- `Dockerfile` — Python 3.12-slim image, dependency layer cached separately from source, `piledger` non-root user, writable `/data` for the SQLite volume, `HEALTHCHECK` against `/login`, CMD `uvicorn app:app --host 0.0.0.0 --port 8080`.
- `docker-compose.yml` — single `piledger` service, `restart: unless-stopped`, `8080:8080` port mapping (host-side configurable), `PILEDGER_DB` pinned to `/data/piledger.db`, `COOKIE_SECURE` passed through from the host env, named `piledger-data` volume, healthcheck mirroring the Dockerfile probe.
- `.dockerignore` — excludes `venv/`, `.git/`, `*.db` (most importantly the host's `piledger.db` — keeps user data out of the image), `tests/`, `__pycache__/`, `.ruff_cache/`, `.pytest_cache/`, `.env*`, `.claude/`, and editor/OS noise. Keeps the build context small and prevents host-side artefacts from leaking into layers.
- `README.md` — new top-level `Getting Started` section with a three-row decision table (Docker / uv / pip + venv), full Docker workflow including `down`/`down -v`/`cp` data-backup recipes, parallel pip and uv recipes for local dev. The existing `Building and Running` section is updated to acknowledge both pip and uv as supported and now cross-references `Getting Started` for the Docker path. The `File Structure` table grows entries for `Dockerfile`, `docker-compose.yml`, and `.dockerignore`. The Table of Contents is renumbered to include the new section.

After all changes: `./venv/bin/ruff check .` → **All checks passed**; `./venv/bin/pytest` → **158 passed** (no changes to application code).

---

## [0.11.0] — 2026-05-19

### Multi-currency accounts with a user-selected base for net-worth totals

Until now PiLedger assumed everything was in GBP — every balance, every chart, every summary tile hardcoded the `£` symbol. This release adds first-class support for holding accounts in different currencies, with each user picking a single "base" currency that totals and net-worth figures are reported in.

#### Design — per-account currency + user base + manual rates

Three design decisions shape the implementation:

- **Currency lives on the account.** A new `accounts.currency` column means each account is denominated in one currency that never changes implicitly. Per-account balances always render in that currency in the UI — `$2,000` stays `$2,000` even after the base changes.
- **A user-level base currency drives every aggregate.** `users.base_currency` is what `/api/summary`, the net-worth header, and the budget projection's net-worth line all report in. The frontend converts each account into the base on the fly when computing the doughnut distribution and the table's net-worth row, so a portfolio split across GBP / USD / EUR collapses to a single comparable number.
- **Rates are manual, not fetched.** A new `exchange_rates(user_id, currency, rate)` table holds per-user manual rates; there is no outbound API call, no scheduled job, no API-key plumbing. Users maintain the table from Settings whenever it matters. Picked this over auto-fetched rates because (a) it has zero external dependencies and never breaks on rate-limit/quota issues, (b) tests stay deterministic with no network mocking, and (c) for a self-hosted personal dashboard the friction of re-entering a few rates monthly is lower than the friction of integrating an exchange-rate provider.

A missing rate is not an error — `/api/summary` falls back to 1.0 so the total is never silently dropped, but it returns the missing currencies in a `missing_rates` array so the UI can warn (the net-worth label gains a `⚠` and a tooltip listing the affected currencies). The frontend mirrors the same fallback for client-side conversion (distribution doughnut, breakdown-table net-worth row).

When the base currency changes via `PUT /api/prefs`, the rates table is recomputed in place: if you had `USD → GBP = 0.5` and switch base to USD, the row becomes `GBP → USD = 2.0`, and any third currency (e.g. EUR) is re-scaled by dividing its old rate by the pivot. If no pivot is available (e.g. switching to a base you'd never set a rate for) the table is cleared rather than producing nonsense — the user re-enters what they need.

#### Storage

All balances continue to be stored as integer 100ths of the major unit (the existing `balance_cents` column). For JPY (which has no minor unit), that means ¥1,000 is stored as 100000; the UI rounds to whole yen on display via `Intl.NumberFormat`'s `minimumFractionDigits: 0`. Keeping the storage scheme uniform across currencies means no migrations to any of the money columns and no per-currency precision logic in the cents/dollars conversion.

#### Added

**Backend**

- `constants.py` — `Currency` literal (`GBP`, `USD`, `EUR`, `JPY`, `CAD`, `AUD`, `CHF`, `NZD`, `SEK`, `NOK`) plus the matching `SUPPORTED_CURRENCIES` set, `CURRENCY_INFO` metadata (symbol + decimals per code), and `MIN_RATE_FX` / `MAX_RATE_FX` bounds. `DEFAULT_CURRENCY = "GBP"` keeps backfilled rows behaving exactly as before.
- `db.py` — `accounts.currency TEXT NOT NULL DEFAULT 'GBP'` column; `users.base_currency TEXT DEFAULT 'GBP'` column; new `exchange_rates(user_id, currency, rate, updated_at)` table keyed by `(user_id, currency)` with `ON DELETE CASCADE` so a user's rates evaporate when their account does. Additive migration blocks check `PRAGMA table_info` before each `ALTER TABLE` so existing `piledger.db` instances upgrade cleanly without losing data.
- `schemas.py` — `AccountIn`/`AccountPatch`/`AccountOut` gain a `currency: Currency` field; `PrefsOut`/`PrefsPatch` gain `base_currency`; `SummaryOut` gains `base_currency` + `missing_rates: list[Currency]`; new `RateIn`, `RateOut`, `RatesPut`, `RatesOut` model the new `/api/rates` endpoint.
- `app.py` — `GET /api/rates` and `PUT /api/rates` for managing the manual table (PUT validates `currency != base_currency` and rejects duplicates before any write so a 400 never leaves a half-updated row). `_load_rates`, `_convert_to_base`, and `_rescale_rates` helpers centralise the conversion logic so summary, projections, and budget all share one implementation. `/api/summary` reads the user's base + rates and converts each account before adding to the relevant pot; `/api/budget/projection` computes per-account points in the account's native currency but converts to base when summing the net-worth line; `/api/history/all` and `/api/projections` carry `currency` through to the response so the frontend can format tooltips correctly.

**Frontend**

- `static/index.html` — Add-Account modal gains a Currency dropdown (defaults to the user's base). Settings modal grows two new sections: a Base Currency dropdown and an Exchange Rates table that only lists currencies actually held by the user. Static `£` symbols in modal labels are removed in favour of dynamic injection from the currently-selected currency.
- `static/app.js` — `CURRENCIES` table (id → label, symbol, decimals) drives the dropdowns and `Intl.NumberFormat` calls. `fmt(value, code)` / `fmtSigned(value, code)` accept an optional currency override so per-account values format in their native currency while totals continue formatting in the base. Chart tooltips read `dataset._currency` so a mixed-currency history or budget chart renders each line in its own currency. The doughnut distribution converts each slice to the base before summing for the chart, but the tooltip still shows the native amount with an `(≈ X base)` suffix when they differ. `loadRates()` runs on boot alongside `loadPrefs()`; `onBaseCurrencyChange` calls `PUT /api/prefs` and refreshes the dashboard; `saveRatesFromTable` collects the rate inputs and PUTs the whole table. `renderSummary` reads `s.missing_rates` and toggles a `.nw-label--warn` class with a tooltip enumerating the affected currencies.
- `static/style.css` — `.badge-currency` chip (sits next to type/subtype badges, only shown when the account's currency differs from the base); `.rates-table` + `.rate-row` styles for the Settings rates editor; `.nw-label--warn` adds amber colour and a trailing `⚠` to the Net Worth header when rates are missing.

**Tests**

- `tests/test_currency.py` — 20 new tests covering account currency defaults + validation, base-currency round-trip through `/api/prefs`, the `/api/rates` GET/PUT round-trip with replace semantics + duplicate/zero/self-base rejection, cross-user isolation, FX-aware `/api/summary` totals (including loans subtracting in base), missing-rate flagging, and the rate-rescaling behaviour when the base currency changes (with and without a pivot rate).
- `tests/test_dashboard.py`, `tests/test_prefs.py` — updated three response-shape assertions to include the new `base_currency` / `missing_rates` keys.

After all changes: `./venv/bin/ruff check .` → **All checks passed**; `./venv/bin/pytest` → **158 passed** (138 existing + 20 new).

---

## [0.10.0] — 2026-05-19

### Continuous integration via GitHub Actions

Every push to `main` and every pull request now runs a CI pipeline in a fresh Ubuntu environment, so regressions and lint drift are caught before review instead of after merge. The pipeline has two parallel jobs:

- **Lint** — installs [ruff](https://docs.astral.sh/ruff/) and runs `ruff check` against the whole repo. Ruff was picked over flake8/pylint because it's orders of magnitude faster (the entire repo lints in milliseconds), bundles the rules we'd otherwise pull in piecemeal, and needs no config to be useful. Output uses `--output-format=github` so violations annotate the offending lines inline on the PR diff.
- **Tests** — installs `requirements.txt` + `requirements-dev.txt` against Python 3.12 and runs `pytest`. The existing `pytest.ini` already excludes `tests/e2e` from the default invocation, so the Playwright browser suite — which needs a Chromium download and system libs — is intentionally skipped in CI. The 138 unit/API tests do run.

#### Added

- `.github/workflows/ci.yml` — two-job workflow (`lint`, `test`) triggered by `push: branches: [main]` and `pull_request:`. The branch filter on `push` plus the unconstrained `pull_request` avoids the common double-trigger where a PR branch push fires both events; only `main` pushes and PR events run, which is enough to gate merges. The test job uses `actions/setup-python@v5`'s built-in `cache: pip` keyed off both requirements files so repeat runs reinstall from cache.
- `requirements-dev.txt` — added `ruff>=0.6` so local dev environments use the same linter CI runs.

#### Fixed

- `tests/e2e/conftest.py`, `tests/e2e/test_balance_validation.py` — removed two unused imports (`sys`, `re`) flagged by `ruff check` (F401). These were the only lint violations in the codebase; fixing them lets the new lint job land green.

After all changes: `./venv/bin/ruff check .` → **All checks passed**; `./venv/bin/pytest` → **138 passed** (unchanged).

---

## [0.9.0] — 2026-05-19

### Summary tiles double as account-grid filters

The four tiles along the top of the Overview (Total Savings, Current Accounts, Total Debt, Accounts) used to be display-only. They now act as type filters for the Accounts grid below: click Savings to see only savings cards, click Current to swap to current, etc. The cards below narrow but the dashboard-wide totals, charts, and Distribution stay global so you don't lose context when drilling in.

#### Added

**Frontend**
- `static/index.html` — each summary tile is now a `<button type="button" class="card summary-card" data-filter="…" aria-pressed="…">`. `data-filter` is one of `savings`, `current`, `loan`, `all`; `aria-pressed` reflects the active tile. The 'Accounts' (count) tile starts as the active "all" filter. Inner DOM (icon + label + value) unchanged, so every existing selector keeps working.
- `static/app.js` — `state.accountFilter` (null = show all). `setAccountFilter(type)` toggles when re-clicking the active filter, special-cases `'all'` as a clear, updates `aria-pressed` on every tile, and re-renders the grid. `renderAccounts` narrows by `state.accountFilter` before render, and shows a friendly empty state with a "Show all" escape hatch when a filter matches zero accounts. The filter survives `loadAll()` re-renders (e.g. after updating a balance) because the state lives at module scope, not on the DOM.
- `static/style.css` — `.summary-card` resets native button styling (text-align, font, color, width, cursor), gains a subtle hover lift + `:focus-visible` ring, and `[aria-pressed="true"]` renders an accent border + ring so the active filter is unmistakable.

#### Why filter the grid only, not the charts
The summary numbers ("£3,250 across 3 accounts") describe your whole financial picture, not your current view. If clicking Savings rewrote them, the user would lose the very context they're trying to drill into. Same logic for Balance History and Distribution — they show how your money is split *because* you want to compare types, so filtering them away from the same click defeats the chart's purpose.

**Tests**
- `tests/e2e/test_account_filters.py` (7 tests, all chromium) — default state shows all 3 accounts with the count tile active; clicking Savings narrows to one card; clicking Current swaps filter; clicking the active filter again clears; the count tile always clears; an empty result shows the "No X accounts" empty state with a "Show all" button; **filter survives balance update** (loadAll re-render doesn't snap the user back to the full list).

After all changes: `./venv/bin/pytest` → **138 passed** (unchanged); `./venv/bin/pytest tests/e2e` → **34 passed** (27 → 34).

---

## [0.8.0] — 2026-05-19

### Playwright end-to-end test suite

The existing 138-test pytest suite covers the HTTP API exhaustively, but every test runs against `starlette.testclient.TestClient` — meaning regressions that only show up in a real browser (broken SVG icons, modals that don't open, dark-mode CSS that fails to swap, theme prefs that don't round-trip through the dashboard's `loadPrefs() → applyTheme()` boot sequence) could ship without anyone noticing. This release adds a Playwright suite that drives a real Chromium against a live Uvicorn instance.

#### Added

**Test infrastructure**
- `tests/e2e/conftest.py` — session-scoped `live_server` fixture boots Uvicorn against an isolated temp DB (via the `PILEDGER_DB` env var that `constants.DB` reads at import) on a dynamically-allocated port, so the suite never collides with the dev server on :8080. `signed_in_page` and `registered_user` fixtures handle the boilerplate of getting into the dashboard. `PILEDGER_E2E_HEADED=1` and `PILEDGER_E2E_SLOWMO=250` honoured for local debugging.
- `pytest.ini` — registered an `e2e` marker and added `--ignore=tests/e2e` to default `addopts`. This keeps `./venv/bin/pytest` fast (138 unit/API tests, ~34s) and makes the browser suite explicit: `./venv/bin/pytest tests/e2e`.
- `requirements-dev.txt` — added `pytest-playwright>=0.5`. The browser binary is installed via `./venv/bin/playwright install chromium`; system libraries via `sudo ./venv/bin/playwright install-deps chromium` (one-time).

**Tests (27 total, all chromium-only)**
- `tests/e2e/test_auth_flow.py` (5 tests) — unauthenticated `/` redirects to `/login`; the register-tab → auto-login → dashboard flow; mismatched passwords blocked client-side; wrong password surfaces the API error; sign-out clears the cookie so a subsequent `/` bounces back to `/login`.
- `tests/e2e/test_icons_render.py` (5 tests) — every static SVG icon (header logo, theme toggle, settings cog, the four summary-card icons, the empty-state placeholder, the login-page logo) is asserted both `visible` *and* with a non-zero bounding box, so a CSS regression that hides or collapses an icon fails the test. Dark-mode toggle also verified to flip the moon/sun visibility pair driven by `[data-mode="dark"] .theme-toggle .icon-*`.
- `tests/e2e/test_balance_validation.py` (6 tests, incl. 2 parametrised) — blank account name caught by the `submitAddAccount` alert path; negative balance flagged invalid by the `min=0` HTML5 constraint; balance exceeding `MAX_MONEY` (±£1T) rejected by the server's `BalanceIn.balance` Pydantic bound and surfaced as an `Error:` alert; non-numeric input caught by the `parseFloat` NaN path; out-of-range interest rate (-1, 1500%) rejected by `AccountIn.interest_rate` (`MAX_RATE=1000`).
- `tests/e2e/test_theme_persistence.py` (4 tests) — switching theme updates `html[data-theme]` and `localStorage`; toggling dark mode updates `html[data-mode]` and `localStorage`; **the cross-session test** signs in, switches to indigo + dark, asserts `/api/prefs` reflects it, signs out, **clears localStorage**, signs back in, and asserts the dashboard re-hydrates the same theme from the API — proving persistence is server-side, not just browser-cached. The active-swatch test verifies the settings modal moves its `.active` highlight when the theme changes.
- `tests/e2e/test_account_flows.py` (7 tests) — full add-account flow with summary cards updating; balance update with notes reflected in card + total; loan accounts classified into `#total-loans` not `#total-savings` and labelled APR not AER; the subtype dropdown repopulating to a valid set when the parent type changes (no submitting `current+mortgage`); rename via the edit modal; delete via the confirm-delete modal returning the empty state; view switcher between Overview and Budget Planner.

After all changes: `./venv/bin/pytest` → **138 passed** (fast suite unchanged); `./venv/bin/pytest tests/e2e` → **27 passed** in ~27s.

---

## [0.7.0] — 2026-05-19

### UK Account Sub-types

A second dropdown on the Add Account modal lets users record what kind of current / savings / loan account they're tracking. Until now the three-way type was the only categorisation, which forced an ISA, a regular saver, a SIPP and an instant-access pot into the same `savings` bucket — losing useful information at the point of entry. The default sub-type is `general`, so users who don't care about that level of detail are unaffected.

#### Added

**Backend**
- `constants.py` — new `AccountSubtype` Literal covering UK-market account flavours: 6 current-account types (standard, joint, student, premier, basic, business), 11 savings types (cash ISA, stocks & shares ISA, lifetime ISA, junior ISA, regular saver, easy access, fixed-term bond, notice account, premium bonds, SIPP, workplace pension), and 7 loan types (bank loan, credit card, mortgage, student loan, car finance, overdraft, BNPL). Plus a `general` value valid for every parent type. A `SUBTYPES_BY_TYPE` mapping enforces which sub-types are valid for each parent type so the API can reject combos like `type=current, subtype=mortgage`.
- `db.py` — `accounts.subtype` TEXT column added with default `'general'`. Additive `ALTER TABLE` migration so pre-existing rows pick up the default automatically; no recreation of the table needed.
- `schemas.py` — `AccountIn` / `AccountOut` / `AccountPatch` carry a `subtype` field. `AccountIn` uses a `model_validator` so type/subtype combinations are validated at request time. `AccountPatch` cannot be validated by Pydantic alone (the parent `type` is not in the payload), so the app-level handler does that cross-check against the persisted row.
- `app.py` — `POST /api/accounts` persists the chosen sub-type; `PUT /api/accounts/{id}` accepts a `subtype` patch and rejects 400 if the new value isn't valid for the existing row's type. The existing `RequestValidationError → 400` handler now coerces `ctx` values to strings so `ValueError`s raised by `model_validator` don't crash JSON serialisation.

**Frontend**
- `static/index.html` — Add Account modal gains an `Account Subtype` dropdown directly under the type selector. Edit Account modal gets the same dropdown so users can re-classify after the fact.
- `static/app.js` — a `SUBTYPES` catalog provides display labels ("Cash ISA", "Stocks & Shares ISA", "SIPP (Self-Invested Pension)", "Buy Now, Pay Later", …) keyed by parent type and value. `populateSubtypeSelect` rebuilds the dropdown whenever the user switches the parent type, ensuring the available options are always valid. Account cards now show a secondary badge with the sub-type label when it is anything other than `general`.
- `static/style.css` — `.badge-subtype` styling: a muted slate chip with mixed-case text so it reads as a sub-label next to the bold uppercase type badge.

**Tests**
- `tests/test_subtypes.py` — 13 new tests covering: default value, round-trip on list, per-type acceptance of every valid sub-type, the universal `general` value, cross-type rejection (mortgage on current, cash_isa on loan), unknown values rejected with 400, and PATCH semantics including the "PATCH without subtype leaves it unchanged" case.

After all changes: `./venv/bin/pytest` → **125 passed** (112 → 125).

---

## [0.8.0] — 2026-05-19

### Appearance settings — olive theme, palette picker, light/dark mode

A Settings modal (gear icon in the top-right header cluster) now lets each user pick a colour palette and toggle between light and dark mode. Olive is the new default. The picker offers four palettes (Olive, Indigo, Slate, Rose); preferences are stored per user so they follow across browsers / devices.

#### Added

**Backend**
- `constants.py` — `Theme` Literal of allowed palette ids (`olive` / `indigo` / `slate` / `rose`) plus `DEFAULT_THEME`. The Pydantic schema relies on this so unknown values are rejected with 400 before they hit SQLite.
- `db.py` — `users.theme` (TEXT, default `'olive'`) and `users.dark_mode` (INTEGER 0/1) columns. Additive `ALTER TABLE` migrations populate existing rows with the defaults so the upgrade is silent for pre-0.8.0 databases.
- `schemas.py` — `PrefsOut` and `PrefsPatch` schemas. Partial PATCH semantics: omitted fields are left as-is, `extra="forbid"` rejects unknown keys.
- `app.py` — `GET /api/prefs` and `PUT /api/prefs`. SQLite has no native bool so `dark_mode` is cast to `int` on write and back to `bool` on read.

**Frontend**
- `static/style.css` — full theme variables overhaul. Default `:root` switched from indigo (`#6366f1`) to olive (`#708238`). Alternative palettes are one-liners under `[data-theme="..."]` that just override the accent triplet; `--accent-lt` and `--accent-ring` use `color-mix(in srgb, ...)` so they regenerate themselves whenever either the theme or the surface (light/dark) changes. Dark mode lives under `[data-mode="dark"]` and re-targets surface tones, semantic pastels (green/red/amber chips), and shadow opacities. Replaced every hardcoded indigo / slate hex (`--indigo-lt`, `--indigo-dk`, `rgba(99,102,241,.12)` focus ring, the `#fee2e2` loan badge, etc.) with semantic variables so swapping themes restyles every accent-aware element automatically.
- `static/style.css` — new styles for `.header-icon-btn` (round 34px subtle button used by both header icons), `.theme-toggle .icon-sun/.icon-moon` (so the icon flips automatically based on `[data-mode]`), `.theme-swatch` (palette picker tile with active border ring), and `.mode-pill` (compact pill for light/dark inside the settings modal).
- `static/index.html` — added `theme-toggle` and `btn-open-settings` icon buttons in the header's top-right cluster, plus the Settings modal containing the Appearance row (light/dark pill) and the colour-theme grid. Logo SVG fill switched from hardcoded `#6366f1` to `currentColor` so it inherits the active accent.
- `static/index.html` / `static/login.html` — inline pre-paint script that reads `piledger:theme` / `piledger:dark` from `localStorage` and stamps the `<html>` element with the right `data-theme` / `data-mode` before stylesheet eval, avoiding the flash-of-default-theme that would otherwise show on every page load.
- `static/app.js` — `THEMES` catalog + `prefs` state, `applyTheme()` writes the DOM attributes and mirrors to localStorage, `loadPrefs()` is called at boot before `loadAll()`. Settings handlers (`setTheme`, `setDarkMode`, `toggleDarkMode`) optimistically apply, re-render charts, and PUT to `/api/prefs`. Chart text/grid colours now read from CSS variables via `cssVar('--muted')` / `cssVar('--border')` / `cssVar('--surface')` so re-rendering after a theme switch picks up the new palette without any per-chart configuration.
- `static/login.html` — logo SVG fill swapped to `currentColor` so the login page inherits whatever palette is cached for this browser.

**Tests**
- `tests/test_prefs.py` — 13 new tests covering: defaults for new users, auth required on both GET + PUT, single-field and combined PUTs, partial PATCH semantics, empty-PATCH no-op, invalid theme rejected with 400, `extra="forbid"` enforcement, every allowed theme accepted, full cross-user isolation (alice's prefs don't leak to bob, and either user can change their own without affecting the other).

After all changes: `./venv/bin/pytest` → **138 passed** (125 → 138).

---

## [0.6.2] — 2026-05-19

### Docs

**README + CLAUDE.md synced to current code.** The README dated from the 0.1.0 release and had drifted on every feature shipped since. This pass updates only the inaccurate facts; the document's structure and prose are unchanged.

- `README.md` — Architecture + File Structure now reflect the 5-module backend split (`app.py`, `auth.py`, `db.py`, `constants.py`, `schemas.py`) introduced in commit `c180dbd`. Tree includes `tests/`, `pytest.ini`, `requirements-dev.txt`, `CHANGELOG.md`, `CLAUDE.md`, `.gitignore`.
- `README.md` — Database Schema: `accounts.type` now lists `'loan'`; `balance_history.balance REAL` corrected to `balance_cents INTEGER`; the missing `budget_items` table added; the schema-migration paragraph expanded from 1 to 4 migrations (user_id, loan type widening, balance cents, budget amount cents).
- `README.md` — Requirements table: R4 widened to include loans; new rows R12 (budget planning) and R13 (loan/debt tracking).
- `README.md` — API Reference: added the entire Budget Planner section (`GET/POST/PUT/DELETE /api/budget`, `GET /api/budget/projection`); fixed `/api/summary` shape to include `total_loans` and to document `total` as net worth; added a Projection-calculation breakdown for the budget projection formula; added an Error-responses subsection documenting 400/401/404/409.
- `README.md` — Frontend: documented the nav tabs, the Budget Planner view, the 4 summary cards (added Total Debt), the Budget chart, the 6 modals (was 4), and the expanded `state` object including budget fields.
- `README.md` — Authentication: documented the `COOKIE_SECURE` env var and the opportunistic expired-session purge inside `make_session()`; added a subsection on the dummy-hash timing-attack mitigation in `verify_password`.
- `README.md` — Building: setup command uses `pip install -r requirements.txt`; added `requirements-dev.txt` step; new Environment Variables table for `PILEDGER_DB` and `COOKIE_SECURE`.
- `README.md` — Testing: replaced the "No automated test suite is included" claim with a description of the actual 112-test pytest suite, including a per-file breakdown. The curl smoke-test recipes are retained under a new "Manual smoke tests" subsection.
- `README.md` — Security Notes: HTTPS note now references `COOKIE_SECURE`; the "expired session rows are never purged" claim corrected to reflect `make_session`'s opportunistic cleanup.
- `CLAUDE.md` — test count updated from 99 → 112.

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

- **`PILEDGER_DB` environment variable** — the database path is now read from `PILEDGER_DB` if set, falling back to `piledger.db` alongside `app.py`. Prevents the path from being baked into committed code and makes it easy to point different environments at different databases without editing source.
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
- `require_auth` FastAPI dependency — reads the `piledger_session` cookie and raises `HTTP 401` if missing or expired; injects `user_id` into all protected routes.
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
- SQLite database (`piledger.db`) auto-created on first run via `init()` using `CREATE TABLE IF NOT EXISTS`.
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
