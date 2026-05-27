import type { RangeKey } from "../types";
import styles from "./RangePills.module.css";

const RANGES: RangeKey[] = ["7D", "30D", "90D", "1Y"];

interface Props {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
}

export default function RangePills({ value, onChange }: Props) {
  return (
    <div className={styles.group} role="radiogroup" aria-label="Time range">
      {RANGES.map((r) => (
        <button
          key={r}
          className={`${styles.pill} ${r === value ? styles.active : ""}`}
          onClick={() => onChange(r)}
          role="radio"
          aria-checked={r === value}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
