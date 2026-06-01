import { PERIODS, PERIOD_KEYS, type Period } from "./period";
import styles from "./PeriodToggle.module.css";

interface Props {
  value: Period;
  onChange: (p: Period) => void;
}

/** Segmented Monthly / Weekly / Yearly pill that picks the display period. */
export default function PeriodToggle({ value, onChange }: Props) {
  return (
    <div className={styles.group} role="radiogroup" aria-label="Budget period">
      {PERIOD_KEYS.map((k) => (
        <button
          key={k}
          className={`${styles.pill} ${k === value ? styles.active : ""}`}
          onClick={() => onChange(k)}
          role="radio"
          aria-checked={k === value}
        >
          {PERIODS[k].label}
        </button>
      ))}
    </div>
  );
}
