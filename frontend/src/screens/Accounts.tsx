import { useMemo, useState } from "react";
import { useTheme } from "../theme/useTheme";
import { useAccounts } from "../hooks/useAccounts";
import { useSummary } from "../hooks/useSummary";
import { fmt } from "../lib/currency";
import CardStack from "../components/CardStack";
import StackControls from "../components/StackControls";
import AccountTile from "../components/AccountTile";
import PressableTile from "../components/PressableTile";
import UpdateBalanceModal from "../components/UpdateBalanceModal";
import type { StackVariant } from "../components/CardStack";
import type { Account, AccountType } from "../types";
import styles from "./Accounts.module.css";

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  current: "Current",
  savings: "Savings",
  loan: "Loan",
  credit: "Credit",
  invest: "Invest",
};

type BalanceFilter = "all" | "assets" | "debts";

const BALANCE_FILTER_LABELS: Record<BalanceFilter, string> = {
  all: "All",
  assets: "Assets",
  debts: "Debts",
};

// A debt is classified by account type, not balance sign — mirrors the backend
// summary, where loan/credit accounts are debts whether their balance is stored
// as a positive magnitude (e.g. 2000 owed) or a negative number (-2000).
const isDebt = (a: Account) => a.type === "loan" || a.type === "credit";

export default function Accounts() {
  const { theme } = useTheme();
  const { data: accounts } = useAccounts();
  const { data: summary } = useSummary();
  const [variant, setVariant] = useState<StackVariant>("fan");
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountType | "">("");
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("all");
  const [editAccount, setEditAccount] = useState<Account | null>(null);

  const currency = summary?.base_currency ?? "GBP";

  const stackAccounts = useMemo(() => {
    const all = accounts ?? [];
    if (!accountTypeFilter) return all;
    return all.filter((a) => a.type === accountTypeFilter);
  }, [accounts, accountTypeFilter]);

  const accountTypes = useMemo(() => {
    const set = new Set((accounts ?? []).map((a) => a.type));
    return (Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).filter((t) => set.has(t));
  }, [accounts]);

  const listedAccounts = useMemo(() => {
    const all = accounts ?? [];
    if (balanceFilter === "assets") return all.filter((a) => !isDebt(a));
    if (balanceFilter === "debts") return all.filter((a) => isDebt(a));
    return all;
  }, [accounts, balanceFilter]);

  const assetTotal = (accounts ?? [])
    .filter((a) => !isDebt(a))
    .reduce((s, a) => s + (a.current_balance ?? 0), 0);
  const debtTotal = (accounts ?? [])
    .filter((a) => isDebt(a))
    .reduce((s, a) => s + Math.abs(a.current_balance ?? 0), 0);
  const netWorth = assetTotal - debtTotal;

  const allAccounts = accounts ?? [];

  return (
    <div className={styles.page}>
      {/* Hero card stack */}
      <div className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <div className={styles.microLabel}>
              {allAccounts.length} LINKED ACCOUNTS
            </div>
            <div className={styles.heroHeading}>Everything you hold</div>
          </div>
          <StackControls
            variant={variant}
            onVariantChange={setVariant}
            typeOptions={accountTypes.map((t) => ({ key: t, label: ACCOUNT_TYPE_LABELS[t] }))}
            typeValue={accountTypeFilter}
            onTypeChange={(v) => setAccountTypeFilter(v as AccountType | "")}
          />
        </div>
        <CardStack accounts={stackAccounts} variant={variant} height={340} />
      </div>

      {/* Filterable accounts list */}
      {allAccounts.length > 0 && (
        <div>
          <div className={styles.sectionHeader}>
            <div className={styles.picker}>
              {(Object.keys(BALANCE_FILTER_LABELS) as BalanceFilter[]).map((f) => (
                <button
                  key={f}
                  className={`${styles.pill} ${balanceFilter === f ? styles.pillActive : ""}`}
                  onClick={() => setBalanceFilter(f)}
                >
                  {BALANCE_FILTER_LABELS[f]}
                </button>
              ))}
            </div>
            {balanceFilter === "all" && (
              <span
                className={styles.totalValue}
                style={{ color: netWorth >= 0 ? theme.up : theme.down }}
              >
                {fmt(netWorth, currency)}
              </span>
            )}
            {balanceFilter === "assets" && (
              <span className={styles.totalValue} style={{ color: theme.up }}>
                {fmt(assetTotal, currency)}
              </span>
            )}
            {balanceFilter === "debts" && (
              <span className={styles.totalValue} style={{ color: theme.down }}>
                {fmt(debtTotal, currency)}
              </span>
            )}
          </div>
          <div className={styles.accountGrid}>
            {listedAccounts.map((a) => (
              <PressableTile key={a.id} onActivate={() => setEditAccount(a)}>
                <AccountTile account={a} style={{ width: "100%", height: 150 }} />
              </PressableTile>
            ))}
            {listedAccounts.length === 0 && (
              <p className={styles.filterEmpty}>
                No {BALANCE_FILTER_LABELS[balanceFilter].toLowerCase()} to show.
              </p>
            )}
          </div>
        </div>
      )}

      {allAccounts.length === 0 && (
        <div className={styles.empty}>
          No accounts yet. Add one to get started.
        </div>
      )}

      {editAccount && (
        <UpdateBalanceModal
          account={editAccount}
          onClose={() => setEditAccount(null)}
        />
      )}
    </div>
  );
}
