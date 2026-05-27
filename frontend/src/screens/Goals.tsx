import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "../theme/useTheme";
import { useGoals } from "../hooks/useGoals";
import { useSummary } from "../hooks/useSummary";
import { updateGoal } from "../api/client";
import { fmt } from "../lib/currency";
import HBar from "../components/charts/HBar";
import type { Goal } from "../types";
import styles from "./Goals.module.css";

function etaLabel(target: number, saved: number, monthly: number): string {
  if (monthly <= 0) return "No monthly contribution set";
  const remaining = target - saved;
  if (remaining <= 0) return "Goal reached!";
  const months = Math.ceil(remaining / monthly);
  return `Finished in ${months} month${months !== 1 ? "s" : ""}`;
}

function GoalCard({ goal, currency }: { goal: Goal; currency: string }) {
  const { mode } = useTheme();
  const [monthly, setMonthly] = useState(goal.monthly);
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation({
    mutationFn: (val: number) => updateGoal(goal.id, { monthly: val }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goals"] }),
  });

  const handleSlider = useCallback(
    (val: number) => {
      setMonthly(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => mutation.mutate(val), 400);
    },
    [mutation]
  );

  const pct = goal.target > 0 ? (goal.saved / goal.target) * 100 : 0;
  const badgeBg =
    mode === "light"
      ? `color-mix(in oklab, ${goal.color}, white 80%)`
      : `color-mix(in oklab, ${goal.color}, black 50%)`;

  return (
    <div className={styles.card}>
      {/* Top row */}
      <div className={styles.topRow}>
        <div>
          <div className={styles.goalName}>{goal.name}</div>
          <div className={styles.eta}>
            {etaLabel(goal.target, goal.saved, monthly)}
          </div>
        </div>
        <div
          className={styles.badge}
          style={{ background: badgeBg, color: goal.color }}
        >
          {pct.toFixed(0)}%
        </div>
      </div>

      {/* Progress */}
      <div className={styles.progress}>
        <div className={styles.amounts}>
          <span>{fmt(goal.saved, currency)}</span>
          <span>{fmt(goal.target, currency)}</span>
        </div>
        <HBar value={goal.saved} max={goal.target} color={goal.color} height={8} />
      </div>

      {/* Contribution editor */}
      <div className={styles.editor}>
        <div className={styles.editorRow}>
          <span className={styles.editorLabel}>Monthly contribution</span>
          <span className={styles.editorValue} style={{ color: goal.color }}>
            {fmt(monthly, currency)}
          </span>
        </div>
        <input
          type="range"
          className={styles.slider}
          min={0}
          max={800}
          step={10}
          value={monthly}
          onChange={(e) => handleSlider(Number(e.target.value))}
          style={{ accentColor: goal.color }}
        />
        <div className={styles.editorFooter}>
          {etaLabel(goal.target, goal.saved, monthly)}
        </div>
      </div>
    </div>
  );
}

export default function Goals() {
  const { data: goals } = useGoals();
  const { data: summary } = useSummary();
  const currency = summary?.base_currency ?? "GBP";

  return (
    <div className={styles.grid}>
      {(goals ?? []).map((g) => (
        <GoalCard key={g.id} goal={g} currency={currency} />
      ))}
      {goals?.length === 0 && (
        <div className={styles.empty}>
          No goals yet. Create one to start tracking your savings.
        </div>
      )}
    </div>
  );
}
