import styles from "./AddModal.module.css";

interface Props {
  onCancel: () => void;
  cancelLabel?: string;
  /** Primary action. Omit for a footer with no save button (e.g. a
   *  delete-only dialog). */
  onSave?: () => void;
  saveLabel?: string;
  savingLabel?: string;
  /** Save is in flight: shows `savingLabel` and disables the button. */
  saving?: boolean;
  /** Extra reason to disable save independent of `busy` (e.g. invalid form). */
  saveDisabled?: boolean;
  /** Optional destructive action, rendered on the left. */
  onDelete?: () => void;
  deleteLabel?: string;
  deletingLabel?: string;
  /** Delete is in flight: shows `deletingLabel`. */
  deleting?: boolean;
  /** Any mutation in flight: disables the save and delete buttons. */
  busy?: boolean;
}

/**
 * The standard modal footer: an optional left-aligned destructive button, then
 * Cancel and an optional primary Save pushed to the right (the leading spacer
 * does the pushing). Centralises the "Saving…/Deleting…" pending labels and the
 * disable-while-busy behaviour every add/edit dialog repeated.
 */
export default function ModalActions({
  onCancel,
  cancelLabel = "Cancel",
  onSave,
  saveLabel = "Save",
  savingLabel = "Saving…",
  saving = false,
  saveDisabled = false,
  onDelete,
  deleteLabel = "Delete",
  deletingLabel = "Deleting…",
  deleting = false,
  busy = false,
}: Props) {
  return (
    <div className={styles.footer}>
      {onDelete && (
        <button
          type="button"
          className={styles.deleteBtn}
          onClick={onDelete}
          disabled={busy}
        >
          {deleting ? deletingLabel : deleteLabel}
        </button>
      )}
      <div className={styles.spacer} />
      <button type="button" className={styles.cancel} onClick={onCancel}>
        {cancelLabel}
      </button>
      {onSave && (
        <button
          type="button"
          className={styles.save}
          onClick={onSave}
          disabled={busy || saveDisabled}
        >
          {saving ? savingLabel : saveLabel}
        </button>
      )}
    </div>
  );
}
