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
| `DELETE` | `/api/auth/me` | `{password}` | `{ok}` + cascades every row owned by the user across `accounts` / `balance_history` / `exchange_rates` / `transactions` / `goals`, kills all sessions, deletes the user row, and clears the session cookie. `401` if the password is wrong. |

## Accounts

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/accounts` | — | Array of account objects, each with `current_balance` and `last_updated` joined from the latest `balance_history` row |
| `POST` | `/api/accounts` | `{name, type, subtype?, currency?, interest_rate?, color?}` | Created account object. `subtype` defaults to `general` and must be valid for the given `type` (see the `SUBTYPES_BY_TYPE` map in `constants.py`); `currency` defaults to `GBP`. |
| `PUT` | `/api/accounts/{id}` | `{name?, subtype?, currency?, interest_rate?, color?}` | Updated account object. `type` is not editable after creation. |
| `DELETE` | `/api/accounts/{id}` | — | `{ok}` |

Account `type` must be one of: `current`, `savings`, `loan`, `credit`, `invest`.

## Balance history

| Method | Path | Params | Response |
|---|---|---|---|
| `POST` | `/api/accounts/{id}/balance` | Body: `{balance, notes?, recorded_at?}` | `{ok}` |
| `GET` | `/api/accounts/{id}/history` | `?days=90` | Array of `{balance, notes, recorded_at}` |

## Dashboard

| Method | Path | Params | Response |
|---|---|---|---|
| `GET` | `/api/summary` | — | `{total, total_current, total_savings, total_loans, total_credit, total_invest, assets, debts, savings_rate, account_count, base_currency, missing_rates}` — `total` is **net worth** (`assets − debts`). `assets` = current + savings + invest; `debts` = loans + credit. `savings_rate` is savings as a percentage of assets. `missing_rates` is an array of currency codes that have no exchange rate configured. |
| `GET` | `/api/history/all` | `?days=90` | Array of `{id, name, color, type, history[]}` for accounts that have at least one entry in the window |
| `GET` | `/api/history/networth` | `?range=7D\|30D\|90D\|1Y` | Array of `{date, value}` net-worth data points over the selected range, converted to the user's base currency. Used by the Overview net-worth chart. |
| `GET` | `/api/projections` | `?months=24` | Array of projection objects for each savings account; includes pre-computed `1yr`, `2yr`, `5yr` values and a full `points[]` array for charting |

## Budget (zero-based envelopes)

The envelope budget: manual income lines, envelope groups, and the envelopes inside them. Budgeted and income figures are user-entered and stored monthly (in pounds via the API). Each envelope's `spent` is computed live and is never stored. CRUD endpoints for income / groups / envelopes are added in later phases.

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/budget` | — | `{incomes[], groups[], history[], base_currency, missing_rates}` — see below |
| `POST` | `/api/budget/income` | `{label, amount?}` | Created income line `{id, label, amount, sort_order}`. `amount` defaults to 0; new lines append to the end. |
| `PUT` | `/api/budget/income/{id}` | `{label?, amount?, sort_order?}` | Updated income line. `404` if not owned. |
| `DELETE` | `/api/budget/income/{id}` | — | `{ok}`. `404` if not owned. |
| `POST` | `/api/budget/groups` | `{name, color?, flexible?}` | Created group `{id, name, color, flexible, sort_order}` (no nested envelopes). `color` is a `#rrggbb` hex (defaults to `#0F766E`); `flexible` defaults to `false`; groups append to the end. |
| `PUT` | `/api/budget/groups/{id}` | `{name?, color?, flexible?, sort_order?}` | Updated group. `404` if not owned. |
| `DELETE` | `/api/budget/groups/{id}` | — | `{ok}` — deleting a group cascades its envelopes. `404` if not owned. |

Read-only aggregate for the Budget screen:

