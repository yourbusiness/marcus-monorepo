# 快速开始

本文带你从零跑通第一个 Excel 导出。完整的环境要求：Node `>= 22`、pnpm `>= 9`。

## 1. 安装

```bash
pnpm add @marcusok/excel-exporter modern-xlsx
```

`modern-xlsx` 是必装 peerDependency，原因有三：

1. `modern-xlsx.wasm`（约 1.9MB）需要由消费方作为静态资源自行部署，隐式依赖会掩盖这一硬性要求；
2. 本包是 modern-xlsx 的封装，版本控制权应交给消费方；
3. 包管理器默认会自动安装 peerDependency（npm 7+ / pnpm 8+ 起），隐式装上的版本不受消费方掌控，显式声明才能锁定版本意图。

`xlsx`（SheetJS）为**可选** peerDependency，仅在需要降级兜底时安装；不安装时兜底会从官方 CDN 加载。

## 2. 配置浏览器静态资源（仅浏览器需要）

两份资源必须在站点可访问：

- `modern-xlsx.wasm`（WASM 核心）
- `export.worker.js`（Worker 多线程路径）

推荐在 Vite 插件 `buildStart` 中从 `require.resolve` 反推真实路径拷贝到 `public/assets/`，避免硬编码 `node_modules`（pnpm 符号链接不兼容）：

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

然后在应用入口配置资源地址：

```ts
// main.ts
import { configureWasm } from "@marcusok/excel-exporter";

configureWasm({
  wasmUrl: "/assets/modern-xlsx.wasm",
  workerUrl: "/assets/export.worker.js",
});
```

Node / SSR 环境**无需**部署浏览器静态资源，但本地运行时需先 `initWasmSync` 初始化 WASM（见 [Node/SSR](/packages/excel-exporter/guide/09-node-ssr)），否则会降级到无样式的 SheetJS 兜底。

## 3. 第一个导出

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

await exportExcel({
  filename: "销售明细-2026",
  sheets: [
    {
      name: "销售明细",
      freezeRows: 1,
      autoFilter: true,
      columns: [
        { key: "orderId", header: "订单号", width: 18 },
        { key: "date", header: "日期", width: 12, format: { type: "date" } },
        {
          key: "amount",
          header: "金额",
          width: 14,
          style: StylePresets.currency,
        },
        {
          key: "status",
          header: "状态",
          width: 10,
          format: {
            type: "enum",
            map: { paid: "已支付", pending: "待支付" },
            fallback: "未知",
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

浏览器中运行会自动触发下载，文件名缺省 `.xlsx` 后缀时自动补全。`download: false` 时只返回 Blob，便于自托管上传等场景。

## 4. 下一步

- 了解 [自动模式路由](/packages/excel-exporter/guide/03-auto-mode) 是如何选择 main / worker / stream 的
- 在 [在线演示](/play) 里直接体验不同数据量与模式
