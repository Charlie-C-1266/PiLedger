import type {
  AccountBalanceEntry,
  BalanceProjection,
  BalanceProjectionEvent,
  BalanceProjectionHorizon,
  Frequency,
} from "../../types";

/**
 * Pure helpers behind the account page's projection half: the chart's rows and
 * axes, the horizon and Upcoming wording, and the low-point note. The server
 * does every month calculation (horizon dates, interest, occurrences); these
 * only slice its daily points, step whole days back for the actual history,
 * and format dates.
 */

/** The horizon tile selected when the page opens. */
export const DEFAULT_HORIZON = 3;

/** Days of actual history drawn before "Today", by horizon (in months). */
const HISTORY_DAYS: Record<number, number> = { 1: 30, 3: 30, 6: 45, 12: 90 };

/** The longest stretch of history any horizon draws, so one request serves all. */
export const MAX_HISTORY_DAYS = 90;

export function historyDaysFor(months: number): number {
  return HISTORY_DAYS[months] ?? MAX_HISTORY_DAYS;
}

/** Upcoming covers today and the next 30 days, and lists the first 7. */
export const UPCOMING_DAYS = 30;
export const UPCOMING_LIMIT = 7;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A `YYYY-MM-DD` (or longer ISO) date as a local calendar day, no TZ shift. */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** A local calendar day as `YYYY-MM-DD`. */
export function isoDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** "9 Nov" */
export function dayShort(iso: string): string {
  const d = parseDay(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "9 Nov 2026" */
export function dayLong(iso: string): string {
  const d = parseDay(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Mon 9 Nov 2026" */
export function dayWithWeekday(iso: string): string {
  return `${WEEKDAYS[parseDay(iso).getDay()]} ${dayLong(iso)}`;
}

/** The date badge's two lines: day of the month and short month. */
export function dayParts(iso: string): { day: number; month: string } {
  const d = parseDay(iso);
  return { day: d.getDate(), month: MONTHS[d.getMonth()] };
}

/** "−£10.99" / "+£2,850.00": always signed, like a transaction row (privacy
 * mode keeps the sign: "+£****"). */
export function signedAmount(
  amount: number,
  currency: string,
  fmt: (value: number, currency?: string) => string,
): string {
  return `${amount >= 0 ? "+" : "−"}${fmt(Math.abs(amount), currency).replace(/^[−-]/, "")}`;
}

/** "In 1 month", "In 3 months". */
export function horizonLabel(months: number): string {
  return months === 1 ? "In 1 month" : `In ${months} months`;
}

/** "in the next month", "in the next 3 months". */
function horizonPhrase(months: number): string {
  return months === 1 ? "in the next month" : `in the next ${months} months`;
}

const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Yearly",
};

/** An upcoming row's sub-line: "Monthly · Bills", or for a transfer the other
 * account ("Monthly · To Rainy day"). */
export function eventSubline(event: BalanceProjectionEvent): string {
  const freq = FREQUENCY_LABELS[event.frequency] ?? event.frequency;
  let detail = event.category;
  if (event.kind === "transfer" && event.counterparty_name) {
    detail = `${event.amount < 0 ? "To" : "From"} ${event.counterparty_name}`;
  } else if (!detail) {
    detail = event.kind === "income" ? "Income" : event.kind === "interest" ? "Interest" : "Payment";
  }
  return `${freq} · ${detail}`;
}

/** A row only scheduled items have: projected interest isn't one, so it has
 * nothing to post, skip or edit. */
export function isScheduled(event: BalanceProjectionEvent): boolean {
  return event.kind !== "interest" && event.subscription_id != null;
}

/** The same item's next occurrence after `event` in the projection, if any. */
export function nextOccurrence(
  events: BalanceProjectionEvent[],
  event: BalanceProjectionEvent,
): string | null {
  const next = events.find(
    (e) => e.subscription_id === event.subscription_id && e.date > event.date,
  );
  return next?.date ?? null;
}

// ─── Upcoming ────────────────────────────────────────────────────────────────

export interface UpcomingSummary {
  /** Every event from today to the window's last day, in date order. */
  events: BalanceProjectionEvent[];
  /** The window's last day (today + 30). */
  until: string;
  /** Closing balance on `until` minus today's balance. */
  netChange: number;
}

/** The Upcoming card's window: the projection's events over today and the next
 * 30 days. The window's end is a projection point, so no date maths here. */
export function upcoming(projection: BalanceProjection): UpcomingSummary {
  const end = projection.points[Math.min(UPCOMING_DAYS, projection.points.length - 1)];
  const until = end?.date ?? projection.as_of;
  return {
    events: projection.events.filter((e) => e.date <= until),
    until,
    netChange: (end?.balance ?? projection.start_balance) - projection.start_balance,
  };
}

// ─── Chart ───────────────────────────────────────────────────────────────────

export interface ChartRow {
  /** Position on the x axis (one per day). */
  i: number;
  date: string;
  /** Closing balance on a past day (and today, where the two lines meet). */
  actual?: number;
  /** Projected closing balance today and after. */
  projected?: number;
}

export interface ChartSeries {
  rows: ChartRow[];
  /** Index of today's row: the last actual and the first projected point. */
  todayIndex: number;
}

/** Each past day's closing balance: the latest reading recorded on or before
 * it (readings are UTC timestamps, read as local days). Undefined before the
 * first reading. */
function closingBalances(history: AccountBalanceEntry[], days: string[]): (number | undefined)[] {
  const readings = history
    .map((h) => ({ day: isoDay(new Date(h.recorded_at)), balance: h.balance }))
    .filter((r) => !Number.isNaN(parseDay(r.day).getTime()))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let next = 0;
  let last: number | undefined;
  return days.map((day) => {
    while (next < readings.length && readings[next].day <= day) {
      last = readings[next].balance;
      next += 1;
    }
    return last;
  });
}

/**
 * The chart's rows for one horizon: `historyDays` of actual closing balances
 * up to yesterday (leading days before the first reading are dropped), today
 * as the point both lines share, then the projection up to the horizon's date.
 */
export function buildChartSeries(
  projection: BalanceProjection,
  history: AccountBalanceEntry[] | undefined,
  horizon: Pick<BalanceProjectionHorizon, "date" | "months">,
): ChartSeries {
  const today = parseDay(projection.as_of);
  const past: string[] = [];
  for (let k = historyDaysFor(horizon.months); k >= 1; k -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - k);
    past.push(isoDay(d));
  }
  const closing = closingBalances(history ?? [], past);
  const firstKnown = closing.findIndex((b) => b !== undefined);
  const rows: ChartRow[] = [];
  if (firstKnown >= 0) {
    for (let k = firstKnown; k < past.length; k += 1) {
      rows.push({ i: rows.length, date: past[k], actual: closing[k] });
    }
  }
  const todayIndex = rows.length;
  rows.push({
    i: todayIndex,
    date: projection.as_of,
    actual: projection.start_balance,
    projected: projection.start_balance,
  });
  for (const p of projection.points) {
    if (p.date <= projection.as_of || p.date > horizon.date) continue;
    rows.push({ i: rows.length, date: p.date, projected: p.balance });
  }
  return { rows, todayIndex };
}

/** The balance a row stands for, whichever line it's on. */
export function rowValue(row: ChartRow): number {
  return row.actual ?? row.projected ?? 0;
}

/** Whether a row is a past day, today, or a projected one — for the tooltip. */
export function rowKind(index: number, todayIndex: number): "actual" | "today" | "projected" {
  if (index < todayIndex) return "actual";
  return index === todayIndex ? "today" : "projected";
}

export interface ValueAxis {
  min: number;
  max: number;
  ticks: number[];
}

/** A y axis with a few round steps around the values, padded a little either
 * side. It never dips below zero when no value does. */
export function valueAxis(values: number[]): ValueAxis {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(hi - lo, Math.abs(hi) * 0.05, 50);
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  let min = Math.floor((lo - span * 0.08) / step) * step;
  const max = Math.ceil((hi + span * 0.08) / step) * step;
  if (lo >= 0 && min < 0) min = 0;
  const ticks: number[] = [];
  for (let k = 0; min + k * step <= max + step / 1e6; k += 1) {
    ticks.push(Number((min + k * step).toFixed(6)));
  }
  return { min, max, ticks };
}

/** Candidate x-axis ticks (row indices) with their labels: Mondays for the
 * one-month view, the 1st of each month otherwise (every other month at 12).
 * Recharts drops any that would overlap. */
export function dateTicks(rows: ChartRow[], months: number): { index: number; label: string }[] {
  const out: { index: number; label: string }[] = [];
  if (months <= 1) {
    for (const r of rows) {
      if (parseDay(r.date).getDay() === 1) out.push({ index: r.i, label: dayShort(r.date) });
    }
    return out;
  }
  const every = months <= 6 ? 1 : 2;
  let seen = 0;
  for (const r of rows.slice(1)) {
    const d = parseDay(r.date);
    if (d.getDate() !== 1) continue;
    if (seen++ % every) continue;
    const year = d.getMonth() === 0 ? ` ’${String(d.getFullYear()).slice(2)}` : "";
    out.push({ index: r.i, label: `${MONTHS[d.getMonth()]}${year}` });
  }
  return out;
}

/** The lowest projected point from today on: the first day it's reached. */
export function lowPoint(series: ChartSeries): number {
  const { rows, todayIndex } = series;
  let low = todayIndex;
  for (let k = todayIndex; k < rows.length; k += 1) {
    if (rowValue(rows[k]) < rowValue(rows[low])) low = k;
  }
  return low;
}

/** Projected month-end balances (and the horizon's last day) for the chart's
 * visually hidden table. */
export function monthEnds(series: ChartSeries): ChartRow[] {
  const { rows, todayIndex } = series;
  return rows.filter(
    (_r, k) =>
      k >= todayIndex && (k === rows.length - 1 || rows[k + 1].date.endsWith("-01")),
  );
}

export type LowNote =
  /** "Goes overdrawn on 27 Jan." */
  | { kind: "overdrawn"; date: string }
  /** "Lowest point in the next 3 months: £x on 2 Nov." */
  | { kind: "low"; phrase: string; balance: number; date: string; today: boolean };

/**
 * What the note under the chart says about the selected horizon. An account
 * that's in credit today but dips below zero "goes overdrawn" on its first
 * negative day; otherwise the note gives the lowest point. Debt accounts hold
 * the amount owed, where neither reading applies, so they get none.
 */
export function lowNote(series: ChartSeries, months: number, isDebt: boolean): LowNote | null {
  if (isDebt) return null;
  const { rows, todayIndex } = series;
  if (rowValue(rows[todayIndex]) >= 0) {
    const negative = rows.findIndex((r, k) => k > todayIndex && rowValue(r) < 0);
    if (negative >= 0) return { kind: "overdrawn", date: rows[negative].date };
  }
  const low = lowPoint(series);
  return {
    kind: "low",
    phrase: horizonPhrase(months),
    balance: rowValue(rows[low]),
    date: rows[low].date,
    today: low === todayIndex,
  };
}

/** The sentence on what a projection includes, naming the interest rate when
 * the account earns any (debt accounts earn none in the projection). */
export function includesNote(rate: number | null | undefined, isDebt: boolean): string {
  const interest =
    !isDebt && rate && rate > 0 ? ` and ${rate.toFixed(2)}% interest, paid monthly` : "";
  return `Projections use this account's scheduled transactions${interest}. One-off spending isn't predicted.`;
}
