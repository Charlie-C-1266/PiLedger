"""
API tests for scheduled items that post themselves, and per-occurrence control:
  POST   /api/subscriptions/post-due
  POST   /api/subscriptions/{sid}/post        (Post now)
  POST   /api/subscriptions/{sid}/skip        (Skip)
  DELETE /api/subscriptions/{sid}/postings/{date}   (Undo)
plus the ``auto_post`` / ``auto_post_from`` fields on create and update, the
``subscription_id`` badge on transactions, and how handled dates show up in
``next_due_date`` and the calendar. The posting rules themselves are pinned in
``test_posting_service.py``; these cover the HTTP contract.
"""

from datetime import date, timedelta

import pytest

from db import db
from services.posting import POST_NOW_NOTE


def _today():
    return date.today()


def _iso(d):
    return d.isoformat()


def _acct(client, name="Current", type_="current", balance=1000.0, **kw):
    r = client.post("/api/accounts", json={"name": name, "type": type_, **kw})
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    client.post(f"/api/accounts/{aid}/balance", json={"balance": balance})
    return aid


def _balance(client, aid):
    (acct,) = [a for a in client.get("/api/accounts").json() if a["id"] == aid]
    return acct["current_balance"]


def _create(client, **kw):
    # Weekly from today by default, so today is an occurrence and the next one
    # is a week out — no month-length surprises whatever day the suite runs.
    payload = {
        "name": "Gym",
        "amount": 25.0,
        "category": "Health",
        "frequency": "weekly",
        "start_date": _iso(_today()),
        **kw,
    }
    return client.post("/api/subscriptions", json=payload)


def _sub(client, **kw):
    r = _create(client, **kw)
    assert r.status_code == 201, r.text
    return r.json()


def _get(client, sid):
    (sub,) = [s for s in client.get("/api/subscriptions").json() if s["id"] == sid]
    return sub


def _txns(client):
    return client.get("/api/transactions").json()


def _calendar(client, sid, start, end):
    r = client.get(f"/api/subscriptions/occurrences?from={_iso(start)}&to={_iso(end)}")
    assert r.status_code == 200, r.text
    return {o["date"]: o["status"] for o in r.json() if o["subscription_id"] == sid}


# ── Auth gates ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "method, path, body",
    [
        ("POST", "/api/subscriptions/post-due", None),
        ("POST", "/api/subscriptions/1/post", {"date": "2026-01-01"}),
        ("POST", "/api/subscriptions/1/skip", {"date": "2026-01-01"}),
        ("DELETE", "/api/subscriptions/1/postings/2026-01-01", None),
    ],
)
def test_posting_routes_require_auth(client, method, path, body):
    assert client.request(method, path, json=body).status_code == 401


# ── Auto-post fields (D2: off unless asked) ──────────────────────────────────


def test_auto_post_defaults_off_through_the_api(alice):
    aid = _acct(alice)
    sub = _sub(alice, account_id=aid, start_date=_iso(_today() - timedelta(days=70)))
    assert sub["auto_post"] is False
    assert sub["auto_post_from"] is None

    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 0}
    assert _txns(alice) == []


def test_switching_on_at_create_starts_today_without_back_fill(alice):
    aid = _acct(alice)
    sub = _sub(
        alice,
        account_id=aid,
        auto_post=True,
        start_date=_iso(_today() - timedelta(days=70)),  # ten weeks of history
    )
    assert sub["auto_post"] is True
    assert sub["auto_post_from"] == _iso(_today())

    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 1}
    (txn,) = _txns(alice)
    assert txn["occurred_at"] == f"{_iso(_today())}T00:00:00Z"
    assert txn["amount"] == -25.0
    assert txn["merchant"] == "Gym"
    assert txn["category"] == "Health"
    assert txn["note"] == "Posted automatically"
    assert txn["subscription_id"] == sub["id"]
    assert _balance(alice, aid) == 975.0


def test_post_due_is_idempotent(alice):
    aid = _acct(alice)
    _sub(alice, account_id=aid, auto_post=True)
    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 1}
    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 0}
    assert len(_txns(alice)) == 1
    assert _balance(alice, aid) == 975.0


def test_explicit_auto_post_from_is_honoured(alice):
    aid = _acct(alice)
    sub = _sub(
        alice,
        account_id=aid,
        auto_post=True,
        auto_post_from=_iso(_today() - timedelta(days=14)),
        start_date=_iso(_today() - timedelta(days=70)),
    )
    assert sub["auto_post_from"] == _iso(_today() - timedelta(days=14))
    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 3}


