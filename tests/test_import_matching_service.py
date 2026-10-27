"""Unit tests for ``services/import_matching`` — pairing CSV import rows with
transactions a schedule already posted. The pure matcher is tested on plain
values; the candidate rules run against a fresh database with postings made by
the real poster (no HTTP).
"""

from datetime import date

import pytest

from db import db
from services.import_matching import (
    MATCH_WINDOW_DAYS,
    ImportRow,
    ScheduledTxn,
    claim_transaction,
    find_matches,
    match_rows,
)
from services.posting import post_occurrence
from services.transactions import insert_transaction

NOV_12 = date(2026, 11, 12)


def _row(row, day, amount_cents=-999, import_hash=None):
    return ImportRow(
        row=row,
        day=day,
        amount_cents=amount_cents,
        import_hash=import_hash or f"h{row}",
    )


def _cand(tid, day, amount_cents=-999, name="Netflix", transfer_id=None):
    return ScheduledTxn(
        transaction_id=tid,
        day=day,
        amount_cents=amount_cents,
        name=name,
        transfer_id=transfer_id,
    )


def _ids(matches):
    return {row: c.transaction_id for row, c in matches.items()}


# ── Pure: match_rows ─────────────────────────────────────────────────────────


def test_window_is_three_days():
    assert MATCH_WINDOW_DAYS == 3


@pytest.mark.parametrize("offset", [-3, -1, 0, 1, 3])
def test_matches_inside_the_window_edges(offset):
    row_day = date.fromordinal(NOV_12.toordinal() + offset)
    assert _ids(match_rows([_row(1, row_day)], [_cand(10, NOV_12)])) == {1: 10}


@pytest.mark.parametrize("offset", [-4, 4, 30])
def test_no_match_outside_the_window(offset):
    row_day = date.fromordinal(NOV_12.toordinal() + offset)
    assert match_rows([_row(1, row_day)], [_cand(10, NOV_12)]) == {}


@pytest.mark.parametrize(
    "row_cents",
    [
        -1000,  # a penny off (a variable bill)
        -998,
        999,  # same size, opposite sign
    ],
)
def test_amount_must_be_exactly_the_same_signed_amount(row_cents):
    assert match_rows([_row(1, NOV_12, row_cents)], [_cand(10, NOV_12, -999)]) == {}


def test_income_matches_on_its_positive_amount():
    rows = [_row(1, NOV_12, 250000)]
    assert _ids(match_rows(rows, [_cand(10, NOV_12, 250000)])) == {1: 10}


def test_one_transaction_goes_to_the_nearest_row():
    rows = [_row(1, date(2026, 11, 14)), _row(2, date(2026, 11, 13))]
    assert _ids(match_rows(rows, [_cand(10, NOV_12)])) == {2: 10}


def test_one_row_takes_the_nearest_transaction():
    cands = [_cand(10, date(2026, 11, 9)), _cand(11, date(2026, 11, 11))]
    assert _ids(match_rows([_row(1, NOV_12)], cands)) == {1: 11}


def test_equal_distance_goes_to_the_earlier_transaction():
    # Ids run against the dates so the tie is broken by date, not by id.
    cands = [_cand(10, date(2026, 11, 14)), _cand(11, date(2026, 11, 10))]
    assert _ids(match_rows([_row(1, NOV_12)], cands)) == {1: 11}


def test_matching_is_one_to_one():
    # Two identical bank rows, one posted transaction: only one row claims it.
    rows = [_row(1, NOV_12), _row(2, NOV_12)]
    assert _ids(match_rows(rows, [_cand(10, NOV_12)])) == {1: 10}

    # Two rows, two transactions: each gets its own.
    cands = [_cand(10, date(2026, 11, 5)), _cand(11, NOV_12)]
    rows = [_row(1, date(2026, 11, 6)), _row(2, date(2026, 11, 13))]
    assert _ids(match_rows(rows, cands)) == {1: 10, 2: 11}


def test_closest_pair_is_settled_first():
    # Row 2 is 1 day from T11; row 1 is 2 days from both. Row 2 takes T11
    # first, so row 1 falls back to T10 instead of stealing T11.
    cands = [_cand(10, date(2026, 11, 10)), _cand(11, date(2026, 11, 14))]
    rows = [_row(1, NOV_12), _row(2, date(2026, 11, 15))]
    assert _ids(match_rows(rows, cands)) == {1: 10, 2: 11}


