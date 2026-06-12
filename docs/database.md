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
| `currency` | TEXT | ISO-4217 currency code; defaults to `'GBP'` |
| `interest_rate` | REAL | Annual rate as a percentage (e.g. `4.5` for 4.5% AER on savings, or APR on loans) |
| `color` | TEXT | Hex colour used in chart lines and card borders |
| `counts_to_net_worth` | INTEGER | `1` = counts toward the Accessible net-worth headline, `0` = set aside (e.g. a pension or SIPP); defaults to `1`. See [ADR-0003](adr/0003-accessible-net-worth-user-flag.md) |
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
| `created_at` | TEXT | UTC ISO-8601, set by SQLite `datetime('now')` on insert |

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

## `meta`

Key-value infrastructure table. Currently holds a single row: `schema_version`.

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT PK | e.g. `'schema_version'` |
| `value` | TEXT | The value for the key |

## Schema migrations

`init()` in `db.py` runs on startup and applies migrations based on an explicit integer `schema_version` stored in the `meta` table.

**Fresh databases** get the current-schema `CREATE TABLE IF NOT EXISTS` statements, then are stamped with the latest `SCHEMA_VERSION`.

**Legacy databases** (pre-v0.25, no `meta` table or no `schema_version` row) go through the original sniff-based migration path — eight idempotent steps that check column presence via `PRAGMA table_info` and `sqlite_master`:

1. **`accounts.user_id` (0.2.0)** — added via `ALTER TABLE` if absent.
2. **`accounts.type` widening (0.6.0)** — table recreated with the wider `CHECK(type IN ('current','savings','loan'))` constraint.
3. **`users.theme` + `users.dark_mode` (0.8.0)** — added via `ALTER TABLE`.
4. **`accounts.subtype` (0.6.0)** — added via `ALTER TABLE`, defaults to `'general'`.
5. **`accounts.currency` (0.11.0)** — added via `ALTER TABLE`, defaults to `'GBP'`.
6. **`users.base_currency` (0.11.0)** — added via `ALTER TABLE`, defaults to `'GBP'`.
7. **`balance_history.balance REAL` → `balance_cents INTEGER`** — table rebuilt; values converted with `CAST(ROUND(balance * 100) AS INTEGER)`.
8. **`budget_items` dropped** — the retired recurring-cash-flow table (superseded by the envelope budget) is removed with `DROP TABLE IF EXISTS budget_items`.

After the legacy path completes, the version is stamped. Subsequent runs read the stamp and gate future migrations on `if version < N` — no more column sniffing.

**Versioned migrations** (applied by `schema_version` gate after the legacy path):

- **v1 (0.30.0)** — `accounts.type` constraint widened to include `'credit'` and `'invest'` (table rebuild); `transactions` and `goals` tables created.
- **v6** — the retired `budget_items` table is dropped (superseded by the envelope budget; the old `/api/budget*` endpoints had no frontend caller).
- **v7** — the zero-based envelope budget tables are created: `budget_income`, `budget_group`, `budget_envelope`.
- **v8** — `accounts.counts_to_net_worth` added (the Accessible-net-worth / set-aside flag, [ADR-0003](adr/0003-accessible-net-worth-user-flag.md)), defaulting to `1` so existing accounts keep counting.
