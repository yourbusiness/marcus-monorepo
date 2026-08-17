# Quick Start

One `exportExcel` call exports your data. The core concepts: `sheets` (workbook pages), `columns` (column definitions) and `data` (row objects).

## Minimal example

```ts
import { exportExcel } from "@marcusok/excel-exporter";

await exportExcel({
  filename: "hello",
  sheets: [
    {
      name: "Sheet1",
      columns: [
        { key: "name", header: "Name", width: 16 },
        { key: "count", header: "Count", width: 10 },
      ],
      data: [
        { name: "Keyboard", count: 12 },
        { name: "Mouse", count: 8 },
      ],
    },
  ],
});
```

This downloads `hello.xlsx` in the browser; `.xlsx` is appended unless `filename` already ends with it.

## With styles and formatting

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

await exportExcel({
  filename: "sales-report-2026",
  sheets: [
    {
      name: "Sales",
      freezeRows: 1,
      autoFilter: true,
      columns: [
        { key: "orderId", header: "Order ID", width: 18 },
        { key: "date", header: "Date", width: 12, format: { type: "date" } },
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
      data: [
        {
          orderId: "ORD-000001",
          date: "2026-07-01",
          amount: 1299.99,
          status: "paid",
        },
        {
          orderId: "ORD-000002",
          date: "2026-07-02",
          amount: 399,
          status: "pending",
        },
      ],
    },
  ],
});
```

Notes:

- `freezeRows: 1` freezes the header row;
- `autoFilter: true` adds filter dropdowns;
- `style` applies to **data cells only** (headers stay default, matching the type contract);
- `format` is a structured, thread-safe `FormatSpec`: dates become Excel date serials with an auto-injected `numFormat`, enums map to readable labels.

## Blob only, no download

```ts
const result = await exportExcel({
  filename: "report",
  sheets: [{ name: "Sheet1", columns: [...], data: [...] }],
  download: false,
});

if (result.success && result.blob) {
  const form = new FormData();
  form.append("file", result.blob, "report.xlsx");
  await fetch("/api/upload", { method: "POST", body: form });
}
```

`ExportResult` also reports the actual `engine`, `mode`, `duration` and `rowCount`, useful for metrics or telemetry.