def test_auto_post_from_is_ignored_while_off(alice):
    sub = _sub(alice, auto_post_from="2026-01-01")
    assert sub["auto_post_from"] is None


def test_auto_post_needs_an_account(alice):
    r = _create(alice, auto_post=True)
    assert r.status_code == 400
    assert "account" in r.json()["detail"].lower()


def test_auto_post_rejects_a_closed_account(alice):
    aid = _acct(alice, closed=True)
    r = _create(alice, account_id=aid, auto_post=True)
    assert r.status_code == 400
    assert r.json()["detail"] == "Account is closed"


def test_auto_post_transfer_needs_an_open_destination(alice):
    src = _acct(alice)
    dst = _acct(alice, "Savings", "savings", closed=True)
    r = _create(
        alice, kind="transfer", account_id=src, to_account_id=dst, auto_post=True
    )
    assert r.status_code == 400


def test_auto_post_rejects_non_bool(alice):
    aid = _acct(alice)
    assert _create(alice, account_id=aid, auto_post="yes please").status_code == 400


def test_auto_post_from_must_be_a_date(alice):
    aid = _acct(alice)
    r = _create(alice, account_id=aid, auto_post=True, auto_post_from="soon")
    assert r.status_code == 400


# ── Auto-post on update ──────────────────────────────────────────────────────


def _put(client, sid, **kw):
    return client.put(f"/api/subscriptions/{sid}", json=kw)


@pytest.fixture
def auto(alice):
    """An auto-posting weekly item that has been on for two weeks."""
    aid = _acct(alice)
    sub = _sub(
        alice,
        account_id=aid,
        auto_post=True,
        auto_post_from=_iso(_today() - timedelta(days=14)),
        start_date=_iso(_today() - timedelta(days=70)),
    )
    return {"aid": aid, "sid": sub["id"]}


def test_patch_switch_on_sets_today(alice):
    aid = _acct(alice)
    sub = _sub(alice, account_id=aid)
    r = _put(alice, sub["id"], auto_post=True)
    assert r.status_code == 200, r.text
    assert r.json()["auto_post"] is True
    assert r.json()["auto_post_from"] == _iso(_today())


def test_patch_switch_on_needs_an_account(alice):
    sub = _sub(alice)
    assert _put(alice, sub["id"], auto_post=True).status_code == 400


def test_patch_switch_off_clears_auto_post_from(alice, auto):
    body = _put(alice, auto["sid"], auto_post=False).json()
    assert (body["auto_post"], body["auto_post_from"]) == (False, None)
    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 0}


def test_patch_resending_unchanged_fields_keeps_auto_post_from(alice, auto):
    """The app's form resends every field on save; that mustn't restart the
    item (which would silently drop dates owed from downtime)."""
    sub = _get(alice, auto["sid"])
    r = _put(
        alice,
        auto["sid"],
        name="Gym (family)",
        auto_post=True,
        kind=sub["kind"],
        account_id=sub["account_id"],
        frequency=sub["frequency"],
        start_date=sub["start_date"],
        end_date=None,
        active=True,
    )
    assert r.status_code == 200, r.text
    assert r.json()["auto_post_from"] == _iso(_today() - timedelta(days=14))


@pytest.mark.parametrize(
    "patch",
    [
        {"frequency": "biweekly"},
        {"start_date": _iso(date.today() - timedelta(days=69))},
        {"end_date": _iso(date.today() + timedelta(days=365))},
    ],
)
def test_patch_rescheduling_restarts_from_today(alice, auto, patch):
    r = _put(alice, auto["sid"], **patch)
    assert r.status_code == 200, r.text
    assert r.json()["auto_post_from"] == _iso(_today())


def test_patch_moving_account_restarts_from_today(alice, auto):
    other = _acct(alice, "Joint")
    body = _put(alice, auto["sid"], account_id=other).json()
    assert body["auto_post_from"] == _iso(_today())


def test_patch_resuming_restarts_from_today(alice, auto):
    """Dates that fell while the item was paused aren't owed on resume."""
    _put(alice, auto["sid"], active=False)
    body = _put(alice, auto["sid"], active=True).json()
    assert body["auto_post_from"] == _iso(_today())
    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 1}


