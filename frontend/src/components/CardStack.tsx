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

const VARIANTS: StackVariant[] = ["fan", "cascade", "wave", "grid"];

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
      x = -i * 60 + 100;
      y = 0;
      rot = -8 + i * 3;
    } else {
      x = 0;
      y = i * 14;
      rot = -2 + i * 0.7;
    }
    if (isHovered) scale = 1.05;
  } else if (variant === "cascade") {
    const total = n;
    x = i * 30 - total * 15;
    y = i * 22;
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
  const tiles = accounts.slice(0, 6);
  const n = tiles.length;

  if (variant === "grid") {
    return (
      <div className={styles.grid}>
        {tiles.map((a) => (
          <AccountTile key={a.id} account={a} compact style={{ width: "100%", height: 132 }} />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.canvas} style={{ height }}>
      <div className={styles.stack}>
        {tiles.map((a, i) => (
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

export function VariantPicker({
  value,
  onChange,
}: {
  value: StackVariant;
  onChange: (v: StackVariant) => void;
}) {
  return (
    <div className={styles.picker}>
      {VARIANTS.map((v) => (
        <button
          key={v}
          className={`${styles.pill} ${v === value ? styles.pillActive : ""}`}
          onClick={() => onChange(v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
