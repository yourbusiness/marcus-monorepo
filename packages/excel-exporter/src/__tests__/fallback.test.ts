import { describe, it, expect } from "vitest";
import { exportWithSheetJS } from "../fallback";
import type { ExportOptions } from "../types";

// Minimal options shared by all fallback cases. `download: false` keeps the
// test headless: triggerDownload() is a no-op in Node anyway, but this also
// documents intent. Two rows => rowCount 2.
function makeOptions(filename: string): ExportOptions {
  return {
    filename,
    download: false,
    sheets: [
      {
        name: "Sheet1",
        columns: [
          { key: "name", header: "Name" },
          { key: "value", header: "Value" },
        ],
        data: [
          { name: "Alice", value: 10 },
          { name: "Bob", value: 20 },
        ],
      },
    ],
  };
}

describe("SheetJS fallback (exportWithSheetJS)", () => {
  it("exports a real xlsx blob via the local xlsx module", async () => {
    const result = await exportWithSheetJS(
      makeOptions("fallback-direct"),
      performance.now(),
      "test: direct invocation",
    );

    expect(result.success).toBe(true);
    expect(result.engine).toBe("sheetjs");
    expect(result.mode).toBe("main");
    expect(result.rowCount).toBe(2);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob!.size).toBeGreaterThan(0);
    // Styles are stripped in the fallback; the soft error signals that.
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toMatch(/styles stripped/i);
  });

  it('still succeeds when the fallback reason is "WebAssembly not supported"', async () => {
    const result = await exportWithSheetJS(
      makeOptions("fallback-wasm-unsupported"),
      performance.now(),
      "WebAssembly not supported",
    );

    expect(result.success).toBe(true);
    expect(result.engine).toBe("sheetjs");
  });

  it("honours multiple sheets in rowCount accounting", async () => {
    const opts = makeOptions("fallback-multi");
    opts.sheets.push({
      name: "Sheet2",
      columns: [{ key: "x", header: "X" }],
      data: [{ x: 1 }, { x: 2 }, { x: 3 }],
    });

    const result = await exportWithSheetJS(
      opts,
      performance.now(),
      "test: multi-sheet",
    );

    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(5);
  });
});
