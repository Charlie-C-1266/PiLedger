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
of duplicating them.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from constants import MAX_IMPORT_ROWS
from db import db, to_cents
from auth import require_auth
from schemas import (
    ImportCommitIn,
    ImportCommitOut,
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

router = APIRouter(tags=["imports"])

PREVIEW_ROWS = 20

# One parsed, insert-ready row: (amount_cents, occurred_at, merchant,
# category, note, import_hash).
_ParsedRow = tuple[int, str, str, str, str, str]


@router.post("/api/transactions/import/preview", response_model=ImportPreviewOut)
def preview_import(
    data: ImportPreviewIn, uid: int = Depends(require_auth)
) -> ImportPreviewOut:
    """Parse a CSV and return a sample of rows plus a suggested column mapping."""
    columns, rows = parse_csv(data.csv_text)
    if not columns:
        raise HTTPException(400, "CSV has no header row")
    if len(rows) > MAX_IMPORT_ROWS:
        raise HTTPException(
            400, f"CSV has {len(rows)} rows; the limit is {MAX_IMPORT_ROWS}"
        )
    return ImportPreviewOut(
        columns=columns,
        sample_rows=rows[:PREVIEW_ROWS],
        row_count=len(rows),
        suggested_mapping=suggest_mapping(columns),
    )


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
    row_hash = import_row_hash(
        account_id, validated.occurred_at, amount_cents, validated.merchant
    )
    return (
        amount_cents,
        validated.occurred_at,
        validated.merchant,
        validated.category,
        validated.note,
        row_hash,
    )


@router.post("/api/transactions/import/commit", response_model=ImportCommitOut)
def commit_import(
    data: ImportCommitIn, uid: int = Depends(require_auth)
) -> ImportCommitOut:
    """Re-parse the CSV with a confirmed mapping and insert one transaction per
    row, skipping rows that dedup against an existing import and collecting
    per-row errors rather than failing the whole import."""
    columns, rows = parse_csv(data.csv_text)
    if not columns:
        raise HTTPException(400, "CSV has no header row")
    if len(rows) > MAX_IMPORT_ROWS:
        raise HTTPException(
            400, f"CSV has {len(rows)} rows; the limit is {MAX_IMPORT_ROWS}"
        )

    try:
        idx = {
            field: columns.index(name)
            for field, name in data.mapping.model_dump(exclude_none=True).items()
        }
    except ValueError as e:
        raise HTTPException(
            400, f"Mapping references a column not in the CSV: {e}"
        ) from e

    parsed_rows: list[_ParsedRow] = []
    errors: list[ImportRowError] = []
    for i, row in enumerate(rows, start=1):
        try:
            parsed_rows.append(_parse_row(row, idx, data.account_id, data.date_format))
        except (ValidationError, ValueError, IndexError) as e:
            errors.append(ImportRowError(row=i, message=str(e)))

    imported = 0
    skipped = 0
    with db() as conn:
        require_open_account(conn, data.account_id, uid)
        for (
            amount_cents,
            occurred_at,
            merchant,
            category,
            note,
            row_hash,
        ) in parsed_rows:
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
        conn.commit()

    return ImportCommitOut(imported=imported, skipped_duplicates=skipped, errors=errors)