def test_patch_explicit_auto_post_from_wins(alice, auto):
    when = _iso(_today() - timedelta(days=7))
    body = _put(alice, auto["sid"], frequency="biweekly", auto_post_from=when).json()
    assert body["auto_post_from"] == when


def test_patch_explicit_null_leaves_auto_post_alone(alice, auto):
    body = _put(alice, auto["sid"], auto_post=None, auto_post_from=None).json()
    assert body["auto_post"] is True
    assert body["auto_post_from"] == _iso(_today() - timedelta(days=14))


def test_patch_cannot_unlink_an_auto_posting_item(alice, auto):
    assert _put(alice, auto["sid"], account_id=None).status_code == 400


def test_patch_cannot_move_auto_post_onto_a_closed_account(alice, auto):
    closed = _acct(alice, "Old", closed=True)
    assert _put(alice, auto["sid"], account_id=closed).status_code == 400


def test_closing_the_account_later_pauses_posting_but_not_the_item(alice, auto):
    alice.put(f"/api/accounts/{auto['aid']}", json={"closed": True})
    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 0}
    assert _get(alice, auto["sid"])["auto_post"] is True


# ── Post now ─────────────────────────────────────────────────────────────────


@pytest.fixture
def reminder(alice):
    """A weekly reminder (auto-post off) linked to an account."""
    aid = _acct(alice)
    sub = _sub(alice, account_id=aid)
    return {"aid": aid, "sid": sub["id"]}


def _post_now(client, sid, d):
    return client.post(f"/api/subscriptions/{sid}/post", json={"date": _iso(d)})


def _skip(client, sid, d):
    return client.post(f"/api/subscriptions/{sid}/skip", json={"date": _iso(d)})


def _undo(client, sid, d):
    return client.delete(f"/api/subscriptions/{sid}/postings/{_iso(d)}")


def test_post_now_posts_an_upcoming_occurrence_dated_today(alice, reminder):
    nxt = _today() + timedelta(days=7)
    r = _post_now(alice, reminder["sid"], nxt)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["subscription_id"] == reminder["sid"]
    assert (body["date"], body["status"]) == (_iso(nxt), "posted")
    assert body["transfer_id"] is None

    (txn,) = _txns(alice)
    assert txn["id"] == body["transaction_id"]
    assert txn["occurred_at"] == f"{_iso(_today())}T00:00:00Z"
    assert txn["note"] == POST_NOW_NOTE
    assert txn["subscription_id"] == reminder["sid"]
    assert _balance(alice, reminder["aid"]) == 975.0
    # The posted date no longer counts as upcoming; the calendar marks it.
    assert _get(alice, reminder["sid"])["next_due_date"] == _iso(_today())
    cal = _calendar(alice, reminder["sid"], _today(), nxt)
    assert cal == {_iso(_today()): None, _iso(nxt): "posted"}


def test_post_now_is_idempotent(alice, reminder):
    first = _post_now(alice, reminder["sid"], _today()).json()
    again = _post_now(alice, reminder["sid"], _today()).json()
    assert again == first
    assert len(_txns(alice)) == 1
    assert _balance(alice, reminder["aid"]) == 975.0


def test_post_now_then_auto_post_does_not_repost(alice, reminder):
    _post_now(alice, reminder["sid"], _today())
    _put(alice, reminder["sid"], auto_post=True)
    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 0}
    assert len(_txns(alice)) == 1


def test_next_due_date_skips_handled_dates(alice, reminder):
    _post_now(alice, reminder["sid"], _today())
    _skip(alice, reminder["sid"], _today() + timedelta(days=7))
    assert _get(alice, reminder["sid"])["next_due_date"] == _iso(
        _today() + timedelta(days=14)
    )


def test_post_now_rejects_a_date_off_the_schedule(alice, reminder):
    r = _post_now(alice, reminder["sid"], _today() + timedelta(days=1))
    assert r.status_code == 400
    assert (
        _post_now(alice, reminder["sid"], _today() - timedelta(days=7)).status_code
        == 400
    )
    assert _txns(alice) == []


def test_post_now_rejects_a_malformed_date(alice, reminder):
    r = alice.post(f"/api/subscriptions/{reminder['sid']}/post", json={"date": "today"})
    assert r.status_code == 400
    r = alice.post(f"/api/subscriptions/{reminder['sid']}/post", json={})
    assert r.status_code == 400


