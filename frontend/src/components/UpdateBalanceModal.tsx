import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recordBalance, removeAccount, updateAccount } from "../api/client";
import { fmt } from "../lib/currency";
import { PRESET_COLORS, colorToGradient } from "../theme/swatches";
import { useIsMobile } from "../hooks/useIsMobile";
import type { Account } from "../types";
import styles from "./AddModal.module.css";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface Props {
  account: Account;
  onClose: () => void;
}

export default function UpdateBalanceModal({ account, onClose }: Props) {
  const mobile = useIsMobile();
  const [balance, setBalance] = useState("");
  const [color, setColor] = useState(account.color || "#6366f1");
  const [customColor, setCustomColor] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();

  const sw = colorToGradient(color);
  const cardPreview = `linear-gradient(135deg, ${sw.start}, ${sw.end})`;

  const handleCustomColorChange = (val: string) => {
    setCustomColor(val);
    if (HEX_RE.test(val)) {
      setColor(val);
    }
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["summary"] });
    queryClient.invalidateQueries({ queryKey: ["networth"] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => removeAccount(account.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["networth"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onClose();
    },
  });

  const balanceMutation = useMutation({
    mutationFn: (val: number) => recordBalance(account.id, val),
  });

  const colorMutation = useMutation({
    mutationFn: (newColor: string) => updateAccount(account.id, { color: newColor }),
  });

  const handleSave = async () => {
    const colorChanged = color !== (account.color || "#6366f1");
    const balanceParsed = parseFloat(balance);
    const hasBalance = !isNaN(balanceParsed);

    if (!hasBalance && !colorChanged) return;

    if (hasBalance) await balanceMutation.mutateAsync(balanceParsed);
    if (colorChanged) await colorMutation.mutateAsync(color);

    invalidate();
    onClose();
  };

  const pending = balanceMutation.isPending || colorMutation.isPending || deleteMutation.isPending;

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
      </div>
    </div>
  );
}
