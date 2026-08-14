---
"@marcusok/excel-exporter": patch
---

大文件导出切换为自研 Fast stream（fflate minimal OOXML），修复浏览器 Worker 回调克隆失败导致降级 SheetJS 的问题，并将 10 万行导出耗时降至 1000ms 以内。
