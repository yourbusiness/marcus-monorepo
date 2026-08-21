import { describe, it, expect } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { exportAsStream } from "../streaming-builder";
import { readBuffer } from "./setup";

describe("exportAsStream round-trip", () => {
  it("produces a valid xlsx with correct row count and values", async () => {
    const sheets = [
      {
        name: "Data",
        columns: [
          { key: "id", header: "ID" },
          { key: "name", header: "Name" },
          { key: "amount", header: "Amount" },
          { key: "status", header: "Status" },
        ],
        data: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `row_${i}`,
          amount: i * 1.5,
          status: i % 2 === 0 ? "paid" : "pending",
        })),
      },
    ];
    const { bytes, rowCount } = await exportAsStream(sheets);

    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(rowCount).toBe(1000);

    const wb = await readBuffer(bytes);
    const ws = wb.getSheet("Data")!;
    // header + 1000 data rows
    expect(ws.rowCount).toBe(1001);
    expect(ws.cell("A1").value).toBe("ID");
    expect(ws.cell("D1").value).toBe("Status");
    expect(String(ws.cell("A2").value)).toBe("0");
    expect(String(ws.cell("C1001").value)).toBe(String(999 * 1.5));
  });

  it("handles multi-sheet streaming", async () => {
    const { bytes, rowCount } = await exportAsStream([
      {
        name: "A",
        columns: [{ key: "x", header: "X" }],
        data: [{ x: 1 }, { x: 2 }],
      },
      { name: "B", columns: [{ key: "y", header: "Y" }], data: [{ y: 3 }] },
    ]);
    expect(rowCount).toBe(3);
    const wb = await readBuffer(bytes);
    expect(wb.sheetNames).toEqual(["A", "B"]);
    expect(wb.getSheet("A")!.rowCount).toBe(3);
    expect(wb.getSheet("B")!.rowCount).toBe(2);
  });

  it("formats date/datetime columns by pattern into readable strings", async () => {
    const { bytes } = await exportAsStream([
      {
        name: "Dates",
        columns: [
          {
            key: "d",
            header: "Date",
            format: { type: "date", pattern: "dd/MM/yyyy" },
          },
          { key: "dt", header: "DateTime", format: { type: "datetime" } },
        ],
        // UTC-constructed so the expected strings hold in every timezone
        // (stream formats UTC components, matching the workbook serial).
        data: [
          {
            d: new Date(Date.UTC(2025, 0, 5, 14, 30)),
            dt: new Date(Date.UTC(2025, 0, 5, 14, 30)),
          },
        ],
      },
    ]);
    const wb = await readBuffer(bytes);
    const ws = wb.getSheet("Dates")!;
    // pattern honored; default datetime pattern applied
    expect(ws.cell("A2").value).toBe("05/01/2025");
    expect(ws.cell("B2").value).toBe("2025-01-05 14:30");
  });

  it("writes a spec-correct sharedStrings table (count = total refs, uniqueCount = uniques)", async () => {
    const { bytes } = await exportAsStream([
      {
        name: "SST",
        columns: [
          { key: "a", header: "A" },
          { key: "b", header: "B" },
        ],
        data: [
          { a: "dup", b: "x" },
          { a: "dup", b: "x" },
          { a: "uniq", b: "y" },
        ],
      },
    ]);
    // Unzip and inspect the sst directly: per ECMA-376, count is the total
    // number of string-cell references (duplicates included) and uniqueCount
    // the number of distinct strings. 2 header cells + 6 data cells = 8 refs;
    // distinct strings: A, B, dup, uniq, x, y = 6.
    const files = unzipSync(bytes);
    const sst = strFromU8(files["xl/sharedStrings.xml"]);
    expect(sst).toContain('count="8"');
    expect(sst).toContain('uniqueCount="6"');
  });
});
