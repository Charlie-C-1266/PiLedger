import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createGoal } from "../api/client";
import { ACCENT_OPTIONS } from "../theme/tokens";
import styles from "./AddModal.module.css";

interface Props {
  onClose: () => void;
}

export default function AddGoalModal({ onClose }: Props) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [saved, setSaved] = useState("");
  const [monthly, setMonthly] = useState("");
  const [color, setColor] = useState<string>(ACCENT_OPTIONS[0]);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createGoal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      onClose();
    },
  });

  const handleSave = () => {
    const parsedTarget = parseFloat(target);
    if (!name.trim() || isNaN(parsedTarget) || parsedTarget <= 0) return;
    mutation.mutate({
      name: name.trim(),
      target: parsedTarget,
      saved: parseFloat(saved) || 0,
      monthly: parseFloat(monthly) || 0,
      color,
    });
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Add goal</h2>

        <input
          className={styles.input}
          placeholder="Goal name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          autoFocus
        />

        <input
          className={styles.input}
          placeholder="Target amount (e.g. 5000)"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          inputMode="decimal"
        />

        <input
          className={styles.input}
          placeholder="Already saved (optional)"
          value={saved}
          onChange={(e) => setSaved(e.target.value)}
          inputMode="decimal"
        />

        <input
          className={styles.input}
          placeholder="Monthly contribution (optional)"
          value={monthly}
          onChange={(e) => setMonthly(e.target.value)}
          inputMode="decimal"
        />

        <div className={styles.chips}>
          {ACCENT_OPTIONS.map((c) => (
            <button
              key={c}
              className={`${styles.chip} ${c === color ? styles.chipActive : ""}`}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                padding: 0,
                border: c === color ? "2px solid var(--pl-text)" : "2px solid transparent",
                background: c,
              }}
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
            />
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
            {mutation.isPending ? "Saving…" : "Save goal"}
          </button>
        </div>
      </div>
    </div>
  );
}
