"""Unit tests for ``services/posting`` — turning scheduled items into
transactions — with an injected ``today`` and rows written straight to a fresh
database (no HTTP), so each rule is pinned on its own.
"""

import logging
from datetime import date

import pytest

from db import db
from services.accounts import latest_balance_cents
from services.posting import (
    AUTO_POST_NOTE,
    due_dates,
    handled_dates,
    is_occurrence,
    post_due,
    post_occurrence,
    posting_statuses,
    skip_occurrence,
)
from services.transactions import delete_transaction_legs


# ── Pure: due_dates / is_occurrence ──────────────────────────────────────────


def test_due_dates_lists_every_occurrence_since_auto_post_from():
    assert due_dates(
        date(2026, 1, 15), "monthly", None, date(2026, 1, 1), date(2026, 3, 20)
    ) == [date(2026, 1, 15), date(2026, 2, 15), date(2026, 3, 15)]


def test_due_dates_leaves_out_handled_dates():
    assert due_dates(
        date(2026, 1, 15),
        "monthly",
        None,
        date(2026, 1, 1),
        date(2026, 3, 20),
        {date(2026, 2, 15)},
    ) == [date(2026, 1, 15), date(2026, 3, 15)]


def test_due_dates_never_back_fills_before_auto_post_from():
    # A schedule that started years ago only owes dates from the switch-on day.
    assert due_dates(
        date(2023, 1, 15), "monthly", None, date(2026, 3, 1), date(2026, 3, 20)
    ) == [date(2026, 3, 15)]


def test_due_dates_empty_before_auto_post_from_or_when_unset():
    assert (
        due_dates(date(2026, 1, 1), "weekly", None, date(2026, 5, 1), date(2026, 4, 1))
        == []
    )
    assert due_dates(date(2026, 1, 1), "weekly", None, None, date(2026, 4, 1)) == []


def test_due_dates_includes_today():
    assert due_dates(
        date(2026, 3, 20), "weekly", None, date(2026, 3, 20), date(2026, 3, 20)
    ) == [date(2026, 3, 20)]


def test_due_dates_stops_at_end_date():
    assert due_dates(
        date(2026, 1, 15),
        "monthly",
        date(2026, 2, 20),
        date(2026, 1, 1),
        date(2026, 6, 1),
    ) == [date(2026, 1, 15), date(2026, 2, 15)]


def test_due_dates_clamps_month_end():
    assert due_dates(
        date(2026, 1, 31), "monthly", None, date(2026, 1, 1), date(2026, 4, 30)
    ) == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]


def test_due_dates_clamps_to_leap_day():
    assert due_dates(
        date(2028, 1, 31), "monthly", None, date(2028, 2, 1), date(2028, 2, 29)
    ) == [date(2028, 2, 29)]


def test_is_occurrence():
    start = date(2026, 1, 31)
    assert is_occurrence(start, "monthly", None, date(2026, 2, 28))
    assert not is_occurrence(start, "monthly", None, date(2026, 2, 27))
    assert not is_occurrence(start, "monthly", None, date(2025, 12, 31))  # before start
    assert not is_occurrence(start, "monthly", date(2026, 2, 1), date(2026, 3, 31))


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


def _account(conn, uid, name="Current", type_="current", balance=1000_00, **kw):
    aid = conn.execute(
        "INSERT INTO accounts(user_id, name, type, currency, closed) VALUES(?,?,?,?,?)",
        (uid, name, type_, kw.get("currency", "GBP"), int(kw.get("closed", False))),
    ).lastrowid
    conn.execute(
        "INSERT INTO balance_history(account_id, balance_cents, recorded_at)"
        " VALUES(?, ?, '2025-01-01T00:00:00Z')",
        (aid, balance),
    )
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
        "start_date": "2026-01-15",
        "end_date": None,
        "active": 1,
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
    return sid


def _txns(conn, uid):
    return conn.execute(
        "SELECT * FROM transactions WHERE user_id=? ORDER BY occurred_at, id", (uid,)
    ).fetchall()