- `incomes[]` — `{id, label, amount, sort_order}`; `amount` is the monthly income line in pounds.
- `groups[]` — `{id, name, color, flexible, sort_order, envelopes[]}`. `flexible` (bool) drives the "safe to spend" calculation. Each envelope is `{id, group_id, label, category, budgeted, spent, sort_order}`: `budgeted` is the monthly allocation in pounds; `spent` is the sum of the **current month's** negative transactions in that envelope's `category`, converted to the user's base currency.
- `history[]` — last 6 months, oldest first, each `{month, budgeted, spent}` where `month` is `"YYYY-MM"`. `spent` is that month's actual spend across enveloped categories; `budgeted` is the *current* total allocation as a flat reference line (historical plans are not snapshotted). Empty when the user has no envelopes.
- `base_currency` / `missing_rates` — mirror `/api/summary`: cross-currency spend is converted to the base currency, and any currency lacking a configured rate is listed in `missing_rates` (and falls back to a 1.0 rate rather than being dropped).

## Transactions

Transaction records linked to an account. Creating or deleting a transaction automatically adjusts the account's latest balance snapshot via a new `balance_history` entry. Updating a transaction's `amount` or `account_id` also triggers a balance correction.

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/transactions` | `?search=`, `?account=`, `?category=`, `?sort=date\|amount`, `?page=1`, `?per_page=50` | Array of transaction objects, newest first by default. `search` matches against `merchant` and `category` (case-insensitive). `per_page` max is 200. |
| `POST` | `/api/transactions` | `{account_id, amount, merchant, category?, note?, occurred_at?}` | Created transaction object (HTTP 201). `amount` is signed (positive = income, negative = expense). `occurred_at` accepts any ISO-8601 datetime; defaults to current UTC time. `404` if `account_id` doesn't belong to the user. |
| `PUT` | `/api/transactions/{id}` | `{account_id?, amount?, merchant?, category?, note?, occurred_at?}` | Updated transaction object. All fields are optional (partial update). If `amount` or `account_id` changes, the old account's balance is reversed and the new account's balance is adjusted. `400` if the transaction is a transfer leg (transfers can't be edited). |
| `DELETE` | `/api/transactions/{id}` | — | `{ok}`. Reverses the transaction's balance contribution from the account. If the transaction is part of a transfer, **both** legs are deleted and both balances reversed. |
| `POST` | `/api/transfers` | `{from_account_id, to_account_id, amount, occurred_at?, note?}` | Array of the two created transaction objects (HTTP 201). Moves `amount` (positive) from source to destination as two linked transactions sharing a `transfer_id` — `-amount` on the source, `+amount` on the destination — so net worth is unchanged. `400` if the accounts are the same or differ in currency; `404` if either account isn't the user's. |

Transaction response shape (a `transfer_id` string is present on the two legs of a transfer, otherwise `null`):

```json
{
  "id": 1,
  "user_id": 1,
  "account_id": 3,
  "amount": -42.50,
  "occurred_at": "2026-05-27T14:00:00",
  "merchant": "Tesco",
  "category": "groceries",
  "note": "",
  "transfer_id": null,
  "created_at": "2026-05-27T14:01:00"
}
```

## Goals

Savings goals with target amounts, current progress, and optional monthly contribution tracking. A goal may optionally be **linked to an account** (`account_id`): a linked goal's `saved` value is reported live as that account's current balance (e.g. an emergency fund tracking a savings account), rather than a manually-entered figure.

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/goals` | — | Array of goal objects ordered by creation date |
| `POST` | `/api/goals` | `{name, target, saved?, monthly?, color?, account_id?}` | Created goal object (HTTP 201). `target` must be > 0. `saved` and `monthly` default to 0. `color` defaults to `#0F766E`. `account_id`, if given, must be one of the user's accounts (`404` otherwise) and makes `saved` track that account's balance. |
| `PUT` | `/api/goals/{id}` | `{name?, target?, saved?, monthly?, color?, account_id?}` | Updated goal object. All fields optional (partial update); only fields present are written. Send `account_id: null` to unlink, or an account id to link (`404` if not the user's). |
| `DELETE` | `/api/goals/{id}` | — | `{ok}` |

Deleting an account a goal is linked to unlinks the goal (its `account_id` is set to null) rather than deleting the goal.

Goal response shape (`account_id`/`account_name` are null for an unlinked goal):

```json
{
  "id": 1,
  "user_id": 1,
  "name": "Emergency fund",
  "target": 5000.00,
  "saved": 1250.00,
  "monthly": 200.00,
  "color": "#0F766E",
  "account_id": 3,
  "account_name": "Savings",
  "created_at": "2026-05-01T10:00:00"
}
```

The ETA shown in the UI is computed client-side: `ceil((target − saved) / monthly)` months when `monthly > 0`.

## User preferences

Per-user UI + currency preferences. Used by the SPA on every page load to drive theme, light/dark, and the base currency that net-worth totals are reported in.

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/prefs` | — | `{theme, dark_mode, base_currency}` |
| `PUT` | `/api/prefs` | `{theme?, dark_mode?, base_currency?}` | Updated `{theme, dark_mode, base_currency}`. Partial — only fields present are written. Changing `base_currency` rescales any stored exchange rates so each one keeps meaning "1 unit of `currency` = `rate` units of base" against the new base. |

`theme` must be one of the values in the `Theme` literal in `constants.py` (currently ten options across green/blue/purple/red/orange/neutral spectrum); `base_currency` must be one of the supported `Currency` codes. Unknown values return `400`.

## Exchange rates

Manual FX table used by `/api/summary` and `/api/projections` to convert per-account balances into the user's base currency. Rates are user-editable from the Settings modal — no outbound HTTP. A missing rate doesn't drop the account from totals; instead `/api/summary` falls back to 1.0 and returns the offending codes in `missing_rates` so the UI can warn.

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/rates` | — | `{base_currency, rates: [{currency, rate, updated_at}, ...]}` |
| `PUT` | `/api/rates` | `{rates: [{currency, rate}, ...]}` | Bulk replace. Each `rate` means "1 unit of `currency` = `rate` units of base". `400` if a rate is set against the base currency itself, or if a currency appears twice in the payload. |

## Data lifecycle

Self-serve data portability. Pairs with the `DELETE /api/auth/me` endpoint in the Auth table.

| Method | Path | Params | Response |
|---|---|---|---|
| `GET` | `/api/export` | — | `{version, exported_at, user, accounts, balance_history, exchange_rates, transactions, goals}` — a complete user-scoped JSON dump. The `user` sub-object excludes `password_hash`. Returned with `Content-Disposition: attachment; filename="piledger-export-<username>-<YYYY-MM-DD>.json"` so browsers save the response rather than render it. |

## Projection calculation

**Savings projections** (`/api/projections`) — compound interest with monthly compounding:

```
monthly_rate = (annual_rate_percent / 100) / 12
balance(m) = initial_balance × (1 + monthly_rate)^m
```

One data point per month for the requested horizon, plus pre-computed milestones at 12, 24, and 60 months.

## Error responses

Bad input returns `400` with a `{"detail": ...}` body. Authentication failures return `401`. Resources owned by another user return `404`. Conflicts (e.g. duplicate username on register) return `409`.

## SPA routing

`GET /` checks the session cookie. If valid, it serves the compiled React app (`static/dist/index.html`). If invalid or absent, it returns a `302` redirect to `/login`. The following named routes are also registered on the server and serve the same SPA shell — the React router handles client-side navigation between them:

| Path | View |
|---|---|
| `/overview` | Dashboard — net-worth chart, account cards, recent transactions, goals progress |
| `/accounts` | Account list with card stack and asset/debt breakdown |
| `/transactions` | Transaction browser with search, filters, and pagination |
| `/goals` | Savings goals grid with progress tracking and ETA |
| `/settings` | User preferences, password change, exchange rates, account deletion |

All five routes require a valid session; unauthenticated requests are 302-redirected to `/login`. Static assets are served under the `/static/` prefix by FastAPI's `StaticFiles` mount, which is registered last so it cannot shadow any API routes.
