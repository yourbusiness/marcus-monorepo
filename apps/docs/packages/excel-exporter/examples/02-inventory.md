# 案例：库存台账导出

库存台账需要把低库存/缺货商品高亮出来。本案例演示自定义 `CellStyle` 与函数式 format（main 路径）的配合。

## Mock 数据预览

<MockPreview dataset="inventory" :rows="5" />

## 实现代码

```ts
import { exportExcel } from "@marcusok/excel-exporter";
import type { CellStyle } from "@marcusok/excel-exporter";

const lowStock: CellStyle = {
  font: { color: "C00000", bold: true },
  fill: { pattern: "solid", fgColor: "FDE2E2" },
};

const result = await exportExcel({
  filename: "库存台账-2026-07",
  sheets: [
    {
      name: "库存台账",
      freezeRows: 1,
      autoFilter: true,
      columns: [
        { key: "sku", header: "SKU", width: 16 },
        { key: "name", header: "商品名称", width: 20 },
        { key: "category", header: "类目", width: 10 },
        { key: "warehouse", header: "仓库", width: 12 },
        {
          key: "stock",
          header: "库存",
          width: 10,
          format: { type: "number", thousands: true },
          // 函数式 format：低库存标红（仅 main 路径，数据量 < 20,000 行）
          style: lowStock,
        },
        { key: "safetyStock", header: "安全库存", width: 12 },
        { key: "unit", header: "单位", width: 8 },
        {
          key: "updatedAt",
          header: "更新时间",
          width: 12,
          format: { type: "date" },
        },
        {
          key: "status",
          header: "状态",
          width: 10,
          format: {
            type: "enum",
            map: { "in-stock": "正常", low: "低库存", out: "缺货" },
            fallback: "未知",
          },
        },
      ],
      data: rows,
      merges: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }], // 示例：首行跨两列
    },
  ],
});
```

## 要点

- `lowStock` 自定义样式：红色加粗 + 浅红填充，一眼识别风险项；
- 列级 `style` 作用于整列数据单元格，适合状态类列；
- 合并单元格 `merges` 相对数据区定位，适合把同组首行跨列展示；
- 数据量小（< 20,000 行）时保持默认 `auto` 即可走带完整样式的 main 路径。
