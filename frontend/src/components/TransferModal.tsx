import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createTransfer } from "../api/client";
import { useAccounts } from "../hooks/useAccounts";
import { useInvalidate } from "../hooks/useInvalidate";
import Modal from "./Modal";
import ModalActions from "./ModalActions";
import { fmt } from "../lib/currency";
import styles from "./AddModal.module.css";

interface Props {
  onClose: () => void;
}

export default function TransferModal({ onClose }: Props) {
  const { data: accounts } = useAccounts();
  const inv = useInvalidate();

  const [fromId, setFromId] = useState<number | "">("");
  const [toId, setToId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  const accountList = useMemo(() => accounts ?? [], [accounts]);
  const fromAccount = accountList.find((a) => a.id === fromId);

  // Transfers are restricted to accounts sharing a currency (v1), so the
  // destination list filters to the source's currency and excludes itself.
  const toOptions = useMemo(() => {
    if (!fromAccount) return [];
    return accountList.filter(
      (a) => a.id !== fromAccount.id && a.currency === fromAccount.currency
    );
  }, [accountList, fromAccount]);

  const mutation = useMutation({
    mutationFn: createTransfer,
    onSuccess: () => {
      inv.transactionChanged();
      onClose();
    },
    onError: () => setError("Couldn't complete the transfer. Please try again."),
  });

  const handleSelectFrom = (id: number | "") => {
    setFromId(id);
    // Clear an incompatible destination when the source changes.
    if (toId !== "" && id !== "") {
      const from = accountList.find((a) => a.id === id);
      const to = accountList.find((a) => a.id === toId);
      if (!from || !to || to.id === from.id || to.currency !== from.currency) {
        setToId("");
      }
    }
  };

  const handleSave = () => {
    const parsed = parseFloat(amount);
    if (!fromId || !toId || isNaN(parsed) || parsed <= 0) return;
    setError("");
    mutation.mutate({
      from_account_id: Number(fromId),
      to_account_id: Number(toId),
      amount: parsed,
    });
  };

  const canSave =
    fromId !== "" && toId !== "" && parseFloat(amount) > 0 && !mutation.isPending;

  return (
    <Modal onClose={onClose}>
        <h2 className={styles.title}>Transfer money</h2>
        <p className={styles.subtitle}>
          Move money between two of your accounts. Both balances update and your
          net worth stays the same.
        </p>

        {accountList.length < 2 ? (
          <p className={styles.subtitle}>
            You need at least two accounts to make a transfer.
          </p>
        ) : (
          <>
            <select
              className={styles.select}
              value={fromId}
              onChange={(e) =>
                handleSelectFrom(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">From account</option>
              {accountList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.current_balance != null
                    ? ` — ${fmt(a.current_balance, a.currency)}`
                    : ""}
                </option>
              ))}
            </select>

            <select
              className={styles.select}
              value={toId}
              onChange={(e) => setToId(e.target.value ? Number(e.target.value) : "")}
              disabled={!fromAccount}
            >
              <option value="">To account</option>
              {toOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.current_balance != null
                    ? ` — ${fmt(a.current_balance, a.currency)}`
                    : ""}
                </option>
              ))}
            </select>

            {fromAccount && toOptions.length === 0 && (
              <p className={styles.subtitle}>
                No other {fromAccount.currency} accounts to transfer to.
              </p>
            )}

            <input
              className={styles.input}
              placeholder={`Amount${fromAccount ? ` (${fromAccount.currency})` : ""}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />

            {error && <div className={styles.errorMsg}>{error}</div>}

            <ModalActions
              onCancel={onClose}
              onSave={handleSave}
              saveLabel="Transfer"
              savingLabel="Transferring…"
              saving={mutation.isPending}
              saveDisabled={!canSave}
            />
          </>
        )}
    </Modal>
  );
}
