/**
 * Type definitions for @marcusok/excel-exporter.
 *
 * Colors use 6-digit RGB hex (e.g. `'FF0000'`), matching modern-xlsx's
 * FontData.color / FillData.fgColor / BorderSideData.color (verified from
 * dist/validate-chart-D1O7LOfU.d.mts @ modern-xlsx 1.2.0).
 */
import type { BorderStyle } from "modern-xlsx";
export type { BorderStyle };

/** Business-friendly cell style config; mapped to StyleBuilder in style-utils.ts. */
export interface CellStyle {
  font?: {
    bold?: boolean;
    italic?: boolean;
    size?: number;
    color?: string; // 6-digit RGB hex, e.g. 'FF0000'
    name?: string; // font name, e.g. 'Arial'
  };
  fill?: {
    pattern?: "solid" | "none";
    fgColor?: string; // 6-digit RGB hex
    bgColor?: string;
  };
  alignment?: {
    horizontal?: "left" | "center" | "right";
    vertical?: "top" | "center" | "bottom";
    wrapText?: boolean;
    textRotation?: number; // 0-180
  };
  border?: {
    top?: { style: BorderStyle; color?: string };
    bottom?: { style: BorderStyle; color?: string };
    left?: { style: BorderStyle; color?: string };
    right?: { style: BorderStyle; color?: string };
  };
  numFormat?: string; // e.g. '#,##0.00', 'yyyy-mm-dd', '0.00%'
}

/**
 * Worker-compatible, data-describing format spec. Functions cannot cross the
 * structured-clone boundary into a Web Worker, so worker/stream mode accepts
 * FormatSpec only. Function form works in `main` mode (browser <20,000 rows / Node).
 *
 * Date semantics: `date`/`datetime` interpret values by their **UTC
 * components**. The workbook path serializes via modern-xlsx's `dateToSerial`
 * (UTC wall clock) and the stream/SheetJS paths format the same UTC components
 * into strings, so all paths agree in every timezone. Date-only ISO strings
 * ("2025-01-05") parse as UTC midnight per ECMA-262; prefer them (or
 * `Date.UTC(...)`) over locally-constructed Dates, whose UTC components can
 * fall on the previous day in non-UTC timezones.
 */
export type FormatSpec =
  | { type: "enum"; map: Record<string, string>; fallback?: string }
  | { type: "date"; pattern?: string } // default 'yyyy-MM-dd'
  | { type: "datetime"; pattern?: string } // default 'yyyy-MM-dd HH:mm'
  | { type: "number"; decimals?: number; thousands?: boolean }
  | { type: "padding"; fill: string; length: number; align?: "left" | "right" };

/** Column configuration. */
export interface ColumnConfig {
  key: string;
  header: string;
  /** Column width in Excel character units. Mapped to ws.setColumnWidth(col, width) (1-based). */
  width?: number;
  /** Style applied to all data cells in this column (not the header). */
  style?: CellStyle;
  /** Style applied to this column's header cell. Takes precedence over SheetConfig.headerStyle. */
  headerStyle?: CellStyle;
  /**
   * Value formatter: FormatSpec (worker-compatible) or function (main/Node only).
   *
   * Cross-path precision: a `{ type: "number" }` spec without `decimals`
   * defaults to 0, but only the stream path (>= STREAM_THRESHOLD, 50,000 rows)
   * bakes `toFixed(0)` into the stored cell value. The Workbook path keeps full
   * precision and renders decimals via numFormat, so the same spec can store
   * `9999.99` (Workbook) vs `10000` (stream). Always set `decimals` explicitly
   * for cross-threshold consistency (see docs/excel-export-design.md 4.8).
   */
  format?:
    | FormatSpec
    | ((
        value: unknown,
        row: Record<string, unknown>,
      ) => string | number | boolean);
}

/** Merge range: relative to the data area, row/col are 0-based (row 0 = first data row). */
export interface MergeRange {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

/** Sheet configuration. */
export interface SheetConfig {
  name: string; // 1-31 chars, ECMA-376 validation
  columns: ColumnConfig[];
  data: Record<string, unknown>[];
  /** Style applied to every header cell, unless overridden by ColumnConfig.headerStyle. */
  headerStyle?: CellStyle;
  /** Number of header rows to freeze (usually 1). Maps to ws.frozenPane = { rows, cols: 0 }. */
  freezeRows?: number;
  /** Merged cell ranges. */
  merges?: MergeRange[];
  /** Whether to add an auto-filter over the header range. */
  autoFilter?: boolean;
}

/** Export mode. */
export type ExportMode = "auto" | "main" | "worker" | "stream";

/**
 * Named export stages, reported through `onPhase` as they complete. Phases are
 * strictly sequential within one export call.
 *
 * - `"init"`: WASM initialization. Main-thread paths measure
 *   `loader.ensureLoaded()`; worker mode measures the worker's `initWasm()`
 *   (only reported when the worker actually re-initializes, not when its WASM
 *   instance is already cached). Not reported by the SheetJS fallback (no WASM).
 * - `"build"`: workbook construction. Covers the Workbook/stream builder, or
 *   SheetJS's sheet building + write in the fallback path. A failed modern-xlsx
 *   build followed by a SheetJS fallback reports two `"build"` phases, one per
 *   actual build attempt.
 * - `"download"`: the synchronous browser download trigger
 *   (`triggerDownload`); only reported when `download !== false`. Not reported
 *   in Node (no `document`).
 */
export type ExportPhase = "init" | "build" | "download";

/** Export options. */
export interface ExportOptions {
  sheets: SheetConfig[];
  filename: string;
  /** Mode selection: auto = auto-decide by row count (default). */
  mode?: ExportMode;
  /**
   * Progress callback (0-1). The leading 0 and the trailing 1 are each emitted
   * exactly once by `exportExcel` itself, on every route — including the
   * SheetJS fallback and exports that ultimately fail — so a progress UI can
   * always be closed on the final 1. The stream path additionally reports
   * intermediate values every 1,000 rows.
   */
  onProgress?: (progress: number) => void;
  /**
   * Optional per-stage timing callback. Receives the phase name and its
   * wall-clock duration in ms (0 means the phase did no work, e.g. WASM was
   * already loaded). Useful for metrics/play panels; does not affect
   * `ExportResult.duration` (which keeps measuring the whole export).
   */
  onPhase?: (phase: ExportPhase, durationMs: number) => void;
  /** Trigger browser download (default true). Set false to only return a Blob. */
  download?: boolean;
}

/** Export result. */
export interface ExportResult {
  success: boolean;
  blob?: Blob;
  /** Engine actually used. */
  engine?: "modern-xlsx" | "sheetjs";
  /** Mode actually used. */
  mode?: ExportMode;
  duration?: number; // ms
  rowCount?: number;
  error?: Error;
}
