"""
Tests for scheduled-item (subscription) CRUD + the calendar occurrences endpoint:
  GET    /api/subscriptions[?account=]
  POST   /api/subscriptions
  PUT    /api/subscriptions/{sid}
  DELETE /api/subscriptions/{sid}
  GET    /api/subscriptions/occurrences[?account=]
"""

from datetime import date, timedelta

import pytest

from constants import MAX_MONEY


def _sub(client, **kw):
    payload = {
        "name": "Netflix",
        "amount": 9.99,
        "frequency": "monthly",
        "start_date": "2024-01-15",
        **kw,
    }
    return client.post("/api/subscriptions", json=payload).json()


# ── Auth gates ───────────────────────────────────────────────────────────────


def test_list_requires_auth(client):
    assert client.get("/api/subscriptions").status_code == 401


def test_create_requires_auth(client):
    assert client.post("/api/subscriptions", json={}).status_code == 401


def test_update_requires_auth(client):
    assert client.put("/api/subscriptions/1", json={}).status_code == 401


def test_delete_requires_auth(client):
    assert client.delete("/api/subscriptions/1").status_code == 401


def test_occurrences_requires_auth(client):
    assert (
        client.get(
            "/api/subscriptions/occurrences?from=2026-01-01&to=2026-01-31"
        ).status_code
        == 401
    )


# ── Create + list ────────────────────────────────────────────────────────────


