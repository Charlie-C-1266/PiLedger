import { MinusIcon, PlusIcon } from "../icons";
import styles from "./Stepper.module.css";

interface Props {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  /** Describes what's being adjusted, for the buttons' aria-labels. */
  label?: string;
}

/** Two square −/+ buttons that nudge `value` by `step`, clamped at `min`. */
export default function Stepper({
  value,
  onChange,
  step = 50,
  min = 0,
  label,
}: Props) {
  const suffix = label ? ` ${label}` : "";
  return (
    <div className={styles.stepper}>
      <button
        className={styles.btn}
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        aria-label={`Decrease${suffix}`}
      >
        <MinusIcon />
      </button>
      <button
        className={styles.btn}
        onClick={() => onChange(value + step)}
        aria-label={`Increase${suffix}`}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