def test_result_does_not_depend_on_input_order():
    cands = [_cand(10, date(2026, 11, 10)), _cand(11, date(2026, 11, 14))]
    rows = [_row(1, NOV_12), _row(2, date(2026, 11, 15))]
    assert match_rows(rows[::-1], cands[::-1]) == match_rows(rows, cands)


def test_nothing_to_match():
    assert match_rows([], [_cand(10, NOV_12)]) == {}
    assert match_rows([_row(1, NOV_12)], []) == {}


# ── DB fixtures ──────────────────────────────────────────────────────────────


@pytest.fixture
def conn(app):
    with db() as c:
        yield c


def _user(conn, name="alice"):
    uid = conn.execute(
        "INSERT INTO users(username, password_hash) VALUES(?, 'x')", (name,)
    ).lastrowid
    conn.commit()
    return uid


def _account(conn, uid, name="Current"):
    aid = conn.execute(
        "INSERT INTO accounts(user_id, name, type, currency) VALUES(?,?,'current','GBP')",
        (uid, name),
    ).lastrowid
    conn.commit()
    return aid


def _sub(conn, uid, account_id, **kw):
    fields = {
        "name": "Netflix",
        "amount_cents": 999,
        "category": "Entertainment",
        "kind": "expense",
        "account_id": account_id,
        "to_account_id": None,
        "frequency": "monthly",
        "start_date": "2026-01-12",
        "auto_post": 1,
        "auto_post_from": "2026-01-01",
        **kw,
    }
    cols = ", ".join(["user_id", *fields])
    marks = ", ".join("?" * (len(fields) + 1))
    sid = conn.execute(
        f"INSERT INTO subscriptions({cols}) VALUES({marks})", (uid, *fields.values())
    ).lastrowid
    conn.commit()
    return conn.execute("SELECT * FROM subscriptions WHERE id=?", (sid,)).fetchone()


def _posted(conn, sub, day=NOV_12):
    """Post ``sub``'s occurrence on ``day``; returns the transaction ids."""
    assert post_occurrence(conn, sub, day)
    p = conn.execute(
        "SELECT transaction_id, transfer_id FROM subscription_postings"
        " WHERE subscription_id=? AND occurrence_date=?",
        (sub["id"], day.isoformat()),
    ).fetchone()
    if p["transaction_id"] is not None:
        return [p["transaction_id"]]
    return [
        r["id"]
        for r in conn.execute(
            "SELECT id FROM transactions WHERE transfer_id=? ORDER BY id",
            (p["transfer_id"],),
        )
    ]


def _txn(conn, tid):
    return conn.execute("SELECT * FROM transactions WHERE id=?", (tid,)).fetchone()


# ── find_matches: which transactions are candidates ──────────────────────────


