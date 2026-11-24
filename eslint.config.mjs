import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";
import prettier from "eslint-config-prettier/flat";
import playwright from "eslint-plugin-playwright";
import vue from "eslint-plugin-vue";
import vuePug from "eslint-plugin-vue-pug";

export default defineConfig(
  {
    ignores: [
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/.vercel/**",
      "apps/api/static/**",
    ],
  },
  {
    ignores: ["apps/customer/**", "apps/backoffice/**/*.vue"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      {
        files: ["**/*.ts"],
        languageOptions: {
          parserOptions: {
            projectService: true,
            tsconfigRootDir: import.meta.dirname,
          },
        },
        rules: {
          "@typescript-eslint/consistent-type-definitions": ["error", "type"],
          "@typescript-eslint/no-confusing-void-expression": "off",
          "@typescript-eslint/no-non-null-assertion": "error",
          "@typescript-eslint/restrict-template-expressions": [
            "error",
            { allowNumber: true },
          ],
        },
      },
      {
        ...tseslint.configs.disableTypeChecked,
        files: ["**/*.js", "**/*.mjs"],
      },
      {
        files: ["**/*.mjs"],
        languageOptions: {
          globals: {
            Buffer: "readonly",
            URL: "readonly",
            console: "readonly",
            process: "readonly",
            setInterval: "readonly",
            clearInterval: "readonly",
          },
        },
      },
    ],
  },
  {
    files: ["apps/customer/**/*.{ts,vue,js,mjs}", "apps/backoffice/**/*.vue"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...vue.configs["flat/recommended"],
      ...vuePug.configs["flat/recommended"],
      {
        ...playwright.configs["flat/recommended"],
        files: ["apps/customer/e2e/tests/**/*.spec.ts"],
      },
      {
        ...vitest.configs.recommended,
        files: ["apps/customer/src/**/__tests__/**/*.spec.ts"],
      },
      {
        files: ["apps/customer/src/**/__tests__/**/*.spec.ts"],
        rules: { "vue/one-component-per-file": "off" },
      },
      {
        files: ["**/*.vue"],
        languageOptions: { parserOptions: { parser: tseslint.parser } },
        rules: {
          "vue/component-name-in-template-casing": [
            "error",
            "PascalCase",
            { registeredComponentsOnly: false, ignores: ["/^base-/"] },
          ],
          "vue/multi-word-component-names": ["error", { ignores: ["app"] }],
          "vue/require-default-prop": "off",
        },
      },
      {
        files: ["**/*.{ts,vue}"],
        rules: {
          "@typescript-eslint/consistent-type-definitions": ["error", "type"],
          "@typescript-eslint/consistent-type-imports": "error",
          // TypeScript checks names (including DOM types) in customer TS and Vue files.
          "no-undef": "off",
          "@typescript-eslint/array-type": "error",
          "@typescript-eslint/no-unused-vars": [
            "error",
            { ignoreRestSiblings: true },
          ],
        },
      },
      prettier,
    ],
  },
);
