import Sparkline from "./charts/Sparkline";
import Skeleton from "./Skeleton";
import styles from "./StatCard.module.css";

interface Props {
  label: string;
  value: string;
  color?: string;
  sparkData?: number[];
  /** Render placeholder shimmer bars instead of a real label/value. */
  loading?: boolean;
}

export default function StatCard({ label, value, color, sparkData, loading }: Props) {
  if (loading) {
    return (
      <div className={styles.card}>
        <Skeleton width={56} height={11} />
        <Skeleton width={88} height={24} />
      </div>
    );
  }
  return (
    <div className={styles.card}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value} style={color ? { color } : undefined}>
        {value}
      </div>
      {sparkData && sparkData.length >= 2 && (
        <Sparkline
          data={sparkData}
          width={70}
          height={18}
          color={color ?? "var(--pl-accent)"}
          fill
        />
      )}
    </div>
  );
}
