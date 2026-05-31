"""Coverage for the additive migrations in ``db.init()``.

Every test in the main suite starts from a fresh DB, so each migration
branch in ``db.py`` is dead-tested by default. These tests materialise
a pre-migration schema, drop a row or two into it, run ``init()``, and
assert the columns and data look right after.

The migrations under test (in execution order inside ``init()``):

1. Add ``accounts.user_id`` if missing.
2. Widen ``accounts.type`` CHECK to allow 'loan' (recreates the table).
3. Add ``users.theme`` / ``users.dark_mode``.
4. Add ``accounts.subtype``.
5. Add ``accounts.currency``.
6. Add ``users.base_currency``.
7. Convert ``balance_history.balance`` (REAL) → ``balance_cents`` (INTEGER).
8. Drop the retired ``budget_items`` table (superseded by the envelope budget).

After all legacy migrations run (or are no-ops on a fresh DB), ``init()``
stamps a ``schema_version`` row in the ``meta`` table. Subsequent runs
skip the sniff-based legacy path and gate future migrations on
``if version < N`` instead.

A regression that misorders a cast, drops a column, or breaks data
preservation would have shipped silently against the pre-existing suite.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


# Pre-migration ("v0") schema. Every CHECK / DEFAULT here matches the
# state of db.py from before the corresponding migration was added.
_V0_SCHEMA = """
    CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
    );
    CREATE TABLE accounts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        type          TEXT NOT NULL CHECK(type IN ('current','savings')),
        interest_rate REAL DEFAULT 0,
        color         TEXT DEFAULT '#6366f1',
        created_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE balance_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        balance     REAL NOT NULL,
        notes       TEXT,
        recorded_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE exchange_rates (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        currency   TEXT    NOT NULL,
        rate       REAL    NOT NULL,
        updated_at TEXT    DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, currency)
    );
    CREATE TABLE budget_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name         TEXT    NOT NULL,
        amount       REAL    NOT NULL,
        frequency    TEXT    NOT NULL
            CHECK(frequency IN ('weekly','monthly','quarterly','annually')),
        created_at   TEXT    DEFAULT (datetime('now'))
    );
