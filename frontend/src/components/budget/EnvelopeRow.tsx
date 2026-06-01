import { updateEnvelope } from "../../api/client";
import { useBudgetEdit } from "../../hooks/useBudget";
import { fmt } from "../../lib/currency";
import type { BudgetEnvelope } from "../../types";
import HBar from "../charts/HBar";
import styles from "./EnvelopeRow.module.css";

interface Props {
  env: BudgetEnvelope;
  groupColor: string;
  currency: string;
  factor: number;
  onEdit: (env: BudgetEnvelope) => void;
}

/**
 * One envelope: spent/budgeted line, a spend bar (turns red when overspent),
 * and a range slider that sets the budgeted amount. Dragging patches the budget
 * cache live — so the group total, allocated, hero and balance bar all move with
 * it — and persists `PUT /api/budget/envelopes/{id}` debounced. Tapping the
 * label opens the edit modal (label / category / group / delete).
 */
export default function EnvelopeRow({
  env,
  groupColor,
  currency,
  factor,
  onEdit,
}: Props) {
  const { patch, persist } = useBudgetEdit();
  const over = env.spent > env.budgeted;
  // Headroom to drag above the current value, rounded to a tidy £50 step.
  const sliderMax = Math.max(100, Math.ceil((env.budgeted * 2) / 50) * 50);
  const show = (v: number) => fmt(v * factor, currency, { decimals: 0 });

  function setBudgeted(budgeted: number) {
    patch((b) => ({
      ...b,
      groups: b.groups.map((g) =>
        g.id === env.group_id
          ? {
              ...g,
              envelopes: g.envelopes.map((e) =>
                e.id === env.id ? { ...e, budgeted } : e
              ),
            }
          : g
      ),
    }));
    persist(`env-${env.id}`, () => updateEnvelope(env.id, { budgeted }));
  }

  return (
    <div className={styles.row}>
      <div className={styles.top}>
        <button
          className={styles.label}
          onClick={() => onEdit(env)}
          aria-label={`Edit ${env.label}`}
          title="Edit envelope"
        >
          {env.label}
        </button>
        <div className={styles.figures}>
          <span className={`${styles.spent} ${over ? styles.over : ""}`}>
            {show(env.spent)} spent
          </span>
          <span className={styles.budgeted}>{show(env.budgeted)}</span>
        </div>
      </div>
      <div className={styles.barWrap}>
        <HBar
          value={env.spent}
          max={env.budgeted || 1}
          color={over ? "var(--pl-down)" : groupColor}
          height={6}
        />
      </div>
      <input
        type="range"
        className={styles.slider}
        min={0}
        max={sliderMax}
        step={5}
        value={env.budgeted}
        onChange={(e) => setBudgeted(Number(e.target.value))}
        style={{ accentColor: groupColor }}
        aria-label={`${env.label} budgeted amount`}
      />
    </div>
  );
}
