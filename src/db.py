"""SQLite connection, schema init/migrations, and money helpers.

Money is stored as integer cents; helpers convert to/from float dollars at
the API boundary.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional
import sqlite3

import constants


# ─── Money helpers ────────────────────────────────────────────────────────────

def to_cents(dollars: float) -> int:
    """Convert dollars to integer cents (banker-rounding via round())."""
    return int(round(dollars * 100))


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
    return datetime.now(timezone.utc).strftime(constants.ISO_FMT)


# ─── Schema init + migrations ─────────────────────────────────────────────────

def init() -> None:
    """Create tables on first run; apply additive migrations on subsequent runs."""
    with db() as conn:
        conn.executescript("""
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
                type          TEXT    NOT NULL CHECK(type IN ('current','savings','loan')),
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
            CREATE TABLE IF NOT EXISTS budget_items (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                name         TEXT    NOT NULL,
                amount_cents INTEGER NOT NULL,
                frequency    TEXT    NOT NULL
                    CHECK(frequency IN ('weekly','monthly','quarterly','annually')),
                created_at   TEXT    DEFAULT (datetime('now'))
            );
        """)
        conn.commit()

        # Migrate: add user_id to accounts if missing (pre-auth schema).
        acc_cols = {r[1] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()}
        if "user_id" not in acc_cols:
            conn.execute(
                "ALTER TABLE accounts ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE"
            )
            conn.commit()

        # Migrate: widen the type CHECK constraint to allow 'loan'.
        # SQLite can't alter a CHECK constraint in place, so we recreate the table.
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

        # Migrate: add users.theme + users.dark_mode for pre-prefs schemas.
        user_cols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "theme" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'olive'")
            conn.execute("UPDATE users SET theme='olive' WHERE theme IS NULL")
            conn.commit()
        if "dark_mode" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN dark_mode INTEGER DEFAULT 0")
            conn.execute("UPDATE users SET dark_mode=0 WHERE dark_mode IS NULL")
            conn.commit()

        # Migrate: add accounts.subtype column for pre-subtype schemas.
        # Existing rows default to 'general' so behaviour is unchanged.
        acc_cols = {r[1] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()}
        if "subtype" not in acc_cols:
            conn.execute(
                "ALTER TABLE accounts ADD COLUMN subtype TEXT DEFAULT 'general'"
            )
            conn.execute("UPDATE accounts SET subtype='general' WHERE subtype IS NULL")
            conn.commit()

        # Migrate: add accounts.currency for pre-multi-currency schemas. Existing
        # rows default to 'GBP', preserving the previous single-currency assumption.
        if "currency" not in acc_cols:
            conn.execute(
                "ALTER TABLE accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'GBP'"
            )
            conn.execute("UPDATE accounts SET currency='GBP' WHERE currency IS NULL OR currency=''")
            conn.commit()

        # Migrate: add users.base_currency for pre-multi-currency schemas.
        if "base_currency" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN base_currency TEXT DEFAULT 'GBP'")
            conn.execute("UPDATE users SET base_currency='GBP' WHERE base_currency IS NULL")
            conn.commit()

        # Migrate: balance_history.balance (REAL) → balance_cents (INTEGER).
        bh_cols = {r[1] for r in conn.execute("PRAGMA table_info(balance_history)").fetchall()}
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

        # Migrate: budget_items.amount (REAL) → amount_cents (INTEGER).
        bi_cols = {r[1] for r in conn.execute("PRAGMA table_info(budget_items)").fetchall()}
        if "amount" in bi_cols and "amount_cents" not in bi_cols:
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.executescript("""
                CREATE TABLE budget_items_new (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    name         TEXT    NOT NULL,
                    amount_cents INTEGER NOT NULL,
                    frequency    TEXT    NOT NULL
                        CHECK(frequency IN ('weekly','monthly','quarterly','annually')),
                    created_at   TEXT    DEFAULT (datetime('now'))
                );
                INSERT INTO budget_items_new (id, user_id, account_id, name, amount_cents, frequency, created_at)
                    SELECT id, user_id, account_id, name, CAST(ROUND(amount * 100) AS INTEGER), frequency, created_at
                    FROM budget_items;
                DROP TABLE budget_items;
                ALTER TABLE budget_items_new RENAME TO budget_items;
            """)
            conn.execute("PRAGMA foreign_keys = ON")
            conn.commit()
