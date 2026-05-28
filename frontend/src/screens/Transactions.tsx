import { useMemo, useState } from "react";
import { useTheme } from "../theme/useTheme";
import { useAccounts } from "../hooks/useAccounts";
import { useTransactions } from "../hooks/useTransactions";
import { fmt } from "../lib/currency";
import { useSummary } from "../hooks/useSummary";
import { SearchIcon, FilterIcon } from "../components/icons";
import TxnRow from "../components/TxnRow";
import AddModal from "../components/AddModal";
import FilterSheet from "../components/FilterSheet";
import { useIsMobile } from "../hooks/useIsMobile";
import type { Transaction } from "../types";
import styles from "./Transactions.module.css";

type SortKey = "date" | "amount";

export default function Transactions() {
  const { theme } = useTheme();
  const { data: accounts } = useAccounts();
  const { data: summary } = useSummary();
  const currency = summary?.base_currency ?? "GBP";

  const mobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<number | "">("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);

  const { data: transactions } = useTransactions({
    search: search || undefined,
    account: accountFilter || undefined,
    sort: sortKey,
    per_page: 200,
  });

  const accountMap = useMemo(
    () => new Map((accounts ?? []).map((a) => [a.id, a])),
    [accounts]
  );

  // Client-side category filter (server handles search/account/sort)
  const filtered = useMemo(() => {
    if (!categoryFilter) return transactions ?? [];
    return (transactions ?? []).filter((t) => t.category === categoryFilter);
  }, [transactions, categoryFilter]);

  // Unique categories for chips
  const categories = useMemo(() => {
    const set = new Set((transactions ?? []).map((t) => t.category).filter(Boolean));
    return Array.from(set).sort();
  }, [transactions]);

  // Stats
  const count = filtered.length;
  const inflow = filtered.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);
  const outflow = filtered.reduce(
    (s, t) => s + (t.amount < 0 ? Math.abs(t.amount) : 0),
    0
  );
  const net = inflow - outflow;

  const defaultAccountId = accounts?.[0]?.id ?? null;

  // Count of active non-default filters, shown as a badge on the mobile
  // filter button (account ≠ All, category ≠ All, sort ≠ Newest).
  const activeFilterCount =
    (accountFilter !== "" ? 1 : 0) +
    (categoryFilter !== "" ? 1 : 0) +
    (sortKey !== "date" ? 1 : 0);

  return (
    <div className={styles.page}>
      {/* Stat strip */}
      <div className={styles.statStrip}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Showing</div>
          <div className={styles.statValue}>{count}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Inflow</div>
          <div className={styles.statValue} style={{ color: theme.up }}>
            {fmt(inflow, currency)}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Outflow</div>
          <div className={styles.statValue}>{fmt(outflow, currency)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Net</div>
          <div className={styles.statValue} style={{ color: theme.accent }}>
            {fmt(net, currency)}
          </div>
          <div className={styles.statSub}>filtered total</div>
        </div>
      </div>

      {/* Filter card */}
      <div className={styles.filterCard}>
        {/* Filter bar */}
        <div className={styles.filterBar}>
          <div className={styles.searchPill}>
            <SearchIcon width={14} height={14} />
            <input
              className={styles.searchInput}
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className={styles.clearBtn}
                onClick={() => setSearch("")}
              >
                clear
              </button>
            )}
          </div>

          {mobile ? (
            <button
              className={styles.filterBtn}
              onClick={() => setShowFilterSheet(true)}
              aria-label="Filters"
            >
              <FilterIcon width={15} height={15} />
              Filters
              {activeFilterCount > 0 && (
                <span className={styles.filterBadge}>{activeFilterCount}</span>
              )}
            </button>
          ) : (
            <>
              <select
                className={styles.accountSelect}
                value={accountFilter}
                onChange={(e) =>
                  setAccountFilter(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">All accounts</option>
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                className={styles.sortBtn}
                onClick={() =>
                  setSortKey((k) => (k === "date" ? "amount" : "date"))
                }
              >
                Sort: {sortKey === "date" ? "Newest" : "Largest"}
              </button>
              <div className={styles.spacer} />
              <button
                className={styles.addBtn}
                onClick={() => setShowModal(true)}
              >
                + Add
              </button>
            </>
          )}
        </div>

        {/* Category chips — desktop only; mobile uses the filter sheet */}
        {!mobile && categories.length > 0 && (
          <div className={styles.chipBar} role="radiogroup" aria-label="Filter by category">
            <button
              className={`${styles.chip} ${!categoryFilter ? styles.chipActive : ""}`}
              onClick={() => setCategoryFilter("")}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                className={`${styles.chip} ${c === categoryFilter ? styles.chipActive : ""}`}
                onClick={() =>
                  setCategoryFilter(c === categoryFilter ? "" : c)
                }
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Transaction list */}
        <div className={styles.txnList}>
          {filtered.map((txn) => {
            const acc = accountMap.get(txn.account_id);
            return (
              <div key={txn.id} className={styles.txnDivider}>
                <TxnRow
                  txn={txn}
                  accountName={acc?.name}
                  currency={acc?.currency ?? currency}
                  onClick={() => setEditingTxn(txn)}
                />
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className={styles.empty}>
              No transactions match those filters.
            </div>
          )}
        </div>
      </div>

      {mobile && showFilterSheet && (
        <FilterSheet
          accounts={accounts ?? []}
          categories={categories}
          accountFilter={accountFilter}
          sortKey={sortKey}
          categoryFilter={categoryFilter}
          onApply={({ account, sort, category }) => {
            setAccountFilter(account);
            setSortKey(sort);
            setCategoryFilter(category);
          }}
          onClose={() => setShowFilterSheet(false)}
        />
      )}

      {showModal && (
        <AddModal
          accountId={defaultAccountId}
          onClose={() => setShowModal(false)}
        />
      )}

      {editingTxn && (
        <AddModal
          accountId={editingTxn.account_id}
          transaction={editingTxn}
          onClose={() => setEditingTxn(null)}
        />
      )}
    </div>
  );
}
