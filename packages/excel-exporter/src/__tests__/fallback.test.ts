import { describe, it, expect } from "vitest";
import { exportWithSheetJS } from "../fallback";
import type { ExportOptions } from "../types";
import { readBuffer } from "./setup";

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

  it("writes grouped headers and data merges in the fallback", async () => {
    const opts = makeOptions("fallback-grouped");
    opts.sheets[0] = {
      name: "Sheet1",
      columns: [
        { key: "product", header: "产品" },
        {
          header: "收入情况",
          children: [
            {
              header: "本月",
              children: [
                { key: "m_qty", header: "数量" },
                { key: "m_amt", header: "金额" },
              ],
            },
          ],
        },
      ],
      data: [{ product: "A", m_qty: 1, m_amt: 2 }],
      merges: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }],
    };

    const result = await exportWithSheetJS(opts, performance.now(), "test");
    expect(result.success).toBe(true);

    const wb = await readBuffer(
      new Uint8Array(await result.blob!.arrayBuffer()),
    );
    const ws = wb.getSheet("Sheet1")!;
    // 3 header rows (收入情况 > 本月 > 数量/金额) + 1 data row.
    expect(ws.rowCount).toBe(4);
    expect(ws.cell("A1").value).toBe("产品");
    expect(ws.cell("B1").value).toBe("收入情况");
    expect(ws.cell("B2").value).toBe("本月");
    expect(ws.cell("B3").value).toBe("数量");
    // Leaf header A1:A3, groups B1:C1 / B2:C2, data merge A4:B4 (row 0 data-relative).
    for (const r of ["A1:A3", "B1:C1", "B2:C2", "A4:B4"]) {
      expect(ws.mergeCells).toContain(r);
    }
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
