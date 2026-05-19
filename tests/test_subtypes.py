"""
Tests for the account `subtype` field.

The subtype was added in 0.7.0 to let users record UK-market account flavours
(ISAs, mortgages, regular savers, etc.) alongside the existing three-way
current / savings / loan type. The default is 'general' for every parent type.
"""


# ── Defaults / round-trip ──────────────────────────────────────────────────────

def test_subtype_defaults_to_general(alice):
    body = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()
    assert body["subtype"] == "general"


def test_subtype_round_trips_on_list(alice):
    alice.post("/api/accounts", json={
        "name": "ISA", "type": "savings", "subtype": "cash_isa",
    })
    accounts = alice.get("/api/accounts").json()
    assert accounts[0]["subtype"] == "cash_isa"


def test_subtype_returned_on_create(alice):
    body = alice.post("/api/accounts", json={
        "name": "Home", "type": "loan", "subtype": "mortgage",
    }).json()
    assert body["subtype"] == "mortgage"


# ── Per-type validation ───────────────────────────────────────────────────────

def test_current_account_accepts_current_subtypes(alice):
    for sub in ("standard", "joint", "student", "premier", "basic", "business"):
        r = alice.post("/api/accounts", json={"name": sub, "type": "current", "subtype": sub})
        assert r.status_code == 201, r.text
        assert r.json()["subtype"] == sub


def test_savings_account_accepts_savings_subtypes(alice):
    for sub in (
        "cash_isa", "stocks_shares_isa", "lifetime_isa", "junior_isa",
        "regular_saver", "easy_access", "fixed_term_bond", "notice_account",
        "premium_bonds", "sipp", "workplace_pension",
    ):
        r = alice.post("/api/accounts", json={"name": sub, "type": "savings", "subtype": sub})
        assert r.status_code == 201, r.text
        assert r.json()["subtype"] == sub


def test_loan_account_accepts_loan_subtypes(alice):
    for sub in (
        "bank_loan", "credit_card", "mortgage", "student_loan",
        "car_finance", "overdraft", "bnpl",
    ):
        r = alice.post("/api/accounts", json={"name": sub, "type": "loan", "subtype": sub})
        assert r.status_code == 201, r.text
        assert r.json()["subtype"] == sub


def test_general_is_valid_for_every_type(alice):
    for t in ("current", "savings", "loan"):
        r = alice.post("/api/accounts", json={"name": t, "type": t, "subtype": "general"})
        assert r.status_code == 201
        assert r.json()["subtype"] == "general"


# ── Cross-type rejection ──────────────────────────────────────────────────────

def test_mortgage_subtype_rejected_for_current_account(alice):
    r = alice.post("/api/accounts", json={
        "name": "Bad", "type": "current", "subtype": "mortgage",
    })
    assert r.status_code == 400


def test_cash_isa_subtype_rejected_for_loan_account(alice):
    r = alice.post("/api/accounts", json={
        "name": "Bad", "type": "loan", "subtype": "cash_isa",
    })
    assert r.status_code == 400


def test_unknown_subtype_rejected(alice):
    r = alice.post("/api/accounts", json={
        "name": "Bad", "type": "savings", "subtype": "premium_super_isa",
    })
    assert r.status_code == 400


# ── PATCH ─────────────────────────────────────────────────────────────────────

def test_update_subtype(alice):
    aid = alice.post("/api/accounts", json={
        "name": "Pot", "type": "savings", "subtype": "easy_access",
    }).json()["id"]
    r = alice.put(f"/api/accounts/{aid}", json={"subtype": "regular_saver"})
    assert r.status_code == 200
    assert r.json()["subtype"] == "regular_saver"


def test_patch_rejects_subtype_from_wrong_type(alice):
    aid = alice.post("/api/accounts", json={"name": "Curr", "type": "current"}).json()["id"]
    r = alice.put(f"/api/accounts/{aid}", json={"subtype": "mortgage"})
    assert r.status_code == 400
    # And the row was not silently mutated.
    acc = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    assert acc["subtype"] == "general"


def test_patch_without_subtype_leaves_subtype_unchanged(alice):
    aid = alice.post("/api/accounts", json={
        "name": "Pot", "type": "savings", "subtype": "cash_isa",
    }).json()["id"]
    alice.put(f"/api/accounts/{aid}", json={"name": "Renamed"})
    acc = next(a for a in alice.get("/api/accounts").json() if a["id"] == aid)
    assert acc["subtype"] == "cash_isa"
