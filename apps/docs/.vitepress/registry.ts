import excelExporterPkg from "@marcusok/excel-exporter/package.json" with { type: "json" };

export interface LocalizedText {
  zh: string;
  en: string;
}

/** One number card on the home page stats block, contributed by a package. */
export interface HomeStat {
  key: string;
  value: number;
  decimals: number;
  zh: string;
  en: string;
  suffix?: string;
}

/** One feature card on the home page highlights section. */
export interface PackageHighlight {
  icon: string;
  title: LocalizedText;
  details: LocalizedText;
}

/** A sidebar group for a package; `id` is the sub-directory under packages/<dir>/. */
export interface PackageSection {
  id: string;
  label: LocalizedText;
  collapsed?: boolean;
}

/** A dist asset (wasm, worker, ...) copied into public/ at build time. */
export interface RuntimeAsset {
  resolveFrom: string;
  /**
   * Optional: resolve `resolveFrom` within another package's dependency
   * context (via createRequire). Use this for peer-dep assets (e.g. a wasm
   * shipped by modern-xlsx, which is a peerDep of excel-exporter) so the
   * docs app does not need to list the asset's source package as a direct
   * dependency — pnpm auto-install-peers makes it resolvable transitively.
   */
  through?: string;
  /** File path within the resolved package directory. */
  file: string;
  /** Destination path relative to the docs public/ directory. */
  to: string;
}

/** One series (legend entry + bar color) in a benchmark chart. */
export interface BenchmarkSeriesDef {
  /** Unique key within this chart; must match a key in BenchmarkBar.values. */
  key: string;
  /** Localized legend label. */
  label: LocalizedText;
  /** CSS color for bars; falls back to --vp-c-brand-1 for the first series. */
  color?: string;
}

/** One bar group on the x-axis. */
export interface BenchmarkBar {
  /** X-axis label, e.g. "10k". */
  label: string;
  /** Map of seriesKey -> value (typically milliseconds). */
  values: Record<string, number>;
}

/**
 * A benchmark chart dataset contributed by a package; rendered on the home
 * page and on the package's performance page. The data model is generic:
 * any number of series can be compared (main vs stream, v1 vs v2, etc.).
 */
export interface BenchmarkSeries {
  source: LocalizedText;
  /** Bar groups along the x-axis. */
  data: BenchmarkBar[];
  /** Series definitions (legend + color). Must have at least 1 entry. */
  series: BenchmarkSeriesDef[];
}

export interface PackageEntry {
  /** Directory name under the docs root: packages/<dir>/*.md */
  dir: string;
  npmName: string;
  version: string;
  status: "stable" | "beta" | "alpha";
  tagline: LocalizedText;
  keywords: string[];
  /**
   * Whether this package ships an en/ doc mirror. Single source of truth
   * for nav/sidebar/home visibility in the English locale. Validated
   * against the actual en/packages/<dir>/ directory by validateDocsTree
   * (config.ts) at build time, so the flag and dir can never drift.
   */
  en: boolean;
  /**
   * Optional extra sidebar groups besides the default guide/examples/api.
   * `id` must be a directory under packages/<dir>/ containing the markdown.
   */
  sections?: PackageSection[];
  /** Optional home-page stat cards contributed by this package (keys must be globally unique). */
  homeStats?: HomeStat[];
  /** Optional home-page highlight cards contributed by this package. */
  highlights?: PackageHighlight[];
  /** Dist assets (wasm, worker) copied into public/ at build time. */
  runtimeAssets?: RuntimeAsset[];
  /** Home-page benchmark chart datasets (one SVG block per series). */
  benchmarks?: BenchmarkSeries[];
  /**
   * Name of a globally-registered Vue component (from theme/components/)
   * to render as this package's live demo. Referenced via <PackageDemo>.
   */
  demo?: string;
}

/** Default sidebar groups used when a package does not declare `sections`. */
export const DEFAULT_PACKAGE_SECTIONS: PackageSection[] = [
  { id: "guide", label: { zh: "指南", en: "Guide" }, collapsed: false },
  {
    id: "examples",
    label: { zh: "使用案例", en: "Examples" },
    collapsed: true,
  },
  {
    id: "api",
    label: { zh: "API 参考", en: "API Reference" },
    collapsed: true,
  },
];

/**
 * Resolve the effective sidebar sections for a package: the default
 * guide/examples/api groups first, then the package's own `sections`.
 * A custom section with the same `id` as a default overrides it (e.g. to
 * relabel "Guide"), so packages only need to declare *extra* groups.
 */
export function resolvePackageSections(p: PackageEntry): PackageSection[] {
  const merged = new Map<string, PackageSection>();
  for (const s of [...DEFAULT_PACKAGE_SECTIONS, ...(p.sections ?? [])]) {
    merged.set(s.id, s);
  }
  return [...merged.values()];
}

