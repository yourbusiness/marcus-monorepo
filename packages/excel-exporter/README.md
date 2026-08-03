# @marcusok/excel-exporter · 高性能 Excel 导出引擎

基于 [modern-xlsx](https://github.com/ABCrimson/modern-xlsx)（Rust + WASM）构建的高性能 Excel 导出库。提供声明式 API、自动模式路由、完整单元格样式、Web Worker 多线程、流式写入以及 SheetJS 降级保底。

## 性能参考

modern-xlsx@1.2.0，Node v22.22.2，4 列混合类型，独立进程首次实测（来源：[设计文档 1.2/附录 A](../../docs/excel-export-design.md)）：

| 数据量  | Workbook 路径 | Stream 路径 | auto 路由         |
| ------- | ------------- | ----------- | ----------------- |
| 1 万行  | 109ms         | 184ms       | Worker + Workbook |
| 5 万行  | 618ms         | 824ms       | Worker + Stream   |
| 10 万行 | 17,541ms ⚠️   | **1,548ms** | Worker + Stream   |

> `Workbook.toBuffer()` 在 ~5.5 万行开始超线性塌方（10 万行耗时 17 秒）。`StreamingXlsxWriter` 恒定 ~1.5 秒。`STREAM_THRESHOLD=50_000` 确保了安全余量。

## 安装

```bash
pnpm add @marcusok/excel-exporter modern-xlsx
```

环境：Node >= 22、pnpm >= 9。modern-xlsx@1.2.0 声明 `engines.node>=24`，但其 WASM 核心面向浏览器；本包在 Node 22 下 35 个测试全部通过。本包在 1.2.0 上开发测试，推荐消费方锁定此版本（peerDep 兼容范围 `^1.2.0`，但未验证更高版本）。

> modern-xlsx 声明为 `peerDependency`，消费方必须显式安装。原因：(1) `modern-xlsx.wasm`（1.9MB）需由消费方作为静态资源部署，隐式依赖会掩盖这一硬性要求；(2) peerDep 语义上正确——本包是 modern-xlsx 的封装，版本控制权在消费方；(3) pnpm 默认不自动安装 peerDep。`xlsx`（SheetJS）为 optional peerDep，仅在需要降级保底时安装。

## 配置（浏览器）

两份静态资源必须在消费方站点可访问：`modern-xlsx.wasm`（1.9MB）和 `export.worker.js`。

推荐 Vite 插件在 `buildStart` 中从 `require.resolve` 反推真实路径拷贝到 `public/assets/`，避免硬编码 `node_modules`（pnpm 符号链接不兼容）。详见 [设计文档 6.2](../../docs/excel-export-design.md)。

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

```ts
// main.ts
import { configureWasm } from "@marcusok/excel-exporter";
configureWasm({
  wasmUrl: "/assets/modern-xlsx.wasm",
  workerUrl: "/assets/export.worker.js",
});
```

## 用法

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
        {
          key: "amount",
          header: "金额",
          width: 12,
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
      data: [{ orderId: "ORD-001", amount: 9999.99, status: "paid" }],
    },
  ],
});
```

### 自动路由

`index.ts` 的 `pickMode()` 根据数据量自动选择最优路径（可通过 `mode` 参数覆盖）：

| 数据量        | 浏览器            | Node/SSR |
| ------------- | ----------------- | -------- |
| < 500 行      | main              | main     |
| 500–49,999 行 | Worker + Workbook | main     |
| >= 50,000 行  | Worker + Stream   | stream   |

Worker 路径的主线程只做一次结构化克隆 `postMessage`（10 万行 ~94ms），WASM 工作在 Worker 线程执行。Workbook 路径支持完整 `CellStyle`；Stream v1 不支持 `StyleBuilder` 样式（Phase 2 规划中）。

### 样式预设

[`src/style-presets.ts`](./src/style-presets.ts) 提供 7 种预设：`header`（粗体/深蓝底白字）、`currency`（千分位/两位小数）、`date`/`datetime`、`percent`、`dataRow`（左对齐/底部淡灰线）、`danger`（红色粗体）。支持自定义 `CellStyle`（字体/填充色/对齐/边框/数字格式），颜色用 6 位 RGB hex（如 `'FF0000'`）。

### 值格式化

[`src/types.ts`](./src/types.ts)。Worker 模式受结构化克隆限制不能传函数，提供声明式 `FormatSpec`：

| 类型       | 示例                                                          | 说明             |
| ---------- | ------------------------------------------------------------- | ---------------- |
| `enum`     | `{ type: "enum", map: { paid: "已支付" }, fallback: "未知" }` | 枚举映射         |
| `number`   | `{ type: "number", decimals: 2, thousands: true }`            | 数字精度与千分位 |
| `date`     | `{ type: "date", pattern: "yyyy/MM/dd" }`                     | 日期序列化       |
| `datetime` | `{ type: "datetime", pattern: "yyyy-MM-dd HH:mm:ss" }`        | 日期时间序列化   |
| `padding`  | `{ type: "padding", fill: "0", length: 6, align: "left" }`    | 字符串补齐       |

`main` 模式额外支持函数形式：`format: (v) => v ? "是" : "否"`。

### 降级保底

WASM 不支持或加载失败时自动降级 SheetJS（[`src/fallback.ts`](./src/fallback.ts)）。降级导出无样式，但保证数据可用。`ExportResult.engine` 标记 `'sheetjs'` 便于监控降级率。

## API

- `exportExcel(options)` — 统一入口，自动路由。
- `configureWasm(opts)` — 设置 `wasmUrl`/`workerUrl`/`timeoutMs`/`maxRetries`。
- `onPhase(phase, durationMs)`（`exportExcel` 选项）— 阶段耗时回调：`init`（WASM 初始化）/ `build`（工作簿构建）/ `download`（触发下载），每阶段完成时上报一次毫秒数，供指标面板做阶段分解；不影响返回结果里的 `duration`。
- `WorkbookBuilder` — 批量构建器（<5 万行，完整样式）。
- `exportAsStream(sheets)` — 流式导出（>=5 万行）。
- `StylePresets` — 七种预设样式。
- `exportInWorker` / `terminateWorker`（`@marcusok/excel-exporter/worker-utils`，源码入口 `src/worker-exporter.ts`） — 手动 Worker 生命周期控制。

## Node 用法

Node 无 Web Worker，auto 路由退化为 main（<5 万行）或 stream（>=5 万行）在主线程执行。

以下代码仅在测试环境需要（`exportExcel()` 在生产代码中会自动加载 WASM，无需手动调用）。Node 的 `fetch` 拒绝 `file://` 协议，vitest 等测试框架需通过 `initWasmSync` 同步加载：

