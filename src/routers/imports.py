"""CSV transaction import.

Two-step, stateless flow: `POST /api/transactions/import/preview` parses a
CSV — sent as plain text in the JSON body, since the frontend reads the
picked file via `File.text()` rather than a multipart upload, keeping this
endpoint consistent with the rest of the JSON API and avoiding a new
multipart-parsing dependency — and returns a sample of rows plus a
best-effort column-mapping suggestion. The frontend lets the user edit that
mapping, then re-sends the same `csv_text` to
`POST /api/transactions/import/commit` along with the confirmed mapping.
There is no server-side upload session to expire or clean up; the whole
file is simply parsed twice.

Dedup relies on `transactions.import_hash`, a unique-if-not-null index
computed from (account_id, occurred_at, amount_cents, merchant), so
re-uploading an overlapping export skips the already-imported rows instead
of duplicating them. Identical rows within one export (e.g. two same-day
fares) are disambiguated by their occurrence count so both import.

A row may also be a payment a schedule already posted (``services/posting``).
Given the account and the confirmed mapping, the preview reports which rows
match one (``services/import_matching``) so the user can switch each match off;
commit re-runs the same matching, and a match left on claims the posted
transaction instead of inserting the payment a second time.
"""

import sqlite3
from collections import Counter
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from constants import ImportDateFormat, MAX_IMPORT_ROWS
from db import db, from_cents, to_cents
from auth import require_auth
from schemas import (
    ImportCommitIn,
    ImportCommitOut,
    ImportMappingIn,
    ImportMatch,
    ImportMatchedRow,
    ImportPreviewIn,
    ImportPreviewOut,
    ImportRowError,
    TransactionIn,
)
from services.accounts import adjust_account_balance, require_open_account
from services.csv_import import (
    import_row_hash,
    parse_amount,
    parse_csv,
    parse_occurred_at,
    suggest_mapping,
)
from services.import_matching import ImportRow, claim_transaction, find_matches
from services.posting import write_transaction

router = APIRouter(tags=["imports"])

PREVIEW_ROWS = 20

# One parsed, insert-ready row: (amount_cents, occurred_at, merchant,
# category, note).
_ParsedRow = tuple[int, str, str, str, str]

# A parsed row with its 1-based CSV row number and its dedup hash.
_HashedRow = tuple[int, _ParsedRow, str]


def _read_csv(csv_text: str) -> tuple[list[str], list[list[str]]]:
    """Split the CSV, rejecting one with no header or too many rows."""
    columns, rows = parse_csv(csv_text)
    if not columns:
        raise HTTPException(400, "CSV has no header row")
    if len(rows) > MAX_IMPORT_ROWS:
        raise HTTPException(
            400, f"CSV has {len(rows)} rows; the limit is {MAX_IMPORT_ROWS}"
        )
    return columns, rows


@router.post("/api/transactions/import/preview", response_model=ImportPreviewOut)
def preview_import(
    data: ImportPreviewIn, uid: int = Depends(require_auth)
) -> ImportPreviewOut:
    """Parse a CSV and return a sample of rows plus a suggested column mapping.

    Given an account and a mapping as well, also list the rows that match a
    transaction a schedule already posted to that account."""
    columns, rows = _read_csv(data.csv_text)
    matches: list[ImportMatchedRow] = []
    if data.account_id is not None and data.mapping is not None:
        hashed, _ = _parse_and_hash(
            rows,
            _column_index(columns, data.mapping),
            data.account_id,
            data.date_format,
        )
        with db() as conn:
            require_open_account(conn, data.account_id, uid)
            found = find_matches(conn, uid, data.account_id, _match_rows(hashed))
        for row_no, (amount_cents, occurred_at, merchant, _, _), _ in hashed:
            m = found.get(row_no)
            if m is None:
                continue
            matches.append(
                ImportMatchedRow(
                    row=row_no,
                    date=occurred_at[:10],
                    merchant=merchant,
                    amount=from_cents(amount_cents) or 0.0,
                    match=ImportMatch(
                        transaction_id=m.transaction_id,
                        name=m.name,
                        date=m.day.isoformat(),
                    ),
                )
            )
    return ImportPreviewOut(
        columns=columns,
        sample_rows=rows[:PREVIEW_ROWS],
        row_count=len(rows),
        suggested_mapping=suggest_mapping(columns),
        matches=matches,
    )


def _column_index(columns: list[str], mapping: ImportMappingIn) -> dict[str, int]:
    """Each mapped field's column position; 400 if a column isn't in the CSV."""
    try:
        return {
            field: columns.index(name)
            for field, name in mapping.model_dump(exclude_none=True).items()
        }
    except ValueError as e:
        raise HTTPException(
            400, f"Mapping references a column not in the CSV: {e}"
        ) from e


