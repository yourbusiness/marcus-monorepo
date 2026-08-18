# Installation & Configuration

## Requirements

- Node `>= 22` (the package's `engines` requirement); any package manager works — examples use pnpm, npm / yarn are equivalent
- Browsers need WebAssembly support (all modern browsers)
- `modern-xlsx@^1.2.0` is a required peerDependency; `xlsx` (SheetJS) is optional for the fallback

## Install

```bash
pnpm add @marcusok/excel-exporter modern-xlsx
```

Install SheetJS only if you want a local fallback:

```bash
pnpm add xlsx
```

Without it, the fallback dynamically loads `xlsx.mjs` (0.20.3) from the official SheetJS CDN — self-hosting is recommended for production.

## Browser: static assets

Two assets must be reachable by your site:

| Asset              | Description                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modern-xlsx.wasm` | WASM core (~1.9MB), pointed to by `configureWasm({ wasmUrl })`                                                                                                                        |
| `export.worker.js` | Worker entry, pointed to by `configureWasm({ workerUrl })`; needed by every browser path that enters a Worker (auto ≥ 20,000 rows, plus explicit `mode: "worker"` / `mode: "stream"`) |

Recommended: a Vite plugin that resolves real paths from `require.resolve` in `buildStart` and copies them to `public/assets/` (robust under pnpm symlinks):

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const resolveDistDir = (spec: string) => dirname(require.resolve(spec));

export default defineConfig({
  plugins: [
    {
      name: "copy-modern-xlsx-assets",
      buildStart() {
        mkdirSync("public/assets", { recursive: true });
        copyFileSync(
          `${resolveDistDir("modern-xlsx")}/modern-xlsx.wasm`,
          "public/assets/modern-xlsx.wasm",
        );
        const workerSrc = `${resolveDistDir("@marcusok/excel-exporter")}/export.worker.js`;
        if (!statSync(workerSrc, { throwIfNoEntry: false }))
          throw new Error(
            `export.worker.js not found. Run pnpm build first. Looked at: ${workerSrc}`,
          );
        copyFileSync(workerSrc, "public/assets/export.worker.js");
      },
    },
  ],
});
```

Configure once at app entry:

```ts
import { configureWasm } from "@marcusok/excel-exporter";

configureWasm({
  wasmUrl: "/assets/modern-xlsx.wasm",
  workerUrl: "/assets/export.worker.js",
});
```

### configureWasm options

| Option       | Type            | Default  | Description                                                         |
| ------------ | --------------- | -------- | ------------------------------------------------------------------- |
| `wasmUrl`    | `string \| URL` | —        | Self-hosted WASM URL; explicitly configuring it avoids CDN drift    |
| `workerUrl`  | `string \| URL` | —        | `export.worker.js` URL; required for worker mode                    |
| `timeoutMs`  | `number`        | `10_000` | Per-attempt load timeout                                            |
| `maxRetries` | `number`        | `3`      | Max attempts; 3 by default — failed attempts wait 300ms, then 600ms |

`configureWasm` merges options: only a changed `wasmUrl` resets an already-loaded (or mid-load) WASM instance; changing timeouts/retries alone never causes re-initialization. If a previous load failed (error state), any `configureWasm` call clears the error so the next export retries with the new settings.

## Node / SSR

No browser static assets are needed in Node, but **WASM must be initialized first when running locally**: the auto-detected `file://` URL cannot be fetched by Node, and without bootstrapping the export degrades to the style-less SheetJS fallback (with an `[excel-exporter]` console warning). Either call `initWasmSync(readFileSync(...))` at your entry (full example in [Node/SSR](/en/packages/excel-exporter/guide/09-node-ssr)) or point `configureWasm({ wasmUrl })` at a fetchable HTTP URL. `auto` never uses Workers in Node; ≥ 50k rows switch to streaming on the main thread (the stream path does not use WASM).
