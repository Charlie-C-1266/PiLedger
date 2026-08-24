import { useContext } from "react";
import { PrivacyContext, type PrivacyContextValue } from "./PrivacyContext";

/** Outside a provider nothing can be toggled, so amounts simply stay visible. */
const VISIBLE: PrivacyContextValue = { hidden: false, toggle: () => {} };

/**
 * Privacy mode — whether amounts are masked. Unlike `useTheme` this does *not*
 * throw without a provider: a component (or a unit test) rendered on its own
 * falls back to showing real figures, so masking stays a pure enhancement.
 */
export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext) ?? VISIBLE;
}
