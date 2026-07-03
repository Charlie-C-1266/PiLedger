import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from "../api/client";
import { useAccounts } from "../hooks/useAccounts";
import { useCategories } from "../hooks/useCategories";
import { useInvalidate } from "../hooks/useInvalidate";
import Modal from "./Modal";
import ModalActions from "./ModalActions";
import { fmt } from "../lib/currency";
import type { Transaction } from "../types";
import styles from "./AddModal.module.css";

interface Props {
  accountId: number | null;
  transaction?: Transaction;
  onClose: () => void;
}

export default function AddModal({ accountId, transaction, onClose }: Props) {
  const editing = !!transaction;
  // A transfer leg can't be edited (the two sides must stay in sync); the
  // backend rejects PUTs on it. Offer delete-both instead.
  const isTransfer = !!transaction?.transfer_id;
  const { data: accounts } = useAccounts();
  const currency =
    accounts?.find((a) => a.id === transaction?.account_id)?.currency ?? "GBP";
  // Closed accounts don't take new transactions, but editing a transaction
  // that's already on one must still show it selected in the dropdown.
  const selectableAccounts = (accounts ?? []).filter(
    (a) => !a.closed || a.id === transaction?.account_id
  );
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
    transaction ? String(Math.abs(transaction.amount)) : ""
  );
  // Sign is chosen via the Expense/Income toggle rather than typed, since
  // mobile decimal keypads don't offer a "-" key.
  const [isExpense, setIsExpense] = useState(
    transaction ? transaction.amount < 0 : true
  );
  const [category, setCategory] = useState(transaction?.category ?? "");
  const inv = useInvalidate();

  const saveMutation = useMutation({
    mutationFn: editing
      ? (data: Parameters<typeof createTransaction>[0]) =>
          updateTransaction(transaction.id, data)
      : createTransaction,
    onSuccess: () => {
      inv.transactionChanged();
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTransaction(transaction!.id),
    onSuccess: () => {
      inv.transactionChanged();
      onClose();
    },
  });

  const handleSave = () => {
    const parsed = parseFloat(amount);
    if (!merchant.trim() || isNaN(parsed) || !selectedAccount) return;
    const signed = isExpense ? -Math.abs(parsed) : Math.abs(parsed);
    saveMutation.mutate({
      account_id: Number(selectedAccount),
      amount: signed,
      merchant: merchant.trim(),
      category,
    });
  };

  const pending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Modal onClose={onClose}>
        <h2 className={styles.title}>
          {isTransfer
            ? "Transfer"
            : editing
              ? "Edit transaction"
              : "Add transaction"}
        </h2>

        {isTransfer ? (
          <>
            <p className={styles.subtitle}>
              {transaction!.merchant} · {fmt(transaction!.amount, currency)}
            </p>
            <p className={styles.subtitle}>
              Transfers can't be edited. Deleting removes both sides and restores
              the balances on both accounts.
            </p>
            <ModalActions
              onCancel={onClose}
              onDelete={() => deleteMutation.mutate()}
              deleteLabel="Delete transfer"
              deleting={deleteMutation.isPending}
              busy={pending}
            />
          </>
        ) : (
          <>
            <select
              className={styles.select}
              value={selectedAccount}
              onChange={(e) =>
                setSelectedAccount(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">Select account</option>
              {selectableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.closed ? " (closed)" : ""}
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

            <div className={styles.chips}>
              <button
                type="button"
                className={`${styles.chip} ${isExpense ? styles.chipActive : ""}`}
                onClick={() => setIsExpense(true)}
              >
                Expense
              </button>
              <button
                type="button"
                className={`${styles.chip} ${!isExpense ? styles.chipActive : ""}`}
                onClick={() => setIsExpense(false)}
              >
                Income
              </button>
            </div>

            <input
              className={styles.input}
              placeholder="Amount (e.g. 42.50)"
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

            <ModalActions
              onCancel={onClose}
              onSave={handleSave}
              saveLabel={editing ? "Update transaction" : "Save transaction"}
              saving={saveMutation.isPending}
              busy={pending}
              onDelete={editing ? () => deleteMutation.mutate() : undefined}
              deleting={deleteMutation.isPending}
            />
          </>
        )}
    </Modal>
  );
}
