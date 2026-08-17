# Example: Inventory Ledger Export

Inventory ledgers should make risk items stand out. This example combines a custom `CellStyle` (applied to the whole column) with enum mapping.

## Mock data preview

<MockPreview dataset="inventory" :rows="5" />

## Implementation

```ts
import { exportExcel } from "@marcusok/excel-exporter";
import type { CellStyle } from "@marcusok/excel-exporter";

// rows: inventory data from your business layer, fields matching the
// columns below (fetching is omitted here)

const lowStock: CellStyle = {
  font: { color: "C00000", bold: true },
  fill: { pattern: "solid", fgColor: "FDE2E2" },
};

const result = await exportExcel({
  filename: "inventory-2026-07",
  sheets: [
    {
      name: "Inventory",
      freezeRows: 1,
      autoFilter: true,
      columns: [
        { key: "sku", header: "SKU", width: 16 },
        { key: "name", header: "Product", width: 20 },
        { key: "category", header: "Category", width: 10 },
        { key: "warehouse", header: "Warehouse", width: 12 },
        {
          key: "stock",
          header: "Stock",
          width: 10,
          format: { type: "number", thousands: true },
          style: lowStock, // highlights the whole stock column
        },
        { key: "safetyStock", header: "Safety Stock", width: 12 },
        { key: "unit", header: "Unit", width: 8 },
        {
          key: "updatedAt",
          header: "Updated",
          width: 12,
          format: { type: "date" },
        },
        {
          key: "status",
          header: "Status",
          width: 10,
          format: {
            type: "enum",
            map: { "in-stock": "OK", low: "Low", out: "Out" },
            fallback: "Unknown",
          },
        },
      ],
      data: rows,
      merges: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }],
    },
  ],
});
```

## Notes

- The custom `lowStock` style (bold red + light red fill) highlights risk items — note that a column-level `style` applies to **every** data row in the column; per-row conditional styling is not supported in v1, so use the status column's enum labels to flag individual risk items;
- Column-level `style` applies to the whole data column — a good fit for status columns;
- `merges` are positioned relative to the data area;
- Small data (< 20,000 rows) stays on the styled `main` path with default `auto`.
