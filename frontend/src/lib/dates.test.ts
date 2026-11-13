import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localIsoDate } from "./dates";

// Node re-reads TZ when it's set, so these run in a timezone ahead of UTC even
// on a UTC machine (CI included).
beforeEach(() => {
  vi.stubEnv("TZ", "Europe/London");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("localIsoDate", () => {
  it("formats a day with zero-padded month and day", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });

  it("reads the local day, not the UTC one, just after midnight", () => {
    // 00:30 BST on 2 July is still 1 July in UTC.
    const justAfterMidnight = new Date("2026-07-01T23:30:00Z");
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(localIsoDate(justAfterMidnight)).toBe("2026-07-02");
  });

  it("defaults to today", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T23:30:00Z"));
    expect(localIsoDate()).toBe("2026-07-02");
  });
});
