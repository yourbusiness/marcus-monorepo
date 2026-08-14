# 常见问题

### 浏览器报 WASM 404

`modern-xlsx.wasm` 没有部署到站点可访问路径。按 [快速开始](/guide/01-getting-started) 中的 Vite 插件把 wasm 拷贝到 `public/assets/`，并确保 `configureWasm({ wasmUrl })` 指向正确地址。

### Worker 模式报 "workerUrl not configured"

`export.worker.js` 需要显式配置并部署：

```ts
configureWasm({
  workerUrl: "/assets/export.worker.js",
});
```

只有浏览器中的 `worker` / `auto`（数据量 ≥ 20,000 行）路径需要它。

### 导出结果里 engine 是 "sheetjs"

说明 WASM 路径加载失败或环境不支持，已自动降级到 SheetJS 兜底（样式会被剥离）。查看浏览器 console 中的 `[excel-exporter]` 前缀警告可定位原因，常见是 wasm URL 404 或 CDN/网络受限。详见 [兜底机制](/packages/excel-exporter/guide/08-fallback)。

### 10 万行数据导出非常慢（>15s）

大概率走了 `main` + `Workbook.toBuffer()` 路径——该路径在 ~5.5 万行后出现性能断崖。把 `mode` 保持为 `auto`，或显式指定 `mode: "stream"` / `mode: "worker"`。详见 [自动模式路由](/packages/excel-exporter/guide/03-auto-mode)。

### Stream 模式下样式不生效

Stream 路径 v1 不支持单元格样式与列宽/冻结/筛选/合并等布局特性（会在 console 打印警告）。需要完整样式时，控制在 5 万行以内走 Workbook 路径。详见 [Worker 与流式](/packages/excel-exporter/guide/06-worker-stream)。

### 导出是本地完成的吗？

是。所有处理都在浏览器/Node 进程内完成，不上传任何业务数据。

### 日期显示成数字序列

日期列需要声明 `format: { type: "date" }`（或 `datetime`），Workbook 路径会自动注入对应 `numFormat`，否则单元格会显示日期序列值。
