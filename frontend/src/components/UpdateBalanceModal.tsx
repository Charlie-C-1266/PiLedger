import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recordBalance } from "../api/client";
import { fmt } from "../lib/currency";
import type { Account } from "../types";
import styles from "./AddModal.module.css";

interface Props {
  account: Account;
  onClose: () => void;
}

export default function UpdateBalanceModal({ account, onClose }: Props) {
  const [balance, setBalance] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (val: number) => recordBalance(account.id, val),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["networth"] });
      onClose();
    },
  });

  const handleSave = () => {
    const parsed = parseFloat(balance);
    if (isNaN(parsed)) return;
    mutation.mutate(parsed);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Update balance</h2>
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

        <div className={styles.footer}>
          <button className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.save}
            onClick={handleSave}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Update balance"}
          </button>
        </div>
      </div>
    </div>
  );
}
