import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { useAccounts } from "../../hooks/useAccounts";
import { useSummary } from "../../hooks/useSummary";
import { useTransactions } from "../../hooks/useTransactions";
import TxnRow from "../../components/TxnRow";
import Skeleton from "../../components/Skeleton";
import AddModal from "../../components/AddModal";
import styles from "../Overview.module.css";

/**
 * The "Recent activity" card: the six most-recent transactions and the
 * add-transaction entry point. Owns the add-transaction modal; transactions and
 * accounts come from the shared queries.
 */
export default function RecentActivity() {
  const { data: accounts } = useAccounts();
  const { data: summary } = useSummary();
  const { data: transactions, isPending: txnsPending } = useTransactions({
    per_page: 6,
  });
  const [showTxnModal, setShowTxnModal] = useState(false);

  const currency = summary?.base_currency ?? "GBP";
  const accountMap = new Map((accounts ?? []).map((a) => [a.id, a]));

  return (
    <>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Recent activity</div>
        <button className={styles.addPill} onClick={() => setShowTxnModal(true)}>
          + Add transaction
        </button>
      </div>
      <div className={styles.txnList}>
        {txnsPending
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={styles.txnDivider}>
                <Skeleton height={40} radius={10} style={{ margin: "12px 0" }} />
              </div>
            ))
          : (transactions ?? []).map((txn) => {
              const acc = accountMap.get(txn.account_id);
              return (
                <div key={txn.id} className={styles.txnDivider}>
                  <TxnRow
                    txn={txn}
                    accountName={acc?.name}
                    currency={acc?.currency ?? currency}
                  />
                </div>
              );
            })}
        {!txnsPending && transactions?.length === 0 && (
          <div className={styles.empty}>No transactions yet</div>
        )}
      </div>

      <AnimatePresence>
        {showTxnModal && (
          <AddModal
            key="txn"
            accountId={accounts?.[0]?.id ?? null}
            onClose={() => setShowTxnModal(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
