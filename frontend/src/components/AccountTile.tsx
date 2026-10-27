import { colorToGradient } from "../theme/swatches";
import { useMoney } from "../privacy/useMoney";
import { resolveInstitution } from "../lib/institutions";
import InstitutionEmblem from "./InstitutionEmblem";
import { lowBalanceLabel } from "../screens/account/projectionModel";
import type { Account } from "../types";
import styles from "./AccountTile.module.css";

interface Props {
  account: Account;
  compact?: boolean;
  /** Fill the parent's width at 168px tall — the account page's identity tile.
   * It leaves out the "Low by …" chip, since that page's projection note
   * already says when the balance runs low. */
  wide?: boolean;
  /** Show a "Set aside" badge when the account is excluded from net worth. */
  badge?: boolean;
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
  wide,
  badge,
  style,
  className,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const { fmt } = useMoney();
  const sw = colorToGradient(account.color || "#6366f1");
  const bg = `linear-gradient(135deg, ${sw.start}, ${sw.end})`;
  const institution = resolveInstitution(account);
  const badgeLabel = account.closed
    ? "Closed"
    : badge && !account.counts_to_net_worth
      ? "Set aside"
      : null;
  // Set by the server when this open asset account is projected below its
  // "Warn me below" amount (zero when unset) in the next 30 days.
  const low = wide ? null : account.low_balance;

  return (
    <div
      className={`${styles.tile} ${compact ? styles.compact : ""} ${wide ? styles.wide : ""} ${className ?? ""}`}
      style={{ background: bg, ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* The provider's mark is the card's artwork when one is recorded; the
          plain circles stand in for it when none is. */}
      {institution ? (
        <InstitutionEmblem institution={institution} />
      ) : (
        <svg className={styles.circles} viewBox="0 0 120 120">
          <circle cx="90" cy="30" r="55" />
          <circle cx="90" cy="30" r="40" />
          <circle cx="90" cy="30" r="25" />
        </svg>
      )}
      <div className={`${styles.top} ${institution ? styles.topInset : ""}`}>
        {/* The provider takes the headline slot when it's known — it's what
            people recognise a card by. The type keeps its place otherwise, and
            moves down beside the card number so it isn't lost either way. */}
        <span className={styles.institution}>
          {institution ? institution.name : account.type.toUpperCase()}
        </span>
      </div>
      {!compact && (
        <div className={styles.cardNum}>
          {institution && <>{account.type.toUpperCase()} · </>}•••• {initials(account.id)}
        </div>
      )}
      {/* The badge lives down here rather than in the top-right corner the
          emblem now owns. */}
      <div className={styles.bottom}>
        <span className={styles.details}>
          <span className={styles.name}>{account.name}</span>
          <span className={compact ? styles.balanceCompact : styles.balance}>
            {fmt(account.current_balance ?? 0, account.currency)}
          </span>
        </span>
        {(low || badgeLabel) && (
          <span className={styles.badges}>
            {/* pl-warn always pairs with words: the chip says what it means. */}
            {low && (
              <span className={`${styles.badge} ${styles.lowBadge}`}>
                {lowBalanceLabel(low)}
              </span>
            )}
            {badgeLabel && <span className={styles.badge}>{badgeLabel}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
