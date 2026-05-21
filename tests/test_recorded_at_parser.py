"""Coverage for the four branches of BalanceIn._normalise_recorded_at.

The schema accepts canonical ``Z`` form, lenient ``+00:00`` form, naive
ISO without a timezone (assumed UTC), and any other ISO offset (converted
to UTC) — and rejects everything else. Previously only the canonical
form was exercised; the lenient + offset-conversion paths are exactly
the kind of thing that breaks on an edge timezone bug.
"""


def _setup(alice):
    return alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()["id"]


def _only_entry(alice, aid):
    rows = alice.get(f"/api/accounts/{aid}/history?days=36500").json()
    assert len(rows) == 1, rows
    return rows[0]


def test_canonical_z_form_round_trips(alice):
    aid = _setup(alice)
    r = alice.post(f"/api/accounts/{aid}/balance", json={
        "balance": 100.0,
        "recorded_at": "2025-01-15T12:00:00Z",
    })
    assert r.status_code == 200
    assert _only_entry(alice, aid)["recorded_at"] == "2025-01-15T12:00:00Z"


def test_lenient_plus_zero_offset_normalised_to_z(alice):
    """ISO-8601 with explicit +00:00 should be re-emitted in canonical Z form."""
    aid = _setup(alice)
    alice.post(f"/api/accounts/{aid}/balance", json={
        "balance": 100.0,
        "recorded_at": "2025-01-15T12:00:00+00:00",
    })
    assert _only_entry(alice, aid)["recorded_at"] == "2025-01-15T12:00:00Z"


def test_naive_iso_assumed_utc(alice):
    """No tz suffix at all → schema tags it UTC and re-emits canonical."""
    aid = _setup(alice)
    alice.post(f"/api/accounts/{aid}/balance", json={
        "balance": 100.0,
        "recorded_at": "2025-01-15T12:00:00",
    })
    assert _only_entry(alice, aid)["recorded_at"] == "2025-01-15T12:00:00Z"


def test_non_utc_offset_converted_to_utc(alice):
    """+05:00 means UTC was 5 hours earlier. 12:00+05:00 == 07:00Z."""
    aid = _setup(alice)
    alice.post(f"/api/accounts/{aid}/balance", json={
        "balance": 100.0,
        "recorded_at": "2025-01-15T12:00:00+05:00",
    })
    assert _only_entry(alice, aid)["recorded_at"] == "2025-01-15T07:00:00Z"


def test_negative_offset_converted_to_utc(alice):
    """-08:00 (Pacific) means UTC is 8 hours later. 12:00-08:00 == 20:00Z."""
    aid = _setup(alice)
    alice.post(f"/api/accounts/{aid}/balance", json={
        "balance": 100.0,
        "recorded_at": "2025-01-15T12:00:00-08:00",
    })
    assert _only_entry(alice, aid)["recorded_at"] == "2025-01-15T20:00:00Z"


def test_garbage_recorded_at_rejected(alice):
    aid = _setup(alice)
    r = alice.post(f"/api/accounts/{aid}/balance", json={
        "balance": 100.0,
        "recorded_at": "not a date",
    })
    assert r.status_code == 400


def test_empty_recorded_at_rejected(alice):
    """Empty string isn't a valid ISO datetime — should 400, not silently
    fall through and store an empty timestamp."""
    aid = _setup(alice)
    r = alice.post(f"/api/accounts/{aid}/balance", json={
        "balance": 100.0,
        "recorded_at": "",
    })
    assert r.status_code == 400


def test_missing_recorded_at_defaults_to_now(alice):
    """The field is Optional; when omitted the server stamps utcnow_iso()."""
    aid = _setup(alice)
    alice.post(f"/api/accounts/{aid}/balance", json={"balance": 100.0})
    ts = _only_entry(alice, aid)["recorded_at"]
    # Should be a canonical-format string; we don't pin the value but we do
    # confirm the shape so a regression that stores None doesn't slip past.
    assert isinstance(ts, str) and ts.endswith("Z") and len(ts) == 20
