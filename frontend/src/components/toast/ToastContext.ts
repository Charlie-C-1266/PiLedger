import { createContext } from "react";

export type ToastVariant = "success" | "error";

/** A button on the toast, e.g. Undo. Clicking it dismisses the toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
}

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

export interface ToastContextValue {
  /** Show a green confirmation toast, e.g. after a successful save. Pass an
   *  `action` (such as Undo) to give it a button; it then stays longer. */
  success: (message: string, opts?: ToastOptions) => void;
  /** Show a red error toast — stays a little longer so it can be read. */
  error: (message: string, opts?: ToastOptions) => void;
  /** Dismiss a toast early (used by its close button). */
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
