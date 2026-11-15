import globals from "globals";

// A safety net, not a style guide: catch names that don't exist and leftovers nobody uses.
// Browser globals that are also ordinary variable names. As globals they hide a forgotten import:
// `toolbar.setCollapsed()` without the import quietly means `window.toolbar` and fails at run time.
const CONFUSING = ["toolbar", "status", "name", "event", "top", "parent", "self", "length", "close", "open", "stop", "find", "print", "focus", "blur", "origin", "menubar", "statusbar", "scrollbars", "locationbar", "personalbar", "frames", "opener", "closed", "external", "scroll"];

export default [
  { ignores: ["dist/", "public/", "node_modules/"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser, ...globals.node, ...Object.fromEntries(CONFUSING.map((n) => [n, "off"])) } },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
      "no-const-assign": "error",
      "no-import-assign": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "warn",
    },
  },
];
