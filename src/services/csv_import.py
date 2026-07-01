"""Pure CSV-parsing helpers for transaction import.

Kept free of DB access so the parsing/validation logic is unit-testable
without spinning up the app; ``routers/imports.py`` wraps this with the
account-ownership check, balance adjustment, and dedup insert.
"""

import csv
import hashlib
import io
from datetime import datetime, timezone

from constants import IMPORT_DATE_FORMATS, ISO_FMT

# Header names matched (case-insensitively) when guessing a column mapping.
# Every CSV column is checked against every field's hint tuple; the first
# match wins. This is a starting point only — the frontend lets the user
# change it before committing.
_HEADER_HINTS: dict[str, tuple[str, ...]] = {
    "date": ("date", "posted", "transaction date", "posting date"),
    "amount": ("amount", "value"),
    "debit": ("debit", "withdrawal", "money out"),
    "credit": ("credit", "deposit", "money in"),
    "merchant": ("description", "merchant", "payee", "narrative"),
    "category": ("category",),
    "note": ("note", "memo", "notes"),
}


def parse_csv(text: str) -> tuple[list[str], list[list[str]]]:
    """Split `text` into (header row, every following row) as raw string cells."""
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return [], []
    return rows[0], rows[1:]


def suggest_mapping(columns: list[str]) -> dict[str, str | None]:
    """Best-effort column-name guess for each known field; `None` where no
    header matches."""
    lowered = {col: col.strip().lower() for col in columns}
    return {
        field: next((col for col, low in lowered.items() if low in hints), None)
        for field, hints in _HEADER_HINTS.items()
    }


def parse_amount(raw: str) -> float:
    """Parse a money string into a plain float.

    Handles the formatting quirks common to bank/card CSV exports: currency
    symbols, thousands-separator commas, and parenthesised negatives
    (``(12.50)`` == ``-12.50``, the standard accounting convention for a debit).
    """
    s = raw.strip()
    if not s:
        raise ValueError("empty amount")
    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative = True
        s = s[1:-1]
    for symbol in ("£", "$", "€", ","):
        s = s.replace(symbol, "")
    s = s.strip()
    if s.startswith("-"):
        negative = True
        s = s[1:]
    elif s.startswith("+"):
        s = s[1:]
    value = float(s)
    return -value if negative else value


def parse_occurred_at(raw: str, date_format: str) -> str:
    """Parse a date string per the chosen `date_format` into the canonical
    `ISO_FMT` UTC timestamp (midnight, since bank exports are date-only)."""
    fmt = IMPORT_DATE_FORMATS[date_format]
    dt = datetime.strptime(raw.strip(), fmt).replace(tzinfo=timezone.utc)
    return dt.strftime(ISO_FMT)


def import_row_hash(
    account_id: int, occurred_at: str, amount_cents: int, merchant: str
) -> str:
    """Stable hash identifying a transaction for dedup across re-imports of
    the same (or an overlapping) export."""
    key = f"{account_id}|{occurred_at}|{amount_cents}|{merchant}"
    return hashlib.sha256(key.encode()).hexdigest()
