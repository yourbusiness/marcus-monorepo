# 案例：10 万行大文件导出

大数据量导出是 excel-exporter 的核心优势场景：10 万行保持恒定内存，浏览器端在 Worker 中执行，主线程不卡顿。

## Mock 数据预览

<MockPreview dataset="sales" :rows="3" />

## 实现代码

```ts
import { exportExcel } from "@marcusok/excel-exporter";

const rows = salesMockRows(100_000);

const result = await exportExcel({
  filename: "大文件导出-10w",
  sheets: [
    {
      name: "销售明细",
      columns: [
        { key: "orderId", header: "订单号", width: 18 },
        { key: "date", header: "日期", width: 12 },
        { key: "amount", header: "金额", width: 14 },
        { key: "status", header: "状态", width: 10 },
      ],
      data: rows,
    },
  ],
  mode: "auto", // ≥ 5 万行自动走 worker + stream
  onProgress: (p) => setProgress(p),
});

console.log(result); // engine: "modern-xlsx", mode: "worker", rowCount: 100000
```

## 要点

- 10 万行下 `auto` 选择 `worker + Stream`，实测约 1.5s（Workbook 路径同数据量 17.5s）；
- stream 路径 v1 **不支持样式/列宽/冻结/筛选/合并**，会打印 console 警告，属预期行为；
- `onProgress` 每 1000 行上报一次，适合展示进度；
- 数字列建议显式声明 `decimals`，保证存储值与 Workbook 路径一致。

到 [在线演示](/playground) 选择 100,000 行，切换 `auto` 与 `main` 对比体验差异。
