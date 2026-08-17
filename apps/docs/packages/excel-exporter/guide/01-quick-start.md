# 快速上手

一个 `exportExcel` 调用即可完成导出。核心概念只有三个：`sheets`（工作簿）、`columns`（列定义）、`data`（行数据）。

## 最小示例

```ts
import { exportExcel } from "@marcusok/excel-exporter";

await exportExcel({
  filename: "hello",
  sheets: [
    {
      name: "Sheet1",
      columns: [
        { key: "name", header: "名称", width: 16 },
        { key: "count", header: "数量", width: 10 },
      ],
      data: [
        { name: "机械键盘", count: 12 },
        { name: "无线鼠标", count: 8 },
      ],
    },
  ],
});
```

浏览器中运行会自动下载 `hello.xlsx`；`filename` 不以 `.xlsx` 结尾时，末尾自动追加 `.xlsx`。

## 带上样式与格式化

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

await exportExcel({
  filename: "销售明细-2026",
  sheets: [
    {
      name: "销售明细",
      freezeRows: 1,
      autoFilter: true,
      columns: [
        { key: "orderId", header: "订单号", width: 18 },
        {
          key: "date",
          header: "日期",
          width: 12,
          format: { type: "date" },
        },
        {
          key: "amount",
          header: "金额",
          width: 14,
          style: StylePresets.currency,
        },
        {
          key: "status",
          header: "状态",
          width: 10,
          format: {
            type: "enum",
            map: { paid: "已支付", pending: "待支付", refunded: "已退款" },
            fallback: "未知",
          },
        },
      ],
      data: [
        {
          orderId: "ORD-000001",
          date: "2026-07-01",
          amount: 1299.99,
          status: "paid",
        },
        {
          orderId: "ORD-000002",
          date: "2026-07-02",
          amount: 399,
          status: "pending",
        },
      ],
    },
  ],
});
```

要点：

- `freezeRows: 1` 冻结表头；
- `autoFilter: true` 为表头添加筛选；
- `style` 作用于**数据单元格**（表头保持默认样式，与类型约定一致）；
- `format` 是结构化、可跨线程的 `FormatSpec`，日期会转换为 Excel 日期序列并自动注入 `numFormat`，枚举值映射为中文文案。

## 不自动下载，只拿 Blob

```ts
const result = await exportExcel({
  filename: "report",
  sheets: [{ name: "Sheet1", columns: [...], data: [...] }],
  download: false,
});

if (result.success && result.blob) {
  // 上传到 OSS / 发送给接口 / 自定义下载逻辑
  const form = new FormData();
  form.append("file", result.blob, "report.xlsx");
  await fetch("/api/upload", { method: "POST", body: form });
}
```

`ExportResult` 同时返回实际使用的 `engine`、`mode`、`duration` 与 `rowCount`，可据此展示性能指标或做埋点。
