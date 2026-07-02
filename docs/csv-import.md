# Importing Transactions from CSV

If your bank or card provider lets you export your statement as a CSV file, you can bring that history straight into PiLedger instead of typing each transaction in by hand. This guide walks through the import flow, the CSV layout it expects, and how to avoid the common gotchas (wrong date format, wrong sign on amounts).

## Starting an import

1. Click the **+** button (top of the app) and choose **Import CSV**.
2. Pick the **account** the transactions belong to, then choose your CSV file.
3. PiLedger reads the file and shows you a preview: its columns, a sample of the first few rows, and a best-effort guess at which column is which.
4. Confirm or correct the column mapping (see below), pick the date format your file uses, and click **Import**.
5. You'll see a summary: how many transactions were imported, how many were skipped as duplicates, and any rows that couldn't be parsed.

Nothing is uploaded to a third party — the file is parsed entirely by your own PiLedger server.

## What a column mapping needs

Every import needs these fields mapped to a column in your CSV:

| Field | Required | Notes |
|---|---|---|
| **Date** | Yes | The date the transaction happened. |
| **Amount** *or* **Debit + Credit** | Yes (one of the two) | See "Amount columns" below. |
| **Merchant / description** | Yes | Becomes the transaction's `merchant`. |
| **Category** | No | Matched against your existing categories if provided; left blank otherwise. |
| **Note** | No | Free text, stored as-is. |

### Amount columns: single column vs. split debit/credit

Bank exports come in two common shapes, and the import screen has a toggle for each:

- **Single amount column** — one column holds a signed value: negative for money out, positive for money in (e.g. `-12.50` for a coffee, `2000.00` for a salary payment).
- **Separate debit/credit columns** — one column for money out (`Debit`/`Withdrawal`), one for money in (`Credit`/`Deposit`); PiLedger computes `credit − debit` per row. Leave the other column blank on each row.

Whichever mode you pick, amounts can include a currency symbol (`£`, `$`, `€`), thousands-separator commas (`1,234.50`), and accounting-style parenthesised negatives (`(12.50)` is treated as `-12.50`).

### Date formats

Pick the format that matches your file from the dropdown — PiLedger doesn't try to guess a format per-row, so every date in the file must use the same one:

| Option | Example |
|---|---|
| `YYYY-MM-DD` (ISO) | `2026-01-31` |
| `DD/MM/YYYY` | `31/01/2026` |
| `MM/DD/YYYY` | `01/31/2026` |
| `DD-MM-YYYY` | `31-01-2026` |
| `MM-DD-YYYY` | `01-31-2026` |

Times aren't supported — every imported transaction is stamped at midnight UTC on the given date.

## Example CSV templates

Copy either of these into a `.csv` file (or open in a spreadsheet and export as CSV) to see the expected shape, then swap in your own rows.

**Single amount column:**

```csv
Date,Amount,Description,Category
2026-01-01,-12.50,Coffee Shop,Dining
2026-01-02,2000.00,Salary,Salary
2026-01-05,-45.00,Tesco,Groceries
```

**Separate debit/credit columns:**

```csv
Date,Debit,Credit,Description,Category
2026-01-01,12.50,,Coffee Shop,Dining
2026-01-02,,2000.00,Salary,Salary
2026-01-05,45.00,,Tesco,Groceries
```

Column names don't need to match these exactly — the mapping step lets you point at whatever headers your export actually uses (`Posting Date`, `Value`, `Payee`, and similar are all recognised by the suggested mapping, and anything else can be picked manually).

## Re-importing is safe

If you import the same statement twice — or two exports with overlapping date ranges — PiLedger recognises rows it's already imported (matched on account, date, amount, and merchant) and skips them rather than creating duplicates. The result summary reports these as **skipped duplicates**, separate from the newly imported count. Manually-entered transactions are never affected by this check.

## Limits and troubleshooting

- A single import is capped at 5,000 rows and roughly 5MB of CSV text — split a larger export into smaller date ranges if you hit the limit.
- A row that fails to parse (bad date, non-numeric amount, blank merchant) doesn't stop the rest of the import — it's listed in the result summary with its row number and the reason, and every other row still imports normally. Fix the source row and re-import just that file; already-imported rows are skipped automatically.
- If every row fails, the most common cause is the wrong date format selected, or the amount/debit/credit columns swapped — check the sample preview against your mapping before importing.
