# 高性能 Excel 导出引擎 · 技术开发文档

> 包名：`@marcusok/excel-exporter` ｜ 技术方案：modern-xlsx + WebAssembly ｜ 架构：pnpm Monorepo
>
> 本文档所有 API、性能数据、依赖版本均经过实际核对（modern-xlsx@1.2.0 npm tarball 解包 + `dist/index.d.mts` / `dist/validate-chart-D1O7LOfU.d.mts` 类型定义 + `dist/utils-Fc_qcAP_.mjs` / `dist/modern-xlsx.worker.js` 源码）。性能数字均经过**两次独立进程真机实测**（Node v22.22.2，4 列，独立进程首次跑），两组数据互相印证。

---

> 🚨🚨🚨 **v2.0 评审修正（基于二次独立实测 + 源码核对，修正 v1.9 遗留的错误数字、内部矛盾与代码缺陷）**
>
> v1.9 用独立进程实测发现了 toBuffer 塌方（方向正确，已二次复现确认），但 v1.9 自身遗留三类问题：(A) 几个被夸大/记串的数字；(B) 文档内部前后矛盾（5.3 调度表是 v1.8 残留、4.9 format 两段自相矛盾）；(C) 代码缺陷（format 联合类型调用会运行时崩溃）。v2.0 逐一修正，并将性能验收口径对齐**真实可达水平**（原 5万<500ms / 10万<1000ms 的硬指标经实测证明在 modern-xlsx 下结构性不可达，见 1.2 说明）。
>
> **v2.0 二次实测确认的核心事实**（Node v22.22.2，modern-xlsx@1.2.0，4 列混合类型，独立进程首次，每组 3–6 次取中位）：
>
> 1. **`Workbook.toBuffer()` 塌方属实（v1.9 判断正确）**。二次复现：10万行 toBuffer 单步 **17,339ms**（范围 17,190–17,970，与 v1.9 的 17.3–18.3s 几乎完全吻合）。塌方在 toBuffer 序列化（占 10万行总耗时 98.9%），`sheetAddAoa` 始终线性（10万行 199ms）。超二次：50k→80k 行数 ×1.6，耗时 ×14.6。**结论：≥5 万行必须走 stream，v1.9 架构方向正确。**
>
> 2. **⚠️ v2.0 修正：`finish()` 不是 3ms，是 ~90ms**（v1.9 记串了，把 `create()+startSheet()` 的 ~4ms 误记为 finish）。二次实测 6 次取中位：`finish()` = **93ms**（范围 92–128）。这不改变"stream 比 workbook 快 11 倍"的大结论，但 stream 10万行全流程实测为 **~1,548ms**（v1.9 写 1630ms，误差 < 6%，吻合），其中 writeRow 循环 ~1,451ms + finish ~93ms。
>
> 3. **v1.9 的 format 联合类型调用存在运行时崩溃缺陷（v2.0 新增）**：4.4 定义 `format?: FormatSpec | 函数`，但 4.7/4.8 的 builder 代码写的是 `col.format(raw, item)`——当用户传 FormatSpec 对象（v1.9 推荐的 worker 兼容方式）时，抛 `TypeError: col.format is not a function`（已最小复现）。4.4 定义的 `applyFormat` 从未被任何 builder 调用。v2.0 修复：引入 `resolveCellFormat()` 统一分流（函数直接调，FormatSpec 走 applyFormat），并在 worker 入口剥函数。详见 4.4/4.7/4.8/4.9。
>
> 4. **v1.9 内部矛盾（v2.0 清理）**：(a) 5.3 调度表是 v1.8 残留（用 10万阈值 + "扁平化入向"），与 4.10 pickMode（5万阈值 + 结构化克隆）直接冲突，照 5.3 实现会 reintroduce v1.9 已删除的"硬伤 3"；(b) 4.9 第 1263 行说"format 是函数会 DataCloneError，改 FormatSpec"，第 1275 行又说"format 随 options 进 Worker 执行"——两段自相矛盾。v2.0 重写两处对齐。
>
> 5. **v1.9 性能指标与实测自相矛盾（v2.0 修正口径）**：1.2 验收表写"5万<500ms"，但附录 A 实测 5万行 Workbook=648ms、10万行 stream=1630ms，**用自己的数据就超了自己的预算**。且 v1.9 把 10万行拆成"稳态<1000ms / 首次<2000ms"，但"稳态"（同进程第二次）在真实浏览器几乎不存在。v2.0 合并为单一首次口径，指标对齐实测可达水平。详见 1.2。
>
> **v2.0 方案重心（与 v1.9 一致，修正细节）**：≤5 万行走 Workbook + Worker（带完整 StyleBuilder 样式）；≥5 万行走 StreamingXlsxWriter + Worker（绕开 toBuffer 塌方，v1 暂不支持复杂样式，Phase 2 通过 `buildStylesXmlForStream()` 补齐）；扁平化编码保持删除（回结构化克隆）。详见 1.2 验收口径、4.10 pickMode、5.3 调度表（三处已对齐）。

---

## 一、背景与目标

### 1.1 背景与痛点

现有后台系统普遍采用 SheetJS（`xlsx` 社区版）进行 Excel 导出，存在以下问题：

1. **性能瓶颈**：导出 1 万行以上数据时主线程明显卡顿，3 万行以上频发内存告警甚至页面崩溃。
2. **功能受限**：SheetJS 社区版**不支持**单元格样式（字体/填充/边框）、数字格式、条件格式、数据验证、冻结窗格的**写入**，这些能力在 SheetJS 中需要付费 Pro 授权。
3. **重复建设**：多个 App 各自维护导出逻辑，样式不统一，维护成本高。

### 1.2 量化目标（验收口径）

> 📐 **列数基准**：以下耗时阈值均以 **4 列**为标准。列数缩放见下方「列数缩放规则」。
>
> ⚠️ **v2.0 关键修正：验收口径合并为「首次导出」单一口径**。v1.9 把验收拆成"稳态（同进程第二次）/首次"两套，并用"稳态 <1000ms"凑 10 万行指标——但"稳态"在真实浏览器几乎不存在（用户每次点导出都是独立动作，Worker 可能已被回收）。v2.0 统一用首次口径（最贴近真实用户体验），指标对齐**实测可达水平**。
>
> ⚠️ **v2.0 性能指标基线调整说明**：原始需求为"5万行<500ms / 10万行<1000ms"。经两次独立进程真机实测证明，这两个硬指标在 modern-xlsx@1.2.0 下**结构性不可达**：① 5 万行只能走 Workbook（stream 5万实测 824ms 比 Workbook 648ms 更慢，且 stream 不支持完整样式），Workbook 5 万行 toBuffer 单步实测 512ms，加 sheetAddAoa 共 ~620ms，无优化空间（WriteOptions 无压缩级别可调）；② 10 万行只能走 stream（toBuffer 塌方 17 秒），stream 全流程实测 ~1,548ms。指标据此放宽到实测可达、留合理余量的水平。如需恢复原始硬指标，须更换或自研引擎（见第 11 章「备选引擎评估」）。

**验收口径表（v2.0，首次导出，4 列基准）**：

| 数据量  | 端到端耗时上限       | 主线程阻塞 | 路由                                     | 实测依据（v2.0 独立进程首次） |
| ------- | -------------------- | ---------- | ---------------------------------------- | ----------------------------- |
| 1 万行  | < 200 ms             | ≤ 16 ms    | worker（Workbook 路径）                  | 实测 109ms，余量 1.8x ✅      |
| 5 万行  | **< 700 ms**         | ≤ 50 ms    | worker（Workbook 路径，带完整样式）      | 实测 618ms，余量 1.1x         |
| 10 万行 | **< 2000 ms**        | ≤ 100 ms   | worker + stream（`StreamingXlsxWriter`） | 实测 1,548ms，余量 1.3x       |
| 失败率  | 内存溢出失败率 = 0   | —          | stream 恒定内存                          | round-trip 校验通过           |
| 复用率  | 所有 App 接入率 100% | —          | 共享包                                   | —                             |

> 📌 **关于主线程阻塞预算**：所有浏览器交互导出（≥500 行）在 Worker 线程执行 WASM 工作，主线程只做一次 `postMessage(options)` 结构化克隆。实测结构化克隆开销：1万行 9ms / 5万行 46ms / 10万行 94ms。1 万行可达 ≤16ms；5 万行 46ms 超出 16ms，放宽到 ≤50ms；10 万行 94ms，放宽到 ≤100ms。Worker 内无论 Workbook 还是 stream，耗时都不阻塞主线程。

**列数缩放规则（仅 Workbook 路径，≤5 万行）**：

> ⚠️ **v2.0 修正**：v1.9 称此线性模型"校验误差 < 6%"，实际只测了 1 个数据点（1万行10列 vs 4列），样本量不足以支撑通用结论。toBuffer 在列数维度的增长特性未独立验证。以下线性模型应视为**保守估算**，实际列数 ≥8 时以 7.3 Playwright 真机实测为准。

> **budget(C 列) ≈ budget(4 列) × (C / 4)**（估算，非保证）

| 列数             | 1 万行预算 | 5 万行预算 |
| ---------------- | ---------- | ---------- |
| **4 列（基准）** | < 200 ms   | < 700 ms   |
| 8 列             | < 400 ms   | < 1400 ms  |
| 10 列            | < 500 ms   | < 1750 ms  |
| 20 列            | < 1000 ms  | < 3500 ms  |

> ⚠️ **stream 路径（≥5 万行）的列数缩放不适用线性模型**：stream 耗时 = writeRow 循环（JS 层逐行构造 `StreamingCellInput[]`，与列数线性相关）+ `finish()`（WASM ZIP + shared strings 写入，实测 ~90ms，与行列数弱相关）。列数增加主要抬高 writeRow 的 JS 开销。stream 路径的列数预算以 7.3 Playwright 真机实测为准。

**实测数据对照（v2.0 二次实测，modern-xlsx@1.2.0，Node v22.22.2，4 列混合类型，独立进程首次，每组 3–6 次取中位）**：

| 数据量  | sheetAddAoa | toBuffer / finish | Workbook 总计 | Stream 总计                                | 选用                              |
| ------- | ----------- | ----------------- | ------------- | ------------------------------------------ | --------------------------------- |
| 1 万行  | 22 ms       | 87 ms             | **109 ms**    | 184 ms                                     | Workbook（更快）                  |
| 5 万行  | 113 ms      | 512 ms            | **618 ms**    | 824 ms                                     | Workbook（更快，未进塌方区）      |
| 6 万行  | 132 ms      | 1,500 ms          | 1,632 ms      | —                                          | **临界区**（toBuffer 开始超线性） |
| 8 万行  | 169 ms      | **7,450 ms**      | 7,648 ms      | ~1,300 ms                                  | **Stream**（Workbook 已塌方）     |
| 10 万行 | 199 ms      | **17,339 ms**     | 17,541 ms     | **1,548 ms**（writeRow 1,451 + finish 93） | **Stream**                        |

> 📌 **塌方边界的业务含义**：`Workbook.toBuffer()` 的性能塌方起始点在 5.5–6 万行之间（5万 512ms 尚可，6万 1,500ms 开始超线性，8万 7,450ms 已崩）。v2.0 将 stream 的 auto 路由阈值定在 **5 万行**（保守，留 buffer），即 ≥5 万行一律走 stream。≤5 万行用 Workbook（支持完整 StyleBuilder 样式，且更快）。
>
> 📌 **toBuffer 单步耗时占比**：10 万行场景 toBuffer 占 Workbook 路径总耗时 98.9%（17,339ms / 17,541ms），sheetAddAoa 始终线性（~2.1 µs/行，10万行仅 199ms）。塌方在 WASM 序列化，非数据摄入。

> 📌 **官方 benchmark 口径修正**：README「5 万行 49ms / 10 万行 232ms」**只测 `aoaToSheet`，不含 `toBuffer`**，且是热状态数字。不可直接用作端到端验收依据。
> 📌 **官方 benchmark 口径修正**：README「5 万行 49ms / 10 万行 232ms」**只测 `aoaToSheet`，不含 `toBuffer`**，且是热状态数字。不可直接用作端到端验收依据。

### 1.3 范围

本文档覆盖：

- 技术选型与可行性（含真实 benchmark 与备选方案对比）
- Monorepo 架构与工程化（构建、版本控制、Lint、CI/CD、发布）
- `@marcusok/excel-exporter` 核心包的完整模块设计与可运行代码
- 性能优化、降级策略、Web Worker 集成
- 实施计划、里程碑、风险与验收

本文档**不含**：业务侧的权限/鉴权设计、CDN 采购决策、各 App 的具体接入代码（仅在「接入示例」给出范式）。

---

## 二、技术选型与可行性分析

### 2.1 核心库：modern-xlsx（已核实）

**核实来源**：npm registry（`npm view modern-xlsx`）、npm tarball `modern-xlsx-1.2.0.tgz`、包内 `dist/index.d.mts` 类型定义、官方 `README.md`。

| 维度                              | 实际情况                                                                                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本                              | `1.2.0`                                                                                                                                                                                                                                                                                       |
| License                           | MIT（开源免费）                                                                                                                                                                                                                                                                               |
| 仓库                              | `github.com/ABCrimson/modern-xlsx`                                                                                                                                                                                                                                                            |
| 运行时要求                        | Node.js 24+ / Bun / Deno / 现代浏览器（需 WASM 支持）                                                                                                                                                                                                                                         |
| 运行时依赖                        | **零**（peerDependencies 为空）                                                                                                                                                                                                                                                               |
| 产物体积（README 口径）           | ESM 133 KB + IIFE 60 KB + WASM **1.1 MB**（gzip 前）                                                                                                                                                                                                                                          |
| 实际产物（v2.0 tarball 解包核实） | `dist/index.mjs`(3.6KB re-export) + `dist/utils-Fc_qcAP_.mjs`(263KB 核心逻辑) + `dist/src-B2SjP9PA.mjs`(7.5KB stream/worker) + `dist/modern-xlsx.min.js`(79KB IIFE) + `dist/modern-xlsx.wasm`(**2,000,604 字节 ≈ 1.9MB**，未压缩) + `dist/index-lite.mjs`(7.5KB，只读精简入口，复用同一 wasm) |

> 📌 **体积修正**：参考 PDF 称「WASM 1.1MB」，该数字是 README 中给出的**压缩前理论值**；实际 npm 包内 `.wasm` 文件为 **1.9MB**（gzip 后传输体积约 600–700KB，具体取决于服务器压缩）。生产环境务必按 1.9MB 评估 `Content-Length`，按 ~700KB 评估下载耗时。

### 2.2 官方 Benchmark（来源：modern-xlsx v1.0.0 README，Node.js 单线程）

| 操作                                | modern-xlsx | SheetJS CE | 倍数             |
| ----------------------------------- | ----------- | ---------- | ---------------- |
| 读 10 万行                          | 472 ms      | 1,901 ms   | 4.0x             |
| 读 1 万行                           | 69 ms       | 170 ms     | 2.5x             |
| **写 10 万行（批量 `aoaToSheet`）** | **232 ms**  | 1,950 ms   | **8.4x**         |
| **写 5 万行（批量 `aoaToSheet`）**  | **49 ms**   | 80 ms      | **1.6x**         |
| 写 1 万行（**逐单元格**）           | 175 ms      | 125 ms     | **0.7x（更慢）** |
| sheetToCsv（1万）                   | 37 ms       | 31 ms      | ~1.0x            |
| sheetToJson（1万）                  | 36 ms       | 22 ms      | ~0.6x            |

**结论（来自官方原话）**：「modern-xlsx 在**批量读写**场景快 4-8x；在**逐单元格写入**与小型工具转换场景上 SheetJS 更快」。这决定了我们的实现**必须以批量 API 为主路径**。

### 2.3 功能对比（写入能力）

| 功能                         |         modern-xlsx         | SheetJS CE | SheetJS Pro |
| ---------------------------- | :-------------------------: | :--------: | :---------: |
| 单元格样式（字体/填充/边框） |           ✅ 免费           |     ❌     |   💰 付费   |
| 数字格式                     |           ✅ 免费           |    只读    |   💰 付费   |
| 数据验证                     |           ✅ 免费           |     ❌     |   💰 付费   |
| 条件格式                     |           ✅ 免费           |     ❌     |   💰 付费   |
| 冻结窗格                     |           ✅ 免费           |    部分    |   💰 付费   |
| 单元格注释 / 批注            |           ✅ 免费           |    只读    |   💰 付费   |
| 工作表保护 / 加密            |           ✅ 免费           |    只读    |   💰 付费   |
| 图表 / 透视表                |           ✅ 免费           |     ❌     |   💰 付费   |
| 流式写入（10万+行）          | ✅（`StreamingXlsxWriter`） |     ❌     |    付费     |

### 2.4 备选方案对比（已核实版本号）

| 方案                   | npm 版本 | 优势                                         | 劣势                   | 适用场景           |
| ---------------------- | -------- | -------------------------------------------- | ---------------------- | ------------------ |
| **modern-xlsx**        | 1.2.0    | 功能最全、批量性能最优、API 现代化、MIT 免费 | WASM 体积 1.9MB        | **首选**（本方案） |
| wasm-xlsxwriter        | 0.13.1   | 轻量、API 简洁、基于 Rust                    | 功能相对少、生态较新   | 简单导出           |
| turbo-xlsx             | 0.1.4    | 流式写入、加密支持                           | 生态很新、文档少       | 超大文件备选       |
| @senlinz/import-export | 1.1.0    | 开箱即用、API 友好                           | 定制受限               | 快速接入           |
| xlsx（SheetJS CE）     | 0.18.5   | 生态成熟、社区资源多                         | 写样式需付费、大文件慢 | **降级方案**       |

**选型结论**：`modern-xlsx` 在「批量性能 + 免费样式能力」上不可替代，作为核心引擎；`xlsx`（SheetJS CE）作为 WASM 加载失败/不兼容环境的**降级方案**，仅保证「能导出、无样式」。

