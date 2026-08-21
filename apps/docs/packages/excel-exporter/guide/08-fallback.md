# 兜底机制（SheetJS）

当 WASM 路径不可用时，库会自动降级到 SheetJS 兜底，多数异常下仍能拿到导出文件（例外见下方触发条件末条）。

## 触发条件

- 环境不支持 `WebAssembly`（仅影响 main 与 Worker + Workbook 路径；≥ 50,000 行的 stream 路径不依赖 WASM，不受此条影响）；
- `modern-xlsx.wasm` 加载失败（共尝试 `maxRetries` 次后仍失败，默认 3 次含首次）；
- Worker 路径初始化失败（如 workerUrl 404）；
- 构建阶段抛错（如 modern-xlsx 构建期内部错误）。注意：非法工作表名不在此列——兜底路径会再次校验同一表名并失败，最终返回 `success: false`，无法被兜底救回。

## 行为差异

| 维度                  | modern-xlsx 路径 | SheetJS 兜底                                                                           |
| --------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `ExportResult.engine` | `"modern-xlsx"`  | `"sheetjs"`                                                                            |
| 单元格样式            | 完整             | 剥离（SheetJS CE 不支持样式写入）                                                      |
| 多行表头 / 合并       | 支持             | 支持（合并不是样式，SheetJS 可写）                                                     |
| 列宽/冻结/筛选        | 支持             | 不支持                                                                                 |
| FormatSpec            | 支持             | 支持（enum/padding/number/date 语义保留，日期输出为可读字符串）                        |
| 数字格式              | `numFormat`      | `decimals` 烧入存储值                                                                  |
| 警告                  | —                | console 打印 `[excel-exporter] Falling back to SheetJS (styles stripped). Reason: ...` |

## SheetJS 从哪来

1. 优先加载消费方安装的 `xlsx`（可选 peerDependency，`>= 0.18.5`）；
2. 未安装时，动态从 SheetJS 官方 CDN 加载 `xlsx.mjs`（0.20.3）。

> 生产环境建议显式安装 `xlsx` 并自行托管，避免运行时依赖第三方 CDN。

## 如何感知兜底

```ts
const result = await exportExcel(options);
if (result.engine === "sheetjs") {
  // 提示用户：当前导出为兼容模式，样式可能被剥离
}
```

兜底不是常规路径，而是异常时的保险。出现兜底请优先排查 wasm URL 是否 404、`configureWasm` 是否在导出前调用。
