# API Reference

All routes under `/api/` (except `/api/auth/register` and `/api/auth/login`) require a valid session cookie. A missing or expired cookie returns `HTTP 401`.

## Ops

| Method | Path | Auth | Response |
|---|---|---|---|
| `GET` | `/healthz` | none | `{ok, version, uptime_s}` — liveness probe for uptime monitors and the Docker healthcheck. Returns the running app version and monotonic uptime in seconds. |
| `GET` | `/docs` | session | Swagger UI. Unauthenticated browsers are 302-redirected to `/login`. |
| `GET` | `/redoc` | session | ReDoc. Same redirect behaviour as `/docs`. |
| `GET` | `/api/openapi.json` | session | OpenAPI 3 spec consumed by the Swagger/ReDoc UIs above. Returns `401` without a session — FastAPI's default `/openapi.json` mount is disabled so an anonymous scanner cannot fingerprint the API. |

## Auth

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/login` | — | Serves `login.html` |
| `POST` | `/api/auth/register` | `{username, password}` | `{id, username}` or `400`/`409` |
| `POST` | `/api/auth/login` | `{username, password}` | `{ok, username}` + sets cookie, or `401` |
| `POST` | `/api/auth/logout` | — (reads cookie) | `{ok}` + deletes session + clears cookie |
| `GET` | `/api/auth/me` | — | `{id, username}` |
| `PUT` | `/api/auth/password` | `{current_password, new_password}` | `{ok}` + rotates every session and sets a fresh cookie, or `400` (weak new password) / `401` (current wrong) |
| `DELETE` | `/api/auth/me` | `{password}` | `{ok}` + cascades every row owned by the user across `accounts` / `balance_history` / `budget_items` / `exchange_rates`, kills all sessions, deletes the user row, and clears the session cookie. `401` if the password is wrong. |

## Accounts

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/accounts` | — | Array of account objects, each with `current_balance` and `last_updated` joined from the latest `balance_history` row |
| `POST` | `/api/accounts` | `{name, type, subtype?, currency?, interest_rate?, color?}` | Created account object. `subtype` defaults to `general` and must be valid for the given `type` (see the `SUBTYPES_BY_TYPE` map in `constants.py`); `currency` defaults to `GBP`. |
| `PUT` | `/api/accounts/{id}` | `{name?, subtype?, currency?, interest_rate?, color?}` | Updated account object. `type` is not editable after creation. |
| `DELETE` | `/api/accounts/{id}` | — | `{ok}` |

## Balance history

| Method | Path | Params | Response |
|---|---|---|---|
| `POST` | `/api/accounts/{id}/balance` | Body: `{balance, notes?, recorded_at?}` | `{ok}` |
| `GET` | `/api/accounts/{id}/history` | `?days=90` | Array of `{balance, notes, recorded_at}` |

## Dashboard

| Method | Path | Params | Response |
|---|---|---|---|
| `GET` | `/api/summary` | — | `{total, total_current, total_savings, total_loans, account_count}` — `total` is **net worth** (`total_current + total_savings − total_loans`), not a flat sum |
| `GET` | `/api/history/all` | `?days=90` | Array of `{id, name, color, type, history[]}` for accounts that have at least one entry in the window |
| `GET` | `/api/projections` | `?months=24` | Array of projection objects for each savings account; includes pre-computed `1yr`, `2yr`, `5yr` values and a full `points[]` array for charting |

## Budget Planner

All routes require auth and operate only on items owned by the calling user. The `account_id` on create / update is verified to belong to the user — a foreign account returns `404`.

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/budget` | — | Array of budget items: `{id, user_id, account_id, name, amount, frequency, created_at}` |
| `POST` | `/api/budget` | `{account_id, name, amount, frequency}` | Created item. `amount` is signed (+ inflow, − outflow). `frequency` ∈ `weekly|monthly|quarterly|annually`. |
| `PUT` | `/api/budget/{id}` | `{name?, amount?, frequency?}` | Updated item |
| `DELETE` | `/api/budget/{id}` | — | `{ok}` |
| `GET` | `/api/budget/projection` | `?months=3\|6\|12` | `{months, accounts[], net_worth[]}` — see below |

The `accounts[]` array in `/api/budget/projection` contains one entry per account with `{id, name, type, color, current_balance, monthly_net, points[], final_balance}`. The `net_worth[]` array contains one entry per month (including month 0 = today) with `{month, balance, date}`, where `balance` is `Σ(assets) − Σ(loans)` at that month.

## User preferences

Per-user UI + currency preferences. Used by the SPA on every page load to drive theme, light/dark, and the base currency that net-worth totals are reported in.

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/prefs` | — | `{theme, dark_mode, base_currency}` |
| `PUT` | `/api/prefs` | `{theme?, dark_mode?, base_currency?}` | Updated `{theme, dark_mode, base_currency}`. Partial — only fields present are written. Changing `base_currency` rescales any stored exchange rates so each one keeps meaning "1 unit of `currency` = `rate` units of base" against the new base. |

`theme` must be one of the values in the `Theme` literal in `constants.py` (currently ten options across green/blue/purple/red/orange/neutral spectrum); `base_currency` must be one of the supported `Currency` codes. Unknown values return `400`.

## Exchange rates

Manual FX table used by `/api/summary` and `/api/budget/projection` to convert per-account balances into the user's base currency. Rates are user-editable from the Settings modal — no outbound HTTP. A missing rate doesn't drop the account from totals; instead `/api/summary` falls back to 1.0 and returns the offending codes in `missing_rates` so the UI can warn.

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/rates` | — | `{base_currency, rates: [{currency, rate, updated_at}, ...]}` |
| `PUT` | `/api/rates` | `{rates: [{currency, rate}, ...]}` | Bulk replace. Each `rate` means "1 unit of `currency` = `rate` units of base". `400` if a rate is set against the base currency itself, or if a currency appears twice in the payload. |

## Data lifecycle

Self-serve data portability. Pairs with the `DELETE /api/auth/me` endpoint in the Auth table.

| Method | Path | Params | Response |
|---|---|---|---|
| `GET` | `/api/export` | — | `{version, exported_at, user, accounts, balance_history, budget_items, exchange_rates}` — a complete user-scoped JSON dump. The `user` sub-object excludes `password_hash`. Returned with `Content-Disposition: attachment; filename="piledger-export-<username>-<YYYY-MM-DD>.json"` so browsers save the response rather than render it. |

## Projection calculation

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

## Error responses

Bad input returns `400` with a `{"detail": ...}` body. Authentication failures return `401`. Resources owned by another user return `404`. Conflicts (e.g. duplicate username on register) return `409`.

## SPA routing

`GET /` checks the session cookie. If valid, it serves `static/index.html`. If invalid or absent, it returns a `302` redirect to `/login`. All static assets are served under the `/static/` prefix by FastAPI's `StaticFiles` mount, which is registered last so it cannot shadow any API routes.