/**
 * Home-page stats: package count (always first) followed by the given
 * packages' declared `homeStats`. Defaults to the full registry; callers on
 * the English site pass the locale-filtered list so zh-only packages do not
 * leak stats onto the en home page. Keys are guaranteed unique.
 */
export function getAllHomeStats(
  pkgs: readonly PackageEntry[] = packages,
): HomeStat[] {
  return [
    {
      key: "packages",
      value: pkgs.length,
      decimals: 0,
      zh: "已发布库包",
      en: "Published packages",
    },
    ...pkgs.flatMap((p) => p.homeStats ?? []),
  ];
}

/**
 * Package registry — the single source of truth for the docs site.
 * Adding a new package: add it to apps/docs/package.json dependencies,
 * create packages/<dir>/ markdown, then append one entry here. Sidebar, nav,
 * home cards, highlights and stats are generated from this list. Version is
 * read from the package's own package.json (single source of truth).
 */
export const packages: PackageEntry[] = [
  {
    dir: "excel-exporter",
    npmName: "@marcusok/excel-exporter",
    version: excelExporterPkg.version,
    status: "stable",
    en: true,
    tagline: {
      zh: "高性能 Excel 导出引擎",
      en: "High-performance Excel export engine",
    },
    keywords: ["excel", "xlsx", "export", "wasm"],
    runtimeAssets: [
      {
        // Resolve through @marcusok/excel-exporter so the docs app does not
        // need modern-xlsx as a direct dep (pnpm auto-install-peers pulls
        // it in as excel-exporter's peerDep). Renamed on copy: the worker
        // resolves its wasm via `new URL("modern_xlsx_wasm_bg.wasm", import.meta.url)`,
        // so the dist file `modern-xlsx.wasm` must land under that exact name.
        resolveFrom: "modern-xlsx",
        through: "@marcusok/excel-exporter",
        file: "modern-xlsx.wasm",
        to: "assets/modern_xlsx_wasm_bg.wasm",
      },
      {
        resolveFrom: "@marcusok/excel-exporter",
        file: "export.worker.js",
        to: "assets/export.worker.js",
      },
    ],
    benchmarks: [
      {
        data: [
          { label: "10k", values: { main: 109, stream: 184 } },
          { label: "50k", values: { main: 618, stream: 824 } },
          { label: "100k", values: { main: 17541, stream: 1548 } },
        ],
        series: [
          {
            key: "main",
            label: { zh: "Workbook / main 路径", en: "Workbook / main path" },
          },
          {
            key: "stream",
            label: { zh: "Stream 路径", en: "Streaming path" },
            color: "#8b5cf6",
          },
        ],
        source: {
          zh: "数据来源：包设计文档，Node v22.22.2、modern-xlsx@1.2.0，独立进程首次实测（毫秒）。",
          en: "Source: package design doc, Node v22.22.2, modern-xlsx@1.2.0, independent-process first run (ms).",
        },
      },
    ],
    homeStats: [
      {
        key: "rows",
        value: 1.5,
        decimals: 1,
        zh: "10 万行导出耗时",
        en: "100k rows export time",
        suffix: "s",
      },
      {
        key: "modes",
        value: 4,
        decimals: 0,
        zh: "导出模式",
        en: "Export modes",
      },
      {
        key: "presets",
        value: 7,
        decimals: 0,
        zh: "内置样式预设",
        en: "Style presets",
      },
    ],
    highlights: [
      {
        icon: "🚀",
        title: { zh: "高性能", en: "High Performance" },
        details: {
          zh: "Rust + WASM 核心，10 万行导出稳定在 1.5s 级别；Worker 多线程让主线程不被阻塞。",
          en: "Rust + WASM core exports 100k rows in ~1.5s; Web Workers keep the main thread responsive.",
        },
      },
      {
        icon: "📝",
        title: { zh: "声明式", en: "Declarative" },
        details: {
          zh: "用配置描述列、样式与格式，一行代码完成导出，不必手写单元格与样式对象。",
          en: "Describe columns, styles and formats with plain config; export with one call.",
        },
      },
      {
        icon: "🧭",
        title: { zh: "自动路由", en: "Auto Routing" },
        details: {
          zh: "自动模式根据数据量选择最优路径，数据量变化时业务代码零改动。",
          en: "Auto mode picks the best path by row count; business code never changes as data grows.",
        },
      },
      {
        icon: "🛡️",
        title: { zh: "多级兜底", en: "Layered Fallbacks" },
        details: {
          zh: "环境不支持或 WASM 加载失败时自动降级到 SheetJS，保证“一定能导出”。",
          en: "Automatically degrades to SheetJS when WASM is unavailable — export always succeeds.",
        },
      },
    ],
    demo: "ExportDemo",
  },
];
