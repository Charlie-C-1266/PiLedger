import { useBudget, useCreateGroup, useCreateIncome } from "../hooks/useBudget";
import { fmt } from "../lib/currency";
import styles from "./Budget.module.css";

/**
 * Phase 6 scaffold. Renders the real budget payload (or an empty state) and
 * wires the two no-argument "add" actions so the screen is demoable end-to-end.
 * The designed hero / income card / group cards / right rail / trend land in
 * the following phases and will replace the placeholder blocks below.
 */
export default function Budget() {
  const { data, isLoading } = useBudget();
  const createIncome = useCreateIncome();
  const createGroup = useCreateGroup();

  const currency = data?.base_currency ?? "GBP";
  const isEmpty = !!data && data.incomes.length === 0 && data.groups.length === 0;

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
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Income</h2>
            {data.incomes.length === 0 && (
              <div className={styles.muted}>No income lines yet.</div>
            )}
            {data.incomes.map((i) => (
              <div key={i.id} className={styles.row}>
                <span>{i.label}</span>
                <span className={styles.num}>{fmt(i.amount, currency)}</span>
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
                    {fmt(e.spent, currency)} / {fmt(e.budgeted, currency)}
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
