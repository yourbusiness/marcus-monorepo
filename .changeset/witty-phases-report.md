---
"@marcusok/excel-exporter": minor
---

feat: `exportExcel` 新增 `onPhase` 阶段耗时回调（`init` / `build` / `download`），
每个阶段完成时上报实际毫秒数，便于 playground 指标面板展示下载链路的分阶段耗时。
