# Node / SSR Usage

In Node servers (including SSR) no wasm/worker assets or `configureWasm` are needed — just call the API.

## Environment differences

| Dimension         | Browser              | Node / SSR                                  |
| ----------------- | -------------------- | ------------------------------------------- |
| Worker path       | ✅ available         | ❌ no Web Worker; falls back to main/stream |
| Auto download     | ✅ triggers download | ❌ `triggerDownload` is a no-op             |
| `download` option | defaults to true     | set `false` explicitly and handle the Blob  |
| Large data        | worker + Stream      | main → stream at ≥ 50k rows (main thread)   |

## Export and write to disk

```ts
import { exportExcel } from "@marcusok/excel-exporter";
import { writeFile } from "node:fs/promises";

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

Large server-side exports (≥ 50k rows) automatically take the stream path; without a Worker, the write loop occupies the current thread for ~1.5s. Run it in an async task or queue so request threads stay responsive.
