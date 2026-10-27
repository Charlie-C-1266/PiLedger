import { describe, it, expect } from "vitest";
import {
  buildChartSeries,
  dateTicks,
  dayWithWeekday,
  eventSubline,
  historyDaysFor,
  includesNote,
  lowBalanceLabel,
  lowNote,
  monthEnds,
  nextOccurrence,
  rowKind,
  signedAmount,
  upcoming,
  valueAxis,
} from "./projectionModel";
import { fmt } from "../../lib/currency";
import { AS_OF, addDays, makeProjection } from "../../test/projectionFixture";
import type { AccountBalanceEntry, BalanceProjectionEvent } from "../../types";

const horizon = (p: ReturnType<typeof makeProjection>, months: number) =>
  p.horizons.find((h) => h.months === months)!;

/** A reading stamped at local noon on `day`, so it lands on that day in any TZ. */
function reading(day: string, balance: number): AccountBalanceEntry {
  const [y, m, d] = day.split("-").map(Number);
  return { balance, notes: null, recorded_at: new Date(y, m - 1, d, 12).toISOString() };
}

describe("buildChartSeries", () => {
  it("draws 30, 30, 45 and 90 days of history for the 1/3/6/12-month horizons", () => {
    expect([1, 3, 6, 12].map(historyDaysFor)).toEqual([30, 30, 45, 90]);
    const p = makeProjection({ start: 500 });
    const history = [reading(addDays(AS_OF, -90), 400)];
    for (const months of [1, 3, 6, 12]) {
      const { rows, todayIndex } = buildChartSeries(p, history, horizon(p, months));
      expect(todayIndex).toBe(historyDaysFor(months));
      expect(rows[0].date).toBe(addDays(AS_OF, -historyDaysFor(months)));
      expect(rows[rows.length - 1].date).toBe(horizon(p, months).date);
    }
  });

  it("carries each reading forward as the day's closing balance", () => {
    const p = makeProjection({ start: 300 });
    const history = [
      reading(addDays(AS_OF, -30), 100),
      reading(addDays(AS_OF, -10), 200),
    ];
    const { rows, todayIndex } = buildChartSeries(p, history, horizon(p, 1));
    expect(rows[0].actual).toBe(100);
    expect(rows[19].actual).toBe(100);
    expect(rows[20].actual).toBe(200);
    // Today is where the two lines meet.
    expect(rows[todayIndex]).toMatchObject({ date: AS_OF, actual: 300, projected: 300 });
    expect(rows[todayIndex + 1].actual).toBeUndefined();
  });

  it("starts at the first reading when history began inside the window", () => {
    const p = makeProjection({ start: 300 });
    const { rows, todayIndex } = buildChartSeries(
      p,
      [reading(addDays(AS_OF, -5), 250)],
      horizon(p, 3),
    );
    expect(todayIndex).toBe(5);
    expect(rows[0]).toMatchObject({ i: 0, date: addDays(AS_OF, -5), actual: 250 });
  });

  it("starts at today with no history at all", () => {
    const p = makeProjection({ start: 300 });
    const { rows, todayIndex } = buildChartSeries(p, undefined, horizon(p, 1));
    expect(todayIndex).toBe(0);
    expect(rows[0].date).toBe(AS_OF);
    expect(rows.every((r, k) => r.i === k)).toBe(true);
  });
});

describe("valueAxis", () => {
  it("zooms to the values on round steps", () => {
    const axis = valueAxis([3400, 4300, 3900]);
    expect(axis.min).toBeLessThanOrEqual(3400);
    expect(axis.min).toBeGreaterThan(0);
    expect(axis.max).toBeGreaterThanOrEqual(4300);
    expect(axis.ticks[0]).toBe(axis.min);
    expect(axis.ticks[axis.ticks.length - 1]).toBe(axis.max);
  });

  it("never dips below zero when no value does", () => {
    expect(valueAxis([5, 900]).min).toBe(0);
  });

  it("reaches below zero for an overdrawn projection", () => {
    const axis = valueAxis([200, -150, 50]);
    expect(axis.min).toBeLessThan(-150);
    expect(axis.max).toBeGreaterThan(200);
  });

  it("copes with a flat line", () => {
    const axis = valueAxis([0, 0, 0]);
    expect(axis.max).toBeGreaterThan(axis.min);
  });
});

