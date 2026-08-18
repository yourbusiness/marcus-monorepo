# 样式

列级 `style`（`CellStyle`）应用于该列的所有**数据单元格**（表头保持默认样式）。内置 7 种预设，也支持完全自定义。

## 内置预设 StylePresets

| 预设                    | 视觉效果                                                                                                          | 说明                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `StylePresets.header`   | <span style="display:inline-block;width:12px;height:12px;background:#1F4E79;border-radius:2px"></span> 深蓝底白字 | 加粗、12 号字、深蓝底 `1F4E79`、白字、居中 |
| `StylePresets.currency` | `#,##0.00`                                                                                                        | 千分位 + 两位小数，右对齐                  |
| `StylePresets.percent`  | `0.00%`                                                                                                           | 百分比格式，右对齐                         |
| `StylePresets.date`     | `yyyy-MM-dd`                                                                                                      | 日期格式，居中                             |
| `StylePresets.datetime` | `yyyy-MM-dd HH:mm`                                                                                                | 日期时间格式，居中                         |
| `StylePresets.dataRow`  | 左对齐 + 底部细线                                                                                                 | 左对齐、垂直居中，底部浅灰细线 `D0D0D0`    |
| `StylePresets.danger`   | <span style="display:inline-block;width:12px;height:12px;background:#C00000;border-radius:2px"></span> 红色加粗   | 红色加粗文字 `C00000`，居中                |

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

await exportExcel({
  filename: "styled",
  sheets: [
    {
      name: "Sheet1",
      columns: [
        { key: "name", header: "名称", width: 16, style: StylePresets.dataRow },
        {
          key: "amount",
          header: "金额",
          width: 14,
          style: StylePresets.currency,
        },
        { key: "date", header: "日期", width: 12, style: StylePresets.date },
        {
          key: "status",
          header: "状态",
          width: 10,
          style: StylePresets.danger,
        },
      ],
      data: [
        {
          name: "机械键盘",
          amount: 1299.99,
          date: "2026-07-01",
          status: "缺货",
        },
      ],
    },
  ],
});
```

## 自定义 CellStyle

```ts
import type { CellStyle } from "@marcusok/excel-exporter";

const highlight: CellStyle = {
  font: { bold: true, size: 11, color: "1F4E79" }, // 6 位 RGB hex
  fill: { pattern: "solid", fgColor: "DDEBF7" },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: {
    bottom: { style: "medium", color: "1F4E79" },
    right: { style: "thin", color: "D0D0D0" },
  },
  numFormat: "#,##0.00",
};
```

字段约定：

| 字段        | 说明                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `font`      | `bold` / `italic` / `size` / `color`（6 位 hex，如 `"FF0000"`）/ `name`                                 |
| `fill`      | `pattern: "solid" \| "none"`、`fgColor`、`bgColor`（6 位 hex）                                          |
| `alignment` | `horizontal`（left/center/right）、`vertical`（top/center/bottom）、`wrapText`、`textRotation`（0–180） |
| `border`    | 四边 `{ style, color }`，`style` 取值见 modern-xlsx 的 `BorderStyle`                                    |
| `numFormat` | Excel 数字格式码，如 `"#,##0.00"`、`"yyyy-mm-dd"`、`"0.00%"`                                            |

> 颜色统一使用 6 位 RGB hex（不带 `#`），与 modern-xlsx 的类型约定一致。

## 与 FormatSpec 的关系

`style.numFormat` 与列级 `format`（FormatSpec）是两套机制：`style` 控制单元格外观，`format` 负责把业务值转换/格式化为可写入的值。对 `date` / `number` 等 FormatSpec，Workbook 路径会自动注入对应的 `numFormat`，通常不需要手动设置。详见 [值格式化](/packages/excel-exporter/guide/04-formatting)。
