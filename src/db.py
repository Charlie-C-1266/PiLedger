"""SQLite connection, schema init/migrations, and money helpers.

Money is stored as integer cents; helpers convert to/from float dollars at
the API boundary.
"""

from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterator, Optional
import sqlite3

import constants


# Tables that carry per-user data. `GET /api/export` walks this tuple to
# build the JSON dump; `DELETE /api/auth/me` walks it to cascade-clear the
# user's rows before deleting the `users` row. Keeping them in lock-step
# behind one constant means a future per-user table cannot ship without
# also extending the export and the delete cascade — `tests/test_export.py`
# enumerates `sqlite_master` and trips if any user-scoped table is missing
# from this tuple. `users` is not in the list because the user row itself
# is special-cased (excluded from export, deleted last by the cascade);
# `sessions` is auth state rather than user data, so it is cleared on
# delete but not exported.
USER_SCOPED_TABLES: tuple[str, ...] = (
    "accounts",
    "balance_history",
    "exchange_rates",
    "transactions",
    "goals",
    "user_categories",
    "budget_income",
    "budget_group",
    "budget_envelope",
)


def user_scoped_select_sql(table: str) -> str:
    """SQL to read every row of `table` belonging to a given user (one `?` param).

    All tables in `USER_SCOPED_TABLES` carry a `user_id` column except
    `balance_history`, which is reached via its `account_id` → `accounts.user_id`.
    """
    if table == "balance_history":
        return (
            "SELECT * FROM balance_history WHERE account_id IN "
            "(SELECT id FROM accounts WHERE user_id=?)"
        )
    return f"SELECT * FROM {table} WHERE user_id=?"


def user_scoped_delete_sql(table: str) -> str:
    """SQL to delete every row of `table` belonging to a given user (one `?` param)."""
    if table == "balance_history":
        return (
            "DELETE FROM balance_history WHERE account_id IN "
            "(SELECT id FROM accounts WHERE user_id=?)"
        )
    return f"DELETE FROM {table} WHERE user_id=?"


# ─── Money helpers ────────────────────────────────────────────────────────────


def to_cents(dollars: float) -> int:
    """Convert dollars to integer cents, rounding half away from zero.

    Going through ``Decimal(str(dollars))`` rounds the value the user actually
    typed rather than its binary float approximation: ``round(2.675 * 100)``
    yields 267 because 2.675 is stored as 2.67499…, whereas this yields 268.
    ``str()`` gives the shortest round-tripping decimal, so the artefact never
    reaches the arithmetic. Inputs are bounded and finite (schemas reject
    inf/nan), so the conversion can't overflow or raise.
    """
    cents = (Decimal(str(dollars)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)


def from_cents(cents: Optional[int]) -> Optional[float]:
    """Convert integer cents back to dollars, preserving None."""
    return None if cents is None else cents / 100


# ─── Connection ───────────────────────────────────────────────────────────────


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    """Open a SQLite connection that always closes, even on exception.

    Reads ``constants.DB`` at call time so tests can monkeypatch the path.
    """
    conn = sqlite3.connect(constants.DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def utcnow_iso() -> str:
    """Return the current UTC time as a canonical ``ISO_FMT`` string."""
    return datetime.now(timezone.utc).strftime(constants.ISO_FMT)


# ─── Schema version ──────────────────────────────────────────────────────────
# Explicit integer version stored in the `meta` table. Every migration is gated
# by `if version < N` so that future schema changes no longer rely on sniffing
# column presence via PRAGMA table_info. Legacy databases (pre-v0.25) have no
# meta table; the first init() run detects that, applies the old sniff-based
# migrations, and stamps the version.

SCHEMA_VERSION: int = 7


def _get_schema_version(conn: sqlite3.Connection) -> int | None:
    """Read the stamped schema version, or None if not yet stamped."""
    row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
    return int(row[0]) if row else None


def _set_schema_version(conn: sqlite3.Connection, version: int) -> None:
    """Stamp the schema version into the ``meta`` table (insert or replace)."""
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?)",
        (str(version),),
    )


