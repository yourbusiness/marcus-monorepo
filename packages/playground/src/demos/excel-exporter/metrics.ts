/**
 * Pure formatting helpers for the playground metrics panel. Kept free of DOM
 * and library imports so they are unit-testable (see
 * src/__tests__/metrics.test.ts).
 */

/** 1024-based human-readable size: 1536 -> "1.50 KB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (
    bytes === null ||
    bytes === undefined ||
    !Number.isFinite(bytes) ||
    bytes < 0
  ) {
    return "-";
  }
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 1 : 2)} ${units[i]}`;
}

/** Milliseconds -> "860ms" / "1.23s" / "-". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "-";
  }
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** rows / second, e.g. "20,000 行/s". */
export function formatThroughput(
  rows: number | null | undefined,
  ms: number | null | undefined,
): string {
  if (
    rows === null ||
    rows === undefined ||
    ms === null ||
    ms === undefined ||
    !Number.isFinite(rows) ||
    !Number.isFinite(ms) ||
    ms <= 0
  ) {
    return "-";
  }
  return `${Math.round((rows / ms) * 1000).toLocaleString()} 行/s`;
}

/** bytes / second, e.g. "1.50 MB/s". */
export function formatByteRate(
  bytes: number | null | undefined,
  ms: number | null | undefined,
): string {
  if (
    bytes === null ||
    bytes === undefined ||
    ms === null ||
    ms === undefined ||
    !Number.isFinite(bytes) ||
    !Number.isFinite(ms) ||
    ms <= 0
  ) {
    return "-";
  }
  return `${formatBytes((bytes / ms) * 1000)}/s`;
}

/** HH:mm:ss wall clock for the history table. */
export function formatClockTime(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
