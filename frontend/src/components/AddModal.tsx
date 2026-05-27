import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTransaction } from "../api/client";
import styles from "./AddModal.module.css";

const CATEGORIES = [
  "Groceries",
  "Bills",
  "Transport",
  "Entertainment",
  "Dining",
  "Shopping",
  "Health",
  "Other",
];

interface Props {
  accountId: number | null;
  onClose: () => void;
}

export default function AddModal({ accountId, onClose }: Props) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      onClose();
    },
  });

  const handleSave = () => {
    const parsed = parseFloat(amount);
    if (!merchant.trim() || isNaN(parsed) || !accountId) return;
    mutation.mutate({
      account_id: accountId,
      amount: parsed,
      merchant: merchant.trim(),
      category,
    });
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Add transaction</h2>

        <input
          className={styles.input}
          placeholder="Tesco, Spotify…"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          autoFocus
        />

        <input
          className={styles.input}
          placeholder="£0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />

        <div className={styles.chips}>
          {CATEGORIES.map((c) => (
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
          <button className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.save}
            onClick={handleSave}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save transaction"}
          </button>
        </div>
      </div>
    </div>
  );
}
