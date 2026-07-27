# @marcus/excel-exporter

High-performance Excel export engine built on [modern-xlsx](https://github.com/ABCrimson/modern-xlsx) (Rust + WASM). Free cell styles, number formats, data validation, freeze panes, and streaming export for very large datasets — features SheetJS charges for.

## Why

SheetJS Community Edition cannot **write** styles (paid Pro only) and chokes on large exports. `modern-xlsx` is MIT-licensed, WASM-accelerated, and writes full styling for free. This package wraps it with a friendly, declarative API and automatic routing between a fast in-memory path (≤50k rows, full styles) and a constant-memory streaming path (≥50k rows).

## Performance (verified, 4 cols, independent-process first run)

| Rows | Path | End-to-end | Notes |
|------|------|-----------|-------|
| 10k  | Workbook | ~120 ms | sheetAddAoa ~22ms + toBuffer ~100ms |
| 50k  | Workbook | ~580–830 ms | styles + freeze + autofilter |
| 100k | Stream   | ~1.6–1.8 s   | writeRow ~1.5s + finish ~100ms |
| 100k | Workbook | **~21 s** ⚠️ | toBuffer cliff — why the stream threshold exists |

> `Workbook.toBuffer()` has a severe performance cliff beyond ~55k rows (verified: 100k rows takes ~21s on a cold process, vs ~600ms hot). The 50k stream threshold is deliberately conservative. Within a single long-lived process the second 100k run is ~600ms (hot cache) — but real browser exports are first-runs, so design for the cold number.

Main-thread blocking budget: worker mode does one structured-clone `postMessage` (~9ms/10k, ~46ms/50k, ~94ms/100k), all WASM work runs off-thread.

## Install

```bash
pnpm add @marcus/excel-exporter modern-xlsx
```

`modern-xlsx` is a peerDependency (must be installed explicitly so the WASM singleton is process-global). Optionally add `xlsx` for the SheetJS fallback path.

## Configure (browser)

Two static assets must be reachable at runtime: the WASM binary and the worker script. Copy them into your public dir (Vite example):

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const resolveDistDir = (spec: string) => dirname(require.resolve(spec));

export default defineConfig({
  plugins: [{
    name: 'copy-modern-xlsx-assets',
    buildStart() {
      mkdirSync('public/assets', { recursive: true });
      copyFileSync(`${resolveDistDir('modern-xlsx')}/modern-xlsx.wasm`, 'public/assets/modern-xlsx.wasm');
      const workerSrc = `${resolveDistDir('@marcus/excel-exporter')}/export.worker.js`;
      if (!statSync(workerSrc, { throwIfNoEntry: false })) {
        throw new Error(`export.worker.js not found — run pnpm build in the package first. Looked at: ${workerSrc}`);
      }
      copyFileSync(workerSrc, 'public/assets/export.worker.js');
    },
  }],
});
```

```ts
// main.ts — point the loader at the copied assets
import { configureWasm } from '@marcus/excel-exporter';

configureWasm({
  wasmUrl: '/assets/modern-xlsx.wasm',
  workerUrl: '/assets/export.worker.js',
});
```

## Usage

```ts
import { exportExcel, StylePresets } from '@marcus/excel-exporter';

await exportExcel({
  filename: 'sales-report',
  sheets: [{
    name: 'Sales',
    freezeRows: 1,
    autoFilter: true,
    columns: [
      { key: 'product', header: 'Product', width: 20 },
      { key: 'revenue', header: 'Revenue', width: 14, style: StylePresets.currency },
      { key: 'createdAt', header: 'Date', width: 16, style: StylePresets.date },
      { key: 'status', header: 'Status', width: 10,
        // FormatSpec is worker-compatible (functions cannot be structured-cloned)
        format: { type: 'enum', map: { paid: 'Paid', pending: 'Pending' }, fallback: '?' } },
    ],
    data: rows, // auto-routing: <500 main, 500–49,999 worker+workbook, ≥50,000 worker+stream
  }],
});
```

### Format

`ColumnConfig.format` accepts either a `FormatSpec` (worker-safe) or a function (main/Node only — stripped in worker mode with a warning). Built-in spec types: `enum`, `date`, `datetime`, `number` (decimals + thousands), `padding` (zero-pad order IDs, etc.).

### Mode routing (`auto`)

| Rows | Browser | Node |
|------|---------|------|
| < 500 | main | main |
| 500–49,999 | worker + workbook (full styles) | main |
| ≥ 50,000 | worker + stream (no StyleBuilder styles) | stream |

Force a mode with `mode: 'main' | 'worker' | 'stream'`.

### Fallback

If WASM is unsupported or fails to load after retries, the export degrades to SheetJS (no styles, data only). The result carries `engine: 'sheetjs'` and a non-fatal `error` for monitoring. SheetJS is loaded from the consumer install or the official CDN.

## API

- `exportExcel(options): Promise<ExportResult>` — main entry.
- `configureWasm(opts)` — set `wasmUrl` / `workerUrl` / `timeoutMs` / `maxRetries`.
- `WorkbookBuilder` — direct batch-write builder (≤50k rows, full styles).
- `exportAsStream(sheets)` — direct streaming export (≥50k rows).
- `StylePresets` — `header`, `currency`, `percent`, `date`, `datetime`, `dataRow`, `danger`.

## Node usage

Node has no Web Worker, so worker mode is unavailable — `auto` runs `main` (≤50k) or `stream` (≥50k) on the calling thread. Use `initWasmSync` for test setup (Node's `fetch` rejects `file://`):

```ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initWasmSync } from 'modern-xlsx';
const require = createRequire(import.meta.url);
initWasmSync(readFileSync(`${require('path').dirname(require.resolve('modern-xlsx'))}/modern-xlsx.wasm`));
```

## License

MIT.
