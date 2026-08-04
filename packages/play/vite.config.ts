import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  isFile,
  matchExportTarget,
  readExportsMap,
  resolvePkgDir,
  srcCandidatesFromDistTarget,
  type SourcePackage,
} from "./src/vite/workspace-resolver.ts";

const rootDir = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(rootDir, "..");

/**
 * Source entry of a workspace package. The monorepo convention is
 * src/index.ts (fallback: src/index.tsx); packages that don't follow it get
 * a startup warning below and resolve through their dist instead (no HMR).
 */
function sourceEntry(dir: string): string {
  const ts = resolve(dir, "src/index.ts");
  return isFile(ts) ? ts : resolve(dir, "src/index.tsx");
}

/**
 * Workspace packages that expose a src/index.ts(.tsx) source entry. These get
 * HMR-friendly aliases; everything else is handled by normal node/vite
 * resolution against the workspace symlink (i.e. built dist).
 */
const sourcePackages: SourcePackage[] = readdirSync(packagesDir)
  .filter((name) => name !== "play")
  .filter(
    (name) =>
      isFile(resolve(packagesDir, name, "src/index.ts")) ||
      isFile(resolve(packagesDir, name, "src/index.tsx")),
  )
  .map((name) => ({
    name,
    dir: resolve(packagesDir, name),
    exportsMap: readExportsMap(resolve(packagesDir, name)),
  }));

// Fail loud instead of silently losing source HMR: warn for every declared
// @marcusok/* dependency that doesn't follow the src/index.ts convention.
const declaredDeps: string[] = (() => {
  try {
    const json = JSON.parse(
      readFileSync(resolve(rootDir, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    return Object.keys(json.dependencies ?? {})
      .filter((name) => name.startsWith("@marcusok/"))
      .map((name) => name.replace(/^@marcusok\//, ""));
  } catch {
    return [];
  }
})();

for (const name of declaredDeps) {
  if (!sourcePackages.some((pkg) => pkg.name === name)) {
    console.warn(
      `[play] "@marcusok/${name}" 未检测到 src/index.ts(.tsx)，主入口将走 dist 解析（无源码 HMR）。请按约定提供 src/index.ts。`,
    );
  }
}

/**
 * Third-party packages whose "exports" map doesn't expose certain runtime
 * subpaths (e.g. ./wasm/*). When a demo imports `<pkg>/<subpath>?url` and
 * Vite's export-map resolution would reject it, we rewrite to the physical
 * file on disk if it exists.
 *
 * To support a new third-party subpath, add an entry here; resolver logic
 * doesn't need to change.
 */
const externalOverrides: {
  pkg: string;
  dir: string;
  excludeFromOptimizeDeps?: boolean;
}[] = [
  // modern-xlsx ships WASM under ./wasm/ but its "exports" map omits that
  // subpath, so `modern-xlsx/wasm/*.wasm?url` 500s on export-map resolution.
  {
    pkg: "modern-xlsx",
    dir: resolvePkgDir("modern-xlsx", rootDir),
    excludeFromOptimizeDeps: true,
  },
];

// Main-entry aliases: @marcusok/<pkg> -> src/index.ts(.tsx) (HMR-friendly source).
// Anchored regex so it does NOT swallow subpaths like /dist/export.worker.js.
const mainAliases = sourcePackages.map(({ name, dir }) => ({
  find: new RegExp(`^@marcusok/${name}$`),
  replacement: sourceEntry(dir),
}));

export default defineConfig({
  resolve: { alias: mainAliases },
  plugins: [
    react(),
    {
      name: "marcusok-resolver",
      enforce: "pre",
      resolveId(source) {
        const queryIdx = source.indexOf("?");
        const clean = queryIdx === -1 ? source : source.slice(0, queryIdx);
        const query = queryIdx === -1 ? "" : source.slice(queryIdx);

        // @marcusok/<pkg>/<sub...> resolution:
        //  1. "dist/..." requests are build artifacts (workers, wasm) ->
        //     resolve straight to the on-disk file; never source.
        //  2. Flat source file: src/<sub>.ts(/.tsx) or src/<sub>/index.*.
        //  3. Exports-map-aware: map "./<sub>" (or a "*" wildcard key) to
        //     its dist target, then back to the matching src file when it
        //     exists. Keeps subpaths like "./styles" -> style-presets.ts
        //     HMR-friendly even when the export key and source file differ.
        //  4. Bare dist artifact as a safety net for subpaths the upstream
        //     package omits from its "exports" map.
        //  5. Otherwise return null and let normal resolution handle it.
        //  ?url is preserved everywhere so Vite serves files as URLs rather
        //  than importing them as modules.
        const sub = clean.match(/^@marcusok\/([^/]+)\/(.+)$/);
        if (sub) {
          const pkgName = sub[1]!;
          const subpath = sub[2]!;
          const pkg = sourcePackages.find((p) => p.name === pkgName);
          if (pkg) {
            if (subpath.startsWith("dist/")) {
              const distCandidate = resolve(pkg.dir, subpath);
              if (isFile(distCandidate)) return distCandidate + query;
              return null;
            }
            const srcFlat = [
              `${subpath}.ts`,
              `${subpath}.tsx`,
              `${subpath}/index.ts`,
              `${subpath}/index.tsx`,
            ].map((rel) => resolve(pkg.dir, "src", rel));
            for (const candidate of srcFlat) {
              if (isFile(candidate)) return candidate + query;
            }
            const exportTarget = matchExportTarget(pkg.exportsMap, subpath);
            if (exportTarget) {
              for (const rel of srcCandidatesFromDistTarget(exportTarget)) {
                const candidate = resolve(pkg.dir, "src", rel);
                if (isFile(candidate)) return candidate + query;
              }
            }
            const distCandidate = resolve(pkg.dir, "dist", subpath);
            if (isFile(distCandidate)) return distCandidate + query;
          }
          return null;
        }

        // Third-party packages with unexported subpaths: rewrite to the
        // physical file on disk if it exists. Safe because we only rewrite
        // when the file actually exists at the subpath relative to the
        // package root; subpaths covered by "exports" (e.g. "./lite") live
        // under dist/ and won't match existsSync, so they fall through to
        // normal resolution.
        for (const { pkg, dir } of externalOverrides) {
          if (!dir) continue;
          const m = clean.match(new RegExp(`^${pkg}/(.+)$`));
          if (m) {
            const physical = resolve(dir, m[1]!);
            if (existsSync(physical)) return physical + query;
          }
        }
        return null;
      },
    },
  ],
  optimizeDeps: {
    // Packages that use new URL(..., import.meta.url) for wasm or workers
    // break under pre-bundling; exclude all declared entries that need it.
    exclude: externalOverrides
      .filter((e) => e.excludeFromOptimizeDeps)
      .map((e) => e.pkg),
  },
  server: {
    port: 5173,
    // Fail loudly instead of silently hopping to 5174/5175 when the port is
    // already taken (multiple dev instances are easy to mix up otherwise).
    // Override with `vite --port <n>` if 5173 is genuinely occupied.
    strictPort: true,
    fs: {
      // Serve the play itself (incl. its node_modules) plus the
      // workspace packages that follow the source convention. New packages
      // are picked up automatically once they add src/index.ts(.tsx).
      allow: [rootDir, ...sourcePackages.map((pkg) => pkg.dir)],
    },
  },
});
