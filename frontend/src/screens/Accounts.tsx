import { useMemo, useState } from "react";
import { useTheme } from "../theme/useTheme";
import { useAccounts } from "../hooks/useAccounts";
import { useSummary } from "../hooks/useSummary";
import { useAllHistory } from "../hooks/useAllHistory";
import { useMoney } from "../privacy/useMoney";
import CardStack from "../components/CardStack";
import StackControls from "../components/StackControls";
import AccountTile from "../components/AccountTile";
import PressableTile from "../components/PressableTile";
import EditAccountModal from "../components/EditAccountModal";
import RangePills from "../components/RangePills";
import Skeleton from "../components/Skeleton";
import AccountHistoryChart from "../components/charts/AccountHistoryChart";
import InstitutionMark from "../components/InstitutionMark";
import { resolveInstitution } from "../lib/institutions";
import { AnimatePresence } from "motion/react";
import { PageStagger, StaggerItem } from "../components/PageStagger";
import type { StackVariant } from "../components/CardStack";
import type { Account, AccountType, RangeKey } from "../types";
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

// What one account contributes to a total: debts subtract. Mirrors the page's
// existing net-worth maths, which sums raw balances without FX conversion.
const signedBalance = (a: Account) =>
  isDebt(a) ? -Math.abs(a.current_balance ?? 0) : a.current_balance ?? 0;

type Grouped = {
  key: string;
  name: string;
  institution: ReturnType<typeof resolveInstitution>;
  accounts: Account[];
  total: number;
};

const NO_INSTITUTION = "__none__";

/** Bucket accounts by the provider they're held with, alphabetically, with the
 * unrecorded ones last so the list doesn't open on a placeholder. */
function groupByInstitution(accounts: Account[]): Grouped[] {
  const groups = new Map<string, Grouped>();
  for (const account of accounts) {
    const institution = resolveInstitution(account);
    const key = institution?.key ?? NO_INSTITUTION;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: institution?.name ?? "No institution",
        institution,
        accounts: [],
        total: 0,
      };
      groups.set(key, group);
    }
    group.accounts.push(account);
    group.total += signedBalance(account);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === NO_INSTITUTION) return 1;
    if (b.key === NO_INSTITUTION) return -1;
    return a.name.localeCompare(b.name);
  });
}

export default function Accounts() {
  const { fmt } = useMoney();
  const { theme } = useTheme();
  const { data: accounts } = useAccounts();
  const { data: summary } = useSummary();
  const [variant, setVariant] = useState<StackVariant>("fan");
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountType | "">("");
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("all");
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [historyRange, setHistoryRange] = useState<RangeKey>("90D");
  const [grouped, setGrouped] = useState(false);
  const { data: history, isPending: historyPending } = useAllHistory(historyRange);

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

  const institutionGroups = useMemo(
    () => groupByInstitution(listedAccounts),
    [listedAccounts]
  );

  const assetTotal = (accounts ?? [])
    .filter((a) => !isDebt(a))
    .reduce((s, a) => s + (a.current_balance ?? 0), 0);
  const debtTotal = (accounts ?? [])
    .filter((a) => isDebt(a))
    .reduce((s, a) => s + Math.abs(a.current_balance ?? 0), 0);
  const netWorth = assetTotal - debtTotal;

  const allAccounts = accounts ?? [];

  return (
    <PageStagger className={styles.page}>
      {/* Hero card stack */}
      <StaggerItem className={styles.heroCard}>
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
      </StaggerItem>

      {/* Balance history over time */}
      {allAccounts.length > 0 && (
        <StaggerItem className={styles.historyCard}>
          <div className={styles.historyHeader}>
            <div>
              <div className={styles.sectionTitle}>Balance history</div>
              <div className={styles.historySub}>
                Each account&apos;s balance over the selected range
              </div>
            </div>
            <RangePills value={historyRange} onChange={setHistoryRange} />
          </div>
          {historyPending ? (
            <Skeleton height={260} radius={12} />
          ) : (
            <AccountHistoryChart accounts={history ?? []} currency={currency} />
          )}
        </StaggerItem>
      )}

      {/* Filterable accounts list */}
      {allAccounts.length > 0 && (
        <StaggerItem>
          <div className={styles.sectionHeader}>
            <div className={styles.filters}>
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
              <div className={styles.picker}>
                <button
                  className={`${styles.pill} ${!grouped ? styles.pillActive : ""}`}
                  onClick={() => setGrouped(false)}
                  aria-pressed={!grouped}
                >
                  List
                </button>
                <button
                  className={`${styles.pill} ${grouped ? styles.pillActive : ""}`}
                  onClick={() => setGrouped(true)}
                  aria-pressed={grouped}
                >
                  By institution
                </button>
              </div>
            </div>
            {balanceFilter === "all" && (
              <span className={styles.totalWrap}>
                <span className={styles.totalCaption}>Total net worth</span>
                <span
                  className={styles.totalValue}
                  style={{ color: netWorth >= 0 ? theme.up : theme.down }}
                >
                  {fmt(netWorth, currency)}
                </span>
              </span>
            )}
            {balanceFilter === "assets" && (
              <span className={styles.totalWrap}>
                <span className={styles.totalCaption}>Total assets</span>
                <span className={styles.totalValue} style={{ color: theme.up }}>
                  {fmt(assetTotal, currency)}
                </span>
              </span>
            )}
            {balanceFilter === "debts" && (
              <span className={styles.totalWrap}>
                <span className={styles.totalCaption}>Total debts</span>
                <span className={styles.totalValue} style={{ color: theme.down }}>
                  {fmt(debtTotal, currency)}
                </span>
              </span>
            )}
          </div>
          {listedAccounts.length === 0 ? (
            <p className={styles.filterEmpty}>
              No {BALANCE_FILTER_LABELS[balanceFilter].toLowerCase()} to show.
            </p>
          ) : grouped ? (
            <div className={styles.groups}>
              {institutionGroups.map((g) => (
                <section key={g.key} className={styles.group}>
                  <header className={styles.groupHeader}>
                    {g.institution ? (
                      <InstitutionMark institution={g.institution} size={30} />
                    ) : (
                      <span className={styles.noMark} aria-hidden="true" />
                    )}
                    <span className={styles.groupMeta}>
                      <span className={styles.groupName}>{g.name}</span>
                      <span className={styles.groupCount}>
                        {g.accounts.length} account{g.accounts.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span
                      className={styles.groupTotal}
                      style={{ color: g.total >= 0 ? theme.up : theme.down }}
                    >
                      {fmt(g.total, currency)}
                    </span>
                  </header>
                  <div className={styles.accountGrid}>
                    {g.accounts.map((a) => (
                      <PressableTile key={a.id} onActivate={() => setEditAccount(a)}>
                        <AccountTile
                          account={a}
                          badge
                          style={{ width: "100%", height: 150 }}
                        />
                      </PressableTile>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className={styles.accountGrid}>
              {listedAccounts.map((a) => (
                <PressableTile key={a.id} onActivate={() => setEditAccount(a)}>
                  <AccountTile account={a} badge style={{ width: "100%", height: 150 }} />
                </PressableTile>
              ))}
            </div>
          )}
        </StaggerItem>
      )}

      {allAccounts.length === 0 && (
        <StaggerItem className={styles.empty}>
          No accounts yet. Add one to get started.
        </StaggerItem>
      )}

      <AnimatePresence>
        {editAccount && (
          <EditAccountModal
            account={editAccount}
            onClose={() => setEditAccount(null)}
          />
        )}
      </AnimatePresence>
    </PageStagger>
  );
}
