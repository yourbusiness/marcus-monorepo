// Keep the zh (root) and en/ page trees in sync.
// Rules:
// - Site-level pages (guide/, index.md, playground.md) must always be mirrored.
// - A package under packages/<dir>/ is "bilingual" only when en/packages/<dir>
//   exists; zh-only packages are exempt from the mirror requirement. Remove the
//   en/ directory to mark a package zh-only, create it to require full mirrors.
// - Every en/ page must have a zh original (extra en pages fail the check).
// Runs as `pnpm test` for the docs app (turbo test in CI).
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const enRoot = join(root, "en");
const SKIP_DIRS = new Set(["en", ".vitepress", "node_modules", "public"]);

function collectMd(dir, baseDir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectMd(abs, baseDir));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      !(dir === baseDir && entry.name === "README.md")
    ) {
      out.push(relative(baseDir, abs).replaceAll(sep, "/"));
    }
  }
  return out;
}

const zh = collectMd(root, root).sort();
const en = collectMd(enRoot, enRoot).sort();

const PACKAGES_PREFIX = "packages/";

// Package pages are required to be mirrored only when the package has an en/
// mirror directory; site-level pages are always required.
const required = zh.filter((f) => {
  if (!f.startsWith(PACKAGES_PREFIX)) return true;
  const pkgDir = f.slice(PACKAGES_PREFIX.length).split("/")[0];
  return existsSync(join(enRoot, PACKAGES_PREFIX, pkgDir));
});

const missingInEn = required.filter((f) => !en.includes(f));
const extraInEn = en.filter((f) => !zh.includes(f));
const skippedZhOnly = zh.length - required.length;

if (missingInEn.length || extraInEn.length) {
  for (const f of missingInEn) {
    console.error(`[check-i18n] missing en/ mirror: ${f}`);
  }
  for (const f of extraInEn) {
    console.error(`[check-i18n] unexpected en page (no zh original): ${f}`);
  }
  console.error("[check-i18n] zh/en page trees are out of sync.");
  process.exit(1);
}

console.log(
  `[check-i18n] OK — ${required.length} required zh pages and ${en.length} en pages in sync` +
    (skippedZhOnly > 0
      ? ` (${skippedZhOnly} pages in zh-only packages skipped).`
      : "."),
);
