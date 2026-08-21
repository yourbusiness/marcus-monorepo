import { describe, it, expect } from "vitest";
import { WorkbookBuilder } from "../workbook-builder";
import { StylePresets } from "../style-presets";
import { readBuffer, makeData } from "./setup";

describe("WorkbookBuilder round-trip", () => {
  it("writes data, headers, styles, freeze, autofilter and merges", async () => {
    const data = makeData(5);
    const builder = await WorkbookBuilder.create();
    builder.addSheet({
      name: "Sales",
      freezeRows: 1,
      autoFilter: true,
      merges: [{ row: 0, col: 0, rowspan: 2, colspan: 1 }],
      columns: [
        { key: "id", header: "ID", width: 10 },
        { key: "name", header: "Name", width: 18, style: StylePresets.dataRow },
        {
          key: "amount",
          header: "Amount",
          width: 14,
          style: StylePresets.currency,
        },
        {
          key: "status",
          header: "Status",
          width: 10,
          format: {
            type: "enum",
            map: { paid: "Paid", pending: "Pending" },
            fallback: "Unknown",
          },
        },
      ],
      data,
    });
    const bytes = await builder.toBuffer();

    // Valid XLSX (ZIP local file header magic)
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));

    const wb = await readBuffer(bytes);
    const ws = wb.getSheet("Sales")!;
    expect(ws).toBeDefined();

    // Header row present, freeze applied
    expect(ws.cell("A1").value).toBe("ID");
    expect(ws.frozenPane).toEqual({ rows: 1, cols: 0 });

    // Auto-filter covers header..last data row (5 data rows -> A1:D6)
    // autoFilter reads back as AutoFilterData { range: 'A1:D6' }
    expect((ws.autoFilter as { range: string }).range).toBe("A1:D6");

    // Data row 1 values
    expect(String(ws.cell("A2").value)).toBe("0");
    expect(ws.cell("B2").value).toBe("user_0");
    // enum format: paid -> Paid
    expect(ws.cell("D2").value).toBe("Paid");
    expect(ws.cell("D3").value).toBe("Pending");

    // Column style applied: B (dataRow) and C (currency) have non-null styleIndex
    expect(ws.cell("B2").styleIndex).not.toBeNull();
    expect(ws.cell("C2").styleIndex).not.toBeNull();
    // A has no style config -> default (null or 0)
    expect(ws.cell("A2").styleIndex).toBeNull();

    // Style applies to DATA cells only, never the header row (regression guard
    // for the bug where the header cell inherited the column data style).
    expect(ws.cell("B1").styleIndex).toBeNull();
    expect(ws.cell("C1").styleIndex).toBeNull();

    // Merge: A2:A3 (row 0 data-area, rowspan 2 -> rows 2-3 in Excel)
    expect(ws.mergeCells.some((r) => r === "A2:A3")).toBe(true);
  });

  it("writes a multi-row grouped header with header merges and data offset", async () => {
    const builder = await WorkbookBuilder.create();
    builder.addSheet({
      name: "Grouped",
      freezeRows: 2,
      autoFilter: true,
      columns: [
        { key: "product", header: "产品" },
        {
          header: "收入情况",
          children: [
            {
              header: "本月",
              children: [
                { key: "m_qty", header: "数量" },
                { key: "m_amt", header: "金额" },
              ],
            },
            {
              header: "本年累计",
              children: [
                { key: "y_qty", header: "数量" },
                { key: "y_amt", header: "金额" },
              ],
            },
          ],
        },
      ],
      data: [
        { product: "A", m_qty: 1, m_amt: 2, y_qty: 3, y_amt: 4 },
        { product: "B", m_qty: 5, m_amt: 6, y_qty: 7, y_amt: 8 },
      ],
    });
    const bytes = await builder.toBuffer();
    const wb = await readBuffer(bytes);
    const ws = wb.getSheet("Grouped")!;

    // 3 header rows + 2 data rows.
    expect(ws.rowCount).toBe(5);

    // Header values at their merge anchors (top-left of each merged block).
    expect(ws.cell("A1").value).toBe("产品");
    expect(ws.cell("B1").value).toBe("收入情况");
    expect(ws.cell("B2").value).toBe("本月");
    expect(ws.cell("D2").value).toBe("本年累计");
    expect(ws.cell("B3").value).toBe("数量");
    expect(ws.cell("E3").value).toBe("金额");

    // Header merges (leaf spans all header rows, groups span their leaves).
    for (const r of ["A1:A3", "B1:E1", "B2:C2", "D2:E2"]) {
      expect(ws.mergeCells).toContain(r);
    }

    // Data rows start at row 4.
    expect(ws.cell("A4").value).toBe("A");
    expect(ws.cell("E5").value).toBe(8);

    // Auto-filter now anchors on the last header row: A3:E5.
    expect((ws.autoFilter as { range: string }).range).toBe("A3:E5");
  });

  it("applies header styles to merged group/leaf anchors in a grouped header", async () => {
    const builder = await WorkbookBuilder.create();
    builder.addSheet({
      name: "GroupedStyle",
      headerStyle: StylePresets.header,
      columns: [
        {
          key: "a",
          header: "A",
          headerStyle: StylePresets.danger,
        },
        {
          header: "G",
          headerStyle: StylePresets.currency, // group-level style
          children: [
            { key: "b", header: "B" },
            { key: "c", header: "C" },
          ],
        },
      ],
      data: [{ a: 1, b: 2, c: 3 }],
    });
    const bytes = await builder.toBuffer();
    const wb = await readBuffer(bytes);
    const ws = wb.getSheet("GroupedStyle")!;

    // Leaf header overrides sheet-level; group header uses its own style; the
    // child leaf B inherits the sheet-level header style.
    expect(ws.cell("A1").styleIndex).not.toBeNull();
    expect(ws.cell("B1").styleIndex).not.toBeNull();
    expect(ws.cell("B2").styleIndex).not.toBeNull();
    // Data cells never take header styles.
    expect(ws.cell("A3").styleIndex).toBeNull();
  });

  it("handles multiple sheets", async () => {
    const builder = await WorkbookBuilder.create();
    builder
      .addSheet({
        name: "S1",
        columns: [{ key: "a", header: "A" }],
        data: [{ a: 1 }],
      })
      .addSheet({
        name: "S2",
        columns: [{ key: "b", header: "B" }],
        data: [{ b: 2 }],
      });
    const bytes = await builder.toBuffer();
    const wb = await readBuffer(bytes);
    expect(wb.sheetNames).toEqual(["S1", "S2"]);
    expect(String(wb.getSheet("S1")!.cell("A2").value)).toBe("1");
    expect(String(wb.getSheet("S2")!.cell("A2").value)).toBe("2");
  });

  it("toBlob returns a Blob with xlsx mime type", async () => {
    const builder = await WorkbookBuilder.create();
    builder.addSheet({
      name: "S",
      columns: [{ key: "x", header: "X" }],
      data: [{ x: "hi" }],
    });
    const blob = await builder.toBlob();
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(blob.size).toBeGreaterThan(0);
  });

  it("keeps date/number FormatSpec values typed and auto-injects a numFormat", async () => {
    const builder = await WorkbookBuilder.create();
    builder.addSheet({
      name: "Typed",
      columns: [
        {
          key: "d",
          header: "Date",
          format: { type: "date", pattern: "yyyy/MM/dd" },
        },
        {
          key: "n",
          header: "Num",
          format: { type: "number", decimals: 2, thousands: true },
        },
        { key: "plain", header: "Plain" },
      ],
      // 1234.567: full precision must round-trip (was truncated to 1234.57 by
      // toFixed before the fix; decimals=2 now only affects display via numFormat).
      data: [{ d: new Date(2025, 0, 5), n: 1234.567, plain: "x" }],
    });
    const bytes = await builder.toBuffer();
    const wb = await readBuffer(bytes);
    const ws = wb.getSheet("Typed")!;

    // Date is an Excel serial (number), not text -- and a style was auto-injected
    // so the cell renders as a date instead of a bare serial number.
    expect(typeof ws.cell("A2").value).toBe("number");
    expect(ws.cell("A2").styleIndex).not.toBeNull();
    // Number is a numeric cell, not text.
    expect(typeof ws.cell("B2").value).toBe("number");
    expect(ws.cell("B2").styleIndex).not.toBeNull();
    // Full precision is preserved in the stored cell (regression guard for the
    // toFixed truncation bug): value is 1234.567, not the display-rounded 1234.57.
    expect(ws.cell("B2").value).toBe(1234.567);
    // Plain column (no format, no style) stays unstyled.
    expect(ws.cell("C2").styleIndex).toBeNull();
  });
});
