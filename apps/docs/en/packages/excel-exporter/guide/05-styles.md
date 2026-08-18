# Styling

A column-level `style` (`CellStyle`) applies to all **data cells** of that column (headers keep the default look). Seven presets are built in, and full customization is supported.

## Built-in presets

| Preset                  | Visual                                                                                                                   | Description                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `StylePresets.header`   | <span style="display:inline-block;width:12px;height:12px;background:#1F4E79;border-radius:2px"></span> dark blue / white | Bold, size 12, `1F4E79` fill, white text, centered             |
| `StylePresets.currency` | `#,##0.00`                                                                                                               | Thousands separator, 2 decimals, right-aligned                 |
| `StylePresets.percent`  | `0.00%`                                                                                                                  | Percentage format, right-aligned                               |
| `StylePresets.date`     | `yyyy-MM-dd`                                                                                                             | Date format, centered                                          |
| `StylePresets.datetime` | `yyyy-MM-dd HH:mm`                                                                                                       | Date-time format, centered                                     |
| `StylePresets.dataRow`  | left + thin bottom border                                                                                                | Left-aligned, vertically centered, thin `D0D0D0` bottom border |
| `StylePresets.danger`   | <span style="display:inline-block;width:12px;height:12px;background:#C00000;border-radius:2px"></span> red bold          | Bold red text `C00000`, centered                               |

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

await exportExcel({
  filename: "styled",
  sheets: [
    {
      name: "Sheet1",
      columns: [
        { key: "name", header: "Name", width: 16, style: StylePresets.dataRow },
        {
          key: "amount",
          header: "Amount",
          width: 14,
          style: StylePresets.currency,
        },
        { key: "date", header: "Date", width: 12, style: StylePresets.date },
        {
          key: "status",
          header: "Status",
          width: 10,
          style: StylePresets.danger,
        },
      ],
      data: [
        {
          name: "Keyboard",
          amount: 1299.99,
          date: "2026-07-01",
          status: "Out of stock",
        },
      ],
    },
  ],
});
```

## Custom CellStyle

```ts
import type { CellStyle } from "@marcusok/excel-exporter";

const highlight: CellStyle = {
  font: { bold: true, size: 11, color: "1F4E79" }, // 6-digit RGB hex
  fill: { pattern: "solid", fgColor: "DDEBF7" },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: {
    bottom: { style: "medium", color: "1F4E79" },
    right: { style: "thin", color: "D0D0D0" },
  },
  numFormat: "#,##0.00",
};
```

Field reference:

| Field       | Description                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `font`      | `bold` / `italic` / `size` / `color` (6-digit hex, e.g. `"FF0000"`) / `name`                         |
| `fill`      | `pattern: "solid" \| "none"`, `fgColor`, `bgColor` (6-digit hex)                                     |
| `alignment` | `horizontal` (left/center/right), `vertical` (top/center/bottom), `wrapText`, `textRotation` (0–180) |
| `border`    | per-side `{ style, color }`; `style` values come from modern-xlsx `BorderStyle`                      |
| `numFormat` | Excel format codes such as `"#,##0.00"`, `"yyyy-mm-dd"`, `"0.00%"`                                   |

> Colors are 6-digit RGB hex **without** `#`, matching modern-xlsx's type contract.

## Relationship to FormatSpec

`style.numFormat` and column `format` (FormatSpec) are separate mechanisms: `style` controls appearance, `format` converts/structures the stored value. For `date` / `number` FormatSpecs the Workbook path auto-injects the matching `numFormat`, so manual setup is usually unnecessary. See [Formatting](/en/packages/excel-exporter/guide/04-formatting).
