import { useMemo, useState } from "react";
import { useTheme } from "../theme/useTheme";
import { useAccounts } from "../hooks/useAccounts";
import { useSummary } from "../hooks/useSummary";
import { fmt } from "../lib/currency";
import CardStack from "../components/CardStack";
import StackControls from "../components/StackControls";
import AccountTile from "../components/AccountTile";
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

export default function Accounts() {
  const { theme } = useTheme();
  const { data: accounts } = useAccounts();
  const { data: summary } = useSummary();
  const [variant, setVariant] = useState<StackVariant>("fan");
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountType | "">("");
  const [editAccount, setEditAccount] = useState<Account | null>(null);

  const currency = summary?.base_currency ?? "GBP";
  const negative = (accounts ?? []).filter((a) => (a.current_balance ?? 0) < 0);
  const positive = (accounts ?? []).filter((a) => (a.current_balance ?? 0) > 0);

  const stackAccounts = useMemo(() => {
    const all = accounts ?? [];
    if (!accountTypeFilter) return all;
    return all.filter((a) => a.type === accountTypeFilter);
  }, [accounts, accountTypeFilter]);

  const accountTypes = useMemo(() => {
    const set = new Set((accounts ?? []).map((a) => a.type));
    return (Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).filter((t) => set.has(t));
  }, [accounts]);
  const debtTotal = negative.reduce(
    (s, a) => s + Math.abs(a.current_balance ?? 0),
    0
  );
  const assetTotal = positive.reduce((s, a) => s + (a.current_balance ?? 0), 0);

  return (
    <div className={styles.page}>
      {/* Hero card stack */}
      <div className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <div className={styles.microLabel}>
              {(accounts ?? []).length} LINKED ACCOUNTS
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

      {/* All accounts list — click to update balance */}
      {(accounts ?? []).length > 0 && (
        <div>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>All accounts</span>
            <span className={styles.sectionHint}>Click to update balance</span>
          </div>
          <div className={styles.accountGrid}>
            {(accounts ?? []).map((a) => (
              <div key={a.id} onClick={() => setEditAccount(a)} style={{ cursor: "pointer" }}>
                <AccountTile account={a} style={{ width: "100%", height: 150 }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assets section */}
      {positive.length > 0 && (
        <div>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Assets</span>
            <span className={styles.totalValue} style={{ color: theme.up }}>
              {fmt(assetTotal, currency)}
            </span>
          </div>
          <div className={styles.accountGrid}>
            {positive.map((a) => (
              <div key={a.id} onClick={() => setEditAccount(a)} style={{ cursor: "pointer" }}>
                <AccountTile account={a} style={{ width: "100%", height: 150 }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Debts section */}
      {negative.length > 0 && (
        <div>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Debts</span>
            <span className={styles.totalValue} style={{ color: theme.down }}>
              {fmt(debtTotal, currency)}
            </span>
          </div>
          <div className={styles.accountGrid}>
            {negative.map((a) => (
              <div key={a.id} onClick={() => setEditAccount(a)} style={{ cursor: "pointer" }}>
                <AccountTile account={a} style={{ width: "100%", height: 150 }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {(accounts ?? []).length === 0 && (
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
