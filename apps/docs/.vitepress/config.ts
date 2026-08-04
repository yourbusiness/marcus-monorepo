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
  resolvePackageSections,
  type PackageEntry,
  type RuntimeAsset,
  packages,
} from "./registry";
import { validateRegistry } from "./registry-validate";

const configDir = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(configDir, "..");

/**
 * Fail fast on registry entries whose docs tree would 404 or render empty
 * sidebar groups. Runs only in the Node config context (build/dev), keeping
 * the browser-bundled registry module free of node:fs.
 */
function validateDocsTree(): void {
  const errors: string[] = [];
  for (const p of packages) {
    const zhDir = join(docsRoot, "packages", p.dir);
    if (!existsSync(join(zhDir, "index.md"))) {
      errors.push(
        `[docs] packages/${p.dir}/index.md is missing (registry intro link would 404)`,
      );
    }
    // Custom sections are an explicit registry declaration -> a missing dir is
    // a config mistake. Default guide/examples/api groups are optional (a new
    // package may only ship guide docs) and are filtered by existence below.
    for (const s of p.sections ?? []) {
      if (!existsSync(join(zhDir, s.id))) {
        errors.push(
          `[docs] packages/${p.dir}/${s.id}/ is declared in registry sections but does not exist`,
        );
      }
    }
    const enDir = join(docsRoot, "en", "packages", p.dir);
    const enExists = existsSync(enDir);
    if (enExists !== p.en) {
      errors.push(
        `[docs] ${p.npmName}: registry en=${p.en} but en/packages/${p.dir}/ ` +
          `${enExists ? "exists" : "does not exist"} (set en to match the directory)`,
      );
    }
    if (enExists && !existsSync(join(enDir, "index.md"))) {
      errors.push(
        `[docs] en/packages/${p.dir}/ exists but its index.md is missing (en intro link would 404)`,
      );
    }
  }
  if (errors.length > 0) {
    throw new Error(`\n${errors.join("\n")}`);
  }
}

validateDocsTree();
validateRegistry();

/**
 * Derive the GitHub owner/repo from the origin remote so `base`, edit links
 * and social links stay correct. "yourbusiness" is the REAL GitHub
 * owner (see the NOTE below); remote parsing keeps links correct after
 * a fork or rename.
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
    // No git metadata (e.g. archive build) — fall through to the fallback below.
  }
  return { owner: "yourbusiness", repo: "marcus-monorepo" };
}

const github = resolveGithubRepo();
const githubUrl = `https://github.com/${github.owner}/${github.repo}`;
/** GitHub Pages project site: https://<owner>.github.io/<repo>/ */
// Dev server always serves from root; the GitHub Pages base only matters
// for the production build. DOCS_BASE can still override both.
const isDev = process.argv.slice(2).includes("dev");
const base = isDev ? "/" : (process.env.DOCS_BASE ?? `/${github.repo}/`);

// NOTE: "yourbusiness" is the REAL GitHub owner/org for this monorepo
// (origin is git@github.com:yourbusiness/marcus-monorepo.git), NOT a
// placeholder. base/edit links/social links resolve correctly. If you
// fork this repo, update the origin remote and the fallback in
// resolveGithubRepo() accordingly.

/* ------------------------- runtime assets (wasm/worker) ------------------------- */

const require = createRequire(import.meta.url);

/**
 * Resolve the directory containing a package's dist assets. When `through`
 * is set, the resolution happens within that package's dependency context
 * (so peer-dep assets like modern-xlsx's wasm can be found without listing
 * modern-xlsx as a direct dependency of the docs app).
 */
function resolveAssetDir(asset: RuntimeAsset): string {
  if (asset.through) {
    const throughReq = createRequire(
      require.resolve(join(asset.through, "package.json")),
    );
    return dirname(throughReq.resolve(asset.resolveFrom));
  }
  return dirname(require.resolve(asset.resolveFrom));
}

/**
 * Copy every package's declared runtimeAssets (wasm, worker, ...) from
 * their dist directories into public/, so a new package only has to
 * declare `runtimeAssets` in the registry — no build-config edit needed.
 */
