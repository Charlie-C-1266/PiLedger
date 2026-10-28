# Database Schema

## `users`

Stores registered accounts. Usernames are case-insensitive (SQLite `COLLATE NOCASE`).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `username` | TEXT UNIQUE | Case-insensitive |
| `password_hash` | TEXT | `salt:pbkdf2_hex` — see [Authentication](authentication.md) |
| `created_at` | TEXT | UTC ISO-8601, set by SQLite `datetime('now')` |

## `sessions`

One row per active login session. Deleted on logout; expires after 30 days.

| Column | Type | Notes |
|---|---|---|
| `token` | TEXT PK | 64-character hex string (32 random bytes) |
| `user_id` | INTEGER FK → `users.id` | Cascade-deletes when user is removed |
| `expires_at` | TEXT | UTC ISO-8601 |

## `accounts`

Financial accounts. Each row belongs to exactly one user.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK → `users.id` | Nullable to support schema migration |
| `name` | TEXT | Display name, e.g. "Barclays Current" |
| `type` | TEXT | Constrained to `'current'`, `'savings'`, `'loan'`, `'credit'`, or `'invest'` |
| `subtype` | TEXT | Sub-classification within a type (e.g. `'cash_isa'`, `'stocks_shares_isa'`, `'mortgage'`); defaults to `'general'`. Full list in the `AccountSubtype` literal in `constants.py` |
| `institution` | TEXT | The provider the account is held with, as a catalogue slug (e.g. `'chase'`, `'nationwide'`); NULL when not recorded. Full list in the `InstitutionSlug` literal in `constants.py` |
| `institution_name` | TEXT | Free-text provider name, set **only** when `institution` is `'other'`; NULL otherwise (a catalogue slug takes its display name from the frontend) |
| `currency` | TEXT | ISO-4217 currency code; defaults to `'GBP'` |
| `interest_rate` | REAL | Annual rate as a percentage (e.g. `4.5` for 4.5% AER on savings, or APR on loans) |
| `color` | TEXT | Hex colour used in chart lines and card borders |
| `counts_to_net_worth` | INTEGER | `1` = counts toward the Accessible net-worth headline, `0` = set aside (e.g. a pension or SIPP); defaults to `1`. See [ADR-0003](adr/0003-accessible-net-worth-user-flag.md) |
| `closed` | INTEGER | `1` = closed: history is kept but the account takes no new transactions, transfers, imports or scheduled postings; defaults to `0` |
| `low_balance_threshold_cents` | INTEGER | The "Warn me below" amount in integer cents: the account is flagged when its projection drops under it within 30 days. NULL = unset, which warns only below zero. Asset accounts only (the API refuses one on a loan or credit account) |
| `created_at` | TEXT | UTC ISO-8601 |

## `balance_history`

Immutable log of balance snapshots. Every "Update Balance" action appends a new row; no row is ever modified.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `account_id` | INTEGER FK → `accounts.id` | Cascade-deletes when account is removed |
| `balance_cents` | INTEGER | Balance stored as integer cents to avoid float drift; the API exposes pounds |
| `notes` | TEXT | Optional free-text annotation |
| `recorded_at` | TEXT | UTC ISO-8601, set by the server at insert time |

## `exchange_rates`

Manual FX rates per user. One row per currency pair. Rates express "1 unit of `currency` = `rate` units of the user's base currency". The base currency itself is never stored here — the rate against the base is always implicitly 1.

| Column | Type | Notes |
|---|---|---|
| `user_id` | INTEGER FK → `users.id` | Composite primary key with `currency`. Cascade-deletes when user is removed. |
| `currency` | TEXT | ISO-4217 currency code |
| `rate` | REAL | Conversion rate relative to the user's base currency |
| `updated_at` | TEXT | UTC ISO-8601, set by SQLite `datetime('now')` on insert |

## `transactions`

