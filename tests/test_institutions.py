"""
Tests for the account `institution` field — who an account is held with.

The provider is stored as two columns: a catalogue slug (`institution`) and, for
the catch-all `'other'` slug only, a free-text label (`institution_name`). The
pair has to stay coherent through create *and* partial update, because a PUT can
supply either half on its own and the other has to come from the stored row.
"""


# ── Defaults / round-trip ─────────────────────────────────────────────────────


def test_institution_defaults_to_unrecorded(alice):
    body = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()
    assert body["institution"] is None
    assert body["institution_name"] is None


def test_known_institution_round_trips(alice):
    alice.post(
        "/api/accounts",
        json={"name": "Everyday", "type": "current", "institution": "chase"},
    )
    account = alice.get("/api/accounts").json()[0]
    assert account["institution"] == "chase"
    assert account["institution_name"] is None


def test_two_accounts_can_share_an_institution(alice):
    """The whole point: a current account and a credit card both at Chase."""
    for name, acc_type in (("Everyday", "current"), ("Chase Card", "credit")):
        alice.post(
            "/api/accounts",
            json={"name": name, "type": acc_type, "institution": "chase"},
        )
    accounts = alice.get("/api/accounts").json()
    assert [a["institution"] for a in accounts] == ["chase", "chase"]


def test_custom_institution_round_trips(alice):
    body = alice.post(
        "/api/accounts",
        json={
            "name": "Credit Union",
            "type": "savings",
            "institution": "other",
            "institution_name": "Glasgow Credit Union",
        },
    ).json()
    assert body["institution"] == "other"
    assert body["institution_name"] == "Glasgow Credit Union"


def test_custom_institution_name_is_trimmed(alice):
    body = alice.post(
        "/api/accounts",
        json={
            "name": "X",
            "type": "current",
            "institution": "other",
            "institution_name": "  Kroo  ",
        },
    ).json()
    assert body["institution_name"] == "Kroo"


# ── Create-time validation ────────────────────────────────────────────────────


def test_unknown_institution_slug_is_rejected(alice):
    r = alice.post(
        "/api/accounts",
        json={"name": "X", "type": "current", "institution": "gringotts"},
    )
    assert r.status_code == 400


def test_other_without_a_name_is_rejected(alice):
    """'other' carries no catalogue label, so an account created that way would
    render with a blank provider."""
    r = alice.post(
        "/api/accounts",
        json={"name": "X", "type": "current", "institution": "other"},
    )
    assert r.status_code == 400


def test_other_with_a_blank_name_is_rejected(alice):
    r = alice.post(
        "/api/accounts",
        json={
            "name": "X",
            "type": "current",
            "institution": "other",
            "institution_name": "   ",
        },
    )
    assert r.status_code == 400


def test_custom_name_on_a_known_slug_is_rejected(alice):
    """The catalogue owns the label for a known slug — accepting a second one
    would leave two sources of truth for what to display."""
    r = alice.post(
        "/api/accounts",
        json={
            "name": "X",
            "type": "current",
            "institution": "barclays",
            "institution_name": "Barclays Bank UK",
        },
    )
    assert r.status_code == 400


def test_custom_name_without_an_institution_is_rejected(alice):
    r = alice.post(
        "/api/accounts",
        json={"name": "X", "type": "current", "institution_name": "Chase"},
    )
    assert r.status_code == 400


def test_overlong_custom_name_is_rejected(alice):
    r = alice.post(
        "/api/accounts",
        json={
            "name": "X",
            "type": "current",
            "institution": "other",
            "institution_name": "z" * 61,
        },
    )
    assert r.status_code == 400


# ── Update ────────────────────────────────────────────────────────────────────


def _make(alice, **extra):
    return alice.post(
        "/api/accounts", json={"name": "X", "type": "current", **extra}
    ).json()["id"]


def test_institution_can_be_set_on_an_existing_account(alice):
    aid = _make(alice)
    body = alice.put(f"/api/accounts/{aid}", json={"institution": "monzo"}).json()
    assert body["institution"] == "monzo"


def test_institution_can_be_cleared(alice):
    """An explicit null clears the provider — unlike the other patchable fields,
    'no longer recorded' is a real edit here, not a no-op."""
    aid = _make(alice, institution="monzo")
    body = alice.put(f"/api/accounts/{aid}", json={"institution": None}).json()
    assert body["institution"] is None
    assert body["institution_name"] is None


def test_omitting_institution_leaves_it_untouched(alice):
    aid = _make(alice, institution="monzo")
    body = alice.put(f"/api/accounts/{aid}", json={"color": "#123456"}).json()
    assert body["institution"] == "monzo"


def test_switching_from_other_to_a_known_slug_drops_the_custom_name(alice):
    """Otherwise the stale label would outlive the slug that gave it meaning."""
    aid = _make(alice, institution="other", institution_name="Kroo")
    body = alice.put(
        f"/api/accounts/{aid}",
        json={"institution": "starling", "institution_name": None},
    ).json()
    assert body["institution"] == "starling"
    assert body["institution_name"] is None


def test_switching_to_other_requires_a_name(alice):
    aid = _make(alice, institution="starling")
    r = alice.put(f"/api/accounts/{aid}", json={"institution": "other"})
    assert r.status_code == 400


def test_custom_name_alone_is_checked_against_the_stored_slug(alice):
    """Patching only the label is valid when the row is already 'other' — the
    handler has to read the slug off the row to know that."""
    aid = _make(alice, institution="other", institution_name="Kroo")
    body = alice.put(
        f"/api/accounts/{aid}", json={"institution_name": "Kroo Bank"}
    ).json()
    assert body["institution_name"] == "Kroo Bank"


def test_custom_name_alone_is_rejected_on_a_known_slug(alice):
    aid = _make(alice, institution="starling")
    r = alice.put(f"/api/accounts/{aid}", json={"institution_name": "Starling UK"})
    assert r.status_code == 400


def test_unknown_slug_is_rejected_on_update(alice):
    aid = _make(alice)
    r = alice.put(f"/api/accounts/{aid}", json={"institution": "gringotts"})
    assert r.status_code == 400


def test_another_users_account_is_not_patchable(alice, bob):
    aid = _make(alice, institution="monzo")
    assert (
        bob.put(f"/api/accounts/{aid}", json={"institution": "chase"}).status_code
        == 404
    )
