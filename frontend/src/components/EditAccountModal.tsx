import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, recordBalance, removeAccount, updateAccount } from "../api/client";
import { useMoney } from "../privacy/useMoney";
import { INSTITUTION_GROUPS, OTHER } from "../lib/institutions";
import { CURRENCIES, currencySymbol } from "../lib/currency";
import {
  ACCOUNT_TYPE_LABELS,
  SUBTYPE_LABELS,
  SUBTYPES_BY_TYPE,
  switchableTypes,
} from "../lib/accountTypes";
import Modal from "./Modal";
import ColorPicker from "./ColorPicker";
import ToggleSwitch from "./ToggleSwitch";
import ModalActions from "./ModalActions";
import { useInvalidate } from "../hooks/useInvalidate";
import type { Account, AccountType } from "../types";
import styles from "./AddModal.module.css";

interface Props {
  account: Account;
  onClose: () => void;
  /** Called after the account is deleted (instead of `onClose`), so a caller
   *  showing that account — its own page — can move somewhere that still exists. */
  onDeleted?: () => void;
}

/** Mirrors the API's `MAX_RATE` (% a year). */
const MAX_RATE = 1000;

/** The "Warn me below" input as an amount: null when left empty, NaN when it
 * isn't a non-negative number. Thousands separators are allowed. */
function parseThreshold(raw: string): number | null {
  const text = raw.trim().replace(/,/g, "");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : NaN;
}

/** The interest-rate input as a percentage: 0 when left empty, NaN when it
 * isn't a number from 0 to MAX_RATE. A trailing "%" is allowed. */
function parseRate(raw: string): number {
  const text = raw.trim().replace(/%$/, "").trim();
  if (!text) return 0;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= MAX_RATE ? value : NaN;
}

/** Edit an account's details (everything its page lists), record a new
 * balance, or delete it. Saves only what changed, in one request. */
