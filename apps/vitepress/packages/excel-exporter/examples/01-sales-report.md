# 案例：销售月报导出

月度销售报表是后台系统最高频的导出场景。本案例用 mock 生成 1 万行销售明细，演示：日期/金额/枚举格式化、货币样式、冻结表头、自动筛选与进度回调。

## Mock 数据预览

<MockPreview dataset="sales" :rows="5" />

## 实现代码

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

// 业务侧拿到 1 万行数据（此处由文档站 mock 生成器产生）
const rows = salesMockRows(10_000);

const result = await exportExcel({
  filename: "销售月报-2026-07",
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
        { key: "region", header: "区域", width: 10 },
        { key: "product", header: "商品", width: 18 },
        { key: "channel", header: "渠道", width: 10 },
        { key: "quantity", header: "数量", width: 8 },
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
      data: rows,
    },
  ],
  onProgress: (p) => setProgress(p), // 展示进度条
  onPhase: (phase, ms) => trackPhase(phase, ms), // 埋点
});
```

## 要点

- 1 万行在浏览器会走 `worker + Workbook`，主线程不卡顿，且样式完整保留；
- 金额列用 `StylePresets.currency`（千分位 + 两位小数，右对齐）；
- 状态列用 `enum` 把内部码映射为中文，兜底 `"未知"`；
- `freezeRows + autoFilter` 让管理层在 Excel 里直接筛选。

可以到 [在线演示](/playground) 选择 sales 数据集直接导出体验。
