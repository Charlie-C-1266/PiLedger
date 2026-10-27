import { useRef, type KeyboardEvent } from "react";
import { useMoney } from "../../privacy/useMoney";
import { dayShort, horizonLabel, signedAmount } from "../../screens/account/projectionModel";
import type { BalanceProjectionHorizon } from "../../types";
import styles from "./HorizonTiles.module.css";

interface Props {
  horizons: BalanceProjectionHorizon[];
  /** The selected horizon, in months. */
  selected: number;
  onSelect: (months: number) => void;
  currency: string;
  /** Id of the heading that names the group ("Projected balance"). */
  labelledBy?: string;
}

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * The projected balance 1, 3, 6 and 12 months out, which doubles as the
 * chart's range picker: a radio group with a roving tabindex, so Tab lands on
 * the selected tile and the arrow keys move the selection (and the chart).
 */
export default function HorizonTiles({
  horizons,
  selected,
  onSelect,
  currency,
  labelledBy,
}: Props) {
  const { fmt } = useMoney();
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (NEXT_KEYS.has(e.key)) next = (index + 1) % horizons.length;
    else if (PREV_KEYS.has(e.key)) next = (index - 1 + horizons.length) % horizons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = horizons.length - 1;
    else return;
    e.preventDefault();
    tiles.current[next]?.focus();
    onSelect(horizons[next].months);
  };

  return (
    <div className={styles.tiles} role="radiogroup" aria-labelledby={labelledBy}>
      {horizons.map((h, index) => {
        const on = h.months === selected;
        const up = h.change >= 0;
        return (
          <button
            key={h.months}
            ref={(el) => {
              tiles.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={styles.tile}
            onClick={() => onSelect(h.months)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            <span className={styles.label}>{horizonLabel(h.months)}</span>
            <span className={styles.value}>{fmt(h.balance, currency)}</span>
            <span className={styles.foot}>
              <span className={`${styles.delta} ${up ? styles.up : styles.down}`}>
                {signedAmount(h.change, currency, fmt)}
              </span>
              <span className={styles.date}>{dayShort(h.date)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