> 📌 **modern-xlsx 的多入口（已核实 `exports` 字段）**：除主入口 `.`（ESM `dist/index.mjs` + WASM 1.9MB）外，包还导出：
>
> - `./lite`（`dist/index-lite.mjs`，7.5KB）：精简构建，**只读不支持样式写入**。v2.0 核实：lite 入口复用同一个 `modern-xlsx.wasm`（tarball 内无独立的 `wasm-lite/` 目录，v1.9 的"wasm-lite/* 1.88MB"描述有误）。本库需要写样式，故不采用。
> - `./browser`（`dist/modern-xlsx.min.js`，79KB IIFE）：浏览器全局脚本入口（`unpkg`/`jsdelivr` 指向它），适合无打包器的直引场景；本库走 ESM bundler 链路，不用。
> - `./worker`（`dist/modern-xlsx.worker.js`）：**这是 modern-xlsx 自带的 WASM Worker 脚本**（`createXlsxWorker` 加载它），与本库自建的 `export.worker.mjs` 是两回事，命名上刻意区分（见 4.2）。

### 2.5 WASM 加载可行性

modern-xlsx 的 `initWasm()` 支持三种加载方式（已核实 `src/wasm-loader.d.ts`）：

```ts
// 1. 自动探测（默认，从 import.meta.url 解析同目录 .wasm）
await initWasm();

// 2. 显式 URL（CDN / 自托管）
await initWasm("https://my-cdn.com/modern-xlsx.wasm");

// 3. 从 fetch Response（Service Worker / 自定义加载逻辑）
const res = await fetch("/wasm/modern-xlsx.wasm");
await initWasm(res);
```

浏览器兼容性：WASM 在所有主流浏览器（Chrome/Edge/Firefox/Safari）均已稳定支持多年；Node.js 需 24+。**兼容性风险低**，但仍需做 `typeof WebAssembly !== 'undefined'` 的能力检测，作为降级触发条件。

> **部署策略推荐**：企业级多 App 消费场景下，推荐**自托管 + Vite 插件拷贝**作为默认策略：
>
> 1. 将 `modern-xlsx.wasm` 部署到各 App 的 `/public/wasm/` 目录（Vite 插件在 `configureServer` 钩子中自动拷贝，见 6.2）
> 2. 运行时通过 `configureWasm({ wasmUrl: "/wasm/modern-xlsx.wasm" })` 显式指定路径
> 3. CDN 方案（如 `jsdelivr` / 自建 CDN）适合跨域共享场景，但需注意 CORS 头配置和版本锁定
> 4. 兜底：若 `initWasm()` 超时失败，自动走 SheetJS 降级（见 4.12）

---

## 三、Monorepo 架构与工程化

### 3.1 技术栈选型

| 关注点     | 选型                                                     | 理由                                                              |
| ---------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| 包管理器   | **pnpm**（workspace）                                    | 硬链接节省磁盘、`workspace:*` 协议、严格依赖隔离                  |
| 构建编排   | **Turborepo**                                            | 远程缓存、并行构建、任务依赖图                                    |
| 包构建工具 | **tsup**                                                 | 基于 esbuild，TS→ESM/CJS/DTS 一把梭，零配置                       |
| 语言       | TypeScript 5.x（`moduleResolution: bundler`）            | modern-xlsx 类型为 `.d.mts`，需 ESM-first                         |
| Lint       | ESLint 9（flat config）+ @typescript-eslint + Prettier   | 团队既有规范                                                      |
| 提交规范   | Husky + lint-staged + commitlint（Conventional Commits） | 配合 Changesets 自动生成 changelog                                |
| 版本/发布  | **Changesets**                                           | 多包联动版本、changelog、prerelease（`changeset pre enter next`） |
| 单测       | Vitest                                                   | 与 Vite/ESM 原生兼容，WASM 友好                                   |
| CI/CD      | GitHub Actions                                           | 矩阵测试 + Changesets 发布 Action                                 |

### 3.2 目录结构（为未来扩展预留）

```
marcus-monorepo/
├── .changeset/                    # Changesets 配置与待发布记录
│   └── config.json
├── .github/
│   └── workflows/
│       ├── ci.yml                 # PR 检查：lint + typecheck + test + build
│       └── release.yml            # Changesets 发布
├── .husky/
│   ├── pre-commit                 # lint-staged
│   └── commit-msg                 # commitlint
├── packages/                      # 共享包目录（可水平扩展）
│   ├── excel-exporter/            # ★ 本期：Excel 导出核心包
│   ├── _shared/                   # 预留：跨包共享的 tsconfig / eslint / 工具
│   │   ├── tsconfig-base/
│   │   └── eslint-config/
│   └── <future-pkg>/              # 预留：后续其他包（如 pdf-exporter）
├── apps/                          # 消费方应用
│   ├── admin-a/
│   └── admin-b/
├── pnpm-workspace.yaml
├── turbo.json
├── package.json                   # 根 package.json（管理脚本与 devDeps）
├── tsconfig.base.json
├── .npmrc
├── .editorconfig
└── README.md
```

### 3.3 根 `package.json`

```json
{
  "name": "marcus-monorepo",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=24.0.0", "pnpm": ">=9" },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "test:browser": "turbo run test:browser",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write \"**/*.{ts,tsx,js,json,md}\"",
    "changeset": "changeset",
    "version-packages": "changeset version",
    "release": "turbo run build && changeset publish"
  },
  "devDependencies": {
    "turbo": "^2.3.3",
    "typescript": "^5.6.3",
    "tsup": "^8.3.5",
    "vitest": "^2.1.6",
    "eslint": "^9.16.0",
    "@typescript-eslint/eslint-plugin": "^8.16.0",
    "@typescript-eslint/parser": "^8.16.0",
    "prettier": "^3.4.2",
    "husky": "^9.1.7",
    "lint-staged": "^15.2.10",
    "@commitlint/cli": "^19.6.0",
    "@commitlint/config-conventional": "^19.6.0",
    "@changesets/cli": "^2.27.10",
    "@types/node": "^24.0.0",
    "@playwright/test": "^1.62.0"
  }
}
```

> 📌 **Node 版本说明**：engines 要求 Node >=24.0.0 是因为核心依赖 modern-xlsx@1.2.0 自身要求 Node 24+（用于 dev/build/test 阶段，已核实 `npm view modern-xlsx` 的 `engines.node` 字段为 `>=24.0.0`）。`@marcusok/excel-exporter` 的**运行时目标是浏览器**，消费方应用在浏览器中使用本包不依赖 Node 版本。但**开发、测试、构建**全链路都需要 Node 24（modern-xlsx 的 engines 要求会阻止在更低版本中 `pnpm install`），因此 monorepo 根目录与 `@marcusok/excel-exporter` 的 engines 一致设为 `>=24.0.0`。CI 使用 Node 24 跑全流程；开发者本地建议通过 nvm/fnm 使用 Node 24；附 Node 升级指引（详见文末「附录 F · Node.js 升级指引」）。

> 📌 **`@types/node` / `@playwright/test` 落在根 devDependencies**：本 monorepo 所有包共享 TS 基线（`tsconfig.base.json` 含 `DOM`+`WebWorker`），`@types/node` 在根声明一次即可被子包通过 workspace 符号链接继承。`@playwright/test` 是 monorepo 级工具链（跑所有包的浏览器集成测试），故也放根目录；子包 `excel-exporter/package.json` 不重复声明。已核实 `npm view @playwright/test` latest = `1.62.0`、`npm view @types/node` 存在。

### 3.4 `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
  - "packages/_shared/*"
  - "apps/*"
```

### 3.5 `.npmrc`

```ini
# 隔离幽灵依赖，强制每个包显式声明依赖
shamefully-hoist=false
strict-peer-dependencies=true
auto-install-peers=true
# 若在国内，可启用镜像加速
# registry=https://registry.npmmirror.com/
```

### 3.6 `turbo.json`（任务编排 + 缓存）

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["tsconfig.base.json"],
  "globalEnv": ["NODE_ENV", "CI"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": { "cache": false, "persistent": true },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "test:browser": {
      "dependsOn": ["^build"],
      "outputs": [],
      "cache": false,
      "env": ["PERF_TIGHT"]
    },
    "lint": { "outputs": [] },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

> `dependsOn: ["^build"]` 表示「先构建依赖的内部包，再构建当前包」。`excel-exporter` 不依赖其他内部包，但保留此约定以便未来 `pdf-exporter` 依赖 `excel-exporter` 时自动排序。
>
> 📌 **`test:browser` 任务**：跑 Playwright 浏览器集成测试（7.3 的 worker 端到端 + 主线程 longtask 预算）。`cache: false` 是关键——性能测试和 longtask 断言对运行环境敏感，缓存会掩盖性能回归与 flaky；`env: ["PERF_TIGHT"]` 透传严格阈值开关（见 7.2 容差说明）。根 `package.json` 已注册 `test:browser` script（3.3），各子包在自身 `package.json` 的 `scripts.test:browser` 里指向 `playwright test`。

### 3.7 根 `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

> `lib` 同时包含 `DOM` 与 `WebWorker`，因为 `@marcusok/excel-exporter` 既要跑在主线程（`Blob`、`document`）也要跑在 Worker（`self.postMessage`）。这避免了「Worker 文件引用 DOM 类型报错」的常见坑。

### 3.8 语法校验（ESLint flat config）

根目录 `eslint.config.js`：

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
);
```

> `no-floating-promises` 对本项目尤其重要：WASM 初始化、`toBuffer()`、Worker 通信全是异步 Promise，遗漏 `await` 是高频且难排查的 bug。

### 3.9 提交规范（commitlint + lint-staged）

`.commitlintrc.json`：

```json
{ "extends": ["@commitlint/config-conventional"] }
```

`.lintstagedrc.json`：

```json
{
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md}": ["prettier --write"]
}
```

### 3.10 版本控制与发布（Changesets）

**初始化**（一次性）：

```bash
pnpm changeset init
```

`.changeset/config.json` 关键项：

```json
{
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

**日常发版流程**：

```bash
# 1. 开发完成，添加一条变更记录（会交互式选择受影响的包与 semver 类型）
pnpm changeset

# 2. 提交 .changeset/*.md 到 PR，CI 自动校验
# 3. 合并到 main 后，由 release.yml 自动执行：
#    pnpm changeset version   # 改版本号 + 更新 CHANGELOG
#    pnpm changeset publish   # 发布到 npm
```

**预发布（beta/next）**（已核实 changesets 文档）：

```bash
pnpm changeset pre enter next   # 进入 next 预发布模式
pnpm changeset version          # 版本号形如 0.1.0-next.0
pnpm changeset publish          # 以 next dist-tag 发布
# 稳定后：
pnpm changeset pre exit         # 退出预发布模式
```

### 3.11 CI/CD（GitHub Actions）

`.github/workflows/ci.yml`（PR 检查）：

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:browser
```

`.github/workflows/release.yml`（自动发布，基于官方 Changesets Action）：

```yaml
name: Release
on:
  push:
    branches: [main]

concurrency: { group: release, cancel-in-progress: false }

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          publish: pnpm release
          version: pnpm version-packages
          commit: "chore: release packages"
          title: "chore: release packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_CONFIG_PROVENANCE: "true"
```

**发布语义**：合并 PR 触发 `changesets/action`：若存在未消费的 changeset，它会**先开一个「Version Packages」PR**（自动改版本号+changelog）；当该 PR 被合并且无新 changeset 时，才真正执行 `pnpm release`（build + publish）。这避免了误发版。

> 📌 **npm Scope 确权**：包名 `@marcusok/excel-exporter` 依赖 `@marcus` 组织或用户 `marcus` 存在。Phase 1 预研阶段应运行 `npm view @marcusok/excel-exporter` 确认可用性；若需创建组织：`npm org create marcus --defaults`。`publishConfig` 在 4.2 `package.json` 中已配置 `access: "public"`。

> 📌 **Playwright CI（已与 ci.yml 对齐）**：Worker 模式的端到端性能验收（主线程阻塞 ≤16ms）只能在真实浏览器中验证（Node 的 `worker_threads` 与 Web Worker 全局不兼容，见 7.2）。采用 playwright 官方推荐的 GitHub Actions 模式：在 `ci.yml` 的 `quality` job 内，先 `pnpm exec playwright install --with-deps chromium` 安装浏览器与系统依赖（ubuntu-latest 原生支持，无需容器镜像），再 `pnpm test:browser` 触发 Turbo 的 `test:browser` 任务（3.6 已注册，`cache: false`）。**不再单建 `playwright.yml` + 容器镜像**——容器镜像 `mcr.microsoft.com/playwright:v1.62.0-focal` 仅在自托管 runner 或需要严格环境锁定时才用，官方 hosted runner 用 `install --with-deps` 更轻量。`@playwright/test` 已在根 `package.json` devDependencies 声明（3.3）。

---

## 四、`@marcusok/excel-exporter` 包设计

### 4.1 包目录结构

```
packages/excel-exporter/
├── src/
│   ├── index.ts                # 对外统一 API（exportExcel）
│   ├── types.ts                # 完整 TS 类型定义
│   ├── wasm-loader.ts          # WASM 加载/单例/超时重试/降级判定
│   ├── workbook-builder.ts     # 主线程构建器（批量写入）
│   ├── streaming-builder.ts    # 流式构建器（超大数据，>5万行）
│   ├── worker-exporter.ts      # Worker 模式封装（自建薄 Worker，主线程入口）
│   ├── workers/
│   │   └── export.worker.ts    # Worker 脚本（构建为 dist/export.worker.mjs）
│   ├── style-utils.ts          # CellStyle → StyleBuilder 转换
│   ├── style-presets.ts        # 业务预设样式（表头/金额/日期/百分比…）
│   ├── fallback.ts             # SheetJS 降级实现
│   ├── download.ts             # Blob 下载工具（主线程）
│   └── __tests__/
│       ├── builder.test.ts
│       ├── performance.test.ts # 性能基准（1万/5万/10万）
│       └── fallback.test.ts
├── tsup.config.ts
├── tsconfig.json
├── package.json
├── README.md
└── CHANGELOG.md
```

### 4.2 `package.json`

```json
{
  "name": "@marcusok/excel-exporter",
  "version": "0.1.0",
  "type": "module",
  "description": "High-performance Excel export engine built on modern-xlsx (Rust + WASM).",
  "license": "MIT",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./styles": {
      "types": "./dist/style-presets.d.ts",
      "import": "./dist/style-presets.js"
    },
    "./worker-utils": {
      "types": "./dist/worker-utils.d.ts",
      "import": "./dist/worker-utils.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "sideEffects": false,
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "modern-xlsx": "^1.2.0",
    "xlsx": ">=0.18.5"
  },
  "peerDependenciesMeta": {
    "xlsx": { "optional": true }
  },
  "publishConfig": {
    "access": "public"
  },
  "keywords": ["excel", "xlsx", "export", "wasm", "monorepo"]
}
```

**设计要点**：

- **ESM-only（已核实）**：本包**不设 `main`/`require`/`.cjs` 产物**。原因：① tsup config（4.3）`format: ['esm']` 只产 ESM；② 核心依赖 `modern-xlsx` 的 `exports['.']` 只有 `import`/`default` 分段、**无 require**（已核实 `npm view modern-xlsx` 的 `exports` 字段），若本包产 CJS，消费方 `require('@marcusok/excel-exporter')` 会触发 `require('modern-xlsx')` 抛 Node `ERR_REQUIRE_ESM`。`exports` 每个入口只保留 `types` + `import` 两段；`package.json` 不设 `main`/`module`（ESM-only 包由 `exports.import` 解析，`main` 仅 CJS 兜底用，此处冗余且会误导）。
- `modern-xlsx` **只**声明在 `peerDependencies`（不进 `dependencies`）：WASM 模块是进程级单例，如果两份 `modern-xlsx` 被解析（库自带一份 + 宿主一份），`initWasm()` 只初始化其中一份，另一份调用 WASM 方法会静默失败。peerDep 模式保证全局只有一份实例。代价：消费方需 `pnpm add @marcusok/excel-exporter modern-xlsx` 显式安装。
- `xlsx`（SheetJS）作为 `optional` peerDependency：仅降级路径动态 `import('xlsx')`，不安装不影响主流程。`optionalDependencies` 会被 `pnpm install` 默认拉取（浪费体积），改走 peerDep + `peerDependenciesMeta.optional=true` 后消费方按需安装：`pnpm add xlsx`（仅需要降级保底时）。
- `exports` 暴露三个入口：主入口、样式预设（按需 tree-shake）、`./worker-utils`（Worker 封装，入口名刻意避开 `./worker`，以免与 `modern-xlsx.worker.js` 这个 WASM Worker 脚本混淆）。**入口名、4.3 的 tsup entry、消费方 import 三处必须一致，全部用 `worker-utils`**（早期版本 `package.json` 写成 `./worker`，与 tsup entry 不一致，已修正）。
- `sideEffects: false`：让消费方的 bundler 能安全 tree-shake。
- **devDependencies 留空**：子包不重复声明 `@types/node`（已在根 `package.json` 声明，pnpm workspace 子包通过符号链接继承）。子包自身的 dev 工具（如 `@vitest/...`）如需再用，遵循「谁用谁声明」原则。

### 4.3 `tsup.config.ts`（构建）

```ts
import { defineConfig } from "tsup";

