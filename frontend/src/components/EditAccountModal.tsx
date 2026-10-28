import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { recordBalance, removeAccount, updateAccount } from "../api/client";
import { useMoney } from "../privacy/useMoney";
import { INSTITUTION_GROUPS, OTHER } from "../lib/institutions";
import { currencySymbol } from "../lib/currency";
import Modal from "./Modal";
import ColorPicker from "./ColorPicker";
import ToggleSwitch from "./ToggleSwitch";
import ModalActions from "./ModalActions";
import { useInvalidate } from "../hooks/useInvalidate";
import type { Account } from "../types";
import styles from "./AddModal.module.css";

interface Props {
  account: Account;
  onClose: () => void;
  /** Called after the account is deleted (instead of `onClose`), so a caller
   *  showing that account — its own page — can move somewhere that still exists. */
  onDeleted?: () => void;
}

/** The "Warn me below" input as an amount: null when left empty, NaN when it
 * isn't a non-negative number. Thousands separators are allowed. */
function parseThreshold(raw: string): number | null {
  const text = raw.trim().replace(/,/g, "");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : NaN;
}

export default function EditAccountModal({ account, onClose, onDeleted }: Props) {
  const { fmt } = useMoney();
  const thresholdId = useId();
  const [balance, setBalance] = useState("");
  const [threshold, setThreshold] = useState(
    account.low_balance_threshold != null ? String(account.low_balance_threshold) : ""
  );
  const [color, setColor] = useState(account.color || "#6366f1");
  const [institution, setInstitution] = useState(account.institution ?? "");
  const [institutionName, setInstitutionName] = useState(
    account.institution_name ?? ""
  );
  const [countsToNetWorth, setCountsToNetWorth] = useState(
    account.counts_to_net_worth
  );
  const [closed, setClosed] = useState(account.closed);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inv = useInvalidate();

  const deleteMutation = useMutation({
    mutationFn: () => removeAccount(account.id),
    onSuccess: () => {
      // Deleting an account cascades its transactions (and any budget spend).
      inv.transactionChanged();
      (onDeleted ?? onClose)();
    },
  });

  const balanceMutation = useMutation({
    mutationFn: (val: number) => recordBalance(account.id, val),
  });

  const colorMutation = useMutation({
    mutationFn: (newColor: string) => updateAccount(account.id, { color: newColor }),
  });

  const flagMutation = useMutation({
    mutationFn: (counts: boolean) =>
      updateAccount(account.id, { counts_to_net_worth: counts }),
  });

  const closedMutation = useMutation({
    mutationFn: (nextClosed: boolean) =>
      updateAccount(account.id, { closed: nextClosed }),
  });

  // Null clears it back to warning only below zero.
  const thresholdMutation = useMutation({
    mutationFn: (value: number | null) =>
      updateAccount(account.id, { low_balance_threshold: value }),
  });

  // Sent as a pair: the API rejects a custom name on a catalogue slug and
  // requires one on "other", so switching between them has to move both fields
  // in the same request.
  const institutionMutation = useMutation({
    mutationFn: () =>
      updateAccount(account.id, {
        institution: institution || null,
        institution_name: institution === OTHER ? institutionName.trim() : null,
      }),
  });

  const customName = institutionName.trim();
  const needsCustomName = institution === OTHER;
  // The low-balance warning reads "projected to run low", which only fits
  // money held: credit cards and loans don't get one.
  const warnsLow = account.type !== "credit" && account.type !== "loan";
  const thresholdValue = parseThreshold(threshold);
  const thresholdInvalid = Number.isNaN(thresholdValue);

  const handleSave = async () => {
    const colorChanged = color !== (account.color || "#6366f1");
    const flagChanged = countsToNetWorth !== account.counts_to_net_worth;
    const closedChanged = closed !== account.closed;
    const institutionChanged =
      institution !== (account.institution ?? "") ||
      (needsCustomName && customName !== (account.institution_name ?? ""));
    const thresholdChanged =
      warnsLow && thresholdValue !== (account.low_balance_threshold ?? null);
    const balanceParsed = parseFloat(balance);
    const hasBalance = !isNaN(balanceParsed);

    if (needsCustomName && !customName) return;
    if (warnsLow && thresholdInvalid) return;
    if (
      !hasBalance &&
      !colorChanged &&
      !flagChanged &&
      !closedChanged &&
      !institutionChanged &&
      !thresholdChanged
    )
      return;

    if (hasBalance) await balanceMutation.mutateAsync(balanceParsed);
    if (colorChanged) await colorMutation.mutateAsync(color);
    if (flagChanged) await flagMutation.mutateAsync(countsToNetWorth);
    if (closedChanged) await closedMutation.mutateAsync(closed);
    if (institutionChanged) await institutionMutation.mutateAsync();
    if (thresholdChanged) await thresholdMutation.mutateAsync(thresholdValue);

    // A new balance may also record a Balance adjustment transaction.
    if (hasBalance) inv.balanceRecorded();
    else inv.accountChanged();
    onClose();
  };

  const pending =
    balanceMutation.isPending ||
    colorMutation.isPending ||
    flagMutation.isPending ||
    closedMutation.isPending ||
    institutionMutation.isPending ||
    thresholdMutation.isPending ||
    deleteMutation.isPending;

  return (
    <Modal onClose={onClose}>
        <h2 className={styles.title}>Update account</h2>
        <p className={styles.subtitle}>
          {account.name}
          {account.current_balance != null && (
            <> — currently {fmt(account.current_balance, account.currency)}</>
          )}
        </p>

        <input
          className={styles.input}
          placeholder="New balance (e.g. 2500.00)"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          inputMode="decimal"
          autoFocus
        />

        <select
          className={styles.select}
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          aria-label="Institution"
        >
          <option value="">No institution</option>
          {INSTITUTION_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.institutions.map((i) => (
                <option key={i.slug} value={i.slug}>
                  {i.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {needsCustomName && (
          <input
            className={styles.input}
            placeholder="Institution name (e.g. Chase)"
            value={institutionName}
            onChange={(e) => setInstitutionName(e.target.value)}
            aria-label="Institution name"
            maxLength={60}
            autoComplete="off"
          />
        )}

        <ColorPicker value={color} onChange={setColor} />

        {warnsLow && (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={thresholdId}>
              Warn me below
            </label>
            <input
              id={thresholdId}
              className={styles.input}
              placeholder={`${currencySymbol(account.currency)}0.00`}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              aria-describedby={`${thresholdId}-hint`}
              aria-invalid={thresholdInvalid || undefined}
            />
            <span
              className={`${styles.fieldHint} ${thresholdInvalid ? styles.fieldError : ""}`}
              id={`${thresholdId}-hint`}
            >
              {thresholdInvalid
                ? "Enter an amount of zero or more, or leave it empty."
                : `Show a warning when this account is projected to fall below this amount. Leave empty to warn only below ${currencySymbol(account.currency)}0.`}
            </span>
          </div>
        )}

        <ToggleSwitch
          label="Count toward net worth"
          hint="Off keeps this account out of your Overview headline and trend."
          checked={countsToNetWorth}
          onChange={setCountsToNetWorth}
        />

        <ToggleSwitch
          label="Closed"
          hint="Kept for history, but won't accept new transactions, transfers, or imports."
          checked={closed}
          onChange={setClosed}
        />

        {confirmingDelete ? (
          <div className={styles.footer}>
            <span style={{ fontSize: 13, color: "var(--pl-text-soft)", flex: 1 }}>
              Delete "{account.name}" and all its transactions?
            </span>
            <button
              className={styles.cancel}
              onClick={() => setConfirmingDelete(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              className={styles.deleteBtn}
              onClick={() => deleteMutation.mutate()}
              disabled={pending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        ) : (
          <ModalActions
            onCancel={onClose}
            onSave={handleSave}
            saveLabel="Update account"
            saving={pending}
            busy={pending}
            onDelete={() => setConfirmingDelete(true)}
            deleteLabel="Delete account"
          />
        )}
    </Modal>
  );
}
