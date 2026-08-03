import { describe, expect, it } from "vitest";
import {
  matchExportTarget,
  pickExportTarget,
  srcCandidatesFromDistTarget,
} from "../vite/workspace-resolver";

describe("pickExportTarget", () => {
  it("passes through a plain string target", () => {
    expect(pickExportTarget("./dist/index.js")).toBe("./dist/index.js");
  });

  it("prefers import over default/require/types", () => {
    const value = {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      require: "./dist/index.cjs",
      default: "./dist/index.js",
    };
    expect(pickExportTarget(value)).toBe("./dist/index.js");
  });

  it("unwraps nested condition objects (dual-package exports)", () => {
    const value = {
      import: { types: "./dist/index.d.ts", default: "./dist/index.js" },
      require: "./dist/index.cjs",
    };
    expect(pickExportTarget(value)).toBe("./dist/index.js");
  });

  it("falls back to the next condition when a branch has no runtime target", () => {
    const value = { import: {}, default: "./dist/index.js" };
    expect(pickExportTarget(value)).toBe("./dist/index.js");
  });

  it("returns empty string for unsupported shapes", () => {
    expect(pickExportTarget(null)).toBe("");
    expect(pickExportTarget(undefined)).toBe("");
    expect(pickExportTarget([])).toBe("");
    expect(pickExportTarget(42)).toBe("");
  });
});

describe("matchExportTarget", () => {
  const map = new Map<string, string>([
    ["./styles", "./dist/style-presets.js"],
    ["./worker-utils", "./dist/worker-utils.js"],
    ["./dist/*.js", "./dist/*.js"],
  ]);

  it("matches exact keys", () => {
    expect(matchExportTarget(map, "styles")).toBe("./dist/style-presets.js");
  });

  it("matches single-star wildcard keys", () => {
    expect(matchExportTarget(map, "dist/export.worker.js")).toBe(
      "./dist/export.worker.js",
    );
  });

  it("returns empty string when nothing matches", () => {
    expect(matchExportTarget(map, "nope")).toBe("");
  });
});

describe("srcCandidatesFromDistTarget", () => {
  it("maps a dist file back to plausible source candidates", () => {
    expect(srcCandidatesFromDistTarget("./dist/style-presets.js")).toEqual([
      "style-presets.ts",
      "style-presets.tsx",
      "style-presets/index.ts",
      "style-presets/index.tsx",
    ]);
  });

  it("handles nested dist paths", () => {
    expect(srcCandidatesFromDistTarget("./dist/workers/export.js")).toEqual([
      "workers/export.ts",
      "workers/export.tsx",
      "workers/export/index.ts",
      "workers/export/index.tsx",
    ]);
  });

  it("returns empty for non-dist targets", () => {
    expect(srcCandidatesFromDistTarget("./src/index.ts")).toEqual([]);
  });
});
