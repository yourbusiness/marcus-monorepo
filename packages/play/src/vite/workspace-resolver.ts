import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface SourcePackage {
  name: string;
  dir: string;
  /** "./subpath" -> export target (e.g. "./dist/style-presets.js"). */
  exportsMap: Map<string, string>;
}

/** True when the path is an existing regular file (not a directory). */
export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the on-disk root of a third-party package by resolving its main
 * entry and walking up until we find the package.json whose "name" matches.
 * Unlike assuming a fixed "<root>/dist/index.js" layout, this handles any
 * entry depth (root-level main, dist/esm/..., ...). Returns "" if not found.
 */
export function resolvePkgDir(pkg: string, fromDir: string): string {
  try {
    const requireFromDir = createRequire(resolve(fromDir, "noop.js"));
    const main = requireFromDir.resolve(pkg, { paths: [fromDir] });
    let dir = dirname(main);
    while (dir !== dirname(dir)) {
      const pkgJsonPath = resolve(dir, "package.json");
      if (existsSync(pkgJsonPath)) {
        try {
          const json = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
            name?: string;
          };
          if (json.name === pkg) return dir;
        } catch {
          // malformed package.json: keep walking up
        }
      }
      dir = dirname(dir);
    }
  } catch {
    // not resolvable from the caller's dependency tree
  }
  return "";
}

/**
 * Read a package's "exports" map, flattening condition objects to the best
 * runtime target (import > default > require > types). Returns an empty map
 * when the package has no exports map.
 */
export function readExportsMap(pkgDir: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const json = JSON.parse(
      readFileSync(resolve(pkgDir, "package.json"), "utf8"),
    ) as {
      exports?: unknown;
    };
    const exportsValue = json.exports;
    if (
      !exportsValue ||
      typeof exportsValue !== "object" ||
      Array.isArray(exportsValue)
    ) {
      return map;
    }
    for (const [key, value] of Object.entries(exportsValue)) {
      const target = pickExportTarget(value);
      if (target) map.set(key, target);
    }
  } catch {
    // unreadable package.json -> no exports info
  }
  return map;
}

/**
 * Pick the runtime target out of an "exports" condition value.
 *
 * Handles both flat maps ({"import": "./dist/index.js"}) and nested dual-package
 * maps ({"import": {"types": "...", "default": "./dist/index.js"}}) by
 * recursively unwrapping conditions in import > default > require > types order.
 * Returns "" when nothing usable is found.
 */
export function pickExportTarget(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const conditions = value as Record<string, unknown>;
    for (const key of ["import", "default", "require", "types"]) {
      if (conditions[key] !== undefined) {
        const picked = pickExportTarget(conditions[key]);
        if (picked) return picked;
      }
    }
  }
  return "";
}

/**
 * Map a "./<subpath>" (or "*" wildcard) export key to its target path.
 * Returns "" when nothing matches.
 */
export function matchExportTarget(
  exportsMap: Map<string, string>,
  subpath: string,
): string {
  const exact = exportsMap.get(`./${subpath}`);
  if (exact) return exact;
  for (const [key, target] of exportsMap) {
    const keyBody = key.startsWith("./") ? key.slice(2) : key;
    // Note: indexOf must run against keyBody (without the "./" prefix),
    // otherwise the prefix/suffix slices are off by two characters.
    const starIdx = keyBody.indexOf("*");
    if (starIdx === -1) continue;
    const prefix = keyBody.slice(0, starIdx);
    const suffix = keyBody.slice(starIdx + 1);
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
      const middle = subpath.slice(
        prefix.length,
        subpath.length - suffix.length,
      );
      return target.replace("*", middle);
    }
  }
  return "";
}

/**
 * Source-file candidates that could back a given dist-relative export
 * target, e.g. "./dist/style-presets.js" -> "style-presets.ts".
 */
export function srcCandidatesFromDistTarget(target: string): string[] {
  const rel = target.replace(/^\.\//, "");
  const match = rel.match(/^dist\/(.+)\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts)$/i);
  if (!match) return [];
  const base = match[1]!;
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
}
