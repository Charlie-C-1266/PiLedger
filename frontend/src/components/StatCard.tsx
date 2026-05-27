import Sparkline from "./charts/Sparkline";
import styles from "./StatCard.module.css";

interface Props {
  label: string;
  value: string;
  color?: string;
  sparkData?: number[];
}

export default function StatCard({ label, value, color, sparkData }: Props) {
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
