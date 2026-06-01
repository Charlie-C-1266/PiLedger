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
  /** Monthly income total — the zero-based ceiling for the budget slider. */
  incomeTotal: number;
  onEdit: (env: BudgetEnvelope) => void;
}

/** Floor for the slider's range so it stays usable before any income is set. */
const SLIDER_FLOOR = 1000;

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
  incomeTotal,
  onEdit,
}: Props) {
  const { patch, persist } = useBudgetEdit();
  const over = env.spent > env.budgeted;
  // A single envelope tops out at the whole income (the zero-based ceiling),
  // with a floor so the control still works before any income is entered. The
  // ceiling is independent of the live `budgeted` value — deriving it from
  // `budgeted` (as the design prototype did) made dragging right ratchet the
  // max ever higher, so each pull doubled the amount into the billions. The
  // current value is folded in only so an over-income budget set in the modal
  // stays representable; rounded up to a tidy £100.
  const ceiling = Math.max(incomeTotal, env.budgeted, SLIDER_FLOOR);
  const sliderMax = Math.ceil(ceiling / 100) * 100;
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
