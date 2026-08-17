# Example: Sales Report Export

Monthly sales reports are the most common admin export. This example generates 10,000 mock sales rows and demonstrates date/currency/enum formatting, currency styling, frozen header, auto filter and progress callbacks.

## Mock data preview

<MockPreview dataset="sales" :rows="5" />

## Implementation

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

// rows: sales data from your business layer, fields matching the columns
// below (fetching is omitted here; the scenario uses 10k rows — the live
// demo generates same-shaped mock data)

const result = await exportExcel({
  filename: "sales-report-2026-07",
  sheets: [
    {
      name: "Sales",
      freezeRows: 1,
      autoFilter: true,
      columns: [
        { key: "orderId", header: "Order ID", width: 18 },
        { key: "date", header: "Date", width: 12, format: { type: "date" } },
        { key: "region", header: "Region", width: 10 },
        { key: "product", header: "Product", width: 18 },
        { key: "channel", header: "Channel", width: 10 },
        { key: "quantity", header: "Qty", width: 8 },
        {
          key: "amount",
          header: "Amount",
          width: 14,
          style: StylePresets.currency,
        },
        {
          key: "status",
          header: "Status",
          width: 10,
          format: {
            type: "enum",
            map: { paid: "Paid", pending: "Pending", refunded: "Refunded" },
            fallback: "Unknown",
          },
        },
      ],
      data: rows,
    },
  ],
  onProgress: (p) => setProgress(p),
  onPhase: (phase, ms) => trackPhase(phase, ms),
});
```

## Notes

- 10k rows is below the 20,000-row threshold, so the browser takes the `main` path (main-thread Workbook, full styling); at ≥ 20,000 rows auto mode switches to `worker + Workbook` and keeps the main thread responsive;
- `onProgress` only fires at the endpoints (0 and 1) on the `main` path, so the progress bar jumps straight to full at 10k rows; incremental progress requires the stream path (≥ 50,000 rows, reported every 1,000 rows — the worker + Workbook path also fires just the two endpoints);
- `StylePresets.currency` formats the amount column (thousands, 2 decimals, right-aligned);
- The `enum` spec maps internal status codes to readable labels with a `"Unknown"` fallback;
- `freezeRows + autoFilter` lets reviewers filter directly in Excel.

Try it live in the [play](/en/play) with the sales dataset.
