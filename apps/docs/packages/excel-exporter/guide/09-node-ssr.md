# Node / SSR 使用

Node 服务端（含 SSR）无需部署浏览器静态资源，但本地文件系统运行时需要先初始化 WASM；否则会降级到 SheetJS。

## 环境差异

| 维度            | 浏览器               | Node / SSR                           |
| --------------- | -------------------- | ------------------------------------ |
| Worker 路径     | 可用                 | 无 Web Worker，自动回退 main/stream  |
| 自动下载        | 触发浏览器下载       | `triggerDownload` 为 no-op           |
| `download` 参数 | 默认 true            | 建议显式 `false`，自行处理 Blob      |
| 大数据量        | worker + Fast stream | main → ≥ 5 万行 stream（主线程执行） |

## 服务端导出并落盘

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
  download: false, // 服务端不要触发浏览器下载
  sheets: [{ name: "Sheet1", columns: [...], data: [...] }],
});

if (result.success && result.blob) {
  const buffer = Buffer.from(await result.blob.arrayBuffer());
  await writeFile("./server-report.xlsx", buffer);
}
```

## 配合框架（如 Next.js Route Handler）

```ts
// app/api/export/route.ts
import { exportExcel } from "@marcusok/excel-exporter";
import { initWasmSync } from "modern-xlsx";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// 与上面「落盘」示例相同：Node 下必须先初始化 WASM（模块加载时执行一次），
// 否则 exportExcel 会降级到无样式的 SheetJS 兜底。
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

## 性能提示

服务端大文件（≥ 5 万行）会自动走 stream 路径；由于没有 Worker，Fast stream 占用当前线程约 0.8s，适合放在异步任务/队列中，避免阻塞请求线程。
