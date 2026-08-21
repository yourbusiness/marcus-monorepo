# API: Core Types

## SheetConfig

| Field          | Type                        | Required | Description                                                    |
| -------------- | --------------------------- | -------- | -------------------------------------------------------------- |
| `name`         | `string`                    | yes      | Non-empty, ≤ 31 chars, no `: \ / ? * [ ]`                      |
| `columns`      | `ColumnConfig[]`            | yes      | Column definitions                                             |
| `data`         | `Record<string, unknown>[]` | yes      | Row data                                                       |
| `headerStyle?` | `CellStyle`                 | —        | Default header style; overridden by column-level `headerStyle` |
| `freezeRows?`  | `number`                    | —        | Freeze the first N header rows                                 |
| `merges?`      | `MergeRange[]`              | —        | Merged cells (relative to the data area)                       |
| `autoFilter?`  | `boolean`                   | —        | Header auto filter                                             |

## ColumnConfig

| Field          | Type                     | Required     | Description                                                                                                                                   |
| -------------- | ------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `key?`         | `string`                 | leaf columns | Field name on the data row; group columns (with `children`) may omit it                                                                       |
| `header`       | `string`                 | yes          | Header text (leaf and group columns alike)                                                                                                    |
| `children?`    | `ColumnConfig[]`         | —            | Group column: produces a multi-row header; its header cell merges across all descendant leaf columns. `children: []` is a leaf                |
| `width?`       | `number`                 | —            | Column width (Excel character units); leaf columns only                                                                                       |
| `style?`       | `CellStyle`              | —            | Data-cell style (headers excluded); leaf columns only                                                                                         |
| `headerStyle?` | `CellStyle`              | —            | Header style for this column (group header cells included); wins over sheet-level `headerStyle`                                               |
| `format?`      | `FormatSpec \| Function` | —            | Value formatting; leaf columns only; functions run on main-thread paths and are stripped on the browser worker path (see the FormatSpec page) |

A column with `children` is a group: no data cells, header rows only. Header row count = max tree depth; leaf headers span the remaining header rows vertically, group headers span their leaf subtree horizontally — merges are generated automatically (no manual `merges` needed for headers).

## MergeRange

| Field     | Type     | Description                    |
| --------- | -------- | ------------------------------ |
| `row`     | `number` | Start row (0 = first data row) |
| `col`     | `number` | Start column                   |
| `rowspan` | `number` | Row span                       |
| `colspan` | `number` | Column span                    |

## CellStyle

| Field        | Type                                                   | Description                                  |
| ------------ | ------------------------------------------------------ | -------------------------------------------- |
| `font?`      | `{ bold?, italic?, size?, color?, name? }`             | `color` is 6-digit RGB hex (e.g. `"FF0000"`) |
| `fill?`      | `{ pattern?: "solid" \| "none", fgColor?, bgColor? }`  | Fill                                         |
| `alignment?` | `{ horizontal?, vertical?, wrapText?, textRotation? }` | Alignment (textRotation 0–180)               |
| `border?`    | `{ top?, bottom?, left?, right? }`                     | Borders, each `{ style, color? }`            |
| `numFormat?` | `string`                                               | Excel number format code                     |

## ExportMode / ExportPhase

```ts
type ExportMode = "auto" | "main" | "worker" | "stream";
type ExportPhase = "init" | "build" | "download";
```

## Full import

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
