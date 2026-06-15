import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIncome, updateIncome, deleteIncome } from "../../api/client";
import Modal from "../Modal";
import type { BudgetIncome } from "../../types";
import styles from "../AddModal.module.css";

interface Props {
  income?: BudgetIncome;
  onClose: () => void;
}

/**
 * Create or edit a manual income line. Income carries a free-text label (e.g.
 * "Salary") plus a monthly amount; add a second labelled line for irregular
 * top-ups (a bonus, an expenses reimbursement) and adjust it as the month
 * needs. Mirrors AddGroupModal's create/edit/delete shape.
 */
export default function AddIncomeModal({ income, onClose }: Props) {
  const editing = !!income;
  const queryClient = useQueryClient();

  const [label, setLabel] = useState(income?.label ?? "");
  const [amount, setAmount] = useState(
    income && income.amount ? String(income.amount) : ""
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["budget"] });
    onClose();
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const parsed = parseFloat(amount);
      const amt = !isNaN(parsed) && parsed >= 0 ? parsed : 0;
      return editing
        ? updateIncome(income!.id, { label: label.trim(), amount: amt })
        : createIncome({ label: label.trim(), amount: amt });
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteIncome(income!.id),
    onSuccess: invalidate,
  });

  const handleSave = () => {
    if (!label.trim()) return;
    saveMutation.mutate();
  };

  const pending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Modal onClose={onClose}>
        <h2 className={styles.title}>{editing ? "Edit income" : "Add income"}</h2>

        <input
          className={styles.input}
          placeholder="Income name (e.g. Salary)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoComplete="off"
          autoFocus
        />

        <input
          className={styles.input}
          placeholder="Monthly amount (e.g. 2500)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
        />

        {saveMutation.isError && (
          <p className={styles.errorMsg}>
            Couldn&rsquo;t save the income. Check the name and amount.
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
                ? "Update income"
                : "Save income"}
          </button>
        </div>
    </Modal>
  );
}
