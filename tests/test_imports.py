"""CSV transaction import (POST /api/transactions/import/preview and /commit).

Preview parses a CSV and suggests a column mapping; commit re-parses with a
confirmed mapping and inserts transactions, deduping on `import_hash` and
collecting per-row errors instead of failing the whole import.
"""


def _make_account(client, name="Current", type_="current", currency="GBP"):
    return client.post(
        "/api/accounts", json={"name": name, "type": type_, "currency": currency}
    ).json()["id"]


_BASIC_CSV = (
    "Date,Amount,Description,Category\n"
    "2026-01-01,-12.50,Coffee Shop,Dining\n"
    "2026-01-02,2000.00,Salary,Salary\n"
)


def test_preview_requires_auth(client):
    r = client.post("/api/transactions/import/preview", json={"csv_text": _BASIC_CSV})
    assert r.status_code == 401


def test_commit_requires_auth(client):
    r = client.post(
        "/api/transactions/import/commit",
        json={
            "csv_text": _BASIC_CSV,
            "account_id": 1,
            "mapping": {"date": "Date", "amount": "Amount", "merchant": "Description"},
        },
    )
    assert r.status_code == 401


def test_preview_returns_columns_and_sample_rows(alice):
    r = alice.post("/api/transactions/import/preview", json={"csv_text": _BASIC_CSV})
    assert r.status_code == 200
    body = r.json()
    assert body["columns"] == ["Date", "Amount", "Description", "Category"]
    assert body["row_count"] == 2
    assert body["sample_rows"] == [
        ["2026-01-01", "-12.50", "Coffee Shop", "Dining"],
        ["2026-01-02", "2000.00", "Salary", "Salary"],
    ]


def test_preview_suggests_a_sensible_mapping(alice):
    r = alice.post("/api/transactions/import/preview", json={"csv_text": _BASIC_CSV})
    mapping = r.json()["suggested_mapping"]
    assert mapping["date"] == "Date"
    assert mapping["amount"] == "Amount"
    assert mapping["merchant"] == "Description"
    assert mapping["category"] == "Category"


def test_preview_rejects_empty_csv(alice):
    r = alice.post("/api/transactions/import/preview", json={"csv_text": ""})
    assert r.status_code == 400


def test_preview_rejects_header_only_csv(alice):
    r = alice.post(
        "/api/transactions/import/preview",
        json={"csv_text": "Date,Amount,Description\n"},
    )
    body = r.json()
    assert r.status_code == 200
    assert body["row_count"] == 0
    assert body["sample_rows"] == []