export default function EditAccountModal({ account, onClose, onDeleted }: Props) {
  const { fmt } = useMoney();
  const ids = {
    name: useId(),
    provider: useId(),
    type: useId(),
    subtype: useId(),
    rate: useId(),
    currency: useId(),
    balance: useId(),
    threshold: useId(),
  };
  const [name, setName] = useState(account.name);
  const [institution, setInstitution] = useState(account.institution ?? "");
  const [institutionName, setInstitutionName] = useState(
    account.institution_name ?? ""
  );
  const [type, setType] = useState<AccountType>(account.type);
  const [subtype, setSubtype] = useState(account.subtype);
  const [rate, setRate] = useState(
    account.interest_rate ? String(account.interest_rate) : ""
  );
  const [currency, setCurrency] = useState(account.currency);
  const [balance, setBalance] = useState("");
  const [threshold, setThreshold] = useState(
    account.low_balance_threshold != null ? String(account.low_balance_threshold) : ""
  );
  const [color, setColor] = useState(account.color || "#6366f1");
  const [countsToNetWorth, setCountsToNetWorth] = useState(
    account.counts_to_net_worth
  );
  const [closed, setClosed] = useState(account.closed);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const inv = useInvalidate();

  const deleteMutation = useMutation({
    mutationFn: () => removeAccount(account.id),
    onSuccess: () => {
      // Deleting an account cascades its transactions (and any budget spend).
      inv.transactionChanged();
      (onDeleted ?? onClose)();
    },
  });

  // The details go first, so a refused change (a currency a scheduled
  // transfer can't follow, say) doesn't leave a new balance half-saved.
  const saveMutation = useMutation({
    mutationFn: async (save: { patch: Partial<Account>; newBalance: number | null }) => {
      if (Object.keys(save.patch).length) await updateAccount(account.id, save.patch);
      if (save.newBalance != null) await recordBalance(account.id, save.newBalance);
    },
    onSuccess: (_, save) => {
      // A new balance may also record a Balance adjustment transaction.
      if (save.newBalance != null) inv.balanceRecorded();
      else inv.accountChanged();
      onClose();
    },
    onError: (err) => {
      // The details may have saved before the balance failed.
      inv.accountChanged();
      setError(
        err instanceof ApiError && err.detail
          ? err.detail
          : "Couldn't save these changes. Please try again."
      );
    },
  });

  const trimmedName = name.trim();
  const customName = institutionName.trim();
  const needsCustomName = institution === OTHER;
  // The low-balance warning reads "projected to run low", which only fits
  // money held: credit cards and loans don't get one.
  const warnsLow = type !== "credit" && type !== "loan";
  const thresholdValue = parseThreshold(threshold);
  const thresholdInvalid = Number.isNaN(thresholdValue);
  const rateValue = parseRate(rate);
  const rateInvalid = Number.isNaN(rateValue);
  const currencyChanged = currency !== account.currency;
  const symbol = currencySymbol(currency);

  const handleTypeChange = (next: AccountType) => {
    setType(next);
    // Keep the subtype if the new type has it too ("general" always does).
    if (!SUBTYPES_BY_TYPE[next].includes(subtype)) setSubtype("general");
  };

  const handleSave = () => {
    if (!trimmedName) {
      setError("Give the account a nickname.");
      return;
    }
    if (needsCustomName && !customName) return;
    if (rateInvalid || (warnsLow && thresholdInvalid)) return;

    const patch: Partial<Account> = {};
    if (trimmedName !== account.name) patch.name = trimmedName;
    // The API checks the subtype against the type, so they travel together.
    if (type !== account.type || subtype !== account.subtype) {
      if (type !== account.type) patch.type = type;
      patch.subtype = subtype;
    }
    if (rateValue !== (account.interest_rate ?? 0)) patch.interest_rate = rateValue;
    if (currencyChanged) patch.currency = currency;
    if (color !== (account.color || "#6366f1")) patch.color = color;
    if (countsToNetWorth !== account.counts_to_net_worth) {
      patch.counts_to_net_worth = countsToNetWorth;
    }
    if (closed !== account.closed) patch.closed = closed;
    // Sent as a pair: the API rejects a custom name on a catalogue slug and
    // requires one on "other", so switching between them has to move both
    // fields in the same request.
    if (
      institution !== (account.institution ?? "") ||
      (needsCustomName && customName !== (account.institution_name ?? ""))
    ) {
      patch.institution = institution || null;
      patch.institution_name = needsCustomName ? customName : null;
    }
    // Null clears it back to warning only below zero.
    if (warnsLow && thresholdValue !== (account.low_balance_threshold ?? null)) {
      patch.low_balance_threshold = thresholdValue;
    }
    const parsedBalance = parseFloat(balance);
    const newBalance = Number.isNaN(parsedBalance) ? null : parsedBalance;

    if (!Object.keys(patch).length && newBalance == null) {
      onClose();
      return;
    }
    setError("");
    saveMutation.mutate({ patch, newBalance });
  };

  const pending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Modal onClose={onClose}>
        <h2 className={styles.title}>Edit account</h2>
        <p className={styles.subtitle}>
          {account.name}
          {account.current_balance != null && (
            <> — currently {fmt(account.current_balance, account.currency)}</>
          )}
        </p>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={ids.name}>
            Nickname
          </label>
          <input
            id={ids.name}
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoComplete="off"
            aria-invalid={!trimmedName || undefined}
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={ids.provider}>
            Provider
          </label>
          <select
            id={ids.provider}
            className={styles.select}
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
          >
            <option value="">No provider</option>
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
              placeholder="Provider name (e.g. Chase)"
              value={institutionName}
              onChange={(e) => setInstitutionName(e.target.value)}
              aria-label="Provider name"
              maxLength={60}
              autoComplete="off"
            />
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={ids.type}>
            Account type
          </label>
          <select
            id={ids.type}
            className={styles.select}
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as AccountType)}
            aria-describedby={`${ids.type}-hint`}
          >
            {switchableTypes(account.type).map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <span className={styles.fieldHint} id={`${ids.type}-hint`}>
            {warnsLow
              ? "To track a credit card or loan, add a new account: its balance is money you owe."
              : "To track money you hold, add a new account: this one's balance is money you owe."}
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={ids.subtype}>
            Subtype
          </label>
          <select
            id={ids.subtype}
            className={styles.select}
            value={subtype}
            onChange={(e) => setSubtype(e.target.value)}
          >
            {SUBTYPES_BY_TYPE[type].map((s) => (
              <option key={s} value={s}>
                {SUBTYPE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={ids.rate}>
            Interest rate
          </label>
          <input
            id={ids.rate}
            className={styles.input}
            placeholder="0.00"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            aria-describedby={`${ids.rate}-hint`}
            aria-invalid={rateInvalid || undefined}
          />
          <span
            className={`${styles.fieldHint} ${rateInvalid ? styles.fieldError : ""}`}
            id={`${ids.rate}-hint`}
          >
            {rateInvalid
              ? "Enter a rate from 0 to 1,000%, or leave it empty."
              : "% a year. Leave empty for none."}
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={ids.currency}>
            Currency
          </label>
          <select
            id={ids.currency}
            className={styles.select}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            aria-describedby={currencyChanged ? `${ids.currency}-hint` : undefined}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          {currencyChanged && (
            <span className={styles.fieldHint} id={`${ids.currency}-hint`}>
              Amounts aren't converted: the balance and transactions keep their
              numbers in {currency}.
            </span>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={ids.balance}>
            New balance
          </label>
          <input
            id={ids.balance}
            className={styles.input}
            placeholder="New balance (e.g. 2500.00)"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            aria-describedby={`${ids.balance}-hint`}
          />
          <span className={styles.fieldHint} id={`${ids.balance}-hint`}>
            Leave empty to keep the current balance.
          </span>
        </div>

        {warnsLow && (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={ids.threshold}>
              Warn me below
            </label>
            <input
              id={ids.threshold}
              className={styles.input}
              placeholder={`${symbol}0.00`}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              aria-describedby={`${ids.threshold}-hint`}
              aria-invalid={thresholdInvalid || undefined}
            />
            <span
              className={`${styles.fieldHint} ${thresholdInvalid ? styles.fieldError : ""}`}
              id={`${ids.threshold}-hint`}
            >
              {thresholdInvalid
                ? "Enter an amount of zero or more, or leave it empty."
                : `Show a warning when this account is projected to fall below this amount. Leave empty to warn only below ${symbol}0.`}
            </span>
          </div>
        )}

        <ColorPicker value={color} onChange={setColor} />

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

        {error && (
          <div className={styles.errorMsg} role="alert">
            {error}
          </div>
        )}

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
