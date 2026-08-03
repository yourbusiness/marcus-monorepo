# @marcusok/excel-exporter

基于 [modern-xlsx](https://github.com/ABCrimson/modern-xlsx)（Rust + WASM）构建的高性能 Excel 导出库：声明式 API、自动模式路由、完整单元格样式、Web Worker 多线程、流式写入，以及 SheetJS 降级兜底。

## 能力清单

| 能力           | 说明                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| 声明式 API     | 用 `sheets + columns + data` 描述导出，无需手写单元格                  |
| 自动模式路由   | `auto` 按数据量选择 main / worker / stream（阈值 500 / 50,000 行）     |
| 完整单元格样式 | 字体、填充、对齐、边框、数字格式；内置 7 种 `StylePresets`             |
| 值格式化       | `FormatSpec` 声明式格式化（enum / date / datetime / number / padding） |
| Worker 多线程  | 主线程仅一次结构化克隆，WASM 在 Worker 内执行                          |
| 流式写入       | `StreamingXlsxWriter` 恒定内存，10 万行 ~1.5s                          |
| 多级兜底       | WASM 不可用时自动降级 SheetJS（样式剥离），保证可导出                  |
| 进度/阶段回调  | `onProgress`、`onPhase` 便于可视化与埋点                               |

## 安装

```bash
pnpm add @marcusok/excel-exporter modern-xlsx
```

浏览器环境还需部署 `modern-xlsx.wasm` 与 `export.worker.js` 并调用 `configureWasm`，详见 [快速开始](/guide/01-getting-started)。

## 快速上手

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

await exportExcel({
  filename: "sales-report",
  sheets: [
    {
      name: "Sales",
      freezeRows: 1,
      autoFilter: true,
      columns: [
        { key: "orderId", header: "订单号", width: 18 },
        {
          key: "amount",
          header: "金额",
          width: 14,
          style: StylePresets.currency,
        },
      ],
      data: [{ orderId: "ORD-001", amount: 9999.99 }],
    },
  ],
});
```

## 文档目录

- **指南**：安装配置、自动模式、样式、格式化、高级特性、Worker/流式、兜底、Node/SSR、性能
- **使用案例**：销售月报、库存台账、大文件导出、多 Sheet 工作簿（含 mock 数据预览）
- **API 参考**：入口函数、类型定义、样式预设、FormatSpec

## 版本与依赖

- 当前版本：以 npm registry 为准（文档站首页包卡片会从工作区 `package.json` 自动读取）
- peerDependencies：`modern-xlsx@^1.2.0`（必装）、`xlsx@>=0.18.5`（可选，兜底）
- 环境：Node >= 22；浏览器需支持 WebAssembly

> 性能数字来自仓库设计文档中的独立进程实测（Node v22.22.2、modern-xlsx@1.2.0），详见 [性能参考](/packages/excel-exporter/guide/07-performance)。