Financial transaction records. Each row represents a single transaction on one account. Creating or deleting a transaction automatically writes a new `balance_history` entry to keep the account balance in sync.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK → `users.id` | Cascade-deletes when user is removed |
| `account_id` | INTEGER FK → `accounts.id` | Cascade-deletes when account is removed |
| `amount_cents` | INTEGER | Signed amount in cents (positive = credit / income, negative = debit / expense) |
| `occurred_at` | TEXT | UTC ISO-8601; defaults to insert time |
| `merchant` | TEXT | Merchant or payee name; required, 1–200 characters |
| `category` | TEXT | Optional category tag (e.g. `'groceries'`); defaults to `''` |
| `note` | TEXT | Optional free-text note; defaults to `''` |
| `transfer_id` | TEXT | Shared by the two legs of a transfer; NULL otherwise |
| `import_hash` | TEXT | Set on rows that came from a CSV import, so re-importing the same file skips them; unique when not NULL |
| `created_at` | TEXT | UTC ISO-8601, set by SQLite `datetime('now')` on insert |
| `adjustment` | INTEGER | `1` on a Balance adjustment: the row a manual balance update records for the difference it made (merchant "Balance adjustment", category "Adjustment"). It is written alongside the update's `balance_history` row rather than moving the balance itself, and is left out of budget spend and money-in/out totals. `0` otherwise, including every row from before v18 |

A transaction doesn't record which scheduled item posted it: the API reads that from `subscription_postings` (by `transaction_id`, or `transfer_id` for both legs of a transfer) and reports it as `subscription_id`.

## `goals`

Named savings goals. Independent of accounts — tracks a target amount and progress toward it.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK → `users.id` | Cascade-deletes when user is removed |
| `name` | TEXT | Goal name, 1–120 characters |
| `target_cents` | INTEGER | Target amount in cents; must be > 0 |
| `saved_cents` | INTEGER | Amount already saved in cents; defaults to 0 |
| `monthly_cents` | INTEGER | Monthly contribution in cents used for ETA calculation; defaults to 0 |
| `color` | TEXT | Hex colour for the goal card; defaults to `#0F766E` |
| `created_at` | TEXT | UTC ISO-8601, set by SQLite `datetime('now')` on insert |

## `budget_income`

Manual income lines for the zero-based envelope budget — what the user has to assign each month. Not derived from transactions. Amounts are stored monthly.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK → `users.id` | Cascade-deletes when user is removed |
| `label` | TEXT | Display name, e.g. "Salary" |
| `amount_cents` | INTEGER | Monthly amount in cents; defaults to 0 |
| `sort_order` | INTEGER | Display order; defaults to 0 |
| `created_at` | TEXT | UTC ISO-8601, set by SQLite `datetime('now')` on insert |

## `budget_group`

A named group of envelopes (e.g. "Bills & Housing"). `flexible` drives the "safe to spend" calculation — only flexible groups count toward it.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK → `users.id` | Cascade-deletes when user is removed |
| `name` | TEXT | Group name |
| `color` | TEXT | Hex colour for the group swatch/slices; defaults to `#0F766E` |
| `flexible` | INTEGER | `1` = flexible (counts toward safe-to-spend), `0` = fixed; defaults to 0 |
| `sort_order` | INTEGER | Display order; defaults to 0 |
| `created_at` | TEXT | UTC ISO-8601, set by SQLite `datetime('now')` on insert |

## `budget_envelope`

A single spending envelope inside a group. Each envelope tracks exactly one PiLedger transaction `category`; its actual `spent` is computed live from transactions and is never stored. Budgeted amounts are stored monthly.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK → `users.id` | Cascade-deletes when user is removed |
| `group_id` | INTEGER FK → `budget_group.id` | Cascade-deletes when the group is removed |
| `label` | TEXT | Display name, e.g. "Rent" |
| `category` | TEXT | The transaction category this envelope tracks for `spent` |
| `budgeted_cents` | INTEGER | Monthly budgeted amount in cents; defaults to 0 |
| `sort_order` | INTEGER | Display order within the group; defaults to 0 |
| `created_at` | TEXT | UTC ISO-8601, set by SQLite `datetime('now')` on insert |

`UNIQUE(user_id, category)` — a category may be enveloped at most once per user, so its spend is never double-counted.

## `subscriptions`

