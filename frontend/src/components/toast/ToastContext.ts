import { createContext } from "react";

export type ToastVariant = "success" | "error";

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

export interface ToastContextValue {
  /** Show a green confirmation toast, e.g. after a successful save. */
  success: (message: string) => void;
  /** Show a red error toast — stays a little longer so it can be read. */
  error: (message: string) => void;
  /** Dismiss a toast early (used by its close button). */
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
