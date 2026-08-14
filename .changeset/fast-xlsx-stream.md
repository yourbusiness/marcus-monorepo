---
"@marcusok/excel-exporter": patch
---

大文件导出路径切换为 fflate-based fast-xlsx，10 万行 4 列首次导出从约 1.5s 降至约 600ms，恢复 5 万行 <500ms / 10 万行 <1000ms 硬性指标。
