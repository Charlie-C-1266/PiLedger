import { createContext } from "react";

export interface PrivacyContextValue {
  /** True when amounts should render as a mask instead of as figures. */
  hidden: boolean;
  toggle: () => void;
}

export const PrivacyContext = createContext<PrivacyContextValue | null>(null);
