import { describe, it, expect } from "vitest";
import {
  applyFormat,
  resolveCellFormat,
  numFormatForSpec,
  formatDateByPattern,
  displayValue,
  validateSheetName,
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
    // applyFormat keeps full precision: the stored cell value is never truncated.
    // Display formatting (decimals/thousands) is rendered via the auto-injected
    // numFormat on the workbook path (see numFormatForSpec). The stream/SheetJS
    // paths bake decimals into displayValue instead.
    expect(
      applyFormat(1234567, { type: "number", decimals: 2, thousands: true }),
    ).toBe(1234567);
    expect(applyFormat(3, { type: "number", decimals: 2 })).toBe(3);
    // decimals=2 must NOT truncate the stored value (3.14159 stays 3.14159);
    // only the displayed cell rounds via numFormat.
    expect(applyFormat(3.14159, { type: "number", decimals: 2 })).toBe(3.14159);
    // No decimals spec -> still keeps full precision (was: 1235 via toFixed(0)).
    expect(applyFormat(1234.567, { type: "number", thousands: true })).toBe(
      1234.567,
    );
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
  // Inputs are UTC-constructed so the expected strings hold in every runner
  // timezone: formatDateByPattern formats the date's UTC components (matching
  // the workbook path's dateToSerial, which also uses UTC components).
  it("formats a Date per the given pattern", () => {
    const d = new Date(Date.UTC(2025, 0, 5, 14, 30, 9));
    expect(formatDateByPattern(d, "yyyy-MM-dd")).toBe("2025-01-05");
    expect(formatDateByPattern(d, "yyyy-MM-dd HH:mm")).toBe("2025-01-05 14:30");
    expect(formatDateByPattern(d, "dd/MM/yyyy HH:mm:ss")).toBe(
      "05/01/2025 14:30:09",
    );
  });

  it("is case-insensitive and resolves mm as month vs minute by context", () => {
    const d = new Date(Date.UTC(2025, 0, 5, 14, 30));
    // lowercase mm in a date position is the month (was: read as minutes=30)
    expect(formatDateByPattern(d, "yyyy-mm-dd")).toBe("2025-01-05");
    // fully lowercase still parses
    expect(formatDateByPattern(d, "yyyy-mm-dd hh:mm")).toBe("2025-01-05 14:30");
    // uppercase MM right after HH is still minutes (context wins over case) --
    // d=14:30, so HH:MM -> hour:minute = "14:30", NOT month(01).
    expect(formatDateByPattern(d, "HH:MM")).toBe("14:30");
    // mm without a preceding hour is the month
    expect(formatDateByPattern(d, "mm/dd")).toBe("01/05");
  });

  it("parses date-coercible strings (ISO date-only = UTC midnight)", () => {
    expect(formatDateByPattern("2025-01-05", "yyyy-MM-dd")).toBe("2025-01-05");
  });

  it("returns the raw stringified value for non-date input", () => {
    expect(formatDateByPattern("not-a-date", "yyyy-MM-dd")).toBe("not-a-date");
  });

  it("uses UTC components, agreeing with the workbook path's serial", () => {
    // Regression guard for the cross-path date bug: formatDateByPattern used
    // local components while dateToSerial uses UTC ones, so the same input
    // could render a different day above/below the 50k-row stream threshold
    // (e.g. local midnight in UTC+8 -> previous day on the workbook path).
    // A local-midnight date maximizes the local-vs-UTC divergence.
    const localMidnight = new Date(2025, 0, 5, 0, 0, 0);
    const serial = applyFormat(localMidnight, { type: "date" }) as number;
    const fromSerial = serialToDate(serial); // UTC-components Date
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${fromSerial.getUTCFullYear()}-${pad(
      fromSerial.getUTCMonth() + 1,
    )}-${pad(fromSerial.getUTCDate())}`;
    expect(formatDateByPattern(localMidnight, "yyyy-MM-dd")).toBe(expected);
    // And an ISO string renders as its own calendar day on both paths.
    expect(formatDateByPattern("2025-01-05", "yyyy-MM-dd")).toBe(
      formatDateByPattern(new Date("2025-01-05T00:00:00Z"), "yyyy-MM-dd"),
    );
  });
});

describe("displayValue (stream/SheetJS number-decimals baking)", () => {
  it("bakes decimals into the displayed value when a number spec is set", () => {
    const col = {
      key: "n",
      header: "N",
      format: { type: "number" as const, decimals: 2 },
    };
    // stream/SheetJS have no numFormat -> decimals applied here (1234.567 -> 1234.57)
    expect(displayValue(col, { n: 1234.567 })).toBe(1234.57);
    // decimals default 0 -> integer display (1234.567 -> 1235)
    expect(
      displayValue(
        { key: "n", header: "N", format: { type: "number" as const } },
        { n: 1234.567 },
      ),
    ).toBe(1235);
    // no number spec -> raw value untouched
    expect(displayValue({ key: "n", header: "N" }, { n: 1234.567 })).toBe(
      1234.567,
    );
    // non-finite -> stringified, never NaN
    expect(
      displayValue(
        { key: "n", header: "N", format: { type: "number" as const } },
        { n: "abc" },
      ),
    ).toBe("abc");
  });
});

describe("validateSheetName", () => {
  it("accepts valid names", () => {
    expect(() => validateSheetName("Sheet1")).not.toThrow();
    expect(() => validateSheetName("a".repeat(31))).not.toThrow();
  });

  it("rejects empty / non-string names", () => {
    expect(() => validateSheetName("")).toThrow(/non-empty/);
    expect(() => validateSheetName(undefined as unknown as string)).toThrow(
      /non-empty/,
    );
  });

  it("rejects names longer than 31 chars", () => {
    expect(() => validateSheetName("a".repeat(32))).toThrow(/31-char/);
  });

  it("rejects forbidden characters", () => {
    for (const bad of ["a/b", "a:b", "a?b", "a*b", "a[b]", "a\\b"]) {
      expect(() => validateSheetName(bad)).toThrow(/forbidden/);
    }
  });
});
