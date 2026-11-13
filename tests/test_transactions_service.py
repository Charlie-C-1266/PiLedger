"""services/transactions: every transactions row goes in through one helper,
and each public writer pairs it with the right balance effect."""

import sqlite3
from pathlib import Path

import pytest

from db import db
from services.accounts import latest_balance_cents
from services.transactions import insert_transaction, insert_transfer

SRC = Path(__file__).resolve().parent.parent / "src"


def _account(client, name: str = "Main") -> int:
    aid = client.post("/api/accounts", json={"name": name, "type": "current"}).json()[
        "id"
    ]
    client.post(f"/api/accounts/{aid}/balance", json={"balance": 100.0})
    return aid


def _uid(client) -> int:
    return client.get("/api/auth/me").json()["id"]


def test_only_the_transactions_service_inserts_transactions():
    """A second INSERT is how CSV import once bypassed the balance pairing;
    every writer goes through services/transactions instead."""
    writers = sorted(
        str(p.relative_to(SRC))
        for p in SRC.rglob("*.py")
        if "INSERT INTO transactions" in p.read_text()
    )
    assert writers == ["services/transactions.py"]


def test_an_imported_row_keeps_its_hash_and_moves_the_balance(alice):
    aid = _account(alice)
    with db() as conn:
        tid = insert_transaction(
            conn,
            _uid(alice),
            aid,
            -2500,
            "2026-11-01T00:00:00Z",
            "Tesco",
            "",
            "",
            import_hash="abc",
        )
        conn.commit()
        row = conn.execute(
            "SELECT import_hash, adjustment, transfer_id FROM transactions WHERE id=?",
            (tid,),
        ).fetchone()
        assert tuple(row) == ("abc", 0, None)
        assert latest_balance_cents(conn, aid) == 7500


def test_a_repeated_import_hash_is_refused_before_the_balance_moves(alice):
    aid = _account(alice)
    uid = _uid(alice)
    args = (aid, -2500, "2026-11-01T00:00:00Z", "Tesco", "", "")
    with db() as conn:
        insert_transaction(conn, uid, *args, import_hash="abc")
        with pytest.raises(sqlite3.IntegrityError):
            insert_transaction(conn, uid, *args, import_hash="abc")
        assert latest_balance_cents(conn, aid) == 7500


def test_a_transfer_writes_two_linked_legs_and_moves_both(alice):
    src, dst = _account(alice, "From"), _account(alice, "To")
    with db() as conn:
        transfer_id, ids = insert_transfer(
            conn,
            _uid(alice),
            src,
            dst,
            4000,
            "2026-11-01T00:00:00Z",
            "",
            ("Out", "In"),
        )
        legs = conn.execute(
            "SELECT account_id, amount_cents, merchant, transfer_id FROM transactions"
            " WHERE id IN (?, ?) ORDER BY id",
            ids,
        ).fetchall()
        assert [tuple(r) for r in legs] == [
            (src, -4000, "Out", transfer_id),
            (dst, 4000, "In", transfer_id),
        ]
        assert latest_balance_cents(conn, src) == 6000
        assert latest_balance_cents(conn, dst) == 14000
