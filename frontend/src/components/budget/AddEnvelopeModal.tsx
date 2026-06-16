import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  createEnvelope,
  updateEnvelope,
  deleteEnvelope,
} from "../../api/client";
import { useBudget } from "../../hooks/useBudget";
import { useCategories } from "../../hooks/useCategories";
import { useInvalidate } from "../../hooks/useInvalidate";
import Modal from "../Modal";
import type { BudgetEnvelope } from "../../types";
import styles from "../AddModal.module.css";

interface Props {
  envelope?: BudgetEnvelope;
  /** Pre-selected group when adding from a group card. */
  groupId?: number;
  onClose: () => void;
}

export default function AddEnvelopeModal({ envelope, groupId, onClose }: Props) {
  const editing = !!envelope;
  const inv = useInvalidate();
  const { data: budget } = useBudget();
  const { data: cats } = useCategories();

  const groups = useMemo(() => budget?.groups ?? [], [budget]);

  const [label, setLabel] = useState(envelope?.label ?? "");
  const [category, setCategory] = useState(envelope?.category ?? "");
  const [gId, setGId] = useState<number>(
    envelope?.group_id ?? groupId ?? groups[0]?.id ?? 0
  );
  const [budgeted, setBudgeted] = useState(
    envelope ? String(envelope.budgeted) : ""
  );

  // Each category can back only one envelope, so hide ones already taken —
  // except this envelope's own (so it stays selectable while editing).
  const available = useMemo(() => {
    const used = new Set(
      groups
        .flatMap((g) => g.envelopes.map((e) => e.category))
        .filter((c) => c !== envelope?.category)
    );
    const all = [
      ...(cats?.defaults ?? []),
      ...(cats?.custom.map((c) => c.name) ?? []),
    ];
    return all.filter((c) => !used.has(c));
  }, [groups, cats, envelope]);

  const invalidate = () => {
    inv.budgetChanged();
    onClose();
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        label: label.trim(),
        category,
        group_id: gId,
        budgeted: parseFloat(budgeted) || 0,
      };
      return editing
        ? updateEnvelope(envelope!.id, payload)
        : createEnvelope(payload);
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteEnvelope(envelope!.id),
    onSuccess: invalidate,
  });

  const handleSave = () => {
    if (!label.trim() || !category || !gId) return;
    saveMutation.mutate();
  };

  const pending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Modal onClose={onClose}>
        <h2 className={styles.title}>
          {editing ? "Edit envelope" : "Add envelope"}
        </h2>

        <input
          className={styles.input}
          placeholder="Envelope name (e.g. Groceries)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoComplete="off"
          autoFocus
        />

        <select
          className={styles.select}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Track which category?</option>
          {available.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={gId}
          onChange={(e) => setGId(Number(e.target.value))}
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <input
          className={styles.input}
          placeholder="Monthly budget (e.g. 300)"
          value={budgeted}
          onChange={(e) => setBudgeted(e.target.value)}
          inputMode="decimal"
        />

        {saveMutation.isError && (
          <p className={styles.errorMsg}>
            Couldn&rsquo;t save the envelope. That category may already be in
            use.
          </p>
        )}

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
                ? "Update envelope"
                : "Save envelope"}
          </button>
        </div>
    </Modal>
  );
}
