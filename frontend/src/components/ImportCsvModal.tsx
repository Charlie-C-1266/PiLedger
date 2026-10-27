import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  previewImport,
  previewImportMatches,
  commitImport,
  type ImportRequest,
} from "../api/client";
import { useAccounts } from "../hooks/useAccounts";
import { useInvalidate } from "../hooks/useInvalidate";
import { useMoney } from "../privacy/useMoney";
import Modal from "./Modal";
import ModalActions from "./ModalActions";
import ToggleSwitch from "./ToggleSwitch";
import type {
  ImportDateFormat,
  ImportMatchedRow,
  ImportPreview,
  ImportResult,
} from "../types";
import addModalStyles from "./AddModal.module.css";
import styles from "./ImportCsvModal.module.css";

interface Props {
  onClose: () => void;
}

type Step = "upload" | "mapping" | "matches" | "result";
type AmountMode = "single" | "split";

const DATE_FORMATS: { key: ImportDateFormat; label: string }[] = [
  { key: "iso", label: "YYYY-MM-DD" },
  { key: "dmy", label: "DD/MM/YYYY" },
  { key: "mdy", label: "MM/DD/YYYY" },
  { key: "dmy_dash", label: "DD-MM-YYYY" },
  { key: "mdy_dash", label: "MM-DD-YYYY" },
];

