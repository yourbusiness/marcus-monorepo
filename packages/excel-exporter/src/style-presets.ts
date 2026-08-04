import type { CellStyle } from "./types";

export const StylePresets = {
  /** Header: bold, dark-blue fill, white text, centered. */
  header: {
    font: { bold: true, size: 12, color: "FFFFFF" },
    fill: { pattern: "solid", fgColor: "1F4E79" },
    alignment: { horizontal: "center", vertical: "center" },
  } satisfies CellStyle,

  /** Currency: thousands separator, 2 decimals, right-aligned. */
  currency: {
    numFormat: "#,##0.00",
    alignment: { horizontal: "right" },
  } satisfies CellStyle,

  /** Percentage. */
  percent: {
    numFormat: "0.00%",
    alignment: { horizontal: "right" },
  } satisfies CellStyle,

  /** Date: YYYY-MM-DD, centered. */
  date: {
    numFormat: "yyyy-MM-dd",
    alignment: { horizontal: "center" },
  } satisfies CellStyle,

  /** Datetime: YYYY-MM-DD HH:MM. */
  datetime: {
    numFormat: "yyyy-MM-dd HH:mm",
    alignment: { horizontal: "center" },
  } satisfies CellStyle,

  /** Data row: left-aligned, thin bottom border. */
  dataRow: {
    alignment: { horizontal: "left", vertical: "center" },
    border: { bottom: { style: "thin", color: "D0D0D0" } },
  } satisfies CellStyle,

  /** Danger: bold red text, centered. */
  danger: {
    font: { color: "C00000", bold: true },
    alignment: { horizontal: "center" },
  } satisfies CellStyle,
} as const;

export type StylePresetName = keyof typeof StylePresets;
