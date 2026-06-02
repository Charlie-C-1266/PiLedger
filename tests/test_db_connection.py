"""Connection-level PRAGMAs applied by ``db.db()``.

Every request opens a fresh connection, so these must be set on each open:
foreign-key enforcement (cascades), a busy timeout (wait on a lock instead of
erroring), and WAL journaling (readers don't block the writer). The ``app``
fixture points ``constants.DB`` at a file-based temp DB, which WAL requires.
"""

import constants
from db import db


def test_foreign_keys_enabled(app):
    with db() as conn:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_busy_timeout_matches_constant(app):
    with db() as conn:
        timeout = conn.execute("PRAGMA busy_timeout").fetchone()[0]
    assert timeout == constants.DB_BUSY_TIMEOUT_MS


def test_journal_mode_is_wal(app):
    with db() as conn:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode.lower() == "wal"