def _parse_row(
    row: list[str], idx: dict[str, int], account_id: int, date_format: str
) -> _ParsedRow:
    """Parse one CSV row, validated through `TransactionIn` so the same bounds
    (`MAX_MONEY`, merchant length, etc.) apply as manual transaction entry."""
    occurred_at = parse_occurred_at(row[idx["date"]], date_format)
    if "amount" in idx:
        amount = parse_amount(row[idx["amount"]])
    else:
        debit = parse_amount(row[idx["debit"]]) if row[idx["debit"]].strip() else 0.0
        credit = parse_amount(row[idx["credit"]]) if row[idx["credit"]].strip() else 0.0
        amount = credit - debit
    merchant = row[idx["merchant"]].strip()
    category = row[idx["category"]].strip() if "category" in idx else ""
    note = row[idx["note"]].strip() if "note" in idx else ""
    validated = TransactionIn(
        account_id=account_id,
        amount=amount,
        occurred_at=occurred_at,
        merchant=merchant,
        category=category,
        note=note,
    )
    amount_cents = to_cents(validated.amount)
    return (
        amount_cents,
        validated.occurred_at,
        validated.merchant,
        validated.category,
        validated.note,
    )


def _parse_and_hash(
    rows: list[list[str]],
    idx: dict[str, int],
    account_id: int,
    date_format: ImportDateFormat,
) -> tuple[list[_HashedRow], list[ImportRowError]]:
    """Parse every row, collecting per-row errors, and give each good row its
    dedup hash. Identical rows are numbered by occurrence so both import."""
    hashed: list[_HashedRow] = []
    errors: list[ImportRowError] = []
    seen: Counter[tuple[int, str, str]] = Counter()
    for i, row in enumerate(rows, start=1):
        try:
            parsed = _parse_row(row, idx, account_id, date_format)
        except (ValidationError, ValueError, IndexError) as e:
            errors.append(ImportRowError(row=i, message=str(e)))
            continue
        amount_cents, occurred_at, merchant, _, _ = parsed
        key = (amount_cents, occurred_at, merchant)
        row_hash = import_row_hash(
            account_id, occurred_at, amount_cents, merchant, seen[key]
        )
        seen[key] += 1
        hashed.append((i, parsed, row_hash))
    return hashed, errors


def _match_rows(hashed: list[_HashedRow]) -> list[ImportRow]:
    """The rows in the shape the matcher takes."""
    return [
        ImportRow(
            row=row_no,
            day=date.fromisoformat(parsed[1][:10]),
            amount_cents=parsed[0],
            import_hash=row_hash,
        )
        for row_no, parsed, row_hash in hashed
    ]


@router.post("/api/transactions/import/commit", response_model=ImportCommitOut)
def commit_import(
    data: ImportCommitIn, uid: int = Depends(require_auth)
) -> ImportCommitOut:
    """Re-parse the CSV with a confirmed mapping and insert one transaction per
    row, skipping rows that dedup against an existing import and collecting
    per-row errors rather than failing the whole import.

    A row that matches a transaction a schedule already posted claims it
    instead (unless the user switched that match off), so the payment isn't
    counted twice. Claims and inserts land in one SQLite transaction."""
    columns, rows = _read_csv(data.csv_text)
    idx = _column_index(columns, data.mapping)
    hashed, errors = _parse_and_hash(rows, idx, data.account_id, data.date_format)
    declined = {c.row for c in data.match_choices if not c.claim}

    imported = 0
    matched = 0
    skipped = 0
    with db() as conn:
        require_open_account(conn, data.account_id, uid)
        with write_transaction(conn):
            found = find_matches(conn, uid, data.account_id, _match_rows(hashed))
            for row_no, parsed, row_hash in hashed:
                amount_cents, occurred_at, merchant, category, note = parsed
                match = found.get(row_no)
                if match is not None and row_no not in declined:
                    try:
                        claimed = claim_transaction(
                            conn, uid, match, row_hash, occurred_at, merchant
                        )
                    except sqlite3.IntegrityError:
                        skipped += 1
                        continue
                    if claimed:
                        matched += 1
                        continue
                    # Claimed by another import meanwhile: insert as usual.
                try:
                    conn.execute(
                        "INSERT INTO transactions(user_id, account_id, amount_cents,"
                        " occurred_at, merchant, category, note, import_hash)"
                        " VALUES(?,?,?,?,?,?,?,?)",
                        (
                            uid,
                            data.account_id,
                            amount_cents,
                            occurred_at,
                            merchant,
                            category,
                            note,
                            row_hash,
                        ),
                    )
                except sqlite3.IntegrityError:
                    skipped += 1
                    continue
                adjust_account_balance(conn, data.account_id, amount_cents)
                imported += 1

    return ImportCommitOut(
        imported=imported, matched=matched, skipped_duplicates=skipped, errors=errors
    )