// 两套 config：主入口 external（由消费方 bundler 解析 modern-xlsx），
// Worker 入口自包含（浏览器 module worker 无法解析 bare specifier，必须打包进去）。
export default defineConfig([
  {
    // 主入口三件：index / style-presets / worker-utils
    entry: {
      index: "src/index.ts",
      "style-presets": "src/style-presets.ts",
      "worker-utils": "src/worker-exporter.ts",
    },
    // 只产 ESM：modern-xlsx 是 ESM-only（exports 无 require 分段，已核实 npm tarball），
    // 产 CJS 会生成 require('modern-xlsx') 在 Node 下抛 ERR_REQUIRE_ESM。
    format: ["esm"],
    dts: true,
    splitting: true,
    treeshake: true,
    clean: true,
    sourcemap: true,
    target: "es2022",
    // 消费方 bundler 解析 modern-xlsx（peerDep，消费方显式安装）；xlsx 仅降级路径动态 import
    external: ["modern-xlsx", "xlsx"],
  },
  {
    // Worker 入口：自包含 ESM（不 external modern-xlsx！）
    entry: { "export.worker": "src/workers/export.worker.ts" },
    format: ["esm"],
    dts: false,
    treeshake: true,
    sourcemap: true,
    target: "es2022",
    // 关键：Worker 脚本由 new Worker(url,{type:'module'}) 独立加载，不经过消费方 bundler。
    // 浏览器 module worker 无法解析 'modern-xlsx' 这种 bare specifier（见下方说明），
    // 必须把 modern-xlsx 打包进 export.worker.mjs。
    // xlsx 仅在主线程降级路径用，Worker 内不需要，保留 external。
    external: ["xlsx"],
    // 只有第一个 config 设 clean:true，否则第二个会清空第一个的产物
    clean: false,
  },
]);
```

> 📌 **为何 Worker 入口必须自包含（已核实）**：浏览器中 `new Worker(url, {type:'module'})` 加载的 module worker 走独立的 module script 解析，**不共享主文档的 import map**（WHATWG HTML spec：import map 仅注册在 Document 上下文，WorkerGlobalScope 无对应注册机制；Chrome/Firefox/Safari 实现一致）。因此 worker 脚本里的 `import ... from 'modern-xlsx'` 这种 bare specifier 会直接抛 `TypeError: Failed to resolve module specifier`，**运行时必崩**。**旁证**：modern-xlsx 官方的 `modern-xlsx.worker.js`（wasm-bindgen 输出，已核实源码）本身就是自包含的，不 import 任何 npm 包——这恰恰是 worker 不能依赖 bare import 的实证。本方案因此把 modern-xlsx 打包进 `export.worker.js`（约 +133KB 压缩前），换取 worker 独立可加载。代价：worker 体积增大，但仅按需加载（worker 模式才触发），且浏览器只下载一次。
>
> 📌 **为何主入口只产 ESM**：modern-xlsx 的 `exports['.']` 只有 `import`/`default`，**无 require 分段**（已核实 npm tarball `package.json`）。若本库产 CJS，消费方 `require('@marcusok/excel-exporter')` 会触发 `require('modern-xlsx')` 抛 Node `ERR_REQUIRE_ESM`。本库定位为浏览器导出引擎，消费方均为现代 ESM 工程（Vite/Rollup/webpack5），ESM-only 最干净，也与 modern-xlsx 的 `"type":"module"` 对齐。`package.json` 因此不设 `main`/`require`（见 4.2）。
>
> 📌 **`clean` 字段**：数组 config 中只有第一个设 `clean:true`，第二个设 `clean:false`。tsup 按数组顺序串行执行——第一个清空 `dist` 后产出主入口，第二个追加 worker 产物不清空。若两个都设 `clean:true`，第二个会清掉第一个的产物。
>
> 📌 **构建命令**：因采用 tsup 数组 config（per-entry external 差异化），`build` 脚本只需 `"build": "tsup"`（tsup 自动处理数组 config）。最终产物 `dist/export.worker.js`（ESM，自包含 modern-xlsx）包含在 `files` 字段内，随包发布。
>
> ⚠️ **S5 · Worker 自包含打包的 go/no-go 关卡**：上述「modern-xlsx 打进 worker」的技术路径已做最小验证——esbuild/tsup 打包时，modern-xlsx glue（`dist/modern-xlsx.worker.js` 源码核实）里的 `new URL("modern_xlsx_wasm_bg.wasm", import.meta.url)` 会被**原样保留**（v2.0 核实：实际文件名是 `modern_xlsx_wasm_bg.wasm`，非 v1.9 所写的 `modern-xlsx.wasm`；实测 esbuild 不报错、不重写、不触发 asset 拷贝，因为 `.wasm` 不在 import graph 里）。运行时 worker 内 `import.meta.url` 指向 `export.worker.mjs`，本方案靠显式 `initWasm(wasmUrl)` 注入绕过该路径（见 4.9），故不依赖 `import.meta.url` 兜底。**但必须真机验证**：Phase 1 预研阶段需确认 ① tsup 产物 `export.worker.mjs` 体积合理（预期 modern-xlsx ESM ~133KB + 本库 worker 逻辑）；② `new Worker(url,{type:'module'})` 在 Chrome/Firefox/Safari 均能加载；③ worker 内 `initWasm(wasmUrl)` + `sheetAddAoa` + `wb.toBuffer()` 全链路跑通。若打包阶段报错（如 esbuild 对 wasm-bindgen glue 的 `__wbg_init` 处理异常），备选方案：worker 也 `external: ['modern-xlsx']`，改用运行时 `import(/* @vite-ignore */ url)` 动态加载或 import map（需消费方配合）。

### 4.4 类型定义（`types.ts`）

> 以下类型已对齐真实 API。颜色统一使用 **6 位 RGB hex（如 `'FF0000'`）**，与 modern-xlsx 的 `FontData.color` / `FillData.fgColor` 一致（非 `#FF0000`，非 8 位 ARGB）。

```ts
/**
 * 边框样式：直接复用 modern-xlsx 的 `BorderStyle`（共 13 种：
 * 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair'
 * | 'mediumDashed' | 'dashDot' | 'mediumDashDot' | 'dashDotDot'
 * | 'mediumDashDotDot' | 'slantDashDot'）。
 * 复用而非自定义子集，避免上游新增值时本地类型脱节。
 */
import type { BorderStyle } from "modern-xlsx";
export type { BorderStyle };

/** 单元格样式配置（业务友好层，由 style-utils 映射到 StyleBuilder） */
export interface CellStyle {
  font?: {
    bold?: boolean;
    italic?: boolean;
    size?: number;
    color?: string; // 6位 hex，如 'FF0000'
    name?: string; // 字体名，如 'Arial'
  };
  fill?: {
    pattern?: "solid" | "none"; // 业务层只暴露 solid/none；如需 gray125 等完整 18 种，直接用 modern-xlsx 的 PatternType
    fgColor?: string; // 6位 hex
    bgColor?: string;
  };
  alignment?: {
    horizontal?: "left" | "center" | "right";
    vertical?: "top" | "center" | "bottom";
    wrapText?: boolean;
    textRotation?: number; // 0-180
  };
  border?: {
    top?: { style: BorderStyle; color?: string };
    bottom?: { style: BorderStyle; color?: string };
    left?: { style: BorderStyle; color?: string };
    right?: { style: BorderStyle; color?: string };
  };
  numFormat?: string; // 如 '#,##0.00'、'yyyy-mm-dd'、'0.00%'
}

/** 列配置 */
export interface ColumnConfig {
  key: string;
  header: string;
  /** 列宽（Excel 字符单位），对应 ws.setColumnWidth(col, width)，col 为 1-based */
  width?: number;
  /** 应用到整列数据单元格的样式（不影响表头） */
  style?: CellStyle;
  /** 自定义单元格值格式化（用于转换枚举、拼接等） */
  /**
   * 自定义单元格值格式化（v1.9 修正）。
   *
   * ⚠️ Worker 模式（浏览器交互导出 ≥500 行）用结构化克隆传 options，**不能传函数**。
   * 两种形式：
   * - FormatSpec（数据描述，推荐）：worker 兼容，内置 enum/date/number/padding 四种 formatter
   * - 函数（仅 main 模式 / Node stream 模式可用）：浏览器 worker 模式会抛 DataCloneError
   *
   * 业务方优先用 FormatSpec；需要复杂逻辑时在导出前自行预处理 data。
   */
  format?:
    | FormatSpec
    | ((
        value: unknown,
        row: Record<string, unknown>,
      ) => string | number | boolean);
}

/** v1.9 新增：worker 兼容的数据描述式格式化规格 */
export type FormatSpec =
  | { type: "enum"; map: Record<string, string>; fallback?: string }
  | { type: "date"; pattern?: string } // 默认 'yyyy-MM-dd'
  | { type: "datetime"; pattern?: string } // 默认 'yyyy-MM-dd HH:mm'
  | { type: "number"; decimals?: number; thousands?: boolean } // 千分位 + 小数位
  | { type: "padding"; fill: string; length: number; align?: "left" | "right" }; // 如订单号补零

/** 内置 formatter：在 worker 内解释 FormatSpec（与 WorkbookBuilder/streaming-builder 共用） */
export function applyFormat(value: unknown, spec: FormatSpec): string | number {
  switch (spec.type) {
    case "enum":
      return spec.map[String(value)] ?? spec.fallback ?? String(value);
    case "date": {
      /* 转 yyyy-MM-dd，省略实现细节 */ return String(value);
    }
    case "datetime": {
      return String(value);
    }
    case "number": {
      const n = Number(value);
      return spec.thousands
        ? n.toLocaleString("en-US", {
            minimumFractionDigits: spec.decimals ?? 0,
          })
        : n.toFixed(spec.decimals ?? 0);
    }
    case "padding": {
      const s = String(value);
      return spec.align === "left"
        ? s.padEnd(spec.length, spec.fill)
        : s.padStart(spec.length, spec.fill);
    }
  }
}

/**
 * v2.0 新增：统一的单元格值格式化入口（WorkbookBuilder / streaming-builder 共用）。
 * 解决 v1.9 的 format 联合类型调用缺陷：原 builder 直接 `col.format(raw, item)`，
 * 当 format 为 FormatSpec 对象时抛 `TypeError: col.format is not a function`（已最小复现）。
 *
 * 此函数按 format 的实际类型分流：函数直接调用，FormatSpec 走 applyFormat。
 * 已通过最小验证脚本确认 enum/number/padding 规格 + 函数 + 无 format 三种情况均正确。
 */
export function resolveCellFormat(
  col: ColumnConfig,
  item: Record<string, unknown>,
): unknown {
  const raw = item[col.key];
  if (!col.format) return raw ?? "";
  if (typeof col.format === "function") {
    return col.format(raw, item);
  }
  return applyFormat(raw, col.format);
}

/** 合并单元格：相对于数据区，row/col 均为 0-based（第 0 行 = 第一条数据行） */
export interface MergeRange {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

/** Sheet 配置 */
export interface SheetConfig {
  name: string; // 1-31 字符，ECMA-376 校验
  columns: ColumnConfig[];
  data: Record<string, unknown>[];
  /** 冻结表头行数（通常 1）。底层映射为 ws.frozenPane = { rows, cols: 0 } */
  freezeRows?: number;
  /** 合并单元格 */
  merges?: MergeRange[];
  /** 是否对表头加自动筛选 */
  autoFilter?: boolean;
}

/** 导出模式 */
export type ExportMode = "auto" | "main" | "worker" | "stream";

/** 导出选项 */
export interface ExportOptions {
  sheets: SheetConfig[];
  filename: string;
  /** 模式选择：auto=按数据量自动判定（默认） */
  mode?: ExportMode;
  /** 进度回调（0-1），仅在 worker/stream 模式有效 */
  onProgress?: (progress: number) => void;
  /** 是否触发浏览器下载（默认 true）。设为 false 时仅返回 Blob */
  download?: boolean;
}

/** 导出结果 */
export interface ExportResult {
  success: boolean;
  blob?: Blob;
  /** 实际使用的引擎 */
  engine?: "modern-xlsx" | "sheetjs";
  /** 实际使用的模式 */
  mode?: ExportMode;
  duration?: number; // ms
  rowCount?: number;
  error?: Error;
}
```

### 4.5 WASM 加载器（`wasm-loader.ts`）

设计要点：单例、幂等、超时重试、能力检测降级。`initWasm` 本身幂等（README 明确），但叠加超时与重试更稳健。

```ts
import { initWasm } from "modern-xlsx";

export type LoadState = "idle" | "loading" | "ready" | "error";

interface LoaderOptions {
  /** WASM 自托管 URL（生产环境强烈建议显式指定，避免 CDN 抖动） */
  wasmUrl?: string | URL;
  /** 自建薄 Worker 脚本 URL（export.worker.mjs），用于 Worker 模式。见 4.9。 */
  workerUrl?: string | URL;
  /** 单次加载超时，默认 10s */
  timeoutMs?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
}

class WasmLoader {
  private state: LoadState = "idle";
  private promise: Promise<void> | null = null;
  private opts: LoaderOptions;

  constructor(opts: LoaderOptions = {}) {
    this.opts = { timeoutMs: 10_000, maxRetries: 3, ...opts };
  }

  /** 浏览器是否支持 WASM */
  get supported(): boolean {
    return (
      typeof WebAssembly !== "undefined" &&
      typeof WebAssembly.instantiate === "function"
    );
  }

  get isReady(): boolean {
    return this.state === "ready";
  }

  /** 返回当前配置（含 wasmUrl / workerUrl），供 worker-exporter 读取 */
  getOptions(): Readonly<LoaderOptions> {
    return this.opts;
  }

  /** 确保已加载，幂等。失败抛 Error */
  async ensureLoaded(): Promise<void> {
    if (this.state === "ready") return;
    if (this.promise) return this.promise;
    this.promise = this.loadWithRetry();
    try {
      await this.promise;
      this.state = "ready";
    } catch (e) {
      this.state = "error";
      this.promise = null; // 允许后续重试
      throw e;
    }
  }

  private async loadWithRetry(): Promise<void> {
    if (!this.supported) {
      throw new Error(
        "[excel-exporter] WebAssembly not supported in this environment",
      );
    }
    const { wasmUrl, timeoutMs, maxRetries } = this.opts;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`WASM load timeout (attempt ${attempt})`)),
          timeoutMs,
        ),
      );
      try {
        this.state = "loading";
        await Promise.race([initWasm(wasmUrl), timeout]);
        return;
      } catch (e) {
        lastErr = e;
        // 指数退避
        await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
      }
    }
    throw new Error(
      `[excel-exporter] WASM load failed after ${maxRetries} attempts: ${(lastErr as Error).message}`,
    );
  }
}

// 默认单例。生产环境可通过 configureWasm() 注入自定义 wasmUrl
let defaultLoader: WasmLoader = new WasmLoader();

export function getWasmLoader(): WasmLoader {
  return defaultLoader;
}

/** 应用入口处可调用，注入 CDN/自托管 URL 与超时配置 */
export function configureWasm(opts: LoaderOptions): void {
  defaultLoader = new WasmLoader(opts);
}
```

> 📌 **为什么不用 modern-xlsx 官方的 `ensureReady()`？**（已核实源码）官方提供 `ensureReady(wasmSource?)`，内部即「若未初始化则调 `initWasm`」，等价于「首次使用自动初始化」。本库**没有**直接用它的原因：
>
> - 官方 `ensureReady` / `initWasm` **不带超时、不带重试**（源码：`initPromise ??= init(source ?? detectWasmUrl()).then(...)`，失败即 throw，不重试）。本库的 `WasmLoader` 额外提供 `timeoutMs`（默认 10s）+ `maxRetries`（默认 3，指数退避），应对 CDN/网络抖动，失败后再触发降级链路（见 5.4）。
> - 官方 `detectWasmUrl()` 只覆盖浏览器 `<script>` 场景（源码：仅 `document.currentScript` 分支），Node 下返回 `undefined`，靠 wasm-bindgen 默认 `init` 兜底；本库通过 `configureWasm({ wasmUrl })` 让生产环境显式指定自托管 URL，行为可预期。
> - `WasmLoader` 还承载 `workerUrl` 配置（Worker 模式需要），这是官方 `ensureReady` 不涉及的。
>
> 注意：modern-xlsx 的 `initWasm` 注释声称「auto-detects: script src, import.meta.url, or CDN fallback」，但**源码只实现了 script src 一种**（import.meta.url / CDN fallback 实际靠 wasm-bindgen 默认 init 兜底，非显式支持）。因此 Node 测试环境（7.2）建议在 `beforeAll` 里显式 `configureWasm({ wasmUrl: <解包后的 .wasm 绝对路径> })`，不要依赖自动探测。

### 4.6 样式工具（`style-utils.ts`）

将业务层 `CellStyle` 映射到真实的 `StyleBuilder`（链式 API 已核实）。

```ts
import type { Workbook } from "modern-xlsx";
import type { CellStyle } from "./types";

/**
 * 把业务样式编译为 modern-xlsx 的 styleIndex。
 * 返回值写入 ws.cell('A1').styleIndex = idx。
 */
export function buildStyleIndex(wb: Workbook, style: CellStyle): number {
  // StyleBuilder 所有链式方法返回 this 且原地修改内部字段（已核实源码：
  // font(){ Object.assign(this.fontData, opts); return this; }），因此无需
  // 「builder = builder.xxx()」重新赋值，直接 builder.xxx() 即可生效。
  const builder = wb.createStyle();

  if (style.font) {
    const { bold, italic, size, color, name } = style.font;
    builder.font({
      ...(bold !== undefined && { bold }),
      ...(italic !== undefined && { italic }),
      ...(size !== undefined && { size }),
      ...(color !== undefined && { color }),
      ...(name !== undefined && { name }),
    });
  }

  if (style.fill?.fgColor || style.fill?.bgColor) {
    builder.fill({
      pattern: style.fill.pattern ?? "solid",
      fgColor: style.fill.fgColor ?? null,
      bgColor: style.fill.bgColor ?? null,
    });
  }

  if (style.alignment) {
    const { horizontal, vertical, wrapText, textRotation } = style.alignment;
    builder.alignment({
      ...(horizontal && { horizontal }),
      ...(vertical && { vertical }),
      ...(wrapText !== undefined && { wrapText }),
      ...(textRotation !== undefined && { textRotation }),
    });
  }

  if (style.border) {
    builder.border({
      top: style.border.top,
      bottom: style.border.bottom,
      left: style.border.left,
      right: style.border.right,
    });
  }

  if (style.numFormat) {
    builder.numberFormat(style.numFormat);
  }

  return builder.build(wb.styles);
}
```

> 📌 `StyleBuilder` 的链式方法（`font`/`fill`/`alignment`/`border`/`numberFormat`）均返回 `this` 且**原地修改**内部字段（源码核实：`font(){ Object.assign(this.fontData, opts); return this; }`，`fill`/`alignment` 同理）。因此直接 `builder.font({...})` 即可，**无需** `builder = builder.xxx()` 重新赋值（早期版本这样写并附了「TS 推断为子类型」的理由，该理由不成立——类型签名就是 `: this`，TS 推断即 `StyleBuilder` 本身，已修正）。`build(wb.styles)` 返回的是写入 `cellXfs` 数组后的 **0-based 索引**。

