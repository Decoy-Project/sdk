import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/** The SDK carries its own lint config, so it lints the same in its own repository and inside the DECOY apps. */
export default defineConfig(
  { ignores: ["**/node_modules/**"] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["**/*.ts"],
    languageOptions: { globals: globals.browser },
  },
);
