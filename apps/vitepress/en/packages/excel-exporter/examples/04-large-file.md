# Example: 100k-Row Export

Large exports are the core strength of excel-exporter: constant memory at 100k rows, running in a Worker in the browser so the main thread stays responsive.

## Mock data preview

<MockPreview dataset="sales" :rows="3" />

## Implementation

```ts
import { exportExcel } from "@marcusok/excel-exporter";

const rows = salesMockRows(100_000);

const result = await exportExcel({
  filename: "large-export-100k",
  sheets: [
    {
      name: "Sales",
      columns: [
        { key: "orderId", header: "Order ID", width: 18 },
        { key: "date", header: "Date", width: 12 },
        { key: "amount", header: "Amount", width: 14 },
        { key: "status", header: "Status", width: 10 },
      ],
      data: rows,
    },
  ],
  mode: "auto", // ≥ 50k rows -> worker + stream
  onProgress: (p) => setProgress(p),
});

console.log(result); // engine: "modern-xlsx", mode: "worker", rowCount: 100000
```

## Notes

- At 100k rows `auto` picks `worker + Stream`: ~1.5s measured (vs 17.5s on the Workbook path);
- Stream v1 does **not** support styles/width/freeze/filter/merges; a console warning is expected;
- `onProgress` reports every 1000 rows;
- Set `decimals` explicitly on numeric columns for value consistency with the Workbook path.

Compare `auto` vs `main` at 100,000 rows in the [playground](/en/playground).
