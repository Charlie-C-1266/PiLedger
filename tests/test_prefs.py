"""
Tests for the per-user preferences endpoint (``/api/prefs``).

Theme and light/dark mode used to live here, but the React client owns those
client-side now, so the endpoint carries only ``base_currency`` — the server
still reports net-worth totals in it. Currency rescaling on a base change is
covered in ``test_currency.py``; here we pin the prefs contract itself: the
response shape, the auth gates, the default, that the retired theme fields are
now rejected, and cross-user isolation.
"""


# ── Defaults ──────────────────────────────────────────────────────────────────


def test_prefs_default_for_new_user(alice):
    r = alice.get("/api/prefs")
    assert r.status_code == 200
    assert r.json() == {"base_currency": "GBP"}


def test_get_prefs_requires_auth(client):
    assert client.get("/api/prefs").status_code == 401


def test_put_prefs_requires_auth(client):
    assert client.put("/api/prefs", json={"base_currency": "USD"}).status_code == 401


# ── Round-trip ────────────────────────────────────────────────────────────────


def test_set_base_currency(alice):
    r = alice.put("/api/prefs", json={"base_currency": "USD"})
    assert r.status_code == 200
    assert r.json() == {"base_currency": "USD"}
    # And it persists across a fresh GET.
    assert alice.get("/api/prefs").json()["base_currency"] == "USD"


def test_empty_patch_is_noop(alice):
    alice.put("/api/prefs", json={"base_currency": "EUR"})
    alice.put("/api/prefs", json={})
    assert alice.get("/api/prefs").json() == {"base_currency": "EUR"}


# ── Validation ────────────────────────────────────────────────────────────────


def test_invalid_base_currency_rejected(alice):
    assert alice.put("/api/prefs", json={"base_currency": "XYZ"}).status_code == 400


def test_retired_theme_field_rejected(alice):
    # `theme` is no longer part of the prefs contract. _In schemas use
    # extra="forbid", so the removed field now reads as an unknown key (400).
    assert alice.put("/api/prefs", json={"theme": "indigo"}).status_code == 400


def test_retired_dark_mode_field_rejected(alice):
    assert alice.put("/api/prefs", json={"dark_mode": True}).status_code == 400


def test_extra_field_rejected(alice):
    r = alice.put("/api/prefs", json={"base_currency": "GBP", "wat": 1})
    assert r.status_code == 400


# ── Cross-user isolation ──────────────────────────────────────────────────────


def test_alice_prefs_do_not_leak_to_bob(alice, bob):
    alice.put("/api/prefs", json={"base_currency": "USD"})
    # bob is a separate user — should still see the default.
    assert bob.get("/api/prefs").json() == {"base_currency": "GBP"}
