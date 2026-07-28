import type { ColumnConfig, FormatSpec } from "./types";
import { dateToSerial } from "modern-xlsx";

/** Default display patterns (Excel format codes) when FormatSpec omits `pattern`. */
export const DEFAULT_DATE_PATTERN = "yyyy-MM-dd";
export const DEFAULT_DATETIME_PATTERN = "yyyy-MM-dd HH:mm";

/** Safely stringify any value to a string (objects -> JSON, null/undef -> ''). */
export function toStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    return String(value);
  return JSON.stringify(value);
}

/**
 * Apply a FormatSpec to a raw value. Shared by WorkbookBuilder, StreamingBuilder,
 * and the worker entrypoint (FormatSpec is structured-clone-safe).
 */
export function applyFormat(value: unknown, spec: FormatSpec): string | number {
  switch (spec.type) {
    case "enum":
      return spec.map[toStr(value)] ?? spec.fallback ?? toStr(value);
    case "date": {
      const d = toJsDate(value);
      return d === null ? toStr(value) : dateToSerial(d);
    }
    case "datetime": {
      const d = toJsDate(value);
      return d === null ? toStr(value) : dateToSerial(d);
    }
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return toStr(value);
      // Return a typed number so the Workbook stores a numeric cell, not text.
      // Display precision (decimals) and grouping (thousands) are rendered via
      // an auto-injected numFormat in workbook-builder; the streaming path has
      // no numFormat support and emits the raw number.
      return Number(n.toFixed(spec.decimals ?? 0));
    }
    case "padding": {
      const s = toStr(value);
      return spec.align === "left"
        ? s.padEnd(spec.length, spec.fill)
        : s.padStart(spec.length, spec.fill);
    }
    default:
      return toStr(value);
  }
}

/**
 * Derive an Excel numFormat code from a FormatSpec so the Workbook can render
 * typed values (date serials, numbers) with the right display format. Returns
 * null for specs that produce plain strings (enum/padding) and need no numFormat.
 */
export function numFormatForSpec(spec: FormatSpec): string | null {
  switch (spec.type) {
    case "date":
      return spec.pattern ?? DEFAULT_DATE_PATTERN;
    case "datetime":
      return spec.pattern ?? DEFAULT_DATETIME_PATTERN;
    case "number": {
      const dec = spec.decimals ?? 0;
      const head = spec.thousands ? "#,##0" : "0";
      return dec > 0 ? `${head}.${"0".repeat(dec)}` : head;
    }
    default:
      return null;
  }
}

/**
 * Format a Date (or date-coercible value) into a display string using an
 * Excel-style pattern (tokens: yyyy MM dd HH mm ss). Used by the streaming
 * path, which has no numFormat support and must emit readable date strings.
 */
export function formatDateByPattern(value: unknown, pattern: string): string {
  const d = toJsDate(value);
  if (!d) return toStr(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  const tokens: Record<string, string> = {
    yyyy: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    dd: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (t) => tokens[t] ?? t);
}

/**
 * Resolve a column value to its display form: typed (number/boolean) when the
 * cell supports it, or a pattern-formatted string for dates. Shared by the
 * streaming path and the SheetJS fallback, which both lack numFormat support.
 */
export function displayValue(
  col: ColumnConfig,
  row: Record<string, unknown>,
): string | number | boolean {
  const spec = typeof col.format === "object" ? col.format : null;
  if (spec && (spec.type === "date" || spec.type === "datetime")) {
    const pattern =
      spec.type === "datetime"
        ? (spec.pattern ?? DEFAULT_DATETIME_PATTERN)
        : (spec.pattern ?? DEFAULT_DATE_PATTERN);
    return formatDateByPattern(row[col.key], pattern);
  }
  const v = resolveCellFormat(col, row);
  if (typeof v === "number" || typeof v === "boolean") return v;
  return toStr(v);
}

/**
 * Unified cell-value resolver (fixes the v1.9 format union bug): dispatches
 * function form directly, FormatSpec via applyFormat. Verified by minimal repro.
 */
export function resolveCellFormat(
  col: ColumnConfig,
  item: Record<string, unknown>,
): unknown {
  const raw = item[col.key];
  if (!col.format) return raw ?? "";
  if (typeof col.format === "function") return col.format(raw, item);
  return applyFormat(raw, col.format);
}

function toJsDate(value: unknown): Date | null {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" || typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
