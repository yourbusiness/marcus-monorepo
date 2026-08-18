# API：核心类型

## SheetConfig

| 字段           | 类型                        | 必填 | 说明                                            |
| -------------- | --------------------------- | ---- | ----------------------------------------------- |
| `name`         | `string`                    | 是   | 工作表名：非空、≤ 31 字符，不含 `: \ / ? * [ ]` |
| `columns`      | `ColumnConfig[]`            | 是   | 列定义                                          |
| `data`         | `Record<string, unknown>[]` | 是   | 行数据                                          |
| `headerStyle?` | `CellStyle`                 | —    | 表头行默认样式，可被列级 `headerStyle` 覆盖     |
| `freezeRows?`  | `number`                    | —    | 冻结前 N 行表头                                 |
| `merges?`      | `MergeRange[]`              | —    | 合并单元格（相对数据区定位）                    |
| `autoFilter?`  | `boolean`                   | —    | 表头自动筛选                                    |

## ColumnConfig

| 字段           | 类型                     | 必填 | 说明                                                                             |
| -------------- | ------------------------ | ---- | -------------------------------------------------------------------------------- |
| `key`          | `string`                 | 是   | 数据行字段名                                                                     |
| `header`       | `string`                 | 是   | 表头文字                                                                         |
| `width?`       | `number`                 | —    | 列宽（Excel 字符单位）                                                           |
| `style?`       | `CellStyle`              | —    | 数据单元格样式（不含表头）                                                       |
| `headerStyle?` | `CellStyle`              | —    | 当前列表头样式，优先于表级 `headerStyle`                                         |
| `format?`      | `FormatSpec \| Function` | —    | 值格式化；函数在主线程路径执行，浏览器 worker 路径会被剥离（详见 FormatSpec 页） |

## MergeRange

| 字段      | 类型     | 说明                       |
| --------- | -------- | -------------------------- |
| `row`     | `number` | 起始行（0 = 第一条数据行） |
| `col`     | `number` | 起始列                     |
| `rowspan` | `number` | 行跨度                     |
| `colspan` | `number` | 列跨度                     |

## CellStyle

| 字段         | 类型                                                   | 说明                                 |
| ------------ | ------------------------------------------------------ | ------------------------------------ |
| `font?`      | `{ bold?, italic?, size?, color?, name? }`             | 颜色为 6 位 RGB hex（如 `"FF0000"`） |
| `fill?`      | `{ pattern?: "solid" \| "none", fgColor?, bgColor? }`  | 填充                                 |
| `alignment?` | `{ horizontal?, vertical?, wrapText?, textRotation? }` | 对齐（textRotation 0–180）           |
| `border?`    | `{ top?, bottom?, left?, right? }`                     | 边框，每边 `{ style, color? }`       |
| `numFormat?` | `string`                                               | Excel 数字格式码                     |

## ExportMode / ExportPhase

```ts
type ExportMode = "auto" | "main" | "worker" | "stream";
type ExportPhase = "init" | "build" | "download";
```

## 完整导入

```ts
import type {
  SheetConfig,
  ColumnConfig,
  CellStyle,
  MergeRange,
  FormatSpec,
  ExportOptions,
  ExportResult,
  ExportMode,
  ExportPhase,
  BorderStyle,
} from "@marcusok/excel-exporter";
```
