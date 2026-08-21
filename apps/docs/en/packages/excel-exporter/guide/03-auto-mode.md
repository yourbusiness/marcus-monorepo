# Auto Mode Routing

The `mode` option defaults to `"auto"`: the library picks the optimal path based on **total row count** and the runtime environment, so business code never needs to react to data size.

## Routing rules

### Browser

| Rows              | Path                   | Notes                                                                                    |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `< 20,000`        | `main`                 | Synchronous main-thread build; ~120ms at 10k×6 columns                                   |
| `20,000 – 49,999` | `worker` + Workbook    | Main thread only does one structured clone (~94ms at 100k rows); WASM runs in the Worker |
| `>= 50,000`       | `worker` + Fast stream | Custom fflate writes avoid the `toBuffer` cliff                                          |

### Node / SSR (no Web Worker)

| Rows        | Path     | Notes                                    |
| ----------- | -------- | ---------------------------------------- |
| `< 50,000`  | `main`   | Main-thread Workbook build, full styling |
| `>= 50,000` | `stream` | Fast stream, ~0.8s at 100k rows          |

## Explicit modes

```ts
await exportExcel({ ..., mode: "stream" });  // force streaming
await exportExcel({ ..., mode: "worker" });  // force Worker (browser)
await exportExcel({ ..., mode: "main" });    // force main thread
```

`mode: "worker"` does **not** error in Node/SSR: it falls back to the main-thread path (stream above 50k rows), preserving style semantics instead of silently degrading to style-less SheetJS.

## Why 20,000 / 50,000

- **20,000 rows**: synchronous main-thread work is acceptable below this level; avoids unnecessary Worker startup;
- **50,000 rows**: `Workbook.toBuffer()` shows a superlinear cliff beyond ~55k rows (~17.5s at 100k), while Fast stream stays at ~0.8s. `STREAM_THRESHOLD = 50_000` keeps a safety margin.

> Trade-off: Stream v1 supports multi-row headers and cell merges, but not cell styles, header styles or layout features (width/freeze/filter). For fully-styled exports stay under 50k rows or split into multiple sheets.
