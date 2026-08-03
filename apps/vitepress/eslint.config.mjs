// Docs app (apps/vitepress) ESLint flat config.
// The repo root config does not parse .vue files, so this config extends it
// and adds Vue SFC support (essential rules + type-aware parsing via
// @typescript-eslint/parser as the inner parser).
import tsParser from "@typescript-eslint/parser";
import vueParser from "vue-eslint-parser";
import pluginVue from "eslint-plugin-vue";
import rootConfig from "../../eslint.config.mjs";

export default [
  ...rootConfig,
  {
    name: "docs/vue",
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: "latest",
        sourceType: "module",
        projectService: true,
        extraFileExtensions: [".vue"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      vue: pluginVue,
    },
    rules: {
      ...pluginVue.configs["flat/essential"].rules,
    },
  },
];
