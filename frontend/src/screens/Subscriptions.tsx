import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { useSummary } from "../hooks/useSummary";
import { useAccounts } from "../hooks/useAccounts";
import {
  KIND_OPTIONS,
  closedPostingAccount,
  matchesScheduledFilter,
  readScheduledFilter,
  writeScheduledFilter,
  type ScheduledFilter,
} from "../lib/scheduled";
import { PageStagger, StaggerItem } from "../components/PageStagger";
import SegmentedControl from "../components/SegmentedControl";
import SubscriptionsCalendar from "../components/SubscriptionsCalendar";
import AddSubscriptionModal from "../components/AddSubscriptionModal";
import ScheduledAmount, {
  AutoBadge,
  ClosedAccountWarning,
  TransferMark,
} from "../components/ScheduledAmount";
import type { Account, Subscription, SubscriptionKind } from "../types";
import styles from "./Subscriptions.module.css";

type View = "list" | "calendar";

const TYPE_OPTIONS: { value: ScheduledFilter["kind"]; label: string }[] = [
  { value: "all", label: "All types" },
  ...KIND_OPTIONS,
];

const UNFILTERED: ScheduledFilter = { account: "", kind: "all" };

/** The accounts worth offering in the account filter: those a scheduled item
 * uses (either side of a transfer), plus the one already chosen, in the
 * accounts list's own order. */
function filterAccounts(
  accounts: Account[] | undefined,
  items: Subscription[] | undefined,
  chosen: number | ""
): Account[] {
  const used = new Set<number>();
  for (const s of items ?? []) {
    if (s.account_id != null) used.add(s.account_id);
    if (s.kind === "transfer" && s.to_account_id != null) used.add(s.to_account_id);
  }
  if (chosen !== "") used.add(chosen);
  return (accounts ?? []).filter((a) => used.has(a.id));
}

/** Narrow the screen to one account and/or one kind of item. */
function FilterBar({
  filter,
  accounts,
  onChange,
}: {
  filter: ScheduledFilter;
  accounts: Account[];
  onChange: (next: ScheduledFilter) => void;
}) {
  const active = filter.account !== "" || filter.kind !== "all";
  return (
    <>
      <SegmentedControl<SubscriptionKind | "all">
        options={TYPE_OPTIONS}
        value={filter.kind}
        onChange={(kind) => onChange({ ...filter, kind })}
        ariaLabel="Type"
      />
      <select
        className={styles.filterSelect}
        value={filter.account}
        onChange={(e) =>
          onChange({
            ...filter,
            account: e.target.value ? Number(e.target.value) : "",
          })
        }
        aria-label="Account"
      >
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.closed ? `${a.name} (closed)` : a.name}
          </option>
        ))}
      </select>
      {active && (
        <button
          type="button"
          className={styles.clearFilters}
          onClick={() => onChange(UNFILTERED)}
        >
          Clear filters
        </button>
      )}
    </>
  );
}

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

  // The filter lives in the URL, so it survives a trip to another screen and
  // an account page can link straight to its own items.
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo<ScheduledFilter>(() => {
    const requested = readScheduledFilter(searchParams);
    // An account that doesn't exist (a stale or mistyped link) filters
    // nothing, rather than hiding everything behind a picker that reads "All
    // accounts".
    const unknown =
      requested.account !== "" &&
      !!accounts &&
      !accounts.some((a) => a.id === requested.account);
    return unknown ? { ...requested, account: "" } : requested;
  }, [searchParams, accounts]);
  const setFilter = (next: ScheduledFilter) =>
    setSearchParams((prev) => writeScheduledFilter(prev, next), { replace: true });

  const accountOptions = useMemo(
    () => filterAccounts(accounts, subscriptions, filter.account),
    [accounts, subscriptions, filter.account]
  );
  const shown = useMemo(
    () => (subscriptions ?? []).filter((s) => matchesScheduledFilter(s, filter)),
    [subscriptions, filter]
  );
  // Nothing to filter until something is scheduled.
  const showFilters = subscriptions?.length !== 0;

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

      {showFilters && (
        <StaggerItem
          className={styles.filters}
          role="group"
          aria-label="Filter scheduled items"
        >
          <FilterBar
            filter={filter}
            accounts={accountOptions}
            onChange={setFilter}
          />
        </StaggerItem>
      )}

      <StaggerItem>
        {view === "list" ? (
          <div className={styles.list}>
            {shown.map((s) => (
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
            {!!subscriptions?.length && shown.length === 0 && (
              <div className={styles.empty}>
                Nothing scheduled matches these filters.
              </div>
            )}
          </div>
        ) : (
          <SubscriptionsCalendar currency={currency} filter={filter} />
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
