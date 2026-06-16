import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createGoal, updateGoal, deleteGoal } from "../api/client";
import { ACCENT_OPTIONS } from "../theme/tokens";
import { useAccounts } from "../hooks/useAccounts";
import { useInvalidate } from "../hooks/useInvalidate";
import Modal from "./Modal";
import type { Goal } from "../types";
import styles from "./AddModal.module.css";

interface Props {
  goal?: Goal;
  onClose: () => void;
}

export default function AddGoalModal({ goal, onClose }: Props) {
  const editing = !!goal;
  const { data: accounts } = useAccounts();
  const inv = useInvalidate();

  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.target) : "");
  const [saved, setSaved] = useState(
    goal && goal.account_id == null ? String(goal.saved) : ""
  );
  const [monthly, setMonthly] = useState(
    goal && goal.monthly ? String(goal.monthly) : ""
  );
  const [color, setColor] = useState<string>(goal?.color ?? ACCENT_OPTIONS[0]);
  const [accountId, setAccountId] = useState<number | "">(goal?.account_id ?? "");

  const linked = accountId !== "";

  const invalidate = () => {
    inv.goalChanged();
    onClose();
  };

  const saveMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createGoal>[0]) =>
      editing ? updateGoal(goal!.id, payload) : createGoal(payload),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteGoal(goal!.id),
    onSuccess: invalidate,
  });

  const handleSave = () => {
    const parsedTarget = parseFloat(target);
    if (!name.trim() || isNaN(parsedTarget) || parsedTarget <= 0) return;
    saveMutation.mutate({
      name: name.trim(),
      target: parsedTarget,
      // A linked goal's progress comes from the account, so don't send `saved`.
      ...(linked ? {} : { saved: parseFloat(saved) || 0 }),
      monthly: parseFloat(monthly) || 0,
      color,
      account_id: linked ? Number(accountId) : null,
    });
  };

  const pending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Modal onClose={onClose}>
        <h2 className={styles.title}>{editing ? "Edit goal" : "Add goal"}</h2>

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

        <select
          className={styles.select}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">No linked account (track manually)</option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              Track {a.name}
            </option>
          ))}
        </select>

        {linked ? (
          <p className={styles.subtitle} style={{ marginBottom: 12 }}>
            Progress tracks this account's balance automatically.
          </p>
        ) : (
          <input
            className={styles.input}
            placeholder="Already saved (optional)"
            value={saved}
            onChange={(e) => setSaved(e.target.value)}
            inputMode="decimal"
          />
        )}

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
          {editing && (
            <button
              className={styles.deleteBtn}
              onClick={() => deleteMutation.mutate()}
              disabled={pending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          )}
          <div className={styles.spacer} />
          <button className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.save} onClick={handleSave} disabled={pending}>
            {saveMutation.isPending
              ? "Saving…"
              : editing
                ? "Update goal"
                : "Save goal"}
          </button>
        </div>
    </Modal>
  );
}
