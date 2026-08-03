import { defineConfig } from "vitepress";
import { createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  DEFAULT_PACKAGE_SECTIONS,
  type PackageEntry,
  packages,
} from "./registry";

const configDir = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(configDir, "..");

/**
 * Derive the GitHub owner/repo from the origin remote so `base`, edit links
 * and social links stay correct once the placeholder remote is replaced.
 * `DOCS_BASE` still wins when a custom domain is used (set it to "/").
 * Note: changing the remote invalidates nothing in turbo's input hash, so after
 * changing `origin` run `pnpm docs:build --force` once.
 */
function resolveGithubRepo(): { owner: string; repo: string } {
  try {
    const raw = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
    }).trim();
    const https = raw
      .replace(/^git@([^:]+):/, "https://$1/")
      .replace(/^git:\/\//, "https://")
      .replace(/^ssh:\/\//, "https://");
    const m = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(https);
    if (m?.[1] && m?.[2]) return { owner: m[1], repo: m[2] };
  } catch {
    // No git metadata (e.g. archive build) — fall through to the placeholder.
  }
  return { owner: "yourbusiness", repo: "marcus-monorepo" };
}

const github = resolveGithubRepo();
const githubUrl = `https://github.com/${github.owner}/${github.repo}`;
/** GitHub Pages project site: https://<owner>.github.io/<repo>/ */
const base = process.env.DOCS_BASE ?? `/${github.repo}/`;

if (github.owner === "yourbusiness") {
  console.warn(
    "[docs] git remote origin is still the placeholder " +
      `(${github.owner}/${github.repo}). base/edit links/social links will be ` +
      "wrong until the real remote is set.",
  );
}

/* ------------------------- runtime assets (wasm/worker) ------------------------- */

const require = createRequire(import.meta.url);
const resolveDistDir = (spec: string) => dirname(require.resolve(spec));

/**
 * Copy modern-xlsx.wasm + export.worker.js into public/assets so the live demo
 * works on the static GitHub Pages site. Generated files are gitignored.
 */
function copyRuntimeAssets() {
  const outDir = join(docsRoot, "public", "assets");
  mkdirSync(outDir, { recursive: true });

  copyFileSync(
    join(resolveDistDir("modern-xlsx"), "modern-xlsx.wasm"),
    join(outDir, "modern-xlsx.wasm"),
  );

  const workerSrc = join(
    resolveDistDir("@marcusok/excel-exporter"),
    "export.worker.js",
  );
  if (!statSync(workerSrc, { throwIfNoEntry: false })) {
    throw new Error(
      `[docs] export.worker.js not found at ${workerSrc}. ` +
        "Run `pnpm docs:build` from the repo root (turbo builds excel-exporter first).",
    );
  }
  copyFileSync(workerSrc, join(outDir, "export.worker.js"));
}

/* ------------------------- auto sidebar from files ------------------------- */

interface SidebarItem {
  text: string;
  link?: string;
  items?: SidebarItem[];
}

const ORDERED_PREFIX = /^(\d+)[-_]?/;

/**
 * Sidebar order: files with a numeric prefix ("01-quick-start.md") are ordered
 * by that number; unprefixed files sort alphabetically afterwards. Prefixes are
 * not part of the displayed title (H1) or the link path.
 */
function comparePageFiles(a: string, b: string): number {
  const key = (f: string): [number, string] => {
    const m = ORDERED_PREFIX.exec(f);
    return m ? [Number(m[1]), f.slice(m[0].length)] : [Infinity, f];
  };
  const [na, ra] = key(a);
  const [nb, rb] = key(b);
  return na !== nb ? na - nb : ra.localeCompare(rb);
}

function readH1(filePath: string, fallback: string): string {
  const content = readFileSync(filePath, "utf-8");
  const m = /^#\s+(.+?)\s*$/m.exec(content);
  return m?.[1]?.trim() ?? fallback;
}

