# Worker 与流式

## Worker 多线程（≥ 500 行）

浏览器中数据量 ≥ 500 行时，`auto` 会选择 Worker 路径：主线程只做一次结构化克隆（10 万行约 94ms），WASM 加载与构建全部在 Worker 内执行，页面不卡顿。

```ts
configureWasm({ workerUrl: "/assets/export.worker.js" });
```

Worker 路径行为：

- **必须配置 `workerUrl`**，否则抛出明确错误；
- Worker 实例复用，请求按 `requestId` 并发分发，多次导出互不串扰；
- **函数形式的 format 会被剥离**（结构化克隆无法传递函数）——worker 路径请使用 FormatSpec；
- `onProgress` / `onPhase`（`init` / `build`）会从 Worker 转发回主线程。

## 流式写入（≥ 50,000 行）

`StreamingXlsxWriter` 以流式写行，恒定内存，10 万行约 1.5s（对比 Workbook 路径 17.5s）。`auto` 在 ≥ 5 万行时自动选择它。

Stream 路径的已知限制（v1）：

| 特性                     | Stream 路径                        |
| ------------------------ | ---------------------------------- |
| 单元格样式（`style`）    | ❌ 不支持                          |
| 列宽（`width`）          | ❌ 不支持                          |
| 冻结行 / 自动筛选 / 合并 | ❌ 不支持                          |
| 自定义数字格式           | ❌ 不支持（`decimals` 烧入存储值） |
| 日期格式                 | ✅ 按 pattern 输出可读字符串       |
| 进度回调                 | ✅ 每 1000 行上报一次              |

被跳过的布局特性会在 console 打印 `[excel-exporter] stream mode: layout features not supported (...)` 警告。

## 什么时候该用哪个

| 需求                     | 推荐路径                                |
| ------------------------ | --------------------------------------- |
| ≤ 5 万行且需要完整样式   | `auto`（main / worker + Workbook）      |
| > 5 万行，样式可接受降级 | `auto`（worker + Stream），浏览器不卡顿 |
| Node 服务端大批量        | `auto`（main → ≥ 5 万行 stream）        |
| 对主线程零阻塞有强要求   | 显式 `mode: "worker"`                   |

## 直接使用底层 API

库同时导出 `WorkbookBuilder` 与 `exportAsStream`，可在复杂场景下精细控制：

```ts
import { WorkbookBuilder, exportAsStream } from "@marcusok/excel-exporter";

// 批量化构建
const builder = await WorkbookBuilder.create();
builder.addSheet(sheetA).addSheet(sheetB);
const bytes = await builder.toBuffer();

// 流式导出
const { bytes, rowCount } = await exportAsStream(sheets, onProgress);
```
