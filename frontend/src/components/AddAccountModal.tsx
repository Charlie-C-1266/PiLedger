import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createAccount, recordBalance } from "../api/client";
import styles from "./AddModal.module.css";

const TYPES = [
  { value: "current", label: "Current" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit" },
  { value: "invest", label: "Investment" },
  { value: "loan", label: "Loan" },
];

interface Props {
  onClose: () => void;
}

export default function AddAccountModal({ onClose }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState("current");
  const [balance, setBalance] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const account = await createAccount({ name: name.trim(), type });
      const parsed = parseFloat(balance);
      if (!isNaN(parsed)) {
        await recordBalance(account.id, parsed);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["networth"] });
      onClose();
    },
  });

  const handleSave = () => {
    if (!name.trim()) return;
    mutation.mutate();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Add account</h2>

        <input
          className={styles.input}
          placeholder="Account name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <input
          className={styles.input}
          placeholder="Current balance (e.g. 2500.00)"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          inputMode="decimal"
        />

        <div className={styles.chips}>
          {TYPES.map((t) => (
            <button
              key={t.value}
              className={`${styles.chip} ${t.value === type ? styles.chipActive : ""}`}
              onClick={() => setType(t.value)}
            >
              {t.label}
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
            {mutation.isPending ? "Saving…" : "Save account"}
          </button>
        </div>
      </div>
    </div>
  );
}
