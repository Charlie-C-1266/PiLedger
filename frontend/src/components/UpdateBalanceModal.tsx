import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { recordBalance } from "../api/client";
import { useInvalidate } from "../hooks/useInvalidate";
import { useMoney } from "../privacy/useMoney";
import { useToast } from "./toast/useToast";
import Modal from "./Modal";
import ModalActions from "./ModalActions";
import type { Account } from "../types";
import styles from "./AddModal.module.css";

interface Props {
  account: Account;
  onClose: () => void;
}

/** Today as `YYYY-MM-DD` in the user's own timezone (what a date input shows). */
function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Record what an account holds right now (or held on an earlier day), with an
 * optional note. Today's balance is stamped now; an earlier date is stamped at
 * midday UTC so it reads as that same day in any timezone.
 */
export default function UpdateBalanceModal({ account, onClose }: Props) {
  const { fmt } = useMoney();
  const inv = useInvalidate();
  const toast = useToast();
  const today = localToday();
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (value: number) =>
      recordBalance(account.id, value, {
        recorded_at: date && date !== today ? `${date}T12:00:00Z` : undefined,
        notes: note.trim() || undefined,
      }),
    onSuccess: () => {
      inv.accountChanged();
      toast.success("Balance updated");
      onClose();
    },
    onError: () => setError("Couldn't update the balance. Please try again."),
  });

  const parsed = parseFloat(balance);
  const validDate = !date || date <= today;
  const canSave = !isNaN(parsed) && validDate && !mutation.isPending;

  const handleSave = () => {
    if (!canSave) return;
    setError("");
    mutation.mutate(parsed);
  };

  return (
    <Modal onClose={onClose} label="Update balance">
      <h2 className={styles.title}>Update balance</h2>
      <p className={styles.subtitle}>
        {account.name}
        {account.current_balance != null && (
          <> — currently {fmt(account.current_balance, account.currency)}</>
        )}
      </p>

      <input
        className={styles.input}
        placeholder={`New balance (${account.currency})`}
        aria-label="New balance"
        value={balance}
        onChange={(e) => setBalance(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
        }}
        inputMode="decimal"
        autoFocus
      />

      <label className={styles.colorLabel} htmlFor="update-balance-date">
        Date
      </label>
      <input
        id="update-balance-date"
        className={styles.input}
        type="date"
        value={date}
        max={today}
        onChange={(e) => setDate(e.target.value)}
      />
      {!validDate && (
        <div className={styles.errorMsg}>The date can't be in the future.</div>
      )}

      <input
        className={styles.input}
        placeholder="Note (optional)"
        aria-label="Note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        autoComplete="off"
      />

      {error && <div className={styles.errorMsg}>{error}</div>}

      <ModalActions
        onCancel={onClose}
        onSave={handleSave}
        saveLabel="Update balance"
        saving={mutation.isPending}
        saveDisabled={!canSave}
      />
    </Modal>
  );
}
