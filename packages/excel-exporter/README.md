# @marcusok/excel-exporter · Excel 导出引擎

基于 [modern-xlsx](https://github.com/ABCrimson/modern-xlsx)（WASM）与自研 Fast stream 构建的 Excel 导出库。提供声明式 API、自动模式路由、完整单元格样式、Web Worker 多线程、快速写入以及 SheetJS 降级兜底。

> 📖 **在线文档**：https://yourbusiness.github.io/marcus-monorepo/packages/excel-exporter/

## 性能参考

本机实测（真实 Chrome，6 列混合类型；Node 独立进程回归测试用 4 列精简列集，见 `src/__tests__/performance.test.ts`）：

| 数据量  | auto 路由   | 实测耗时 | 硬性要求 |
| ------- | ----------- | -------- | -------- |
| 1 万行  | Workbook    | ~120ms   | < 200ms  |
| 5 万行  | Fast stream | ~400ms   | < 500ms  |
| 10 万行 | Fast stream | ~780ms   | < 1000ms |

> 大文件路径不再依赖 `modern-xlsx` 的 `StreamingXlsxWriter`，而是用 `fflate` 同步压缩一个 minimal OOXML 工作簿。它在 100k×6 列场景下约 0.8s，且避开 `Workbook.toBuffer()` 在 5.5 万行后的超线性塌方。

## 安装

```bash
pnpm add @marcusok/excel-exporter modern-xlsx
```

环境：Node >= 22、pnpm >= 9。modern-xlsx@1.2.0 声明 `engines.node>=24`，但其 WASM 核心面向浏览器；本包在 Node 22 下测试全部通过（共 47 个用例；CI 默认 `RUN_PERF=0` 跳过 4 个性能基准，实跑 43 个）。本包在 1.2.0 上开发测试，推荐消费方锁定此版本（peerDep 兼容范围 `^1.2.0`，但未验证更高版本）。

> modern-xlsx 声明为 `peerDependency`，消费方必须显式安装。原因：(1) `modern-xlsx.wasm`（1.9MB）需由消费方作为静态资源部署，隐式依赖会掩盖这一硬性要求；(2) peerDep 语义上正确——本包是 modern-xlsx 的封装，版本控制权在消费方；(3) 包管理器默认会自动安装 peerDependency（npm 7+ / pnpm 8+ 起），隐式装上的版本不受消费方掌控，显式声明才能锁定版本意图。`xlsx`（SheetJS）为 optional peerDep，仅在需要降级兜底时安装。

## 配置（浏览器）

两份静态资源必须在消费方站点可访问：`modern-xlsx.wasm`（1.9MB）和 `export.worker.js`。

推荐 Vite 插件在 `buildStart` 中从 `require.resolve` 反推真实路径拷贝到 `public/assets/`，避免硬编码 `node_modules`（pnpm 符号链接不兼容）。详见 [设计文档 6.2](https://github.com/yourbusiness/marcus-monorepo/blob/main/docs/excel-export-design.md)。

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

| 数据量           | 浏览器               | Node/SSR |
| ---------------- | -------------------- | -------- |
| < 20,000 行      | main                 | main     |
| 20,000–49,999 行 | Worker + Workbook    | main     |
| >= 50,000 行     | Worker + Fast stream | stream   |

Worker 路径的主线程只做一次结构化克隆 `postMessage`（10 万行 ~94ms），导出工作在 Worker 线程执行。Workbook 路径支持完整 `CellStyle`；Fast stream 与原先的 stream 一样不支持 `StyleBuilder`/布局样式，`width`/`freezeRows` 等仅 warn 后丢弃。

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

### 降级兜底

WASM 不支持或加载失败时自动降级 SheetJS（[`src/fallback.ts`](./src/fallback.ts)），降级导出不带样式；`ExportResult.engine` 标记 `'sheetjs'` 便于监控降级率。

## API

- `exportExcel(options)` — 统一入口，自动路由。
- `configureWasm(opts)` — 设置 `wasmUrl`/`workerUrl`/`timeoutMs`/`maxRetries`。
- `onPhase(phase, durationMs)`（`exportExcel` 选项）— 阶段耗时回调：`init`（WASM 初始化）/ `build`（工作簿构建）/ `download`（触发下载），每阶段完成时上报一次毫秒数，供指标面板做阶段分解；不影响返回结果里的 `duration`。
- `WorkbookBuilder` — 批量构建器（<5 万行，完整样式）。
- `exportAsStream(sheets)` — 大文件导出（>=5 万行）。
- `exportTable(options)` — 常见表格数据便捷导出，支持 AntD `title`/`dataIndex` 与 Element Plus `label`/`prop` 命名。
- `exportEcharts(options)` — 常见 ECharts 数据便捷导出，支持类目轴多系列、饼图 `name/value`、散点 `[x,y]`。
- `StylePresets` — 七种预设样式。
- `headerStyle` — `SheetConfig` 与 `ColumnConfig` 均支持，用于设置表头单元格样式。
- `exportInWorker` / `terminateWorker`（`@marcusok/excel-exporter/worker-utils`，源码入口 `src/worker-exporter.ts`） — 手动 Worker 生命周期控制。

## Node 用法

Node 无 Web Worker，auto 路由退化为 main（<5 万行）或 stream（>=5 万行）在主线程执行。

Node 的 `fetch` 拒绝 `file://` 协议，因此 **Node 直连本地包时不能仅依赖 `exportExcel()` 自动加载 WASM**。生产服务端需要先显式初始化 WASM（`initWasmSync`），或通过 `configureWasm({ wasmUrl })` 提供一个可 fetch 的 HTTP URL：

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

- **5 万行割点**：`STREAM_THRESHOLD=50_000`（分支 `>=`），<5 万行 Workbook（完整样式），>=5 万行 Fast stream。
- **Worker 阈值 20,000 行**：小于 2 万行走 main（10k×6 列浏览器实测约 120ms）；2 万行以上走 Worker，避免主线程长阻塞。
- **ESM-only**：modern-xlsx 仅导出 ESM，本包不提供 CJS。
- **format 的 Worker 兼容**：函数无法跨结构化克隆。Worker/Stream 仅接受 `FormatSpec`，`exportInWorker` 剥离函数格式。
- **Fast stream 无样式**：大文件路径输出 minimal OOXML，不支持 `StyleBuilder`。`width`/`freezeRows` 等在 stream 下仅 warn 后丢弃。
- **并发安全**：Worker 通信用 requestId 路由 + `pending: Map`，`onmessage` 只注册一次。

## License

MIT
