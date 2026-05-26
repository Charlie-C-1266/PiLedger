"""Tests for multi-currency support (per-account currency, base currency,
manual FX rates, and FX-aware totals)."""


# ── Account currency ──────────────────────────────────────────────────────────


def test_account_defaults_to_gbp(alice):
    body = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()
    assert body["currency"] == "GBP"


def test_account_accepts_other_currency(alice):
    body = alice.post(
        "/api/accounts",
        json={"name": "Chase", "type": "current", "currency": "USD"},
    ).json()
    assert body["currency"] == "USD"
    # And it persists.
    listed = alice.get("/api/accounts").json()
    assert next(a["currency"] for a in listed if a["id"] == body["id"]) == "USD"


def test_unsupported_currency_rejected(alice):
    r = alice.post(
        "/api/accounts",
        json={"name": "X", "type": "current", "currency": "XYZ"},
    )
    assert r.status_code == 400


def test_account_patch_can_change_currency(alice):
    aid = alice.post("/api/accounts", json={"name": "X", "type": "current"}).json()[
        "id"
    ]
    alice.put(f"/api/accounts/{aid}", json={"currency": "EUR"})
    listed = alice.get("/api/accounts").json()
    assert next(a["currency"] for a in listed if a["id"] == aid) == "EUR"


# ── Base currency ─────────────────────────────────────────────────────────────


def test_base_currency_default(alice):
    assert alice.get("/api/prefs").json()["base_currency"] == "GBP"


def test_base_currency_can_be_changed(alice):
    r = alice.put("/api/prefs", json={"base_currency": "USD"})
    assert r.status_code == 200
    assert r.json()["base_currency"] == "USD"
    assert alice.get("/api/prefs").json()["base_currency"] == "USD"


def test_invalid_base_currency_rejected(alice):
    assert alice.put("/api/prefs", json={"base_currency": "XYZ"}).status_code == 400


# ── Rates table ───────────────────────────────────────────────────────────────


def test_rates_empty_by_default(alice):
    body = alice.get("/api/rates").json()
    assert body == {"base_currency": "GBP", "rates": []}


def test_rates_round_trip(alice):
    alice.put(
        "/api/rates",
        json={
            "rates": [
                {"currency": "USD", "rate": 0.78},
                {"currency": "EUR", "rate": 0.85},
            ]
        },
    )
    body = alice.get("/api/rates").json()
    assert body["base_currency"] == "GBP"
    by_cur = {r["currency"]: r["rate"] for r in body["rates"]}
    assert by_cur == {"USD": 0.78, "EUR": 0.85}


def test_rates_replace_semantics(alice):
    # PUT replaces the whole table — entries not in the payload are dropped.
    alice.put(
        "/api/rates",
        json={
            "rates": [
                {"currency": "USD", "rate": 0.78},
                {"currency": "EUR", "rate": 0.85},
            ]
        },
    )
    alice.put("/api/rates", json={"rates": [{"currency": "USD", "rate": 0.80}]})
    body = alice.get("/api/rates").json()
    assert len(body["rates"]) == 1
    assert body["rates"][0]["currency"] == "USD"
    assert body["rates"][0]["rate"] == 0.80


def test_rate_against_base_rejected(alice):
    # Base currency is implicitly 1.0 — storing it as a row creates ambiguity.
    r = alice.put("/api/rates", json={"rates": [{"currency": "GBP", "rate": 1.0}]})
    assert r.status_code == 400


def test_duplicate_rate_rejected(alice):
    r = alice.put(
        "/api/rates",
        json={
            "rates": [
                {"currency": "USD", "rate": 0.78},
                {"currency": "USD", "rate": 0.80},
            ]
        },
    )
    assert r.status_code == 400


def test_zero_rate_rejected(alice):
    r = alice.put("/api/rates", json={"rates": [{"currency": "USD", "rate": 0}]})
    assert r.status_code == 400


def test_rates_require_auth(client):
    assert client.get("/api/rates").status_code == 401
    assert client.put("/api/rates", json={"rates": []}).status_code == 401


def test_rates_user_isolation(alice, bob):
    alice.put("/api/rates", json={"rates": [{"currency": "USD", "rate": 0.78}]})
    assert bob.get("/api/rates").json()["rates"] == []


# ── FX-aware summary ──────────────────────────────────────────────────────────


def test_summary_converts_to_base_using_rates(alice):
    # GBP account + USD account, with USD → GBP at 0.5 for an easy assertion.
    gbp = alice.post("/api/accounts", json={"name": "G", "type": "current"}).json()[
        "id"
    ]
    usd = alice.post(
        "/api/accounts",
        json={"name": "U", "type": "current", "currency": "USD"},
    ).json()["id"]
    alice.post(f"/api/accounts/{gbp}/balance", json={"balance": 100})
    alice.post(f"/api/accounts/{usd}/balance", json={"balance": 200})
    alice.put("/api/rates", json={"rates": [{"currency": "USD", "rate": 0.5}]})

    body = alice.get("/api/summary").json()
    # 100 GBP + (200 USD * 0.5) = 200 GBP equivalent
    assert body["total_current"] == 200.0
    assert body["total"] == 200.0
    assert body["base_currency"] == "GBP"
    assert body["missing_rates"] == []


def test_summary_flags_missing_rates(alice):
    alice.post(
        "/api/accounts",
        json={"name": "U", "type": "current", "currency": "USD"},
    )
    body = alice.get("/api/summary").json()
    assert body["missing_rates"] == ["USD"]


def test_summary_loans_subtract_in_base(alice):
    asset = alice.post("/api/accounts", json={"name": "A", "type": "current"}).json()[
        "id"
    ]
    loan = alice.post(
        "/api/accounts",
        json={"name": "L", "type": "loan", "currency": "EUR"},
    ).json()["id"]
    alice.post(f"/api/accounts/{asset}/balance", json={"balance": 1000})
    alice.post(f"/api/accounts/{loan}/balance", json={"balance": 500})
    alice.put("/api/rates", json={"rates": [{"currency": "EUR", "rate": 0.9}]})

    body = alice.get("/api/summary").json()
    # 1000 GBP asset minus (500 EUR * 0.9 = 450 GBP) liability
    assert body["total"] == 550.0
    assert body["total_loans"] == 450.0


# ── Base-currency change rescales rates ──────────────────────────────────────


def test_base_change_rescales_rates(alice):
    # Set up GBP base with USD→GBP=0.5 and EUR→GBP=0.9. Then switch base to USD.
    # In the new world:
    #   - GBP→USD should be 1/0.5 = 2.0
    #   - EUR→USD should be 0.9/0.5 = 1.8
    alice.put(
        "/api/rates",
        json={
            "rates": [
                {"currency": "USD", "rate": 0.5},
                {"currency": "EUR", "rate": 0.9},
            ]
        },
    )
    alice.put("/api/prefs", json={"base_currency": "USD"})
    body = alice.get("/api/rates").json()
    assert body["base_currency"] == "USD"
    by_cur = {r["currency"]: r["rate"] for r in body["rates"]}
    assert round(by_cur["GBP"], 4) == 2.0
    assert round(by_cur["EUR"], 4) == 1.8


def test_base_change_without_pivot_drops_rates(alice):
    # Switching to a base we have no rate for means we can't safely rescale.
    alice.put("/api/rates", json={"rates": [{"currency": "EUR", "rate": 0.9}]})
    alice.put("/api/prefs", json={"base_currency": "JPY"})
    body = alice.get("/api/rates").json()
    assert body["base_currency"] == "JPY"
    assert body["rates"] == []