def test_post_now_needs_an_account(alice):
    sub = _sub(alice)
    r = _post_now(alice, sub["id"], _today())
    assert r.status_code == 400
    assert "account" in r.json()["detail"].lower()


def test_post_now_rejects_a_closed_account(alice, reminder):
    alice.put(f"/api/accounts/{reminder['aid']}", json={"closed": True})
    r = _post_now(alice, reminder["sid"], _today())
    assert r.status_code == 400
    assert r.json()["detail"] == "Account is closed"


def test_post_now_unknown_item_is_404(alice):
    assert _post_now(alice, 999, _today()).status_code == 404


def test_post_now_transfer_creates_both_badged_legs(alice):
    src = _acct(alice)
    dst = _acct(alice, "Savings", "savings", balance=0.0)
    sub = _sub(
        alice, name="Rainy day", kind="transfer", account_id=src, to_account_id=dst
    )
    body = _post_now(alice, sub["id"], _today()).json()
    assert body["transaction_id"] is None
    assert body["transfer_id"]

    legs = _txns(alice)
    assert {t["transfer_id"] for t in legs} == {body["transfer_id"]}
    assert {t["subscription_id"] for t in legs} == {sub["id"]}
    assert sorted(t["amount"] for t in legs) == [-25.0, 25.0]
    assert _balance(alice, src) == 975.0
    assert _balance(alice, dst) == 25.0


def test_post_now_turns_a_skipped_date_into_posted(alice, reminder):
    _skip(alice, reminder["sid"], _today())
    body = _post_now(alice, reminder["sid"], _today()).json()
    assert body["status"] == "posted"
    assert len(_txns(alice)) == 1


# ── Skip ─────────────────────────────────────────────────────────────────────


def test_skip_records_the_date(alice, reminder):
    nxt = _today() + timedelta(days=7)
    r = _skip(alice, reminder["sid"], nxt)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "subscription_id": reminder["sid"],
        "date": _iso(nxt),
        "status": "skipped",
        "transaction_id": None,
        "transfer_id": None,
    }
    assert _skip(alice, reminder["sid"], nxt).json()["status"] == "skipped"
    assert _calendar(alice, reminder["sid"], nxt, nxt) == {_iso(nxt): "skipped"}
    assert _txns(alice) == []


def test_skip_works_without_an_account(alice):
    sub = _sub(alice)
    assert _skip(alice, sub["id"], _today()).status_code == 200


def test_skip_keeps_auto_post_from_posting_it(alice, auto):
    _skip(alice, auto["sid"], _today())
    # Two weeks on: today-14 and today-7 are owed; today was skipped.
    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 2}


def test_skip_after_post_deletes_the_transaction_and_restores_balance(alice, reminder):
    _post_now(alice, reminder["sid"], _today())
    assert _balance(alice, reminder["aid"]) == 975.0

    body = _skip(alice, reminder["sid"], _today()).json()
    assert (body["status"], body["transaction_id"]) == ("skipped", None)
    assert _txns(alice) == []
    assert _balance(alice, reminder["aid"]) == 1000.0


def test_skip_after_transfer_post_deletes_both_legs(alice):
    src = _acct(alice)
    dst = _acct(alice, "Savings", "savings", balance=0.0)
    sub = _sub(alice, kind="transfer", account_id=src, to_account_id=dst)
    _post_now(alice, sub["id"], _today())

    _skip(alice, sub["id"], _today())
    assert _txns(alice) == []
    assert (_balance(alice, src), _balance(alice, dst)) == (1000.0, 0.0)


def test_skip_rejects_a_date_off_the_schedule(alice, reminder):
    assert (
        _skip(alice, reminder["sid"], _today() + timedelta(days=3)).status_code == 400
    )


# ── Undo ─────────────────────────────────────────────────────────────────────


def test_undo_post_now_restores_the_date_and_the_balance(alice, reminder):
    nxt = _today() + timedelta(days=7)
    _post_now(alice, reminder["sid"], _today())
    assert _get(alice, reminder["sid"])["next_due_date"] == _iso(nxt)

    r = _undo(alice, reminder["sid"], _today())
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert _txns(alice) == []
    assert _balance(alice, reminder["aid"]) == 1000.0
    assert _get(alice, reminder["sid"])["next_due_date"] == _iso(_today())
    assert _calendar(alice, reminder["sid"], _today(), _today()) == {
        _iso(_today()): None
    }


