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

Only the browser `worker` / `auto` path (≥ 500 rows) needs it.

### `result.engine` is "sheetjs"

The WASM path failed or is unsupported, so the library degraded to the SheetJS fallback (styles stripped). Look for `[excel-exporter]` warnings in the console to find the reason — usually a 404 wasm URL or blocked CDN. See [fallback](/en/packages/excel-exporter/guide/08-fallback).

### Exporting 100k rows is very slow (>15s)

You are on the `main` + `Workbook.toBuffer()` path, which has a cliff beyond ~55k rows. Keep `mode: "auto"`, or set `mode: "stream"` / `mode: "worker"` explicitly. See [auto mode](/en/packages/excel-exporter/guide/03-auto-mode).

### Styles do not apply in stream mode

Stream (v1) does not support cell styles or layout features such as width, freeze, filter and merges (a console warning is printed). Keep exports under 50k rows when you need full styling. See [Worker & streaming](/en/packages/excel-exporter/guide/06-worker-stream).

### Is my data uploaded anywhere?

No. All processing happens in the browser or the Node process; business data never leaves the machine.

### Dates render as serial numbers

Declare `format: { type: "date" }` (or `datetime`) on date columns — the Workbook path then auto-injects the matching `numFormat`. Without it, cells show the raw Excel date serial.
