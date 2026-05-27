interface Props {
  data: number[];
  width?: number;
  height?: number;
  color: string;
  fill?: boolean;
}

function buildPath(data: number[], w: number, h: number): string {
  if (data.length < 2) return "";
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const xStep = w / (data.length - 1);

  const points = data.map((v, i) => ({
    x: i * xStep,
    y: h - ((v - min) / range) * h,
  }));

  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const cpx = (prev.x + cur.x) / 2;
    d += ` C${cpx},${prev.y} ${cpx},${cur.y} ${cur.x},${cur.y}`;
  }
  return d;
}

export default function Sparkline({
  data,
  width = 70,
  height = 18,
  color,
  fill = false,
}: Props) {
  if (data.length < 2) return null;
  const path = buildPath(data, width, height);
  const fillPath = fill ? `${path} L${width},${height} L0,${height} Z` : "";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {fill && (
        <path d={fillPath} fill={color} opacity={0.18} />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
