import styles from "./HBar.module.css";

interface Props {
  value: number;
  max: number;
  color: string;
  track?: string;
  height?: number;
}

export default function HBar({ value, max, color, track, height = 6 }: Props) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div
      className={styles.track}
      style={{
        height,
        background: track ?? "var(--pl-surface-alt)",
        borderRadius: height / 2,
      }}
    >
      <div
        className={styles.fill}
        style={{
          width: `${pct}%`,
          background: color,
          borderRadius: height / 2,
        }}
      />
    </div>
  );
}
