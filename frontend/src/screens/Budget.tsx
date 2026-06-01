import { useMemo, useState } from "react";
import { useBudget, useCreateGroup, useCreateIncome } from "../hooks/useBudget";
import Hero from "../components/budget/Hero";
import { PERIODS, type Period } from "../components/budget/period";
import { fmt } from "../lib/currency";
import styles from "./Budget.module.css";

/**
 * Phase 7 scaffold. The designed hero (Left-to-budget + period toggle +
 * allocation balance bar + stat row) now sits at the top; the income card and
 * envelope group cards below remain placeholder lists that the next phases
 * replace. The two no-argument "add" actions keep the screen demoable.
 */
export default function Budget() {
  const { data, isLoading } = useBudget();
  const createIncome = useCreateIncome();
  const createGroup = useCreateGroup();
  const [period, setPeriod] = useState<Period>("monthly");

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
            <button
              className={styles.addBtn}
              onClick={() => createGroup.mutate({ name: "New group" })}
            >
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

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Income</h2>
            {data.incomes.length === 0 && (
              <div className={styles.muted}>No income lines yet.</div>
            )}
            {data.incomes.map((i) => (
              <div key={i.id} className={styles.row}>
                <span>{i.label}</span>
                <span className={styles.num}>{fmt(i.amount * factor, currency)}</span>
              </div>
            ))}
            <button
              className={styles.addBtnSmall}
              onClick={() => createIncome.mutate({ label: "New income", amount: 0 })}
            >
              + Add income
            </button>
          </section>

          {data.groups.map((g) => (
            <section key={g.id} className={styles.card}>
              <h2 className={styles.cardTitle}>
                <span className={styles.swatch} style={{ background: g.color }} />
                {g.name}
                <span className={styles.tag}>{g.flexible ? "Flexible" : "Fixed"}</span>
              </h2>
              {g.envelopes.length === 0 && (
                <div className={styles.muted}>No envelopes yet.</div>
              )}
              {g.envelopes.map((e) => (
                <div key={e.id} className={styles.row}>
                  <span>{e.label}</span>
                  <span className={styles.num}>
                    {fmt(e.spent * factor, currency)} /{" "}
                    {fmt(e.budgeted * factor, currency)}
                  </span>
                </div>
              ))}
            </section>
          ))}

          <button
            className={styles.addBtn}
            onClick={() => createGroup.mutate({ name: "New group" })}
          >
            + Add group
          </button>
        </div>
      )}
    </div>
  );
}