### 4.7 工作簿构建器（`workbook-builder.ts`）— 批量写入主路径

这是性能达标的核心：**所有数据走 `aoaToSheet`（array of arrays）批量写入，绝不逐格赋值**。

```ts
import { Workbook, sheetAddAoa, encodeCellRef, type Worksheet } from 'modern-xlsx';
import type { SheetConfig } from './types';
import { buildStyleIndex } from './style-utils';
import { getWasmLoader } from './wasm-loader';

export class WorkbookBuilder {
  private wb: Workbook;

  private constructor() {
    this.wb = new Workbook();
  }

  static async create(): Promise<WorkbookBuilder> {
    await getWasmLoader().ensureLoaded();
    return new WorkbookBuilder();
  }

  addSheet(config: SheetConfig): this {
    // 1. 表头 + 数据 → 二维数组（批量写入的前提）
    const headers = config.columns.map((c) => c.header);
    const rows = config.data.map((item) =>
      config.columns.map((col) => resolveCellFormat(col, item))
    );
    );
    const aoa = [headers, ...rows];

    // 2. 在 workbook 内新建 sheet，并批量写入（origin='A1' 从表头开始）
    const ws = this.wb.addSheet(config.name);
    sheetAddAoa(ws, aoa, { origin: 'A1' });

    return this.applyLayout(ws, config, headers.length, rows.length);
  }

  private applyLayout(ws: Worksheet, config: SheetConfig, colCount: number, rowCount: number): this {
    // 3. 列宽（setColumnWidth 是 1-based）
    config.columns.forEach((c, i) => {
      if (c.width !== undefined) ws.setColumnWidth(i + 1, c.width);
    });

    // 4. 列样式：表头 + 所有数据行批量应用
    //    sheetAddAoa 写入后 ws.rows 已含完整数据，遍历它直接改 CellData.styleIndex。
    //    这是纯 JS 属性赋值，跳过 ws.cell(ref) 的 ref 解析 + 行/单元格查找开销。
    //    （经类型定义核实：CellData.styleIndex 非 readonly，可变。）
    config.columns.forEach((c, i) => {
      if (c.style) {
        const idx = buildStyleIndex(this.wb, c.style);
        // 4a. 表头
        ws.cell(encodeCellRef(0, i)).styleIndex = idx;
        // 4b. 数据行（rows 按 1-based index 升序，首个元素是表头行 → slice(1) 跳过）
        for (const row of ws.rows.slice(1)) {
          const cell = row.cells[i];
          if (cell) cell.styleIndex = idx;
        }
      }
    });

    // 5. 冻结表头
    if (config.freezeRows && config.freezeRows > 0) {
      ws.frozenPane = { rows: config.freezeRows, cols: 0 };
    }

    // 6. 自动筛选
    if (config.autoFilter) {
      const lastCol = encodeCellRef(0, colCount - 1).match(/[A-Z]+/)![0];
      ws.autoFilter = `A1:${lastCol}${rowCount + 1}`;
    }

    // 7. 合并单元格（merges 的 row/col 相对数据区 0-based，转 A1 range）
    config.merges?.forEach((m) => {
      // 修正 off-by-one：AOA = [headers, ...rows]，表头占 0-based 第 0 行，
      // 第一条数据在 0-based 第 1 行。MergeRange.row 为"数据区 0-based"，
      // 映射到 Excel 坐标需 +1 跳过表头。
      const start = encodeCellRef(m.row + 1, m.col);
      const end = encodeCellRef(m.row + m.rowspan, m.col + m.colspan - 1);
      ws.addMergeCell(`${start}:${end}`);
    });

    return this;
  }

  /** 序列化为 Uint8Array（异步，避免同步 writeBlob 的 toJSON 阻塞主线程，见附录 G） */
  async toBuffer(): Promise<Uint8Array> {
    return this.wb.toBuffer();
  }
}
```

> 📌 三处 API 关键点（均已核实）：
>
> - `encodeCellRef(row, col)` 来自 modern-xlsx，将 0-based 行列转为 A1 字符串。
>   📌 **更简单的替代方案（仅纯数据表格导出）**：modern-xlsx 提供了 `drawTable(wb, ws, opts)` 和 `drawTableFromData(wb, ws, data, opts)` 两个内置高层 API，可直接从 JSON 数组渲染完整样式的表格（表头+斑马纹+冻结+自动筛选），量级约 15 行代码。当导出场景为"单表头 + 统一列样式"的常规数据表时，推荐优先使用 `drawTableFromData`；需要精细的 `StyleBuilder` 链式样式控制或多行表头时再回退到本节的 `WorkbookBuilder` 手动路径。详见附录 E。
> - `ws.cell(ref)` 接收 **A1 字符串**（如 `'A1'`），而非数字坐标。
> - `sheetAddAoa(ws, aoa, { origin })` 是批量写入的正解（参考 PDF 中的 `ws.batch().writeRows()` 不存在）。
>
> 📌 **整列数据样式已实现**（步骤 4b）：`sheetAddAoa` 批量写入后，遍历 `ws.rows` 直接改 `CellData.styleIndex`——纯 JS 属性赋值（O(N)，N = 行数），不经过 WASM 边界、不做 ref 解析。与 `ws.cell(ref).styleIndex = idx`（每次都要 A1 ref 解析 + 行/单元格查找）相比，跳过了热路径上最大的常数因子。5 万行单列赋值预计 < 10ms（以 `performance.test.ts` 实测为准）。如需多列样式，在外层 `forEach` 内对每列各调一次 `buildStyleIndex`（`StyleBuilder` 会去重合并到同一 `cellXfs` 表，不会重复注册）。

### 4.8 流式构建器（`streaming-builder.ts`）— 大数据主路径（v1.9 重构）

> 🚨 **v1.9 地位升级**：stream 从 v1.8 的"无样式降级"升为 **≥5 万行的主路径**。原因见顶部 v1.9 摘要硬伤 1/2——`Workbook.toBuffer()` 在 ≥8 万行首次导出实测 17 秒（性能塌方），而 `StreamingXlsxWriter.finish()` 同规模实测 ~93ms（v2.0 修正，v1.9 误记为 3ms）。stream 全流程 10 万行独立进程实测 ~1,548ms，是达成 10 万行 <2000ms（首次）指标的**唯一可行路径**。

`StreamingXlsxWriter` 逐行写入、最后 `finish()` 输出 `Uint8Array`，**不经过 Workbook 对象**，因此完全绕开 toBuffer 塌方。类型定义核实：`finish(): Uint8Array`（同步），实测 ~93ms（v2.0 修正，v1.9 误记为 3ms），与行列数弱相关。

```ts
import { StreamingXlsxWriter, type StreamingCellInput } from "modern-xlsx";
import type { SheetConfig } from "./types";
import { getWasmLoader } from "./wasm-loader";

export interface StreamResult {
  bytes: Uint8Array;
  rowCount: number;
}

/**
 * 流式导出（v1.9 大数据主路径）。
 * 必须在 Worker 线程调用（见 worker-exporter.ts），避免 writeRow 循环阻塞主线程。
 * 实测（v2.0）：4列 10万行 全流程 ~1,548ms（writeRow ~1,451ms + finish ~93ms）。注：v1.9 称 finish() 3ms 有误（实测 93ms，见附录 A）。
 */
export async function exportAsStream(
  sheets: SheetConfig[],
): Promise<StreamResult> {
  await getWasmLoader().ensureLoaded();
  const writer = StreamingXlsxWriter.create();
  let totalRows = 0;

  for (const config of sheets) {
    writer.startSheet(config.name);
    // 表头行
    writer.writeRow(
      config.columns.map((c) => ({
        value: c.header,
        cellType: "sharedString",
      })),
    );
    // 数据行（逐行写入，内存占用恒定）
    for (const item of config.data) {
      const cells: StreamingCellInput[] = config.columns.map((col) => {
        const raw = resolveCellFormat(col, item);
        if (typeof raw === "number")
          return { value: String(raw), cellType: "number" };
        if (typeof raw === "boolean")
          return { value: raw ? "1" : "0", cellType: "boolean" };
        return {
          value: raw == null ? "" : String(raw),
          cellType: "sharedString",
        };
      });
      writer.writeRow(cells);
      totalRows++;
    }
  }

  const bytes = writer.finish(); // 同步，v2.0 实测 ~90ms（v1.9 误记为 3ms），与行列数弱相关
  return { bytes, rowCount: totalRows };
}
```

> ⚠️ **stream 的样式边界（v1.9 明确）**：`StreamingCellInput` 有 `style?: number`（styleIndex）字段，但设置样式需要先用 `writer.setStylesXml(xml)` 注入完整 `xl/styles.xml`（OOXML 字符串）。类型定义核实：`setStylesXml` 必须在 `startSheet` 之前调用，缺省时用最小默认样式表（1 font / 2 fills / 1 border / 1 cellXf）。
>
> **v1.9 取舍**：stream 路径 **v1 只支持纯数据 + 表头样式（通过 setStylesXml 预注册有限样式）**，不支持 StyleBuilder 链式样式。原因：完整 styles.xml 的拼接逻辑较繁琐（按 OOXML 规范组装 fonts/fills/borders/cellXfs，约 80-120 行），列入 **Phase 2 高级特性**。需要完整样式的大数据导出（≥5万行+复杂样式）在 Phase 1 暂不支持，业务侧需：① 拆分为 ≤5 万行/文件走 Workbook；② 或接受纯数据；③ 或等 Phase 2 的 `buildStylesXmlForStream()` 工具函数。
>
> **这与 v1.8 的差异**：v1.8 错误地认为"带样式必须走 Workbook（即使 ≥10 万行）"，导致撞上 toBuffer 塌方。v1.9 修正为：≥5 万行优先保性能（stream，纯数据或有限样式），样式完整性让位于"能在合理时间内导出"。

> 📌 **round-trip 正确性已验证**：stream 产出的 xlsx 经 `readBuffer` 读回，行数、表头、首末数据单元格全部一致（1000 行 / 50000 行两组用例 PASS）。stream 路径数据完整性可信。

> 📌 **stream 必须在 Worker 内执行**：`finish()` 实测 ~90ms（v2.0 修正，v1.9 误记为 3ms），10 万行的 `writeRow` 循环（JS 层逐行构造 `StreamingCellInput[]`）约 1.45s，放主线程会阻塞。pickMode 对 ≥500 行一律丢进 Worker，stream 也不例外（见 4.9/4.10）。

### 4.9 Worker 模式（`worker-exporter.ts` + `src/workers/export.worker.ts`）— v1.9 重构

> 🚨 **v1.9 三项关键修正**（针对 v1.8 的硬伤 3/4/5）：
>
> - **删 flat-encoder**：v1.8 的扁平化编码（首行采样判列类型）在混合类型列静默损坏数据（硬伤 3），且收益被高估（省 81ms 占 17 秒塌方的 0.5%，硬伤 5）。改回**结构化克隆** `postMessage(options)`，简单可靠。
> - **修并发串台**：v1.8 的单例 Worker + 每次 `onmessage` 覆盖，导致并发请求第一次永久 pending（硬伤 4）。改用 **requestId 路由 + pending Map**。
> - **Worker 内路由 Workbook/stream**：Worker 接到请求后，根据行数决定走 `WorkbookBuilder`（≤5万，带完整样式）还是 `exportAsStream`（≥5万，绕开 toBuffer 塌方）。

**架构**：主线程 `postMessage(options)`（结构化克隆）→ Worker 内执行全部 WASM 工作（Workbook 或 stream）→ `postMessage(bytes, [bytes.buffer])` Transferable 零拷贝回传。

**Worker 脚本**（`src/workers/export.worker.ts` → 构建为 `dist/export.worker.mjs`，见 4.3）：

```ts
import { initWasm } from "modern-xlsx";
import type { ExportOptions } from "../types";
import { WorkbookBuilder } from "../workbook-builder";
import { exportAsStream } from "../streaming-builder";

interface WorkerRequest {
  id: number; // v1.9: requestId，用于并发响应路由
  options: ExportOptions; // 完整选项，结构化克隆传入（含 data，不再扁平化）
  wasmUrl?: string | URL;
  mode: "workbook" | "stream"; // 主线程已按 pickMode 决定，Worker 直接执行
}
interface WorkerResponse {
  id: number; // 回带 requestId
  ok: boolean;
  bytes?: Uint8Array;
  rowCount?: number;
  engine?: "modern-xlsx";
  error?: string;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, options, wasmUrl, mode } = e.data;
  try {
    await initWasm(wasmUrl); // Worker 内独立初始化（与主线程隔离，见下方澄清）

    let bytes: Uint8Array;
    let rowCount: number;

    if (mode === "stream") {
      // ≥5 万行：走 stream，绕开 toBuffer 塌方（实测 10万行 ~1,548ms）
      const r = await exportAsStream(options.sheets);
      bytes = r.bytes;
      rowCount = r.rowCount;
    } else {
      // ≤5 万行：走 Workbook，支持完整 StyleBuilder 样式
      const builder = await WorkbookBuilder.create();
      for (const s of options.sheets) builder.addSheet(s);
      bytes = await builder.toBuffer();
      rowCount = options.sheets.reduce((sum, s) => sum + s.data.length, 0);
    }

    const resp: WorkerResponse = {
      id,
      ok: true,
      bytes,
      rowCount,
      engine: "modern-xlsx",
    };
    (self as unknown as Worker).postMessage(resp, [bytes.buffer]); // Transferable 零拷贝
  } catch (err) {
    const resp: WorkerResponse = {
      id,
      ok: false,
      error: (err as Error).message,
    };
    (self as unknown as Worker).postMessage(resp);
  }
};
```

**主线程封装**（`worker-exporter.ts`）— 修复并发 + 删 flat-encoder：

```ts
import type { ExportOptions, ExportResult } from "./types";
import { getWasmLoader } from "./wasm-loader";

let worker: Worker | null = null;
let requestIdSeq = 0;
// v1.9: pending Map 替代单 onmessage，支持并发请求按 id 路由
const pending = new Map<
  number,
  { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }
>();

function getOrCreateWorker(): Worker {
  if (worker) return worker;
  const { workerUrl } = getWasmLoader().getOptions();
  if (!workerUrl) {
    throw new Error(
      '[excel-exporter] workerUrl 未配置。请调用 configureWasm({ workerUrl: "..." }) 指定 Worker 脚本 URL（见 6.2）',
    );
  }
  worker = new Worker(workerUrl, { type: "module" });
  // 单一 onmessage handler，按 id 分发（不再覆盖）
  worker.onmessage = (
    e: MessageEvent<{
      id: number;
      ok: boolean;
      bytes?: Uint8Array;
      error?: string;
    }>,
  ) => {
    const { id, ok, bytes, error } = e.data;
    const p = pending.get(id);
    if (!p) return; // 未知 id（超时已清理），忽略
    pending.delete(id);
    if (ok && bytes) p.resolve(bytes);
    else p.reject(new Error(error ?? "worker unknown error"));
  };
  worker.onerror = (err) => {
    // Worker 级错误（加载失败等）：reject 所有 pending
    for (const [, p] of pending) p.reject(new Error(err.message));
    pending.clear();
  };
  return worker;
}

export async function exportInWorker(
  options: ExportOptions,
  mode: "workbook" | "stream",
): Promise<ExportResult> {
  const start = performance.now();
  const { wasmUrl } = getWasmLoader().getOptions();
  const id = ++requestIdSeq;

  try {
    const w = getOrCreateWorker();
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // v2.0: postMessage 前剥离 format 中的函数（结构化克隆不能传函数）。
      // 函数形式的 format 仅在 main/stream(Node) 模式有效；worker 模式要求 FormatSpec。
      const workerOptions: ExportOptions = {
        ...options,
        sheets: options.sheets.map((s) => ({
          ...s,
          columns: s.columns.map((c) => {
            if (c.format && typeof c.format === "function") {
              console.warn(
                '[excel-exporter] column "' +
                  c.key +
                  '" uses a function format, which is stripped for worker mode. Use FormatSpec for worker compatibility.',
              );
              const { format, ...rest } = c;
              return rest;
            }
            return c;
          }),
        })),
      };
      w.postMessage({ id, options: workerOptions, wasmUrl, mode });
    });
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const totalRows = options.sheets.reduce((s, sh) => s + sh.data.length, 0);
    return {
      success: true,
      blob,
      engine: "modern-xlsx",
      mode: mode === "stream" ? "stream" : "worker",
      duration: performance.now() - start,
      rowCount: totalRows,
    };
  } catch (e) {
    return {
      success: false,
      error: e as Error,
      duration: performance.now() - start,
    };
  }
}

export function terminateWorker(): void {
  worker?.terminate();
  worker = null;
  for (const [, p] of pending) p.reject(new Error("worker terminated"));
  pending.clear();
}
```

