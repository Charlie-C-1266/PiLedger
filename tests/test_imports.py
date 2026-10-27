"""CSV transaction import (POST /api/transactions/import/preview and /commit).

Preview parses a CSV and suggests a column mapping; commit re-parses with a
confirmed mapping and inserts transactions, deduping on `import_hash` and
collecting per-row errors instead of failing the whole import.
"""

from datetime import date, timedelta

import pytest


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
    assert body == {"imported": 2, "matched": 0, "skipped_duplicates": 0, "errors": []}

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
    assert first == {"imported": 2, "matched": 0, "skipped_duplicates": 0, "errors": []}

    second = alice.post("/api/transactions/import/commit", json=payload).json()
    assert second == {
        "imported": 0,
        "matched": 0,
        "skipped_duplicates": 2,
        "errors": [],
    }

    # Balance must not double-count the skipped duplicates.
    balance = alice.get("/api/accounts").json()[0]["current_balance"]
    assert balance == 1987.5
    assert len(alice.get("/api/transactions").json()) == 2


_FARES_MAPPING = {"date": "date", "amount": "amount", "merchant": "description"}


def test_commit_keeps_identical_same_day_rows_in_one_csv(alice):
    """Two genuinely distinct same-day, same-amount, same-merchant rows both import."""
    account_id = _make_account(alice)
    csv_text = (
        "date,description,amount\n"
        "2026-01-15,TFL TRAVEL,-3.20\n"
        "2026-01-15,TFL TRAVEL,-3.20\n"
    )
    payload = {
        "csv_text": csv_text,
        "account_id": account_id,
        "mapping": _FARES_MAPPING,
    }
    first = alice.post("/api/transactions/import/commit", json=payload).json()
    assert first == {"imported": 2, "matched": 0, "skipped_duplicates": 0, "errors": []}
    assert len(alice.get("/api/transactions").json()) == 2
    assert alice.get("/api/accounts").json()[0]["current_balance"] == -6.4

    # Re-importing the same export still dedups both rows.
    second = alice.post("/api/transactions/import/commit", json=payload).json()
    assert second == {
        "imported": 0,
        "matched": 0,
        "skipped_duplicates": 2,
        "errors": [],
    }
    assert alice.get("/api/accounts").json()[0]["current_balance"] == -6.4


def test_commit_overlapping_export_dedups_repeated_rows_by_occurrence(alice):
    """An overlapping export with fewer repeats only imports the extra ones."""
    account_id = _make_account(alice)
    one = "date,description,amount\n2026-01-15,TFL TRAVEL,-3.20\n"
    two = one + "2026-01-15,TFL TRAVEL,-3.20\n"
    url = "/api/transactions/import/commit"

    def run(csv_text):
        return alice.post(
            url,
            json={
                "csv_text": csv_text,
                "account_id": account_id,
                "mapping": _FARES_MAPPING,
            },
        ).json()

    assert run(one)["imported"] == 1
    assert run(two) == {
        "imported": 1,
        "matched": 0,
        "skipped_duplicates": 1,
        "errors": [],
    }
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
    assert body == {"imported": 2, "matched": 0, "skipped_duplicates": 0, "errors": []}
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
    assert body == {"imported": 1, "matched": 0, "skipped_duplicates": 0, "errors": []}
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


# ── Matching payments a schedule already posted (P7 / D9) ───────────────────

_MAPPING = {"date": "Date", "amount": "Amount", "merchant": "Description"}


def _today_minus(days=0):
    return (date.today() - timedelta(days=days)).isoformat()


def _posted_netflix(client, account_id):
    """A weekly £9.99 Netflix item that posts itself, posted for today (its
    only due date since auto-post was switched on). Returns its transaction."""
    r = client.post(
        "/api/subscriptions",
        json={
            "name": "Netflix",
            "amount": 9.99,
            "category": "Entertainment",
            "frequency": "weekly",
            "start_date": _today_minus(7),
            "account_id": account_id,
            "auto_post": True,
        },
    )
    assert r.status_code == 201, r.text
    assert client.post("/api/subscriptions/post-due").json() == {"posted": 1}
    (txn,) = client.get(f"/api/transactions?account={account_id}").json()
    assert txn["subscription_id"] == r.json()["id"]
    return txn


def _bank_csv():
    # The bank settled Netflix a day after the due date, under its own name.
    return (
        "Date,Amount,Description\n"
        f"{_today_minus(1)},-9.99,NETFLIX.COM\n"
        f"{_today_minus(1)},-3.50,Coffee Shop\n"
    )


def _funded_account(client, name="Current"):
    account_id = _make_account(client, name)
    client.post(f"/api/accounts/{account_id}/balance", json={"balance": 100.0})
    return account_id


def _balance(client, account_id):
    (acct,) = [a for a in client.get("/api/accounts").json() if a["id"] == account_id]
    return acct["current_balance"]


def _account_txns(client, account_id):
    return client.get(f"/api/transactions?account={account_id}").json()


