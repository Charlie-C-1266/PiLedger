import { useMemo, useState } from "react";
import { useAccounts } from "../../hooks/useAccounts";
import type { AccountType } from "../../types";
import CardStack, { type StackVariant } from "../../components/CardStack";
import StackControls from "../../components/StackControls";
import Skeleton from "../../components/Skeleton";
import styles from "../Overview.module.css";

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  current: "Current",
  savings: "Savings",
  loan: "Loan",
  credit: "Credit",
  invest: "Invest",
};

/**
 * The "Your accounts" card stack with its view (fan/cascade/wave/grid) and
 * account-type filter controls. Owns the view + filter UI state; the account
 * data comes from the shared accounts query.
 */
export default function AccountStack() {
  const { data: accounts, isPending } = useAccounts();
  const [stackVariant, setStackVariant] = useState<StackVariant>("fan");
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountType | "">("");

  const stackAccounts = useMemo(() => {
    const all = accounts ?? [];
    if (!accountTypeFilter) return all;
    return all.filter((a) => a.type === accountTypeFilter);
  }, [accounts, accountTypeFilter]);

  // Only offer type filters the user actually has accounts for.
  const accountTypes = useMemo(() => {
    const set = new Set((accounts ?? []).map((a) => a.type));
    return (Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).filter((t) =>
      set.has(t),
    );
  }, [accounts]);

  return (
    <>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>Your accounts</div>
          <div className={styles.sectionSub}>
            {stackVariant === "grid"
              ? "Grid view"
              : "Hover the stack to fan/reveal"}
          </div>
        </div>
        <StackControls
          variant={stackVariant}
          onVariantChange={setStackVariant}
          typeOptions={accountTypes.map((t) => ({
            key: t,
            label: ACCOUNT_TYPE_LABELS[t],
          }))}
          typeValue={accountTypeFilter}
          onTypeChange={(v) => setAccountTypeFilter(v as AccountType | "")}
        />
      </div>
      {isPending ? (
        <Skeleton height={290} radius={14} />
      ) : (
        <CardStack accounts={stackAccounts} variant={stackVariant} height={290} />
      )}
    </>
  );
}