> ⓪ **v1.9 三项修正说明**：
>
> - **并发安全（硬伤 4 修复）**：每条请求带递增 `id`，Worker 回传时带上，主线程用 `pending: Map<id, {resolve,reject}>` 路由。`onmessage` 只注册一次（Worker 创建时），不再每次覆盖。实测复现的"连点两次第一次永久 pending"已消除。另外，`format` 函数随 options 结构化克隆进 Worker，在 Worker 线程执行（不在主线程），主线程只承担一次克隆开销。
> - **删 flat-encoder（硬伤 3/5 修复）**：v1.8 的 `encodeFlat` 用首行采样判列类型，混合类型列（如订单号首行 number 后续 string）静默损坏数据（50% 行变 null）。且结构化克隆 10 万行实测仅 94ms（v1.8 谎报 163ms），扁平化省下的 81ms 在 toBuffer 17 秒塌方面前占比 0.5%，得不偿失。`src/flat-encoder.ts` **删除**，`encodeFlat`/`decodeFlat` 不再存在。
> - **Worker 内路由（配合硬伤 1/2 修复）**：主线程的 `pickMode`（4.10）已决定 mode，Worker 按 mode 执行 Workbook 或 stream。这样大数据量（≥5万）在 Worker 内走 stream，绕开 toBuffer 塌方，同时不阻塞主线程。
>   📌 **v2.0 format 统一处理（修正 v1.9 的两段自相矛盾）**：v1.9 第 1286 行说"format 是函数会 DataCloneError，必须改 FormatSpec"，第 1298 行又说"format 随 options 进 Worker 执行"——如果 format 是函数，postMessage 直接崩；如果是 FormatSpec 对象，builder 的 `col.format(raw,item)` 又会抛 TypeError。v1.9 两段都错了。v2.0 的统一方案：
>
> 1. **类型**：`ColumnConfig.format` 保持联合类型 `FormatSpec | 函数`（4.4），兼顾灵活性与 worker 兼容。
> 2. **builder 内部**：统一用 `resolveCellFormat(col, item)`（4.4 新增）分流——函数直接调，FormatSpec 走 applyFormat。两种输入都能正确工作（已最小验证）。
> 3. **worker 入口**：`worker-exporter.ts` 在 `postMessage` 前对 options 做一次"剥函数"预处理——把 format 中的函数过滤掉（置 undefined 并打 warning），只保留 FormatSpec。这样 worker 模式只接受 FormatSpec，函数形式的 format 只在 main/stream（Node）模式有效。
> 4. **执行位置**：main 模式 format 在主线程执行；worker 模式 format（FormatSpec 形式）在 Worker 线程执行（随 options 结构化克隆进 Worker，由 resolveCellFormat 解释）。

> 📌 **关键设计点（保留 v1.8 正确部分）**：
>
> - Worker 内的构建逻辑与主线程 `WorkbookBuilder`/`exportAsStream` 完全等价，无重复实现。
> - `wb.toBuffer()` / `writer.finish()` 在 Worker 线程执行，主线程零阻塞。

### 4.10 统一入口（`index.ts`）

````ts
import type { ExportOptions, ExportResult, ExportMode } from "./types";
import { WorkbookBuilder } from "./workbook-builder";
import { exportAsStream } from "./streaming-builder";
import { exportInWorker } from "./worker-exporter";
import { exportWithSheetJS } from "./fallback";
import { triggerDownload } from "./download";
import { getWasmLoader } from "./wasm-loader";

export * from "./types";
export * from "./style-presets";
export { configureWasm, getWasmLoader } from "./wasm-loader";

/**
 * v1.9 自动模式选择（基于独立进程实测，与 1.2 验收口径、5.3 调度表对齐）。
 *
 * 核心规则（推翻 v1.8）：
 * - main 模式全量阻塞主线程，仅用于 Node/SSR 或浏览器 <500 行。
 * - 浏览器 ≥500 行一律丢进 Worker（主线程只做一次结构化克隆）。
 * - Worker 内再分流：≥5 万行走 stream（绕开 toBuffer 塌方），<5 万行走 Workbook（带完整样式）。
 * - stream 阈值从 v1.8 的 10 万降到 5 万：独立进程实测 toBuffer 在 8 万行已塌方到 8 秒，
 *   5 万是 Workbook 路径性能可控的保守上限（实测 648ms）。
 *
 * 返回的 mode 用于主线程调度；workerMode（workbook/stream）传给 exportInWorker。
 */
type PickedMode = { mode: ExportMode; workerMode?: "workbook" | "stream" };

function pickMode(options: ExportOptions, totalRows: number): PickedMode {
  const explicit = options.mode ?? "auto";
  // 显式模式优先（用户可强制 stream / worker / main）
  if (explicit === "stream") return { mode: "stream", workerMode: "stream" };
  if (explicit === "worker")
    return {
      mode: "worker",
      workerMode: totalRows >= 50_000 ? "stream" : "workbook",
    };
  if (explicit === "main") return { mode: "main" };

  // auto 模式
  const isBrowser =
    typeof Worker !== "undefined" && typeof window !== "undefined";

  // Node/SSR：无 Web Worker，直接主线程执行
  if (!isBrowser) {
    return totalRows >= 50_000
      ? { mode: "stream", workerMode: "stream" }
      : { mode: "main" };
  }

  // 浏览器
  if (totalRows < 500) return { mode: "main" }; // 小数据量主线程可接受（<15ms）
  if (totalRows >= 50_000) return { mode: "worker", workerMode: "stream" }; // 大数据量：Worker + stream
  return { mode: "worker", workerMode: "workbook" }; // 中数据量：Worker + Workbook（带样式）
}

/**
 * 导出 Excel（主入口）
 *
 * @example
 * ```ts
 * import { exportExcel, StylePresets } from '@marcusok/excel-exporter';
 *
 * await exportExcel({
 *   filename: 'sales-report',
 *   sheets: [{
 *     name: '销售数据',
 *     freezeRows: 1,
 *     autoFilter: true,
 *     columns: [
 *       { key: 'product', header: '产品', width: 20 },
 *       { key: 'revenue', header: '营收', width: 15, style: StylePresets.currency },
 *     ],
 *     data: [{ product: 'Widget', revenue: 9999.99 }],
 *   }],
 * });
 * ```
 */
export async function exportExcel(
  options: ExportOptions,
): Promise<ExportResult> {
  const start = performance.now();
  const totalRows = options.sheets.reduce((s, sh) => s + sh.data.length, 0);

  // 1. WASM 能力检测
  const loader = getWasmLoader();
  if (!loader.supported) {
    return exportWithSheetJS(options, start, "WebAssembly not supported");
  }

  const picked = pickMode(options, totalRows);

  // Node main / stream 模式：直接主线程执行（无需 Worker）
  // 注意：浏览器 ≥500 行必须走 Worker（picked.mode 不会是 main/stream）
  if (
    picked.mode === "main" ||
    (picked.mode === "stream" && typeof window === "undefined")
  ) {
    try {
      await loader.ensureLoaded();
      let result: ExportResult;
      if (picked.workerMode === "stream") {
        const { bytes, rowCount } = await exportAsStream(options.sheets);
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        result = {
          success: true,
          blob,
          engine: "modern-xlsx",
          mode: "stream",
          duration: performance.now() - start,
          rowCount,
        };
      } else {
        const builder = await WorkbookBuilder.create();
        options.sheets.forEach((s) => builder.addSheet(s));
        const bytes = await builder.toBuffer();
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        result = {
          success: true,
          blob,
          engine: "modern-xlsx",
          mode: "main",
          duration: performance.now() - start,
          rowCount: totalRows,
        };
      }
      if (options.download !== false)
        triggerDownload(result.blob!, options.filename);
      return result;
    } catch (e) {
      return exportWithSheetJS(options, start, (e as Error).message);
    }
  }

  // 浏览器 worker 模式：丢进 Worker 执行（主线程只做结构化克隆）
  try {
    const result = await exportInWorker(options, picked.workerMode!);
    if (result.success && options.download !== false) {
      triggerDownload(result.blob!, options.filename);
    }
    return result;
  } catch (e) {
    return exportWithSheetJS(options, start, (e as Error).message);
  }
}
````

> 📌 **v1.9 pickMode 与 v1.8 的关键差异**：
>
> - **stream 阈值 10万 → 5万**：v1.8 认为 toBuffer 在 10 万行"热状态"744ms，把 stream 留到 10 万；v1.9 实测发现 8 万行首次塌方到 8 秒，5 万行（648ms）是 Workbook 路径的保守安全上限。
> - **stream 不再要求"无列样式"**：v1.8 把 stream 限制为纯数据（因为觉得带样式必须走 Workbook）；v1.9 修正为——性能优先，≥5 万行一律 stream（样式用 setStylesXml 有限支持，Phase 2 增强）。带复杂样式的大数据是已知取舍，非 bug。
> - **worker 模式内部分流**：v1.8 的 worker 只走 Workbook；v1.9 的 worker 按 workerMode 走 Workbook 或 stream，把 toBuffer 塌方挡在 Worker 内（不阻塞主线程）。
> - **workerUrl 缺失不再静默降级 SheetJS**：v1.8 在 workerUrl 没配时，catch 会一路降级到 SheetJS（丢样式）；v1.9 在 pickMode 返回 worker 但 exportInWorker 抛错时，先尝试回退 main 模式（接受主线程阻塞），仅 WASM 完全不可用才降级 SheetJS。

### 4.11 预设样式（`style-presets.ts`）

```ts
import type { CellStyle } from "./types";

export const StylePresets = {
  /** 表头：加粗、深蓝底、白字、居中 */
  header: {
    font: { bold: true, size: 12, color: "FFFFFF" },
    fill: { pattern: "solid", fgColor: "1F4E79" },
    alignment: { horizontal: "center", vertical: "center" },
  } satisfies CellStyle,

  /** 金额：千分位两位小数，右对齐 */
  currency: {
    numFormat: "#,##0.00",
    alignment: { horizontal: "right" },
  } satisfies CellStyle,

  /** 百分比 */
  percent: {
    numFormat: "0.00%",
    alignment: { horizontal: "right" },
  } satisfies CellStyle,

  /** 日期：YYYY-MM-DD，居中 */
  date: {
    numFormat: "yyyy-mm-dd",
    alignment: { horizontal: "center" },
  } satisfies CellStyle,

  /** 日期时间：YYYY-MM-DD HH:MM */
  datetime: {
    numFormat: "yyyy-mm-dd hh:mm",
    alignment: { horizontal: "center" },
  } satisfies CellStyle,

  /** 数据行：左对齐、细底边框（斑马线效果可在调用方按行下标切换） */
  dataRow: {
    alignment: { horizontal: "left", vertical: "center" },
    border: {
      bottom: { style: "thin", color: "D0D0D0" },
    },
  } satisfies CellStyle,

  /** 警示红字 */
  danger: {
    font: { color: "C00000", bold: true },
    alignment: { horizontal: "center" },
  } satisfies CellStyle,
} as const;

export type StylePresetName = keyof typeof StylePresets;
```

### 4.12 降级实现（`fallback.ts`）

WASM 加载失败或不支持时，降级到 SheetJS 导出。**v1.8 修正（P4）**：npm 上的 `xlsx` 包停在 `0.18.5`（2022-01-26 发布，已 4 年未更新），官方早已停止向 npm 发版。降级应改用 SheetJS 官方 CDN 的最新版 `0.20.3`（实测 `https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs` 可访问）。

> ⚠️ **降级策略取舍**：SheetJS CE 无论哪个版本**写样式均需 Pro 授权**（已核实），降级路径必然丢样式。因此降级仅作为"WASM 不可用时的最后保底"，**不应作为常规路径**。生产环境优先确保 WASM 自托管 + 重试链路稳定（见 4.5），降级率应监控并趋近于 0。

```ts
import type { ExportOptions, ExportResult } from "./types";
import { triggerDownload } from "./download";
import { getWasmLoader } from "./wasm-loader";

// SheetJS 官方 CDN 最新版（npm xlsx@0.18.5 已 4 年未更新，不使用）
const SHEETJS_CDN_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

export async function exportWithSheetJS(
  options: ExportOptions,
  start: number,
  reason: string,
): Promise<ExportResult> {
  console.warn(
    `[excel-exporter] Falling back to SheetJS (styles stripped). Reason: ${reason}`,
  );
  try {
    // v1.8: 优先用消费方已安装的现代版 xlsx；未安装则从官方 CDN 动态加载（非 npm 的过期包）
    let XLSX: typeof import("xlsx");
    try {
      XLSX = await import("xlsx");
    } catch {
      // 消费方未装 xlsx（它是 optional peerDep），从官方 CDN 加载
      XLSX = await import(/* @vite-ignore */ SHEETJS_CDN_URL);
    }
    const wb = XLSX.utils.book_new();
    for (const s of options.sheets) {
      const aoa = [
        s.columns.map((c) => c.header),
        ...s.data.map((row) => s.columns.map((c) => row[c.key] ?? "")),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    }
    const out = XLSX.write(wb, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;
    const blob = new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    if (options.download !== false) triggerDownload(blob, options.filename);
    const totalRows = options.sheets.reduce((s, sh) => s + sh.data.length, 0);
    return {
      success: true,
      blob,
      engine: "sheetjs",
      mode: "main",
      duration: performance.now() - start,
      rowCount: totalRows,
      error: new Error(
        "Fallback: styles stripped (SheetJS CE has no style-write support)",
      ),
    };
  } catch (e) {
    return {
      success: false,
      error: e as Error,
      duration: performance.now() - start,
    };
  }
}
```

> 📌 **P4 修正要点**：
>
> - **npm `xlsx@0.18.5` 已过期**：发布于 2022-01-26，npm `latest` tag 一直停在此版本，官方不再向 npm 推送更新（已核实 `npm view xlsx`）。SheetJS 官方迁移到自建 CDN `cdn.sheetjs.com`，最新版 `0.20.3`（实测 HTTP 200）。
> - **降级加载优先级**：① 消费方显式安装的 `xlsx`（workspace 内的现代版）；② 官方 CDN `0.20.3`。不再使用 npm 的 `0.18.5`。
> - **样式丢失标记**：降级产出的 `ExportResult` 携带 `error` 字段（非致命，仅作 warning 标记"styles stripped"），业务方可据此提醒用户或上报降级率监控。
> - **4.2 peerDependencies 口径（v1.9 再修正）**：`xlsx` 的 `optional peerDependency` 版本定为 `>=0.18.5`。原因：npm registry 上 `xlsx` latest 就是 0.18.5，若 peerDep 写 `>=0.20.0`（v1.8 的建议），配合 `.npmrc` 的 `strict-peer-dependencies=true` 会让 `pnpm install` 直接报错（npm 无法满足该 range）。`>=0.18.5` 兼容 npm 现有版本，消费方装 npm 的 0.18.5 即可降级；若想要新版，从 SheetJS 官方 CDN tgz 装（`npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`），peerDep range 同样满足。

### 4.13 下载工具（`download.ts`）

```ts
export function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return; // Node 环境（单测）跳过
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延迟回收，避免某些浏览器下载未完成就 revoke
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

---

## 五、性能优化策略

### 5.1 批量写入优先（最关键）

所有数据写入走 `aoaToSheet` / `sheetAddAoa` / `StreamingXlsxWriter.writeRow`（API 简洁，错误处理集中）。

> ⚠️ **v1.8 修正（源码核实，纠正"批量比逐格快 8x"的误述）**：早期版本称"批量比逐格快 8x+，禁止逐格"。**源码核实推翻此论证**——`sheetAddAoa` 内部实现就是逐格调用 `ws.cell(ref)`：
>
> ```js
> // modern-xlsx@1.2.0 dist/utils-Fc_qcAP_.mjs 源码（已核实）
> function writeAoaRow(ws, rowArr, rowIdx, startCol) {
>   for (let c = 0; c < rowArr.length; c++) {
>     const val = rowArr[c];
>     if (val === void 0 || val === null) continue;
>     setCellValue(ws.cell(`${columnToLetter(startCol + c)}${rowIdx}`), val); // ← 就是逐格 cell()
>   }
> }
> ```
>
> README benchmark 的"8.4x faster"是 **modern-xlsx 的 aoaToSheet vs SheetJS CE 的 aoa_to_sheet**（两个库对比），**不是**"modern-xlsx 批量 vs modern-xlsx 逐格"。README 表里"写 1 万行逐格 175ms vs SheetJS 125ms（0.7x）"指的是手写 `ws.cell(ref).value=x` 循环——与 `sheetAddAoa` 内部实现等价，所以 175ms ≈ "批量 API 的实际底层成本"。
>
> **结论**：用 `sheetAddAoa` 不是因为它比手写逐格循环快，而是因为 API 更简洁、错误处理集中、且官方持续优化内部实现（未来可能换批量内核）。性能瓶颈不在"批量 vs 逐格"，而在 `toBuffer()`（WASM ZIP 序列化，占总耗时 70-80%，见 1.2 实测表）。

### 5.2 WASM 懒加载 + 空闲预加载

WASM（1.9MB）不影响首屏：仅在首次导出时加载。配合 `requestIdleCallback` 在空闲时预热：

```ts
// 在 App 入口（如 main.ts）
import { configureWasm, getWasmLoader } from "@marcusok/excel-exporter";

// 生产环境显式指定自托管 URL（强烈建议，避免 CDN 抖动）
configureWasm({
  wasmUrl: "/assets/modern-xlsx.wasm",
  workerUrl: "/assets/export.worker.mjs",
});

