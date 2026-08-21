import { describe, it, expect, vi } from "vitest";
import { exportExcel } from "../index";
import { StylePresets } from "../style-presets";
// Node's fetch rejects file://, so sync-init the WASM (see setup.ts).
import "./setup";

// Node (vitest environment: 'node') has no Web Worker / window globals, so this
// suite verifies the env-aware fallbacks in pickMode without mocking.
describe("exportExcel mode routing (Node environment)", () => {
  it("forced 'worker' mode in a no-Worker env falls back to modern-xlsx, not SheetJS", async () => {
    const r = await exportExcel({
      filename: "routing-worker",
      download: false,
      mode: "worker",
      sheets: [
        {
          name: "S",
          columns: [{ key: "x", header: "X", style: StylePresets.currency }],
          data: [{ x: 1 }, { x: 2 }],
        },
      ],
    });
    // Previously: tried new Worker() -> threw -> degraded to SheetJS (styles
    // stripped). Now: main-thread Workbook, styles preserved.
    expect(r.success).toBe(true);
    expect(r.engine).toBe("modern-xlsx");
  });

  it("auto mode with a large dataset uses stream on the main thread in Node", async () => {
    const data = Array.from({ length: 60_000 }, (_, i) => ({ id: i }));
    const r = await exportExcel({
      filename: "routing-auto-stream",
      download: false,
      sheets: [{ name: "S", columns: [{ key: "id", header: "ID" }], data }],
    });
    expect(r.success).toBe(true);
    expect(r.engine).toBe("modern-xlsx");
    expect(r.mode).toBe("stream");
  });

  it("emits the documented 0 -> 1 onProgress pair even on the SheetJS fallback", async () => {
    // Force the early-bail fallback (WASM reported unsupported). The fallback
    // itself never reports progress; exportExcel must still open and close
    // the sequence exactly once each (types.ts onProgress contract).
    vi.stubGlobal("WebAssembly", undefined);
    try {
      const progress: number[] = [];
      const r = await exportExcel({
        filename: "routing-fallback-progress",
        download: false,
        sheets: [
          {
            name: "S",
            columns: [{ key: "x", header: "X" }],
            data: [{ x: 1 }, { x: 2 }],
          },
        ],
        onProgress: (p) => progress.push(p),
      });
      expect(r.engine).toBe("sheetjs");
      expect(r.success).toBe(true);
      expect(progress).toEqual([0, 1]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
