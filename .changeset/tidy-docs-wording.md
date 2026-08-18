---
"@marcusok/excel-exporter": patch
---

文档与包元数据措辞修正：

- `package.json` description 移除 "High-performance" 营销化措辞，改为事实性描述（与 1.0.4 清理 README 同类措辞的决定对齐）。
- README 修正测试数量为当前实际值（共 52 个用例，CI 跳过 4 个性能基准后实跑 48 个；此前写的 47/43 已漂移）。
- README 环境要求澄清：`pnpm >= 9` 是本仓库的开发环境要求，不是消费方的安装要求。