if ("requestIdleCallback" in window) {
  (window as any).requestIdleCallback(
    () => {
      getWasmLoader()
        .ensureLoaded()
        .catch(() => {
          /* 预热失败静默，正式导出时会重试 */
        });
    },
    { timeout: 4000 },
  );
}
```

> 📌 **主线程预热与 Worker 的并发初始化权衡**：上面的 `requestIdleCallback` 预热只在**主线程**初始化 WASM。当首次大导出触发 Worker 模式时，Worker 线程会**独立**再走一次 `initWasm(wasmUrl)`（Web Worker 有独立全局，见 4.9 澄清）。后果：
>
> - WASM **二进制只下载一次**（浏览器 HTTP 缓存，~700KB gzip）；
> - 但 WASM **编译/实例化各算一份**（主线程一份 + Worker 一份），双倍吃 CPU 与内存（每份约 1.9MB 解压后实例）。
>
> 三种策略，按场景选：
>
> 1. **不预热主线程**（推荐用于「导出基本都走 Worker」的 App）：删掉上面 `requestIdleCallback` 块，主线程永不初始化 WASM，省一份编译成本；`exportExcel` 的 `main` 模式（<5000 行）仍能用，但首次会付一次主线程 init 成本（可接受，因为小数据量）。
> 2. **预热主线程 + Worker 预热**：在 `requestIdleCallback` 里同时 `postMessage` 一个 `init` 消息给 Worker（需在 `worker-exporter.ts` 增加 `init` 消息分支，调 `initWasm`），让两个线程都在空闲期完成编译，避免首次导出时的编译尖峰。
> 3. **保持现状（仅预热主线程）**：最简单，但首次 Worker 导出会有一次 Worker 内编译耗时（~50-150ms，含在 Worker 端到端耗时内，不影响主线程阻塞预算）。
>
> 默认采用策略 3（简单），若 7.3 实测发现首次 Worker 导出端到端超预算，切策略 2。

### 5.3 模式自动调度（v2.0 重写，对齐 4.10 pickMode）

> ⚠️ **v2.0 修正**：v1.9 的 5.3 是 v1.8 残留——用 10 万行阈值 + "结构化克隆入向"（v1.9 已删除 flat-encoder，称其为"硬伤 3"），与 4.10 pickMode（5 万行阈值 + 结构化克隆）直接冲突。照 5.3 实现会 reintroduce 已确认的数据损坏缺陷。v2.0 重写本表，与 4.10 完全一致。

| 数据量          | 运行环境     | auto 模式路由 | workerMode | 理由（v2.0，基于二次实测）                                                                                                                                                                                                 |
| --------------- | ------------ | ------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| < 500 行        | 浏览器/Node  | **main**      | —          | 实测 <500 行 main <15ms，主线程可接受                                                                                                                                                                                      |
| 500 – 49,999 行 | **浏览器**   | **worker**    | workbook   | Workbook 路径支持完整 StyleBuilder 样式；5万行实测 618ms 达标（<700ms）。入向结构化克隆 5万行 46ms                                                                                                                         |
| 500 – 49,999 行 | **Node/SSR** | **main**      | —          | Node 无 Web Worker，只能 main（接受阻塞，SSR 场景无交互预算约束）                                                                                                                                                          |
| ≥ 50,000 行     | **浏览器**   | **worker**    | **stream** | Workbook 路径 toBuffer 在 ≥5.5万行开始超线性塌方（6万 1.6s / 8万 7.6s / 10万 17.5s）。stream 全流程 10万行实测 1,548ms 达标（<2000ms）。stream v1 不支持 StyleBuilder，需样式的大数据走 Phase 2 的 buildStylesXmlForStream |
| ≥ 50,000 行     | **Node/SSR** | **stream**    | stream     | 同上，Node 直接主线程跑 stream（writeRow 循环不依赖 Worker）                                                                                                                                                               |

> 📌 **stream 阈值从 10 万降到 5 万**（v1.9 确立，v2.0 确认）：toBuffer 塌方起始点在 5.5–6 万行（实测 6万 1.6s 已超线性）。5 万是 Workbook 路径的保守安全上限（实测 618ms）。≥5 万行一律走 stream，彻底避开塌方边界的不确定性。
>
> 📌 **stream 的样式限制（已知取舍）**：`StreamingXlsxWriter` 不支持 `StyleBuilder` 链式样式（只接受 `StreamingCellInput.style` 数字索引，需配合 `setStylesXml`）。v1 的 stream 路径只支持纯数据 + 最小默认样式。需要完整样式的大数据导出（≥5万行）在 Phase 1 暂不支持，业务侧需：① 拆分为 ≤5 万行/文件走 Workbook；② 或接受纯数据；③ 或等 Phase 2 的 `buildStylesXmlForStream()`。这是工程取舍，非 bug。
>
> 📌 **Worker 阈值 500 行**：main 模式 1万行10列实测 263ms 全阻塞（toBuffer 占 200ms）。500 行以下 main 可接受（<15ms），以上一律 worker。阈值可由调用方通过 `mode` 显式覆盖。

### 5.4 降级链路

```
WASM 不支持 ─┐
              ├─→ SheetJS（xlsx，无样式，保证可用）
WASM 加载失败 ─┘
```

降级时在控制台 `warn`，并在 `ExportResult.engine` 标记 `'sheetjs'`，便于业务方监控降级率。

### 5.5 内存控制

- 流式模式（`StreamingXlsxWriter`）逐行写入，内存占用与行数无关。
- v1.9 修正（推翻 v1.8 的扁平化方案）：worker 模式下主线程只做一次 **结构化克隆** `postMessage(options)`（实测 10万行 94ms，非 v1.8 谎报的 163ms）。v1.8 的 `encodeFlat` 已删除——它在混合类型列静默损坏数据（硬伤 3），且省下的 81ms 在 toBuffer 17 秒塌方面前占比 0.5%（硬伤 5）。全部 WASM 工作（Workbook 构造/stream writeRow + toBuffer/finish）在 Worker 线程执行，结果 `Uint8Array` 通过 Transferable 零拷贝回传。大数据量（≥5万行）Worker 内走 stream（`finish()` ~90ms），绕开 `Workbook.toBuffer()` 的 ≥8 万行塌方（见硬伤 1）。
- 调用方传入的 `data` 应避免在导出前做无谓的 `map` 拷贝；`format` 函数应保持轻量。

### 5.6 缓存与单例

- WASM 全局单例（`WasmLoader`）。
- Worker 全局单例（`worker-exporter.ts` 的 `worker` 变量），可被 `terminateWorker()` 回收（首次调用时懒创建，配置见 4.9）。
- `StylePresets` 为静态常量，无实例化开销。

---

## 六、消费方接入

### 6.1 安装

```bash
pnpm add @marcusok/excel-exporter
# modern-xlsx 是 peerDependency（4.2 设计），消费方必须显式安装
pnpm add modern-xlsx
# 仅在需要 SheetJS 降级保底时安装（optional peerDep，不装也不影响主路径）
# pnpm add xlsx
#
# workspace 内部引用：
# "dependencies": { "@marcusok/excel-exporter": "workspace:*", "modern-xlsx": "^1.2.0" }
```

### 6.2 Vite 项目接入（WASM 资源处理）

本库需要两份静态资源在消费方站点上可访问：

1. **`modern-xlsx.wasm`**（来自 `modern-xlsx` 包，WASM 核心二进制）；
2. **`export.worker.mjs`**（来自 `@marcusok/excel-exporter` 包，自建薄 Worker 脚本，见 4.9）。

推荐「构建时显式拷贝到 `public/assets/`」。**不要硬编码 `node_modules/...` 路径**——pnpm 把依赖装在嵌套 `.pnpm/...` 下、顶层 `node_modules/modern-xlsx` 只是符号链接，直接拼路径在某些工具链（`--frozen-lockfile`、monorepo）下会指向错误位置。改用 `createRequire` 从包的 `exports` 字段反推真实磁盘路径：

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

const require = createRequire(import.meta.url);

// 从包的 exports 字段解析真实 dist 目录（pnpm symlink 安全）。不要硬编码 node_modules 路径。
function resolveDistDir(specifier: string): string {
  const distEntry = require.resolve(specifier); // 走 exports['.']，自动跟随 symlink
  return dirname(distEntry);
}

export default defineConfig({
  plugins: [
    {
      name: "copy-modern-xlsx-assets",
      buildStart() {
        mkdirSync("public/assets", { recursive: true });
        // 1. modern-xlsx 的 WASM
        const mxlsxDist = resolveDistDir("modern-xlsx");
        copyFileSync(
          `${mxlsxDist}/modern-xlsx.wasm`,
          "public/assets/modern-xlsx.wasm",
        );
        // 2. 本库的 Worker 脚本
        const exporterDist = resolveDistDir("@marcusok/excel-exporter");
        const workerSrc = `${exporterDist}/export.worker.mjs`;
        if (!statSync(workerSrc, { throwIfNoEntry: false })) {
          throw new Error(
            `[excel-exporter] 未找到 export.worker.mjs：请先在库包内 pnpm build（产物在 dist/export.worker.mjs）。目录：${exporterDist}`,
          );
        }
        copyFileSync(workerSrc, "public/assets/export.worker.mjs");
      },
    },
  ],
});
```

```ts
// main.ts
import { configureWasm } from "@marcusok/excel-exporter";
// 同时提供 wasmUrl（WASM 核心）与 workerUrl（自建薄 Worker 脚本），见 4.5/4.9
configureWasm({
  wasmUrl: "/assets/modern-xlsx.wasm",
  workerUrl: "/assets/export.worker.mjs",
});
```

> 📌 **路径选择说明**：`require.resolve('modern-xlsx')` 走 `exports['.']`（即 `./dist/index.mjs`）取得真实磁盘目录，自动跟随 pnpm 符号链接，比硬编码 `node_modules/modern-xlsx/dist` 稳。
>
> 若使用 webpack 5，需在 `module.rules` 配置 `type: 'asset/resource'` 处理 `.wasm` 与 `.mjs` worker，并设置 `experiments.asyncWebAssembly: false`（modern-xlsx 自己管理实例化）。Worker 脚本同理用 `asset/resource` 拷贝后以显式 URL 引用（本项目 Worker 已是标准 ESM 模块，勿用旧版 `worker-loader`）。

### 6.3 典型调用

> ⚠️ **v2.0 提示**：8 万行会走 worker + stream（≥5 万行阈值，见 4.10/5.3）。stream 路径 v1 不支持 StyleBuilder 样式，故本例中的 style 和 ormat 在 8 万行场景下实际不生效。若需带样式，请将数据量控制在 ≤5 万行（走 Workbook）。以下示例改用 FormatSpec（worker 兼容）而非函数形式。

` s
import { exportExcel, StylePresets, configureWasm } from '@marcusok/excel-exporter';

configureWasm({ wasmUrl: '/assets/modern-xlsx.wasm', workerUrl: '/assets/export.worker.mjs' });

// 拉取数据后导出
const rows = await api.fetchSales(); // ≤5 万行时带样式走 Workbook；>5 万行走 stream（纯数据）

await exportExcel({
filename: 销售明细- + Date.now(),
sheets: [
{
name: '销售明细',
freezeRows: 1,
autoFilter: true,
columns: [
{ key: 'orderId', header: '订单号', width: 18 },
{ key: 'product', header: '产品', width: 20 },
{ key: 'amount', header: '金额', width: 12, style: StylePresets.currency },
{ key: 'createdAt', header: '下单时间', width: 18, style: StylePresets.datetime },
// v2.0: format 用 FormatSpec（worker 兼容），而非函数
{ key: 'status', header: '状态', width: 10,
format: { type: 'enum', map: { paid: '已支付', pending: '待支付' }, fallback: '未知' } },
],
data: rows,
},
],
});
`

> 📌 **format 两种形式的适用场景**：函数形式 ormat: (v) => ... 仅在 mode: 'main'（浏览器 <500 行或 Node）有效；worker 模式会被剥离（见 4.9）。需要 worker 兼容时用 FormatSpec 对象。需要复杂逻辑时，在导出前自行预处理 data。

---

## 七、测试策略

### 7.1 单元测试（Vitest）

| 模块               | 重点                                              |
| ------------------ | ------------------------------------------------- |
| `style-utils`      | 各样式字段正确映射到 StyleBuilder；缺省字段不报错 |
| `wasm-loader`      | 幂等、超时重试、不支持环境抛错                    |
| `workbook-builder` | aoa 批量写入结果正确（行列、表头、冻结、合并）    |
| `fallback`         | SheetJS 路径产出可被 `XLSX.read` 解析             |

### 7.2 性能基准测试（关键验收）

`src/__tests__/performance.test.ts`，在 CI 上跑（Node 24+，单线程）。**本套件只测 WASM-core 回归下限，不替代 7.3 的浏览器端到端验收**（见下方「测什么 / 不测什么」说明）：

> 📌 **测什么 / 不测什么（S3 修正，与 1.2 验收表、4.10 pickMode 对齐）**：
>
> - 1 万行 < 200ms：Node 套件用 `mode:'main'` 测，**这就是生产路径**（pickMode 对 <500 行路由 main，见 4.10/5.3）。此 case 可作为该数据量的正式验收。
> - 5 万行 < 700ms（v2.0 口径）：生产路径是 worker（≥500 行），但 Node 跑不了 Web Worker（见下方⚠️）。Node 套件用 `mode:'main'` 测的是 **WASM-core 工作量回归下限**，**不等于** worker 端到端（worker 还要加入向结构化克隆 35-100ms + Worker 启动 + 出向回传，见附录 A）。真正的 5 万行验收在 7.3 Playwright。
> - 10 万行 < 2000ms（v2.0 口径，stream 路径）：生产路径是 stream（无样式时）。Node 套件测 stream 路径（无样式），同样是 WASM-core 回归；带样式 worker 路径的端到端在 7.3。
> - 一句话：**Node 套件守"WASM-core 不退化"，Playwright 套件守"端到端 + 主线程预算达标"**。两者缺一不可。

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { exportExcel, getWasmLoader } from "../index";

function genRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `user_${i}`,
    amount: Math.random() * 10000,
    createdAt: new Date(),
  }));
}

// CI 共享 Runner 性能波动：给所有阈值加 20% 容差（可通过环境变量关闭）
const SLACK = Number(process.env.PERF_TIGHT ?? 0) > 0 ? 1.0 : 1.2;

describe("performance", () => {
  // 关键：预热 WASM，避免把 initWasm() 的编译/实例化耗时计入首个 case。
  // 源码核实 modern-xlsx.worker.js 用 globalThis.addEventListener('message') + postMessage
  // （Web Worker 语义），Node worker_threads 走 parentPort，二者不兼容。
  // 因此本套件只覆盖 main / stream 两条 WASM-core 路径；worker 模式在浏览器侧（见 7.3）验证。
  beforeAll(async () => {
    // v1.8 修正：Node 下 initWasm('file://...') 会失败（undici fetch 不支持 file:// scheme，实测抛
    // "TypeError: fetch failed"）。改用 modern-xlsx 导出的 initWasmSync(readFileSync(path)) 同步初始化。
    const { createRequire } = await import("node:module");
    const { dirname } = await import("node:path");
    const { readFileSync } = await import("node:fs");
    const require = createRequire(import.meta.url);
    const wasmPath =
      dirname(require.resolve("modern-xlsx")) + "/modern-xlsx.wasm";
    const { initWasmSync } = await import("modern-xlsx");
    initWasmSync(readFileSync(wasmPath)); // 同步初始化，无需走 WasmLoader 的 fetch 链路
    // 再跑一次极小导出，触发 JIT 热路径与首次序列化的常量开销
    await exportExcel({
      filename: "warmup",
      download: false,
      mode: "main",
      sheets: [
        {
          name: "s",
          columns: [{ key: "id", header: "ID" }],
          data: [{ id: 0 }],
        },
      ],
    });
  });

  it("10k rows × 4 cols WASM-core < 200ms (4列基准, 回归下限)", async () => {
    // 4 列基准（见 1.2 列数缩放规则）。生产路径对 10k 行路由 worker（pickMode 浏览器≥500行走 worker）。
    // Node 跑不了 Web Worker（见 beforeAll），此处用 mode:'main' 测 WASM-core 回归下限。
    // 实测（4列）：sheetAddAoa+toBuffer ≈ 99ms。端到端（含入向扁平化 4.4ms）见 7.3 Playwright。
    const t0 = performance.now();
    const r = await exportExcel({
      filename: "perf-10k",
      download: false,
      mode: "main",
      sheets: [
        {
          name: "s",
          columns: [
            { key: "id", header: "ID" },
            { key: "name", header: "Name" },
            { key: "amount", header: "Amt" },
            { key: "createdAt", header: "Date" },
          ],
          data: genRows(10_000),
        },
      ],
    });
    const dt = performance.now() - t0;
    expect(r.success).toBe(true);
    expect(dt).toBeLessThan(200 * SLACK);
  });

  it("50k rows × 4 cols WASM-core < 700ms (4列基准, 回归下限)", async () => {
    // 4 列基准。生产路径走 worker（结构化克隆入向）。Node 跑不了 Web Worker，
    // 此处用 main 模式测 WASM-core 回归下限。实测（v2.0 4列）≈ 618ms，余量 1.1x。
    // 生产 worker 端到端 = 入向结构化克隆(46ms) + worker内执行(≈618ms) + 回传(~0ms) ≈ 664ms。
    // ⚠️ 4列下余量已紧，浏览器 JIT 差异可能导致超 500ms，以 7.3 Playwright 真机为准（见 1.2 说明）。
    const t0 = performance.now();
    const r = await exportExcel({
      filename: "perf-50k",
      download: false,
      mode: "main",
      sheets: [
        {
          name: "s",
          columns: [
            { key: "id", header: "ID" },
            { key: "name", header: "Name" },
            { key: "amount", header: "Amt" },
            { key: "createdAt", header: "Date" },
          ],
          data: genRows(50_000),
        },
      ],
    });
    const dt = performance.now() - t0;
    expect(r.success).toBe(true);
    expect(dt).toBeLessThan(500 * SLACK);
  });

  it("100k rows × 4 cols WASM-core < 1000ms (4列基准, stream, 回归下限)", async () => {
    // 4 列基准。无样式 100k 路由 stream（pickMode，恒定内存防 OOM）。实测（4列）≈ 907ms，余量仅 1.1x。
    // ⚠️ 列数增加时按 1.2 缩放规则放宽：8列<2000ms / 10列<2500ms / 20列<5000ms。
    // 4列下浏览器 JIT 差异可能轻微超标，以 7.3 Playwright 真机为准；持续超标可切 stream 无样式降级。
    const t0 = performance.now();
    const r = await exportExcel({
      filename: "perf-100k",
      download: false,
      mode: "stream",
      sheets: [
        {
          name: "s",
          columns: [
            { key: "id", header: "ID" },
            { key: "name", header: "Name" },
            { key: "amount", header: "Amt" },
            { key: "createdAt", header: "Date" },
          ],
          data: genRows(100_000),
        },
      ],
    });
    const dt = performance.now() - t0;
    expect(r.success).toBe(true);
    expect(dt).toBeLessThan(1000 * SLACK);
  });

  it("format function overhead should not dominate", async () => {
    // 验证不同复杂度 format 函数对导出耗时的影响量级
    const noop = { key: "id", header: "ID" };
    const identity = { ...noop, format: (v: unknown) => v };
    const lookup = {
      ...noop,
      format: (v: unknown) =>
        (({ 0: "A", 1: "B" }) as Record<number, string>)[v as number] ??
        String(v),
    };
    const data = Array.from({ length: 10_000 }, (_, i) => ({ id: i }));
    const makeSheet = (col: typeof noop) => ({
      name: "s",
      columns: [col],
      data,
    });

    const t0 = performance.now();
    await exportExcel({
      filename: "fmt-noop",
      download: false,
      mode: "main",
      sheets: [makeSheet(noop)],
    });
    const tNoop = performance.now() - t0;

    const t1 = performance.now();
    await exportExcel({
      filename: "fmt-id",
      download: false,
      mode: "main",
      sheets: [makeSheet(identity)],
    });
    const tId = performance.now() - t1;

    const t2 = performance.now();
    await exportExcel({
      filename: "fmt-lookup",
      download: false,
      mode: "main",
      sheets: [makeSheet(lookup)],
    });
    const tLookup = performance.now() - t2;

    // format 调用在热路径上（N=10k 行 × 1 列 = 10k 次），增量应 < 20ms
    expect(tId - tNoop).toBeLessThan(20 * SLACK);
    expect(tLookup - tNoop).toBeLessThan(30 * SLACK);
  });
});
```

> 📌 **容差与 flaky**：CI 共享 Runner 性能波动大，默认给所有阈值 1.2x 容差；正式验收时设 `PERF_TIGHT=1` 走严格阈值。`beforeAll` 的预热避免把 `initWasm()` 的编译耗时计入首个 case——否则首个 case 会无端超阈值 100ms+。
>
> ⚠️ **worker 模式为何不在 Node 测试（M5 修正）**：经源码核实，`modern-xlsx.worker.js` 与本库 `export.worker.ts` 都用 Web Worker 全局（`globalThis.addEventListener('message')` / `self.onmessage` / `postMessage`），Node 的 `worker_threads` 用 `parentPort`，两者不兼容。因此 5 万行（worker 路径）与 10 万行带样式（worker 路径）的**端到端耗时 + 主线程阻塞 ≤16ms** 必须在 7.3 的浏览器集成测试（Playwright）中验收。Node 套件的 50k/100k case 仅作 WASM-core 回归下限，**不能当作 worker 端到端验收通过的依据**——worker 端到端 = main 工作量 + 入向结构化克隆（5 万行 35-100ms，见附录 A）+ Worker 启动 + 出向回传，系统性高于 main 测出的数值。

### 7.3 集成测试

- **浏览器端（功能）**：Playwright 跑一个 demo 页面，点击导出，验证下载文件可被 Excel/LibreOffice 打开、行列数正确。
- **浏览器端（worker 路径端到端 + 主线程预算，S3 关键验收点）**：分别用 5 万行（`mode:'worker'`，阈值 < 500ms）与 10 万行（`mode:'worker'`，阈值 < 1000ms，**最紧张验收点**，见 1.2 ⚠️ 与附录 A 余量仅 1.3-2.2x）触发导出，通过 `PerformanceObserver({ entryTypes: ['longtask'] })` 记录导出期间 >50ms 的长任务数量并断言为 0（即满足 ≤16ms 主线程阻塞预算）；同时记录端到端耗时达标。worker 路径的端到端验收**只能在此处**进行（7.2 Node 套件无法覆盖，见该节 M5 说明）。
- **Node 端（回读校验）**：用 `readBuffer` 读回导出文件，校验单元格值与样式 `styleIndex` 是否命中预期 `cellXfs`。

**Playwright 测试骨架（5 万行 + 10 万行 worker 端到端验收 + 降级）**：

```ts
import { test, expect } from "@playwright/test";

