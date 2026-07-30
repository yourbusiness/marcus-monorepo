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
      // Keep full precision: the stored cell value must not be truncated.
      // Display decimals/thousands are rendered via an auto-injected numFormat
      // on the workbook path (see numFormatForSpec / withAutoNumFormat). The
      // stream/SheetJS paths (no numFormat support) bake decimals into the
      // displayed value in displayValue instead.
      return n;
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
  // Excel format codes are case-insensitive, so normalize to lowercase first.
  // `mm` is ambiguous: minutes when it directly follows an hour token (`hh`),
  // otherwise the month. Scan the token stream once and resolve each `mm` from
  // its predecessor so `yyyy-mm-dd`, `yyyy-MM-dd` and `HH:mm:ss` all match.
  const lower = pattern.toLowerCase();
  const parts = {
    yyyy: String(d.getFullYear()),
    month: pad(d.getMonth() + 1),
    dd: pad(d.getDate()),
    hh: pad(d.getHours()),
    minute: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  const TOKEN = /yyyy|mm|dd|hh|ss/g;
  const hits: { tok: string; idx: number }[] = [];
  let mt: RegExpExecArray | null;
  while ((mt = TOKEN.exec(lower)) !== null) {
    hits.push({ tok: mt[0], idx: mt.index });
  }
  let out = "";
  let lastEnd = 0;
  for (let i = 0; i < hits.length; i++) {
    const { tok, idx } = hits[i];
    out += lower.slice(lastEnd, idx);
    lastEnd = idx + tok.length;
    if (tok === "mm") {
      // Minute only when directly preceded by an hour token; else month.
      out += hits[i - 1]?.tok === "hh" ? parts.minute : parts.month;
    } else {
      out += parts[tok as keyof typeof parts];
    }
  }
  out += lower.slice(lastEnd);
  return out;
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
  if (spec) {
    if (spec.type === "date" || spec.type === "datetime") {
      const pattern =
        spec.type === "datetime"
          ? (spec.pattern ?? DEFAULT_DATETIME_PATTERN)
          : (spec.pattern ?? DEFAULT_DATE_PATTERN);
      return formatDateByPattern(row[col.key], pattern);
    }
    if (spec.type === "number") {
      // Stream/SheetJS paths have no numFormat support, so the configured
      // decimals must be baked into the displayed value here. The workbook
      // path keeps full precision and renders decimals via numFormat instead.
      const n = Number(row[col.key]);
      if (!Number.isFinite(n)) return toStr(row[col.key]);
      return Number(n.toFixed(spec.decimals ?? 0));
    }
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

const SHEET_NAME_FORBIDDEN = /[\\/?*[\]:]/;

/**
 * Validate a sheet name per ECMA-376 / Excel constraints. Throws on names that
 * would produce a corrupt workbook: empty, longer than 31 chars, or containing
 * any of `: \ / ? * [ ]`.
 */
export function validateSheetName(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("[excel-exporter] sheet name must be a non-empty string");
  }
  if (name.length > 31) {
    throw new Error(
      `[excel-exporter] sheet name "${name.slice(0, 31)}…" exceeds the 31-char Excel limit`,
    );
  }
  if (SHEET_NAME_FORBIDDEN.test(name)) {
    throw new Error(
      `[excel-exporter] sheet name "${name}" contains forbidden characters (: \\ / ? * [ ])`,
    );
  }
}
