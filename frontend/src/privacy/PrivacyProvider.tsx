import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PrivacyContext } from "./PrivacyContext";

export const STORAGE_KEY = "pl-privacy";

function getInitialHidden(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "hidden";
}

/**
 * Holds the "hide my amounts" switch. Persisted per device (like the theme)
 * rather than on the account, since whether the screen is overlooked is a
 * property of where you're sitting, not of who you are.
 */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(getInitialHidden);

  const toggle = useCallback(() => setHidden((h) => !h), []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, hidden ? "hidden" : "shown");
  }, [hidden]);

  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle]);

  return (
    <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
  );
}