def _run_legacy_migrations(conn: sqlite3.Connection) -> None:
    """Sniff-based migrations for databases created before the schema_version
    stamp existed. Every check is idempotent — on a fresh DB (which already
    has the current-schema CREATE TABLEs) they are all no-ops."""

    # 1. Add user_id to accounts if missing (pre-auth schema).
    acc_cols = {r[1] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()}
    if "user_id" not in acc_cols:
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE"
        )
        conn.commit()

    # 2. Widen the type CHECK constraint to allow 'loan'.
    sql_row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'"
    ).fetchone()
    if sql_row and "'loan'" not in (sql_row[0] or ""):
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript("""
            CREATE TABLE accounts_new (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name          TEXT    NOT NULL,
                type          TEXT    NOT NULL CHECK(type IN ('current','savings','loan')),
                interest_rate REAL    DEFAULT 0,
                color         TEXT    DEFAULT '#6366f1',
                created_at    TEXT    DEFAULT (datetime('now'))
            );
            INSERT INTO accounts_new (id, user_id, name, type, interest_rate, color, created_at)
                SELECT id, user_id, name, type, interest_rate, color, created_at FROM accounts;
            DROP TABLE accounts;
            ALTER TABLE accounts_new RENAME TO accounts;
        """)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.commit()

    # 3. Add users.theme + users.dark_mode.
    user_cols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "theme" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'olive'")
        conn.execute("UPDATE users SET theme='olive' WHERE theme IS NULL")
        conn.commit()
    if "dark_mode" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN dark_mode INTEGER DEFAULT 0")
        conn.execute("UPDATE users SET dark_mode=0 WHERE dark_mode IS NULL")
        conn.commit()

    # 4. Add accounts.subtype.
    acc_cols = {r[1] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()}
    if "subtype" not in acc_cols:
        conn.execute("ALTER TABLE accounts ADD COLUMN subtype TEXT DEFAULT 'general'")
        conn.execute("UPDATE accounts SET subtype='general' WHERE subtype IS NULL")
        conn.commit()

    # 5. Add accounts.currency.
    if "currency" not in acc_cols:
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'GBP'"
        )
        conn.execute(
            "UPDATE accounts SET currency='GBP' WHERE currency IS NULL OR currency=''"
        )
        conn.commit()

    # 6. Add users.base_currency.
    if "base_currency" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN base_currency TEXT DEFAULT 'GBP'")
        conn.execute("UPDATE users SET base_currency='GBP' WHERE base_currency IS NULL")
        conn.commit()

    # 7. balance_history.balance (REAL) → balance_cents (INTEGER).
    bh_cols = {
        r[1] for r in conn.execute("PRAGMA table_info(balance_history)").fetchall()
    }
    if "balance" in bh_cols and "balance_cents" not in bh_cols:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript("""
            CREATE TABLE balance_history_new (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                balance_cents INTEGER NOT NULL,
                notes         TEXT,
                recorded_at   TEXT    DEFAULT (datetime('now'))
            );
            INSERT INTO balance_history_new (id, account_id, balance_cents, notes, recorded_at)
                SELECT id, account_id, CAST(ROUND(balance * 100) AS INTEGER), notes, recorded_at
                FROM balance_history;
            DROP TABLE balance_history;
            ALTER TABLE balance_history_new RENAME TO balance_history;
        """)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.commit()

    # 8. Drop the retired budget_items table (recurring-cash-flow model,
    #    superseded by the envelope budget). Idempotent: no-op if absent.
    conn.execute("DROP TABLE IF EXISTS budget_items")
    conn.commit()

    # 9. Add transactions.transfer_id (links the two legs of a transfer).
    _ensure_transfer_id_column(conn)

    # 10. Add goals.account_id (links a goal to an account it tracks).
    _ensure_goal_account_id_column(conn)


