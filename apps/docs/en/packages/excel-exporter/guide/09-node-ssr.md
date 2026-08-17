# Node / SSR Usage

In Node servers (including SSR) you don't need browser assets, but local filesystem runtimes must initialize WASM first; otherwise the library falls back to SheetJS.

## Environment differences

| Dimension         | Browser              | Node / SSR                                 |
| ----------------- | -------------------- | ------------------------------------------ |
| Worker path       | available            | no Web Worker; falls back to main/stream   |
| Auto download     | triggers download    | `triggerDownload` is a no-op               |
| `download` option | defaults to true     | set `false` explicitly and handle the Blob |
| Large data        | worker + Fast stream | main → stream at ≥ 50k rows (main thread)  |

## Export and write to disk

```ts
import { exportExcel } from "@marcusok/excel-exporter";
import { initWasmSync } from "modern-xlsx";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
initWasmSync(
  readFileSync(
    `${require("node:path").dirname(require.resolve("modern-xlsx"))}/modern-xlsx.wasm`,
  ),
);

const result = await exportExcel({
  filename: "server-report",
  download: false, // never trigger a browser download server-side
  sheets: [{ name: "Sheet1", columns: [...], data: [...] }],
});

if (result.success && result.blob) {
  const buffer = Buffer.from(await result.blob.arrayBuffer());
  await writeFile("./server-report.xlsx", buffer);
}
```

## With a framework (Next.js Route Handler)

```ts
// app/api/export/route.ts
import { exportExcel } from "@marcusok/excel-exporter";
import { initWasmSync } from "modern-xlsx";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Same bootstrap as the "write to disk" example above: Node must initialize
// WASM first (once, at module load) — otherwise exportExcel degrades to the
// style-less SheetJS fallback.
const require = createRequire(import.meta.url);
initWasmSync(
  readFileSync(
    `${require("node:path").dirname(require.resolve("modern-xlsx"))}/modern-xlsx.wasm`,
  ),
);

export async function GET() {
  const result = await exportExcel({
    filename: "report",
    download: false,
    sheets: [/* ... */],
  });
  if (!result.success || !result.blob) {
    return Response.json({ error: result.error?.message }, { status: 500 });
  }
  return new Response(result.blob, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="report.xlsx"',
    },
  });
}
```

## Performance tip

Large server-side exports (≥ 50k rows) automatically take the stream path; without a Worker, Fast stream occupies the current thread for ~0.8s. Run it in an async task or queue so request threads stay responsive.
