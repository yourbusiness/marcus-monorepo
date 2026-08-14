import type { ExportOptions, ExportResult, ExportMode } from "./types";
import { WorkbookBuilder } from "./workbook-builder";
import { exportAsStream } from "./streaming-builder";
import { exportInWorker } from "./worker-exporter";
import { exportWithSheetJS } from "./fallback";
import { triggerDownload, toBlobPart } from "./download";
import { getWasmLoader } from "./wasm-loader";
import { tableExportToOptions, type TableExportOptions } from "./table-export";
import {
  echartsExportToOptions,
  type EChartsExportOptions,
} from "./echarts-export";

export * from "./types";
export * from "./style-presets";
export * from "./format-utils";
export * from "./table-export";
export * from "./echarts-export";
export { configureWasm, getWasmLoader } from "./wasm-loader";
export { WorkbookBuilder } from "./workbook-builder";
export { exportAsStream } from "./streaming-builder";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const STREAM_THRESHOLD = 50_000; // Workbook.toBuffer cliff starts ~55k rows
const WORKER_THRESHOLD = 20_000; // main-mode sync work is acceptable below this

type PickedMode = { mode: ExportMode; workerMode?: "workbook" | "stream" };

/**
 * Auto mode selection (verified against independent-process benchmarks).
 * - main fully blocks the thread; only for Node/SSR or browser <500 rows.
 * - browser >=500 rows go to a worker (main thread does one structured clone).
 * - inside the worker, >=50k rows use stream (avoids the toBuffer cliff).
 */
function pickMode(options: ExportOptions, totalRows: number): PickedMode {
  const explicit = options.mode ?? "auto";
  if (explicit === "stream") return { mode: "stream", workerMode: "stream" };
  if (explicit === "worker") {
    // Worker mode requires a Web Worker global. In environments without one
    // (Node/SSR), fall back to the main-thread path so styles are preserved
    // instead of silently degrading to the style-less SheetJS fallback.
    const isBrowser =
      typeof Worker !== "undefined" && typeof window !== "undefined";
    if (!isBrowser) {
      return totalRows >= STREAM_THRESHOLD
        ? { mode: "stream", workerMode: "stream" }
        : { mode: "main" };
    }
    return {
      mode: "worker",
      workerMode: totalRows >= STREAM_THRESHOLD ? "stream" : "workbook",
    };
  }
  if (explicit === "main") return { mode: "main" };

  // auto
  const isBrowser =
    typeof Worker !== "undefined" && typeof window !== "undefined";
  if (!isBrowser) {
    return totalRows >= STREAM_THRESHOLD
      ? { mode: "stream", workerMode: "stream" }
      : { mode: "main" };
  }
  if (totalRows < WORKER_THRESHOLD) return { mode: "main" };
  if (totalRows >= STREAM_THRESHOLD)
    return { mode: "worker", workerMode: "stream" };
  return { mode: "worker", workerMode: "workbook" };
}

/**
 * Export to Excel (main entry).
 *
 * @example
 * ```ts
 * import { exportExcel, StylePresets } from '@marcusok/excel-exporter';
 *
 * await exportExcel({
 *   filename: 'sales-report',
 *   sheets: [{
 *     name: 'Sales', freezeRows: 1, autoFilter: true,
 *     columns: [
 *       { key: 'product', header: 'Product', width: 20 },
 *       { key: 'revenue', header: 'Revenue', width: 15, style: StylePresets.currency },
 *     ],
 *     data: [{ product: 'Widget', revenue: 9999.99 }],
 *   }],
 * });
 * ```
 */
export async function exportExcel(
  options: ExportOptions,
): Promise<ExportResult> {
  const start = performance.now();
  const totalRows = options.sheets.reduce((s, sh) => s + sh.data.length, 0);

  const picked = pickMode(options, totalRows);
  const needsWasm = picked.workerMode !== "stream";
  const loader = getWasmLoader();
  if (needsWasm && !loader.supported) {
    return exportWithSheetJS(options, start, "WebAssembly not supported");
  }

  // Node main/stream: execute directly on this thread (no Web Worker available).
  if (
    picked.mode === "main" ||
    (picked.mode === "stream" && typeof window === "undefined")
  ) {
    try {
      if (needsWasm) {
        const initStart = performance.now();
        await loader.ensureLoaded();
        options.onPhase?.("init", performance.now() - initStart);
      } else {
        // Fast stream does not use WASM; report an empty init phase so the
        // public phase sequence remains stable across main/stream routes.
        options.onPhase?.("init", 0);
      }
      options.onProgress?.(0);
      let result: ExportResult;
      const buildStart = performance.now();
      try {
        if (picked.workerMode === "stream") {
          const { bytes, rowCount } = await exportAsStream(
            options.sheets,
            options.onProgress,
          );
          result = {
            success: true,
            blob: new Blob([toBlobPart(bytes)], { type: XLSX_MIME }),
            engine: "modern-xlsx",
            mode: "stream",
            duration: performance.now() - start,
            rowCount,
          };
        } else {
          const builder = await WorkbookBuilder.create();
          options.sheets.forEach((s) => builder.addSheet(s));
          const bytes = await builder.toBuffer();
          result = {
            success: true,
            blob: new Blob([toBlobPart(bytes)], { type: XLSX_MIME }),
            engine: "modern-xlsx",
            mode: "main",
            duration: performance.now() - start,
            rowCount: totalRows,
          };
        }
      } finally {
        // Reported even when the build throws, so a failed attempt that falls
        // back to SheetJS still shows how long it spent before failing.
        options.onPhase?.("build", performance.now() - buildStart);
      }
      options.onProgress?.(1);
      if (options.download !== false) {
        const downloadStart = performance.now();
        triggerDownload(result.blob!, options.filename);
        options.onPhase?.("download", performance.now() - downloadStart);
      }
      return result;
    } catch (e) {
      return exportWithSheetJS(options, start, (e as Error).message);
    }
  }

  // Browser worker mode: offload to worker (main thread does one structured clone).
  try {
    options.onProgress?.(0);
    const result = await exportInWorker(options, picked.workerMode!);
    options.onProgress?.(1);
    if (result.success) {
      if (options.download !== false) {
        const downloadStart = performance.now();
        triggerDownload(result.blob!, options.filename);
        options.onPhase?.("download", performance.now() - downloadStart);
      }
      return result;
    }
    // Worker export failed (e.g. WASM init error inside the worker) -> degrade
    // to SheetJS, matching the main-thread path's failure handling.
    return exportWithSheetJS(
      options,
      start,
      result.error?.message ?? "worker export failed",
    );
  } catch (e) {
    return exportWithSheetJS(options, start, (e as Error).message);
  }
}

/**
 * Convenience wrapper for common table data shapes.
 *
 * Accepts Ant Design-style (`title` / `dataIndex`) and Element Plus-style
 * (`label` / `prop`) column descriptors, normalizes them to `SheetConfig`,
 * and delegates to {@link exportExcel}.
 */
export async function exportTable(
  options: TableExportOptions,
): Promise<ExportResult> {
  return exportExcel(tableExportToOptions(options));
}

/**
 * Convenience wrapper for a small, explicit subset of ECharts options.
 *
 * Supports category-axis series data, pie-like name/value data, and
 * scatter-like coordinate pairs. Unsupported `dataset` mode throws instead of
 * guessing.
 */
export async function exportEcharts(
  options: EChartsExportOptions,
): Promise<ExportResult> {
  return exportExcel(echartsExportToOptions(options));
}