function pageItems(
  localeDir: string,
  relDir: string,
  linkPrefix: string,
): SidebarItem[] {
  const abs = join(docsRoot, localeDir, relDir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .sort(comparePageFiles)
    .map((f) => ({
      text: readH1(join(abs, f), basename(f, ".md")),
      link: `${linkPrefix}/${relDir}/${basename(f, ".md")}`,
    }));
}

const labels = {
  zh: {
    home: "首页",
    guide: "指南",
    packages: "包文档",
    ecosystem: "生态介绍",
    demo: "在线演示",
    intro: "介绍",
  },
  en: {
    home: "Home",
    guide: "Guide",
    packages: "Packages",
    ecosystem: "Ecosystem",
    demo: "Playground",
    intro: "Intro",
  },
};

/** Packages that have a `packages/<dir>` mirror under en/ (i.e. not zh-only). */
function packageHasEnDocs(p: PackageEntry): boolean {
  return existsSync(join(docsRoot, "en", "packages", p.dir));
}

/** Packages to show in a given locale: zh shows all, en only bilingual ones. */
function visiblePackages(lang: "zh" | "en"): PackageEntry[] {
  return lang === "en" ? packages.filter(packageHasEnDocs) : packages;
}

function buildSidebar(
  localeDir: string,
  linkPrefix: string,
  lang: "zh" | "en",
): SidebarItem[] {
  const l = labels[lang];
  const packageGroups = visiblePackages(lang).map((p) => {
    const pdir = `packages/${p.dir}`;
    const sections =
      p.sections && p.sections.length > 0
        ? p.sections
        : DEFAULT_PACKAGE_SECTIONS;
    return {
      text: p.npmName,
      collapsed: false,
      items: [
        { text: l.intro, link: `${linkPrefix}/${pdir}/` },
        ...sections.map((s) => ({
          text: s.label[lang],
          collapsed: s.collapsed ?? false,
          items: pageItems(localeDir, `${pdir}/${s.id}`, linkPrefix),
        })),
      ],
    };
  });

  return [
    {
      text: l.guide,
      items: [
        { text: l.ecosystem, link: `${linkPrefix}/guide/` },
        ...pageItems(localeDir, "guide", linkPrefix),
        { text: l.demo, link: `${linkPrefix}/playground` },
      ],
    },
    ...packageGroups,
  ];
}

/** Top nav: derived from the registry so new packages appear automatically. */
function buildNav(lang: "zh" | "en", linkPrefix: string) {
  const l = labels[lang];
  return [
    { text: l.home, link: `${linkPrefix}/` },
    { text: l.guide, link: `${linkPrefix}/guide/` },
    {
      text: l.packages,
      items: visiblePackages(lang).map((p) => ({
        text: p.npmName,
        link: `${linkPrefix}/packages/${p.dir}/`,
      })),
    },
    { text: l.demo, link: `${linkPrefix}/playground` },
  ];
}

/* ------------------------------ search (zh) ------------------------------ */

const zhSearchTranslations = {
  button: {
    buttonText: "搜索",
    buttonAriaLabel: "搜索",
  },
  modal: {
    displayDetails: "显示详细列表",
    resetButtonTitle: "重置搜索",
    backButtonTitle: "关闭搜索",
    noResultsText: "没有结果",
    footer: {
      selectText: "选择",
      selectKeyAriaLabel: "输入",
      navigateText: "导航",
      navigateUpKeyAriaLabel: "上箭头",
      navigateDownKeyAriaLabel: "下箭头",
      closeText: "关闭",
      closeKeyAriaLabel: "esc",
    },
  },
};

/* -------------------------------- site config -------------------------------- */

export default defineConfig({
  lang: "zh-CN",
  title: "MarcusOK Docs",
  description:
    "MarcusOK 文档中心 —— marcus-monorepo 库包的公开技术文档（zh / en）",
  base,
  cleanUrls: true,
  lastUpdated: true,
  // apps/vitepress/README.md is a repo-facing doc, not a site page.
  srcExclude: ["README.md"],
  head: [
    ["link", { rel: "icon", href: `${base}favicon.svg` }],
    ["meta", { property: "og:title", content: "MarcusOK Docs" }],
    [
      "meta",
      {
        property: "og:description",
        content: "Public documentation for marcus-monorepo packages.",
      },
    ],
  ],
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      title: "MarcusOK 文档中心",
      description:
        "MarcusOK 文档中心 —— marcus-monorepo 库包的公开技术文档，默认中文。",
      themeConfig: {
        nav: buildNav("zh", ""),
        sidebar: buildSidebar(".", "", "zh"),
        outline: { label: "本页目录" },
        docFooter: { prev: "上一页", next: "下一页" },
        lastUpdated: { text: "最后更新于" },
        editLink: {
          pattern: `${githubUrl}/edit/main/apps/vitepress/:path`,
          text: "在 GitHub 上编辑此页",
        },
      },
    },
    en: {
      label: "English",
      lang: "en-US",
      title: "MarcusOK Docs",
      description:
        "MarcusOK Docs — public technical documentation for marcus-monorepo packages.",
      themeConfig: {
        nav: buildNav("en", "/en"),
        sidebar: buildSidebar("en", "/en", "en"),
        outline: { label: "On this page" },
        docFooter: { prev: "Previous", next: "Next" },
        lastUpdated: { text: "Last updated" },
        editLink: {
          pattern: `${githubUrl}/edit/main/apps/vitepress/:path`,
          text: "Edit this page on GitHub",
        },
      },
    },
  },
  themeConfig: {
    logo: "/logo.svg",
    socialLinks: [{ icon: "github", link: githubUrl }],
    search: {
      provider: "local",
      options: {
        locales: {
          root: { translations: zhSearchTranslations },
        },
      },
    },
  },
  vite: {
    plugins: [
      {
        name: "copy-marcus-runtime-assets",
        buildStart() {
          copyRuntimeAssets();
        },
      },
    ],
  },
});