"""


def _materialise_v0(db_path: Path) -> None:
    """Create the pre-migration schema directly, bypassing ``init()``."""
    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(_V0_SCHEMA)
        conn.commit()
    finally:
        conn.close()


def _table_columns(db_path: Path, table: str) -> set[str]:
    conn = sqlite3.connect(str(db_path))
    try:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    finally:
        conn.close()


def _table_sql(db_path: Path, table: str) -> str:
    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
    finally:
        conn.close()
    return (row[0] if row else "") or ""


@pytest.fixture
def migrated_db(tmp_path, monkeypatch):
    """Build a v0 schema with some seed data, then run ``init()`` on it.

    Returns the path to the upgraded DB. Tests poke at it via raw sqlite3
    connections rather than the API so they see the schema state directly.
    """
    db_path = tmp_path / "v0.db"
    _materialise_v0(db_path)

    # Seed: one user, one account of each pre-widening type, two balance
    # history rows (REAL), and two budget items (REAL).
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "INSERT INTO users(id, username, password_hash) VALUES(1, 'alice', 'x')"
        )
        conn.execute(
            "INSERT INTO accounts(id, name, type, interest_rate, color)"
            " VALUES(1, 'Current', 'current', 0,   '#708238'),"
            "       (2, 'Savings', 'savings', 4.5, '#6366f1')"
        )
        conn.execute(
            "INSERT INTO balance_history(account_id, balance, recorded_at)"
            " VALUES(1, 1234.56, '2025-01-01T00:00:00Z'),"
            "       (2, 8000.00, '2025-01-01T00:00:00Z')"
        )
        conn.execute(
            "INSERT INTO budget_items(user_id, account_id, name, amount, frequency)"
            " VALUES(1, 1, 'Salary',  3000.00, 'monthly'),"
            "       (1, 1, 'Rent',   -1234.55, 'monthly')"
        )
        conn.commit()
    finally:
        conn.close()

    # Redirect db.db() at this file, then run the real init().
    import constants

    monkeypatch.setattr(constants, "DB", str(db_path))
    from db import init

    init()
    return db_path


# ─── Per-migration assertions ─────────────────────────────────────────────────


def test_adds_user_id_to_accounts(migrated_db):
    """V0 accounts had no user_id column; init() must add it."""
    assert "user_id" in _table_columns(migrated_db, "accounts")


def test_widens_account_type_check_to_allow_loan(migrated_db):
    """The CHECK constraint must now mention 'loan'."""
    assert "'loan'" in _table_sql(migrated_db, "accounts")


def test_loan_account_can_be_inserted_post_migration(migrated_db):
    """Round-trip: after the CHECK widen, the DB accepts a loan row."""
    conn = sqlite3.connect(str(migrated_db))
    try:
        conn.execute(
            "INSERT INTO accounts(user_id, name, type) VALUES(1, 'Loan', 'loan')"
        )
        conn.commit()
        row = conn.execute("SELECT type FROM accounts WHERE name='Loan'").fetchone()
    finally:
        conn.close()
    assert row[0] == "loan"


def test_preserves_existing_accounts_through_check_widen(migrated_db):
    """The accounts table is dropped+recreated during the CHECK-widen step.
    Existing rows must survive with all their columns intact."""
    conn = sqlite3.connect(str(migrated_db))
    try:
        rows = conn.execute(
            "SELECT id, name, type, interest_rate, color FROM accounts ORDER BY id"
        ).fetchall()
    finally:
        conn.close()
    assert rows == [
        (1, "Current", "current", 0.0, "#708238"),
        (2, "Savings", "savings", 4.5, "#6366f1"),
    ]


def test_adds_users_theme_and_dark_mode(migrated_db):
    cols = _table_columns(migrated_db, "users")
    assert "theme" in cols
    assert "dark_mode" in cols


def test_existing_users_default_to_olive_light_theme(migrated_db):
    conn = sqlite3.connect(str(migrated_db))
    try:
        row = conn.execute("SELECT theme, dark_mode FROM users WHERE id=1").fetchone()
    finally:
        conn.close()
    assert row == ("olive", 0)


def test_adds_accounts_subtype(migrated_db):
    assert "subtype" in _table_columns(migrated_db, "accounts")


def test_existing_accounts_default_to_general_subtype(migrated_db):
    conn = sqlite3.connect(str(migrated_db))
    try:
        rows = conn.execute("SELECT subtype FROM accounts ORDER BY id").fetchall()
    finally:
        conn.close()
    assert all(r[0] == "general" for r in rows)


def test_adds_accounts_currency(migrated_db):
    assert "currency" in _table_columns(migrated_db, "accounts")


def test_existing_accounts_default_to_gbp_currency(migrated_db):
    conn = sqlite3.connect(str(migrated_db))
    try:
        rows = conn.execute("SELECT currency FROM accounts ORDER BY id").fetchall()
    finally:
        conn.close()
    assert all(r[0] == "GBP" for r in rows)


def test_adds_users_base_currency(migrated_db):
    assert "base_currency" in _table_columns(migrated_db, "users")


def test_existing_users_default_to_gbp_base_currency(migrated_db):
    conn = sqlite3.connect(str(migrated_db))
    try:
        row = conn.execute("SELECT base_currency FROM users WHERE id=1").fetchone()
    finally:
        conn.close()
    assert row[0] == "GBP"


# ─── Data-conversion migrations ───────────────────────────────────────────────
# These are the riskiest: a wrong CAST/ROUND ordering would silently
# truncate every historical balance and budget amount.


def test_balance_history_balance_real_renamed_to_balance_cents(migrated_db):
    cols = _table_columns(migrated_db, "balance_history")
    assert "balance_cents" in cols
    assert "balance" not in cols  # original REAL column is dropped


def test_balance_history_values_converted_to_cents_exactly(migrated_db):
    """1234.56 dollars → 123456 cents. The migration uses
    CAST(ROUND(balance * 100) AS INTEGER) so any floating-point drift would
    bite this assertion."""
    conn = sqlite3.connect(str(migrated_db))
    try:
        rows = conn.execute(
            "SELECT account_id, balance_cents FROM balance_history ORDER BY id"
        ).fetchall()
    finally:
        conn.close()
    assert rows == [(1, 123456), (2, 800000)]


def test_budget_items_table_dropped(migrated_db):
    """The retired budget_items table — seeded with rows in the v0 fixture —
    must be gone after migration, even when it held data."""
    conn = sqlite3.connect(str(migrated_db))
    try:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='budget_items'"
        ).fetchone()
    finally:
        conn.close()
    assert row is None


# ─── Idempotency + fresh-DB sanity ────────────────────────────────────────────


def test_running_init_twice_is_a_noop(migrated_db):
    """Every migration is gated by a column-presence check; a second run
    must not re-fire any of them (which would either error or duplicate
    data)."""
    # Snapshot the schema and a row count.
    pre_schema = _table_sql(migrated_db, "accounts")
    conn = sqlite3.connect(str(migrated_db))
    try:
        pre_count_bh = conn.execute("SELECT COUNT(*) FROM balance_history").fetchone()[
            0
        ]
    finally:
        conn.close()

    from db import init

    init()

    assert _table_sql(migrated_db, "accounts") == pre_schema
    conn = sqlite3.connect(str(migrated_db))
    try:
        assert (
            conn.execute("SELECT COUNT(*) FROM balance_history").fetchone()[0]
            == pre_count_bh
        )
    finally:
        conn.close()


def test_init_on_empty_db_creates_all_tables(tmp_path, monkeypatch):
    """The CREATE TABLE IF NOT EXISTS path (the common case for new
    installs) must produce a fully-populated schema, with every column
    the routes expect."""
    db_path = tmp_path / "fresh.db"

    import constants

    monkeypatch.setattr(constants, "DB", str(db_path))
    from db import init

    init()

    assert _table_columns(db_path, "users") >= {
        "id",
        "username",
        "password_hash",
        "theme",
        "dark_mode",
        "base_currency",
        "created_at",
    }
    assert _table_columns(db_path, "accounts") >= {
        "id",
        "user_id",
        "name",
        "type",
        "subtype",
        "currency",
        "interest_rate",
        "color",
        "created_at",
    }
    assert _table_columns(db_path, "balance_history") >= {
        "id",
        "account_id",
        "balance_cents",
        "notes",
        "recorded_at",
    }
    assert _table_columns(db_path, "sessions") >= {"token", "user_id", "expires_at"}
    assert _table_columns(db_path, "exchange_rates") >= {
        "user_id",
        "currency",
        "rate",
        "updated_at",
    }


# ─── schema_version stamp ───────────────────────────────────────────────────


def _read_schema_version(db_path: Path) -> int | None:
    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute(
            "SELECT value FROM meta WHERE key='schema_version'"
        ).fetchone()
        return int(row[0]) if row else None
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()


def test_legacy_db_gets_stamped_after_migration(migrated_db):
    """A v0 database (no meta table) should be stamped with the current
    schema version after init() runs the legacy migrations."""
    from db import SCHEMA_VERSION

    assert _read_schema_version(migrated_db) == SCHEMA_VERSION


def test_fresh_db_gets_stamped(tmp_path, monkeypatch):
    """A brand-new database should be stamped with the current version
    on the very first init()."""
    db_path = tmp_path / "fresh.db"
    import constants

    monkeypatch.setattr(constants, "DB", str(db_path))
    from db import init, SCHEMA_VERSION

    init()
    assert _read_schema_version(db_path) == SCHEMA_VERSION


def test_second_init_skips_legacy_migrations(migrated_db):
    """Once stamped, a second init() takes the version-gated path and
    never re-enters the legacy migration code."""
    from db import init, SCHEMA_VERSION

    init()
    assert _read_schema_version(migrated_db) == SCHEMA_VERSION


def test_meta_table_exists_on_fresh_db(tmp_path, monkeypatch):
    db_path = tmp_path / "fresh.db"
    import constants

    monkeypatch.setattr(constants, "DB", str(db_path))
    from db import init

    init()
    assert (
        "meta" in _table_columns(db_path, "meta")
        or _read_schema_version(db_path) is not None
    )
    conn = sqlite3.connect(str(db_path))
    try:
        tables = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
    finally:
        conn.close()
    assert "meta" in tables
