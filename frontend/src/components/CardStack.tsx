import { useState } from "react";
import AccountTile from "./AccountTile";
import type { Account } from "../types";
import styles from "./CardStack.module.css";

export type StackVariant = "fan" | "cascade" | "wave" | "grid";

interface Props {
  accounts: Account[];
  variant: StackVariant;
  height?: number;
}

function tileTransform(
  variant: StackVariant,
  i: number,
  n: number,
  hoverIdx: number | null,
  anyHover: boolean
): React.CSSProperties {
  if (variant === "grid") return {};

  const isHovered = hoverIdx === i;
  let x = 0,
    y = 0,
    rot = 0,
    scale = 1;

  if (variant === "fan") {
    if (anyHover) {
      const spacing = Math.min(60, 300 / n);
      x = -i * spacing + ((n - 1) * spacing) / 2;
      y = 0;
      const rotRange = Math.min(3, 16 / n);
      rot = -8 + i * rotRange;
    } else {
      const yStep = Math.min(14, 80 / n);
      x = 0;
      y = i * yStep;
      rot = -2 + i * 0.7;
    }
    if (isHovered) scale = 1.05;
  } else if (variant === "cascade") {
    const xStep = Math.min(30, 180 / n);
    const yStep = Math.min(22, 120 / n);
    x = i * xStep - n * (xStep / 2);
    y = i * yStep;
    if (isHovered) scale = 1.04;
  } else if (variant === "wave") {
    const t = n > 1 ? i / (n - 1) : 0.5;
    x = (t - 0.5) * 360;
    y = Math.sin(t * Math.PI) * -40 + 30;
    rot = (t - 0.5) * 14;
    if (isHovered) scale = 1.06;
  }

  return {
    transform: `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`,
    zIndex: isHovered ? 100 : i,
    transition: "transform 380ms cubic-bezier(.2,.7,.2,1)",
  };
}

export default function CardStack({ accounts, variant, height = 290 }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = accounts.length;

  if (variant === "grid") {
    return (
      <div className={styles.grid}>
        {accounts.map((a) => (
          <AccountTile key={a.id} account={a} compact style={{ width: "100%", height: 132 }} />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.canvas} style={{ height }}>
      <div className={styles.stack}>
        {accounts.map((a, i) => (
          <AccountTile
            key={a.id}
            account={a}
            compact
            className={styles.positioned}
            style={tileTransform(variant, i, n, hoverIdx, hoverIdx !== null)}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}
      </div>
    </div>
  );
}