describe("dateTicks", () => {
  it("marks Mondays at one month and month starts beyond", () => {
    const p = makeProjection();
    const one = buildChartSeries(p, undefined, horizon(p, 1));
    // 26 Oct 2026 is a Monday.
    expect(dateTicks(one.rows, 1).map((t) => t.label)).toEqual([
      "26 Oct",
      "2 Nov",
      "9 Nov",
      "16 Nov",
      "23 Nov",
    ]);
    const twelve = buildChartSeries(p, undefined, horizon(p, 12));
    expect(dateTicks(twelve.rows, 12).map((t) => t.label)).toEqual([
      "Nov",
      "Jan ’27",
      "Mar",
      "May",
      "Jul",
      "Sep",
    ]);
  });
});

describe("lowNote", () => {
  it("says when an account in credit goes overdrawn", () => {
    const p = makeProjection({
      start: 100,
      events: [{ date: addDays(AS_OF, 20), name: "Rent", amount: -400 }],
    });
    const series = buildChartSeries(p, undefined, horizon(p, 3));
    expect(lowNote(series, 3, false)).toEqual({ kind: "overdrawn", date: addDays(AS_OF, 20) });
  });

  it("otherwise gives the horizon's lowest point", () => {
    const p = makeProjection({
      start: 1000,
      events: [
        { date: addDays(AS_OF, 5), name: "Rent", amount: -400 },
        { date: addDays(AS_OF, 8), name: "Pay", amount: 900 },
      ],
    });
    const series = buildChartSeries(p, undefined, horizon(p, 1));
    expect(lowNote(series, 1, false)).toEqual({
      kind: "low",
      phrase: "in the next month",
      balance: 600,
      date: addDays(AS_OF, 5),
      today: false,
    });
  });

  it("notes when the lowest point is today", () => {
    const p = makeProjection({ start: 50 });
    const series = buildChartSeries(p, undefined, horizon(p, 6));
    expect(lowNote(series, 6, false)).toMatchObject({ phrase: "in the next 6 months", today: true });
  });

  it("has nothing to say about a debt", () => {
    const p = makeProjection({ start: 500 });
    expect(lowNote(buildChartSeries(p, undefined, horizon(p, 3)), 3, true)).toBeNull();
    expect(lowNote(buildChartSeries(p, undefined, horizon(p, 3)), 3, true, 900)).toBeNull();
  });

  it("says when the balance drops below the buffer but stays in credit", () => {
    const p = makeProjection({
      start: 400,
      events: [{ date: addDays(AS_OF, 12), name: "Rent", amount: -250 }],
    });
    const series = buildChartSeries(p, undefined, horizon(p, 3));
    expect(lowNote(series, 3, false, 200)).toEqual({
      kind: "buffer",
      threshold: 200,
      date: addDays(AS_OF, 12),
    });
    // Without a buffer it's just the lowest point.
    expect(lowNote(series, 3, false)).toMatchObject({ kind: "low", balance: 150 });
  });

  it("prefers overdrawn over the buffer when the balance goes below zero", () => {
    const p = makeProjection({
      start: 400,
      events: [
        { date: addDays(AS_OF, 4), name: "Rent", amount: -250 },
        { date: addDays(AS_OF, 12), name: "Car", amount: -300 },
      ],
    });
    const series = buildChartSeries(p, undefined, horizon(p, 3));
    expect(lowNote(series, 3, false, 200)).toEqual({ kind: "overdrawn", date: addDays(AS_OF, 12) });
  });

  it("gives the lowest point when the balance starts under the buffer", () => {
    const p = makeProjection({
      start: 150,
      events: [{ date: addDays(AS_OF, 12), name: "Rent", amount: -50 }],
    });
    const series = buildChartSeries(p, undefined, horizon(p, 3));
    expect(lowNote(series, 3, false, 200)).toMatchObject({ kind: "low", balance: 100 });
  });

  it("doesn't warn when the balance only touches the buffer", () => {
    const p = makeProjection({
      start: 400,
      events: [{ date: addDays(AS_OF, 12), name: "Rent", amount: -200 }],
    });
    const series = buildChartSeries(p, undefined, horizon(p, 3));
    expect(lowNote(series, 3, false, 200)).toMatchObject({ kind: "low", balance: 200 });
  });
});

