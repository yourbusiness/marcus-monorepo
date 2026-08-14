# Example: Inventory Ledger Export

Inventory ledgers should highlight low-stock and out-of-stock items. This example combines a custom `CellStyle` with function-form formatting (main path).

## Mock data preview

<MockPreview dataset="inventory" :rows="5" />

## Implementation

```ts
import { exportExcel } from "@marcusok/excel-exporter";
import type { CellStyle } from "@marcusok/excel-exporter";

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

- The custom `lowStock` style (bold red + light red fill) makes risk items obvious;
- Column-level `style` applies to the whole data column — a good fit for status columns;
- `merges` are positioned relative to the data area;
- Small data (< 20,000 rows) stays on the styled `main` path with default `auto`.
