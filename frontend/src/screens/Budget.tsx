import { useMemo, useState } from "react";
import { useBudget } from "../hooks/useBudget";
import Hero from "../components/budget/Hero";
import IncomeCard from "../components/budget/IncomeCard";
import GroupCard from "../components/budget/GroupCard";
import BudgetTrend from "../components/budget/BudgetTrend";
import SafeToSpendCard from "../components/budget/SafeToSpendCard";
import AllocationDonut from "../components/budget/AllocationDonut";
import SpentSoFarCard from "../components/budget/SpentSoFarCard";
import AddGroupModal from "../components/budget/AddGroupModal";
import AddEnvelopeModal from "../components/budget/AddEnvelopeModal";
import AddIncomeModal from "../components/budget/AddIncomeModal";
import { PERIODS, type Period } from "../components/budget/period";
import type { BudgetEnvelope, BudgetGroup, BudgetIncome } from "../types";
import styles from "./Budget.module.css";

type GroupModal = { group?: BudgetGroup };
type EnvModal = { envelope?: BudgetEnvelope; groupId?: number };
type IncomeModal = { income?: BudgetIncome };

/**
 * Phase 10. Both columns are now built: the left has the hero, income card and
 * editable envelope groups; the right rail carries safe-to-spend, the
 * allocation donut and spent-so-far. The budget-vs-actual trend lands next.
 */
export default function Budget() {
  const { data, isLoading } = useBudget();
  const [period, setPeriod] = useState<Period>("monthly");
  const [groupModal, setGroupModal] = useState<GroupModal | null>(null);
  const [envModal, setEnvModal] = useState<EnvModal | null>(null);
  const [incomeModal, setIncomeModal] = useState<IncomeModal | null>(null);

  const currency = data?.base_currency ?? "GBP";
  const factor = PERIODS[period].factor;
  const isEmpty = !!data && data.incomes.length === 0 && data.groups.length === 0;

  const incomeTotal = useMemo(
    () => (data?.incomes ?? []).reduce((s, i) => s + i.amount, 0),
    [data]
  );
  const segments = useMemo(
    () =>
      (data?.groups ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        total: g.envelopes.reduce((s, e) => s + e.budgeted, 0),
      })),
    [data]
  );
  const allocated = segments.reduce((s, g) => s + g.total, 0);

  const totalSpent = useMemo(
    () =>
      (data?.groups ?? []).reduce(
        (s, g) => s + g.envelopes.reduce((a, e) => a + e.spent, 0),
        0
      ),
    [data]
  );
  // Safe-to-spend draws only on flexible groups' remaining budget.
  const flexRemaining = useMemo(
    () =>
      (data?.groups ?? [])
        .filter((g) => g.flexible)
        .reduce(
          (s, g) => s + g.envelopes.reduce((a, e) => a + (e.budgeted - e.spent), 0),
          0
        ),
    [data]
  );
  const envelopeCount = (data?.groups ?? []).reduce(
    (s, g) => s + g.envelopes.length,
    0
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Budget</h1>
      </div>

      {isLoading && (
        <div className={styles.empty} role="status">
          Loading…
        </div>
      )}

      {isEmpty && (
        <div className={styles.empty}>
          <p className={styles.emptyText}>
            Build a zero-based budget: add your income, group your spending into
            envelopes, then assign every pound until there&rsquo;s nothing left
            to budget.
          </p>
          <div className={styles.actions}>
            <button className={styles.addBtn} onClick={() => setIncomeModal({})}>
              + Add income
            </button>
            <button className={styles.addBtn} onClick={() => setGroupModal({})}>
              + Add group
            </button>
          </div>
        </div>
      )}

      {data && !isEmpty && (
        <div className={styles.layout}>
          <div className={styles.left}>
            <Hero
              incomeTotal={incomeTotal}
              allocated={allocated}
              segments={segments}
              currency={currency}
              factor={factor}
              period={period}
              onPeriodChange={setPeriod}
            />

            <IncomeCard
              incomes={data.incomes}
              currency={currency}
              factor={factor}
              period={period}
              onAdd={() => setIncomeModal({})}
              onEdit={(income) => setIncomeModal({ income })}
            />

            {data.groups.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                currency={currency}
                factor={factor}
                incomeTotal={incomeTotal}
                onEditGroup={(group) => setGroupModal({ group })}
                onAddEnvelope={(groupId) => setEnvModal({ groupId })}
                onEditEnvelope={(envelope) => setEnvModal({ envelope })}
              />
            ))}

            <button className={styles.addBtn} onClick={() => setGroupModal({})}>
              + Add group
            </button>

            <BudgetTrend
              history={data.history}
              currency={currency}
              factor={factor}
              period={period}
            />
          </div>

          <div className={styles.rail}>
            <SafeToSpendCard
              flexRemaining={flexRemaining}
              currency={currency}
              factor={factor}
            />
            <AllocationDonut
              slices={segments.map((s) => ({
                label: s.name,
                value: s.total,
                color: s.color,
              }))}
              allocated={allocated}
              currency={currency}
              factor={factor}
            />
            <SpentSoFarCard
              totalSpent={totalSpent}
              allocated={allocated}
              envelopeCount={envelopeCount}
              currency={currency}
              factor={factor}
            />
          </div>
        </div>
      )}

      {groupModal && (
        <AddGroupModal group={groupModal.group} onClose={() => setGroupModal(null)} />
      )}
      {envModal && (
        <AddEnvelopeModal
          envelope={envModal.envelope}
          groupId={envModal.groupId}
          onClose={() => setEnvModal(null)}
        />
      )}
      {incomeModal && (
        <AddIncomeModal
          income={incomeModal.income}
          onClose={() => setIncomeModal(null)}
        />
      )}
    </div>
  );
}
