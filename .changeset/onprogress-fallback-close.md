---
"@marcusok/excel-exporter": patch
---

修复 onProgress 兜底契约与 sharedStrings `count` 规范偏差：

- `onProgress` 的收尾 `1` 此前只在成功路径由 `exportExcel` 上报，三条 SheetJS 兜底路径（WASM 不支持早退、主线程构建失败降级、Worker 失败/抛错降级）均不上报，早退路径连起始 `0` 也不上报，与 `types.ts`「final 1 由 `exportExcel` 恰好上报一次」的契约不符。现 `exportExcel` 在入口统一上报 `0`，兜底调用统一经 `.finally` 收尾 `1`（兜底自身失败也收尾），任何路径下回调序列均为 `0 → … → 1` 各一次，进度 UI 可确定性关闭。
- fast-xlsx 的 `xl/sharedStrings.xml` 原把 `count` 与 `uniqueCount` 同填去重数；按 ECMA-376，`count` 应为含重复的总字符串引用数。现按实际引用计数填写（Excel 等读取器原本也容忍该偏差，属规范正确性修正）。
- 清理 `PERF_TIGHT` 残留：性能基准的 `SLACK` 恒等式（两分支同为 1.0）改为直赋 `1.0` 并修正注释；`turbo.json` `globalEnv` 移除无效的 `PERF_TIGHT` 声明。
- 新增两个回归用例（兜底路径进度收尾、sst count/uniqueCount 规范），测试数 52 → 54（CI 跳过 4 个性能基准后实跑 50）。
