import styles from "./AddModal.module.css";

interface Props {
  label: string;
  /** Optional secondary line under the label. */
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * A labelled on/off switch (with an optional hint line) using the
 * `role="switch"` pattern. Extracted from the "Count toward net worth" toggle
 * duplicated verbatim in AddAccountModal / EditAccountModal.
 */
export default function ToggleSwitch({ label, hint, checked, onChange }: Props) {
  return (
    <div className={styles.toggleRow}>
      <span className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        {hint && <span className={styles.toggleHint}>{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`${styles.toggleSwitch} ${checked ? styles.toggleSwitchOn : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.toggleKnob} />
      </button>
    </div>
  );
}
