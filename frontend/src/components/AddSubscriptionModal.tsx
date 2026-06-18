import { useState } from "react";
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
import Modal from "./Modal";
import ModalActions from "./ModalActions";
import type { Frequency, Subscription } from "../types";
import styles from "./AddModal.module.css";

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annually" },
];

interface Props {
  subscription?: Subscription;
  onClose: () => void;
}

export default function AddSubscriptionModal({ subscription, onClose }: Props) {
  const editing = !!subscription;
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const inv = useInvalidate();

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
  const [accountId, setAccountId] = useState<number | "">(
    subscription?.account_id ?? ""
  );
  const [notes, setNotes] = useState(subscription?.notes ?? "");

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
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSubscription(subscription!.id),
    onSuccess: done,
  });

  const handleSave = () => {
    const parsedAmount = parseFloat(amount);
    if (!name.trim() || isNaN(parsedAmount) || parsedAmount <= 0 || !startDate)
      return;
    saveMutation.mutate({
      name: name.trim(),
      amount: parsedAmount,
      category,
      frequency,
      start_date: startDate,
      end_date: endDate || null,
      color,
      notes: notes.trim(),
      account_id: accountId === "" ? null : Number(accountId),
    });
  };

  const pending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Modal onClose={onClose}>
      <h2 className={styles.title}>
        {editing ? "Edit subscription" : "Add subscription"}
      </h2>

      <input
        className={styles.input}
        placeholder="Name (e.g. Netflix)"
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

      <select
        className={styles.select}
        value={accountId}
        onChange={(e) =>
          setAccountId(e.target.value ? Number(e.target.value) : "")
        }
        aria-label="Linked account"
      >
        <option value="">No linked account</option>
        {(accounts ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

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

      <ModalActions
        onCancel={onClose}
        onSave={handleSave}
        saveLabel={editing ? "Update subscription" : "Save subscription"}
        saving={saveMutation.isPending}
        busy={pending}
        onDelete={editing ? () => deleteMutation.mutate() : undefined}
        deleting={deleteMutation.isPending}
      />
    </Modal>
  );
}