```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initWasmSync } from "modern-xlsx";
const require = createRequire(import.meta.url);
initWasmSync(
  readFileSync(
    `${require("path").dirname(require.resolve("modern-xlsx"))}/modern-xlsx.wasm`,
  ),
);
```

Node 版本：本包 `engines.node >=22`，CI 跑 Node 22。peer modern-xlsx 声明 `>=24`，但 WASM 核心面向浏览器，Node 22 全绿。

## 设计决策摘要

- **5 万行割点**：toBuffer 在 5.5–6 万行塌方。`STREAM_THRESHOLD=50_000`（分支 `>=`），<5 万行 Workbook（完整样式、更快），>=5 万行 stream。
- **Worker 阈值 500 行**：1 万行 10 列 main 实测 263ms 全阻塞。500 行以下 <15ms 可接受。
- **ESM-only**：modern-xlsx 仅导出 ESM，本包不提供 CJS。
- **format 的 Worker 兼容**：函数无法跨结构化克隆。Worker/Stream 仅接受 `FormatSpec`，`exportInWorker` 剥离函数格式。
- **Stream v1 无样式**：`StreamingXlsxWriter` 不支持 `StyleBuilder`。`width`/`freezeRows` 等在 stream 下仅 warn 后丢弃。
- **并发安全**：Worker 通信用 requestId 路由 + `pending: Map`，`onmessage` 只注册一次。

## License

MIT
