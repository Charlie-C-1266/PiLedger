import { useEffect, useRef, useState } from "react";
import { fmt } from "../lib/currency";
import type { Transaction } from "../types";
import styles from "./TxnRow.module.css";

const LONG_PRESS_MS = 500;
const PRESS_FEEDBACK_MS = 150;
const MOVE_CANCEL_PX = 10;

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
  const [pressing, setPressing] = useState(false);
  const feedbackTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const lastPointerType = useRef<string>("mouse");
  const longPressFired = useRef(false);

  const clearTimers = () => {
    if (feedbackTimer.current !== null) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setPressing(false);
  };

  useEffect(() => clearTimers, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    lastPointerType.current = e.pointerType;
    longPressFired.current = false;
    if (!onClick || e.pointerType === "mouse") return;
    startPos.current = { x: e.clientX, y: e.clientY };
    feedbackTimer.current = window.setTimeout(() => setPressing(true), PRESS_FEEDBACK_MS);
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setPressing(false);
      onClick();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const start = startPos.current;
    if (!start || longPressTimer.current === null) return;
    if (
      Math.abs(e.clientX - start.x) > MOVE_CANCEL_PX ||
      Math.abs(e.clientY - start.y) > MOVE_CANCEL_PX
    ) {
      clearTimers();
    }
  };

  const handleClick = () => {
    if (!onClick) return;
    // The long-press already opened the editor; swallow the trailing click.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    // A touch tap also synthesises a click — ignore it (touch edits via hold).
    if (lastPointerType.current !== "mouse") return;
    onClick();
  };

  return (
    <div
      className={`${styles.row} ${accountName ? styles.withAccount : ""} ${onClick ? styles.clickable : ""} ${pressing ? styles.pressing : ""}`}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearTimers}
      onPointerCancel={clearTimers}
      onPointerLeave={clearTimers}
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