def _ensure_transfer_id_column(conn: sqlite3.Connection) -> None:
    """Idempotently add transactions.transfer_id. The two transactions making
    up an account-to-account transfer share a transfer_id so they can be
    deleted together; a plain transaction leaves it NULL."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(transactions)").fetchall()}
    if "transfer_id" not in cols:
        conn.execute("ALTER TABLE transactions ADD COLUMN transfer_id TEXT")
        conn.commit()


def _ensure_goal_account_id_column(conn: sqlite3.Connection) -> None:
    """Idempotently add goals.account_id. A linked goal tracks that account's
    balance; ON DELETE SET NULL unlinks (rather than deletes) the goal when the
    account is removed. NULL means an unlinked, manually-tracked goal."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(goals)").fetchall()}
    if "account_id" not in cols:
        conn.execute(
            "ALTER TABLE goals ADD COLUMN account_id INTEGER"
            " REFERENCES accounts(id) ON DELETE SET NULL"
        )
        conn.commit()


def _migrate_to_2(conn: sqlite3.Connection) -> None:
    """Add credit/invest account types, transactions table, goals table."""
    sql_row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'"
    ).fetchone()
    if sql_row and "'credit'" not in (sql_row[0] or ""):
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript("""
            CREATE TABLE accounts_new (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name          TEXT    NOT NULL,
                type          TEXT    NOT NULL CHECK(type IN ('current','savings','loan','credit','invest')),
                subtype       TEXT    DEFAULT 'general',
                currency      TEXT    NOT NULL DEFAULT 'GBP',
                interest_rate REAL    DEFAULT 0,
                color         TEXT    DEFAULT '#6366f1',
                created_at    TEXT    DEFAULT (datetime('now'))
            );
            INSERT INTO accounts_new SELECT * FROM accounts;
            DROP TABLE accounts;
            ALTER TABLE accounts_new RENAME TO accounts;
        """)
        conn.execute("PRAGMA foreign_keys = ON")

    conn.execute(
        "UPDATE accounts SET type='credit' WHERE type='loan' AND subtype='credit_card'"
    )

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS transactions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            amount_cents INTEGER NOT NULL,
            occurred_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            merchant     TEXT    NOT NULL,
            category     TEXT    NOT NULL DEFAULT '',
            note         TEXT    DEFAULT '',
            created_at   TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS goals (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name          TEXT    NOT NULL,
            target_cents  INTEGER NOT NULL,
            saved_cents   INTEGER NOT NULL DEFAULT 0,
            monthly_cents INTEGER NOT NULL DEFAULT 0,
            color         TEXT    DEFAULT '#0F766E',
            created_at    TEXT    DEFAULT (datetime('now'))
        );
    """)
    conn.commit()


def _migrate_to_3(conn: sqlite3.Connection) -> None:
    """Add user_categories table for per-user custom transaction categories."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS user_categories (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name       TEXT    NOT NULL,
            created_at TEXT    DEFAULT (datetime('now')),
            UNIQUE(user_id, name)
        );
    """)
    _set_schema_version(conn, 3)
    conn.commit()


def _migrate_to_4(conn: sqlite3.Connection) -> None:
    """Add transactions.transfer_id for linked account-to-account transfers."""
    _ensure_transfer_id_column(conn)
    _set_schema_version(conn, 4)
    conn.commit()


def _migrate_to_5(conn: sqlite3.Connection) -> None:
    """Add goals.account_id so a goal can track a linked account's balance."""
    _ensure_goal_account_id_column(conn)
    _set_schema_version(conn, 5)
    conn.commit()


def _migrate_to_6(conn: sqlite3.Connection) -> None:
    """Drop the retired budget_items table. Its recurring-cash-flow model and
    orphaned /api/budget* endpoints are superseded by the envelope budget, which
    reclaims the /api/budget namespace."""
    conn.execute("DROP TABLE IF EXISTS budget_items")
    _set_schema_version(conn, 6)
    conn.commit()


