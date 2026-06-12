import styles from "./SegmentedControl.module.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Required accessible name for the radiogroup. */
  ariaLabel: string;
}

/**
 * A compact segmented pill bar — one shared implementation for the net-worth
 * range picker, the account layout picker, and the account type filter, which
 * were three near-identical copies before. Exposes proper `radiogroup`/`radio`
 * semantics (so screen readers announce "1 of N selected"), and the buttons
 * grow to a 44px touch target on coarse pointers while staying compact on
 * desktop. The keyboard focus ring comes from the global `:focus-visible` rule.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: Props<T>) {
  return (
    <div className={styles.group} role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`${styles.pill} ${opt.value === value ? styles.active : ""}`}
          role="radio"
          aria-checked={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
