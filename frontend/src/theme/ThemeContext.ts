import { createContext } from "react";
import type { ThemeTokens } from "./tokens";

export interface ThemeContextValue {
  mode: "light" | "dark";
  accent: string;
  theme: ThemeTokens & { accent: string; accentSoft: string };
  toggleMode: () => void;
  setAccent: (hex: string) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
