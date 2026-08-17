# 安装与配置

## 环境要求

- Node `>= 22`、pnpm `>= 9`
- 浏览器需要支持 WebAssembly（现代浏览器均支持）
- 依赖：`modern-xlsx@^1.2.0` 为必装 peerDependency；`xlsx`（SheetJS）为可选兜底依赖

## 安装

```bash
pnpm add @marcusok/excel-exporter modern-xlsx
```

需要兜底时额外安装 SheetJS：

```bash
pnpm add xlsx
```

不安装时，兜底路径会自动从 SheetJS 官方 CDN 加载 `xlsx.mjs`（0.20.3），但生产环境更推荐自托管。

## 浏览器：静态资源部署

浏览器运行需要两份资源可被站点访问：

| 资源               | 说明                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `modern-xlsx.wasm` | WASM 核心（约 1.9MB），`configureWasm({ wasmUrl })` 指定                                                                                                     |
| `export.worker.js` | Worker 多线程入口，`configureWasm({ workerUrl })` 指定；浏览器中凡进入 Worker 的路径都需要（auto ≥ 20,000 行，以及显式 `mode: "worker"` / `mode: "stream"`） |

推荐在 Vite 插件的 `buildStart` 中从 `require.resolve` 反推真实路径拷贝到 `public/assets/`（避免硬编码 node_modules 路径，pnpm 符号链接下更稳）：

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

应用入口统一配置：

```ts
import { configureWasm } from "@marcusok/excel-exporter";

configureWasm({
  wasmUrl: "/assets/modern-xlsx.wasm",
  workerUrl: "/assets/export.worker.js",
});
```

### configureWasm 参数

| 参数         | 类型            | 默认值   | 说明                                                            |
| ------------ | --------------- | -------- | --------------------------------------------------------------- |
| `wasmUrl`    | `string \| URL` | —        | 自托管 WASM 地址，生产强烈建议显式配置避免 CDN 漂移             |
| `workerUrl`  | `string \| URL` | —        | `export.worker.js` 地址，worker 模式必填                        |
| `timeoutMs`  | `number`        | `10_000` | 单次加载超时                                                    |
| `maxRetries` | `number`        | `3`      | 最大尝试次数；默认 3 次尝试，失败后按 300ms、600ms 指数退避等待 |

`configureWasm` 是合并语义：仅当 `wasmUrl` 变化时才重置已加载的 WASM 实例，只改超时/重试不会造成重复初始化。

## Node / SSR

Node 环境无需部署浏览器静态资源，但**本地运行时需要先初始化 WASM**：自动探测得到的 `file://` 地址无法被 Node 的 fetch 加载，若不引导会静默降级到无样式的 SheetJS 兜底。做法是在入口先 `initWasmSync(readFileSync(...))`（见 [Node/SSR](/packages/excel-exporter/guide/09-node-ssr) 的完整示例），或通过 `configureWasm({ wasmUrl })` 指定一个可 fetch 的 HTTP 地址。`auto` 模式下 Node 不会走 Worker，而是主线程执行；≥ 5 万行自动切换流式路径（流式路径不依赖 WASM）。