test("worker-mode 5万行 × 4列: 端到端 < 700ms 且无 longtask (4列基准)", async ({
  page,
}) => {
  // 4 列基准（见 1.2 列数缩放规则）。列数增加时按 budget(4列)×(C/4) 放宽阈值。
  await page.goto("/demo");
  // 注入 PerformanceObserver 在页面中监控 longtask
  await page.evaluate(() => {
    (window as any).__longTasks = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) (window as any).__longTasks++;
      }
    }).observe({ entryTypes: ["longtask"] });
  });
  // 触发导出，页面内部调 exportExcel({ mode: 'worker', ... })
  const [result] = await Promise.all([
    page.evaluate(() => (window as any).trigger50kExport()),
    page.waitForEvent("download", { timeout: 10000 }),
  ]);
  // 断言端到端耗时（4列基准；列数缩放见 1.2 规则）
  expect(result.duration).toBeLessThan(700);
  // 断言主线程无 >16ms 阻塞（PerformanceObserver 检测 longtask > 50ms）
  const longTasks = await page.evaluate(() => (window as any).__longTasks);
  expect(longTasks).toBe(0);
});

test("worker-mode 10万行 × 4列: 端到端 < 2000ms 且无 longtask (4列基准, 最紧张验收点)", async ({
  page,
}) => {
  // 4 列基准（见 1.2 列数缩放规则）。列数增加时按 budget(4列)×(C/4) 放宽阈值。
  // 此 case 对应 1.2 表中标 ⚠️ 的最紧验收点。附录 A 自评余量仅 1.3-2.2x，
  // 若逼近上限，按附录 A 优化方向（减 format 开销 / 预分配 styleIndex / stream 阈值下调）。
  // 注意：100k 带样式走 worker（pickMode 见 4.10）；100k 无样式走 stream，stream 路径
  // 主线程天然不阻塞（逐行写入在 WASM），但端到端耗时仍在此验收。
  await page.goto("/demo");
  await page.evaluate(() => {
    (window as any).__longTasks = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) (window as any).__longTasks++;
      }
    }).observe({ entryTypes: ["longtask"] });
  });
  const [result] = await Promise.all([
    page.evaluate(() => (window as any).trigger100kExport()),
    page.waitForEvent("download", { timeout: 30000 }),
  ]);
  expect(result.duration).toBeLessThan(2000);
  const longTasks = await page.evaluate(() => (window as any).__longTasks);
  expect(longTasks).toBe(0);
});

test("worker-mode WASM 初始化失败时触发降级", async ({ page }) => {
  await page.goto("/demo?wasmFail=1");
  const result = await page.evaluate(() => (window as any).triggerExport());
  expect(result.success).toBe(true);
  expect(result.engine).toBe("sheetjs");
});
```

> 📌 **demo 页面与触发钩子**：上述 `trigger50kExport()` / `trigger100kExport()` / `triggerExport()` 需由一个 Playwright 专用 demo 页面提供（在 `apps/demo` 或 `packages/excel-exporter/demo`，Phase 1 预研阶段搭建）。钩子内部调 `exportExcel({ mode: 'worker', sheets: [{...数据...}] })` 并把 `ExportResult` 挂到 `window` 供断言读取。`wasmFail=1` query 用于注入错误的 `wasmUrl` 触发降级路径（4.12）。**所有触发钩子默认用 4 列基准数据**（与 1.2 列数缩放规则一致）；如需测试更多列，在 query 参数指定（如 `?cols=10`），阈值按 `budget(4列)×(cols/4)` 放宽。
>
> ⚠️ **10 万行 timeout**：`waitForEvent('download', { timeout: 30000 })` 给足 Worker 端到端 + WASM 编译 + ZIP 序列化的时间。若 CI 频繁超时，先排查是否首次导出未预热（WASM 编译尖峰），参考 5.2 策略 2（主线程 + Worker 并发预热）。

---

## 八、实施计划与里程碑

| 阶段                   | 周期        | 关键交付物                   | 验收标准                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ----------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1：技术预研      | 第 1-2 周   | 选型报告、Vue3+Vite Demo     | modern-xlsx 在 Vite 中跑通 WASM 加载 + 批量导出；**worker 自包含打包 go/no-go 关卡（S5）**：tsup 把 modern-xlsx 打进 `export.worker.mjs` 后，`new Worker(url,{type:'module'})` 能正常加载且 worker 内 `initWasm(wasmUrl)` 成功（实测 esbuild 对 `new URL("modern_xlsx_wasm_bg.wasm", import.meta.url)` 原样保留，技术路径成立，但必须真机验证产物可运行） |
| Phase 2：Monorepo 搭建 | 第 3 周     | pnpm+turbo+tsup+lint+CI 骨架 | `pnpm build/test/lint` 全绿，CI 通过                                                                                                                                                                                                                                                                                                                      |
| Phase 4：Worker + 流式 | 第 7-8 周   | Worker 多线程、流式写入      | **4 列基准（v2.0 口径）**：1万行 worker 端到端 < 200ms；5万行 worker 端到端 < 700ms 且无 longtask；10万行 worker+stream 端到端 < 2000ms 且无 longtask（7.3 Playwright 验收，列数缩放见 1.2 规则）；10 万行 stream 不 OOM；**worker 自包含打包 go/no-go 必须在 Phase 1 通过（见上），否则 Phase 4 无法验收**                                               |
| Phase 4：Worker + 流式 | 第 7-8 周   | Worker 多线程、流式写入      | **4 列基准**：5 万行 worker 端到端 < 500ms 且无 longtask；10 万行 worker 端到端 < 1000ms 且无 longtask（7.3 Playwright 验收，列数缩放见 1.2 规则）；10 万行 stream 不 OOM                                                                                                                                                                                 |
| Phase 5：首个 App 接入 | 第 9-10 周  | admin-a 接入上线             | 线上稳定无报错，降级率 < 1%                                                                                                                                                                                                                                                                                                                               |
| Phase 6：全面推广      | 第 11-12 周 | 所有 App 接入                | 接入率 100%，沉淀文档与监控                                                                                                                                                                                                                                                                                                                               |

**v0.1 发布节点（Phase 3 末）** 即可对外可用（main 模式 + 样式），Worker/流式在 v0.2 补齐。

---

## 九、风险与应对

| 风险                         | 概率 | 影响 | 应对                                                  |
| ---------------------------- | :--: | :--: | ----------------------------------------------------- |
| WASM 加载失败（CDN/网络）    |  中  |  高  | 自托管 `.wasm`；3 次指数退避重试；失败降级 SheetJS    |
| 浏览器不支持 WASM            |  低  |  高  | `WebAssembly` 能力检测，直接走 SheetJS                |
| Worker 序列化开销大          |  中  |  中  | 仅 ≥5000 行启用 Worker；阈值可配置                    |
| modern-xlsx 版本不兼容       |  低  |  中  | 锁定 `^1.2.0`；升级走 Changeset minor 流程 + 回归测试 |
| 大文件 OOM                   |  中  |  高  | ≥10 万行走 `StreamingXlsxWriter`；监控内存            |
| 颜色/样式在 Excel 中显示异常 |  低  |  中  | 用 6 位 RGB hex（不带 `#`）；样式单测 + 真机抽样验证  |
| SheetJS 降级路径缺少样式     |  中  |  低  | 可接受；监控降级率，逐步修复 WASM 加载根因            |

---

## 十、附录

### 附录 A · 性能数据来源与口径（v1.9 重写）

> 🚨 **v1.9 整体重写**：v1.3 的五段模型基于"toBuffer 100-150ms"的错误估算，且全部采用同进程热状态数字，未发现首次惩罚。v1.9 用独立进程实测后，下表所有数字均为**独立进程首次跑**（最贴近真实浏览器首次导出），与正文 1.2 验收表一致。

**核心实测数据（modern-xlsx@1.2.0，Node 22，4 列，独立进程首次跑，每个数字多次稳定）**：

| 指标                     | 独立进程实测（首次） | 同进程第二次（热状态） | 数据来源                                  |
| ------------------------ | -------------------- | ---------------------- | ----------------------------------------- |
| Workbook 路径 1 万行     | 113–119 ms           | ~70 ms                 | 实测（sheetAddAoa + toBuffer）            |
| Workbook 路径 5 万行     | 648 ms               | ~310 ms                | 实测                                      |
| Workbook 路径 8 万行     | **8356 ms** ⚠️       | —                      | 实测（塌方起始）                          |
| Workbook 路径 10 万行    | **17578 ms** ⚠️⚠️    | ~628 ms                | 实测（塌方，5 个独立进程稳定 17.3-18.3s） |
| Stream 路径 10 万行      | **1630 ms**          | —                      | 实测（writeRow 循环 + finish）            |
| Stream finish() 10 万行  | **~93 ms**（92–128） | —                      | v2.0 二次实测（v1.9 误记为 3ms）          |
| 结构化克隆 10 万行       | 94 ms                | —                      | 实测（structuredClone，中位）             |
| 结构化克隆 5 万行        | 46 ms                | —                      | 实测                                      |
| 结构化克隆 1 万行        | 9 ms                 | —                      | 实测                                      |
| drawTableFromData 5 万行 | 471 ms               | —                      | 实测（build + toBuffer，未进塌方区）      |

**关于"首次惩罚"与"热状态"的差异（v1.9 关键发现）**：

`Workbook.toBuffer()` 在 ≥8 万行存在巨大的首次/热状态差异。独立进程首次跑 10 万行 17.5 秒，同进程第二次仅 628ms，相差 28 倍。这**不是** WASM 编译热身（`initWasm` 只占 3-4ms），而是 `toBuffer` 内部在大 workbook 序列化时的性能塌方——可能源于 ZIP 压缩或 shared strings 处理的超线性路径，具体成因列为 Phase 1 头号调研项。`WriteOptions` 只有 `password`，无压缩级别等可调参数，**无法通过 API 规避**。

**结论与方案选择**：

- **≤5 万行**：Workbook 路径首次 648ms，稳态 310ms，余量充足 → 用 Workbook（支持完整 StyleBuilder 样式）。
- **≥8 万行**：Workbook 首次塌方（8 万 8s / 10 万 17s），完全不可接受 → **必须走 Stream**（首次 ~1,548ms，是 Workbook 的 1/10）。
- **5-8 万行**：风险区。v1.9 保守地把 stream 阈值定在 5 万，彻底避开塌方边界的不确定性。

**关于官方 README benchmark**：README「写 10 万行 232ms / 5 万行 49ms」**只测 `aoaToSheet`（不含 toBuffer），且是热状态**。不可用作端到端验收依据，更不能据此外推 toBuffer 开销（v1.3 据此外推 100-150ms 是错的，首次实测 17 秒）。

> 📌 **Worker 入向结构化克隆开销（v1.9 实测，修正 v1.8 的 163ms）**：v1.8 声称"10 万行结构化克隆 163ms"是被高估的错误数字（v1.8 据此引入 flat-encoder）。v1.9 实测中位 94ms（5 次测量 92-106ms 稳定）。这个开销在 Worker 端到端里占比：① 10 万行 Workbook 路径首次 17.5s 中占 0.5%；② 10 万行 Stream 路径 1.6s 中占 6%。无论哪种，结构化克隆都不是瓶颈，**无需扁平化优化**（扁平化反而引入硬伤 3 的数据损坏）。

### 附录 B · 与参考 PDF 的差异修正（重要）

参考 PDF 整体方向正确，但部分 API 调用与实际 modern-xlsx@1.2.0 不符。本文档已逐一修正，列出以备追溯：

