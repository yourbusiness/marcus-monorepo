import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import type { Component } from "vue";
import "./styles/index.css";

// Auto-register every SFC in components/, so adding a demo/card component does
// not require touching this file.
const components = import.meta.glob<{ default: Component }>(
  "./components/*.vue",
  { eager: true },
);

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    for (const [filePath, mod] of Object.entries(components)) {
      const name = filePath
        .split("/")
        .pop()
        ?.replace(/\.vue$/, "");
      if (name) app.component(name, mod.default);
    }
  },
} satisfies Theme;
