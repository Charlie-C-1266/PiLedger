import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { recordBalance, removeAccount, updateAccount } from "../api/client";
import { fmt } from "../lib/currency";
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
}

export default function EditAccountModal({ account, onClose }: Props) {
  const [balance, setBalance] = useState("");
  const [color, setColor] = useState(account.color || "#6366f1");
  const [countsToNetWorth, setCountsToNetWorth] = useState(
    account.counts_to_net_worth
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inv = useInvalidate();

  const deleteMutation = useMutation({
    mutationFn: () => removeAccount(account.id),
    onSuccess: () => {
      // Deleting an account cascades its transactions (and any budget spend).
      inv.transactionChanged();
      onClose();
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

  const handleSave = async () => {
    const colorChanged = color !== (account.color || "#6366f1");
    const flagChanged = countsToNetWorth !== account.counts_to_net_worth;
    const balanceParsed = parseFloat(balance);
    const hasBalance = !isNaN(balanceParsed);

    if (!hasBalance && !colorChanged && !flagChanged) return;

    if (hasBalance) await balanceMutation.mutateAsync(balanceParsed);
    if (colorChanged) await colorMutation.mutateAsync(color);
    if (flagChanged) await flagMutation.mutateAsync(countsToNetWorth);

    inv.accountChanged();
    onClose();
  };

  const pending =
    balanceMutation.isPending ||
    colorMutation.isPending ||
    flagMutation.isPending ||
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

        <ColorPicker value={color} onChange={setColor} />

        <ToggleSwitch
          label="Count toward net worth"
          hint="Off keeps this account out of your Overview headline and trend."
          checked={countsToNetWorth}
          onChange={setCountsToNetWorth}
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
