# Getting Started

Run your first Excel export in minutes. Requirement: Node `>= 22`. Example commands use pnpm; npm / yarn work the same (`pnpm >= 9` is only a dev requirement of this repository, not of consumers).

## 1. Install

```bash
pnpm add @marcusok/excel-exporter modern-xlsx
```

`modern-xlsx` is a required peerDependency because:

1. `modern-xlsx.wasm` (~1.9MB) must be self-hosted by the consumer as a static asset — an implicit dependency would hide this hard requirement;
2. this package wraps modern-xlsx; consumers should own version control;
3. package managers do auto-install peerDependencies by default (npm 7+ / pnpm 8+), but the implicitly picked version is not under your control — declaring it explicitly pins your intent.

`xlsx` (SheetJS) is an **optional** peerDependency used only by the fallback path; without it the fallback loads from the official CDN.

## 2. Configure browser static assets (browser only)

Two assets must be reachable by your site:

- `modern-xlsx.wasm` (WASM core)
- `export.worker.js` (worker path)

The recommended approach is a Vite plugin that resolves the real paths from `require.resolve` and copies them into `public/assets/` (avoids hardcoding `node_modules`, which breaks under pnpm symlinks):

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

Then configure the URLs at app entry:

```ts
// main.ts
import { configureWasm } from "@marcusok/excel-exporter";

configureWasm({
  wasmUrl: "/assets/modern-xlsx.wasm",
  workerUrl: "/assets/export.worker.js",
});
```

Node / SSR environments need **no** browser static assets, but WASM must be initialized first when running locally (`initWasmSync`, see [Node/SSR](/en/packages/excel-exporter/guide/09-node-ssr)) — otherwise the export degrades to the style-less SheetJS fallback.

## 3. First export

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

await exportExcel({
  filename: "sales-report-2026",
  sheets: [
    {
      name: "Sales",
      freezeRows: 1,
      autoFilter: true,
      columns: [
        { key: "orderId", header: "Order ID", width: 18 },
        { key: "date", header: "Date", width: 12, format: { type: "date" } },
        {
          key: "amount",
          header: "Amount",
          width: 14,
          style: StylePresets.currency,
        },
        {
          key: "status",
          header: "Status",
          width: 10,
          format: {
            type: "enum",
            map: { paid: "Paid", pending: "Pending" },
            fallback: "Unknown",
          },
        },
      ],
      data: [
        {
          orderId: "ORD-000001",
          date: "2026-07-01",
          amount: 1299.99,
          status: "paid",
        },
      ],
    },
  ],
});
```

In the browser this triggers a download; `.xlsx` is appended when missing. Use `download: false` to receive the Blob only.

## 4. Next steps

- Learn how [auto mode routing](/en/packages/excel-exporter/guide/03-auto-mode) picks main / worker / stream
- Try different modes and row counts in the [play](/en/play)
