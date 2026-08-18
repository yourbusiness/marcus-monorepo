# API：StylePresets 样式预设

## 预设一览

| 名称       | numFormat          | 其他样式                                   | 适用               |
| ---------- | ------------------ | ------------------------------------------ | ------------------ |
| `header`   | —                  | 加粗、12 号字、深蓝底 `1F4E79`、白字、居中 | 表头（手动应用时） |
| `currency` | `#,##0.00`         | 右对齐                                     | 金额               |
| `percent`  | `0.00%`            | 右对齐                                     | 占比、增长率       |
| `date`     | `yyyy-MM-dd`       | 居中                                       | 日期列             |
| `datetime` | `yyyy-MM-dd HH:mm` | 居中                                       | 日期时间列         |
| `dataRow`  | —                  | 左对齐、垂直居中、底部细线 `D0D0D0`        | 数据行             |
| `danger`   | —                  | 红色加粗 `C00000`、居中                    | 风险/异常值        |

## 用法

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

columns: [
  { key: "amount", header: "金额", width: 14, style: StylePresets.currency },
  { key: "rate", header: "增长率", width: 12, style: StylePresets.percent },
  { key: "date", header: "日期", width: 12, style: StylePresets.date },
  { key: "flag", header: "状态", width: 10, style: StylePresets.danger },
];
```

## 类型

```ts
import type { StylePresetName } from "@marcusok/excel-exporter";

const name: StylePresetName = "currency"; // "header" | "currency" | "percent" | "date" | "datetime" | "dataRow" | "danger"
```

> 注意：`style` 应用于数据单元格，不作用于表头。需要表头样式时，可直接用 `headerStyle` 字段（工作表级 `SheetConfig.headerStyle` 设默认，列级 `ColumnConfig.headerStyle` 覆盖），例如 `headerStyle: StylePresets.header`。