def test_commit_imports_rows_and_adjusts_balance(alice):
    account_id = _make_account(alice)
    r = alice.post(
        "/api/transactions/import/commit",
        json={
            "csv_text": _BASIC_CSV,
            "account_id": account_id,
            "mapping": {
                "date": "Date",
                "amount": "Amount",
                "merchant": "Description",
                "category": "Category",
            },
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body == {"imported": 2, "skipped_duplicates": 0, "errors": []}

    txns = alice.get("/api/transactions").json()
    assert len(txns) == 2
    amounts = sorted(t["amount"] for t in txns)
    assert amounts == [-12.5, 2000.0]

    balance = alice.get("/api/accounts").json()[0]["current_balance"]
    assert balance == 1987.5


def test_commit_reimporting_same_csv_is_deduped(alice):
    account_id = _make_account(alice)
    payload = {
        "csv_text": _BASIC_CSV,
        "account_id": account_id,
        "mapping": {
            "date": "Date",
            "amount": "Amount",
            "merchant": "Description",
            "category": "Category",
        },
    }
    first = alice.post("/api/transactions/import/commit", json=payload).json()
    assert first == {"imported": 2, "skipped_duplicates": 0, "errors": []}

    second = alice.post("/api/transactions/import/commit", json=payload).json()
    assert second == {"imported": 0, "skipped_duplicates": 2, "errors": []}

    # Balance must not double-count the skipped duplicates.
    balance = alice.get("/api/accounts").json()[0]["current_balance"]
    assert balance == 1987.5
    assert len(alice.get("/api/transactions").json()) == 2


def test_commit_debit_credit_split_columns(alice):
    account_id = _make_account(alice)
    csv_text = (
        "Date,Debit,Credit,Description\n"
        "2026-01-01,12.50,,Coffee Shop\n"
        "2026-01-02,,2000.00,Salary\n"
    )
    r = alice.post(
        "/api/transactions/import/commit",
        json={
            "csv_text": csv_text,
            "account_id": account_id,
            "mapping": {
                "date": "Date",
                "debit": "Debit",
                "credit": "Credit",
                "merchant": "Description",
            },
        },
    )
    body = r.json()
    assert body == {"imported": 2, "skipped_duplicates": 0, "errors": []}
    amounts = sorted(t["amount"] for t in alice.get("/api/transactions").json())
    assert amounts == [-12.5, 2000.0]


def test_commit_collects_row_errors_without_failing_whole_import(alice):
    account_id = _make_account(alice)
    csv_text = (
        "Date,Amount,Description\n"
        "2026-01-01,-12.50,Coffee Shop\n"
        "not-a-date,5.00,Bad Row\n"
        "2026-01-03,not-a-number,Another Bad Row\n"
    )
    r = alice.post(
        "/api/transactions/import/commit",
        json={
            "csv_text": csv_text,
            "account_id": account_id,
            "mapping": {"date": "Date", "amount": "Amount", "merchant": "Description"},
        },
    )
    body = r.json()
    assert body["imported"] == 1
    assert body["skipped_duplicates"] == 0
    assert [e["row"] for e in body["errors"]] == [2, 3]


def test_commit_rejects_mapping_with_unknown_column(alice):
    account_id = _make_account(alice)
    r = alice.post(
        "/api/transactions/import/commit",
        json={
            "csv_text": _BASIC_CSV,
            "account_id": account_id,
            "mapping": {
                "date": "Date",
                "amount": "Amount",
                "merchant": "Does Not Exist",
            },
        },
    )
    assert r.status_code == 400


def test_commit_rejects_mapping_with_both_amount_and_split_columns(alice):
    account_id = _make_account(alice)
    r = alice.post(
        "/api/transactions/import/commit",
        json={
            "csv_text": _BASIC_CSV,
            "account_id": account_id,
            "mapping": {
                "date": "Date",
                "amount": "Amount",
                "debit": "Amount",
                "credit": "Amount",
                "merchant": "Description",
            },
        },
    )
    assert r.status_code == 400


def test_commit_rejects_mapping_with_neither_amount_nor_split_columns(alice):
    account_id = _make_account(alice)
    r = alice.post(
        "/api/transactions/import/commit",
        json={
            "csv_text": _BASIC_CSV,
            "account_id": account_id,
            "mapping": {"date": "Date", "merchant": "Description"},
        },
    )
    assert r.status_code == 400


def test_commit_rejects_account_not_owned_by_user(alice, bob):
    account_id = _make_account(bob)
    r = alice.post(
        "/api/transactions/import/commit",
        json={
            "csv_text": _BASIC_CSV,
            "account_id": account_id,
            "mapping": {"date": "Date", "amount": "Amount", "merchant": "Description"},
        },
    )
    assert r.status_code == 404


def test_commit_respects_date_format_parameter(alice):
    account_id = _make_account(alice)
    csv_text = "Date,Amount,Description\n31/01/2026,-10.00,Coffee\n"
    r = alice.post(
        "/api/transactions/import/commit",
        json={
            "csv_text": csv_text,
            "account_id": account_id,
            "mapping": {"date": "Date", "amount": "Amount", "merchant": "Description"},
            "date_format": "dmy",
        },
    )
    body = r.json()
    assert body == {"imported": 1, "skipped_duplicates": 0, "errors": []}
    txn = alice.get("/api/transactions").json()[0]
    assert txn["occurred_at"].startswith("2026-01-31")


# ── Closed accounts (#171) ──────────────────────────────────────────────────


def test_commit_rejects_closed_account(alice):
    account_id = _make_account(alice)
    alice.put(f"/api/accounts/{account_id}", json={"closed": True})
    r = alice.post(
        "/api/transactions/import/commit",
        json={
            "csv_text": _BASIC_CSV,
            "account_id": account_id,
            "mapping": {"date": "Date", "amount": "Amount", "merchant": "Description"},
        },
    )
    assert r.status_code == 400
