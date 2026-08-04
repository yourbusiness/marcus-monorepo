// Keep the zh (root) and en/ page trees in sync.
// Rules:
// - Site-level pages (guide/, index.md, play.md) must always be mirrored.
// - A package under packages/<dir>/ is "bilingual" only when en/packages/<dir>
//   exists; zh-only packages are exempt from the mirror requirement. Remove the
//   en/ directory to mark a package zh-only, create it to require full mirrors.
// - Every en/ page must have a zh original (extra en pages fail the check).
// Runs as `pnpm test` for the docs app (turbo test in CI).
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

// ---- content sanity: a mirror that is a byte-identical copy of the zh page,
// or still mostly Chinese outside code blocks, is almost certainly an
// untranslated placeholder rather than a deliberate translation. ----
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const CJK_RATIO_LIMIT = 0.25;

function stripCode(content) {
  return content
    .replace(/```[\s\S]*?```/g, "") // fenced code blocks
    .replace(/`[^`\n]*`/g, "") // inline code
    .replace(/<[^>]+>/g, ""); // inline HTML
}

function cjkRatio(content) {
  const text = stripCode(content).replace(/\s+/g, "");
  if (text.length === 0) return 0;
  return (text.match(CJK_RE) ?? []).length / text.length;
}

const contentErrors = [];
for (const f of required) {
  const zhContent = readFileSync(join(root, f), "utf8");
  const enContent = readFileSync(join(enRoot, f), "utf8");
  if (zhContent === enContent) {
    contentErrors.push(
      `en/ mirror is byte-identical to the zh original (untranslated?): ${f}`,
    );
    continue;
  }
  const ratio = cjkRatio(enContent);
  if (ratio > CJK_RATIO_LIMIT) {
    contentErrors.push(
      `en/ mirror still contains ${(ratio * 100).toFixed(0)}% CJK outside code blocks (untranslated?): ${f}`,
    );
  }
}

if (missingInEn.length || extraInEn.length || contentErrors.length) {
  for (const f of missingInEn) {
    console.error(`[check-i18n] missing en/ mirror: ${f}`);
  }
  for (const f of extraInEn) {
    console.error(`[check-i18n] unexpected en page (no zh original): ${f}`);
  }
  for (const msg of contentErrors) {
    console.error(`[check-i18n] ${msg}`);
  }
  console.error(
    "[check-i18n] zh/en page trees are out of sync or contain untranslated mirrors.",
  );
  process.exit(1);
}

console.log(
  `[check-i18n] OK — ${required.length} required zh pages and ${en.length} en pages in sync` +
    (skippedZhOnly > 0
      ? ` (${skippedZhOnly} pages in zh-only packages skipped).`
      : "."),
);
