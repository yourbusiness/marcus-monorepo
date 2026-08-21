# Advanced Features

## Multiple sheets

`sheets` is an array — one call produces a multi-page workbook:

```ts
await exportExcel({
  filename: "department-report",
  sheets: [
    { name: "Sales", columns: [...], data: salesData },
    { name: "Staff", columns: [...], data: staffData },
  ],
});
```

Sheet names must satisfy ECMA-376 constraints: non-empty, ≤ 31 characters, and must not contain `: \ / ? * [ ]`. A violation never produces a corrupt file and never throws to the caller — the validation error is caught and routed through the fallback, which re-validates the same name, so the export finally resolves with `{ success: false, error }` (with a clear error message).

## Frozen rows

`freezeRows: 1` freezes the header row (mapped to `frozenPane`). For multi-row headers, prefer `freezeRows >= header row count` so all header rows stay visible.

## Multi-row headers

Nest columns with `children` to get multi-row headers. Group header cells merge across all their descendant leaf columns, and leaf headers span the remaining header rows vertically — no manual merge math required.

```ts
await exportExcel({
  filename: "monthly-sales",
  sheets: [
    {
      name: "Sales",
      freezeRows: 3,
      columns: [
        { key: "product", header: "Product" },
        {
          header: "Revenue",
          children: [
            {
              header: "This month",
              children: [
                { key: "m_qty", header: "Qty" },
                { key: "m_amt", header: "Amount" },
              ],
            },
            {
              header: "YTD",
              children: [
                { key: "y_qty", header: "Qty" },
                { key: "y_amt", header: "Amount" },
              ],
            },
          ],
        },
      ],
      data: [{ product: "A", m_qty: 1, m_amt: 2, y_qty: 3, y_amt: 4 }],
    },
  ],
});
```

Rules:

- Leaf columns (no `children`) need a `key`; group columns may omit it and contribute header rows only;
- `width` / `style` / `format` apply to leaf columns only;
- Group header cells style via that column's `headerStyle`, leaf headers likewise (falling back to the sheet-level `headerStyle`);
- Multi-row headers work on every path (main / worker / stream / SheetJS fallback); merges survive on the stream and fallback paths too (styles excepted).

## Merged cells

```ts
{
  name: "Summary",
  columns: [...],
  data: [...],
  merges: [
    { row: 0, col: 0, rowspan: 1, colspan: 2 }, // first data row spans two columns
  ],
}
```

`MergeRange` is relative to the data area: `row` / `col` start at 0 (`row 0` = first data row); `rowspan` / `colspan` are the spans.

## Auto filter

`autoFilter: true` adds filter dropdowns to the header range.

## Progress and phase callbacks

```ts
await exportExcel({
  ...,
  onProgress: (progress) => {
    // 0 → 1; the leading 0 and trailing 1 fire exactly once each on every route
    // (the SheetJS fallback included); incremental progress only on the stream
    // path (every 1000 rows)
    bar.style.width = `${progress * 100}%`;
  },
  onPhase: (phase, durationMs) => {
    // phase: "init" | "build" | "download", strictly sequential
    console.log(`${phase} took ${durationMs.toFixed(1)}ms`);
  },
});
```

Phase semantics:

| Phase      | Description                                                                                                                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`     | WASM init; reported on every main-path export (~0ms once loaded); Node's main-thread stream path does not load WASM but still reports a single 0ms to keep the phase sequence stable; on Worker + Workbook only when the worker initializes; never on Worker + stream or the SheetJS fallback |
| `build`    | Workbook construction (reported once per actual attempt, including fallback)                                                                                                                                                                                                                  |
| `download` | Browser download trigger (absent with `download: false`; absent in Node)                                                                                                                                                                                                                      |

> `onPhase` measures per-phase wall time only; `ExportResult.duration` always measures the whole export.

## Disable auto download

```ts
const result = await exportExcel({ ..., download: false });
// use result.blob directly
```

## Export result

```ts
interface ExportResult {
  success: boolean;
  blob?: Blob;
  engine?: "modern-xlsx" | "sheetjs"; // engine actually used
  mode?: ExportMode; // mode actually used
  duration?: number; // total export duration in ms
  rowCount?: number;
  error?: Error;
}
```

Show `result.error` on failure; when `engine` is `"sheetjs"`, warn the user that styles may be stripped.
