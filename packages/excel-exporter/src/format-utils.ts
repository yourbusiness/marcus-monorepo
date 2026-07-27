import type { ColumnConfig, FormatSpec } from './types';

/** Safely stringify any value to a string (objects -> JSON, null/undef -> ''). */
export function toStr(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

/**
 * Apply a FormatSpec to a raw value. Shared by WorkbookBuilder, StreamingBuilder,
 * and the worker entrypoint (FormatSpec is structured-clone-safe).
 */
export function applyFormat(value: unknown, spec: FormatSpec): string | number {
  switch (spec.type) {
    case 'enum':
      return spec.map[toStr(value)] ?? spec.fallback ?? toStr(value);
    case 'date': {
      const d = toJsDate(value);
      return d === null ? toStr(value) : formatDate(d, spec.pattern ?? 'yyyy-MM-dd');
    }
    case 'datetime': {
      const d = toJsDate(value);
      return d === null ? toStr(value) : formatDate(d, spec.pattern ?? 'yyyy-MM-dd HH:mm');
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return toStr(value);
      return spec.thousands
        ? n.toLocaleString('en-US', { minimumFractionDigits: spec.decimals ?? 0, maximumFractionDigits: spec.decimals ?? 0 })
        : n.toFixed(spec.decimals ?? 0);
    }
    case 'padding': {
      const s = toStr(value);
      return spec.align === 'left' ? s.padEnd(spec.length, spec.fill) : s.padStart(spec.length, spec.fill);
    }
    default:
      return toStr(value);
  }
}

/**
 * Unified cell-value resolver (fixes the v1.9 format union bug): dispatches
 * function form directly, FormatSpec via applyFormat. Verified by minimal repro.
 */
export function resolveCellFormat(col: ColumnConfig, item: Record<string, unknown>): unknown {
  const raw = item[col.key];
  if (!col.format) return raw ?? '';
  if (typeof col.format === 'function') return col.format(raw, item);
  return applyFormat(raw, col.format);
}

function toJsDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' || typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Minimal strftime-like formatter for the patterns we expose. */
function formatDate(d: Date, pattern: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const map: Record<string, string> = {
    yyyy: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    dd: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (m) => map[m] ?? m);
}
