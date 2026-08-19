---
"@marcusok/excel-exporter": patch
---

README 修正函数形式 `format` 的适用范围表述：

- 原「`main` 模式额外支持函数形式」与设计决策摘要「Worker/Stream 仅接受 `FormatSpec`」均不完整：Node 的 stream 路径在主线程执行，函数同样生效；会剥离函数的只有浏览器 Worker 路径（含 Worker 内执行的 stream）。
- 同步修正文档站 FAQ 的日期条目（按 Workbook / stream·SheetJS 兜底路径分述默认文本形态）与基准图 caption（注明 6 列测量口径与在线演示 9 列数据集不可直接对照）。
