import { describe, it, expect, beforeAll } from "vitest";
import { exportExcel } from "../index";
import { makeData, fourCols } from "./setup";

// CI shared runners have variance: 1.5x slack by default, 1.0x when PERF_TIGHT=1.
// GitHub Actions ubuntu runners are ~1.5-2x slower than a dev desktop for
// CPU/WASM work; 1.5x keeps the regression guard useful without flaking on CI.
const SLACK = Number(process.env.PERF_TIGHT ?? 0) > 0 ? 1.0 : 1.5;

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

    it("10k rows x 4 cols (main) < 200ms", async () => {
      const t0 = performance.now();
      const r = await exportExcel({
        filename: "p10k",
        download: false,
        mode: "main",
        sheets: [{ name: "s", columns: fourCols, data: makeData(10_000) }],
      });
      const dt = performance.now() - t0;
      expect(r.success).toBe(true);
      // Verified baseline: ~120-130ms. 200ms gives headroom.
      expect(dt).toBeLessThan(200 * SLACK);
    });

    it("50k rows x 4 cols (main) < 1000ms", async () => {
      const t0 = performance.now();
      const r = await exportExcel({
        filename: "p50k",
        download: false,
        mode: "main",
        sheets: [{ name: "s", columns: fourCols, data: makeData(50_000) }],
      });
      const dt = performance.now() - t0;
      expect(r.success).toBe(true);
      // Verified baseline: ~565ms fast desktop / ~830ms documented first-process.
      // The old 700ms base sat BELOW the documented baseline and flaked on CI.
      // Base 1000ms with 1.5x default slack => 1500ms, safe on shared runners.
      expect(dt).toBeLessThan(1000 * SLACK);
    });

    it("100k rows x 4 cols (stream) < 2000ms", async () => {
      const t0 = performance.now();
      const r = await exportExcel({
        filename: "p100k",
        download: false,
        mode: "stream",
        sheets: [{ name: "s", columns: fourCols, data: makeData(100_000) }],
      });
      const dt = performance.now() - t0;
      expect(r.success).toBe(true);
      // Verified baseline: ~1630ms. 2000ms with slack is comfortable.
      expect(dt).toBeLessThan(2000 * SLACK);
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
