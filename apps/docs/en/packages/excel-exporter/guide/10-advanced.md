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

`freezeRows: 1` freezes the header row (mapped to `frozenPane`).

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
    // 0 → 1; incremental progress only on the stream path (every 1000 rows); main and worker+Workbook fire just 0 and 1
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
