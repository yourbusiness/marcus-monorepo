# FAQ

### WASM 404 in the browser

`modern-xlsx.wasm` is not reachable by your site. Copy it into `public/assets/` with the Vite plugin from [Getting Started](/en/guide/01-getting-started) and point `configureWasm({ wasmUrl })` at the right URL.

### Worker mode throws "workerUrl not configured"

`export.worker.js` must be deployed and configured explicitly:

```ts
configureWasm({
  workerUrl: "/assets/export.worker.js",
});
```

It is needed by every browser path that enters a Worker: `auto` (≥ 20,000 rows), explicit `mode: "worker"`, and explicit `mode: "stream"` in the browser (stream also runs inside a Worker there). Without it, those paths throw and degrade to the SheetJS fallback.

### `result.engine` is "sheetjs"

The WASM path failed or is unsupported, so the library degraded to the SheetJS fallback (styles stripped). Look for `[excel-exporter]` warnings in the console to find the reason — usually a 404 wasm URL or blocked CDN. See [fallback](/en/packages/excel-exporter/guide/08-fallback).

### Exporting 100k rows is very slow (>15s)

You are most likely on the `main` + `Workbook.toBuffer()` path, which has a cliff beyond ~55k rows. Keep `mode: "auto"` (~0.8s at 100k rows), or set `mode: "stream"` / `mode: "worker"` explicitly. See [auto mode](/en/packages/excel-exporter/guide/03-auto-mode).

### Styles do not apply in stream mode

Stream (v1) does not support cell styles, header styles or layout features such as width, freeze, filter and merges (a console warning is printed). Keep exports under 50k rows when you need full styling. See [Worker & streaming](/en/packages/excel-exporter/guide/06-worker-stream).

### Is my data uploaded anywhere?

No. All processing happens in the browser or the Node process; business data never leaves the machine.

### Date columns render as long text, not dates

Without a `format`, `Date` values are written as plain text Excel does not recognize as a date: the Workbook path writes the localized long form (e.g. `Wed Jul 01 2026 00:00:00 GMT+0800 (China Standard Time)`), while the stream / SheetJS fallback paths write an ISO string (e.g. `2026-07-01T00:00:00.000Z`). Declare `format: { type: "date" }` (or `datetime`) on date columns: the Workbook path then stores the Excel date serial and auto-injects the matching `numFormat`, so the cell becomes a real date.
