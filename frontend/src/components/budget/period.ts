export type Period = "monthly" | "weekly" | "yearly";

interface PeriodMeta {
  label: string;
  factor: number; // multiplier applied to the stored MONTHLY figures
}

// Budget figures are stored monthly; the period toggle only rescales what's
// shown (weekly ≈ ×0.23, yearly ×12). It never mutates the underlying data, and
// progress-bar ratios stay period-independent.
export const PERIODS: Record<Period, PeriodMeta> = {
  monthly: { label: "Monthly", factor: 1 },
  weekly: { label: "Weekly", factor: 12 / 52 },
  yearly: { label: "Yearly", factor: 12 },
};

export const PERIOD_KEYS: Period[] = ["monthly", "weekly", "yearly"];
