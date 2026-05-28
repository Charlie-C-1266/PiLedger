import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from "../api/client";
import { useAccounts } from "../hooks/useAccounts";
import { useCategories } from "../hooks/useCategories";
import { useIsMobile } from "../hooks/useIsMobile";
import type { Transaction } from "../types";
import styles from "./AddModal.module.css";

interface Props {
  accountId: number | null;
  transaction?: Transaction;
  onClose: () => void;
}

export default function AddModal({ accountId, transaction, onClose }: Props) {
  const editing = !!transaction;
  const mobile = useIsMobile();
  const { data: accounts } = useAccounts();
  const { data: categoriesData } = useCategories();
  const allCategories = [
    ...(categoriesData?.defaults ?? []),
    ...(categoriesData?.custom.map((c) => c.name) ?? []),
  ];
  const [selectedAccount, setSelectedAccount] = useState<number | "">(
    transaction?.account_id ?? accountId ?? ""
  );
  const [merchant, setMerchant] = useState(transaction?.merchant ?? "");
  const [amount, setAmount] = useState(
    transaction ? String(transaction.amount) : ""
  );
  const [category, setCategory] = useState(transaction?.category ?? "");
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["summary"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  };

  const saveMutation = useMutation({
    mutationFn: editing
      ? (data: Parameters<typeof createTransaction>[0]) =>
          updateTransaction(transaction.id, data)
      : createTransaction,
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTransaction(transaction!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const handleSave = () => {
    const parsed = parseFloat(amount);
    if (!merchant.trim() || isNaN(parsed) || !selectedAccount) return;
    saveMutation.mutate({
      account_id: Number(selectedAccount),
      amount: parsed,
      merchant: merchant.trim(),
      category,
    });
  };

  const pending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <div
      className={`${styles.backdrop} ${mobile ? styles.backdropMobile : ""}`}
      onClick={onClose}
    >
      <div
        className={`${styles.modal} ${mobile ? styles.sheet : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {mobile && <div className={styles.handle} />}
        <h2 className={styles.title}>
          {editing ? "Edit transaction" : "Add transaction"}
        </h2>

        <select
          className={styles.select}
          value={selectedAccount}
          onChange={(e) =>
            setSelectedAccount(e.target.value ? Number(e.target.value) : "")
          }
        >
          <option value="">Select account</option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <input
          className={styles.input}
          placeholder="Tesco, Spotify…"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          autoComplete="off"
          autoFocus
        />

        <input
          className={styles.input}
          placeholder="Amount (e.g. -42.50 for expense, 1500 for income)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />

        <div className={styles.chips}>
          {allCategories.map((c) => (
            <button
              key={c}
              className={`${styles.chip} ${c === category ? styles.chipActive : ""}`}
              onClick={() => setCategory(c === category ? "" : c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          {editing && (
            <button
              className={styles.deleteBtn}
              onClick={() => deleteMutation.mutate()}
              disabled={pending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          )}
          <div className={styles.spacer} />
          <button className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.save}
            onClick={handleSave}
            disabled={pending}
          >
            {saveMutation.isPending
              ? "Saving…"
              : editing
                ? "Update transaction"
                : "Save transaction"}
          </button>
        </div>
      </div>
    </div>
  );
}
