/**
 * Type definitions for @marcus/excel-exporter.
 *
 * Colors use 6-digit RGB hex (e.g. `'FF0000'`), matching modern-xlsx's
 * FontData.color / FillData.fgColor / BorderSideData.color (verified from
 * dist/validate-chart-D1O7LOfU.d.mts @ modern-xlsx 1.2.0).
 */
import type { BorderStyle } from 'modern-xlsx';
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
    pattern?: 'solid' | 'none';
    fgColor?: string; // 6-digit RGB hex
    bgColor?: string;
  };
  alignment?: {
    horizontal?: 'left' | 'center' | 'right';
    vertical?: 'top' | 'center' | 'bottom';
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
 * FormatSpec only. Function form works in `main` mode (browser <500 rows / Node).
 */
export type FormatSpec =
  | { type: 'enum'; map: Record<string, string>; fallback?: string }
  | { type: 'date'; pattern?: string } // default 'yyyy-MM-dd'
  | { type: 'datetime'; pattern?: string } // default 'yyyy-MM-dd HH:mm'
  | { type: 'number'; decimals?: number; thousands?: boolean }
  | { type: 'padding'; fill: string; length: number; align?: 'left' | 'right' };

/** Column configuration. */
export interface ColumnConfig {
  key: string;
  header: string;
  /** Column width in Excel character units. Mapped to ws.setColumnWidth(col, width) (1-based). */
  width?: number;
  /** Style applied to all data cells in this column (not the header). */
  style?: CellStyle;
  /** Value formatter: FormatSpec (worker-compatible) or function (main/Node only). */
  format?: FormatSpec | ((value: unknown, row: Record<string, unknown>) => string | number | boolean);
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
  /** Number of header rows to freeze (usually 1). Maps to ws.frozenPane = { rows, cols: 0 }. */
  freezeRows?: number;
  /** Merged cell ranges. */
  merges?: MergeRange[];
  /** Whether to add an auto-filter over the header range. */
  autoFilter?: boolean;
}

/** Export mode. */
export type ExportMode = 'auto' | 'main' | 'worker' | 'stream';

/** Export options. */
export interface ExportOptions {
  sheets: SheetConfig[];
  filename: string;
  /** Mode selection: auto = auto-decide by row count (default). */
  mode?: ExportMode;
  /** Progress callback (0-1); effective in worker/stream mode only. */
  onProgress?: (progress: number) => void;
  /** Trigger browser download (default true). Set false to only return a Blob. */
  download?: boolean;
}

/** Export result. */
export interface ExportResult {
  success: boolean;
  blob?: Blob;
  /** Engine actually used. */
  engine?: 'modern-xlsx' | 'sheetjs';
  /** Mode actually used. */
  mode?: ExportMode;
  duration?: number; // ms
  rowCount?: number;
  error?: Error;
}
