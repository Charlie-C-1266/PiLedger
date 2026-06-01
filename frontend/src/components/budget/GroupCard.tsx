import { fmt } from "../../lib/currency";
import type { BudgetEnvelope, BudgetGroup } from "../../types";
import { PlusIcon } from "../icons";
import EnvelopeRow from "./EnvelopeRow";
import styles from "./GroupCard.module.css";

interface Props {
  group: BudgetGroup;
  currency: string;
  factor: number;
  /** Monthly income total — the zero-based ceiling for the envelope sliders. */
  incomeTotal: number;
  onEditGroup: (group: BudgetGroup) => void;
  onAddEnvelope: (groupId: number) => void;
  onEditEnvelope: (env: BudgetEnvelope) => void;
}

/**
 * One envelope group: a coloured swatch, name, Fixed/Flexible tag and the
 * group's budgeted total, over a list of its envelopes and an "Add envelope"
 * action. The group's colour themes its envelope sliders and bars.
 */
export default function GroupCard({
  group,
  currency,
  factor,
  incomeTotal,
  onEditGroup,
  onAddEnvelope,
  onEditEnvelope,
}: Props) {
  const total = group.envelopes.reduce((s, e) => s + e.budgeted, 0);

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <div className={styles.heading}>
          <span className={styles.swatch} style={{ background: group.color }} />
          <h2 className={styles.name}>{group.name}</h2>
          <span className={styles.tag}>{group.flexible ? "Flexible" : "Fixed"}</span>
        </div>
        <div className={styles.headRight}>
          <span className={styles.total}>
            {fmt(total * factor, currency, { decimals: 0 })}
          </span>
          <button
            className={styles.editBtn}
            onClick={() => onEditGroup(group)}
            aria-label={`Edit ${group.name}`}
          >
            Edit
          </button>
        </div>
      </div>

      <div className={styles.rows}>
        {group.envelopes.map((e) => (
          <EnvelopeRow
            key={e.id}
            env={e}
            groupColor={group.color}
            currency={currency}
            factor={factor}
            incomeTotal={incomeTotal}
            onEdit={onEditEnvelope}
          />
        ))}
        {group.envelopes.length === 0 && (
          <div className={styles.empty}>No envelopes in this group yet.</div>
        )}
      </div>

      <button className={styles.addBtn} onClick={() => onAddEnvelope(group.id)}>
        <PlusIcon /> Add envelope
      </button>
    </section>
  );
}
