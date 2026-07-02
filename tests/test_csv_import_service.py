"""Unit tests for the pure CSV-parsing helpers in services/csv_import.py.

No DB or app fixture needed — these are plain functions.
"""

import pytest

from services.csv_import import (
    import_row_hash,
    parse_amount,
    parse_csv,
    parse_occurred_at,
    suggest_mapping,
)


def test_parse_csv_splits_header_and_rows():
    columns, rows = parse_csv("Date,Amount\n2026-01-01,10.00\n2026-01-02,20.00\n")
    assert columns == ["Date", "Amount"]
    assert rows == [["2026-01-01", "10.00"], ["2026-01-02", "20.00"]]


def test_parse_csv_empty_string_returns_nothing():
    assert parse_csv("") == ([], [])


def test_parse_csv_header_only_returns_no_rows():
    columns, rows = parse_csv("Date,Amount\n")
    assert columns == ["Date", "Amount"]
    assert rows == []


@pytest.mark.parametrize(
    "columns,expected",
    [
        (
            ["Date", "Amount", "Description"],
            {"date": "Date", "amount": "Amount", "merchant": "Description"},
        ),
        (
            ["Posting Date", "Value", "Merchant"],
            {"date": "Posting Date", "amount": "Value", "merchant": "Merchant"},
        ),
        (["Debit", "Credit"], {"debit": "Debit", "credit": "Credit"}),
    ],
)
def test_suggest_mapping_matches_known_headers(columns, expected):
    suggestion = suggest_mapping(columns)
    for field, column in expected.items():
        assert suggestion[field] == column


def test_suggest_mapping_leaves_unknown_field_as_none():
    suggestion = suggest_mapping(["Foo", "Bar"])
    assert suggestion["date"] is None
    assert suggestion["amount"] is None


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("12.50", 12.50),
        ("-12.50", -12.50),
        ("+12.50", 12.50),
        ("(12.50)", -12.50),
        ("£1,234.50", 1234.50),
        ("$1,234.50", 1234.50),
        ("1,234.50", 1234.50),
        ("  10.00  ", 10.00),
    ],
)
def test_parse_amount_handles_common_formats(raw, expected):
    assert parse_amount(raw) == expected


def test_parse_amount_rejects_empty_string():
    with pytest.raises(ValueError):
        parse_amount("")


def test_parse_amount_rejects_non_numeric():
    with pytest.raises(ValueError):
        parse_amount("not a number")


def test_parse_occurred_at_iso_format():
    assert parse_occurred_at("2026-01-31", "iso") == "2026-01-31T00:00:00Z"


def test_parse_occurred_at_dmy_format():
    assert parse_occurred_at("31/01/2026", "dmy") == "2026-01-31T00:00:00Z"


def test_parse_occurred_at_mdy_format():
    assert parse_occurred_at("01/31/2026", "mdy") == "2026-01-31T00:00:00Z"


def test_parse_occurred_at_rejects_mismatched_format():
    with pytest.raises(ValueError):
        parse_occurred_at("31/01/2026", "iso")


def test_import_row_hash_is_stable_for_same_inputs():
    a = import_row_hash(1, "2026-01-01T00:00:00Z", -1250, "Coffee Shop")
    b = import_row_hash(1, "2026-01-01T00:00:00Z", -1250, "Coffee Shop")
    assert a == b


def test_import_row_hash_differs_for_different_inputs():
    a = import_row_hash(1, "2026-01-01T00:00:00Z", -1250, "Coffee Shop")
    b = import_row_hash(1, "2026-01-01T00:00:00Z", -1251, "Coffee Shop")
    assert a != b
