---
"@marcusok/excel-exporter": patch
---

跨路径一致性修复：

- `date` / `datetime` 统一按 **UTC 分量**解释：Stream/SheetJS 路径的 pattern 字符串此前取本地分量，与 Workbook 路径 `dateToSerial`（UTC 口径）相反，非 UTC 时区下同一输入在 5 万行阈值两侧（或降级前后）可能相差一天。现两条路径在任何时区输出一致；日期列建议传 ISO 字符串或用 `Date.UTC(...)` 构造（见文档「值格式化」的时区约定）。
- WASM 加载失败（error 态）后，任意 `configureWasm()` 调用都会清除错误态并在下次导出时按新配置重试（此前仅 `wasmUrl` 变化才会重置，错误信息建议的重试方式实际不可行）。
- stream 路径不再在内部重复上报最终进度 `1`，由 `exportExcel` 统一收尾（回调序列 0 → 分段 → 1 各一次）。
- 新增 `wasm-loader.test.ts` 与日期跨路径一致性回归用例；`types.ts` 补日期输入契约与 `onProgress` 精确语义。