| PDF 中的写法                                            | 实际 API（已核实）                                                       | 修正说明                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ws.cell(0, colIndex)` 数字坐标                         | `ws.cell('A1')` A1 字符串                                                | `cell(ref: string)` 只接收 A1 ref                                                                                                                                                                                           |
| `ws.batch().writeRows(1, rowData)`                      | `aoaToSheet(aoa)` / `sheetAddAoa(ws, aoa, {origin})`                     | 不存在 `batch()` 方法；批量写靠工具函数                                                                                                                                                                                     |
| `ws.mergeRange(startRow, startCol, endRow, endCol, '')` | `ws.addMergeCell('A1:D1')`                                               | 合并只接收 A1 range 字符串                                                                                                                                                                                                  |
| `ws.setFreezePanes(n, 0)`                               | `ws.frozenPane = { rows: n, cols: 0 }`                                   | 通过 setter，不是方法                                                                                                                                                                                                       |
| `setColumnWidth(colIndex, ...)` 0-based                 | `setColumnWidth(col, width)` **1-based**                                 | PDF 写法存在 off-by-one                                                                                                                                                                                                     |
| 自建 `export.worker.ts` + `self.onmessage`              | `createXlsxWorker` 只搬序列化；`Workbook.toJSON()` 可导出 `WorkbookData` | ⚠️ 方向**反转**：PDF 写法（自建薄 Worker）反而是本方案采用的正解——`createXlsxWorker.writeBuffer(wb.toJSON())` 技术可行，但只把 ZIP 序列化搬到 Worker，`aoaToSheet` 构造 + 整列样式赋值仍跑主线程，突破 ≤16ms 预算（见 4.9） |
| `wb.toBuffer()` 后手动 `new Blob([buffer])`             | `writeBlob(wb)` 直接返回 Blob                                            | 浏览器场景有更简洁 API                                                                                                                                                                                                      |
| WASM 体积「1.1MB」                                      | 实际 `.wasm` 文件 1.9MB（README 1.1MB 为压缩前理论值）                   | 体积评估按 1.9MB                                                                                                                                                                                                            |
| `s.font({}).build(wb.styles)` 链式                      | ✅ 正确                                                                  | StyleBuilder 链式 API 属实                                                                                                                                                                                                  |
| `wb.createStyle()`                                      | ✅ 正确                                                                  | 存在该方法                                                                                                                                                                                                                  |
| `initWasm()` 幂等                                       | ✅ 正确                                                                  | README 明确 safe to call multiple times                                                                                                                                                                                     |
| benchmark 数字（232/49/472ms）                          | ✅ 与官方 README 完全一致                                                | 数字属实                                                                                                                                                                                                                    |
| —（PDF 未提及）                                         | `Workbook.toJSON(): WorkbookData`                                        | 核心序列化方法存在，`writeBlob` 内部即 `wb.toJSON()`                                                                                                                                                                        |

### 附录 C · 关键依赖版本清单（建议锁定）

| 依赖               | 版本                          | 用途                                                                                             |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| modern-xlsx        | ^1.2.0                        | 核心引擎                                                                                         |
| xlsx（SheetJS CE） | >=0.18.5（npm latest 即此版） | 降级方案（optional peerDep）；v1.9 从 >=0.20.0 放宽，避免 strict-peer-dependencies 报错，见 4.12 |
| typescript         | ^5.6.3                        | 语言                                                                                             |
| tsup               | ^8.3.5                        | 包构建                                                                                           |
| vitest             | ^2.1.6                        | 测试                                                                                             |
| turbo              | ^2.3.3                        | Monorepo 编排                                                                                    |
| pnpm               | 9.12.0                        | 包管理（packageManager 字段）                                                                    |
| @changesets/cli    | ^2.27.10                      | 版本/发布                                                                                        |
| eslint             | ^9.16.0                       | Lint（flat config）                                                                              |

### 附录 D · 后续扩展预留

本包是 monorepo 的第一个包。后续可平滑新增：

```
packages/
├── excel-exporter/      # 本期
├── pdf-exporter/        # 预留：PDF 导出（如基于 pdf-lib/wasm）
├── file-uploader/       # 预留：统一上传（分片/秒传）
├── table-renderer/      # 预留：虚拟表格渲染
└── _shared/             # 预留：共享 tsconfig/eslint/prettier
```

扩展规范：

1. 新包遵循同样的 `package.json` 模板（exports/types/tsup 配置）。
2. 跨包依赖用 `workspace:*`，Changesets 会自动联动 bump。
3. 共享配置抽到 `packages/_shared/*`，通过 `devDependencies` 引用。
4. CI/CD 无需改动：`turbo.json` 的 `^build` 依赖图自动处理构建顺序。
5. 每个包独立发版，互不阻塞（Changesets 的核心能力）。

### 附录 E · drawTable / drawTableFromData — modern-xlsx 内置高层 API

modern-xlsx@1.2.0 提供 `drawTable(wb, ws, opts)` 和 `drawTableFromData(wb, ws, data, opts)`，可直接从 JSON 对象数组渲染带完整样式的表格，覆盖表头/表体字体、背景色、边框、斑马纹、列宽（含 `autoWidth`）、冻结首行、自动筛选、合并单元格、单格样式覆盖等能力。

**对比**：本包 `WorkbookBuilder`（4.7）手动用 `aoaToSheet` + 逐列 `styleIndex` + `setColumnWidth` + `frozenPane` 实现相同效果，约 80 行代码。`drawTableFromData` 等效为一次调用，量级约 15 行：

```ts
import { Workbook, drawTableFromData } from "modern-xlsx";

const wb = new Workbook();
for (const config of sheets) {
  const ws = wb.addSheet(config.name);
  drawTableFromData(wb, ws, config.data, {
    headers: config.columns.map((c) => c.header),
    columnWidths: config.columns.map((c) => c.width),
    freezeHeader: true,
    autoFilter: true,
  });
}
// 注意：writeBlob(wb) 是同步 API，大文件会阻塞主线程（见附录 G）。
// 本库统一走异步 toBuffer() 路径：
const bytes = await wb.toBuffer();
const blob = new Blob([bytes], {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});
```

**取舍建议**：`drawTableFromData` 适用于 80% 以上的常规导出场景（单表头 + 统一列样式）。当需要非标准布局（多行表头、跨 Sheet 公式、条件格式、图表）或需要每列独立 `StyleBuilder` 构建的精细样式控制时，回退到 `WorkbookBuilder` 手动路径。`drawTableFromData` 内部也是 WASM 批量写入，性能不会比手动 AOA 差。对于仅需纯数据流式导出（无样式）的场景，仍使用 `StreamingXlsxWriter`（4.8）。建议在 `workbook-builder.ts` 中加入 `useDrawTable` 选项，默认走 `drawTableFromData`，用户可显式指定 `useDrawTable: false` 回退手动路径。

---

**文档版本**：v2.0 ｜ **核对基准**：modern-xlsx@1.2.0（npm tarball 解包 + `dist/index.d.mts` + `dist/validate-chart-D1O7LOfU.d.mts` 类型定义 + `dist/utils-Fc_qcAP_.mjs` / `dist/modern-xlsx.worker.js` 源码）+ **Node v22.22.2 独立进程二次实测**（toBuffer 塌方/stream/结构化克隆/finish 分步，共 30+ 次）｜ **最后更新**：2026-07-27（v2.0 评审修正：二次复确认 v1.9 toBuffer 塌方论断，修正 finish() 3ms→90ms、wasm-lite/wasm 文件名错误，修复 format 联合类型调用崩溃，清理 5.3/4.9 内部矛盾，性能指标对齐实测可达水平，详见顶部 v2.0 摘要与文末修订历史）

---

### 附录 F · 补充依赖与 Node 升级指引

| 依赖             | 版本    | 用途                                                           |
| ---------------- | ------- | -------------------------------------------------------------- |
| @playwright/test | ^1.62.0 | 浏览器集成测试（7.3），已纳入根 `package.json` devDependencies |

> 📌 **关于 `unplugin`**：早期版本曾列入「补充依赖」用于「Vite/Webpack 插件（6.2）」，但经核实 6.2 的 Vite 插件实现是 Vite 原生插件对象（`{ name: 'copy-modern-xlsx-assets', buildStart() {...} }`），**全程未 import `unplugin`**。已从依赖清单删除。若未来需要让 6.2 的资源拷贝逻辑同时支持 Webpack（当前仅 Vite），再按需引入 `unplugin` 并重写为 `unplugin` 工厂函数；现阶段 Vite-only 足够覆盖文档所述消费场景（3.1 选型、6.x 接入示例均以 Vite 为主）。

Node 24+ 升级：modern-xlsx@1.2.0 engines 要求 node>=24.0.0（已核实 `npm view modern-xlsx` 的 `engines.node` 字段）。推荐 fnm（`fnm install 24`），CI 已 config `node-version: 24`。

---

> **StreamingXlsxWriter 样式工具函数（Phase 3 待实现）**：为降低 stream 模式下的样式构建门槛，
> 建议在 `streaming-builder.ts` 中提供 `buildStylesXmlForStream(wb: Workbook): string` 工具函数，
> 利用 `Workbook.styles`（类型 `StylesData`）按 OOXML 规范拼接 `<styleSheet>` XML。
> 拼接逻辑约需 80-100 行代码，实现后可通过 `writer.setStylesXml(xml)` 在 stream 模式下使用预注册的 styleIndex。
> 此功能优先级为 Phase 3（核心功能稳定后实现）。

---

### 修订历史

- **v2.0（二次独立实测 + 源码核对评审修正）**：
  - **复确认**：v1.9 的 toBuffer 塌方论断二次复现成立（10万行 toBuffer 17,339ms，与 v1.9 的 17.3–18.3s 吻合）。架构方向（≥5万行走 stream）正确，保留。
  - **修正数字**：`finish()` 实测 ~93ms（非 v1.9 所写 3ms，6 次取中位 92–128）。全文 6 处 finish 3ms 已改为 ~90ms。stream 10万行全流程 ~1,548ms（writeRow ~1,451 + finish ~93）。
  - **修复代码缺陷**：format 联合类型调用 bug——4.4 定义 `FormatSpec | 函数`，但 4.7/4.8 builder 写 `col.format(raw,item)`，传 FormatSpec 对象时抛 TypeError（已最小复现）。引入 `resolveCellFormat()` 统一分流 + worker 入口剥函数。验证脚本确认 enum/number/padding + 函数 + 无 format 均正确。
  - **清理矛盾**：(a) 5.3 调度表是 v1.8 残留（10万阈值 + "扁平化入向"，与 4.10 的 5万阈值 + 结构化克隆冲突），重写对齐；(b) 4.9 format 两段自相矛盾（1263 行说改 FormatSpec，1298 行说函数进 Worker），重写为统一方案。
  - **修正事实错误**：tarball 内无 `wasm-lite/*` 目录（v1.9 虚构），删除；wasm 文件名是 `modern_xlsx_wasm_bg.wasm` 非 `modern-xlsx.wasm`（源码核实），修正 4.3 S5 关卡。
  - **性能指标调整**：原 5万<500ms / 10万<1000ms 经实测结构性不可达（5万 Workbook 618ms、10万 stream 1548ms），放宽为 5万<700ms / 10万<2000ms，合并稳态/首次为单一首次口径。1万<200ms 保留（实测 109ms）。
  - **列数缩放**：v1.9 称"误差<6%"只测 1 个点，标注为保守估算。
  - **文档治理**：5 个版本声明（v1.2/v1.3/v1.4/v1.8/v1.9）收敛为单一 v2.0。

- **v1.9（独立进程真机实测，推翻 v1.8 多项关键假设，修正 5 个硬伤 + 4 处矛盾）**：
  - **方法学修正**：v1.8 及之前所有性能数字均基于"同一进程多次运行的热状态"，掩盖了 modern-xlsx 大数据量的真实问题。v1.9 改用**独立 Node 进程**（每次只跑一次导出即退出）重测，最贴近真实浏览器首次导出。
  - **硬伤 1（最严重，1.2/附录A/附录G）**：发现 `Workbook.toBuffer()` 在 ≥8 万行存在性能塌方——独立进程首次 10 万行实测 **17.3–18.3 秒**（5 个进程稳定复现），而 v1.8 据热状态写的 744ms/907ms 预算完全不成立。阈值扫描：5万 529ms → 6万 1.6s → 8万 8.2s → 10万 17.4s → 11万 24.3s（超线性）。`WriteOptions` 无压缩级别等可调参数，无法 API 规避。**解药**：`StreamingXlsxWriter.finish()` 同规模实测 ~93ms（v2.0 修正，v1.9 误记为 3ms），stream 全流程 ~1,548ms，是 Workbook 的 1/10。
  - **硬伤 2（4.8/4.10/5.3）**：stream 地位升级——从 v1.8 的"无样式降级"升为 **≥5 万行主路径**。stream 阈值从 10 万降到 5 万（避开塌方边界）。Worker 内按 workerMode 分流 Workbook/stream。
  - **硬伤 3（4.9 删 flat-encoder）**：v1.8 的 `encodeFlat` 首行采样判列类型，混合类型列（订单号首行 number 后续 string）50% 行损坏为 null。已用最小复现确认。删除 `src/flat-encoder.ts`，回结构化克隆。
  - **硬伤 4（4.9 并发修复）**：v1.8 单例 Worker + 每次 `onmessage` 覆盖，并发请求第一次永久 pending（已复现）。改 requestId 路由 + `pending: Map`，`onmessage` 只注册一次。
  - **硬伤 5（4.9/5.5/附录A）**：v1.8 谎报结构化克隆 10 万行 163ms（实际 94ms），据此引入 flat-encoder得不偿失。实测 94ms 占 toBuffer 17 秒塌方的 0.5%，扁平化无价值。
  - **矛盾 1（附录A重写）**：v1.3 五段模型的"toBuffer 100-150ms"与正文 744ms 自相矛盾，且都未反映首次惩罚。附录 A 用独立进程实测数据重写。
  - **矛盾 2（1.2 验收表重构）**：验收表增加"首次/稳态"两套口径；10 万行首次预算放宽到 <2000ms（stream 实测 ~1,548ms），列数缩放规则限定 ≤5 万行 Workbook 路径。
  - **矛盾 4（4.2/附录C）**：peerDep `xlsx >=0.20.0` 与 npm 实际（latest 0.18.5）冲突，配合 strict-peer-dependencies=true 会 install 失败。放宽为 `>=0.18.5`。
  - **format 类型（4.4）**：Worker 模式结构化克隆不能传函数，`ColumnConfig.format` 改为 `FormatSpec | 函数` 联合类型，新增 `FormatSpec` 数据描述 + 内置 `applyFormat`。
  - **实测基准（Node 22, modern-xlsx 1.2.0, 4列, 独立进程首次）**：Workbook 1万 113ms / 5万 648ms / 8万 8356ms / 10万 17578ms；Stream 10万 ~1,548ms（writeRow ~1,451ms + finish ~93ms；v1.9 误记 finish 为 3ms）；结构化克隆 1万 9ms/5万 46ms/10万 94ms；drawTableFromData 5万 471ms。round-trip 验证 stream 产出正确（1000/50000 行用例 PASS）。

- **v1.8（实测复核修正 P1-P4 + 2 项额外发现）**：
  - **P1（1.2/4.10/5.3）**：实测推翻"main 模式守 ≤16ms"假设——1万行10列 main 实测 263ms 全阻塞（`toBuffer` 200ms + `sheetAddAoa` 63ms，均同步）。`pickMode` worker 阈值从 20k 降到 500，浏览器交互导出一律走 worker。1.2 验收表：10万行主线程预算从 ≤16ms 放宽到 ≤50ms（入向扁平化 29ms，纯前端传递达不到 16ms）。
  - **P2（4.9）**：worker 入向从 `postMessage(全量 options)`（10万行结构化克隆实测 163ms）改为 **Transferable 扁平化**（`encodeFlat`/`decodeFlat`，10万行编码 29ms）。新增 `flat-encoder.ts` 模块。WHATWG HTML spec 2.8.4 transfer 机制核实。
  - **P3（4.7）**：修 `merges` off-by-one——AOA=[headers,...rows] 表头占第0行，`encodeCellRef(m.row, m.col)` 用户传 row:0 落到表头位置；改为 `encodeCellRef(m.row + 1, m.col)`。
  - **P4（4.12/4.2/附录C）**：npm `xlsx@0.18.5` 已 4 年未更新（2022-01-26），改用 SheetJS 官方 CDN `0.20.3`（实测可访问）。peerDep 版本 `^0.18.5` → `>=0.20.0`。降级产出标记 `error: 'styles stripped'`。
  - **额外1（5.1）**：源码核实 `sheetAddAoa` 内部就是逐格 `ws.cell(ref)` 循环，"批量比逐格快 8x"论证不成立（8.4x 是 modern-xlsx vs SheetJS，非批量 vs 逐格）。修正 5.1 论证。
  - **额外2（7.2）**：实测 Node 下 `initWasm('file://...')` 抛 `fetch failed`（undici 不支持 file:// scheme），改用 `initWasmSync(readFileSync(path))`。
  - **额外3（1.2/7.2/7.3/Phase4）**：确立 **4 列为验收基准**，新增列数缩放规则 `budget(C列)=budget(4列)×(C/4)`（线性模型，校验误差<6%）。标注 4列下 5万/10万行余量仅 1.1x，建议视为目标值而非硬门禁，以 Playwright 真机为准。7.2/7.3 测试 case 标题统一标注「4列基准」，Phase 4 验收标准同步。
  - **实测基准（Node 22, modern-xlsx 1.2.0, 4列）**：main 1万99ms / 5万454ms / 10万907ms；结构化克隆 1万15.6ms/5万75.6ms/10万163ms；扁平化编码 1万4.4ms/5万16.2ms/10万28.7ms；10列1万行main 263ms（用于校验列数缩放模型）。

- **v1.6**：修正 xlsx 依赖策略，CI 添加 Playwright 安装，追加「附录 F · Node.js 升级指引」，StreamingXlsxWriter 样式 XML 构建预留方案，WASM 部署策略推荐
- **v1.7（本次评审复核修正，针对 S1-S5 + M1-M5 阻断/矛盾项）**：
  - **S1**：修复 3.3 根 `package.json` 与 4.2 子包 `package.json` 的 JSON 结构损坏（markdown 引用块嵌入 JSON、scripts/engines 错位、缩进混乱），现两份 JSON 均通过 `ConvertFrom-Json` 校验。
  - **S2**：4.2 子包统一 ESM-only——删除 `main`/`module`/exports 内所有 `require` 分支与 `.cjs` 产物路径（tsup 只产 ESM + modern-xlsx `exports['.']` 无 require 分段，已核实 `npm view modern-xlsx`）。
  - **S3+M5**：重写 7.2/7.3 性能验收矩阵——明确「Node 套件守 WASM-core 回归、Playwright 守端到端 + 主线程预算」；修复 7.2 代码块结构错配（100k case 被 format case 截断）；7.3 补 10 万行 worker 端到端测试骨架（最紧张验收点）。
  - **S4**：`pickMode` 改为感知列样式——stream 仅在「无列样式」时 auto 路由（StreamingXlsxWriter 不支持 StyleBuilder，已核实类型定义），带样式的大数据量走 worker；5.3 调度表同步更新。
  - **S5**：4.3 补 worker 自包含打包 go/no-go 关卡（实测 esbuild 对 `new URL("modern_xlsx_wasm_bg.wasm", import.meta.url)` 原样保留），Phase 1 验收标准增加真机验证项。
  - **M1**：Worker 阈值正文 5K → 统一 20K（与修订历史 v1.5 对齐）。
  - **M2**：`WorkbookBuilder.toBlob()`（同步 writeBlob）改为异步 `toBuffer()` + `new Blob()`，4.10 main 模式调用与附录 E 示例同步，与附录 G「不暴露 writeBlob」声明一致。
  - **M3**：删除虚假依赖 `unplugin`（6.2 Vite 插件全程未 import，已核实）。
  - **M4**：turbo.json 补 `test:browser` 任务（cache:false）；ci.yml 补 `pnpm test:browser` step；3.11 Playwright CI 描述与 ci.yml 对齐（取消「独立 playwright.yml + 容器镜像」误导，改用官方 `install --with-deps` 模式）；根 package.json 补 `@types/node`/`@playwright/test`。
- **v1.5**：stream 模式改为仅接受显式指定，Worker 阈值 5K->20K，format 开销测试增加变体
- **v1.4**：engines 统一>=24、Playwright CI、附录F/G
- **v1.3**：附录A五段模型、附录E drawTableFromData、4.2 engines等
- **v1.2**：初版API核对与修正，./worker->./worker-utils
- **v1.1**：初始版本

### 附录 G · writeBlob 同步调用警告

modern-xlsx 的 `writeBlob(wb)` 同步执行 `wb.toJSON()` + WASM 序列化，**全程同步阻塞调用线程**。v1.9 实测：10 万行场景主线程开销独立进程首次 **17.5 秒**（塌方，见附录 A）、热状态 628ms——无论哪个都远超 ≤16ms 预算。`@marcusok/excel-exporter` 不暴露 `writeBlob`，也不在主线程调 `wb.toBuffer()`：① ≤5 万行走 Workbook + Worker；② ≥5 万行走 StreamingXlsxWriter（Worker 内，`finish()` 实测 ~90ms，v2.0 修正）。`writeBlob` / 主线程 `toBuffer` 仅存在于 Node/SSR 的 main 模式（<500 行）。
