import { useMemo, useState } from "react";
import { useBudget, useCreateIncome } from "../hooks/useBudget";
import Hero from "../components/budget/Hero";
import IncomeCard from "../components/budget/IncomeCard";
import GroupCard from "../components/budget/GroupCard";
import AddGroupModal from "../components/budget/AddGroupModal";
import AddEnvelopeModal from "../components/budget/AddEnvelopeModal";
import { PERIODS, type Period } from "../components/budget/period";
import type { BudgetEnvelope, BudgetGroup } from "../types";
import styles from "./Budget.module.css";

type GroupModal = { group?: BudgetGroup };
type EnvModal = { envelope?: BudgetEnvelope; groupId?: number };

/**
 * Phase 9. The left column is now fully built: hero, income card, and one
 * editable card per envelope group (live sliders + add/edit/delete via modals).
 * The right rail (safe-to-spend, donut, spent-so-far) and trend land next.
 */
export default function Budget() {
  const { data, isLoading } = useBudget();
  const createIncome = useCreateIncome();
  const [period, setPeriod] = useState<Period>("monthly");
  const [groupModal, setGroupModal] = useState<GroupModal | null>(null);
  const [envModal, setEnvModal] = useState<EnvModal | null>(null);

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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Budget</h1>
      </div>

      {isLoading && <div className={styles.empty}>Loading…</div>}

      {isEmpty && (
        <div className={styles.empty}>
          <p className={styles.emptyText}>
            Build a zero-based budget: add your income, group your spending into
            envelopes, then assign every pound until there&rsquo;s nothing left
            to budget.
          </p>
          <div className={styles.actions}>
            <button
              className={styles.addBtn}
              onClick={() => createIncome.mutate({ label: "New income", amount: 0 })}
            >
              + Add income
            </button>
            <button className={styles.addBtn} onClick={() => setGroupModal({})}>
              + Add group
            </button>
          </div>
        </div>
      )}

      {data && !isEmpty && (
        <div className={styles.scaffold}>
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
            onAdd={() => createIncome.mutate({ label: "New income", amount: 0 })}
          />

          {data.groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              currency={currency}
              factor={factor}
              onEditGroup={(group) => setGroupModal({ group })}
              onAddEnvelope={(groupId) => setEnvModal({ groupId })}
              onEditEnvelope={(envelope) => setEnvModal({ envelope })}
            />
          ))}

          <button className={styles.addBtn} onClick={() => setGroupModal({})}>
            + Add group
          </button>
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
    </div>
  );
}
