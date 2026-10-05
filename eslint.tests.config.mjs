import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// The tests and build scripts, linted on their own (`npm run lint` runs this after eslint.config.mjs). They never
// ship, so the Obsidian scorecard rules do not apply; typescript-eslint's recommended set still catches dead code and
// mistakes there. Kept out of eslint.config.mjs so the directory's own scan of the repository sees nothing new.
const FILES = ["tests/**/*.{ts,tsx,mts}", "scripts/**/*.{js,mjs}"];

export default defineConfig([
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: FILES })),
  {
    files: FILES,
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Fakes and fixtures cast freely to build partial Atlas and Obsidian objects.
      "@typescript-eslint/no-explicit-any": "off",
      // `_name` marks a value taken apart on purpose (`const { a: _a, ...rest } = …`).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
]);