def test_a_posted_transaction_matches_with_its_schedule_name(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    (tid,) = _posted(conn, _sub(conn, uid, aid))

    found = find_matches(conn, uid, aid, [_row(1, date(2026, 11, 13))])
    assert _ids(found) == {1: tid}
    assert found[1].name == "Netflix"
    assert found[1].day == NOV_12


def test_another_accounts_transaction_does_not_match(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    other = _account(conn, uid, "Savings")
    _posted(conn, _sub(conn, uid, other))

    assert find_matches(conn, uid, aid, [_row(1, NOV_12)]) == {}


def test_another_users_transaction_does_not_match(conn):
    alice = _user(conn)
    bob = _user(conn, "bob")
    bob_acct = _account(conn, bob)
    _posted(conn, _sub(conn, bob, bob_acct))

    assert find_matches(conn, alice, bob_acct, [_row(1, NOV_12)]) == {}


def test_an_already_imported_transaction_is_excluded(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    (tid,) = _posted(conn, _sub(conn, uid, aid))
    conn.execute("UPDATE transactions SET import_hash='earlier' WHERE id=?", (tid,))
    conn.commit()

    assert find_matches(conn, uid, aid, [_row(1, NOV_12)]) == {}


def test_a_row_that_was_already_imported_takes_no_part(conn):
    # The row's own hash is already on a transaction: the import skips it as a
    # duplicate, so it mustn't claim a posted transaction as well.
    uid = _user(conn)
    aid = _account(conn, uid)
    _posted(conn, _sub(conn, uid, aid))
    manual = insert_transaction(
        conn, uid, aid, -999, "2026-11-12T00:00:00Z", "NETFLIX", "", ""
    )
    conn.execute("UPDATE transactions SET import_hash='h1' WHERE id=?", (manual,))
    conn.commit()

    assert find_matches(conn, uid, aid, [_row(1, NOV_12, import_hash="h1")]) == {}


def test_a_manual_transaction_does_not_match(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    insert_transaction(conn, uid, aid, -999, "2026-11-12T00:00:00Z", "Netflix", "", "")
    conn.commit()

    assert find_matches(conn, uid, aid, [_row(1, NOV_12)]) == {}


def test_a_deleted_posted_transaction_does_not_match(conn):
    # The posting row outlives its transaction (ON DELETE SET NULL).
    uid = _user(conn)
    aid = _account(conn, uid)
    (tid,) = _posted(conn, _sub(conn, uid, aid))
    conn.execute("DELETE FROM transactions WHERE id=?", (tid,))
    conn.commit()

    assert find_matches(conn, uid, aid, [_row(1, NOV_12)]) == {}


def test_a_transaction_outside_the_files_window_is_not_loaded(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    _posted(conn, _sub(conn, uid, aid), date(2026, 10, 12))

    assert find_matches(conn, uid, aid, [_row(1, NOV_12)]) == {}


def test_either_leg_of_a_scheduled_transfer_can_match(conn):
    uid = _user(conn)
    current = _account(conn, uid)
    savings = _account(conn, uid, "Savings")
    sub = _sub(
        conn,
        uid,
        current,
        name="Savings pot",
        kind="transfer",
        to_account_id=savings,
        amount_cents=20000,
    )
    out_leg, in_leg = _posted(conn, sub)

    assert _ids(find_matches(conn, uid, current, [_row(1, NOV_12, -20000)])) == {
        1: out_leg
    }
    assert _ids(find_matches(conn, uid, savings, [_row(1, NOV_12, 20000)])) == {
        1: in_leg
    }


# ── claim_transaction ────────────────────────────────────────────────────────


def test_claim_takes_the_banks_hash_date_and_description(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    (tid,) = _posted(conn, _sub(conn, uid, aid))
    (match,) = find_matches(conn, uid, aid, [_row(1, date(2026, 11, 13))]).values()

    assert claim_transaction(
        conn, uid, match, "h1", "2026-11-13T00:00:00Z", "NETFLIX.COM"
    )
    txn = _txn(conn, tid)
    assert txn["import_hash"] == "h1"
    assert txn["occurred_at"] == "2026-11-13T00:00:00Z"
    assert txn["merchant"] == "NETFLIX.COM"
    assert txn["amount_cents"] == -999


def test_claim_of_a_transfer_leg_only_takes_the_hash(conn):
    # Transfers can't be edited and both legs share one date.
    uid = _user(conn)
    current = _account(conn, uid)
    savings = _account(conn, uid, "Savings")
    sub = _sub(conn, uid, current, kind="transfer", to_account_id=savings)
    out_leg, _ = _posted(conn, sub)
    (match,) = find_matches(conn, uid, current, [_row(1, NOV_12)]).values()

    assert claim_transaction(conn, uid, match, "h1", "2026-11-14T00:00:00Z", "SO")
    txn = _txn(conn, out_leg)
    assert txn["import_hash"] == "h1"
    assert txn["occurred_at"] == "2026-11-12T00:00:00Z"
    assert txn["merchant"] == "Netflix"


def test_claim_refuses_a_transaction_already_claimed(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    _posted(conn, _sub(conn, uid, aid))
    (match,) = find_matches(conn, uid, aid, [_row(1, NOV_12)]).values()

    assert claim_transaction(conn, uid, match, "h1", "2026-11-12T00:00:00Z", "A")
    assert not claim_transaction(conn, uid, match, "h2", "2026-11-12T00:00:00Z", "B")
    assert _txn(conn, match.transaction_id)["import_hash"] == "h1"