# Zero-based envelope budget tables. Defined once and shared between init() (fresh
# installs) and _migrate_to_7 (existing DBs) so the two paths can't drift apart.
# Money is integer cents; budgeted/income amounts are stored monthly. Each
# envelope tracks exactly one PiLedger category — UNIQUE(user_id, category) keeps
# a category from being double-counted across envelopes.
_BUDGET_TABLES_DDL = """
    CREATE TABLE IF NOT EXISTS budget_income (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label        TEXT    NOT NULL,
        amount_cents INTEGER NOT NULL DEFAULT 0,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT    DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS budget_group (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        color      TEXT    NOT NULL DEFAULT '#0F766E',
        flexible   INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS budget_envelope (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        group_id       INTEGER NOT NULL REFERENCES budget_group(id) ON DELETE CASCADE,
        label          TEXT    NOT NULL,
        category       TEXT    NOT NULL,
        budgeted_cents INTEGER NOT NULL DEFAULT 0,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT    DEFAULT (datetime('now')),
        UNIQUE(user_id, category)
    );
"""


def _migrate_to_7(conn: sqlite3.Connection) -> None:
    """Add the zero-based envelope budget tables (income / group / envelope)."""
    conn.executescript(_BUDGET_TABLES_DDL)
    _set_schema_version(conn, 7)
    conn.commit()


# ─── Schema init + migrations ─────────────────────────────────────────────────


def init() -> None:
    """Create tables on first run; apply additive migrations on subsequent runs."""
    with db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                theme         TEXT DEFAULT 'olive',
                dark_mode     INTEGER DEFAULT 0,
                base_currency TEXT DEFAULT 'GBP',
                created_at    TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS accounts (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name          TEXT    NOT NULL,
                type          TEXT    NOT NULL CHECK(type IN ('current','savings','loan','credit','invest')),
                subtype       TEXT    DEFAULT 'general',
                currency      TEXT    NOT NULL DEFAULT 'GBP',
                interest_rate REAL    DEFAULT 0,
                color         TEXT    DEFAULT '#6366f1',
                created_at    TEXT    DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS exchange_rates (
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                currency   TEXT    NOT NULL,
                rate       REAL    NOT NULL,
                updated_at TEXT    DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, currency)
            );
            CREATE TABLE IF NOT EXISTS balance_history (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                balance_cents INTEGER NOT NULL,
                notes         TEXT,
                recorded_at   TEXT    DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                amount_cents INTEGER NOT NULL,
                occurred_at  TEXT    NOT NULL DEFAULT (datetime('now')),
                merchant     TEXT    NOT NULL,
                category     TEXT    NOT NULL DEFAULT '',
                note         TEXT    DEFAULT '',
                transfer_id  TEXT,
                created_at   TEXT    DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS goals (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name          TEXT    NOT NULL,
                target_cents  INTEGER NOT NULL,
                saved_cents   INTEGER NOT NULL DEFAULT 0,
                monthly_cents INTEGER NOT NULL DEFAULT 0,
                color         TEXT    DEFAULT '#0F766E',
                account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
                created_at    TEXT    DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS user_categories (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name       TEXT    NOT NULL,
                created_at TEXT    DEFAULT (datetime('now')),
                UNIQUE(user_id, name)
            );
        """)
        conn.executescript(_BUDGET_TABLES_DDL)
        conn.commit()

        version = _get_schema_version(conn)

        if version is None:
            # Legacy DB (pre-v0.25) or fresh install. The sniff-based
            # migrations are idempotent — on a fresh DB they're all no-ops.
            _run_legacy_migrations(conn)
            _set_schema_version(conn, SCHEMA_VERSION)
            conn.commit()
            return

        # ── Version-gated migrations ─────────────────────────────────

        if version < 2:
            _migrate_to_2(conn)
            version = 2

        if version < 3:
            _migrate_to_3(conn)
            version = 3

        if version < 4:
            _migrate_to_4(conn)
            version = 4

        if version < 5:
            _migrate_to_5(conn)
            version = 5

        if version < 6:
            _migrate_to_6(conn)
            version = 6

        if version < 7:
            _migrate_to_7(conn)
            version = 7

        if version < SCHEMA_VERSION:
            _set_schema_version(conn, SCHEMA_VERSION)
            conn.commit()
