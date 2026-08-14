import { describe, it, expect } from "vitest";
import {
  exportEcharts,
  exportTable,
  echartsToSheet,
  tableToSheet,
  WorkbookBuilder,
  StylePresets,
} from "../index";
import { readBuffer } from "./setup";

describe("tableToSheet / exportTable", () => {
  it("normalizes Ant Design and Element Plus column naming styles", () => {
    const sheet = tableToSheet({
      sheetName: "Orders",
      columns: [
        { dataIndex: "orderNo", title: "订单号", width: 16 },
        { prop: "customer", label: "客户" },
      ],
      data: [
        { orderNo: "A1", customer: "Alice" },
        { orderNo: "A2", customer: "Bob" },
      ],
    });

    expect(sheet.name).toBe("Orders");
    expect(sheet.columns[0]).toMatchObject({
      key: "orderNo",
      header: "订单号",
    });
    expect(sheet.columns[1]).toMatchObject({ key: "customer", header: "客户" });
  });

  it("exports a real xlsx from a common table data shape", async () => {
    const result = await exportTable({
      filename: "table-adapter",
      download: false,
      mode: "main",
      sheetName: "表格",
      columns: [
        { dataIndex: "orderNo", title: "订单号" },
        { dataIndex: "customer", title: "客户" },
        {
          dataIndex: "amount",
          title: "金额",
          format: { type: "number", decimals: 2 },
        },
      ],
      data: [
        { orderNo: "A1", customer: "Alice", amount: 1234.5 },
        { orderNo: "A2", customer: "Bob", amount: 88 },
      ],
    });

    expect(result.success).toBe(true);
    const wb = await readBuffer(
      new Uint8Array(await result.blob!.arrayBuffer()),
    );
    const ws = wb.getSheet("表格")!;
    expect(ws.cell("A1").value).toBe("订单号");
    expect(ws.cell("C3").value).toBe(88);
  });
});

describe("echartsToSheet / exportEcharts", () => {
  it("exports category + multiple series as a wide table", () => {
    const sheet = echartsToSheet({
      option: {
        xAxis: { type: "category", data: ["一月", "二月", "三月"] },
        series: [
          { name: "销售额", type: "line", data: [120, 200, 150] },
          { name: "利润", type: "line", data: [30, 60, 45] },
        ],
      },
    });

    expect(sheet.columns.map((c) => c.header)).toEqual([
      "类目",
      "销售额",
      "利润",
    ]);
    expect(sheet.data[1]).toEqual({
      类目: "二月",
      __series_0: 200,
      __series_1: 60,
    });
  });

  it("exports category + multiple series as a long table", () => {
    const sheet = echartsToSheet({
      layout: "long",
      option: {
        xAxis: { data: ["A", "B"] },
        series: [{ name: "S1", data: [1, 2] }],
      },
    });

    expect(sheet.columns.map((c) => c.header)).toEqual([
      "系列",
      "类目",
      "数值",
    ]);
    expect(sheet.data).toHaveLength(2);
    expect(sheet.data[1]).toEqual({ 系列: "S1", 类目: "B", 数值: 2 });
  });

  it("exports pie-like name/value data", () => {
    const sheet = echartsToSheet({
      option: {
        series: [
          {
            name: "占比",
            type: "pie",
            data: [
              { name: "A", value: 10 },
              { name: "B", value: 20 },
            ],
          },
        ],
      },
    });

    expect(sheet.columns.map((c) => c.header)).toEqual([
      "系列",
      "名称",
      "数值",
    ]);
    expect(sheet.data).toEqual([
      { 系列: "占比", 名称: "A", 数值: 10 },
      { 系列: "占比", 名称: "B", 数值: 20 },
    ]);
  });

  it("exports scatter-like coordinate pairs", () => {
    const sheet = echartsToSheet({
      option: {
        series: [
          {
            name: "点",
            type: "scatter",
            data: [
              [1, 2],
              [3, 4],
            ],
          },
        ],
      },
    });

    expect(sheet.columns.map((c) => c.header)).toEqual(["系列", "X", "Y"]);
    expect(sheet.data).toEqual([
      { 系列: "点", X: 1, Y: 2 },
      { 系列: "点", X: 3, Y: 4 },
    ]);
  });

  it("rejects dataset mode instead of guessing", () => {
    expect(() =>
      echartsToSheet({
        option: {
          dataset: { source: [] },
          series: [],
        },
      }),
    ).toThrow(/dataset mode is not supported/);
  });

  it("exports a real xlsx from a simple ECharts option", async () => {
    const result = await exportEcharts({
      filename: "echarts-adapter",
      download: false,
      mode: "main",
      option: {
        xAxis: { data: ["一月", "二月"] },
        series: [{ name: "销售额", data: [120, 200] }],
      },
    });

    expect(result.success).toBe(true);
    const wb = await readBuffer(
      new Uint8Array(await result.blob!.arrayBuffer()),
    );
    const ws = wb.getSheet("图表数据")!;
    expect(ws.cell("A1").value).toBe("类目");
    expect(ws.cell("B3").value).toBe(200);
  });
});

describe("headerStyle", () => {
  it("applies sheet-level and column-level header styles without styling data cells", async () => {
    const builder = await WorkbookBuilder.create();
    builder.addSheet({
      name: "StyledHeader",
      headerStyle: StylePresets.header,
      columns: [
        { key: "a", header: "A", style: StylePresets.dataRow },
        {
          key: "b",
          header: "B",
          headerStyle: StylePresets.danger,
          style: StylePresets.dataRow,
        },
      ],
      data: [
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ],
    });

    const bytes = await builder.toBuffer();
    const wb = await readBuffer(bytes);
    const ws = wb.getSheet("StyledHeader")!;

    expect(ws.cell("A1").styleIndex).not.toBeNull();
    expect(ws.cell("B1").styleIndex).not.toBeNull();
    expect(ws.cell("A2").styleIndex).not.toBeNull();
    expect(ws.cell("B2").styleIndex).not.toBeNull();
  });
});