def test_undo_skip_restores_the_date(alice, reminder):
    _skip(alice, reminder["sid"], _today())
    assert _undo(alice, reminder["sid"], _today()).status_code == 200
    assert _get(alice, reminder["sid"])["next_due_date"] == _iso(_today())


def test_undo_auto_post_reverses_it_and_the_next_run_reposts(alice, auto):
    alice.post("/api/subscriptions/post-due")
    assert _balance(alice, auto["aid"]) == 925.0  # three weeks posted

    _undo(alice, auto["sid"], _today())
    assert _balance(alice, auto["aid"]) == 950.0
    assert len(_txns(alice)) == 2
    # The date is owed again, so the next run posts it.
    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 1}


def test_undo_with_nothing_logged_is_404(alice, reminder):
    assert _undo(alice, reminder["sid"], _today()).status_code == 404


def test_undo_rejects_a_malformed_date(alice, reminder):
    r = alice.delete(f"/api/subscriptions/{reminder['sid']}/postings/tomorrow")
    assert r.status_code == 400


def test_undo_works_after_the_schedule_moved(alice, reminder):
    _post_now(alice, reminder["sid"], _today())
    _put(alice, reminder["sid"], start_date=_iso(_today() + timedelta(days=1)))
    assert _undo(alice, reminder["sid"], _today()).status_code == 200
    assert _txns(alice) == []


def test_undo_when_the_transaction_was_already_deleted(alice, reminder):
    body = _post_now(alice, reminder["sid"], _today()).json()
    alice.delete(f"/api/transactions/{body['transaction_id']}")
    assert _balance(alice, reminder["aid"]) == 1000.0

    assert _undo(alice, reminder["sid"], _today()).status_code == 200
    assert _balance(alice, reminder["aid"]) == 1000.0  # nothing reversed twice


# ── Transactions it created ──────────────────────────────────────────────────


def test_deleted_auto_posted_transaction_is_not_reposted(alice, auto):
    alice.post("/api/subscriptions/post-due")
    first = _txns(alice)[0]
    alice.delete(f"/api/transactions/{first['id']}")
    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 0}
    assert len(_txns(alice)) == 2


def test_edited_auto_posted_transaction_keeps_its_badge(alice, auto):
    alice.post("/api/subscriptions/post-due")
    txn = _txns(alice)[0]
    r = alice.put(f"/api/transactions/{txn['id']}", json={"amount": -30.0})
    assert r.json()["subscription_id"] == auto["sid"]


def test_manual_transactions_have_no_subscription_id(alice):
    aid = _acct(alice)
    r = alice.post(
        "/api/transactions",
        json={"account_id": aid, "amount": -5.0, "merchant": "Cafe"},
    )
    assert r.json()["subscription_id"] is None
    assert _txns(alice)[0]["subscription_id"] is None


def test_deleting_the_item_keeps_its_transactions(alice, auto):
    alice.post("/api/subscriptions/post-due")
    assert alice.delete(f"/api/subscriptions/{auto['sid']}").status_code == 200

    txns = _txns(alice)
    assert len(txns) == 3
    assert {t["subscription_id"] for t in txns} == {None}
    with db() as conn:
        assert (
            conn.execute("SELECT COUNT(*) FROM subscription_postings").fetchone()[0]
            == 0
        )


# ── Per-user isolation ───────────────────────────────────────────────────────


def test_post_due_only_posts_the_callers_items(alice, bob):
    _sub(alice, account_id=_acct(alice), auto_post=True)
    _sub(bob, account_id=_acct(bob), auto_post=True)

    assert alice.post("/api/subscriptions/post-due").json() == {"posted": 1}
    assert _txns(bob) == []
    assert bob.post("/api/subscriptions/post-due").json() == {"posted": 1}


def test_cannot_post_skip_or_undo_anothers_item(alice, bob, reminder):
    sid = reminder["sid"]
    assert _post_now(bob, sid, _today()).status_code == 404
    assert _skip(bob, sid, _today()).status_code == 404
    _skip(alice, sid, _today())
    assert _undo(bob, sid, _today()).status_code == 404
    assert _calendar(alice, sid, _today(), _today()) == {_iso(_today()): "skipped"}
    assert _txns(alice) == []


def test_auto_post_rejects_anothers_account(alice, bob):
    bobs = _acct(bob)
    assert _create(alice, account_id=bobs, auto_post=True).status_code == 404
