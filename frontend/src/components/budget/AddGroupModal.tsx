import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createGroup, updateGroup, deleteGroup } from "../../api/client";
import { useInvalidate } from "../../hooks/useInvalidate";
import { PRESET_COLORS } from "../../theme/swatches";
import Modal from "../Modal";
import ModalActions from "../ModalActions";
import type { BudgetGroup } from "../../types";
import styles from "../AddModal.module.css";

interface Props {
  group?: BudgetGroup;
  onClose: () => void;
}

export default function AddGroupModal({ group, onClose }: Props) {
  const editing = !!group;
  const inv = useInvalidate();

  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState(group?.color ?? PRESET_COLORS[0]);
  const [customColor, setCustomColor] = useState("");
  // Default new groups to Flexible so safe-to-spend works out of the box;
  // only explicitly mark Fixed for non-discretionary groups (rent, bills…).
  const [flexible, setFlexible] = useState(group?.flexible ?? true);

  const invalidate = () => {
    inv.budgetChanged();
    onClose();
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? updateGroup(group!.id, { name: name.trim(), color, flexible })
        : createGroup({ name: name.trim(), color, flexible }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteGroup(group!.id),
    onSuccess: invalidate,
  });

  const handleCustomColorChange = (val: string) => {
    setCustomColor(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) setColor(val.toLowerCase());
  };

  const handleSave = () => {
    if (!name.trim()) return;
    saveMutation.mutate();
  };

  const pending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <Modal onClose={onClose}>
        <h2 className={styles.title}>{editing ? "Edit group" : "Add group"}</h2>

        <input
          className={styles.input}
          placeholder="Group name (e.g. Bills & Housing)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          autoFocus
        />

        <div className={styles.chips}>
          <button
            className={`${styles.chip} ${!flexible ? styles.chipActive : ""}`}
            onClick={() => setFlexible(false)}
          >
            Fixed
          </button>
          <button
            className={`${styles.chip} ${flexible ? styles.chipActive : ""}`}
            onClick={() => setFlexible(true)}
          >
            Flexible
          </button>
        </div>
        <p className={styles.subtitle}>
          Flexible groups count toward your safe-to-spend figure.
        </p>

        {/* Colour picker */}
        <div className={styles.colorSection}>
          <span className={styles.colorLabel}>Group colour</span>
          <div className={styles.colorRow}>
            <div
              className={styles.colorPreview}
              style={{ background: color }}
              aria-label="Group colour preview"
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
            placeholder="Custom hex  e.g. #2a6fdb"
            value={customColor}
            onChange={(e) => handleCustomColorChange(e.target.value)}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {saveMutation.isError && (
          <p className={styles.errorMsg}>Couldn&rsquo;t save the group. Check the name and colour.</p>
        )}

        <ModalActions
          onCancel={onClose}
          onSave={handleSave}
          saveLabel={editing ? "Update group" : "Save group"}
          saving={saveMutation.isPending}
          busy={pending}
          onDelete={editing ? () => deleteMutation.mutate() : undefined}
          deleting={deleteMutation.isPending}
        />
    </Modal>
  );
}
