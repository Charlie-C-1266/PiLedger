import { fmt } from "../lib/currency";
import { useLongPress } from "../hooks/useLongPress";
import type { Transaction } from "../types";
import styles from "./TxnRow.module.css";

interface Props {
  txn: Transaction;
  accountName?: string;
  currency?: string;
  onClick?: () => void;
}

function avatar(merchant: string): string {
  return merchant
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function TxnRow({ txn, accountName, currency = "GBP", onClick }: Props) {
  const positive = txn.amount >= 0;

  // Mouse keeps immediate click-to-edit. Touch/pen use long-press so that an
  // accidental tap at the end of a scroll gesture doesn't open the editor.
  const { pressing, handlers } = useLongPress(onClick);

  return (
    <div
      className={`${styles.row} ${accountName ? styles.withAccount : ""} ${onClick ? styles.clickable : ""} ${pressing ? styles.pressing : ""}`}
      {...handlers}
    >
      <div className={styles.avatar}>{avatar(txn.merchant)}</div>
      <div className={styles.info}>
        <div className={styles.merchant}>{txn.merchant}</div>
        <div className={styles.sub}>
          {txn.category ? `${txn.category} · ` : ""}
          {formatDate(txn.occurred_at)}
        </div>
      </div>
      {accountName && <div className={styles.account}>{accountName}</div>}
      <div className={`${styles.amount} ${positive ? styles.up : styles.down}`}>
        {positive ? "+" : "−"}
        {fmt(Math.abs(txn.amount), currency).replace(/^[−-]/, "")}
      </div>
    </div>
  );
}