describe("lowBalanceLabel", () => {
  it("names the first low day", () => {
    expect(lowBalanceLabel({ date: "2027-01-14", balance: 150 }, "2026-12-20")).toBe(
      "Low by 14 Jan",
    );
  });

  it("says now when the account is already low", () => {
    expect(lowBalanceLabel({ date: "2026-12-20", balance: 150 }, "2026-12-20")).toBe("Low now");
  });
});

describe("monthEnds", () => {
  it("lists each projected month end and the horizon's last day", () => {
    const p = makeProjection({ start: 10 });
    const series = buildChartSeries(p, [reading(addDays(AS_OF, -40), 5)], horizon(p, 3));
    expect(monthEnds(series).map((r) => r.date)).toEqual([
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
      "2027-01-26",
    ]);
  });
});

describe("upcoming", () => {
  it("covers today and the next 30 days, with the net change by then", () => {
    const p = makeProjection({
      start: 1000,
      events: [
        { date: AS_OF, name: "Gym", amount: -35 },
        { date: addDays(AS_OF, 30), name: "Rent", amount: -500 },
        { date: addDays(AS_OF, 31), name: "Pay", amount: 2000 },
      ],
    });
    const soon = upcoming(p);
    expect(soon.events.map((e) => e.name)).toEqual(["Gym", "Rent"]);
    expect(soon.until).toBe(addDays(AS_OF, 30));
    expect(soon.netChange).toBe(-535);
  });
});

describe("wording", () => {
  const event = (over: Partial<BalanceProjectionEvent>): BalanceProjectionEvent => ({
    date: "2026-11-09",
    subscription_id: 4,
    name: "Netflix",
    kind: "expense",
    frequency: "monthly",
    category: "Entertainment",
    counterparty_name: null,
    amount: -10.99,
    auto_post: true,
    balance_after: 100,
    ...over,
  });

  it("describes an upcoming row by frequency and category or the other account", () => {
    expect(eventSubline(event({}))).toBe("Monthly · Entertainment");
    expect(eventSubline(event({ frequency: "annual", category: "Transport" }))).toBe(
      "Yearly · Transport",
    );
    expect(
      eventSubline(event({ kind: "transfer", counterparty_name: "Rainy day", amount: -400 })),
    ).toBe("Monthly · To Rainy day");
    expect(
      eventSubline(event({ kind: "transfer", counterparty_name: "Household", amount: 400 })),
    ).toBe("Monthly · From Household");
  });

  it("finds the same item's next occurrence", () => {
    const first = event({});
    const events = [first, event({ subscription_id: 5, date: "2026-11-15" }), event({ date: "2026-12-09" })];
    expect(nextOccurrence(events, first)).toBe("2026-12-09");
    expect(nextOccurrence(events, events[2])).toBeNull();
  });

  it("names the rate only when the account earns interest", () => {
    expect(includesNote(4.1, false)).toBe(
      "Projections use this account's scheduled transactions and 4.10% interest, paid monthly. One-off spending isn't predicted.",
    );
    expect(includesNote(0, false)).toBe(
      "Projections use this account's scheduled transactions. One-off spending isn't predicted.",
    );
    expect(includesNote(19.9, true)).not.toMatch(/interest/);
  });

  it("formats dates, kinds and signed amounts", () => {
    expect(dayWithWeekday("2026-11-09")).toBe("Mon 9 Nov 2026");
    expect([rowKind(2, 5), rowKind(5, 5), rowKind(6, 5)]).toEqual(["actual", "today", "projected"]);
    expect(signedAmount(-10.99, "GBP", fmt)).toBe("−£10.99");
    expect(signedAmount(2850, "GBP", fmt)).toBe("+£2,850.00");
  });
});
