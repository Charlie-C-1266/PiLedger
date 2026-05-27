import { getSwatch } from "../theme/swatches";
import { fmt } from "../lib/currency";
import type { Account } from "../types";
import styles from "./AccountTile.module.css";

interface Props {
  account: Account;
  compact?: boolean;
  style?: React.CSSProperties;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

function initials(id: number): string {
  return String(id).slice(-4).toUpperCase().padStart(4, "0");
}

export default function AccountTile({
  account,
  compact,
  style,
  className,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const sw = getSwatch(String(account.id));
  const bg = `linear-gradient(135deg, ${sw.start}, ${sw.end})`;

  return (
    <div
      className={`${styles.tile} ${compact ? styles.compact : ""} ${className ?? ""}`}
      style={{ background: bg, ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <svg className={styles.circles} viewBox="0 0 120 120">
        <circle cx="90" cy="30" r="55" />
        <circle cx="90" cy="30" r="40" />
        <circle cx="90" cy="30" r="25" />
      </svg>
      <div className={styles.top}>
        <span className={styles.institution}>{account.type.toUpperCase()}</span>
      </div>
      {!compact && (
        <div className={styles.cardNum}>•••• {initials(account.id)}</div>
      )}
      <div className={styles.bottom}>
        <span className={styles.name}>{account.name}</span>
        <span className={compact ? styles.balanceCompact : styles.balance}>
          {fmt(account.current_balance ?? 0, account.currency)}
        </span>
      </div>
    </div>
  );
}
