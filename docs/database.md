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
| `type` | TEXT | Constrained to `'current'`, `'savings'`, or `'loan'` |
| `interest_rate` | REAL | Annual rate as a percentage (e.g. `4.5` for 4.5% AER on savings, or APR on loans) |
| `color` | TEXT | Hex colour used in chart lines and card borders |
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

## `budget_items`

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

## Schema migrations

`init()` in `db.py` runs on startup and applies all migrations idempotently — `CREATE TABLE IF NOT EXISTS` for fresh databases plus four additive migrations for existing ones:

1. **`accounts.user_id` (0.2.0)** — added via `ALTER TABLE` if absent. Pre-auth rows get `user_id = NULL` and are invisible to all authenticated users, which is the safe default.
2. **`accounts.type` widening (0.6.0)** — SQLite cannot alter a `CHECK` constraint in place, so the table is recreated with the wider `CHECK(type IN ('current','savings','loan'))` constraint, preserving all rows. Detected by scanning `sqlite_master.sql` for the absence of `'loan'`.
3. **`balance_history.balance REAL` → `balance_cents INTEGER`** — table rebuilt; values converted with `CAST(ROUND(balance * 100) AS INTEGER)`.
4. **`budget_items.amount REAL` → `amount_cents INTEGER`** — same approach as (3).

All migrations are no-ops on a database that is already at the current schema.