def test_create_returns_201_and_fields(alice):
    r = alice.post(
        "/api/subscriptions",
        json={
            "name": "Spotify",
            "amount": 11.99,
            "category": "Subscriptions",
            "frequency": "monthly",
            "start_date": "2024-03-01",
            "color": "#5546F6",
            "notes": "Family plan",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Spotify"
    assert body["amount"] == 11.99
    assert body["category"] == "Subscriptions"
    assert body["frequency"] == "monthly"
    assert body["start_date"] == "2024-03-01"
    assert body["color"] == "#5546F6"
    assert body["notes"] == "Family plan"
    assert body["active"] is True
    assert body["account_id"] is None
    assert "id" in body and "created_at" in body


def test_create_with_defaults(alice):
    body = _sub(alice)
    assert body["category"] == ""
    assert body["color"] == ""
    assert body["notes"] == ""
    assert body["active"] is True
    assert body["end_date"] is None


def test_created_subscription_appears_in_list(alice):
    sub = _sub(alice, name="Visible")
    items = alice.get("/api/subscriptions").json()
    assert any(s["id"] == sub["id"] for s in items)


# ── Computed next_due_date ───────────────────────────────────────────────────


def test_active_subscription_has_future_next_due_date(alice):
    sub = _sub(alice, frequency="monthly", start_date="2024-01-15")
    assert sub["next_due_date"] is not None
    assert sub["next_due_date"] >= date.today().isoformat()


def test_inactive_subscription_has_no_next_due_date(alice):
    sub = _sub(alice, active=False)
    assert sub["next_due_date"] is None


def test_elapsed_end_date_has_no_next_due_date(alice):
    past = (date.today() - timedelta(days=30)).isoformat()
    sub = _sub(alice, start_date="2024-01-15", end_date=past)
    assert sub["next_due_date"] is None


def test_list_is_time_ordered_soonest_first(alice):
    # A weekly sub is due within a week; a monthly one anchored later in the
    # cycle is generally further out — assert the list comes back sorted by the
    # computed next-due ascending, with no-due rows last.
    _sub(alice, name="Inactive", active=False)
    _sub(alice, name="Weekly", frequency="weekly", start_date="2024-01-01")
    _sub(alice, name="Monthly", frequency="monthly", start_date="2024-01-15")
    items = alice.get("/api/subscriptions").json()
    dues = [s["next_due_date"] for s in items]
    present = [d for d in dues if d is not None]
    assert present == sorted(present)
    # The inactive row (no due date) sorts to the end.
    assert dues[-1] is None


# ── User isolation ───────────────────────────────────────────────────────────


def test_user_cannot_see_others_subscriptions(alice, bob):
    _sub(alice)
    assert bob.get("/api/subscriptions").json() == []


def test_user_cannot_update_others_subscription(alice, bob):
    sub = _sub(alice)
    assert (
        bob.put(
            f"/api/subscriptions/{sub['id']}", json={"name": "Hijacked"}
        ).status_code
        == 404
    )


def test_user_cannot_delete_others_subscription(alice, bob):
    sub = _sub(alice)
    assert bob.delete(f"/api/subscriptions/{sub['id']}").status_code == 404
    assert len(alice.get("/api/subscriptions").json()) == 1


# ── Update ───────────────────────────────────────────────────────────────────


def test_patch_name_only(alice):
    sub = _sub(alice, name="Old")
    r = alice.put(f"/api/subscriptions/{sub['id']}", json={"name": "New"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "New"
    assert body["amount"] == 9.99


def test_patch_amount_and_frequency(alice):
    sub = _sub(alice)
    r = alice.put(
        f"/api/subscriptions/{sub['id']}",
        json={"amount": 19.99, "frequency": "annual"},
    )
    body = r.json()
    assert body["amount"] == 19.99
    assert body["frequency"] == "annual"


def test_patch_toggle_active(alice):
    sub = _sub(alice)
    assert sub["next_due_date"] is not None
    r = alice.put(f"/api/subscriptions/{sub['id']}", json={"active": False})
    body = r.json()
    assert body["active"] is False
    assert body["next_due_date"] is None


def test_patch_empty_body_is_noop(alice):
    sub = _sub(alice)
    r = alice.put(f"/api/subscriptions/{sub['id']}", json={})
    assert r.status_code == 200
    assert r.json()["id"] == sub["id"]


def test_patch_clear_end_date_with_null(alice):
    future = (date.today() + timedelta(days=365)).isoformat()
    sub = _sub(alice, end_date=future)
    assert sub["end_date"] == future
    cleared = alice.put(
        f"/api/subscriptions/{sub['id']}", json={"end_date": None}
    ).json()
    assert cleared["end_date"] is None


def test_update_nonexistent_returns_404(alice):
    assert alice.put("/api/subscriptions/99999", json={"name": "X"}).status_code == 404


# ── Delete ───────────────────────────────────────────────────────────────────


def test_delete_subscription(alice):
    sub = _sub(alice)
    r = alice.delete(f"/api/subscriptions/{sub['id']}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert alice.get("/api/subscriptions").json() == []


def test_delete_nonexistent_returns_404(alice):
    assert alice.delete("/api/subscriptions/99999").status_code == 404


# ── Validation ───────────────────────────────────────────────────────────────


def test_create_rejects_blank_name(alice):
    r = alice.post(
        "/api/subscriptions",
        json={
            "name": "",
            "amount": 5.0,
            "frequency": "monthly",
            "start_date": "2024-01-01",
        },
    )
    assert r.status_code == 400


def test_create_rejects_zero_amount(alice):
    r = alice.post(
        "/api/subscriptions",
        json={
            "name": "X",
            "amount": 0.0,
            "frequency": "monthly",
            "start_date": "2024-01-01",
        },
    )
    assert r.status_code == 400


def test_create_rejects_amount_above_max_money(alice):
    r = alice.post(
        "/api/subscriptions",
        json={
            "name": "X",
            "amount": MAX_MONEY + 1,
            "frequency": "monthly",
            "start_date": "2024-01-01",
        },
    )
    assert r.status_code == 400


def test_create_rejects_bad_frequency(alice):
    r = alice.post(
        "/api/subscriptions",
        json={
            "name": "X",
            "amount": 5.0,
            "frequency": "fortnightly",
            "start_date": "2024-01-01",
        },
    )
    assert r.status_code == 400


def test_create_rejects_bad_start_date(alice):
    r = alice.post(
        "/api/subscriptions",
        json={
            "name": "X",
            "amount": 5.0,
            "frequency": "monthly",
            "start_date": "15/01/2024",
        },
    )
    assert r.status_code == 400


def test_create_rejects_extra_field(alice):
    r = alice.post(
        "/api/subscriptions",
        json={
            "name": "X",
            "amount": 5.0,
            "frequency": "monthly",
            "start_date": "2024-01-01",
            "unknown": True,
        },
    )
    assert r.status_code == 400


# ── Account linking ──────────────────────────────────────────────────────────


def _account(client, name="Current", type_="current"):
    return client.post("/api/accounts", json={"name": name, "type": type_}).json()["id"]


def test_create_with_account_link(alice):
    aid = _account(alice)
    sub = _sub(alice, account_id=aid)
    assert sub["account_id"] == aid
    assert sub["account_name"] == "Current"


def test_create_with_others_account_rejected(alice, bob):
    bob_aid = _account(bob, name="Bob Current")
    r = alice.post(
        "/api/subscriptions",
        json={
            "name": "X",
            "amount": 5.0,
            "frequency": "monthly",
            "start_date": "2024-01-01",
            "account_id": bob_aid,
        },
    )
    assert r.status_code == 404


def test_update_to_others_account_rejected(alice, bob):
    bob_aid = _account(bob, name="Bob Current")
    sub = _sub(alice)
    assert (
        alice.put(
            f"/api/subscriptions/{sub['id']}", json={"account_id": bob_aid}
        ).status_code
        == 404
    )


def test_link_then_unlink_account(alice):
    aid = _account(alice)
    sub = _sub(alice)
    linked = alice.put(
        f"/api/subscriptions/{sub['id']}", json={"account_id": aid}
    ).json()
    assert linked["account_id"] == aid and linked["account_name"] == "Current"
    unlinked = alice.put(
        f"/api/subscriptions/{sub['id']}", json={"account_id": None}
    ).json()
    assert unlinked["account_id"] is None and unlinked["account_name"] is None


def test_deleting_linked_account_unlinks_subscription(alice):
    aid = _account(alice)
    sub = _sub(alice, account_id=aid)
    assert alice.delete(f"/api/accounts/{aid}").status_code == 200
    remaining = alice.get("/api/subscriptions").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] == sub["id"]
    assert remaining[0]["account_id"] is None


# ── Occurrences endpoint ─────────────────────────────────────────────────────


def test_occurrences_expands_within_window(alice):
    _sub(alice, name="Monthly", frequency="monthly", start_date="2020-01-15")
    r = alice.get("/api/subscriptions/occurrences?from=2026-01-01&to=2026-03-31")
    assert r.status_code == 200
    dates = [o["date"] for o in r.json()]
    assert dates == ["2026-01-15", "2026-02-15", "2026-03-15"]


def test_occurrences_includes_metadata(alice):
    sub = _sub(
        alice, name="Gym", frequency="monthly", start_date="2020-01-10", color="#0EA5A4"
    )
    r = alice.get("/api/subscriptions/occurrences?from=2026-01-01&to=2026-01-31")
    occ = r.json()[0]
    assert occ["subscription_id"] == sub["id"]
    assert occ["name"] == "Gym"
    assert occ["amount"] == 9.99
    assert occ["color"] == "#0EA5A4"


def test_occurrences_excludes_inactive(alice):
    _sub(alice, name="Off", active=False, frequency="monthly", start_date="2020-01-15")
    r = alice.get("/api/subscriptions/occurrences?from=2026-01-01&to=2026-03-31")
    assert r.json() == []


def test_occurrences_rejects_inverted_window(alice):
    r = alice.get("/api/subscriptions/occurrences?from=2026-03-31&to=2026-01-01")
    assert r.status_code == 400


def test_occurrences_rejects_oversized_window(alice):
    r = alice.get("/api/subscriptions/occurrences?from=2020-01-01&to=2026-01-01")
    assert r.status_code == 400


def test_occurrences_rejects_bad_date(alice):
    r = alice.get("/api/subscriptions/occurrences?from=notadate&to=2026-01-01")
    assert r.status_code == 400


def test_occurrences_isolated_per_user(alice, bob):
    _sub(alice, frequency="monthly", start_date="2020-01-15")
    r = bob.get("/api/subscriptions/occurrences?from=2026-01-01&to=2026-03-31")
    assert r.json() == []


# ── Kinds: expense / income / transfer ───────────────────────────────────────


def _acct(client, name, currency="GBP", type_="current"):
    r = client.post(
        "/api/accounts", json={"name": name, "type": type_, "currency": currency}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _post(client, **kw):
    payload = {
        "name": "Item",
        "amount": 100.0,
        "frequency": "monthly",
        "start_date": "2024-01-25",
        **kw,
    }
    return client.post("/api/subscriptions", json=payload)


def _put(client, sid, **kw):
    return client.put(f"/api/subscriptions/{sid}", json=kw)


def test_kind_defaults_to_expense(alice):
    sub = _sub(alice)
    assert sub["kind"] == "expense"
    assert sub["to_account_id"] is None
    assert sub["to_account_name"] is None


def test_create_income_into_an_account(alice):
    aid = _acct(alice, "Current")
    r = _post(alice, name="Salary", amount=2500.0, kind="income", account_id=aid)
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "income"
    assert body["amount"] == 2500.0
    assert body["account_id"] == aid
    assert body["account_name"] == "Current"
    assert body["to_account_id"] is None


def test_create_transfer_between_accounts(alice):
    src = _acct(alice, "Current")
    dst = _acct(alice, "Savings", type_="savings")
    r = _post(
        alice, name="Savings pot", kind="transfer", account_id=src, to_account_id=dst
    )
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "transfer"
    assert (body["account_id"], body["account_name"]) == (src, "Current")
    assert (body["to_account_id"], body["to_account_name"]) == (dst, "Savings")


def test_create_rejects_unknown_kind(alice):
    assert _post(alice, kind="refund").status_code == 400


def test_amount_stays_positive_for_every_kind(alice):
    """The sign comes from `kind`, never from the amount."""
    aid = _acct(alice, "Current")
    assert _post(alice, kind="income", account_id=aid, amount=-5).status_code == 400


@pytest.mark.parametrize(
    "links",
    [
        {},  # neither end
        {"account_id": "src"},  # no destination
        {"to_account_id": "dst"},  # no source
        {"account_id": "src", "to_account_id": "src"},  # same account
    ],
    ids=["no-accounts", "no-to", "no-from", "same-account"],
)
def test_transfer_link_matrix_rejected(alice, links):
    ids = {"src": _acct(alice, "Current"), "dst": _acct(alice, "Savings")}
    resolved = {k: ids[v] for k, v in links.items()}
    assert _post(alice, kind="transfer", **resolved).status_code == 400


@pytest.mark.parametrize("end", ["account_id", "to_account_id"])
def test_transfer_with_others_account_is_404(alice, bob, end):
    mine = _acct(alice, "Current")
    theirs = _acct(bob, "Bob savings")
    links = {"account_id": mine, "to_account_id": mine, end: theirs}
    assert _post(alice, kind="transfer", **links).status_code == 404


def test_transfer_across_currencies_rejected(alice):
    gbp = _acct(alice, "Current")
    eur = _acct(alice, "Euro savings", currency="EUR")
    r = _post(alice, kind="transfer", account_id=gbp, to_account_id=eur)
    assert r.status_code == 400
    assert "currenc" in r.json()["detail"].lower()


@pytest.mark.parametrize("kind", ["expense", "income"])
def test_non_transfer_rejects_to_account(alice, kind):
    a = _acct(alice, "Current")
    b = _acct(alice, "Savings")
    assert _post(alice, kind=kind, account_id=a, to_account_id=b).status_code == 400


def test_deleting_destination_account_unlinks_it(alice):
    src = _acct(alice, "Current")
    dst = _acct(alice, "Savings")
    _post(alice, kind="transfer", account_id=src, to_account_id=dst)
    assert alice.delete(f"/api/accounts/{dst}").status_code == 200
    [item] = alice.get("/api/subscriptions").json()
    assert item["kind"] == "transfer"
    assert item["to_account_id"] is None
    assert item["to_account_name"] is None


# ── Kind switching on patch ──────────────────────────────────────────────────


@pytest.fixture
def transfer(alice):
    """A GBP Current → Savings transfer, plus a spare GBP and a EUR account."""
    ids = {
        "src": _acct(alice, "Current"),
        "dst": _acct(alice, "Savings"),
        "spare": _acct(alice, "ISA"),
        "eur": _acct(alice, "Euro", currency="EUR"),
    }
    r = _post(alice, kind="transfer", account_id=ids["src"], to_account_id=ids["dst"])
    return r.json()["id"], ids


def test_patch_transfer_to_expense_drops_destination(alice, transfer):
    sid, ids = transfer
    r = _put(alice, sid, kind="expense")
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "expense"
    assert body["account_id"] == ids["src"]
    assert body["to_account_id"] is None


def test_patch_transfer_to_income_with_destination_rejected(alice, transfer):
    sid, ids = transfer
    assert _put(alice, sid, kind="income", to_account_id=ids["dst"]).status_code == 400
    assert alice.get("/api/subscriptions").json()[0]["kind"] == "transfer"


def test_patch_expense_to_transfer_needs_destination(alice):
    aid = _acct(alice, "Current")
    sid = _post(alice, account_id=aid).json()["id"]
    assert _put(alice, sid, kind="transfer").status_code == 400


def test_patch_expense_to_transfer_with_destination(alice):
    src = _acct(alice, "Current")
    dst = _acct(alice, "Savings")
    sid = _post(alice, account_id=src).json()["id"]
    r = _put(alice, sid, kind="transfer", to_account_id=dst)
    assert r.status_code == 200
    assert (r.json()["kind"], r.json()["to_account_id"]) == ("transfer", dst)


def test_patch_to_account_on_expense_rejected(alice):
    a = _acct(alice, "Current")
    b = _acct(alice, "Savings")
    sid = _post(alice, account_id=a).json()["id"]
    assert _put(alice, sid, to_account_id=b).status_code == 400


def test_patch_transfer_source_onto_destination_rejected(alice, transfer):
    sid, ids = transfer
    assert _put(alice, sid, account_id=ids["dst"]).status_code == 400


def test_patch_transfer_destination_across_currencies_rejected(alice, transfer):
    sid, ids = transfer
    assert _put(alice, sid, to_account_id=ids["eur"]).status_code == 400


def test_patch_transfer_destination_to_others_account_is_404(alice, bob, transfer):
    sid, _ = transfer
    theirs = _acct(bob, "Bob savings")
    assert _put(alice, sid, to_account_id=theirs).status_code == 404


def test_patch_transfer_clearing_destination_rejected(alice, transfer):
    sid, _ = transfer
    assert _put(alice, sid, to_account_id=None).status_code == 400


def test_patch_transfer_destination_to_another_account(alice, transfer):
    sid, ids = transfer
    r = _put(alice, sid, to_account_id=ids["spare"])
    assert r.status_code == 200
    assert (r.json()["to_account_id"], r.json()["to_account_name"]) == (
        ids["spare"],
        "ISA",
    )


def test_patch_unrelated_field_skips_link_check(alice, transfer):
    """A rename doesn't re-check the accounts, so a transfer whose destination
    was deleted can still be edited or paused rather than getting stuck."""
    sid, ids = transfer
    alice.delete(f"/api/accounts/{ids['dst']}")
    r = _put(alice, sid, name="Renamed", active=False)
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed"


def test_patch_explicit_null_kind_leaves_kind(alice, transfer):
    sid, _ = transfer
    r = _put(alice, sid, kind=None)
    assert r.status_code == 200
    assert r.json()["kind"] == "transfer"


# ── ?account= filter ─────────────────────────────────────────────────────────


@pytest.fixture
def scheduled(alice):
    """Salary into Current, Netflix from Current, a Current → Savings transfer
    and an unrelated ISA payment. Returns the account ids."""
    ids = {
        "current": _acct(alice, "Current"),
        "savings": _acct(alice, "Savings"),
        "isa": _acct(alice, "ISA"),
    }
    _post(alice, name="Salary", kind="income", account_id=ids["current"])
    _post(alice, name="Netflix", account_id=ids["current"], amount=9.99)
    _post(
        alice,
        name="Savings pot",
        kind="transfer",
        account_id=ids["current"],
        to_account_id=ids["savings"],
    )
    _post(alice, name="ISA fee", account_id=ids["isa"])
    _post(alice, name="Unlinked")
    return ids


def _names(items):
    return sorted(i["name"] for i in items)


def test_list_filter_by_source_account(alice, scheduled):
    r = alice.get(f"/api/subscriptions?account={scheduled['current']}")
    assert r.status_code == 200
    assert _names(r.json()) == ["Netflix", "Salary", "Savings pot"]


def test_list_filter_finds_transfer_destination(alice, scheduled):
    r = alice.get(f"/api/subscriptions?account={scheduled['savings']}")
    assert _names(r.json()) == ["Savings pot"]


def test_list_without_filter_returns_everything(alice, scheduled):
    assert len(alice.get("/api/subscriptions").json()) == 5


def test_list_filter_rejects_bad_account_id(alice):
    assert alice.get("/api/subscriptions?account=0").status_code == 400


def test_occurrences_filter_finds_transfer_destination(alice, scheduled):
    r = alice.get(
        "/api/subscriptions/occurrences?from=2026-01-01&to=2026-01-31"
        f"&account={scheduled['savings']}"
    )
    assert r.status_code == 200
    [occ] = r.json()
    assert occ["name"] == "Savings pot"
    assert occ["date"] == "2026-01-25"
    assert occ["kind"] == "transfer"
    assert occ["account_id"] == scheduled["current"]
    assert occ["to_account_id"] == scheduled["savings"]


def test_occurrences_filter_by_source_account(alice, scheduled):
    r = alice.get(
        "/api/subscriptions/occurrences?from=2026-01-01&to=2026-01-31"
        f"&account={scheduled['current']}"
    )
    assert sorted((o["name"], o["kind"]) for o in r.json()) == [
        ("Netflix", "expense"),
        ("Salary", "income"),
        ("Savings pot", "transfer"),
    ]


def test_account_filter_isolated_per_user(alice, bob, scheduled):
    """Filtering by another user's account id shows nothing of theirs."""
    current = scheduled["current"]
    assert bob.get(f"/api/subscriptions?account={current}").json() == []
    r = bob.get(
        "/api/subscriptions/occurrences?from=2026-01-01&to=2026-01-31"
        f"&account={current}"
    )
    assert r.json() == []


# ── Page paths ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("path", ["/scheduled", "/subscriptions"])
def test_scheduled_page_paths_serve_the_app(alice, client, path):
    """/scheduled is the screen's path; the old /subscriptions still loads the
    app (the client redirects it) so saved links keep working."""
    # 200 when the React build exists, 503 when dist/ is missing (CI).
    assert alice.get(path, follow_redirects=False).status_code in (200, 503)
    anon = client.get(path, follow_redirects=False)
    assert anon.status_code == 302
    assert "/login" in anon.headers["location"]