function copyRuntimeAssets() {
  const publicDir = join(docsRoot, "public");
  for (const p of packages) {
    for (const asset of p.runtimeAssets ?? []) {
      const src = join(resolveAssetDir(asset), asset.file);
      const dest = join(publicDir, asset.to);
      mkdirSync(dirname(dest), { recursive: true });
      if (!statSync(src, { throwIfNoEntry: false })) {
        throw new Error(
          `[docs] runtime asset not found: ${asset.resolveFrom}${asset.through ? ` (through ${asset.through})` : ""}/${asset.file} ` +
            `(declared by ${p.npmName} runtimeAssets). ` +
            "Run `pnpm docs:build` from the repo root (turbo builds deps first).",
        );
      }
      copyFileSync(src, dest);
    }
  }
}

/* ------------------------- auto sidebar from files ------------------------- */

interface SidebarItem {
  text: string;
  link?: string;
  items?: SidebarItem[];
  collapsed?: boolean;
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
  const entries = readdirSync(abs, { withFileTypes: true });
  const files = entries
    .filter(
      (e) => e.isFile() && e.name.endsWith(".md") && e.name !== "index.md",
    )
    .map((e) => e.name)
    .sort(comparePageFiles)
    .map((f) => ({
      text: readH1(join(abs, f), basename(f, ".md")),
      link: `${linkPrefix}/${relDir}/${basename(f, ".md")}`,
    }));
  // Nested directories become collapsible groups (titled by their index.md H1
  // when present, otherwise by the directory name). This keeps sidebar
  // generation extensible for package docs that outgrow one flat folder.
  const dirs = entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => {
      const groupAbs = join(abs, d.name);
      const group: SidebarItem = {
        text: existsSync(join(groupAbs, "index.md"))
          ? readH1(join(groupAbs, "index.md"), d.name)
          : d.name,
        collapsed: false,
        items: pageItems(localeDir, `${relDir}/${d.name}`, linkPrefix),
      };
      if (existsSync(join(groupAbs, "index.md"))) {
        group.link = `${linkPrefix}/${relDir}/${d.name}/`;
      }
      return group;
    });
  return [...files, ...dirs];
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
    demo: "Play",
    intro: "Intro",
  },
};

/** Packages to show in a given locale: zh shows all, en only packages
 *  whose registry entry declares `en: true`. This is the single source
 *  of truth (validated against the filesystem by validateDocsTree), so
 *  no themeConfig snapshot needs to be serialized to the client. */
function visiblePackages(lang: "zh" | "en"): PackageEntry[] {
  return lang === "en" ? packages.filter((p) => p.en) : packages;
}

function buildSidebar(
  localeDir: string,
  linkPrefix: string,
  lang: "zh" | "en",
): SidebarItem[] {
  const l = labels[lang];
  const packageGroups = visiblePackages(lang).map((p) => {
    const pdir = `packages/${p.dir}`;
    const sections = resolvePackageSections(p).filter((s) =>
      existsSync(join(docsRoot, localeDir, pdir, s.id)),
    );
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
        { text: l.demo, link: `${linkPrefix}/play` },
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
    { text: l.demo, link: `${linkPrefix}/play` },
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

/**
 * Destination basenames of all registry-declared runtime assets. Rollup
 * emits these without a content hash so they land at the same path as the
 * copies in public/ (placed there by copyRuntimeAssets). Anything not in
 * this set gets a normal hashed filename.
 */
const stableAssetNames = new Set(
  packages.flatMap((p) => p.runtimeAssets ?? []).map((a) => basename(a.to)),
);

export default defineConfig({
  lang: "zh-CN",
  title: "MarcusOK Docs",
  description:
    "MarcusOK 文档中心 —— marcus-monorepo 库包的公开技术文档（zh / en）",
  base,
  cleanUrls: true,
  lastUpdated: true,
  // apps/docs/README.md is a repo-facing doc, not a site page.
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
          pattern: `${githubUrl}/edit/main/apps/docs/:path`,
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
          pattern: `${githubUrl}/edit/main/apps/docs/:path`,
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
    build: {
      rollupOptions: {
        output: {
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name ?? "asset";
            return stableAssetNames.has(name)
              ? "assets/[name][extname]"
              : "assets/[name]-[hash][extname]";
          },
        },
      },
    },
  },
});
