---
"@marcusok/excel-exporter": patch
---

Fix three robustness issues found in a code review:

- **wasm-loader race**: calling `configureWasm()` with a new `wasmUrl` while a load was in flight left the loader marked ready with the _old_ URL's WASM (the superseded load clobbered the reset state). The in-flight promise is now captured locally so a superseded load can no longer mark the loader ready/error; the new URL takes effect on the next `ensureLoaded()`.
- **broken worker reuse**: after a `Worker` `onerror` (e.g. failed script load), the errored instance stayed cached and every later export failed into the style-less SheetJS fallback. The errored worker is now terminated and dropped so the next export creates a fresh one; only requests dispatched to that instance are rejected.
- **`download` phase in Node**: `onPhase("download", ...)` was reported in Node even though no download can happen there, contradicting the documented `ExportPhase` contract. The phase is now only reported when a browser `document` exists.
- Stream mode now also warns when data-cell column `style`s are dropped (previously only `headerStyle`/`width`/layout features warned); the console message changed from `stream mode: layout features not supported (...)` to `stream mode: features not supported (...)`.
