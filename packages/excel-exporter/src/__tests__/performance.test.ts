import { describe, it, expect, beforeAll } from "vitest";
import { exportExcel } from "../index";
import { makeData, fourCols } from "./setup";

// CI skips these tests (RUN_PERF=0), so the local threshold is exactly the
// product SLA. Keep PERF_TIGHT for CI/local overrides if a future pipeline
// decides to run them on shared hardware.
const SLACK = Number(process.env.PERF_TIGHT ?? 1) > 0 ? 1.0 : 1.0;

// Perf 基线只在本地当回归看门狗；CI shared runner 抖动大，跑它只会 flake。
// 本地默认跑；设 RUN_PERF=0 跳过（CI 里用）。
const RUN_PERF = process.env.RUN_PERF !== "0";

describe.runIf(RUN_PERF)(
  "performance (Node WASM-core regression baseline)",
  () => {
    // Warm up WASM + JIT so init/compile cost isn't billed to the first case.
    beforeAll(async () => {
      await exportExcel({
        filename: "warmup",
        download: false,
        mode: "main",
        sheets: [
          {
            name: "s",
            columns: [{ key: "id", header: "ID" }],
            data: [{ id: 0 }],
          },
        ],
      });
    });

    it("10k rows x 4 cols (auto) < 200ms", async () => {
      const data = makeData(10_000);
      const t0 = performance.now();
      const r = await exportExcel({
        filename: "p10k",
        download: false,
        mode: "auto",
        sheets: [{ name: "s", columns: fourCols, data }],
      });
      const dt = performance.now() - t0;
      expect(r.success).toBe(true);
      expect(dt).toBeLessThan(200 * SLACK);
    });

    it("50k rows x 4 cols (auto) < 500ms", async () => {
      const data = makeData(50_000);
      const t0 = performance.now();
      const r = await exportExcel({
        filename: "p50k",
        download: false,
        mode: "auto",
        sheets: [{ name: "s", columns: fourCols, data }],
      });
      const dt = performance.now() - t0;
      expect(r.success).toBe(true);
      expect(r.mode).toBe("stream");
      expect(dt).toBeLessThan(500 * SLACK);
    });

    it("100k rows x 4 cols (auto) < 1000ms", async () => {
      const data = makeData(100_000);
      const t0 = performance.now();
      const r = await exportExcel({
        filename: "p100k",
        download: false,
        mode: "auto",
        sheets: [{ name: "s", columns: fourCols, data }],
      });
      const dt = performance.now() - t0;
      expect(r.success).toBe(true);
      expect(r.mode).toBe("stream");
      expect(dt).toBeLessThan(1000 * SLACK);
    });

    it("format function overhead does not dominate", async () => {
      const data = Array.from({ length: 10_000 }, (_, i) => ({ id: i }));
      const base = { name: "s", columns: [{ key: "id", header: "ID" }], data };

      const t0 = performance.now();
      await exportExcel({
        filename: "f1",
        download: false,
        mode: "main",
        sheets: [base],
      });
      const noop = performance.now() - t0;

      const t1 = performance.now();
      await exportExcel({
        filename: "f2",
        download: false,
        mode: "main",
        sheets: [
          {
            ...base,
            columns: [
              {
                key: "id",
                header: "ID",
                format: (v: unknown) => `#${String(v)}`,
              },
            ],
          },
        ],
      });
      const fn = performance.now() - t1;

      expect(fn - noop).toBeLessThan(30 * SLACK);
    });
  },
);

// The toBuffer cliff (Workbook 100k ~21s cold / ~600ms hot) is verified
// out-of-band via independent processes (see README). It cannot be asserted
// reliably in a single vitest process because the second run hits the hot
// cache (documented 28x first/hot gap). The 50k stream threshold is conservative.
