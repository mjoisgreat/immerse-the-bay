import globals from "globals";

// A safety net, not a style guide: catch names that don't exist and leftovers nobody uses.
export default [
  { ignores: ["dist/", "public/", "node_modules/"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser, ...globals.node } },
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
