import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { useGoals } from "../../hooks/useGoals";
import { useSummary } from "../../hooks/useSummary";
import { fmt } from "../../lib/currency";
import HBar from "../../components/charts/HBar";
import Skeleton from "../../components/Skeleton";
import AddGoalModal from "../../components/AddGoalModal";
import styles from "../Overview.module.css";

/**
 * The "Goals progress" card: a progress bar per goal with its percentage and an
 * estimated months-to-target, plus the add-goal entry point. Owns the add-goal
 * modal.
 */
export default function GoalsProgress() {
  const { data: goals, isPending: goalsPending } = useGoals();
  const { data: summary } = useSummary();
  const [showGoalModal, setShowGoalModal] = useState(false);

  const currency = summary?.base_currency ?? "GBP";

  return (
    <>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Goals progress</div>
        <button className={styles.addPill} onClick={() => setShowGoalModal(true)}>
          + Add goal
        </button>
      </div>
      <div className={styles.goalsList}>
        {goalsPending &&
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className={styles.goalRow}>
              <Skeleton width="40%" height={13} />
              <Skeleton height={6} radius={999} />
              <Skeleton width="55%" height={11} />
            </div>
          ))}
        {!goalsPending &&
          (goals ?? []).map((g) => {
            const pct = g.target > 0 ? (g.saved / g.target) * 100 : 0;
            const months =
              g.monthly > 0 ? Math.ceil((g.target - g.saved) / g.monthly) : null;
            return (
              <div key={g.id} className={styles.goalRow}>
                <div className={styles.goalHeader}>
                  <span className={styles.goalName}>{g.name}</span>
                  <span className={styles.goalPct}>{pct.toFixed(0)}%</span>
                </div>
                <HBar value={g.saved} max={g.target} color={g.color} height={6} />
                <div className={styles.goalFooter}>
                  {fmt(g.saved, currency)} of {fmt(g.target, currency)}
                  {months !== null && ` · ${months}mo left`}
                </div>
              </div>
            );
          })}
        {!goalsPending && goals?.length === 0 && (
          <div className={styles.empty}>No goals yet</div>
        )}
      </div>

      <AnimatePresence>
        {showGoalModal && (
          <AddGoalModal key="goal" onClose={() => setShowGoalModal(false)} />
        )}
      </AnimatePresence>
    </>
  );
}
