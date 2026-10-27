import type { KeyboardEvent, Ref } from "react";
import { useMoney } from "../../privacy/useMoney";
import { useLongPress } from "../../hooks/useLongPress";
import { RepeatIcon } from "../icons";
import {
  dayLong,
  dayParts,
  eventSubline,
  signedAmount,
} from "../../screens/account/projectionModel";
import type { BalanceProjectionEvent } from "../../types";
import styles from "./UpcomingRow.module.css";

interface Props {
  event: BalanceProjectionEvent;
  currency: string;
  /** Tint "£x after" when the balance after this event is below zero. Off for
   * debt accounts, whose balance is the amount owed. */
  warnBelowZero?: boolean;
  /** Replaces the name, e.g. "Due Mon 9 Nov 2026" in the actions dialog. */
  title?: string;
  /** Opens the item's actions. Without it the row is plain (projected interest,
   * or the read-only copy in the dialog). */
  onOpen?: () => void;
  ref?: Ref<HTMLDivElement>;
}

/**
 * One scheduled item (or projected interest credit) on its way: a date badge,
 * the name with its frequency and category, the signed amount, and the
 * account's balance after it.
 *
 * A scheduled row is a button that opens the item's actions: a mouse clicks
 * it, the keyboard uses Enter or Space, and touch long-presses for 500ms (like
 * a transaction row), so a scroll that ends on a row doesn't open it.
 */
export default function UpcomingRow({
  event,
  currency,
  warnBelowZero = true,
  title,
  onOpen,
  ref,
}: Props) {
  const { fmt } = useMoney();
  const { pressing, handlers } = useLongPress(onOpen);
  const { day, month } = dayParts(event.date);
  const amount = signedAmount(event.amount, currency, fmt);
  const low = warnBelowZero && event.balance_after < 0;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onOpen?.();
  };

  const clickable = onOpen
    ? {
        role: "button",
        tabIndex: 0,
        "aria-haspopup": "dialog" as const,
        "aria-label": `${event.name}, ${amount} on ${dayLong(event.date)}. Options`,
        onKeyDown,
        "data-pressing": pressing || undefined,
        ...handlers,
      }
    : {};

  return (
    <div
      ref={ref}
      className={`${styles.row} ${onOpen ? styles.clickable : ""}`}
      {...clickable}
    >
      <div className={styles.date} aria-label={dayLong(event.date)} role="img">
        <span className={styles.day} aria-hidden="true">
          {day}
        </span>
        <span className={styles.month} aria-hidden="true">
          {month}
        </span>
      </div>
      <div className={styles.info}>
        <div className={styles.name}>{title ?? event.name}</div>
        <div className={styles.sub}>
          <RepeatIcon className={styles.icon} aria-hidden="true" />
          {eventSubline(event)}
        </div>
      </div>
      <div className={styles.figs}>
        <div className={`${styles.amount} ${event.amount >= 0 ? styles.up : styles.down}`}>
          {amount}
        </div>
        <div className={`${styles.after} ${low ? styles.low : ""}`}>
          {fmt(event.balance_after, currency)} after
        </div>
      </div>
    </div>
  );
}