def _match_preview(client, account_id, csv_text=None):
    return client.post(
        "/api/transactions/import/preview",
        json={
            "csv_text": csv_text or _bank_csv(),
            "account_id": account_id,
            "mapping": _MAPPING,
        },
    )


def _commit(client, account_id, csv_text=None, **extra):
    r = client.post(
        "/api/transactions/import/commit",
        json={
            "csv_text": csv_text or _bank_csv(),
            "account_id": account_id,
            "mapping": _MAPPING,
            **extra,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_preview_without_an_account_lists_no_matches(alice):
    account_id = _funded_account(alice)
    _posted_netflix(alice, account_id)
    r = alice.post("/api/transactions/import/preview", json={"csv_text": _bank_csv()})
    assert r.json()["matches"] == []


@pytest.mark.parametrize(
    "extra", [{"account_id": 1}, {"mapping": _MAPPING}], ids=["account", "mapping"]
)
def test_preview_needs_account_and_mapping_together(alice, extra):
    r = alice.post(
        "/api/transactions/import/preview", json={"csv_text": _bank_csv(), **extra}
    )
    assert r.status_code == 400


def test_preview_lists_rows_that_match_a_scheduled_posting(alice):
    account_id = _funded_account(alice)
    posted = _posted_netflix(alice, account_id)

    r = _match_preview(alice, account_id)
    assert r.status_code == 200, r.text
    assert r.json()["matches"] == [
        {
            "row": 1,
            "date": _today_minus(1),
            "merchant": "NETFLIX.COM",
            "amount": -9.99,
            "match": {
                "transaction_id": posted["id"],
                "name": "Netflix",
                "date": _today_minus(0),
            },
        }
    ]


def test_preview_does_not_match_a_different_amount(alice):
    account_id = _funded_account(alice)
    _posted_netflix(alice, account_id)
    csv_text = f"Date,Amount,Description\n{_today_minus(1)},-10.99,NETFLIX.COM\n"
    assert _match_preview(alice, account_id, csv_text).json()["matches"] == []


def test_commit_claims_the_match_instead_of_adding_a_row(alice):
    account_id = _funded_account(alice)
    posted = _posted_netflix(alice, account_id)
    before = _balance(alice, account_id)

    body = _commit(alice, account_id, match_choices=[{"row": 1, "claim": True}])
    assert body == {"imported": 1, "matched": 1, "skipped_duplicates": 0, "errors": []}

    txns = _account_txns(alice, account_id)
    assert len(txns) == 2  # the claimed Netflix and the new coffee, no duplicate
    (netflix,) = [t for t in txns if t["id"] == posted["id"]]
    assert netflix["merchant"] == "NETFLIX.COM"
    assert netflix["occurred_at"] == f"{_today_minus(1)}T00:00:00Z"
    assert netflix["amount"] == -9.99
    assert netflix["subscription_id"] == posted["subscription_id"]
    # Only the coffee moved the balance.
    assert _balance(alice, account_id) == pytest.approx(before - 3.50)


def test_commit_claims_by_default_when_no_choice_is_sent(alice):
    account_id = _funded_account(alice)
    _posted_netflix(alice, account_id)
    body = _commit(alice, account_id)
    assert (body["imported"], body["matched"]) == (1, 1)
    assert len(_account_txns(alice, account_id)) == 2


def test_commit_with_the_match_switched_off_adds_a_new_row(alice):
    account_id = _funded_account(alice)
    posted = _posted_netflix(alice, account_id)
    before = _balance(alice, account_id)

    body = _commit(alice, account_id, match_choices=[{"row": 1, "claim": False}])
    assert body == {"imported": 2, "matched": 0, "skipped_duplicates": 0, "errors": []}

    txns = _account_txns(alice, account_id)
    assert len(txns) == 3
    (kept,) = [t for t in txns if t["id"] == posted["id"]]
    assert kept["merchant"] == "Netflix"  # the posted one is left alone
    assert _balance(alice, account_id) == pytest.approx(before - 9.99 - 3.50)


def test_reimporting_after_a_claim_is_idempotent(alice):
    account_id = _funded_account(alice)
    _posted_netflix(alice, account_id)
    _commit(alice, account_id)
    after_first = _balance(alice, account_id)

    assert _match_preview(alice, account_id).json()["matches"] == []
    body = _commit(alice, account_id)
    assert body == {"imported": 0, "matched": 0, "skipped_duplicates": 2, "errors": []}
    assert len(_account_txns(alice, account_id)) == 2
    assert _balance(alice, account_id) == after_first


def test_matching_is_per_user(alice, bob):
    alice_acct = _funded_account(alice)
    posted = _posted_netflix(alice, alice_acct)
    bob_acct = _funded_account(bob)

    # Bob can't preview against Alice's account...
    assert _match_preview(bob, alice_acct).status_code == 404
    # ...and his own import of the same statement never touches her posting.
    assert _match_preview(bob, bob_acct).json()["matches"] == []
    body = _commit(bob, bob_acct)
    assert (body["imported"], body["matched"]) == (2, 0)
    (alices,) = _account_txns(alice, alice_acct)
    assert alices["merchant"] == "Netflix"
    assert alices["id"] == posted["id"]
