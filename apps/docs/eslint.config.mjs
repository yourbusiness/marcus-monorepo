// Docs app (apps/docs) ESLint flat config.
// The repo root config does not parse .vue files, so this config extends it
// and adds Vue SFC support (essential rules + type-aware parsing via
// @typescript-eslint/parser as the inner parser).
import tsParser from "@typescript-eslint/parser";
import vueParser from "vue-eslint-parser";
import pluginVue from "eslint-plugin-vue";
import rootConfig from "../../eslint.config.mjs";

export default [
  {
    name: "docs/ignores",
    // VitePress writes a dependency pre-bundle cache to .vitepress/cache/
    // (regenerated on every dev/build) and a build output to .vitepress/dist/.
    // Neither must be linted. The root config carries these as repo-root-anchored
    // globs ("apps/docs/.vitepress/cache/**"), but ESLint 9 resolves global
    // ignores relative to THIS config file's directory (apps/docs/), so those
    // would match apps/docs/apps/docs/.vitepress/cache/ and miss the real paths.
    // Re-anchor them here, relative to apps/docs/.
    ignores: [".vitepress/cache/**", ".vitepress/dist/**"],
  },
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
