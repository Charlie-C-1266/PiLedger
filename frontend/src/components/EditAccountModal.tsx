import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { recordBalance, removeAccount, updateAccount } from "../api/client";
import { fmt } from "../lib/currency";
import { PRESET_COLORS, colorToGradient } from "../theme/swatches";
import Modal from "./Modal";
import { useInvalidate } from "../hooks/useInvalidate";
import type { Account } from "../types";
import styles from "./AddModal.module.css";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface Props {
  account: Account;
  onClose: () => void;
}

export default function EditAccountModal({ account, onClose }: Props) {
  const [balance, setBalance] = useState("");
  const [color, setColor] = useState(account.color || "#6366f1");
  const [customColor, setCustomColor] = useState("");
  const [countsToNetWorth, setCountsToNetWorth] = useState(
    account.counts_to_net_worth
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inv = useInvalidate();

  const sw = colorToGradient(color);
  const cardPreview = `linear-gradient(135deg, ${sw.start}, ${sw.end})`;

  const handleCustomColorChange = (val: string) => {
    setCustomColor(val);
    if (HEX_RE.test(val)) {
      setColor(val);
    }
  };

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

        <div className={styles.colorSection}>
          <span className={styles.colorLabel}>Card colour</span>
          <div className={styles.colorRow}>
            <div
              className={styles.colorPreview}
              style={{ background: cardPreview }}
              aria-label="Card colour preview"
            />
            <div className={styles.colorSwatches}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`${styles.colorSwatch} ${c === color ? styles.colorSwatchActive : ""}`}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c);
                    setCustomColor("");
                  }}
                  aria-label={`Select colour ${c}`}
                  title={c}
                />
              ))}
            </div>
          </div>
          <input
            className={`${styles.input} ${styles.colorHexInput}`}
            placeholder="Custom hex  e.g. #a78bfa"
            value={customColor}
            onChange={(e) => handleCustomColorChange(e.target.value)}
            maxLength={7}
            spellCheck={false}
          />
        </div>

        <div className={styles.toggleRow}>
          <span className={styles.toggleText}>
            <span className={styles.toggleLabel}>Count toward net worth</span>
            <span className={styles.toggleHint}>
              Off keeps this account out of your Overview headline and trend.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={countsToNetWorth}
            aria-label="Count toward net worth"
            className={`${styles.toggleSwitch} ${countsToNetWorth ? styles.toggleSwitchOn : ""}`}
            onClick={() => setCountsToNetWorth((v) => !v)}
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>

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
          <div className={styles.footer}>
            <button
              className={styles.deleteBtn}
              onClick={() => setConfirmingDelete(true)}
              disabled={pending}
            >
              Delete account
            </button>
            <div className={styles.spacer} />
            <button className={styles.cancel} onClick={onClose}>
              Cancel
            </button>
            <button
              className={styles.save}
              onClick={handleSave}
              disabled={pending}
            >
              {pending ? "Saving…" : "Update account"}
            </button>
          </div>
        )}
    </Modal>
  );
}
