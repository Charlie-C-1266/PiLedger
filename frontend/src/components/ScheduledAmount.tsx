import { useMoney } from "../privacy/useMoney";
import { kindSign } from "../lib/scheduled";
import { TransferIcon } from "./icons";
import type { SubscriptionKind } from "../types";
import styles from "../screens/Subscriptions.module.css";

interface Props {
  kind: SubscriptionKind;
  amount: number;
  currency: string;
  className?: string;
}

/** A scheduled item's amount with its sign: income `+` in the up colour, a
 * payment `−`, a transfer unsigned. Shared by the Scheduled list and the
 * calendar's day popover. */
export default function ScheduledAmount({ kind, amount, currency, className }: Props) {
  const { fmt } = useMoney();
  const cls = [className, kind === "income" ? styles.amountUp : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      {kindSign(kind)}
      {fmt(Math.abs(amount), currency)}
    </span>
  );
}

/** The transfer icon shown before a scheduled transfer's name. */
export function TransferMark() {
  return (
    <span className={styles.kindIcon} role="img" aria-label="Transfer">
      <TransferIcon aria-hidden="true" />
    </span>
  );
}
