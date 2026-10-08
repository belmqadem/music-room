// Root ESLint config (flat). Covers backend/ and shared/.
// mobile/ has its own eslint.config.js because it needs eslint-config-expo.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "mobile/**", // linted by mobile/eslint.config.js
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // Unused args prefixed with _ are intentional (e.g. Express error handlers).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier, // must be last: turns off rules that conflict with Prettier
);
