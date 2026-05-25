"""
Tests for the per-user appearance preferences (theme + dark mode).

Added in 0.8.0 alongside the Settings modal. Defaults are olive + light;
users can pick from a small allowlist of themes. The endpoints round-trip
the value as JSON booleans even though SQLite stores dark_mode as 0/1.
"""


# ── Defaults ──────────────────────────────────────────────────────────────────

def test_prefs_default_for_new_user(alice):
    r = alice.get("/api/prefs")
    assert r.status_code == 200
    assert r.json() == {"theme": "olive", "dark_mode": False, "base_currency": "GBP"}


def test_get_prefs_requires_auth(client):
    assert client.get("/api/prefs").status_code == 401


def test_put_prefs_requires_auth(client):
    assert client.put("/api/prefs", json={"theme": "indigo"}).status_code == 401


# ── Round-trip ────────────────────────────────────────────────────────────────

def test_set_theme(alice):
    r = alice.put("/api/prefs", json={"theme": "indigo"})
    assert r.status_code == 200
    assert r.json()["theme"] == "indigo"
    # And it persists across a fresh GET.
    assert alice.get("/api/prefs").json()["theme"] == "indigo"


def test_set_dark_mode(alice):
    r = alice.put("/api/prefs", json={"dark_mode": True})
    assert r.status_code == 200
    assert r.json()["dark_mode"] is True
    assert alice.get("/api/prefs").json()["dark_mode"] is True


def test_set_both_at_once(alice):
    r = alice.put("/api/prefs", json={"theme": "rose", "dark_mode": True})
    assert r.json() == {"theme": "rose", "dark_mode": True, "base_currency": "GBP"}


def test_partial_patch_leaves_other_field(alice):
    alice.put("/api/prefs", json={"theme": "slate", "dark_mode": True})
    # Patching just one should not reset the other.
    alice.put("/api/prefs", json={"dark_mode": False})
    body = alice.get("/api/prefs").json()
    assert body == {"theme": "slate", "dark_mode": False, "base_currency": "GBP"}


def test_empty_patch_is_noop(alice):
    alice.put("/api/prefs", json={"theme": "rose"})
    alice.put("/api/prefs", json={})
    assert alice.get("/api/prefs").json() == {"theme": "rose", "dark_mode": False, "base_currency": "GBP"}


# ── Validation ────────────────────────────────────────────────────────────────

def test_invalid_theme_rejected(alice):
    assert alice.put("/api/prefs", json={"theme": "purple"}).status_code == 400


def test_extra_field_rejected(alice):
    # _In schemas use extra="forbid", so unknown keys are 400.
    assert alice.put("/api/prefs", json={"theme": "olive", "wat": 1}).status_code == 400


def test_every_allowed_theme_accepted(alice):
    for t in (
        "olive", "indigo", "slate", "rose",
        "emerald", "teal", "sky", "amber", "crimson", "violet",
    ):
        r = alice.put("/api/prefs", json={"theme": t})
        assert r.status_code == 200, t
        assert r.json()["theme"] == t


# ── Cross-user isolation ──────────────────────────────────────────────────────

def test_alice_prefs_do_not_leak_to_bob(alice, bob):
    alice.put("/api/prefs", json={"theme": "rose", "dark_mode": True})
    # bob is a separate user — should still see defaults.
    assert bob.get("/api/prefs").json() == {"theme": "olive", "dark_mode": False, "base_currency": "GBP"}


def test_bob_cannot_overwrite_alice_prefs(alice, bob):
    alice.put("/api/prefs", json={"theme": "rose"})
    bob.put("/api/prefs", json={"theme": "slate"})
    assert alice.get("/api/prefs").json()["theme"] == "rose"
    assert bob.get("/api/prefs").json()["theme"]   == "slate"
