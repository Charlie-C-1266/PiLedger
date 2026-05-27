import styles from "./Donut.module.css";

interface Slice {
  value: number;
  color: string;
  label: string;
}

interface Props {
  slices: Slice[];
  size?: number;
  thickness?: number;
  gap?: number;
  hoverIdx: number | null;
  onHover: (idx: number | null) => void;
  center?: React.ReactNode;
}

export default function Donut({
  slices,
  size = 200,
  thickness = 26,
  gap = 3,
  hoverIdx,
  onHover,
  center,
}: Props) {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total === 0) return null;

  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const gapLen = (gap / 360) * circumference;

  let offset = 0;
  const arcs = slices.map((sl, i) => {
    const frac = sl.value / total;
    const len = frac * circumference - gapLen;
    const dashOffset = -offset + circumference / 4;
    offset += frac * circumference;
    const dimmed = hoverIdx !== null && hoverIdx !== i;
    return (
      <circle
        key={i}
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={sl.color}
        strokeWidth={thickness}
        strokeDasharray={`${Math.max(len, 0)} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        opacity={dimmed ? 0.25 : 1}
        style={{ transition: "opacity 160ms" }}
        onMouseEnter={() => onHover(i)}
        onMouseLeave={() => onHover(null)}
      />
    );
  });

  return (
    <div className={styles.wrap} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs}
      </svg>
      {center && <div className={styles.center}>{center}</div>}
    </div>
  );
}
