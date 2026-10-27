import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { useSummary } from "../hooks/useSummary";
import { useAccounts } from "../hooks/useAccounts";
import { closedPostingAccount } from "../lib/scheduled";
import { PageStagger, StaggerItem } from "../components/PageStagger";
import SegmentedControl from "../components/SegmentedControl";
import SubscriptionsCalendar from "../components/SubscriptionsCalendar";
import AddSubscriptionModal from "../components/AddSubscriptionModal";
import ScheduledAmount, {
  AutoBadge,
  ClosedAccountWarning,
  TransferMark,
} from "../components/ScheduledAmount";
import type { Account, Subscription } from "../types";
import styles from "./Subscriptions.module.css";

type View = "list" | "calendar";

/** Human "due in N days" label + the pill style class for a scheduled item. */
function dueLabel(sub: Subscription): { text: string; cls: string } {
  if (!sub.active) return { text: "Paused", cls: styles.duePillNone };
  if (!sub.next_due_date) return { text: "No upcoming", cls: styles.duePillNone };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(sub.next_due_date + "T00:00:00");
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const soon = days <= 7;
  let text: string;
  if (days <= 0) text = "Due today";
  else if (days === 1) text = "Due tomorrow";
  else text = `Due in ${days} days`;
  return { text, cls: soon ? styles.duePillSoon : styles.duePillOk };
}

function SubscriptionRow({
  sub,
  accounts,
  currency,
  onEdit,
}: {
  sub: Subscription;
  accounts: Account[] | undefined;
  currency: string;
  onEdit: (s: Subscription) => void;
}) {
  const due = dueLabel(sub);
  const isTransfer = sub.kind === "transfer";
  const closed = sub.auto_post ? closedPostingAccount(sub, accounts) : null;
  return (
    <div
      className={styles.card}
      style={sub.color ? { borderLeftColor: sub.color } : undefined}
      onClick={() => onEdit(sub)}
    >
      <div className={styles.cardLeft}>
        <span className={styles.name}>
          {isTransfer && <TransferMark />}
          {sub.name}
        </span>
        <span className={styles.meta}>
          <span className={styles.freqBadge}>{sub.frequency}</span>
          {sub.auto_post && <AutoBadge />}
          {isTransfer ? (
            <span>
              {sub.account_name ?? "No account"} →{" "}
              {sub.to_account_name ?? "No account"}
            </span>
          ) : (
            sub.account_name && <span>{sub.account_name}</span>
          )}
          {sub.category && <span>{sub.category}</span>}
        </span>
        {closed && <ClosedAccountWarning name={closed.name} />}
      </div>
      <div className={styles.cardRight}>
        <ScheduledAmount
          kind={sub.kind}
          amount={sub.amount}
          currency={currency}
          className={styles.amount}
        />
        <span className={`${styles.duePill} ${due.cls}`}>{due.text}</span>
      </div>
    </div>
  );
}

export default function Subscriptions() {
  const { data: subscriptions } = useSubscriptions();
  const { data: summary } = useSummary();
  const { data: accounts } = useAccounts();
  const currency = summary?.base_currency ?? "GBP";
  const [view, setView] = useState<View>("list");
  const [showAdd, setShowAdd] = useState(false);
  const [editSub, setEditSub] = useState<Subscription | null>(null);

  return (
    <PageStagger className={styles.page}>
      <StaggerItem className={styles.header}>
        <h1 className={styles.title}>Scheduled</h1>
        <div className={styles.headerActions}>
          <SegmentedControl<View>
            options={[
              { value: "list", label: "List" },
              { value: "calendar", label: "Calendar" },
            ]}
            value={view}
            onChange={setView}
            ariaLabel="Scheduled view"
          />
          <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
            + Add scheduled item
          </button>
        </div>
      </StaggerItem>

      <StaggerItem>
        {view === "list" ? (
          <div className={styles.list}>
            {(subscriptions ?? []).map((s) => (
              <SubscriptionRow
                key={s.id}
                sub={s}
                accounts={accounts}
                currency={currency}
                onEdit={setEditSub}
              />
            ))}
            {subscriptions?.length === 0 && (
              <div className={styles.empty}>
                Nothing scheduled yet. Add a regular payment, income or
                transfer to see when it's next due.
              </div>
            )}
          </div>
        ) : (
          <SubscriptionsCalendar currency={currency} />
        )}
      </StaggerItem>

      <AnimatePresence>
        {showAdd && (
          <AddSubscriptionModal key="add" onClose={() => setShowAdd(false)} />
        )}
        {editSub && (
          <AddSubscriptionModal
            key="edit"
            subscription={editSub}
            onClose={() => setEditSub(null)}
          />
        )}
      </AnimatePresence>
    </PageStagger>
  );
}
