# API：exportExcel 与配置

## exportExcel

```ts
exportExcel(options: ExportOptions): Promise<ExportResult>
```

核心入口函数（`exportTable` / `exportEcharts` 等便捷封装最终都委托给它）。根据数据量与环境自动路由到 main / worker / stream，WASM 不可用时降级 SheetJS。

## ExportOptions

| 字段         | 类型                                               | 必填 | 说明                                                                                                                                        |
| ------------ | -------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `sheets`     | `SheetConfig[]`                                    | 是   | 工作表配置，至少一个                                                                                                                        |
| `filename`   | `string`                                           | 是   | 下载文件名，不以 `.xlsx` 结尾时末尾自动追加                                                                                                 |
| `mode`       | `"auto" \| "main" \| "worker" \| "stream"`         | —    | 默认 `"auto"`，按行数自动路由                                                                                                               |
| `onProgress` | `(progress: number) => void`                       | —    | 0 → 1；首尾 0 与 1 由 `exportExcel` 在所有路径各上报一次（含 SheetJS 兜底与最终失败的导出）；分段进度仅 stream 路径有（每 1000 行上报一次） |
| `onPhase`    | `(phase: ExportPhase, durationMs: number) => void` | —    | `init` / `build` / `download` 阶段耗时                                                                                                      |
| `download`   | `boolean`                                          | —    | 默认 `true` 触发浏览器下载；`false` 只返回 Blob                                                                                             |

## ExportResult

| 字段        | 类型                         | 说明                         |
| ----------- | ---------------------------- | ---------------------------- |
| `success`   | `boolean`                    | 是否成功                     |
| `blob?`     | `Blob`                       | 导出文件内容                 |
| `engine?`   | `"modern-xlsx" \| "sheetjs"` | 实际使用的引擎               |
| `mode?`     | `ExportMode`                 | 实际使用的模式               |
| `duration?` | `number`                     | 完整导出耗时（ms）           |
| `rowCount?` | `number`                     | 导出行数                     |
| `error?`    | `Error`                      | 失败原因（兜底路径也会返回） |

## configureWasm

```ts
configureWasm(options: LoaderOptions): void
```

| 字段         | 默认值   | 说明                                                    |
| ------------ | -------- | ------------------------------------------------------- |
| `wasmUrl`    | —        | 自托管 `modern-xlsx.wasm` 地址                          |
| `workerUrl`  | —        | `export.worker.js` 地址，worker 模式必填                |
| `timeoutMs`  | `10_000` | 单次加载超时                                            |
| `maxRetries` | `3`      | 最大加载尝试次数（默认共 3 次含首次，退避 300ms/600ms） |

## 其他导出符号

- `WorkbookBuilder.create()` + `addSheet(config)` + `toBuffer()` / `toBlob()`：批量化构建，完整样式；
- `exportAsStream(sheets, onProgress?)`：底层流式导出，返回 `Promise<{ bytes, rowCount }>`；
- `exportTable(options)`：常见表格数据便捷导出，支持 AntD `title`/`dataIndex` 与 Element Plus `label`/`prop`；
- `exportEcharts(options)`：常见 ECharts 数据便捷导出，支持类目轴多系列、饼图 `name/value`、散点 `[x,y]`；
- `getWasmLoader()`：访问全局 WASM 加载器（状态：idle / loading / ready / error）。

```ts
import {
  exportExcel,
  configureWasm,
  WorkbookBuilder,
  exportAsStream,
  exportTable,
  exportEcharts,
  getWasmLoader,
} from "@marcusok/excel-exporter";
```

> 入口还重导出了若干底层工具与类型（如 `format-utils` 的 `applyFormat` / `validateSheetName`、`LoaderOptions` / `LoadState`、`BorderStyle` 等），本文档只覆盖常用的稳定 API，完整列表见 `src/index.ts`。
