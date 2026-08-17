# API: Core Types

## SheetConfig

| Field          | Type                        | Required | Description                                                    |
| -------------- | --------------------------- | -------- | -------------------------------------------------------------- |
| `name`         | `string`                    | ✅       | ≤ 31 chars, no `: \ / ? * [ ]`                                 |
| `columns`      | `ColumnConfig[]`            | ✅       | Column definitions                                             |
| `data`         | `Record<string, unknown>[]` | ✅       | Row data                                                       |
| `headerStyle?` | `CellStyle`                 | —        | Default header style; overridden by column-level `headerStyle` |
| `freezeRows?`  | `number`                    | —        | Freeze the first N header rows                                 |
| `merges?`      | `MergeRange[]`              | —        | Merged cells (relative to the data area)                       |
| `autoFilter?`  | `boolean`                   | —        | Header auto filter                                             |

## ColumnConfig

| Field          | Type                     | Required | Description                                                                                                                |
| -------------- | ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `key`          | `string`                 | ✅       | Field name on the data row                                                                                                 |
| `header`       | `string`                 | ✅       | Header text                                                                                                                |
| `width?`       | `number`                 | —        | Column width (Excel character units)                                                                                       |
| `style?`       | `CellStyle`              | —        | Data-cell style (headers excluded)                                                                                         |
| `headerStyle?` | `CellStyle`              | —        | Header style for this column; wins over sheet-level `headerStyle`                                                          |
| `format?`      | `FormatSpec \| Function` | —        | Value formatting; functions run on main-thread paths and are stripped on the browser worker path (see the FormatSpec page) |

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
} from "@marcusok/excel-exporter";
```
