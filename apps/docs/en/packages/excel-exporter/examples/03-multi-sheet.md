# Example: Multi-Sheet Workbook

Admin reports often combine several topics in one file. This example builds a workbook from two mock datasets: sales detail and a staff roster.

## Mock data preview (staff roster)

<MockPreview dataset="staff" :rows="5" />

## Implementation

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

// salesRows / staffRows: data from your business layer (fetching is omitted
// here); fields match each sheet's columns below

const result = await exportExcel({
  filename: "department-report-2026-Q3",
  sheets: [
    {
      name: "Sales",
      freezeRows: 1,
      autoFilter: true,
      columns: [
        { key: "orderId", header: "Order ID", width: 18 },
        { key: "product", header: "Product", width: 18 },
        {
          key: "amount",
          header: "Amount",
          width: 14,
          style: StylePresets.currency,
        },
      ],
      data: salesRows,
    },
    {
      name: "Staff",
      freezeRows: 1,
      columns: [
        { key: "id", header: "ID", width: 10 },
        { key: "name", header: "Name", width: 12 },
        { key: "dept", header: "Department", width: 12 },
        { key: "position", header: "Position", width: 14 },
        {
          key: "salary",
          header: "Monthly Salary",
          width: 14,
          style: StylePresets.currency,
        },
        {
          key: "hiredAt",
          header: "Hired",
          width: 12,
          format: { type: "date" },
        },
      ],
      data: staffRows,
    },
  ],
});
```

## Notes

- Each sheet defines its own columns, styles and data independently;
- Total rows = the sum across sheets; `auto` routes on the **total**;
- Sheet names follow Excel rules: ≤ 31 characters, no `: \ / ? * [ ]`.
