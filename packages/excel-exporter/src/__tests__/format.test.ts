import { describe, it, expect } from "vitest";
import {
  applyFormat,
  resolveCellFormat,
  numFormatForSpec,
  formatDateByPattern,
} from "../format-utils";
import { serialToDate } from "modern-xlsx";
import type { ColumnConfig } from "../types";

describe("applyFormat", () => {
  it("enum: maps known values, falls back for unknown", () => {
    const spec = {
      type: "enum" as const,
      map: { paid: "Paid" },
      fallback: "?",
    };
    expect(applyFormat("paid", spec)).toBe("Paid");
    expect(applyFormat("unknown", spec)).toBe("?");
  });

  it("number: returns a typed number; grouping/precision are left to numFormat", () => {
    // applyFormat now yields a real number so Workbook stores a numeric cell,
    // not text. Display formatting (decimals/thousands) is rendered via the
    // auto-injected numFormat (see numFormatForSpec).
    expect(
      applyFormat(1234567, { type: "number", decimals: 2, thousands: true }),
    ).toBe(1234567);
    expect(applyFormat(3, { type: "number", decimals: 2 })).toBe(3);
    expect(applyFormat(3.14159, { type: "number", decimals: 2 })).toBe(3.14);
  });

  it("padding: left/right align", () => {
    expect(applyFormat(42, { type: "padding", fill: "0", length: 5 })).toBe(
      "00042",
    );
    expect(
      applyFormat("ab", {
        type: "padding",
        fill: " ",
        length: 5,
        align: "left",
      }),
    ).toBe("ab   ");
  });

  it("date/datetime: returns Excel serial numbers (numFormat-compatible)", () => {
    const d = new Date(2025, 0, 5, 14, 30);
    const s = applyFormat(d, { type: "date" });
    // Should return a number (Excel serial), not a string
    expect(typeof s).toBe("number");
    // Round-trip: serial -> Date should match original (date part)
    const rt = serialToDate(s as number);
    expect(rt.getFullYear()).toBe(2025);
    expect(rt.getMonth()).toBe(0);
    expect(rt.getDate()).toBe(5);
    // datetime same : both return same serial (time part preserved via dateToSerial)
    const s2 = applyFormat(d, { type: "datetime" });
    expect(s2).toBe(s);
  });
});

describe("resolveCellFormat (union dispatch)", () => {
  it("returns raw value when no format", () => {
    const col: ColumnConfig = { key: "x", header: "X" };
    expect(resolveCellFormat(col, { x: "raw" })).toBe("raw");
    expect(resolveCellFormat(col, {})).toBe(""); // missing key -> ''
  });

  it("calls function form", () => {
    const col: ColumnConfig = {
      key: "n",
      header: "N",
      format: (v) => Number(v) * 2,
    };
    expect(resolveCellFormat(col, { n: 5 })).toBe(10);
  });

  it("dispatches FormatSpec via applyFormat", () => {
    const col: ColumnConfig = {
      key: "s",
      header: "S",
      format: { type: "enum", map: { a: "Alpha" } },
    };
    expect(resolveCellFormat(col, { s: "a" })).toBe("Alpha");
  });
});

describe("numFormatForSpec", () => {
  it("date/datetime: returns the pattern or default", () => {
    expect(numFormatForSpec({ type: "date" })).toBe("yyyy-MM-dd");
    expect(numFormatForSpec({ type: "date", pattern: "dd/MM/yyyy" })).toBe(
      "dd/MM/yyyy",
    );
    expect(numFormatForSpec({ type: "datetime" })).toBe("yyyy-MM-dd HH:mm");
  });

  it("number: builds an Excel numFormat from decimals + thousands", () => {
    expect(numFormatForSpec({ type: "number", decimals: 2 })).toBe("0.00");
    expect(
      numFormatForSpec({ type: "number", decimals: 2, thousands: true }),
    ).toBe("#,##0.00");
    expect(numFormatForSpec({ type: "number", thousands: true })).toBe("#,##0");
  });

  it("enum/padding: produce no numFormat (string-valued)", () => {
    expect(numFormatForSpec({ type: "enum", map: {} })).toBeNull();
    expect(
      numFormatForSpec({ type: "padding", fill: "0", length: 5 }),
    ).toBeNull();
  });
});

describe("formatDateByPattern", () => {
  it("formats a Date per the given pattern", () => {
    const d = new Date(2025, 0, 5, 14, 30, 9);
    expect(formatDateByPattern(d, "yyyy-MM-dd")).toBe("2025-01-05");
    expect(formatDateByPattern(d, "yyyy-MM-dd HH:mm")).toBe("2025-01-05 14:30");
    expect(formatDateByPattern(d, "dd/MM/yyyy HH:mm:ss")).toBe(
      "05/01/2025 14:30:09",
    );
  });

  it("parses date-coercible strings", () => {
    expect(formatDateByPattern("2025-01-05", "yyyy-MM-dd")).toBe("2025-01-05");
  });

  it("returns the raw stringified value for non-date input", () => {
    expect(formatDateByPattern("not-a-date", "yyyy-MM-dd")).toBe("not-a-date");
  });
});
