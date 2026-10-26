import { useId, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  createSubscription,
  updateSubscription,
  deleteSubscription,
} from "../api/client";
import { ACCENT_OPTIONS } from "../theme/tokens";
import { useAccounts } from "../hooks/useAccounts";
import { useCategories } from "../hooks/useCategories";
import { useInvalidate } from "../hooks/useInvalidate";
import { KIND_OPTIONS } from "../lib/scheduled";
import Modal from "./Modal";
import ModalActions from "./ModalActions";
import SegmentedControl from "./SegmentedControl";
import type { Frequency, Subscription, SubscriptionKind } from "../types";
import styles from "./AddModal.module.css";

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annually" },
];

const NAME_EXAMPLE: Record<SubscriptionKind, string> = {
  expense: "Netflix",
  income: "Salary",
  transfer: "Savings pot",
};

interface Props {
  subscription?: Subscription;
  onClose: () => void;
}

/** Add or edit a scheduled item: a payment, income, or a transfer between two
 * of your accounts. (Named after the `/api/subscriptions` resource it saves.) */
export default function AddSubscriptionModal({ subscription, onClose }: Props) {
  const editing = !!subscription;
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const inv = useInvalidate();
  const accountSelectId = useId();
  const fromSelectId = useId();
  const toSelectId = useId();

  const [kind, setKind] = useState<SubscriptionKind>(
    subscription?.kind ?? "expense"
  );
  const [name, setName] = useState(subscription?.name ?? "");
  const [amount, setAmount] = useState(
    subscription ? String(subscription.amount) : ""
  );
  const [category, setCategory] = useState(subscription?.category ?? "");
  const [frequency, setFrequency] = useState<Frequency>(
    subscription?.frequency ?? "monthly"
  );
  const [startDate, setStartDate] = useState(
    subscription?.start_date ?? new Date().toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState(subscription?.end_date ?? "");
  const [color, setColor] = useState<string>(
    subscription?.color || ACCENT_OPTIONS[0]
  );
  // The single account for a payment or income, and the From side of a
  // transfer — so switching kind keeps the account already chosen.
  const [accountId, setAccountId] = useState<number | "">(
    subscription?.account_id ?? ""
  );
  const [toAccountId, setToAccountId] = useState<number | "">(
    subscription?.to_account_id ?? ""
  );
  const [notes, setNotes] = useState(subscription?.notes ?? "");
  const [error, setError] = useState("");

  const isTransfer = kind === "transfer";
  const accountList = useMemo(() => accounts ?? [], [accounts]);
  const fromAccount = accountList.find((a) => a.id === accountId);

  // Transfers are restricted to accounts sharing a currency (the same rule as
  // a one-off transfer), so the To list follows the From account's currency
  // and leaves the From account itself out.
  const toOptions = useMemo(() => {
    if (!fromAccount) return [];
    return accountList.filter(
      (a) => a.id !== fromAccount.id && a.currency === fromAccount.currency
    );
  }, [accountList, fromAccount]);

  const allCategories = [
    ...(categories?.defaults ?? []),
    ...(categories?.custom ?? []).map((c) => c.name),
  ];

  const done = () => {
    inv.subscriptionChanged();
    onClose();
  };

  const saveMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createSubscription>[0]) =>
      editing
        ? updateSubscription(subscription!.id, payload)
        : createSubscription(payload),
    onSuccess: done,
    onError: () =>
      setError("Couldn't save this scheduled item. Please try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSubscription(subscription!.id),
    onSuccess: done,
  });

  const handleSelectFrom = (id: number | "") => {
    setAccountId(id);
    // Clear a destination the new source can't transfer to.
    if (toAccountId !== "" && id !== "") {
      const from = accountList.find((a) => a.id === id);
      const to = accountList.find((a) => a.id === toAccountId);
      if (!from || !to || to.id === from.id || to.currency !== from.currency) {
        setToAccountId("");
      }
    }
  };

  const handleSave = () => {
    const parsedAmount = parseFloat(amount);
    if (!name.trim() || isNaN(parsedAmount) || parsedAmount <= 0 || !startDate)
      return;
    if (isTransfer && (accountId === "" || toAccountId === "")) {
      setError("Choose the account the money moves from and the one it goes to.");
      return;
    }
    setError("");
    saveMutation.mutate({
      name: name.trim(),
      amount: parsedAmount,
      kind,
      // A transfer isn't spending, so it carries no category.
      category: isTransfer ? "" : category,
      frequency,
      start_date: startDate,
      end_date: endDate || null,
      color,
      notes: notes.trim(),
      account_id: accountId === "" ? null : Number(accountId),
      to_account_id: isTransfer && toAccountId !== "" ? Number(toAccountId) : null,
    });
  };

  const pending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Modal onClose={onClose}>
      <h2 className={styles.title}>
        {editing ? "Edit scheduled item" : "Add scheduled item"}
      </h2>

      <div className={styles.kindPicker}>
        <SegmentedControl<SubscriptionKind>
          options={KIND_OPTIONS}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setError("");
          }}
          ariaLabel="Scheduled item type"
        />
      </div>

      <input
        className={styles.input}
        placeholder={`Name (e.g. ${NAME_EXAMPLE[kind]})`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="off"
        autoFocus
      />

      <input
        className={styles.input}
        placeholder="Amount (e.g. 9.99)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
      />

      <select
        className={styles.select}
        value={frequency}
        onChange={(e) => setFrequency(e.target.value as Frequency)}
        aria-label="Frequency"
      >
        {FREQUENCIES.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      {!isTransfer && (
        <select
          className={styles.select}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
        >
          <option value="">No category</option>
          {allCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}

      <label className={styles.subtitle}>Start date</label>
      <input
        className={styles.input}
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        aria-label="Start date"
      />

      <label className={styles.subtitle}>End date (optional)</label>
      <input
        className={styles.input}
        type="date"
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
        aria-label="End date"
      />

      {isTransfer ? (
        <>
          <label className={styles.subtitle} htmlFor={fromSelectId}>
            From
          </label>
          <select
            id={fromSelectId}
            className={styles.select}
            value={accountId}
            onChange={(e) =>
              handleSelectFrom(e.target.value ? Number(e.target.value) : "")
            }
          >
            <option value="">Choose an account</option>
            {accountList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <label className={styles.subtitle} htmlFor={toSelectId}>
            To
          </label>
          <select
            id={toSelectId}
            className={styles.select}
            value={toAccountId}
            onChange={(e) =>
              setToAccountId(e.target.value ? Number(e.target.value) : "")
            }
            disabled={!fromAccount}
          >
            <option value="">Choose an account</option>
            {toOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          {accounts && accounts.length < 2 ? (
            <p className={styles.subtitle}>
              You need at least two accounts to schedule a transfer.
            </p>
          ) : (
            fromAccount &&
            toOptions.length === 0 && (
              <p className={styles.subtitle}>
                No other {fromAccount.currency} accounts to transfer to.
              </p>
            )
          )}
        </>
      ) : (
        <>
          <label className={styles.subtitle} htmlFor={accountSelectId}>
            {kind === "income" ? "Paid into" : "Paid from"}
          </label>
          <select
            id={accountSelectId}
            className={styles.select}
            value={accountId}
            onChange={(e) =>
              setAccountId(e.target.value ? Number(e.target.value) : "")
            }
          >
            <option value="">No linked account</option>
            {accountList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </>
      )}

      <input
        className={styles.input}
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        autoComplete="off"
      />

      <div className={styles.chips}>
        {ACCENT_OPTIONS.map((c) => (
          <button
            key={c}
            className={`${styles.chip} ${c === color ? styles.chipActive : ""}`}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              padding: 0,
              border:
                c === color ? "2px solid var(--pl-text)" : "2px solid transparent",
              background: c,
            }}
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
          />
        ))}
      </div>

      {error && <div className={styles.errorMsg}>{error}</div>}

      <ModalActions
        onCancel={onClose}
        onSave={handleSave}
        saveLabel={editing ? "Update scheduled item" : "Save scheduled item"}
        saving={saveMutation.isPending}
        busy={pending}
        onDelete={editing ? () => deleteMutation.mutate() : undefined}
        deleting={deleteMutation.isPending}
      />
    </Modal>
  );
}
