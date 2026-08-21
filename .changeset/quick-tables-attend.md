---
"@marcusok/excel-exporter": minor
---

feat: 支持多级表头与单元格合并

- `ColumnConfig` 新增 `children`：列可组成树形结构，生成多行表头。分组表头格自动跨其全部叶子列合并，叶子表头格纵向跨满剩余表头行，无需手工计算合并范围。
- 多级表头与合并（含表头合并）在 Workbook / Fast stream / SheetJS 兜底三条路径均可用；数据区 `merges` 的相对偏移随表头行数自适应，扁平列配置的输出与旧版逐字节一致。
- `exportTable` 支持 Ant Design / Element Plus 的 `children` 分组列。
