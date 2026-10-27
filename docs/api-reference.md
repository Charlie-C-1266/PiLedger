# API Reference

All routes under `/api/` (except `/api/auth/register` and `/api/auth/login`) require either a valid session cookie or an `Authorization: Bearer <token>` header (a personal access token minted via `POST /api/tokens` — see [authentication.md](authentication.md)). A missing or invalid credential returns `HTTP 401`. The token-management routes themselves (`/api/tokens*`) are the one exception: they accept the session cookie only, never a bearer token.

## Ops

| Method | Path | Auth | Response |
|---|---|---|---|
| `GET` | `/healthz` | none | `{ok, version, uptime_s}` — liveness probe for uptime monitors and the Docker healthcheck. Returns the running app version and monotonic uptime in seconds. |
| `GET` | `/docs` | session | Swagger UI. Unauthenticated browsers are 302-redirected to `/login`. |
| `GET` | `/redoc` | session | ReDoc. Same redirect behaviour as `/docs`. |
| `GET` | `/api/openapi.json` | session | OpenAPI 3 spec consumed by the Swagger/ReDoc UIs above. Returns `401` without a session — FastAPI's default `/openapi.json` mount is disabled so an anonymous scanner cannot fingerprint the API. |
| `GET` | `/api/docs/{slug}` | none | Raw Markdown (`text/markdown`) for one of the project docs, consumed by the public `/guide` documentation viewer. `slug` is validated against a fixed allowlist (path-traversal–safe); `404` for an unknown slug. |

## Auth

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/login` | — | Serves `login.html` |
| `POST` | `/api/auth/register` | `{username, password}` | `{id, username}` or `400`/`409` |
| `POST` | `/api/auth/login` | `{username, password}` | `{ok, username}` + sets cookie, or `401` |
| `POST` | `/api/auth/logout` | — (reads cookie) | `{ok}` + deletes session + clears cookie |
| `GET` | `/api/auth/me` | — | `{id, username}` |
| `PUT` | `/api/auth/password` | `{current_password, new_password}` | `{ok}` + rotates every session and sets a fresh cookie, or `400` (weak new password) / `401` (current wrong) |
| `DELETE` | `/api/auth/me` | `{password}` | `{ok}` + cascades every row owned by the user (every table in `USER_SCOPED_TABLES` in `db.py`: accounts and their balance history, exchange rates, transactions, goals, custom categories, the budget, scheduled items and their posting log, and API tokens), kills all sessions, deletes the user row, and clears the session cookie. `401` if the password is wrong. |

## API tokens

Personal access tokens for headless clients (CLI, scheduled scripts, an MCP server). Session-cookie auth **only** — a bearer token cannot call these routes, so a leaked token can't mint, list, or revoke tokens. See [authentication.md](authentication.md) for the full model.

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/tokens` | `{name}` | `{id, name, created_at, last_used_at, token}` — `token` (the raw `pil_...` value) is returned **only** in this response |
| `GET` | `/api/tokens` | — | Array of `{id, name, created_at, last_used_at}`, newest first — never the raw token |
| `DELETE` | `/api/tokens/{id}` | — | `{ok}`. `404` if not owned |

