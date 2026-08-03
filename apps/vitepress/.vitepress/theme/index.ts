import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "./styles/index.css";
import BenchmarkChart from "./components/BenchmarkChart.vue";
import ExportDemo from "./components/ExportDemo.vue";
import MockPreview from "./components/MockPreview.vue";
import PackageCards from "./components/PackageCards.vue";
import PackageHighlights from "./components/PackageHighlights.vue";
import StatsBlock from "./components/StatsBlock.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("PackageCards", PackageCards);
    app.component("StatsBlock", StatsBlock);
    app.component("MockPreview", MockPreview);
    app.component("BenchmarkChart", BenchmarkChart);
    app.component("ExportDemo", ExportDemo);
    app.component("PackageHighlights", PackageHighlights);
  },
} satisfies Theme;
