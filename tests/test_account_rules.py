"""The shared account rules in ``services/accounts`` and the domain errors they
raise (``services/errors``), which ``app.py`` answers as 404 / 400."""

import pytest

from db import db
from services.accounts import require_open_account, require_transfer_accounts
from services.errors import NotFoundError, RuleError


def _account(client, name: str, **extra) -> int:
    body = {"name": name, "type": "current", **extra}
    return client.post("/api/accounts", json=body).json()["id"]


def _uid(client) -> int:
    return client.get("/api/auth/me").json()["id"]


def test_a_transfer_returns_both_rows_in_order(alice):
    a, b = _account(alice, "A"), _account(alice, "B")
    with db() as conn:
        src, dst = require_transfer_accounts(conn, _uid(alice), a, b, open_only=True)
    assert (src["id"], src["name"], dst["id"], dst["name"]) == (a, "A", b, "B")


def test_a_transfer_needs_two_different_accounts(alice):
    a = _account(alice, "A")
    with db() as conn, pytest.raises(RuleError, match="same account"):
        require_transfer_accounts(conn, _uid(alice), a, a, open_only=True)


def test_a_transfer_needs_both_accounts_to_be_the_users(alice, bob):
    mine, theirs = _account(alice, "A"), _account(bob, "B")
    with db() as conn, pytest.raises(NotFoundError, match="Account not found"):
        require_transfer_accounts(conn, _uid(alice), mine, theirs, open_only=False)


def test_a_closed_end_matters_only_when_open_only(alice):
    a, b = _account(alice, "A"), _account(alice, "B", closed=True)
    with db() as conn:
        require_transfer_accounts(conn, _uid(alice), a, b, open_only=False)
        with pytest.raises(RuleError, match="Account is closed"):
            require_transfer_accounts(conn, _uid(alice), a, b, open_only=True)


def test_a_transfer_needs_one_currency(alice):
    a, b = _account(alice, "A"), _account(alice, "B", currency="EUR")
    with db() as conn, pytest.raises(RuleError, match="different currencies"):
        require_transfer_accounts(conn, _uid(alice), a, b, open_only=False)


def test_the_same_rule_answers_every_transfer_path(alice):
    """A manual transfer and a scheduled one being saved give the same answer
    for the same pair, because both go through require_transfer_accounts."""
    a, b = _account(alice, "A"), _account(alice, "B", currency="EUR")
    manual = alice.post(
        "/api/transfers",
        json={"from_account_id": a, "to_account_id": b, "amount": 10},
    )
    scheduled = alice.post(
        "/api/subscriptions",
        json={
            "name": "Move",
            "amount": 10,
            "frequency": "monthly",
            "start_date": "2026-01-01",
            "kind": "transfer",
            "account_id": a,
            "to_account_id": b,
        },
    )
    assert manual.status_code == scheduled.status_code == 400
    assert manual.json()["detail"] == scheduled.json()["detail"]


def test_domain_errors_reach_the_client_as_404_and_400(alice, bob):
    """app.py maps NotFoundError → 404 and RuleError → 400 with the message as
    detail, the same shape an HTTPException gives."""
    theirs = _account(bob, "Theirs")
    closed = _account(alice, "Closed", closed=True)
    missing = alice.post(
        "/api/transactions",
        json={"account_id": theirs, "amount": -1, "merchant": "x"},
    )
    assert (missing.status_code, missing.json()) == (
        404,
        {"detail": "Account not found"},
    )
    shut = alice.post(
        "/api/transactions",
        json={"account_id": closed, "amount": -1, "merchant": "x"},
    )
    assert (shut.status_code, shut.json()) == (400, {"detail": "Account is closed"})


def test_require_open_account_raises_domain_errors(alice, bob):
    theirs = _account(bob, "Theirs")
    closed = _account(alice, "Closed", closed=True)
    with db() as conn:
        with pytest.raises(NotFoundError):
            require_open_account(conn, theirs, _uid(alice))
        with pytest.raises(RuleError):
            require_open_account(conn, closed, _uid(alice))
