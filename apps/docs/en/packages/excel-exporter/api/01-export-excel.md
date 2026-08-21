# API: exportExcel & Configuration

## exportExcel

```ts
exportExcel(options: ExportOptions): Promise<ExportResult>
```

The core entry point (convenience wrappers such as `exportTable` / `exportEcharts` delegate to it). Routes to main / worker / stream by row count and environment, degrading to SheetJS when WASM is unavailable.

## ExportOptions

| Field        | Type                                               | Required | Description                                                                                                                                                                                                                     |
| ------------ | -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sheets`     | `SheetConfig[]`                                    | yes      | At least one sheet                                                                                                                                                                                                              |
| `filename`   | `string`                                           | yes      | Download name; `.xlsx` is appended unless it already ends with it                                                                                                                                                               |
| `mode`       | `"auto" \| "main" \| "worker" \| "stream"`         | —        | Default `"auto"`                                                                                                                                                                                                                |
| `onProgress` | `(progress: number) => void`                       | —        | 0 → 1; the leading 0 and trailing 1 are each fired exactly once by `exportExcel` on every route (including the SheetJS fallback and ultimately failed exports); incremental progress only on the stream path (every 1,000 rows) |
| `onPhase`    | `(phase: ExportPhase, durationMs: number) => void` | —        | `init` / `build` / `download` timings                                                                                                                                                                                           |
| `download`   | `boolean`                                          | —        | Default `true`; `false` returns the Blob only                                                                                                                                                                                   |

## ExportResult

| Field       | Type                         | Description                                    |
| ----------- | ---------------------------- | ---------------------------------------------- |
| `success`   | `boolean`                    | Whether the export succeeded                   |
| `blob?`     | `Blob`                       | The file content                               |
| `engine?`   | `"modern-xlsx" \| "sheetjs"` | Engine actually used                           |
| `mode?`     | `ExportMode`                 | Mode actually used                             |
| `duration?` | `number`                     | Total duration in ms                           |
| `rowCount?` | `number`                     | Exported row count                             |
| `error?`    | `Error`                      | Failure reason (also set on the fallback path) |

## configureWasm

```ts
configureWasm(options: LoaderOptions): void
```

| Field        | Default  | Description                                                      |
| ------------ | -------- | ---------------------------------------------------------------- |
| `wasmUrl`    | —        | Self-hosted `modern-xlsx.wasm` URL                               |
| `workerUrl`  | —        | `export.worker.js` URL; required for worker mode                 |
| `timeoutMs`  | `10_000` | Per-attempt load timeout                                         |
| `maxRetries` | `3`      | Max load attempts (3 total incl. the first; 300ms/600ms backoff) |

## Other exported symbols

- `WorkbookBuilder.create()` + `addSheet(config)` + `toBuffer()` / `toBlob()`: batch build with full styling;
- `exportAsStream(sheets, onProgress?)`: lower-level streaming, returns `Promise<{ bytes, rowCount }>`;
- `exportTable(options)`: convenience for common table data; accepts AntD `title`/`dataIndex` and Element Plus `label`/`prop`;
- `exportEcharts(options)`: convenience for common ECharts data; supports category-axis series, pie `name/value`, and scatter `[x,y]`;
- `getWasmLoader()`: access the global WASM loader (state: idle / loading / ready / error).

```ts
import {
  exportExcel,
  configureWasm,
  WorkbookBuilder,
  exportAsStream,
  exportTable,
  exportEcharts,
  getWasmLoader,
} from "@marcusok/excel-exporter";
```

> The entry point also re-exports lower-level utilities and types (e.g. `applyFormat` / `validateSheetName` from `format-utils`, `LoaderOptions` / `LoadState`, `BorderStyle`). This page covers the commonly used stable API only; see `src/index.ts` for the full list.
