# API: StylePresets

## Presets

| Name       | numFormat          | Other styles                                                   | Use for                         |
| ---------- | ------------------ | -------------------------------------------------------------- | ------------------------------- |
| `header`   | —                  | Bold, size 12, `1F4E79` fill, white text, centered             | Headers (when applied manually) |
| `currency` | `#,##0.00`         | Right-aligned                                                  | Amounts                         |
| `percent`  | `0.00%`            | Right-aligned                                                  | Ratios, growth rates            |
| `date`     | `yyyy-MM-dd`       | Centered                                                       | Date columns                    |
| `datetime` | `yyyy-MM-dd HH:mm` | Centered                                                       | Date-time columns               |
| `dataRow`  | —                  | Left-aligned, vertically centered, thin `D0D0D0` bottom border | Data rows                       |
| `danger`   | —                  | Bold red `C00000`, centered                                    | Risk / anomalies                |

## Usage

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

columns: [
  { key: "amount", header: "Amount", width: 14, style: StylePresets.currency },
  { key: "rate", header: "Growth", width: 12, style: StylePresets.percent },
  { key: "date", header: "Date", width: 12, style: StylePresets.date },
  { key: "flag", header: "Status", width: 10, style: StylePresets.danger },
];
```

## Type

```ts
import type { StylePresetName } from "@marcusok/excel-exporter";

const name: StylePresetName = "currency"; // "header" | "currency" | "percent" | "date" | "datetime" | "dataRow" | "danger"
```

> Column `style` applies to data cells, not headers. For header styling use the `headerStyle` field directly (sheet-level `SheetConfig.headerStyle` sets the default; column-level `ColumnConfig.headerStyle` overrides it), e.g. `headerStyle: StylePresets.header`.
