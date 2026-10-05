import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import tseslint from "typescript-eslint";

// Obsidian's community directory scores the plugin with `recommended`, so every
// finding of those rules is a public scorecard row. Additions below only make
// the local gate stricter, never looser.
//
// The overrides are limited to script files. `recommended` also lints
// `package.json` (without the TypeScript plugin), and an unscoped
// `@typescript-eslint/*` rule there is a fatal ESLint error, which is what
// Obsidian's whole-repository scan runs into.
const SCRIPT_FILES = ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"];
// Tests and build scripts never ship, so the scorecard rules do not apply to them: they get a looser set of their own
// (typescript-eslint's recommended rules), so dead code and mistakes there are still caught.
const LOOSER_FILES = ["tests/**/*.{ts,tsx,mts}", "scripts/**/*.{js,mjs}"];
const LOOSER_DIRS = ["tests/**", "scripts/**"];
const notLooser = (config) => ({ ...config, ignores: [...(config.ignores ?? []), ...LOOSER_DIRS] });

export default defineConfig([
  globalIgnores(["dist/", "dist-page/", "node_modules/", "vendor/", "docs/", "vite/", "*.js", "*.cjs", "*.mjs", "*.config.mts", "*.config.ts"]),
  ...obsidianmd.configs.recommended.map(notLooser),
  {
    files: SCRIPT_FILES,
    ignores: LOOSER_DIRS,
    rules: {
      // "Atlas" is the product name. `ignoreWords` rather than `brands`,
      // because `brands` replaces the rule's built-in list (Obsidian, GitHub, …).
      "obsidianmd/ui/sentence-case": ["warn", { ignoreWords: ["Atlas", "VTT", "Connect", "PeerJS", "TURN", "STUN", "GM"] }],
      // Stricter than the scorecard: type errors are fixed, not silenced.
      "@typescript-eslint/ban-ts-comment": ["error", {
        "ts-ignore": true,
        "ts-nocheck": true,
        "ts-expect-error": true,
      }],
      // A `title` attribute shows the browser's tooltip. Atlas shows its own
      // (`LabelTooltip`) where one is wanted and names controls with `aria-label`.
      "no-restricted-syntax": ["error",
        {
          selector: "JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name='title']",
          message: "`title` shows the browser tooltip. Use `aria-label`, or `LabelTooltip` for a visible tooltip.",
        },
        {
          selector: "CallExpression[callee.property.name=/^(setAttribute|setAttr)$/][arguments.0.value='title']",
          message: "`title` shows the browser tooltip. Use `aria-label`, or `LabelTooltip` for a visible tooltip.",
        },
        {
          selector: "Property[key.name='attr'] > ObjectExpression > Property[key.name='title']",
          message: "`title` shows the browser tooltip. Use `aria-label`, or `LabelTooltip` for a visible tooltip.",
        },
        {
          selector: "AssignmentExpression > MemberExpression.left[property.name='title'][object.type!='ThisExpression']:not([object.name=/^(doc|document)$/])",
          message: "`title` shows the browser tooltip. Use `aria-label`, or `LabelTooltip` for a visible tooltip.",
        },
      ],
    },
  },
  {
    // The join page's DOM code (`online-client/`) also runs inside Obsidian (the Canvas scene tab): it is linted in
    // place. It is written for a plain web page, which has no `createEl`, so only Obsidian's DOM rules are off.
    files: ["online-client/**"],
    rules: { "obsidianmd/prefer-create-el": "off" },
  },
  {
    // The page's own entry, its saved-images panel and the shim that gives a plain page Obsidian's globals run only in
    // a browser, where `localStorage` and `globalThis` are the right names.
    files: ["online-client/main.mts", "online-client/assetsPanel.mts", "online-client/dice3d/obsidianShim.mts"],
    rules: { "no-restricted-globals": "off", "obsidianmd/no-global-this": "off" },
  },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: LOOSER_FILES })),
  {
    files: LOOSER_FILES,
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Fakes and fixtures cast freely to build partial Atlas and Obsidian objects.
      "@typescript-eslint/no-explicit-any": "off",
      // `_name` marks a value taken apart on purpose (`const { a: _a, ...rest } = …`).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  {
    files: SCRIPT_FILES,
    ignores: LOOSER_DIRS,
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    linterOptions: {
      // Findings are fixed at their root. An accepted exception is recorded in
      // eslint.suppressions.json, where a review sees it, never in a comment.
      // The file is not at ESLint's default location on purpose: Obsidian's
      // directory review runs ESLint with its own rule set, and a suppression
      // that set does not use makes ESLint exit 2, which the review reports
      // as a fatal error. Only npm run lint passes --suppressions-location.
      noInlineConfig: true,
    },
  },
]);