def _postings(conn, sid):
    return conn.execute(
        "SELECT * FROM subscription_postings WHERE subscription_id=?"
        " ORDER BY occurrence_date",
        (sid,),
    ).fetchall()


MAR_20 = date(2026, 3, 20)


# ── post_due ─────────────────────────────────────────────────────────────────


def test_post_due_creates_one_ordinary_transaction_per_due_date(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    sid = _sub(conn, uid, aid)

    assert post_due(conn, MAR_20) == 3

    txns = _txns(conn, uid)
    assert [t["occurred_at"] for t in txns] == [
        "2026-01-15T00:00:00Z",
        "2026-02-15T00:00:00Z",
        "2026-03-15T00:00:00Z",
    ]
    for t in txns:
        assert t["amount_cents"] == -999
        assert t["merchant"] == "Netflix"
        assert t["category"] == "Entertainment"
        assert t["note"] == AUTO_POST_NOTE
        assert t["transfer_id"] is None
    assert latest_balance_cents(conn, aid) == 1000_00 - 3 * 999
    logged = _postings(conn, sid)
    assert [p["status"] for p in logged] == ["posted"] * 3
    assert [p["transaction_id"] for p in logged] == [t["id"] for t in txns]


def test_running_twice_posts_once(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    _sub(conn, uid, aid)

    assert post_due(conn, MAR_20) == 3
    assert post_due(conn, MAR_20) == 0
    assert len(_txns(conn, uid)) == 3
    assert latest_balance_cents(conn, aid) == 1000_00 - 3 * 999


def test_overlapping_post_of_one_date_posts_once(conn):
    """The log's unique key decides: a second claim on the same date is a
    no-op even if the caller didn't check the log first."""
    uid = _user(conn)
    aid = _account(conn, uid)
    sid = _sub(conn, uid, aid)
    sub = conn.execute("SELECT * FROM subscriptions WHERE id=?", (sid,)).fetchone()

    assert post_occurrence(conn, sub, date(2026, 1, 15)) is True
    assert post_occurrence(conn, sub, date(2026, 1, 15)) is False
    assert len(_txns(conn, uid)) == 1


def test_later_run_posts_only_the_new_date(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    _sub(conn, uid, aid)

    assert post_due(conn, date(2026, 2, 1)) == 1
    assert post_due(conn, date(2026, 2, 15)) == 1
    assert post_due(conn, date(2026, 2, 16)) == 0
    assert len(_txns(conn, uid)) == 2


def test_deleted_posted_transaction_is_not_recreated(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    sid = _sub(conn, uid, aid)
    post_due(conn, MAR_20)

    first = _txns(conn, uid)[0]
    delete_transaction_legs(conn, uid, first["id"])
    conn.commit()

    assert post_due(conn, MAR_20) == 0
    assert len(_txns(conn, uid)) == 2
    # The log row outlives its transaction (ON DELETE SET NULL).
    jan = _postings(conn, sid)[0]
    assert (jan["status"], jan["transaction_id"]) == ("posted", None)


def test_skipped_date_stays_skipped(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    sid = _sub(conn, uid, aid)
    skip_occurrence(conn, uid, sid, date(2026, 2, 15))

    assert post_due(conn, MAR_20) == 2
    assert [t["occurred_at"][:10] for t in _txns(conn, uid)] == [
        "2026-01-15",
        "2026-03-15",
    ]
    assert post_due(conn, MAR_20) == 0


def test_no_back_fill_from_past_start_date(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    _sub(conn, uid, aid, start_date="2023-06-15", auto_post_from="2026-03-20")

    assert post_due(conn, MAR_20) == 0  # 15 March is before switch-on
    assert post_due(conn, date(2026, 4, 15)) == 1
    assert [t["occurred_at"][:10] for t in _txns(conn, uid)] == ["2026-04-15"]


def test_downtime_is_caught_up(conn):
    """Dates missed after switch-on (the server was off) are posted late, each
    dated on its own occurrence."""
    uid = _user(conn)
    aid = _account(conn, uid)
    _sub(conn, uid, aid, frequency="weekly", start_date="2026-03-02")

    assert post_due(conn, date(2026, 3, 2)) == 1
    assert post_due(conn, date(2026, 3, 25)) == 3
    assert [t["occurred_at"][:10] for t in _txns(conn, uid)] == [
        "2026-03-02",
        "2026-03-09",
        "2026-03-16",
        "2026-03-23",
    ]


def test_end_date_stops_posting(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    _sub(conn, uid, aid, end_date="2026-02-20")

    assert post_due(conn, MAR_20) == 2
    assert post_due(conn, date(2026, 12, 31)) == 0


def test_paused_item_posts_nothing(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    _sub(conn, uid, aid, active=0)

    assert post_due(conn, MAR_20) == 0
    assert _txns(conn, uid) == []


def test_reminder_posts_nothing(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    _sub(conn, uid, aid, auto_post=0, auto_post_from=None)

    assert post_due(conn, MAR_20) == 0


def test_closed_account_is_skipped_with_warning_and_not_paused(conn, caplog):
    uid = _user(conn)
    aid = _account(conn, uid, closed=True)
    sid = _sub(conn, uid, aid)

    with caplog.at_level(logging.WARNING, logger="piledger.autopost"):
        assert post_due(conn, MAR_20) == 0
    assert "Account is closed" in caplog.text
    assert _txns(conn, uid) == []
    assert _postings(conn, sid) == []
    row = conn.execute("SELECT * FROM subscriptions WHERE id=?", (sid,)).fetchone()
    assert (row["active"], row["auto_post"]) == (1, 1)


def test_unlinked_item_is_skipped_with_warning(conn, caplog):
    uid = _user(conn)
    _sub(conn, uid, None)

    with caplog.at_level(logging.WARNING, logger="piledger.autopost"):
        assert post_due(conn, MAR_20) == 0
    assert "Link an account" in caplog.text


def test_transfer_with_closed_destination_is_skipped(conn):
    uid = _user(conn)
    src = _account(conn, uid)
    dst = _account(conn, uid, name="Savings", type_="savings", closed=True)
    _sub(conn, uid, src, kind="transfer", to_account_id=dst)

    assert post_due(conn, MAR_20) == 0


def test_income_is_positive(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    _sub(conn, uid, aid, name="Salary", kind="income", amount_cents=250000)

    post_due(conn, MAR_20)
    assert {t["amount_cents"] for t in _txns(conn, uid)} == {250000}
    assert latest_balance_cents(conn, aid) == 1000_00 + 3 * 250000


def test_transfer_creates_both_legs(conn):
    uid = _user(conn)
    src = _account(conn, uid)
    dst = _account(conn, uid, name="Savings", type_="savings", balance=0)
    sid = _sub(
        conn,
        uid,
        src,
        name="Rainy day",
        kind="transfer",
        to_account_id=dst,
        amount_cents=5000,
        category="",
    )

    assert post_due(conn, date(2026, 1, 20)) == 1

    legs = _txns(conn, uid)
    assert [(t["account_id"], t["amount_cents"]) for t in legs] == [
        (src, -5000),
        (dst, 5000),
    ]
    assert legs[0]["transfer_id"] == legs[1]["transfer_id"] is not None
    assert {t["merchant"] for t in legs} == {"Rainy day"}
    assert {t["category"] for t in legs} == {"Transfer"}  # the item has none
    assert latest_balance_cents(conn, src) == 1000_00 - 5000
    assert latest_balance_cents(conn, dst) == 5000
    (logged,) = _postings(conn, sid)
    assert logged["transfer_id"] == legs[0]["transfer_id"]
    assert logged["transaction_id"] is None


def test_transfer_keeps_the_items_own_category(conn):
    uid = _user(conn)
    src = _account(conn, uid)
    dst = _account(conn, uid, name="Savings", type_="savings")
    _sub(conn, uid, src, kind="transfer", to_account_id=dst, category="Savings")

    post_due(conn, date(2026, 1, 20))
    assert {t["category"] for t in _txns(conn, uid)} == {"Savings"}


def test_expense_on_credit_card_raises_amount_owed(conn):
    uid = _user(conn)
    card = _account(conn, uid, name="Card", type_="credit", balance=200_00)
    _sub(conn, uid, card)

    post_due(conn, date(2026, 1, 20))
    (txn,) = _txns(conn, uid)
    assert txn["amount_cents"] == -999  # money out, like any expense
    assert latest_balance_cents(conn, card) == 200_00 + 999  # owed goes up


def test_transfer_paying_down_a_loan_lowers_amount_owed(conn):
    uid = _user(conn)
    current = _account(conn, uid)
    loan = _account(conn, uid, name="Loan", type_="loan", balance=5000_00)
    _sub(conn, uid, current, kind="transfer", to_account_id=loan, amount_cents=300_00)

    post_due(conn, date(2026, 1, 20))
    assert latest_balance_cents(conn, current) == 1000_00 - 300_00
    assert latest_balance_cents(conn, loan) == 5000_00 - 300_00


def test_income_on_credit_card_lowers_amount_owed(conn):
    uid = _user(conn)
    card = _account(conn, uid, name="Card", type_="credit", balance=200_00)
    _sub(conn, uid, card, name="Cashback", kind="income", amount_cents=500)

    post_due(conn, date(2026, 1, 20))
    assert latest_balance_cents(conn, card) == 200_00 - 500


def test_month_end_dates_are_posted_clamped(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    _sub(conn, uid, aid, start_date="2026-01-31")

    assert post_due(conn, date(2026, 3, 31)) == 3
    assert [t["occurred_at"][:10] for t in _txns(conn, uid)] == [
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
    ]


def test_post_due_for_one_user_leaves_others_alone(conn):
    alice = _user(conn)
    bob = _user(conn, "bob")
    _sub(conn, alice, _account(conn, alice))
    _sub(conn, bob, _account(conn, bob))

    assert post_due(conn, MAR_20, uid=alice) == 3
    assert _txns(conn, bob) == []
    assert post_due(conn, MAR_20) == 3  # everyone: only bob still owed


def test_one_broken_item_does_not_stop_the_others(conn, caplog):
    uid = _user(conn)
    aid = _account(conn, uid)
    _sub(conn, uid, aid, start_date="not-a-date")
    _sub(conn, uid, aid, name="Gym")

    with caplog.at_level(logging.ERROR, logger="piledger.autopost"):
        assert post_due(conn, MAR_20) == 3
    assert "auto-post failed" in caplog.text


# ── Reading the log ──────────────────────────────────────────────────────────


def test_handled_dates_and_statuses(conn):
    uid = _user(conn)
    aid = _account(conn, uid)
    sid = _sub(conn, uid, aid)
    other = _sub(conn, uid, aid, auto_post=0, auto_post_from=None)
    post_due(conn, date(2026, 2, 1))
    skip_occurrence(conn, uid, sid, date(2026, 2, 15))

    assert handled_dates(conn, uid, [sid, other]) == {
        sid: {date(2026, 1, 15), date(2026, 2, 15)},
        other: set(),
    }
    assert posting_statuses(conn, uid, [sid], start=date(2026, 2, 1)) == {
        sid: {date(2026, 2, 15): "skipped"}
    }
    assert posting_statuses(conn, uid, [sid], end=date(2026, 1, 31)) == {
        sid: {date(2026, 1, 15): "posted"}
    }
    assert handled_dates(conn, uid, []) == {}


def test_handled_dates_are_per_user(conn):
    alice = _user(conn)
    bob = _user(conn, "bob")
    sid = _sub(conn, alice, _account(conn, alice))
    post_due(conn, MAR_20)

    assert handled_dates(conn, bob, [sid]) == {sid: set()}
