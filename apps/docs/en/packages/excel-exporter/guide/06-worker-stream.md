# Worker & Streaming

## Worker threading (≥ 500 rows)

At ≥ 500 rows in the browser, `auto` selects the Worker path: the main thread only does one structured clone (~94ms at 100k rows), while WASM loading and building happen inside the Worker.

```ts
configureWasm({ workerUrl: "/assets/export.worker.js" });
```

Worker path behavior:

- **`workerUrl` is required**, otherwise a clear error is thrown;
- The Worker instance is reused and requests are dispatched by `requestId`, so concurrent exports never interfere;
- **Function-form formats are stripped** (functions cannot be structured-cloned) — use FormatSpec on worker paths;
- `onProgress` / `onPhase` (`init` / `build`) are forwarded from the Worker.

## Streaming writes (≥ 50,000 rows)

`StreamingXlsxWriter` writes rows incrementally with constant memory: ~1.5s at 100k rows (vs 17.5s on the Workbook path). `auto` selects it at ≥ 50k rows.

Known stream limitations (v1):

| Feature                       | Stream path                                           |
| ----------------------------- | ----------------------------------------------------- |
| Cell styles (`style`)         | ❌ not supported                                      |
| Column width (`width`)        | ❌ not supported                                      |
| Freeze / auto-filter / merges | ❌ not supported                                      |
| Custom number formats         | ❌ not supported (`decimals` baked into stored value) |
| Date formats                  | ✅ readable strings per pattern                       |
| Progress callback             | ✅ reported every 1000 rows                           |

Skipped layout features print `[excel-exporter] stream mode: layout features not supported (...)` in the console.

## Which path should I use?

| Need                            | Recommended                                  |
| ------------------------------- | -------------------------------------------- |
| ≤ 50k rows with full styling    | `auto` (main / worker + Workbook)            |
| > 50k rows, styling can degrade | `auto` (worker + Stream), responsive browser |
| Large batch in Node             | `auto` (main → stream at ≥ 50k)              |
| Zero main-thread blocking       | explicit `mode: "worker"`                    |

## Lower-level APIs

`WorkbookBuilder` and `exportAsStream` are exported for fine-grained control:

```ts
import { WorkbookBuilder, exportAsStream } from "@marcusok/excel-exporter";

// batch build
const builder = await WorkbookBuilder.create();
builder.addSheet(sheetA).addSheet(sheetB);
const bytes = await builder.toBuffer();

// streaming
const { bytes, rowCount } = await exportAsStream(sheets, onProgress);
```