/** "12 Nov" from a `YYYY-MM-DD` date, read as a local calendar day. */
function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default function ImportCsvModal({ onClose }: Props) {
  const { data: accounts } = useAccounts();
  // Closed accounts don't accept new imports.
  const openAccounts = (accounts ?? []).filter((a) => !a.closed);
  const inv = useInvalidate();

  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState("");
  const [accountId, setAccountId] = useState<number | "">("");
  const [dateFormat, setDateFormat] = useState<ImportDateFormat>("iso");

  // `accounts` resolves asynchronously, so a useState initializer would miss
  // it if this modal opens before the query settles — default to the first
  // open account once it's available, but only if the user hasn't picked one yet.
  useEffect(() => {
    if (accountId === "" && openAccounts.length > 0) {
      setAccountId(openAccounts[0].id);
    }
  }, [openAccounts, accountId]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [amountMode, setAmountMode] = useState<AmountMode>("single");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState("");
  // Rows matching a transaction a schedule already posted, and the ones the
  // user switched off (imported as new rows instead of claiming the match).
  const [matches, setMatches] = useState<ImportMatchedRow[]>([]);
  const [declined, setDeclined] = useState<Set<number>>(new Set());
  const { fmt } = useMoney();
  const currency = openAccounts.find((a) => a.id === accountId)?.currency ?? "GBP";

  const previewMutation = useMutation({
    mutationFn: previewImport,
    onSuccess: (data) => {
      setPreview(data);
      const suggested = data.suggested_mapping;
      setAmountMode(suggested.amount ? "single" : "split");
      setMapping({
        date: suggested.date ?? "",
        amount: suggested.amount ?? "",
        debit: suggested.debit ?? "",
        credit: suggested.credit ?? "",
        merchant: suggested.merchant ?? "",
        category: suggested.category ?? "",
        note: suggested.note ?? "",
      });
      setStep("mapping");
    },
  });

  const commitMutation = useMutation({
    mutationFn: commitImport,
    onSuccess: (data) => {
      setResult(data);
      inv.transactionChanged();
      setStep("result");
    },
  });

  // Before importing, ask which rows match a scheduled transaction. With none,
  // import straight away; otherwise let the user review each match first.
  const matchMutation = useMutation({
    mutationFn: previewImportMatches,
    onSuccess: (data, request) => {
      if (data.matches.length === 0) {
        commitMutation.mutate(request);
        return;
      }
      setMatches(data.matches);
      setDeclined(new Set());
      setStep("matches");
    },
  });

  const handleFile = async (file: File) => {
    setFileError("");
    const text = await file.text();
    if (!text.trim()) {
      setFileError("That file is empty.");
      return;
    }
    setCsvText(text);
    previewMutation.mutate(text);
  };

  const importRequest = (): ImportRequest => ({
    csv_text: csvText,
    account_id: Number(accountId),
    mapping: {
      date: mapping.date,
      merchant: mapping.merchant,
      category: mapping.category || undefined,
      note: mapping.note || undefined,
      ...(amountMode === "single"
        ? { amount: mapping.amount }
        : { debit: mapping.debit, credit: mapping.credit }),
    },
    date_format: dateFormat,
  });

  const handleImport = () => {
    if (!accountId) return;
    matchMutation.mutate(importRequest());
  };

  const handleCommitMatches = () => {
    commitMutation.mutate({
      ...importRequest(),
      match_choices: matches.map((m) => ({ row: m.row, claim: !declined.has(m.row) })),
    });
  };

  const setMatchOn = (row: number, on: boolean) => {
    const next = new Set(declined);
    if (on) next.delete(row);
    else next.add(row);
    setDeclined(next);
  };

  const signedAmount = (amount: number) =>
    `${amount >= 0 ? "+" : "−"}${fmt(Math.abs(amount), currency).replace(/^[−-]/, "")}`;

  const importError = matchMutation.error ?? commitMutation.error;
  const checking = matchMutation.isPending || commitMutation.isPending;

  const mappingComplete =
    !!mapping.date &&
    !!mapping.merchant &&
    (amountMode === "single" ? !!mapping.amount : !!mapping.debit && !!mapping.credit);

  const columnOptions = preview?.columns ?? [];

  return (
    <Modal onClose={onClose} label="Import transactions from CSV">
      <h2 className={addModalStyles.title}>Import CSV</h2>

      {step === "upload" && (
        <>
          <p className={addModalStyles.subtitle}>
            Upload a CSV export from your bank or card provider. You'll pick which
            column is which on the next step.
          </p>
          <a
            className={styles.guideLink}
            href="/guide#csv-import"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M10 5.5C8.6 4.3 6.6 3.8 4 4v10c2.6-.2 4.6.3 6 1.5 1.4-1.2 3.4-1.7 6-1.5V4c-2.6-.2-4.6.3-6 1.5zM10 5.5v10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            Column format and example CSVs
          </a>
          <select
            className={addModalStyles.select}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Select account</option>
            {openAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            type="file"
            accept=".csv,text/csv"
            className={styles.fileInput}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {(fileError || previewMutation.isError) && (
            <p className={addModalStyles.errorMsg}>
              {fileError ||
                (previewMutation.error instanceof Error
                  ? previewMutation.error.message
                  : "Couldn't read that file.")}
            </p>
          )}
          <ModalActions onCancel={onClose} busy={previewMutation.isPending} />
        </>
      )}

      {step === "mapping" && preview && (
        <>
          <p className={addModalStyles.subtitle}>
            {preview.row_count} row{preview.row_count === 1 ? "" : "s"} found. Match each
            field to a column.
          </p>

          <div className={styles.field}>
            <label className={styles.label}>Date column</label>
            <select
              className={addModalStyles.select}
              value={mapping.date}
              onChange={(e) => setMapping({ ...mapping, date: e.target.value })}
            >
              <option value="">Select column</option>
              {columnOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Date format</label>
            <select
              className={addModalStyles.select}
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value as ImportDateFormat)}
            >
              {DATE_FORMATS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className={addModalStyles.chips}>
            <button
              type="button"
              className={`${addModalStyles.chip} ${amountMode === "single" ? addModalStyles.chipActive : ""}`}
              onClick={() => setAmountMode("single")}
            >
              Single amount column
            </button>
            <button
              type="button"
              className={`${addModalStyles.chip} ${amountMode === "split" ? addModalStyles.chipActive : ""}`}
              onClick={() => setAmountMode("split")}
            >
              Separate debit/credit columns
            </button>
          </div>

          {amountMode === "single" ? (
            <div className={styles.field}>
              <label className={styles.label}>Amount column</label>
              <select
                className={addModalStyles.select}
                value={mapping.amount}
                onChange={(e) => setMapping({ ...mapping, amount: e.target.value })}
              >
                <option value="">Select column</option>
                {columnOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className={styles.field}>
                <label className={styles.label}>Debit (money out) column</label>
                <select
                  className={addModalStyles.select}
                  value={mapping.debit}
                  onChange={(e) => setMapping({ ...mapping, debit: e.target.value })}
                >
                  <option value="">Select column</option>
                  {columnOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Credit (money in) column</label>
                <select
                  className={addModalStyles.select}
                  value={mapping.credit}
                  onChange={(e) => setMapping({ ...mapping, credit: e.target.value })}
                >
                  <option value="">Select column</option>
                  {columnOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className={styles.field}>
            <label className={styles.label}>Merchant / description column</label>
            <select
              className={addModalStyles.select}
              value={mapping.merchant}
              onChange={(e) => setMapping({ ...mapping, merchant: e.target.value })}
            >
              <option value="">Select column</option>
              {columnOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Category column (optional)</label>
            <select
              className={addModalStyles.select}
              value={mapping.category}
              onChange={(e) => setMapping({ ...mapping, category: e.target.value })}
            >
              <option value="">None</option>
              {columnOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {preview.sample_rows.length > 0 && (
            <div className={styles.previewTableWrap}>
              <table className={styles.previewTable}>
                <thead>
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample_rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {importError && (
            <p className={addModalStyles.errorMsg}>
              {importError instanceof Error ? importError.message : "Import failed."}
            </p>
          )}

          <ModalActions
            onCancel={onClose}
            onSave={handleImport}
            saveLabel="Import"
            savingLabel="Importing…"
            saving={checking}
            saveDisabled={!mappingComplete || !accountId}
            busy={checking}
          />
        </>
      )}

      {step === "matches" && (
        <>
          <p className={addModalStyles.subtitle}>
            {matches.length === 1
              ? "1 row matches a transaction"
              : `${matches.length} rows match transactions`}{" "}
            already posted from a schedule. On keeps the posted transaction and gives it
            the bank's date and description; off imports the row as a new one.
          </p>
          <div className={styles.matchList}>
            {matches.map((m) => (
              <ToggleSwitch
                key={m.row}
                label={`Matches scheduled: ${m.match.name} (${formatDay(m.match.date)})`}
                hint={`${formatDay(m.date)} · ${m.merchant} · ${signedAmount(m.amount)}`}
                checked={!declined.has(m.row)}
                onChange={(on) => setMatchOn(m.row, on)}
              />
            ))}
          </div>

          {commitMutation.isError && (
            <p className={addModalStyles.errorMsg}>
              {commitMutation.error instanceof Error
                ? commitMutation.error.message
                : "Import failed."}
            </p>
          )}

          <ModalActions
            onCancel={() => setStep("mapping")}
            cancelLabel="Back"
            onSave={handleCommitMatches}
            saveLabel="Import"
            savingLabel="Importing…"
            saving={commitMutation.isPending}
            busy={commitMutation.isPending}
          />
        </>
      )}

      {step === "result" && result && (
        <>
          <p className={styles.resultLine}>
            <strong>{result.imported}</strong> transaction
            {result.imported === 1 ? "" : "s"} imported
            {result.matched > 0 &&
              `, ${result.matched} matched ${result.matched === 1 ? "a scheduled transaction" : "scheduled transactions"}`}
            {result.skipped_duplicates > 0 &&
              `, ${result.skipped_duplicates} skipped as duplicate${result.skipped_duplicates === 1 ? "" : "s"}`}
            .
          </p>
          {result.errors.length > 0 && (
            <div className={styles.errorList}>
              <p className={styles.label}>
                {result.errors.length} row{result.errors.length === 1 ? "" : "s"} couldn't
                be imported:
              </p>
              <ul>
                {result.errors.map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ModalActions onCancel={onClose} cancelLabel="Done" />
        </>
      )}
    </Modal>
  );
}