Scheduled items: the recurring payments, income and transfers on the **Scheduled** screen. The table keeps its original name because the `/api/subscriptions` API does. Due dates (occurrences) are never stored; they're computed from `start_date` and `frequency` whenever they're needed.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK → `users.id` | Cascade-deletes when user is removed |
| `name` | TEXT | Display name, 1–120 characters |
| `amount_cents` | INTEGER | Always positive; `kind` gives the direction |
| `category` | TEXT | Optional transaction category; defaults to `''` |
| `account_id` | INTEGER FK → `accounts.id` | The account money leaves (an expense, or a transfer's source) or arrives in (income). Nullable; `ON DELETE SET NULL` |
| `frequency` | TEXT | Constrained to `'weekly'`, `'biweekly'`, `'monthly'`, `'quarterly'` or `'annual'` |
| `start_date` | TEXT | ISO date of the first occurrence |
| `end_date` | TEXT | The last day an occurrence can fall on; NULL = ongoing |
| `color` | TEXT | Hex colour for the card and calendar markers; defaults to `''` |
| `notes` | TEXT | Optional free text; defaults to `''` |
| `active` | INTEGER | `1` = active, `0` = paused (no occurrences, not projected, never posts); defaults to `1` |
| `created_at` | TEXT | UTC, set by SQLite `datetime('now')` on insert |
| `kind` | TEXT | Constrained to `'expense'`, `'income'` or `'transfer'`; defaults to `'expense'` |
| `to_account_id` | INTEGER FK → `accounts.id` | A transfer's destination; NULL for anything else. `ON DELETE SET NULL` |
| `auto_post` | INTEGER | `1` = post each occurrence as a real transaction, `0` = reminder only; defaults to `0` |
| `auto_post_from` | TEXT | ISO date: the first day auto-post may post (the day it was switched on), so earlier occurrences are never back-filled. NULL while auto-post is off |

## `subscription_postings`

The posting log: one row per occurrence of a scheduled item that has been dealt with, either posted (a transaction or transfer was created for it, automatically or by Post now) or skipped. Projections and the Scheduled views leave these dates out.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK → `users.id` | Cascade-deletes when user is removed |
| `subscription_id` | INTEGER FK → `subscriptions.id` | Cascade-deletes with the scheduled item (its transactions are kept) |
| `occurrence_date` | TEXT | ISO date of the occurrence that was handled |
| `status` | TEXT | Constrained to `'posted'` or `'skipped'` |
| `transaction_id` | INTEGER FK → `transactions.id` | The transaction a posted expense or income created. `ON DELETE SET NULL`, so the row outlives a deleted transaction and that date is never posted again |
| `transfer_id` | TEXT | The `transfer_id` shared by a posted transfer's two legs (plain text: a transfer is two rows) |
| `created_at` | TEXT | UTC, set by SQLite `datetime('now')` on insert |

`UNIQUE(subscription_id, occurrence_date)` is what makes posting exactly-once: the poster inserts this row first with `INSERT OR IGNORE` and only creates the transaction if the row went in, inside one SQLite transaction. Indexed on `transaction_id` and `transfer_id`, which is how a transaction's `subscription_id` is looked up.

## `meta`

Key-value infrastructure table. Currently holds a single row: `schema_version` (18 at the time of writing: `SCHEMA_VERSION` in `db.py`).

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT PK | e.g. `'schema_version'` |
| `value` | TEXT | The value for the key |

## Schema migrations

`init()` in `db.py` runs on startup and applies migrations based on an explicit integer `schema_version` stored in the `meta` table.

**Fresh databases** get the current-schema `CREATE TABLE IF NOT EXISTS` statements, then are stamped with the latest `SCHEMA_VERSION`.

**Legacy databases** (pre-v0.25, no `meta` table or no `schema_version` row) go through the original sniff-based migration path — eighteen idempotent steps that check column presence via `PRAGMA table_info` and `sqlite_master`:

1. **`accounts.user_id` (0.2.0)** — added via `ALTER TABLE` if absent.
2. **`accounts.type` widening (0.6.0)** — table recreated with the wider `CHECK(type IN ('current','savings','loan'))` constraint.
3. **`users.theme` + `users.dark_mode`** — the 0.8.0-era colour-theme columns are now **dropped** if present (theming moved entirely client-side); a no-op on the genuine pre-0.8.0 schema.
4. **`accounts.subtype` (0.6.0)** — added via `ALTER TABLE`, defaults to `'general'`.
5. **`accounts.currency` (0.11.0)** — added via `ALTER TABLE`, defaults to `'GBP'`.
6. **`users.base_currency` (0.11.0)** — added via `ALTER TABLE`, defaults to `'GBP'`.
7. **`balance_history.balance REAL` → `balance_cents INTEGER`** — table rebuilt; values converted with `CAST(ROUND(balance * 100) AS INTEGER)`.
8. **`budget_items` dropped** — the retired recurring-cash-flow table (superseded by the envelope budget) is removed with `DROP TABLE IF EXISTS budget_items`.
9. **`transactions.transfer_id`** — added via `ALTER TABLE`; links the two legs of a transfer.
10. **`goals.account_id`** — added via `ALTER TABLE`; links a goal to the account it tracks.
11. **`accounts.counts_to_net_worth`** — added via `ALTER TABLE`, defaults to `1`.
12. **`transactions.import_hash`** — added via `ALTER TABLE`, with its unique-if-not-null index (CSV import dedup).
13. **`accounts.closed`** — added via `ALTER TABLE`, defaults to `0`.
14. **`accounts.institution` + `accounts.institution_name`** — added via `ALTER TABLE`, both NULL on existing rows.
15. **`subscriptions.kind` + `subscriptions.to_account_id`** — added via `ALTER TABLE`; `kind` defaults to `'expense'`, `to_account_id` is NULL.
16. **`subscriptions.auto_post` + `subscriptions.auto_post_from`** — added via `ALTER TABLE`; `auto_post` defaults to `0` (every existing item stays a reminder), `auto_post_from` is NULL.
17. **`accounts.low_balance_threshold_cents`** — added via `ALTER TABLE`, NULL on existing rows.
18. **`transactions.adjustment`** — added via `ALTER TABLE`, defaults to `0`.

After the legacy path completes, the version is stamped. Subsequent runs read the stamp and gate future migrations on `if version < N` — no more column sniffing.

**Versioned migrations** (applied by `schema_version` gate after the legacy path):

- **v1 (0.30.0)** — `accounts.type` constraint widened to include `'credit'` and `'invest'` (table rebuild); `transactions` and `goals` tables created.
- **v6** — the retired `budget_items` table is dropped (superseded by the envelope budget; the old `/api/budget*` endpoints had no frontend caller).
- **v7** — the zero-based envelope budget tables are created: `budget_income`, `budget_group`, `budget_envelope`.
- **v8** — `accounts.counts_to_net_worth` added (the Accessible-net-worth / set-aside flag, [ADR-0003](adr/0003-accessible-net-worth-user-flag.md)), defaulting to `1` so existing accounts keep counting.
- **v9** — the retired `users.theme` / `users.dark_mode` columns are dropped (theming is client-side now; nothing read them server-side).
- **v10** — the `subscriptions` table is created (recurring payments and standing orders).
- **v11** — `transactions.import_hash` added, with a unique-if-not-null index, so a re-uploaded CSV export skips rows already imported.
- **v12** — `accounts.closed` added, defaulting to `0` so existing accounts stay open.
- **v13** — the `api_tokens` table is created (personal access tokens for headless clients).
- **v14** — `accounts.institution` and `accounts.institution_name` added, both NULL on existing rows: the provider can't be inferred from an account's name, so it stays unrecorded until its owner sets it.
- **v15** — `subscriptions.kind` (`'expense'`, `'income'` or `'transfer'`, defaulting to `'expense'` so every existing row stays a payment) and `subscriptions.to_account_id` (a transfer's destination, `ON DELETE SET NULL`) added, so scheduled items can be income or transfers.
- **v16** — scheduled items can post themselves. `subscriptions.auto_post` (default `0`, so nothing starts posting on upgrade) and `subscriptions.auto_post_from` (the first day auto-post may post — the day it was switched on, so the past is never back-filled) added, and the `subscription_postings` log created: one row per handled occurrence (`posted` or `skipped`), unique on `(subscription_id, occurrence_date)` so a date is never posted twice. Its `transaction_id` is `ON DELETE SET NULL`, so deleting an auto-posted transaction doesn't bring it back; deleting the scheduled item deletes its postings but keeps its transactions.
- **v17** — `accounts.low_balance_threshold_cents` (the "Warn me below" amount) added, NULL on existing accounts so they keep warning only below zero.
- **v18** — `transactions.adjustment` added, `0` on existing rows: past manual balance updates can't be told apart from transaction-driven ones, so none are back-filled as Balance adjustments.
