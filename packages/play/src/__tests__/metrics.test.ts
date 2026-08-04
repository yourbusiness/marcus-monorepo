import { describe, expect, it } from "vitest";
import {
  formatByteRate,
  formatBytes,
  formatClockTime,
  formatDuration,
  formatThroughput,
} from "../demos/excel-exporter/metrics";

describe("metrics formatting helpers", () => {
  it("formatBytes uses 1024 units and handles invalid input", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(1_048_576)).toBe("1.00 MB");
    expect(formatBytes(null)).toBe("-");
    expect(formatBytes(-1)).toBe("-");
  });

  it("formatDuration switches from ms to s at 1000ms", () => {
    expect(formatDuration(0.5)).toBe("<1ms");
    expect(formatDuration(860)).toBe("860ms");
    expect(formatDuration(1234)).toBe("1.23s");
    expect(formatDuration(undefined)).toBe("-");
  });

  it("formatThroughput / formatByteRate compute per-second rates", () => {
    expect(formatThroughput(10_000, 500)).toBe("20,000 行/s");
    expect(formatByteRate(1_048_576, 1000)).toBe("1.00 MB/s");
    expect(formatThroughput(10_000, 0)).toBe("-");
    expect(formatByteRate(null, 1000)).toBe("-");
  });

  it("formatClockTime zero-pads parts", () => {
    expect(formatClockTime(new Date(2026, 0, 1, 8, 5, 9))).toBe("08:05:09");
  });
});
