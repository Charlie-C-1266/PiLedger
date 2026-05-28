import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createAccount, recordBalance } from "../api/client";
import { PRESET_COLORS, colorToGradient } from "../theme/swatches";
import styles from "./AddModal.module.css";

const TYPES = [
  { value: "current", label: "Current" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit" },
  { value: "invest", label: "Investment" },
  { value: "loan", label: "Loan" },
];

const DEFAULT_COLOR = "#6366f1";

interface Props {
  onClose: () => void;
}

export default function AddAccountModal({ onClose }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState("current");
  const [balance, setBalance] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [customColor, setCustomColor] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const account = await createAccount({ name: name.trim(), type, color });
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

  const handleCustomColorChange = (val: string) => {
    setCustomColor(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      setColor(val.toLowerCase());
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;
    mutation.mutate();
  };

  const sw = colorToGradient(color);
  const cardPreview = `linear-gradient(135deg, ${sw.start}, ${sw.end})`;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Add account</h2>

        <input
          className={styles.input}
          placeholder="Account name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
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

        {/* Colour picker */}
        <div className={styles.colorSection}>
          <span className={styles.colorLabel}>Card colour</span>
          <div className={styles.colorRow}>
            {/* Live card preview swatch */}
            <div
              className={styles.colorPreview}
              style={{ background: cardPreview }}
              aria-label="Card colour preview"
            />
            {/* Preset colour chips */}
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
          {/* Custom hex input */}
          <input
            className={`${styles.input} ${styles.colorHexInput}`}
            placeholder="Custom hex  e.g. #a78bfa"
            value={customColor}
            onChange={(e) => handleCustomColorChange(e.target.value)}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
          />
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