## Accounts

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/accounts` | — | Array of account objects, each with `current_balance` and `last_updated` joined from the latest `balance_history` row |
| `POST` | `/api/accounts` | `{name, type, subtype?, institution?, institution_name?, currency?, interest_rate?, color?}` | Created account object. `subtype` defaults to `general` and must be valid for the given `type` (see the `SUBTYPES_BY_TYPE` map in `constants.py`); `currency` defaults to `GBP`. |
| `PUT` | `/api/accounts/{id}` | `{name?, subtype?, institution?, institution_name?, currency?, interest_rate?, color?}` | Updated account object. `type` is not editable after creation. Sending `institution: null` clears the provider; every other field is left unchanged when null. |
| `DELETE` | `/api/accounts/{id}` | — | `{ok}` |

Account `type` must be one of: `current`, `savings`, `loan`, `credit`, `invest`.

`institution` records who the account is held with, as a slug from the `InstitutionSlug` literal in `constants.py`. It pairs with `institution_name` under one rule: `'other'` **requires** a non-empty `institution_name`, and every other slug **forbids** one (the display name comes from the frontend catalogue). A mismatched pair is a 400, on create and update alike — on update the missing half is read from the stored row, so patching either field on its own is checked against the other.

### Low-balance warnings

`POST` and `PUT /api/accounts` accept `low_balance_threshold`: the "Warn me below" amount (zero or more) for a current, savings or investment account. Setting one on a loan or credit account is a `400`. On `PUT`, an explicit `null` clears it, back to warning only below zero. `GET /api/accounts` returns `low_balance_threshold` on every account (`null` when unset), plus `low_balance`: for an open asset account whose projection closes below its threshold (or below zero when unset) on any day from today to 30 days ahead, `{date, balance}` for the first such day; otherwise `null`. The projection is the same one `GET /api/accounts/{id}/projection` returns.

## Balance history

| Method | Path | Params | Response |
|---|---|---|---|
| `POST` | `/api/accounts/{id}/balance` | Body: `{balance, notes?, recorded_at?}` | `{ok}` |
| `GET` | `/api/accounts/{id}/history` | `?days=90`, `?opening=true` | Array of `{balance, notes, recorded_at}`, oldest first, covering the last `days`. With `opening=true` the list starts with the balance the account had when the window opened: its latest earlier snapshot, stamped at the window's start, so a chart's line begins at the left edge. Nothing is added when there's no earlier snapshot or one sits exactly on the edge. |
| `GET` | `/api/accounts/{id}/activity` | `?days=30` (1–366) | `{since, opening_balance, change, count, total_in, total_out}` — `opening_balance` is the latest snapshot at or before `since` (null if the history starts inside the window, and then `change` is null too); `change` is the current balance minus it; `count` and the totals cover transactions dated on or after `since`, with `total_out` as a positive magnitude. 404 for another user's account. |
| `GET` | `/api/accounts/{id}/projection` | `?months=12` (1–60) | `{account_id, currency, as_of, start_balance, points[], horizons[], events[], summary}` in the account's own currency. Rolls the latest balance forward through every active scheduled item touching the account (as its account or a transfer's destination, today's occurrences included, handled ones excluded) plus monthly AER interest on the 1st for asset accounts with a rate; one-off spending is never guessed. `points` is `{date, balance}` per day from today to `months` ahead; `horizons` is `{months, date, balance, change}` for each of 1/3/6/12 months inside the window, with month-end-clamped dates; each event is `{date, subscription_id, name, kind, frequency, category, counterparty_name, amount, auto_post, balance_after}`, where `amount` is the signed cash flow and `kind` is `interest` (no `subscription_id`) for interest; `summary` is `{min_balance, min_date, first_negative_date, end_balance}`, `first_negative_date` being null for credit/loan accounts, whose balances are the amount owed. Closed accounts still answer; 404 for another user's account. |

## Dashboard

| Method | Path | Params | Response |
|---|---|---|---|
| `GET` | `/api/summary` | — | `{total, total_current, total_savings, total_loans, total_credit, total_invest, assets, debts, savings_rate, account_count, base_currency, missing_rates}` — `total` is **net worth** (`assets − debts`). `assets` = current + savings + invest; `debts` = loans + credit. `savings_rate` is savings as a percentage of assets. `missing_rates` is an array of currency codes that have no exchange rate configured. |
| `GET` | `/api/history/all` | `?days=90` | Array of `{id, name, color, type, history[]}` for accounts that have at least one entry in the window |
| `GET` | `/api/history/networth` | `?range=7D\|30D\|90D\|1Y` | Array of `{date, value}` net-worth data points over the selected range, converted to the user's base currency. Used by the Overview net-worth chart. |
| `GET` | `/api/projections` | `?months=24` | Array of projection objects for each savings account; includes pre-computed `1yr`, `2yr`, `5yr` values and a full `points[]` array for charting |

## Budget (zero-based envelopes)

The envelope budget: manual income lines, envelope groups, and the envelopes inside them. Budgeted and income figures are user-entered and stored monthly (in pounds via the API). Each envelope's `spent` is computed live and is never stored. Full CRUD is available for income lines, groups, and envelopes; the read-only `GET /api/budget` aggregate (detailed after the table) is what the Budget screen renders.

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/budget` | — | `{incomes[], groups[], history[], base_currency, missing_rates}` — see below |
| `POST` | `/api/budget/income` | `{label, amount?}` | Created income line `{id, label, amount, sort_order}`. `amount` defaults to 0; new lines append to the end. |
| `PUT` | `/api/budget/income/{id}` | `{label?, amount?, sort_order?}` | Updated income line. `404` if not owned. |
| `DELETE` | `/api/budget/income/{id}` | — | `{ok}`. `404` if not owned. |
| `POST` | `/api/budget/groups` | `{name, color?, flexible?}` | Created group `{id, name, color, flexible, sort_order}` (no nested envelopes). `color` is a `#rrggbb` hex (defaults to `#0F766E`); `flexible` defaults to `false`; groups append to the end. |
| `PUT` | `/api/budget/groups/{id}` | `{name?, color?, flexible?, sort_order?}` | Updated group. `404` if not owned. |
| `DELETE` | `/api/budget/groups/{id}` | — | `{ok}` — deleting a group cascades its envelopes. `404` if not owned. |
| `POST` | `/api/budget/envelopes` | `{group_id, label, category, budgeted?}` | Created envelope `{id, group_id, label, category, budgeted, sort_order}` (no `spent`). `group_id` must be an owned group (`404` otherwise); `category` must be a known category for the user — a default or one of their custom categories (`422` otherwise); the category must not already be enveloped (`409` — `UNIQUE(user_id, category)`). |
| `PUT` | `/api/budget/envelopes/{id}` | `{group_id?, label?, category?, budgeted?, sort_order?}` | Updated envelope. Same ownership / category-exists / uniqueness checks; `group_id` can move it to another owned group. `404` if not owned. |
| `DELETE` | `/api/budget/envelopes/{id}` | — | `{ok}`. `404` if not owned. |

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
| `POST` | `/api/transactions/import/preview` | `{csv_text, account_id?, mapping?, date_format?}` | `{columns, sample_rows, row_count, suggested_mapping, matches}`. Parses the CSV and returns its header row, the first 20 data rows, the total row count, and a best-effort column-name guess for each field. Given `account_id` and `mapping` (together, as in commit), `matches` lists every row that matches a transaction a scheduled item already posted to that account — same amount, dates within 3 days, one-to-one — as `[{row, date, merchant, amount, match: {transaction_id, name, date}}]`; otherwise it is empty. `400` if the CSV has no header row or exceeds 5,000 rows, or if only one of `account_id`/`mapping` is given; `404` if `account_id` isn't the user's. |
| `POST` | `/api/transactions/import/commit` | `{csv_text, account_id, mapping: {date, amount? or debit?+credit?, merchant, category?, note?}, date_format?, match_choices?: [{row, claim}]}` | `{imported, matched, skipped_duplicates, errors: [{row, message}]}`. Re-parses the CSV with the confirmed mapping and inserts one transaction per row; a row that fails validation is collected in `errors` rather than failing the whole import, and a row that dedups against an already-imported transaction (same account, date, amount, merchant) is counted in `skipped_duplicates`. A row that matches a scheduled item's posted transaction (as in preview) claims it instead — the transaction takes the row's date, merchant and dedup hash (a transfer leg takes only the hash, since transfers can't be edited), no row is added and the balance is unchanged — and is counted in `matched`; send `{row, claim: false}` in `match_choices` to import that row as a new transaction instead. `400` if the mapping references a column not in the CSV; `404` if `account_id` isn't the user's. See the [CSV import guide](csv-import.md) for the full column-mapping and date-format options. |

Transaction response shape. A `transfer_id` string is present on the two legs of a transfer, otherwise `null`. `subscription_id` is the [scheduled item](#scheduled-items) whose occurrence created the row (by auto-post or Post now; on both legs of a scheduled transfer), and `null` otherwise. A CSV row that claims a posted transaction keeps its link. It is read from the posting log, so it is the same on every endpoint that returns transactions:

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
  "subscription_id": null,
  "created_at": "2026-05-27T14:01:00"
}
```

A transaction a scheduled item posted is otherwise ordinary: it can be edited or deleted like any other. Deleting it does not make the item post that date again.

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

## Scheduled items

Recurring payments, income and transfers: the **Scheduled** screen. The table and paths keep their original `subscriptions` name so existing API-token and MCP clients keep working. Each item is a reminder unless `auto_post` is on, in which case PiLedger posts each due date (an *occurrence*) as a real transaction. Every handled occurrence, posted or skipped, is recorded in a posting log; see [Scheduled](scheduled.md) for the user-facing behaviour.

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/subscriptions` | `?account=<id>` | Array of scheduled items, soonest `next_due_date` first; items with none (paused or ended) sink to the bottom, with name as the tiebreak. `account` keeps only items that touch that account, as their account or as a transfer's destination. |
| `GET` | `/api/subscriptions/occurrences` | `?from=YYYY-MM-DD&to=YYYY-MM-DD`, `?account=<id>` | Every due date of every active item in the window (both ends inclusive), sorted by date, as `{date, subscription_id, name, amount, color, kind, account_id, to_account_id, status}`. `status` is `posted` or `skipped` from the posting log, or `null` while unhandled. `account` filters as on the list. `400` for a malformed date, `to` before `from`, or a window over 366 days. |
| `POST` | `/api/subscriptions` | `{name, amount, frequency, start_date, kind?, category?, account_id?, to_account_id?, end_date?, color?, notes?, active?, auto_post?, auto_post_from?}` | Created item (HTTP 201). See the rules below. |
| `PUT` | `/api/subscriptions/{id}` | Any subset of the create fields | Updated item. Partial: an omitted field is left unchanged. An explicit `null` clears `account_id`, `to_account_id` or `end_date`; `null` for `kind`, `auto_post` or `auto_post_from` means "leave it". `404` if not owned. |
| `DELETE` | `/api/subscriptions/{id}` | — | `{ok}`. Deletes the item and its posting log; transactions it posted are kept. `404` if not owned. |
| `POST` | `/api/subscriptions/post-due` | — | `{posted}`: runs auto-post now for the calling user, exactly as the daily run would, and returns how many occurrences it posted. Safe to repeat. |
| `POST` | `/api/subscriptions/{id}/post` | `{date}` | Posting object. **Post now**: creates the transaction for occurrence `date` (of any item, reminders included), dated today, and records the occurrence as posted so auto-post won't post it again. Repeating it is a no-op; a skipped date becomes posted. `400` if `date` isn't one of the item's due dates, or the item has no open account to post to. |
| `POST` | `/api/subscriptions/{id}/skip` | `{date}` | Posting object. **Skip**: records occurrence `date` as skipped, so it neither posts nor appears in projections. If it was already posted, that transaction (both legs, for a transfer) is deleted and the balance reversed. Repeating it is a no-op. `400` if `date` isn't one of the item's due dates. |
| `DELETE` | `/api/subscriptions/{id}/postings/{date}` | — | `{ok}`. **Undo**: deletes that occurrence's log entry and any transaction it created, reversing the balance. The date is unhandled again, so an auto-posting item posts it on its next run if it has passed. `date` isn't checked against the current schedule, so a posting made before an edit can still be undone. `404` when nothing is logged for that date. |

**Fields.** `name` is 1–120 characters. `amount` is always positive (`kind` gives the direction). `frequency` is one of `weekly`, `biweekly`, `monthly`, `quarterly`, `annual`; monthly, quarterly and annual dates fall on the start date's day of the month, clamped to the last day of a shorter month. `start_date` is the first occurrence; `end_date` (optional) is the last day one can fall on. `active` defaults to `true`; a paused item (`false`) has no occurrences, isn't projected and doesn't post.

**Kinds and accounts.** `kind` is `expense` (the default), `income` or `transfer`:

- An `expense` leaves `account_id` and an `income` arrives in it. The account is optional for a reminder, must be one of the user's (`404` otherwise), and a `to_account_id` is rejected (`400`).
- A `transfer` moves the amount from `account_id` to `to_account_id`. Both are required, must differ, must be the user's, and must share a currency (`400` otherwise, the same rule as `POST /api/transfers`).
- On update, changes to `kind` and either account are merged with the stored row and checked together. Changing `kind` away from `transfer` without naming `to_account_id` drops the stored destination.
- Deleting a linked account unlinks the item rather than deleting it.

**Auto-post.** `auto_post` defaults to **off**: a client that doesn't send it never starts moving money. Turning it on needs every account the item posts to linked and open (`400` otherwise). `auto_post_from` is the first day it may post; nothing earlier is back-filled. It is set to today when auto-post is switched on, when a paused item is resumed, and when `kind`, either account, `frequency`, `start_date` or `end_date` actually changes, unless the request names a date itself. Switching auto-post off clears it.

When posting runs (at startup, daily at `PILEDGER_AUTOPOST_TIME`, and on `post-due`), each auto-posting item posts every occurrence from `auto_post_from` to today that isn't in its posting log. Each is created in one SQLite transaction with its log entry, which is unique on `(subscription_id, occurrence_date)`, so overlapping runs can't post a date twice and a deleted transaction is never recreated. An item whose account is unlinked or closed is skipped with a server-log warning and catches up once it can post again.

A posted occurrence creates:

- for an `expense` or `income`, one transaction on `account_id` (negative for an expense, positive for income) with `merchant` set to the item's name and the item's `category`;
- for a `transfer`, a transfer between the two accounts, both legs named after the item and filed under its `category` (or `Transfer` if it has none).

Auto-posted transactions are dated at midnight UTC on the occurrence date with the note `Posted automatically`. Post now dates them at midnight UTC today with the note `Posted from schedule`.

Scheduled item response shape (`next_due_date` is computed on read: the next due date from today that isn't posted or skipped, or `null` when the item is paused or has ended; an account link to a deleted account reads as `null`):

```json
{
  "id": 4,
  "user_id": 1,
  "name": "Netflix",
  "amount": 10.99,
  "category": "Entertainment",
  "kind": "expense",
  "account_id": 3,
  "account_name": "Current account",
  "to_account_id": null,
  "to_account_name": null,
  "frequency": "monthly",
  "start_date": "2026-01-14",
  "end_date": null,
  "color": "#E50914",
  "notes": "",
  "active": true,
  "next_due_date": "2026-11-14",
  "auto_post": true,
  "auto_post_from": "2026-10-27",
  "created_at": "2026-10-27 09:30:00"
}
```

Posting object, returned by Post now and Skip:

```json
{
  "subscription_id": 4,
  "date": "2026-11-14",
  "status": "posted",
  "transaction_id": 212,
  "transfer_id": null
}
```

`transaction_id` is set for a posted expense or income, `transfer_id` for a posted transfer, and both are `null` once skipped (or after the posted transaction was deleted).

## User preferences

Per-user currency preference. This endpoint stores a user's `base_currency` — the currency net-worth totals are reported in. Theme and light/dark mode used to live here too but are now owned entirely by the React client (`localStorage`); the server no longer carries them. The SPA reads the active `base_currency` from `/api/summary`, so it does not call `/api/prefs` itself today — the endpoint remains the canonical contract for the base-currency preference (and for non-SPA or future clients).

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/prefs` | — | `{base_currency}` |
| `PUT` | `/api/prefs` | `{base_currency?}` | Updated `{base_currency}`. Partial — only fields present are written. Changing `base_currency` rescales any stored exchange rates so each one keeps meaning "1 unit of `currency` = `rate` units of base" against the new base. |

`base_currency` must be one of the supported `Currency` codes; unknown values (or the retired `theme` / `dark_mode` fields) return `400`.

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
| `GET` | `/api/export` | — | `{version, exported_at, user, ...}` plus one key per user-scoped table (`accounts`, `balance_history`, `exchange_rates`, `transactions`, `goals`, `user_categories`, `budget_income`, `budget_group`, `budget_envelope`, `subscriptions`, `subscription_postings`) — a complete user-scoped JSON dump. API tokens are left out, and the `user` sub-object excludes `password_hash`. Returned with `Content-Disposition: attachment; filename="piledger-export-<username>-<YYYY-MM-DD>.json"` so browsers save the response rather than render it. |

## Projection calculation

**Savings projections** (`/api/projections`) run each open savings account through the same engine as the account projections below, so they include the account's scheduled transactions (transfers in, for example) as well as its interest. `points` has one entry per month from today, where month 0 is the current balance, up to `months` ahead. The `1yr`, `2yr` and `5yr` milestones are always 12, 24 and 60 months on, whatever `months` is, and `1yr` matches the 12-month horizon on the account's page. Closed accounts are left out.

**Account projections** (`/api/accounts/{id}/projection`) roll the account's latest balance forward one day at a time, from today to `months` ahead, in integer cents:

- Every occurrence of an active scheduled item touching the account (as its account or as a transfer's destination) lands on its date, including today's, unless it's already in the posting log or past the item's end date. Reminders count as well as auto-posting items.
- An asset account (current, savings, invest) with an interest rate earns interest on each 1st of the month after today. The rate is treated as an AER, so the credit is that morning's balance × ((1 + rate/100)^(1/12) − 1), rounded half-up to the cent. Loan and credit accounts earn none here.
- Within a day, interest lands first, then money in, then money out.
- Horizon dates are calendar months from today, clamped to month end (a projection made on 31 January has its 1-month horizon on 28 or 29 February).

For a loan or credit account every balance is the amount owed, which is why `first_negative_date` is always `null` for them.

## Error responses

Bad input returns `400` with a `{"detail": ...}` body. Authentication failures return `401`. Resources owned by another user return `404`. Conflicts (e.g. duplicate username on register) return `409`.

## SPA routing

`GET /` checks the session cookie. If valid, it serves the compiled React app (`static/dist/index.html`). If invalid or absent, it returns a `302` redirect to `/login`. The following named routes are also registered on the server and serve the same SPA shell — the React router handles client-side navigation between them:

| Path | View |
|---|---|
| `/overview` | Dashboard — net-worth chart, account cards, recent transactions, goals progress |
| `/accounts` | Account list with card stack and asset/debt breakdown |
| `/accounts/{id}` | One account's page — balance, projection, upcoming scheduled items, recent transactions, details |
| `/transactions` | Transaction browser with search, filters, and pagination |
| `/budget` | Zero-based envelope budget — income, envelope groups, hero, period toggle, right rail, and trend |
| `/goals` | Savings goals grid with progress tracking and ETA |
| `/scheduled` | Scheduled payments, income and transfers — list and calendar |
| `/subscriptions` | The Scheduled screen's old path; the client redirects it to `/scheduled` so saved links still work |
| `/settings` | User preferences, password change, exchange rates, account deletion |

All of these routes require a valid session; unauthenticated requests are 302-redirected to `/login`. Two standalone pages live outside the SPA shell: `/login` (the login / register page) and `/guide` (the public documentation viewer) — both are self-contained static HTML and `/guide` needs no session. Static assets are served under the `/static/` prefix by FastAPI's `StaticFiles` mount, which is registered last so it cannot shadow any API routes.
