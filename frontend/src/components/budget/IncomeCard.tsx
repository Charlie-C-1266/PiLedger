import { updateIncome } from "../../api/client";
import { useBudgetEdit } from "../../hooks/useBudget";
import { fmt } from "../../lib/currency";
import type { BudgetIncome } from "../../types";
import { PlusIcon } from "../icons";
import Stepper from "./Stepper";
import type { Period } from "./period";
import styles from "./IncomeCard.module.css";

const PERIOD_WORD: Record<Period, string> = {
  monthly: "month",
  weekly: "week",
  yearly: "year",
};

interface Props {
  incomes: BudgetIncome[];
  currency: string;
  factor: number;
  period: Period;
  onAdd: () => void;
}

/**
 * Manual income lines — the pot to assign across envelopes. Each row's ±£50
 * stepper edits the monthly amount; the change patches the budget cache live
 * (recomputing the green total here and the hero/balance bar in the parent) and
 * persists debounced. Income is never derived from transactions.
 */
export default function IncomeCard({
  incomes,
  currency,
  factor,
  period,
  onAdd,
}: Props) {
  const { patch, persist } = useBudgetEdit();
  const total = incomes.reduce((s, i) => s + i.amount, 0);
  const show = (v: number) => fmt(v * factor, currency, { decimals: 0 });

  function setAmount(inc: BudgetIncome, amount: number) {
    patch((b) => ({
      ...b,
      incomes: b.incomes.map((i) => (i.id === inc.id ? { ...i, amount } : i)),
    }));
    persist(`income-${inc.id}`, () => updateIncome(inc.id, { amount }));
  }

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>Income</h2>
          <p className={styles.sub}>
            What you have to assign each {PERIOD_WORD[period]}
          </p>
        </div>
        <div className={styles.total}>{show(total)}</div>
      </div>

      <div className={styles.rows}>
        {incomes.map((inc) => (
          <div key={inc.id} className={styles.row}>
            <div className={styles.label}>{inc.label}</div>
            <div className={styles.amount}>{show(inc.amount)}</div>
            <Stepper
              value={inc.amount}
              step={50}
              onChange={(v) => setAmount(inc, v)}
              label={inc.label}
            />
          </div>
        ))}
      </div>

      <button className={styles.addBtn} onClick={onAdd}>
        <PlusIcon /> Add income
      </button>
    </section>
  );
}
