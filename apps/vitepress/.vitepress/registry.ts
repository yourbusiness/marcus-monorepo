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

export interface PackageEntry {
  /** Directory name under the docs root: packages/<dir>/*.md */
  dir: string;
  npmName: string;
  version: string;
  status: "stable" | "beta" | "alpha";
  tagline: LocalizedText;
  keywords: string[];
  /**
   * Optional extra sidebar groups besides the default guide/examples/api.
   * `id` must be a directory under packages/<dir>/ containing the markdown.
   */
  sections?: PackageSection[];
  /** Optional home-page stat cards contributed by this package (keys must be globally unique). */
  homeStats?: HomeStat[];
  /** Optional home-page highlight cards contributed by this package. */
  highlights?: PackageHighlight[];
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

const RESERVED_STAT_KEYS = new Set(["packages"]);

/** Fail fast (at build/SSR time) on registry mistakes that would break the site. */
function validateRegistry(): void {
  const seenDirs = new Set<string>();
  const seenNames = new Set<string>();
  const seenStatKeys = new Set<string>(RESERVED_STAT_KEYS);
  for (const p of packages) {
    if (seenDirs.has(p.dir)) {
      throw new Error(`[registry] duplicate dir "${p.dir}"`);
    }
    seenDirs.add(p.dir);
    if (seenNames.has(p.npmName)) {
      throw new Error(`[registry] duplicate npmName "${p.npmName}"`);
    }
    seenNames.add(p.npmName);
    for (const s of p.homeStats ?? []) {
      if (seenStatKeys.has(s.key)) {
        throw new Error(
          `[registry] duplicate homeStat key "${s.key}" (${p.npmName})`,
        );
      }
      seenStatKeys.add(s.key);
    }
    const sectionIds = new Set<string>();
    for (const s of p.sections ?? []) {
      if (sectionIds.has(s.id)) {
        throw new Error(
          `[registry] duplicate section id "${s.id}" (${p.npmName})`,
        );
      }
      sectionIds.add(s.id);
    }
  }
}

/**
 * Home-page stats: package count (always first) followed by every package's
 * declared `homeStats`. Keys are guaranteed unique by `validateRegistry`.
 */
export function getAllHomeStats(): HomeStat[] {
  return [
    {
      key: "packages",
      value: packages.length,
      decimals: 0,
      zh: "已发布库包",
      en: "Published packages",
    },
    ...packages.flatMap((p) => p.homeStats ?? []),
  ];
}

/**
 * Package registry — the single source of truth for the docs site.
 * Adding a new package: add it to apps/vitepress/package.json dependencies,
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
    tagline: {
      zh: "高性能 Excel 导出引擎",
      en: "High-performance Excel export engine",
    },
    keywords: ["excel", "xlsx", "export", "wasm"],
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
  },
];

validateRegistry();
