import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Screens sit on top: they may use anything, but shared code (components,
    // hooks, lib, ...) must not reach up into a screen's module or stylesheet.
    // What two places need belongs in lib/ or beside the component.
    files: ["src/{api,components,hooks,lib,privacy,theme}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/screens/**"],
              message:
                "Shared code mustn't import from screens/; move what's shared to lib/ or next to the component.",
            },
          ],
        },
      ],
    },
  }
);
