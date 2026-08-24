import { useMemo } from "react";
import { fmt, fmtShort, fmtHidden } from "../lib/currency";
import { usePrivacy } from "./usePrivacy";

export interface Money {
  /** True when the formatters below are returning masks, not figures. */
  hidden: boolean;
  fmt: typeof fmt;
  fmtShort: typeof fmtShort;
}

/**
 * Currency formatters bound to privacy mode: identical to the `lib/currency`
 * pair while amounts are shown, and mask-producing while they're hidden.
 * Components format through this instead of importing `fmt` directly so that
 * flipping the switch re-renders every amount on screen.
 */
export function useMoney(): Money {
  const { hidden } = usePrivacy();

  return useMemo<Money>(() => {
    if (!hidden) return { hidden, fmt, fmtShort };
    const mask = (_value: number, currency = "GBP") => fmtHidden(currency);
    return { hidden, fmt: mask, fmtShort: mask };
  }, [hidden]);
}
