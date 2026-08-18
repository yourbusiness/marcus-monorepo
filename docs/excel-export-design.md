# 高性能 Excel 导出引擎 · 技术开发文档

> 包名：`@marcusok/excel-exporter` ｜ 技术方案：modern-xlsx + WebAssembly ｜ 架构：pnpm Monorepo
>
> 本文档所有 API、性能数据、依赖版本均经过实际核对（modern-xlsx@1.2.0 npm tarball 解包 + `dist/index.d.mts` / `dist/validate-chart-D1O7LOfU.d.mts` 类型定义 + `dist/utils-Fc_qcAP_.mjs` / `dist/modern-xlsx.worker.js` 源码）。性能数字均经过**两次独立进程真机实测**（Node v22.22.2，4 列，独立进程首次跑），两组数据互相印证。

---

> ✅ **v2.5（当前实现）：大文件路径已切换到自研 `fast-xlsx.ts` + fflate**。原始硬指标（1万 <200ms / 5万 <500ms / 10万 <1000ms，4 列基准）已恢复为验收口径；下方 v2.0 关于 `StreamingXlsxWriter` 的 5万/10万数据为历史基线，仅用于记录 modern-xlsx 原实现的不可达原因，不再代表当前代码行为。

> 🔄 **v2.6（源码再对齐，2026-08-17）**：正文多处仍以 `WORKER_THRESHOLD = 500` 为现行口径，与 `src/index.ts` 现状（`WORKER_THRESHOLD = 20_000`，提交 0c0fbd5 起）不符——**浏览器 auto 现为 <20,000 行 main、20,000–49,999 行 worker+Workbook**（1.2 验收表、5.3 调度表、风险表等已同步修正）。4.8/4.9/4.10/7.2 的"现行源码"快照已整体刷新为当前实现：streaming-builder 薄委托 fast-xlsx（快照含完整 fast-xlsx.ts）；worker `onerror` 对坏实例 terminate 后重建、仅 reject 该实例的请求，并转发 onPhase（提交 12d47a4）；stream 路径不再要求 WASM（不支持 WebAssembly 的浏览器 ≥5 万行仍可正常导出）。4.1/4.2 快照补齐 fast-xlsx/table-export/echarts-export 与 fflate 运行时依赖。v2.5 及以前的推导过程与数据保留为历史记录，带【历史】标注。

> 🔄 **v2.7（跨路径日期口径统一 + wasm-loader 错误恢复修复 + 快照补齐，2026-08-18）**：① **日期 UTC 口径统一**——`formatDateByPattern` 原用本地分量，与 Workbook 路径 `dateToSerial`（UTC 分量）相反，非 UTC 时区下同一输入跨 5 万行阈值（及降级前后）可相差一天（UTC+8 本地 0 点的 Date 在 Workbook 路径显示前一天，实测 serialToDate 为前一日 16:00）。现改用 UTC 分量，三路径（Workbook/Stream/SheetJS）在任何时区输出一致；输入契约（ISO 字符串/`Date.UTC` 优先）已写入 `types.ts` JSDoc 与文档站。② **wasm-loader error 态修复**——原实现仅 `wasmUrl` 变化才重置 error 态，错误信息建议的「call configureWasm() to retry」实际不可行；现任何 `configureWasm` 调用都会清除 error 态并按新配置重试（ready/loading 态不受影响）。③ **stream 进度去重**——`exportFastXlsx` 不再自行上报最终 `onProgress(1)`，由 `exportExcel` 统一收尾，stream 路径不再出现两次 1。④ **快照补齐**——4.4/4.5/4.6/4.7/4.8(fast-xlsx)/4.11/4.12/4.13 的嵌入源码整体替换为现行实现（4.5 旧块无代码围栏且 JSDoc 标记损坏，一并修复）；4.2 两处与快照矛盾的文字、4.5 的 Node 初始化建议（改 `initWasmSync`）、1.2/7.3 的旧 StreamingXlsxWriter 成本模型残留、7.1 测试表均已对齐现状。

> 🚨🚨🚨 **v2.0 评审修正（基于二次独立实测 + 源码核对，修正 v1.9 遗留的错误数字、内部矛盾与代码缺陷）**
>
> v1.9 用独立进程实测发现了 toBuffer 塌方（方向正确，已二次复现确认），但 v1.9 自身遗留三类问题：(A) 几个被夸大/记串的数字；(B) 文档内部前后矛盾（5.3 调度表是 v1.8 残留、4.9 format 两段自相矛盾）；(C) 代码缺陷（format 联合类型调用会运行时崩溃）。v2.0 逐一修正，并将性能验收口径对齐**真实可达水平**（原 5万<500ms / 10万<1000ms 的硬指标经实测证明在 modern-xlsx 下结构性不可达，见 1.2 说明）。
>
> **v2.0 二次实测确认的核心事实**（Node v22.22.2，modern-xlsx@1.2.0，4 列混合类型，独立进程首次，每组 3–6 次取中位）：
>
> 1. **`Workbook.toBuffer()` 塌方属实（v1.9 判断正确）**。二次复现：10万行 toBuffer 单步 **17,339ms**（范围 17,190–17,970，与 v1.9 的 17.3–18.3s 几乎完全吻合）。塌方在 toBuffer 序列化（占 10万行总耗时 98.9%），`sheetAddAoa` 始终线性（10万行 199ms）。超二次：50k→80k 行数 ×1.6，耗时 ×14.6。**结论：≥5 万行必须走 stream，v1.9 架构方向正确。**
>
> 2. **v2.0 修正：`finish()` 不是 3ms，是 ~90ms**（v1.9 记串了，把 `create()+startSheet()` 的 ~4ms 误记为 finish）。二次实测 6 次取中位：`finish()` = **93ms**（范围 92–128）。这不改变"stream 比 workbook 快 11 倍"的大结论，但 stream 10万行全流程实测为 **~1,548ms**（v1.9 写 1630ms，误差 < 6%，吻合），其中 writeRow 循环 ~1,451ms + finish ~93ms。
>
> 3. **v1.9 的 format 联合类型调用存在运行时崩溃缺陷（v2.0 新增）**：4.4 定义 `format?: FormatSpec | 函数`，但 4.7/4.8 的 builder 代码写的是 `col.format(raw, item)`——当用户传 FormatSpec 对象（v1.9 推荐的 worker 兼容方式）时，抛 `TypeError: col.format is not a function`（已最小复现）。4.4 定义的 `applyFormat` 从未被任何 builder 调用。v2.0 修复：引入 `resolveCellFormat()` 统一分流（函数直接调，FormatSpec 走 applyFormat），并在 worker 入口剥函数。详见 4.4/4.7/4.8/4.9。
>
> 4. **v1.9 内部矛盾（v2.0 清理）**：(a) 5.3 调度表是 v1.8 残留（用 10万阈值 + "扁平化入向"），与 4.10 pickMode（5万阈值 + 结构化克隆）直接冲突，照 5.3 实现会 reintroduce v1.9 已删除的"硬伤 3"；(b) 4.9 第 1263 行说"format 是函数会 DataCloneError，改 FormatSpec"，第 1275 行又说"format 随 options 进 Worker 执行"——两段自相矛盾。v2.0 重写两处对齐。
>
> 5. **v1.9 性能指标与实测自相矛盾（v2.0 修正口径）**：1.2 验收表写"5万<500ms"，但附录 A 实测 5万行 Workbook=648ms、10万行 stream=1630ms，**用自己的数据就超了自己的预算**。且 v1.9 把 10万行拆成"稳态<1000ms / 首次<2000ms"，但"稳态"（同进程第二次）在真实浏览器几乎不存在。v2.0 合并为单一首次口径，指标对齐实测可达水平。详见 1.2。
>
> **v2.0 方案重心（与 v1.9 一致，修正细节）**：<5 万行（≤49,999）走 Workbook + Worker（带完整 StyleBuilder 样式）；≥5 万行（`STREAM_THRESHOLD=50_000`，分支 `>=`，故恰好 50000 行也走 stream）走 StreamingXlsxWriter + Worker（绕开 toBuffer 塌方，v1 暂不支持复杂样式，Phase 2 通过 `buildStylesXmlForStream()` 补齐）；扁平化编码保持删除（回结构化克隆）。详见 1.2 验收口径、4.10 pickMode、5.3 调度表（三处已对齐）。

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
> **v2.0 关键修正：验收口径合并为「首次导出」单一口径**。v1.9 把验收拆成"稳态（同进程第二次）/首次"两套，并用"稳态 <1000ms"凑 10 万行指标——但"稳态"在真实浏览器几乎不存在（用户每次点导出都是独立动作，Worker 可能已被回收）。v2.0 统一用首次口径（最贴近真实用户体验），指标对齐**实测可达水平**。
>
> **v2.0 性能指标基线调整说明（已被 v2.5 覆盖）**：原始需求为"5万行<500ms / 10万行<1000ms"。经两次独立进程真机实测证明，这两个硬指标在 modern-xlsx@1.2.0 下**结构性不可达**：① 5 万行只能走 Workbook（stream 5万实测 824ms 比 Workbook 648ms 更慢，且 stream 不支持完整样式），Workbook 5 万行 toBuffer 单步实测 512ms，加 sheetAddAoa 共 ~620ms，无优化空间（WriteOptions 无压缩级别可调）；② 10 万行只能走 stream（toBuffer 塌方 17 秒），stream 全流程实测 ~1,548ms。v2.5 因此不再使用 modern-xlsx streaming，改用自研 fflate minimal writer，恢复原始硬指标。

**验收口径表（v2.0，首次导出，4 列基准）**：

| 数据量  | 端到端耗时上限（目标） | 主线程阻塞                                | 路由                                            | v2.5 本机实测（Node，auto 路径） |
| ------- | ---------------------- | ----------------------------------------- | ----------------------------------------------- | -------------------------------- |
| 1 万行  | < 200 ms               | ~120 ms 量级（v2.6：现行走 main，见下注） | main（浏览器 auto <20,000 行；Node <50,000 行） | ~117ms（余量 ~1.7x）             |
| 5 万行  | **< 500 ms**           | ≤ 50 ms（worker 入向克隆）                | worker + Fast stream（auto 下 50000 起切流）    | ~377ms（余量 ~1.3x）             |
| 10 万行 | **< 1000 ms**          | ≤ 100 ms（worker 入向克隆）               | worker + Fast stream（`fast-xlsx.ts`）          | ~762ms（余量 ~1.3x）             |
| 失败率  | 内存溢出失败率 = 0     | —                                         | Fast stream 单文件内存可控                      | round-trip 校验通过              |
| 复用率  | 所有 App 接入率 100%   | —                                         | 共享包                                          | —                                |

> **v2.6 路由口径变更**：v2.0 表原按 `WORKER_THRESHOLD=500` 把 1 万行路由到 worker（主线程阻塞预算 ≤16ms 由入向克隆 9ms 支撑）。现行 `WORKER_THRESHOLD=20_000`（提交 0c0fbd5）下，浏览器 1 万行 auto 走 **main**，主线程阻塞约 120ms 量级（Node 实测 ~117ms，4 列）——产品决策为「<20,000 行接受主线程短阻塞、≥20,000 行才进 Worker」（见 README「Worker 阈值 20,000 行」）。5 万/10 万行仍为 worker 路径，主线程阻塞预算（克隆 46/94ms）不变。

> **关于实测口径（v2.4 修订）**：1.2 表与 5.3 调度表中的实测耗时（1万 109ms / 5万 ~850ms（stream）/ 10万 1,548ms）均为 **Node 单线程 WASM-core 计时**（`sheetAddAoa`+`toBuffer` / `writeRow`+`finish`），作为 worker 内等价 WASM 工作的代理依据——worker 线程执行的是同一套 WASM 调用，耗时相当；但 worker 端到端还叠加入向结构化克隆（1万 9ms / 5万 46ms / 10万 94ms）、Worker 启动与 WASM 首次编译、出向 Transferable 回传，**从未实测**，属 7.3 Playwright 计划（当前未实现，见该节）。表中「端到端耗时上限」为验收目标值，其达成须以 7.3 浏览器端到端为准，不能由 Node WASM-core 数字直接断定。

> **关于主线程阻塞预算（v2.6 修订）**：浏览器交互导出中 **≥20,000 行**（现行 `WORKER_THRESHOLD`，提交 0c0fbd5 起；v2.0 时为 ≥500 行）在 Worker 线程执行 WASM 工作，主线程只做一次 `postMessage(options)` 结构化克隆。实测结构化克隆开销：1万行 9ms / 5万行 46ms / 10万行 94ms。据此 5 万行预算 ≤50ms、10 万行 ≤100ms；<20,000 行的浏览器导出（含 1 万行）现行走 main，主线程阻塞约 120ms 量级（见上方 v2.6 路由口径变更注）。Worker 内无论 Workbook 还是 stream，耗时都不阻塞主线程。 另注：`PerformanceObserver` 的 `longtask` 条目以 50ms 为固定阈值，7.3 用它断言「无 longtask」，**无法分辨 16–50ms 区间的主线程占用**。

**列数缩放规则（仅 Workbook 路径，auto 路由为 <5 万行即 ≤49,999 行）**：

> **v2.0 修正**：v1.9 称此线性模型"校验误差 < 6%"，实际只测了 1 个数据点（1万行10列 vs 4列），样本量不足以支撑通用结论。toBuffer 在列数维度的增长特性未独立验证。以下线性模型应视为**保守估算**，实际列数 ≥8 时以浏览器环境实测为准（7.3 Playwright 方案为未来计划，当前未实现）。

> **budget(C 列) ≈ budget(4 列) × (C / 4)**（估算，非保证）

| 列数             | 1 万行预算 | Workbook 预算（≤4.9999 万行）¹ |
| ---------------- | ---------- | ------------------------------ |
| **4 列（基准）** | < 200 ms   | < 700 ms                       |
| 8 列             | < 400 ms   | < 1400 ms                      |
| 10 列            | < 500 ms   | < 1750 ms                      |
| 20 列            | < 1000 ms  | < 3500 ms                      |

> ¹ **此列是 Workbook 路径（auto 下 ≤49,999 行）的列数缩放预算**，实测基准点为 5 万行（648ms，见下方实测表）。注意 auto 模式下恰好 50000 行已切 stream（`STREAM_THRESHOLD=50_000`，分支 `>=`），Workbook 的 auto 实际适用范围为 ≤49,999 行；此处的"5 万行预算"是 Workbook 路径的性能外推参考，不表示 auto 模式 50000 行走 Workbook。

> **stream 路径（≥5 万行）的列数缩放不适用线性模型**（v2.7 注：现行 fast-xlsx 的成本模型如下；旧文按已退役的 StreamingXlsxWriter 描述为「writeRow 循环 + `finish()`（WASM ZIP）」，该实现自 v2.5 起不再使用）：stream 耗时 = 逐单元格 `displayValue` 格式化 + worksheet XML 字符串拼接（与**单元格数**线性相关）+ fflate 同步压缩（与数据量弱相关的常数开销）。列数增加线性抬高前两步的 JS 开销。stream 路径的列数预算以浏览器环境实测为准（7.3 Playwright 方案为未来计划，当前未实现）。

**实测数据对照（v2.0 二次实测，modern-xlsx@1.2.0，Node v22.22.2，4 列混合类型，独立进程首次，每组 3–6 次取中位）**：

| 数据量  | sheetAddAoa | toBuffer / finish | Workbook 总计 | Stream 总计                                | 选用                                     |
| ------- | ----------- | ----------------- | ------------- | ------------------------------------------ | ---------------------------------------- |
| 1 万行  | 22 ms       | 87 ms             | **109 ms**    | 184 ms                                     | Workbook（更快）                         |
| 5 万行  | 113 ms      | 512 ms            | **618 ms**    | 824 ms                                     | **auto→Stream**（Workbook 更快，见下注） |
| 6 万行  | 132 ms      | 1,500 ms          | 1,632 ms      | —                                          | **临界区**（toBuffer 开始超线性）        |
| 8 万行  | 169 ms      | **7,450 ms**      | 7,648 ms      | ~1,300 ms                                  | **Stream**（Workbook 已塌方）            |
| 10 万行 | 199 ms      | **17,339 ms**     | 17,541 ms     | **1,548 ms**（writeRow 1,451 + finish 93） | **Stream**                               |

> **塌方边界的业务含义**：`Workbook.toBuffer()` 的性能塌方起始点在 5.5–6 万行之间（5万 512ms 尚可，6万 1,500ms 开始超线性，8万 7,450ms 已崩）。v2.0 将 stream 的 auto 路由阈值定在 **5 万行**（保守，留 buffer），即 50000 行起一律走 stream（`STREAM_THRESHOLD=50_000`，分支为 `>=`，故恰好 50000 行也走 stream）；<50000 行（≤49,999）用 Workbook（支持完整 StyleBuilder 样式，且更快）。注意：恰好 50000 行时 Workbook 实测 618ms 仍快于 stream 824ms 且未塌方，但 auto 出于保守提前切流——若需在 50000 行用 Workbook 的完整样式，可用 `mode:'main'`（主线程阻塞 ~650ms）或拆分为 ≤49,999 行/文件。
>
> **toBuffer 单步耗时占比**：10 万行场景 toBuffer 占 Workbook 路径总耗时 98.9%（17,339ms / 17,541ms），sheetAddAoa 始终线性（~2.1 µs/行，10万行仅 199ms）。塌方在 WASM 序列化，非数据摄入。

> **官方 benchmark 口径修正**：README「5 万行 49ms / 10 万行 232ms」**只测 `aoaToSheet`，不含 `toBuffer`**，且是热状态数字。不可直接用作端到端验收依据。

> **5 万行 Workbook 计时口径**：本表「Workbook 总计」5 万行 618ms 为 v2.0 单次分步实测（`sheetAddAoa` 113ms + `toBuffer` 512ms，分步之和 625ms，与端到端 618ms 的 7ms 差为分步/整体计时差）。附录 A 多次取中位 648ms 为正文 1.2/5.3 采用的首次口径基准；618（单次）与 648（中位）差异 ~4%，属独立进程运行波动。

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

| 维度                              | 实际情况                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本                              | `1.2.0`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| License                           | MIT（开源免费）                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 仓库                              | `github.com/ABCrimson/modern-xlsx`                                                                                                                                                                                                                                                                                                                                                                                                              |
| 运行时要求                        | Node.js 22+（实际 CI 与 .nvmrc 为 22，见附录 F） / Bun / Deno / 现代浏览器（需 WASM 支持）                                                                                                                                                                                                                                                                                                                                                      |
| 运行时依赖                        | **零**（peerDependencies 为空）                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 产物体积（README 口径）           | ESM 133 KB + IIFE 60 KB + WASM **1.1 MB**（gzip 前）                                                                                                                                                                                                                                                                                                                                                                                            |
| 实际产物（v2.1 tarball 解包核实） | `dist/index.mjs`(3.6KB re-export) + `dist/utils-Fc_qcAP_.mjs`(263KB 核心逻辑；`import from "../wasm/modern_xlsx_wasm.js"`，`detectWasmUrl()` 引用 `modern-xlsx.wasm`) + `dist/src-B2SjP9PA.mjs`(7.5KB stream/worker) + `dist/modern-xlsx.min.js`(79KB IIFE) + `dist/modern-xlsx.wasm`(**2,000,604 字节 ≈ 1.9MB**，未压缩) + `dist/index-lite.mjs`(7.5KB，只读精简入口，`import from "../wasm-lite/modern_xlsx_wasm.js"`，用**独立的更小 wasm**) |

> **体积修正**：参考 PDF 称「WASM 1.1MB」，该数字是 README 中给出的**压缩前理论值**；实际 npm 包内 `.wasm` 文件为 **1.9MB**（gzip 后传输体积约 600–700KB，具体取决于服务器压缩）。生产环境务必按 1.9MB 评估 `Content-Length`，按 ~700KB 评估下载耗时。

> **v2.1 wasm 文件名 / wasm-lite 修正（推翻 v2.0 的反向错修，已按实际 tarball 复核）**：v2.0 修订历史称"tarball 内无 `wasm-lite/*` 目录、文件名是 `modern_xlsx_wasm_bg.wasm` 非 `modern-xlsx.wasm`"，两条均与 tarball 不符，v2.1 更正：
>
> 1. `wasm-lite/` 目录**真实存在**，内含 `modern_xlsx_wasm.js` + `modern_xlsx_wasm_bg.wasm`（1,877,118 B ≈ 1.88MB，独立于主 wasm）。`./lite` 入口 `dist/index-lite.mjs` 即 `import from "../wasm-lite/modern_xlsx_wasm.js"`。v1.9 的"wasm-lite/* 1.88MB"原本正确，v2.0 误删。
> 2. **两个文件名并存**：`dist/modern-xlsx.wasm`（2,000,604 B，主/lite 入口 `detectWasmUrl()` 引用它）与 `wasm/modern_xlsx_wasm_bg.wasm`（2,000,604 B，wasm-bindgen glue 默认 `new URL("modern_xlsx_wasm_bg.wasm", import.meta.url)`）。`dist/modern-xlsx.worker.js` 内部 glue 用 `modern_xlsx_wasm_bg.wasm`，而 6.2 部署策略与 `configureWasm({ wasmUrl })` 用 `modern-xlsx.wasm`——两者都是有效文件，非"非此即彼"。
> 3. 本库通过显式 `wasmUrl` 注入，部署用 `dist/modern-xlsx.wasm`。该文件可被主入口加载，已由 [setup.ts](packages/excel-exporter/src/__tests__/setup.ts) 的 `initWasmSync(readFileSync(dist/modern-xlsx.wasm))` 验证（Vitest 套件全过）。

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

> **modern-xlsx 的多入口（已核实 `exports` 字段）**：除主入口 `.`（ESM `dist/index.mjs` + WASM 1.9MB）外，包还导出：
>
> - `./lite`（`dist/index-lite.mjs`，7.5KB）：精简构建，**只读不支持样式写入**。v2.1 核实（推翻 v2.0）：lite 入口 `import from "../wasm-lite/modern_xlsx_wasm.js"`，用的是**独立的更小 wasm**（`wasm-lite/modern_xlsx_wasm_bg.wasm`，1,877,118 B ≈ 1.88MB），并非复用主 wasm——v1.9 的“wasm-lite/* 1.88MB”原本正确，v2.0 误删。本库需要写样式，故不采用。
> - `./browser`（`dist/modern-xlsx.min.js`，79KB IIFE）：浏览器全局脚本入口（`unpkg`/`jsdelivr` 指向它），适合无打包器的直引场景；本库走 ESM bundler 链路，不用。
> - `./worker`（`dist/modern-xlsx.worker.js`）：**这是 modern-xlsx 自带的 WASM Worker 脚本**（`createXlsxWorker` 加载它），与本库自建的 `export.worker.js` 是两回事，命名上刻意区分（见 4.2）。

### 2.5 WASM 加载可行性

modern-xlsx 的 `initWasm()` 支持三种加载方式（已核实 `dist/utils-Fc_qcAP_.mjs` 源码 + `dist/index.d.mts` 类型 `initWasm(wasmSource?: string | URL | Response)`）：

```ts
// 1. 自动探测（默认）：IIFE 场景 detectWasmUrl() 相对 document.currentScript.src 解析；
//    ESM 场景 detectWasmUrl() 返回 undefined，由 wasm-bindgen 默认 init() 用 import.meta.url 兜底。
//    注意：detectWasmUrl() 源码只实现了 document.currentScript 分支（IIFE），
//    import.meta.url 是 wasm-bindgen 兜底，非显式实现，行为见 4.5 节说明。
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
  "engines": { "node": ">=22.0.0", "pnpm": ">=9" },
  "scripts": {
    "build": "turbo run build",
    "dev": "node scripts/dev.mjs",
    "dev:play": "node scripts/dev.mjs play",
    "dev:docs": "node scripts/dev.mjs docs",
    "build:docs": "turbo run build --filter=@marcusok/docs",
    "preview:docs": "pnpm --filter @marcusok/docs preview",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write \"**/*.{ts,tsx,js,json,md,vue}\"",
    "changeset": "changeset",
    "version-packages": "changeset version",
    "release": "turbo run lint typecheck test build && changeset publish",
    "prepare": "husky"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.10",
    "@commitlint/cli": "^19.6.0",
    "@commitlint/config-conventional": "^19.6.0",
    "@types/node": "^22.10.0",
    "@typescript-eslint/parser": "^8.18.0",
    "eslint": "^9.16.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.3",
    "eslint-plugin-vue": "^10.10.0",
    "husky": "^9.1.7",
    "lint-staged": "^15.2.10",
    "prettier": "^3.4.2",
    "tsup": "^8.3.5",
    "turbo": "^2.3.3",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.18.0",
    "vite": "^8.2.0",
    "vitest": "^4.1.10",
    "vue-eslint-parser": "^10.4.1",
    "vue-tsc": "^3.3.9"
  }
}
```

> **Node 版本说明（v2.1 修正）**：根 `package.json` 的 `engines.node` 设为 **`>=22.0.0`**（与 `.nvmrc` 的 `22`、CI 的 `node-version: 22` 一致）。核心依赖 modern-xlsx@1.2.0 的 `engines.node` 声明为 `>=24.0.0`，但其运行时目标是浏览器、WASM 核心与 Node 版本无关；本仓库在 Node 22（v22.22.2 实测）下 `lint/typecheck/test/build` 全绿（35 个测试全部通过，见 `packages/excel-exporter/src/__tests__/`）。注意：modern-xlsx README 顶部声明 "Requires a runtime with WASM support (Node.js 24+, ...)"，但无专门的 "Node Usage" 章节；Node 22 可用性由本仓库测试套件实测验证，而非 README 声明。为避免 modern-xlsx 的 engines 声明在 Node 22 下 `pnpm install` 报错，`.npmrc` 设 `engine-strict=false`（见 3.5）。CI 与本地开发统一用 Node 22（`.nvmrc` 锁定）。

> **`@types/node` 落在根 devDependencies**：本 monorepo 所有包共享 TS 基线（`tsconfig.base.json` 含 `DOM`+`WebWorker`），`@types/node`（`^22.10.0`，与 engines 对齐）在根声明一次即可被子包通过 workspace 符号链接继承，子包 `excel-exporter/package.json` 不重复声明。v2.0 曾把 `@playwright/test` 列入根 devDependencies，但本仓库当前**不包含浏览器集成测试**（7.3 的 Playwright 方案为未实现的未来计划），v2.1 已将其移除。

### 3.4 `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

### 3.5 `.npmrc`

```ini
shamefully-hoist=false
strict-peer-dependencies=true
auto-install-peers=true
; do not fail install on engine mismatch: modern-xlsx@1.2.0 declares engines.node>=24
; but its runtime target is the browser and all tests pass on Node 22 (see README).
engine-strict=false
```

### 3.6 `turbo.json`（任务编排 + 缓存）

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["tsconfig.base.json"],
  "globalEnv": ["NODE_ENV", "CI", "PERF_TIGHT", "RUN_PERF", "DOCS_BASE"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "test": {
      "outputs": []
    },
    "lint": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

> `build.dependsOn: ["^build"]` 表示「先构建依赖的内部包，再构建当前包」。`excel-exporter` 不依赖其他内部包，但保留此约定以便未来 `pdf-exporter` 依赖 `excel-exporter` 时自动排序（`apps/docs` 已实际依赖 `excel-exporter` 的构建产物，`^build` 编排生效）。
>
> **`globalEnv` 含 `PERF_TIGHT` / `RUN_PERF`**：`RUN_PERF=0` 跳过性能用例（CI 设此值，本地默认跑）。`PERF_TIGHT=1` 曾把容差从默认 1.5x 收紧到 1.0x，该机制现已移除——现行 `performance.test.ts` 的 `SLACK` 恒为 1.0（见 7.2），turbo.json 里的 `PERF_TIGHT` 声明属残留。`test` 任务不设 `dependsOn`（基准直接跑源码）、`outputs: []`；`lint`/`typecheck`/`dev` 现也声明了 `dependsOn: ["^build"]`。v2.0 曾设 `test:browser` 任务，本仓库当前无浏览器测试，v2.1 已删除。

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

根目录 `eslint.config.mjs`：

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.mxlsx-*/**",
      "**/e2e-check/**",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    // Test files: relax typed rules that are noisy in test context
    files: ["**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-base-to-string": "off",
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
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    runs-on: ubuntu-latest
    env:
      HUSKY: "0"
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        # version omitted: action reads `packageManager` from package.json
        # (pnpm@9.12.0), keeping CI in sync with local corepack.
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Lint commit messages
        if: github.event_name == 'pull_request'
        run: pnpm exec commitlint --from ${{ github.event.pull_request.base.sha }} --to HEAD
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
        env:
          RUN_PERF: "0"
      - run: pnpm build
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
    env:
      HUSKY: "0"
      RUN_PERF: "0"
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        # version omitted: action reads `packageManager` from package.json
        # (pnpm@9.12.0), keeping CI in sync with local corepack.
      - uses: actions/setup-node@v4
        with:
          node-version: 22
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
          # PAT so the Version PR triggers ci.yml. The default GITHUB_TOKEN is
          # exempt from GitHub's anti-recursion rule (it cannot trigger other
          # workflows). Create a fine-grained PAT (contents:write,
          # pull-requests:write) and store it as repo secret
          # CHANGESETS_GITHUB_TOKEN. Falls back to GITHUB_TOKEN if unset.
          GITHUB_TOKEN: ${{ secrets.CHANGESETS_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_CONFIG_PROVENANCE: "true"
          # setup-node's registry-url writes ~/.npmrc reading this var; this is
          # the token `changesets publish` -> `npm publish` actually picks up.
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**发布语义**：合并 PR 触发 `changesets/action`：若存在未消费的 changeset，它会**先开一个「Version Packages」PR**（自动改版本号+changelog）；当该 PR 被合并且无新 changeset 时，才真正执行 `pnpm release`（build + publish）。这避免了误发版。

> **npm Scope 确权**：包名 `@marcusok/excel-exporter` 依赖 `@marcusok` 组织或用户 `marcusok` 存在（发布前应运行 `npm view @marcusok/excel-exporter` 确认可用性；若需创建组织：`npm org create marcusok --defaults`）。`publishConfig` 在 4.2 `package.json` 中已配置 `access: "public"`。

> **CI 不含浏览器测试（v2.1 对齐实际）**：本仓库当前**不包含 Playwright / 浏览器端到端测试**——根 `package.json` 无 `@playwright/test`、无 `test:browser` 任务、CI 无 `playwright install`。7.3 的 Playwright worker/longtask 验收方案是**未实现的未来计划**（见 7.3）。当前回归守卫是 Vitest 的 `performance.test.ts`（7.2），通过 `RUN_PERF` 门控：CI 设 `RUN_PERF=0` 跳过性能用例（共享 runner 抖动大），本地 `pnpm test` 默认跑。

---

## 四、`@marcusok/excel-exporter` 包设计

### 4.1 包目录结构

```
packages/excel-exporter/
├── src/
│   ├── index.ts                # 对外统一 API（exportExcel/exportTable/exportEcharts）
│   ├── types.ts                # 类型定义（CellStyle/ColumnConfig/FormatSpec/SheetConfig …）
│   ├── format-utils.ts         # FormatSpec 解析与格式化（applyFormat/resolveCellFormat/displayValue/numFormatForSpec/formatDateByPattern/validateSheetName）
│   ├── wasm-loader.ts          # WASM 加载/单例/超时重试/能力检测
│   ├── workbook-builder.ts     # 主线程构建器（批量写入，<5 万行即 ≤49,999 行主路径）
│   ├── streaming-builder.ts    # 流式构建器（≥5 万行主路径；薄委托 fast-xlsx）
│   ├── fast-xlsx.ts            # 自研 minimal OOXML writer（fflate，v2.5 起大文件路径核心）
│   ├── table-export.ts         # exportTable 适配器（AntD/Element Plus 列描述符归一化）
│   ├── echarts-export.ts       # exportEcharts 适配器（类目轴/饼图/散点数据子集）
│   ├── worker-exporter.ts      # Worker 模式封装（主线程入口，产物名 worker-utils）
│   ├── workers/
│   │   └── export.worker.ts    # Worker 脚本（构建为 dist/export.worker.js）
│   ├── style-utils.ts          # CellStyle → StyleBuilder 转换
│   ├── style-presets.ts        # 业务预设样式（header/currency/date/percent …）
│   ├── fallback.ts             # SheetJS 降级实现
│   ├── download.ts             # Blob 下载工具（triggerDownload / toBlobPart）
│   └── __tests__/
│       ├── adapters.test.ts    # table-export / echarts-export 适配器
│       ├── builder.test.ts     # workbook-builder 行列/表头/冻结/合并
│       ├── fallback.test.ts    # SheetJS 降级产出可读回
│       ├── format.test.ts      # applyFormat/displayValue/FormatSpec 各类型
│       ├── performance.test.ts # 性能基准（1万/5万/10万 + format 开销）
│       ├── phases.test.ts      # onPhase 阶段打点（init/build/download）
│       ├── routing.test.ts     # pickMode 路由（main/worker/stream 阈值）
│       ├── stream.test.ts      # exportAsStream 数据完整性
│       ├── wasm-loader.test.ts # 加载器 error 态重试/重置（vi.mock，v2.7 新增）
│       └── setup.ts            # Node WASM 引导（initWasmSync）+ makeData / fourCols
├── tsup.config.ts
├── tsconfig.json
├── vitest.config.ts
├── package.json
├── README.md
└── CHANGELOG.md
```

### 4.2 `package.json`

```json
{
  "name": "@marcusok/excel-exporter",
  "version": "1.0.3",
  "type": "module",
  "description": "High-performance Excel export engine built on modern-xlsx (Rust + WASM).",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/yourbusiness/marcus-monorepo.git",
    "directory": "packages/excel-exporter"
  },
  "bugs": {
    "url": "https://github.com/yourbusiness/marcus-monorepo/issues"
  },
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./styles": {
      "types": "./dist/style-presets.d.ts",
      "import": "./dist/style-presets.js",
      "default": "./dist/style-presets.js"
    },
    "./worker-utils": {
      "types": "./dist/worker-utils.d.ts",
      "import": "./dist/worker-utils.js",
      "default": "./dist/worker-utils.js"
    },
    "./dist/export.worker.js": {
      "import": "./dist/export.worker.js",
      "default": "./dist/export.worker.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "sideEffects": false,
  "engines": {
    "node": ">=22.0.0"
  },
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
    "xlsx": {
      "optional": true
    }
  },
  "publishConfig": {
    "access": "public"
  },
  "keywords": ["excel", "xlsx", "export", "wasm", "monorepo"],
  "devDependencies": {
    "modern-xlsx": "1.2.0",
    "xlsx": "0.18.5"
  },
  "dependencies": {
    "fflate": "^0.8.3"
  }
}
```

> **v2.6 快照注**：`dependencies` 里的 `fflate` 是 v2.5 fast-xlsx 路径引入的**运行时依赖**（此前本包零运行时依赖）；`"./package.json"` 子路径导出供文档站等消费方在运行时读取版本号（0.3.0 起）。

**设计要点**：

- **ESM-only（已核实）**：本包**不设 `main`/`require`/`.cjs` 产物**。原因：① tsup config（4.3）`format: ['esm']` 只产 ESM；② 核心依赖 `modern-xlsx` 的 `exports['.']` 只有 `import`/`default` 分段、**无 require**（已核实 `npm view modern-xlsx` 的 `exports` 字段），若本包产 CJS，消费方 `require('@marcusok/excel-exporter')` 会触发 `require('modern-xlsx')` 抛 Node `ERR_REQUIRE_ESM`。`exports` 每个入口保留 `types` + `import` + `default` 三段（`default` 兜底指向同一 ESM 产物，见上方快照；v2.7 修正：旧文写「只保留 types + import 两段」与快照不符）；`package.json` 不设 `main`/`module`（ESM-only 包由 `exports.import` 解析，`main` 仅 CJS 兜底用，此处冗余且会误导）。
- `modern-xlsx` **只**声明在 `peerDependencies`（不进 `dependencies`）：WASM 模块是进程级单例，如果两份 `modern-xlsx` 被解析（库自带一份 + 宿主一份），`initWasm()` 只初始化其中一份，另一份调用 WASM 方法会静默失败。peerDep 模式保证全局只有一份实例。代价：消费方需 `pnpm add @marcusok/excel-exporter modern-xlsx` 显式安装。
- `xlsx`（SheetJS）作为 `optional` peerDependency：仅降级路径动态 `import('xlsx')`，不安装不影响主流程。`optionalDependencies` 会被 `pnpm install` 默认拉取（浪费体积），改走 peerDep + `peerDependenciesMeta.optional=true` 后消费方按需安装：`pnpm add xlsx`（仅需要降级保底时）。
- `exports` 暴露三个库 API 入口 + 一个 Worker 脚本入口：① 主入口（`.`）；② 样式预设 `./styles`（按需 tree-shake）；③ `./worker-utils`（Worker 封装，入口名刻意避开 `./worker`，以免与 `modern-xlsx.worker.js` 这个 WASM Worker 脚本混淆）；④ `./dist/export.worker.js`（自包含 Worker 脚本，供消费方 `new Worker(url, {type:'module'})` 加载，见 4.3）。**入口名、4.3 的 tsup entry、消费方 import 三处必须一致**（早期版本 `package.json` 写成 `./worker`，与 tsup entry 不一致，已修正）。
- `sideEffects: false`：让消费方的 bundler 能安全 tree-shake。
- **devDependencies 仅锁定本地开发/测试用的两个 peer**（`modern-xlsx: 1.2.0`、`xlsx: 0.18.5`，见上方快照）：子包不重复声明 `@types/node` 等构建工具（已在根 `package.json` 声明，pnpm workspace 子包通过符号链接继承）。子包自身的 dev 工具（如 `@vitest/...`）如需再用，遵循「谁用谁声明」原则。（v2.7 修正：旧文写「devDependencies 留空」与快照不符。）

### 4.3 `tsup.config.ts`（构建）

```ts
import { defineConfig } from "tsup";

// Two configs:
//  - Main entrypoints are external on modern-xlsx (consumer bundler resolves the peerDep).
//  - Worker entrypoint bundles modern-xlsx IN: browser module workers cannot resolve
//    bare specifiers like 'modern-xlsx' (WHATWG: import maps do not apply to WorkerGlobalScope),
//    so the worker script must be self-contained.
export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "style-presets": "src/style-presets.ts",
      "worker-utils": "src/worker-exporter.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: true,
    treeshake: true,
    clean: true,
    sourcemap: true,
    target: "es2022",
    external: ["modern-xlsx", "xlsx"],
  },
  {
    entry: { "export.worker": "src/workers/export.worker.ts" },
    format: ["esm"],
    dts: false,
    treeshake: true,
    sourcemap: true,
    target: "es2022",
    // Force modern-xlsx to be bundled into the worker (not left external).
    // tsup/esbuild auto-externalizes peerDependencies; without noExternal the worker
    // would ship an unresolved bare import 'modern-xlsx' and crash at runtime
    // (module workers can't resolve bare specifiers). xlsx is only used in the
    // main-thread fallback path, never in the worker.
    noExternal: ["modern-xlsx"],
    external: ["xlsx"],
    // Only the first config sets clean:true, otherwise the second wipes the first's output.
    clean: false,
  },
]);
```

> **为何 Worker 入口必须自包含（已核实）**：浏览器中 `new Worker(url, {type:'module'})` 加载的 module worker 走独立的 module script 解析，**不共享主文档的 import map**（WHATWG HTML spec：import map 仅注册在 Document 上下文，WorkerGlobalScope 无对应注册机制；Chrome/Firefox/Safari 实现一致）。因此 worker 脚本里的 `import ... from 'modern-xlsx'` 这种 bare specifier 会直接抛 `TypeError: Failed to resolve module specifier`，**运行时必崩**。**旁证**：modern-xlsx 官方的 `modern-xlsx.worker.js`（wasm-bindgen 输出，已核实源码）本身就是自包含的，不 import 任何 npm 包——这恰恰是 worker 不能依赖 bare import 的实证。本方案因此把 modern-xlsx 打包进 `export.worker.js`（约 +133KB 压缩前），换取 worker 独立可加载。代价：worker 体积增大，但仅按需加载（worker 模式才触发），且浏览器只下载一次。
>
> **为何主入口只产 ESM**：modern-xlsx 的 `exports['.']` 只有 `import`/`default`，**无 require 分段**（已核实 npm tarball `package.json`）。若本库产 CJS，消费方 `require('@marcusok/excel-exporter')` 会触发 `require('modern-xlsx')` 抛 Node `ERR_REQUIRE_ESM`。本库定位为浏览器导出引擎，消费方均为现代 ESM 工程（Vite/Rollup/webpack5），ESM-only 最干净，也与 modern-xlsx 的 `"type":"module"` 对齐。`package.json` 因此不设 `main`/`require`（见 4.2）。
>
> **`clean` 字段**：数组 config 中只有第一个设 `clean:true`，第二个设 `clean:false`。tsup 按数组顺序串行执行——第一个清空 `dist` 后产出主入口，第二个追加 worker 产物不清空。若两个都设 `clean:true`，第二个会清掉第一个的产物。
>
> **构建命令**：因采用 tsup 数组 config（per-entry external 差异化），`build` 脚本只需 `"build": "tsup"`（tsup 自动处理数组 config）。最终产物 `dist/export.worker.js`（ESM，自包含 modern-xlsx）包含在 `files` 字段内，随包发布。
>
> **S5 · Worker 自包含打包的 go/no-go 关卡**：上述「modern-xlsx 打进 worker」的技术路径已做最小验证——esbuild/tsup 打包时，modern-xlsx glue（`dist/modern-xlsx.worker.js` 源码核实）里的 `new URL("modern_xlsx_wasm_bg.wasm", import.meta.url)` 会被**原样保留**（v2.1 核实：worker.js glue 内确实是 `modern_xlsx_wasm_bg.wasm`；但 `dist/modern-xlsx.wasm` 也存在且是主入口 `detectWasmUrl()` 引用的文件，二者并存，见 2.1；实测 esbuild 不报错、不重写、不触发 asset 拷贝，因为 `.wasm` 不在 import graph 里）。运行时 worker 内 `import.meta.url` 指向 `export.worker.js`，本方案靠显式 `initWasm(wasmUrl)` 注入绕过该路径（见 4.9），故不依赖 `import.meta.url` 兜底。**但必须真机验证**：Phase 1 预研阶段需确认 ① tsup 产物 `export.worker.js` 体积合理（预期 modern-xlsx ESM ~133KB + 本库 worker 逻辑）；② `new Worker(url,{type:'module'})` 在 Chrome/Firefox/Safari 均能加载；③ worker 内 `initWasm(wasmUrl)` + `sheetAddAoa` + `wb.toBuffer()` 全链路跑通。若打包阶段报错（如 esbuild 对 wasm-bindgen glue 的 `__wbg_init` 处理异常），备选方案：worker 也 `external: ['modern-xlsx']`，改用运行时 `import(/* @vite-ignore */ url)` 动态加载或 import map（需消费方配合）。

### 4.4 类型定义 + 格式化工具（`types.ts` + `format-utils.ts`）

> 以下类型已对齐真实 API。颜色统一使用 **6 位 RGB hex（如 `'FF0000'`）**，与 modern-xlsx 的 `FontData.color` / `FillData.fgColor` 一致（非 `#FF0000`，非 8 位 ARGB）。

```ts
/**
 * Type definitions for @marcusok/excel-exporter.
 *
 * Colors use 6-digit RGB hex (e.g. `'FF0000'`), matching modern-xlsx's
 * FontData.color / FillData.fgColor / BorderSideData.color (verified from
 * dist/validate-chart-D1O7LOfU.d.mts @ modern-xlsx 1.2.0).
 */
import type { BorderStyle } from "modern-xlsx";
export type { BorderStyle };

/** Business-friendly cell style config; mapped to StyleBuilder in style-utils.ts. */
export interface CellStyle {
  font?: {
    bold?: boolean;
    italic?: boolean;
    size?: number;
    color?: string; // 6-digit RGB hex, e.g. 'FF0000'
    name?: string; // font name, e.g. 'Arial'
  };
  fill?: {
    pattern?: "solid" | "none";
    fgColor?: string; // 6-digit RGB hex
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
  numFormat?: string; // e.g. '#,##0.00', 'yyyy-mm-dd', '0.00%'
}

/**
 * Worker-compatible, data-describing format spec. Functions cannot cross the
 * structured-clone boundary into a Web Worker, so worker/stream mode accepts
 * FormatSpec only. Function form works in `main` mode (browser <20,000 rows / Node).
 *
 * Date semantics: `date`/`datetime` interpret values by their **UTC
 * components**. The workbook path serializes via modern-xlsx's `dateToSerial`
 * (UTC wall clock) and the stream/SheetJS paths format the same UTC components
 * into strings, so all paths agree in every timezone. Date-only ISO strings
 * ("2025-01-05") parse as UTC midnight per ECMA-262; prefer them (or
 * `Date.UTC(...)`) over locally-constructed Dates, whose UTC components can
 * fall on the previous day in non-UTC timezones.
 */
export type FormatSpec =
  | { type: "enum"; map: Record<string, string>; fallback?: string }
  | { type: "date"; pattern?: string } // default 'yyyy-MM-dd'
  | { type: "datetime"; pattern?: string } // default 'yyyy-MM-dd HH:mm'
  | { type: "number"; decimals?: number; thousands?: boolean }
  | { type: "padding"; fill: string; length: number; align?: "left" | "right" };

/** Column configuration. */
export interface ColumnConfig {
  key: string;
  header: string;
  /** Column width in Excel character units. Mapped to ws.setColumnWidth(col, width) (1-based). */
  width?: number;
  /** Style applied to all data cells in this column (not the header). */
  style?: CellStyle;
  /** Style applied to this column's header cell. Takes precedence over SheetConfig.headerStyle. */
  headerStyle?: CellStyle;
  /**
   * Value formatter: FormatSpec (worker-compatible) or function (main/Node only).
   *
   * Cross-path precision: a `{ type: "number" }` spec without `decimals`
   * defaults to 0, but only the stream path (>= STREAM_THRESHOLD, 50,000 rows)
   * bakes `toFixed(0)` into the stored cell value. The Workbook path keeps full
   * precision and renders decimals via numFormat, so the same spec can store
   * `9999.99` (Workbook) vs `10000` (stream). Always set `decimals` explicitly
   * for cross-threshold consistency (see docs/excel-export-design.md 4.8).
   */
  format?:
    | FormatSpec
    | ((
        value: unknown,
        row: Record<string, unknown>,
      ) => string | number | boolean);
}

/** Merge range: relative to the data area, row/col are 0-based (row 0 = first data row). */
export interface MergeRange {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

/** Sheet configuration. */
export interface SheetConfig {
  name: string; // 1-31 chars, ECMA-376 validation
  columns: ColumnConfig[];
  data: Record<string, unknown>[];
  /** Style applied to every header cell, unless overridden by ColumnConfig.headerStyle. */
  headerStyle?: CellStyle;
  /** Number of header rows to freeze (usually 1). Maps to ws.frozenPane = { rows, cols: 0 }. */
  freezeRows?: number;
  /** Merged cell ranges. */
  merges?: MergeRange[];
  /** Whether to add an auto-filter over the header range. */
  autoFilter?: boolean;
}

/** Export mode. */
export type ExportMode = "auto" | "main" | "worker" | "stream";

/**
 * Named export stages, reported through `onPhase` as they complete. Phases are
 * strictly sequential within one export call.
 *
 * - `"init"`: WASM initialization. Main-thread paths measure
 *   `loader.ensureLoaded()`; worker mode measures the worker's `initWasm()`
 *   (only reported when the worker actually re-initializes, not when its WASM
 *   instance is already cached). Not reported by the SheetJS fallback (no WASM).
 * - `"build"`: workbook construction. Covers the Workbook/stream builder, or
 *   SheetJS's sheet building + write in the fallback path. A failed modern-xlsx
 *   build followed by a SheetJS fallback reports two `"build"` phases, one per
 *   actual build attempt.
 * - `"download"`: the synchronous browser download trigger
 *   (`triggerDownload`); only reported when `download !== false`. Not reported
 *   in Node (no `document`).
 */
export type ExportPhase = "init" | "build" | "download";

/** Export options. */
export interface ExportOptions {
  sheets: SheetConfig[];
  filename: string;
  /** Mode selection: auto = auto-decide by row count (default). */
  mode?: ExportMode;
  /**
   * Progress callback (0-1). The stream path reports intermediate values every
   * 1,000 rows; other paths report only the trailing pair 0 and 1. The final 1
   * is emitted exactly once by `exportExcel` itself.
   */
  onProgress?: (progress: number) => void;
  /**
   * Optional per-stage timing callback. Receives the phase name and its
   * wall-clock duration in ms (0 means the phase did no work, e.g. WASM was
   * already loaded). Useful for metrics/play panels; does not affect
   * `ExportResult.duration` (which keeps measuring the whole export).
   */
  onPhase?: (phase: ExportPhase, durationMs: number) => void;
  /** Trigger browser download (default true). Set false to only return a Blob. */
  download?: boolean;
}

/** Export result. */
export interface ExportResult {
  success: boolean;
  blob?: Blob;
  /** Engine actually used. */
  engine?: "modern-xlsx" | "sheetjs";
  /** Mode actually used. */
  mode?: ExportMode;
  duration?: number; // ms
  rowCount?: number;
  error?: Error;
}
```

**`format-utils.ts`（FormatSpec 解析与格式化：applyFormat / resolveCellFormat / displayValue / numFormatForSpec / formatDateByPattern / validateSheetName）**

```ts
import type { ColumnConfig, FormatSpec } from "./types";
import { dateToSerial } from "modern-xlsx";

/** Default display patterns (Excel format codes) when FormatSpec omits `pattern`. */
export const DEFAULT_DATE_PATTERN = "yyyy-MM-dd";
export const DEFAULT_DATETIME_PATTERN = "yyyy-MM-dd HH:mm";

/** Safely stringify any value to a string (objects -> JSON, null/undef -> ''). */
export function toStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    return String(value);
  return JSON.stringify(value);
}

/**
 * Apply a FormatSpec to a raw value. Shared by WorkbookBuilder, StreamingBuilder,
 * and the worker entrypoint (FormatSpec is structured-clone-safe).
 */
export function applyFormat(value: unknown, spec: FormatSpec): string | number {
  switch (spec.type) {
    case "enum":
      return spec.map[toStr(value)] ?? spec.fallback ?? toStr(value);
    case "date": {
      const d = toJsDate(value);
      return d === null ? toStr(value) : dateToSerial(d);
    }
    case "datetime": {
      const d = toJsDate(value);
      return d === null ? toStr(value) : dateToSerial(d);
    }
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return toStr(value);
      // Keep full precision: the stored cell value must not be truncated.
      // Display decimals/thousands are rendered via an auto-injected numFormat
      // on the workbook path (see numFormatForSpec / withAutoNumFormat). The
      // stream/SheetJS paths (no numFormat support) bake decimals into the
      // displayed value in displayValue instead.
      return n;
    }
    case "padding": {
      const s = toStr(value);
      return spec.align === "left"
        ? s.padEnd(spec.length, spec.fill)
        : s.padStart(spec.length, spec.fill);
    }
    default:
      return toStr(value);
  }
}

/**
 * Derive an Excel numFormat code from a FormatSpec so the Workbook can render
 * typed values (date serials, numbers) with the right display format. Returns
 * null for specs that produce plain strings (enum/padding) and need no numFormat.
 */
export function numFormatForSpec(spec: FormatSpec): string | null {
  switch (spec.type) {
    case "date":
      return spec.pattern ?? DEFAULT_DATE_PATTERN;
    case "datetime":
      return spec.pattern ?? DEFAULT_DATETIME_PATTERN;
    case "number": {
      const dec = spec.decimals ?? 0;
      const head = spec.thousands ? "#,##0" : "0";
      return dec > 0 ? `${head}.${"0".repeat(dec)}` : head;
    }
    default:
      return null;
  }
}

/**
 * Format a Date (or date-coercible value) into a display string using an
 * Excel-style pattern (tokens: yyyy MM dd HH mm ss). Used by the streaming
 * path, which has no numFormat support and must emit readable date strings.
 *
 * Uses the date's **UTC components** (not local ones), matching modern-xlsx's
 * `dateToSerial` (the workbook path also derives the serial from UTC
 * components). The same input therefore renders identically on the workbook,
 * stream and SheetJS paths in every timezone. Note that date-only ISO strings
 * ("2025-01-05") parse as UTC midnight per ECMA-262, while locally-constructed
 * Dates (`new Date(2025, 0, 5)`) carry local wall time whose UTC components can
 * fall on the previous day in non-UTC timezones.
 */
export function formatDateByPattern(value: unknown, pattern: string): string {
  const d = toJsDate(value);
  if (!d) return toStr(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  // Excel format codes are case-insensitive, so normalize to lowercase first.
  // `mm` is ambiguous: minutes when it directly follows an hour token (`hh`),
  // otherwise the month. Scan the token stream once and resolve each `mm` from
  // its predecessor so `yyyy-mm-dd`, `yyyy-MM-dd` and `HH:mm:ss` all match.
  const lower = pattern.toLowerCase();
  const parts = {
    yyyy: String(d.getUTCFullYear()),
    month: pad(d.getUTCMonth() + 1),
    dd: pad(d.getUTCDate()),
    hh: pad(d.getUTCHours()),
    minute: pad(d.getUTCMinutes()),
    ss: pad(d.getUTCSeconds()),
  };
  const TOKEN = /yyyy|mm|dd|hh|ss/g;
  const hits: { tok: string; idx: number }[] = [];
  let mt: RegExpExecArray | null;
  while ((mt = TOKEN.exec(lower)) !== null) {
    hits.push({ tok: mt[0], idx: mt.index });
  }
  let out = "";
  let lastEnd = 0;
  for (let i = 0; i < hits.length; i++) {
    const { tok, idx } = hits[i];
    out += lower.slice(lastEnd, idx);
    lastEnd = idx + tok.length;
    if (tok === "mm") {
      // Minute only when directly preceded by an hour token; else month.
      out += hits[i - 1]?.tok === "hh" ? parts.minute : parts.month;
    } else {
      out += parts[tok as keyof typeof parts];
    }
  }
  out += lower.slice(lastEnd);
  return out;
}

/**
 * Resolve a column value to its display form: typed (number/boolean) when the
 * cell supports it, or a pattern-formatted string for dates. Shared by the
 * streaming path and the SheetJS fallback, which both lack numFormat support.
 */
export function displayValue(
  col: ColumnConfig,
  row: Record<string, unknown>,
): string | number | boolean {
  const spec = typeof col.format === "object" ? col.format : null;
  if (spec) {
    if (spec.type === "date" || spec.type === "datetime") {
      const pattern =
        spec.type === "datetime"
          ? (spec.pattern ?? DEFAULT_DATETIME_PATTERN)
          : (spec.pattern ?? DEFAULT_DATE_PATTERN);
      return formatDateByPattern(row[col.key], pattern);
    }
    if (spec.type === "number") {
      // Stream/SheetJS paths have no numFormat support, so the configured
      // decimals must be baked into the displayed value here. The workbook
      // path keeps full precision and renders decimals via numFormat instead.
      const n = Number(row[col.key]);
      if (!Number.isFinite(n)) return toStr(row[col.key]);
      return Number(n.toFixed(spec.decimals ?? 0));
    }
  }
  const v = resolveCellFormat(col, row);
  if (typeof v === "number" || typeof v === "boolean") return v;
  return toStr(v);
}

/**
 * Unified cell-value resolver (fixes the v1.9 format union bug): dispatches
 * function form directly, FormatSpec via applyFormat. Verified by minimal repro.
 */
export function resolveCellFormat(
  col: ColumnConfig,
  item: Record<string, unknown>,
): unknown {
  const raw = item[col.key];
  if (!col.format) return raw ?? "";
  if (typeof col.format === "function") return col.format(raw, item);
  return applyFormat(raw, col.format);
}

function toJsDate(value: unknown): Date | null {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" || typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const SHEET_NAME_FORBIDDEN = /[\\/?*[\]:]/;

/**
 * Validate a sheet name per ECMA-376 / Excel constraints. Throws on names that
 * would produce a corrupt workbook: empty, longer than 31 chars, or containing
 * any of `: \ / ? * [ ]`.
 */
export function validateSheetName(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("[excel-exporter] sheet name must be a non-empty string");
  }
  if (name.length > 31) {
    throw new Error(
      `[excel-exporter] sheet name "${name.slice(0, 31)}…" exceeds the 31-char Excel limit`,
    );
  }
  if (SHEET_NAME_FORBIDDEN.test(name)) {
    throw new Error(
      `[excel-exporter] sheet name "${name}" contains forbidden characters (: \\ / ? * [ ])`,
    );
  }
}
```

### 4.5 WASM 加载器（`wasm-loader.ts`）

设计要点：单例、幂等、超时重试、能力检测降级。`initWasm` 本身幂等（README 明确），但叠加超时与重试更稳健。

**现行源码**（`wasm-loader.ts`，v2.7 重新围栏并替换为当前实现；旧块曾无代码围栏且 JSDoc 标记损坏）：

```ts
import { initWasm } from "modern-xlsx";

export type LoadState = "idle" | "loading" | "ready" | "error";

export interface LoaderOptions {
  /** Self-hosted WASM URL. Strongly recommended in production to avoid CDN drift. */
  wasmUrl?: string | URL;
  /** Self-hosted export.worker.js URL, required for worker mode. */
  workerUrl?: string | URL;
  /** Per-attempt load timeout, default 10s. */
  timeoutMs?: number;
  /** Max retries, default 3. */
  maxRetries?: number;
}

export class WasmLoader {
  private state: LoadState = "idle";
  private promise: Promise<void> | null = null;
  private opts: LoaderOptions;

  constructor(opts: LoaderOptions = {}) {
    this.opts = { timeoutMs: 10_000, maxRetries: 3, ...opts };
  }

  get supported(): boolean {
    return (
      typeof WebAssembly !== "undefined" &&
      typeof WebAssembly.instantiate === "function"
    );
  }

  get isReady(): boolean {
    return this.state === "ready";
  }

  getOptions(): Readonly<LoaderOptions> {
    return this.opts;
  }

  /**
   * Merge new options into the current set. If the WASM URL changes while the
   * loader is already ready (or mid-load), reset so the next ensureLoaded
   * re-initializes from the new URL; otherwise keep the loaded state. This avoids
   * discarding an already-loaded WASM module when only timeouts/retries change.
   * A previous load *error* is always cleared by a reconfiguration, so the next
   * ensureLoaded retries with the new settings instead of throwing forever.
   */
  updateOptions(opts: LoaderOptions): void {
    const urlChanged =
      opts.wasmUrl !== undefined && opts.wasmUrl !== this.opts.wasmUrl;
    this.opts = { ...this.opts, ...opts };
    if ((urlChanged && this.state !== "idle") || this.state === "error") {
      this.state = "idle";
      this.promise = null;
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.state === "ready") return;
    if (this.state === "error") {
      throw new Error(
        "[excel-exporter] WASM load previously failed; call configureWasm() to retry with new settings",
      );
    }
    if (this.promise) return this.promise;
    // Capture the promise locally: updateOptions() may null this.promise while
    // the load is in flight (wasmUrl changed), and this load must not clobber
    // the reset state when it settles -- otherwise a superseded old-URL load
    // would mark the loader ready and the new URL would never take effect.
    const promise = (this.promise = this.loadWithRetry());
    try {
      await promise;
      if (this.promise === promise) this.state = "ready";
    } catch (e) {
      if (this.promise === promise) this.state = "error";
      throw e;
    }
  }

  private async loadWithRetry(): Promise<void> {
    if (!this.supported) {
      throw new Error(
        "[excel-exporter] WebAssembly not supported in this environment",
      );
    }
    const wasmUrl = this.opts.wasmUrl;
    const timeoutMs = this.opts.timeoutMs ?? 10_000;
    const maxRetries = this.opts.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`WASM load timeout (attempt ${attempt})`)),
          timeoutMs,
        );
      });
      try {
        this.state = "loading";
        await Promise.race([initWasm(wasmUrl), timeout]);
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
        }
      } finally {
        // Clear the pending timeout so a late reject never surfaces as an
        // unhandled promise rejection after initWasm already resolved.
        if (timer) clearTimeout(timer);
      }
    }
    throw new Error(
      `[excel-exporter] WASM load failed after ${maxRetries} attempts: ${(lastErr as Error).message}`,
    );
  }
}

const defaultLoader: WasmLoader = new WasmLoader();

export function getWasmLoader(): WasmLoader {
  return defaultLoader;
}

/**
 * Inject CDN / self-hosted URLs and timeout config at app entry. Merges into the
 * existing loader rather than replacing it, so an already-loaded WASM module is
 * kept unless the WASM URL actually changes (in which case the next ensureLoaded
 * re-initializes from the new URL). A previous load error is always cleared, so
 * calling this after a failure makes the next export retry with the new settings.
 */
export function configureWasm(opts: LoaderOptions): void {
  defaultLoader.updateOptions(opts);
}
```

> **为什么不用 modern-xlsx 官方的 `ensureReady()`？**（已核实源码）官方提供 `ensureReady(wasmSource?)`，内部即「若未初始化则调 `initWasm`」，等价于「首次使用自动初始化」。本库**没有**直接用它的原因：
>
> - 官方 `ensureReady` / `initWasm` **不带超时、不带重试**（源码：`initPromise ??= init(source ?? detectWasmUrl()).then(...)`，失败即 throw，不重试）。本库的 `WasmLoader` 额外提供 `timeoutMs`（默认 10s）+ `maxRetries`（默认 3，指数退避），应对 CDN/网络抖动，失败后再触发降级链路（见 5.4）。
> - 官方 `detectWasmUrl()` 只覆盖浏览器 `<script>` 场景（源码：仅 `document.currentScript` 分支），Node 下返回 `undefined`，靠 wasm-bindgen 默认 `init` 兜底；本库通过 `configureWasm({ wasmUrl })` 让生产环境显式指定自托管 URL，行为可预期。
> - `WasmLoader` 还承载 `workerUrl` 配置（Worker 模式需要），这是官方 `ensureReady` 不涉及的。
>
> 注意：modern-xlsx 的 `initWasm` 注释声称「auto-detects: script src, import.meta.url, or CDN fallback」，但**源码只实现了 script src 一种**（import.meta.url / CDN fallback 实际靠 wasm-bindgen 默认 init 兜底，非显式支持）。因此 Node 测试环境（7.2）**不能依赖自动探测，也不能传本地文件路径**——Node 的 undici fetch 拒绝 `file://` 协议，`initWasm(<本地路径>)` 会 fetch failed。正确做法（现行 `__tests__/setup.ts` 即此实现，已实测）：`initWasmSync(readFileSync(require.resolve 路径下的 .wasm))` 同步引导；或 `configureWasm({ wasmUrl })` 指向一个可 fetch 的 HTTP URL。（v2.1 历史：旧文此处建议 `configureWasm({ wasmUrl: <绝对路径> })`，与 7.2/setup.ts 实测结论矛盾，v2.7 纠正。）

### 4.6 样式工具（`style-utils.ts`）

将业务层 `CellStyle` 映射到真实的 `StyleBuilder`（链式 API 已核实）。

```ts
import type { Workbook } from "modern-xlsx";
import type { CellStyle } from "./types";

/**
 * Compile a business CellStyle into a modern-xlsx styleIndex (0-based index into
 * the workbook's cellXfs table). StyleBuilder chain methods mutate in place and
 * return `this` (verified in modern-xlsx 1.2.0 source), so direct calls suffice.
 */
export function buildStyleIndex(wb: Workbook, style: CellStyle): number {
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

  if (style.fill && (style.fill.fgColor || style.fill.bgColor)) {
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
import {
  Workbook,
  sheetAddAoa,
  encodeCellRef,
  type Worksheet,
} from "modern-xlsx";
import type { SheetConfig, ColumnConfig } from "./types";
import { buildStyleIndex } from "./style-utils";
import { getWasmLoader } from "./wasm-loader";
import {
  resolveCellFormat,
  numFormatForSpec,
  validateSheetName,
} from "./format-utils";
import { toBlobPart } from "./download";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Workbook builder -- batch write path. All data goes through `sheetAddAoa`
 * (array of arrays). For <=50k rows this is the fast, fully-styled path;
 * `Workbook.toBuffer()` is well-behaved here (verified: 50k rows ~700-830ms).
 */
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
    // Auto-inject an Excel numFormat for typed FormatSpecs (date/datetime/number)
    // so the cell renders correctly without forcing the caller to also set
    // style.numFormat (otherwise dates show as raw serials, numbers as text).
    const columns = config.columns.map(withAutoNumFormat);
    const headers = columns.map((c) => c.header);
    const rows = config.data.map((item) =>
      columns.map((col) => resolveCellFormat(col, item)),
    );
    const aoa = [headers, ...rows];

    validateSheetName(config.name);
    const ws = this.wb.addSheet(config.name);
    sheetAddAoa(ws, aoa, { origin: "A1" });

    return this.applyLayout(ws, { ...config, columns }, rows.length);
  }

  private applyLayout(
    ws: Worksheet,
    config: SheetConfig,
    dataRowCount: number,
  ): this {
    // Column widths (1-based)
    config.columns.forEach((c, i) => {
      if (c.width !== undefined) ws.setColumnWidth(i + 1, c.width);
    });

    // Header styles. Column-level headerStyle wins over the sheet-level default.
    config.columns.forEach((c, i) => {
      const headerStyle = c.headerStyle ?? config.headerStyle;
      if (headerStyle) {
        const idx = buildStyleIndex(this.wb, headerStyle);
        const cell = ws.rows[0]?.cells[i];
        if (cell) cell.styleIndex = idx;
      }
    });

    // Column styles: apply to data cells only, matching the `style: not the
    // header` contract in types.ts. Header styling is handled separately above
    // via headerStyle. ws.rows[0] is the header row, so slice(1) iterates only
    // data rows; mutating styleIndex is a plain JS property write, bypassing
    // ws.cell(ref) ref-parsing overhead.
    config.columns.forEach((c, i) => {
      if (c.style) {
        const idx = buildStyleIndex(this.wb, c.style);
        for (const row of ws.rows.slice(1)) {
          const cell = row.cells[i];
          if (cell) cell.styleIndex = idx;
        }
      }
    });

    // Freeze header rows
    if (config.freezeRows && config.freezeRows > 0) {
      ws.frozenPane = { rows: config.freezeRows, cols: 0 };
    }

    // Auto-filter over header range A1:<lastCol><lastRow>
    if (config.autoFilter) {
      const lastCol = encodeCellRef(0, config.columns.length - 1).match(
        /[A-Z]+/,
      )![0];
      ws.autoFilter = `A1:${lastCol}${dataRowCount + 1}`;
    }

    // Merges: row/col are 0-based relative to the data area; +1 to skip the header row.
    config.merges?.forEach((m) => {
      const start = encodeCellRef(m.row + 1, m.col);
      const end = encodeCellRef(m.row + m.rowspan, m.col + m.colspan - 1);
      ws.addMergeCell(`${start}:${end}`);
    });

    return this;
  }

  /** Serialize to Uint8Array (async, avoids sync writeBlob blocking main thread). */
  async toBuffer(): Promise<Uint8Array> {
    return this.wb.toBuffer();
  }

  /** Convenience: serialize and wrap in a Blob. */
  async toBlob(): Promise<Blob> {
    const bytes = await this.toBuffer();
    return new Blob([toBlobPart(bytes)], { type: XLSX_MIME });
  }
}

/**
 * If a column has a typed FormatSpec (date/datetime/number) but no explicit
 * style.numFormat, inject the matching Excel numFormat so the value displays
 * correctly. Explicit numFormat on the column style always wins.
 */
function withAutoNumFormat(c: ColumnConfig): ColumnConfig {
  const spec = typeof c.format === "object" ? c.format : null;
  const nf = spec ? numFormatForSpec(spec) : null;
  if (nf && !c.style?.numFormat) {
    return { ...c, style: { ...(c.style ?? {}), numFormat: nf } };
  }
  return c;
}
```

> 📌 三处 API 关键点（均已核实）：
>
> - `encodeCellRef(row, col)` 来自 modern-xlsx，将 0-based 行列转为 A1 字符串。
>   📌 **更简单的替代方案（Phase 2 规划，当前未实现）**：modern-xlsx 提供了 `drawTable(wb, ws, opts)` 和 `drawTableFromData(wb, ws, data, opts)` 两个内置高层 API，可直接从 JSON 数组渲染带完整样式的表格（表头+斑马纹+冻结+自动筛选），量级约 15 行代码。当导出场景为"单表头 + 统一列样式"的常规数据表时，Phase 2 计划优先使用 `drawTableFromData` 简化实现（诊断性测量 5 万行 471ms，见附录 A）；需要精细的 `StyleBuilder` 链式样式控制或多行表头时再回退到本节的 `WorkbookBuilder` 手动路径。详见附录 E。
> - `ws.cell(ref)` 接收 **A1 字符串**（如 `'A1'`），而非数字坐标。
> - `sheetAddAoa(ws, aoa, { origin })` 是批量写入的正解（参考 PDF 中的 `ws.batch().writeRows()` 不存在）。
>
> **整列数据样式已实现**（步骤 4b）：`sheetAddAoa` 批量写入后，遍历 `ws.rows` 直接改 `CellData.styleIndex`——纯 JS 属性赋值（O(N)，N = 行数），不经过 WASM 边界、不做 ref 解析。与 `ws.cell(ref).styleIndex = idx`（每次都要 A1 ref 解析 + 行/单元格查找）相比，跳过了热路径上最大的常数因子。5 万行单列赋值预计 < 10ms（以 `performance.test.ts` 实测为准）。如需多列样式，在外层 `forEach` 内对每列各调一次 `buildStyleIndex`（`StyleBuilder` 会去重合并到同一 `cellXfs` 表，不会重复注册）。

### 4.8 流式构建器（`streaming-builder.ts` + `fast-xlsx.ts`）— 大数据主路径（v1.9 重构；v2.5 起切换 fast-xlsx）

> 🔄 **v2.6：现行实现快照（与顶部 v2.5 注记对应）**。大文件路径不再依赖 modern-xlsx 的 `StreamingXlsxWriter`：`streaming-builder.ts` 现在只是一层薄委托，实际由自研 `fast-xlsx.ts` 用 `fflate` 同步压缩一个 minimal OOXML 工作簿。要点：① **不需要 WASM**（4.10 的 `needsWasm` 判定因此把 stream 排除在外）；② 数据列 `style` 与 `headerStyle` 同样 warn 后丢弃（比旧实现多丢弃一类）；③ 以内存换吞吐——worksheet XML 在内存中一次拼装，适配 5–10 万行档位；④ 保持每 1000 行一次的 `onProgress` 节流。下方 StreamingXlsxWriter 版本保留为 v1.9–v2.0 历史记录。

**现行源码**（`streaming-builder.ts`）：

```ts
import type { SheetConfig } from "./types";
import { exportFastXlsx } from "./fast-xlsx";

export interface StreamResult {
  bytes: Uint8Array;
  rowCount: number;
}

/**
 * Streaming export -- the large-data path for >=50k rows.
 *
 * v1 does not support StyleBuilder/layout styles, matching the documented
 * stream-mode contract. The fast writer assembles a valid minimal XLSX with
 * fflate and keeps the 50k/100k exports well below the public SLAs.
 */
// Fast writer is synchronous internally; the async signature is kept for API
// compatibility with the previous StreamingXlsxWriter implementation.
// eslint-disable-next-line @typescript-eslint/require-await
export async function exportAsStream(
  sheets: SheetConfig[],
  onProgress?: (p: number) => void,
): Promise<StreamResult> {
  return exportFastXlsx(sheets, onProgress);
}
```

**现行源码**（`fast-xlsx.ts`）：

```ts
import { strToU8, zipSync } from "fflate";
import type { SheetConfig } from "./types";
import { displayValue, validateSheetName } from "./format-utils";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const CONTENT_NS =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const INVALID_XML_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export interface FastXlsxResult {
  bytes: Uint8Array;
  rowCount: number;
}

interface SharedStringTable {
  map: Map<string, number>;
  parts: string[];
  intern(value: string): number;
}

function createSharedStringTable(): SharedStringTable {
  const map = new Map<string, number>();
  const parts: string[] = [];
  return {
    map,
    parts,
    intern(value: string): number {
      const existing = map.get(value);
      if (existing !== undefined) return existing;
      const index = map.size;
      map.set(value, index);
      parts.push(`<si><t xml:space="preserve">${escapeXml(value)}</t></si>`);
      return index;
    },
  };
}

function sanitizeXml(value: string): string {
  return value.replace(INVALID_XML_CHARS, "");
}

function escapeXml(value: string): string {
  const v = sanitizeXml(value);
  if (
    v.indexOf("&") === -1 &&
    v.indexOf("<") === -1 &&
    v.indexOf(">") === -1 &&
    v.indexOf('"') === -1 &&
    v.indexOf("'") === -1
  ) {
    return v;
  }
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number): string {
  let n = index;
  let name = "";
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

function stringifyCell(value: unknown): string | number | boolean {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  return JSON.stringify(value);
}

function appendCell(
  out: string[],
  ref: string,
  value: string | number | boolean,
  intern: (value: string) => number,
): void {
  if (typeof value === "number") {
    out.push(`<c r="${ref}" t="n"><v>${value}</v></c>`);
    return;
  }
  if (typeof value === "boolean") {
    out.push(`<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`);
    return;
  }
  out.push(`<c r="${ref}" t="s"><v>${intern(value)}</v></c>`);
}

function buildWorksheetXml(
  config: SheetConfig,
  onProgress?: (progress: number) => void,
  totalExpected?: number,
  processedRows?: { count: number },
  stringTable?: SharedStringTable,
): string {
  validateSheetName(config.name);
  const cols = config.columns.map((c, i) => ({
    col: c,
    letter: columnName(i),
  }));
  const out: string[] = [];

  // Header row.
  out.push(`<row r="1">`);
  for (const { col, letter } of cols) {
    appendCell(out, `${letter}1`, stringifyCell(col.header), (value) =>
      stringTable!.intern(value),
    );
  }
  out.push(`</row>`);

  for (let rowIndex = 0; rowIndex < config.data.length; rowIndex++) {
    const item = config.data[rowIndex];
    const rowNumber = rowIndex + 2;
    out.push(`<row r="${rowNumber}">`);
    for (const { col, letter } of cols) {
      appendCell(
        out,
        `${letter}${rowNumber}`,
        displayValue(col, item),
        (value) => stringTable!.intern(value),
      );
    }
    out.push(`</row>`);
    processedRows!.count++;
    if (onProgress && totalExpected && processedRows!.count % 1000 === 0) {
      onProgress(processedRows!.count / totalExpected);
    }
  }

  return (
    XML_DECL +
    `<worksheet xmlns="${MAIN_NS}"><sheetData>${out.join(
      "",
    )}</sheetData></worksheet>`
  );
}

/**
 * Fast, dependency-light XLSX writer for the large-data stream path.
 *
 * It intentionally trades streaming memory for throughput: the worksheet XML
 * is assembled once in memory and zipped synchronously with fflate. That is
 * the right trade for the supported 50k-100k+ export envelope and is what
 * makes the public API hit its sub-second targets. For feature parity with the
 * modern-xlsx stream path, layout/styling features are still skipped with the
 * same warnings.
 */
export function exportFastXlsx(
  sheets: SheetConfig[],
  onProgress?: (progress: number) => void,
): FastXlsxResult {
  const totalExpected = sheets.reduce((sum, s) => sum + s.data.length, 0);
  const processed = { count: 0 };
  const worksheetXmls: string[] = [];
  const workbookSheets: string[] = [];
  const workbookRels: string[] = [];
  const contentOverrides: string[] = [];
  const stringTable = createSharedStringTable();

  sheets.forEach((config, index) => {
    const sheetNumber = index + 1;
    const skipped: string[] = [];
    if (config.columns.some((c) => c.width !== undefined))
      skipped.push("width");
    if (
      config.headerStyle !== undefined ||
      config.columns.some((c) => c.headerStyle !== undefined)
    )
      skipped.push("headerStyle");
    // Data-cell styles are dropped just like layout features; warn so the
    // degradation is visible instead of silent (headerStyle above already did).
    if (config.columns.some((c) => c.style !== undefined))
      skipped.push("style");
    if (config.freezeRows) skipped.push("freezeRows");
    if (config.autoFilter) skipped.push("autoFilter");
    if (config.merges?.length) skipped.push("merges");
    if (skipped.length) {
      console.warn(
        "[excel-exporter] stream mode: features not supported (" +
          skipped.join(", ") +
          ")",
      );
    }

    worksheetXmls.push(
      buildWorksheetXml(
        config,
        onProgress,
        totalExpected,
        processed,
        stringTable,
      ),
    );
    workbookSheets.push(
      `<sheet name="${escapeXml(
        config.name,
      )}" sheetId="${sheetNumber}" r:id="rId${sheetNumber}"/>`,
    );
    workbookRels.push(
      `<Relationship Id="rId${sheetNumber}" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet${sheetNumber}.xml"/>`,
    );
    contentOverrides.push(
      `<Override PartName="/xl/worksheets/sheet${sheetNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
  });

  const sharedStringsIndex = sheets.length + 1;
  const hasSharedStrings = stringTable.parts.length > 0;
  if (hasSharedStrings) {
    workbookRels.push(
      `<Relationship Id="rId${sharedStringsIndex}" Type="${OFFICE_REL}/sharedStrings" Target="sharedStrings.xml"/>`,
    );
    contentOverrides.push(
      `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`,
    );
  }

  const contentTypes =
    XML_DECL +
    `<Types xmlns="${CONTENT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${contentOverrides.join(
      "",
    )}</Types>`;
  const rootRels =
    XML_DECL +
    `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook =
    XML_DECL +
    `<workbook xmlns="${MAIN_NS}" xmlns:r="${OFFICE_REL}"><sheets>${workbookSheets.join(
      "",
    )}</sheets></workbook>`;
  const workbookRelationships =
    XML_DECL +
    `<Relationships xmlns="${REL_NS}">${workbookRels.join("")}</Relationships>`;
  const sharedStringsXml = hasSharedStrings
    ? XML_DECL +
      `<sst xmlns="${MAIN_NS}" count="${stringTable.parts.length}" uniqueCount="${stringTable.parts.length}">${stringTable.parts.join(
        "",
      )}</sst>`
    : null;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationships),
  };
  worksheetXmls.forEach((xml, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(xml);
  });
  if (sharedStringsXml) {
    files["xl/sharedStrings.xml"] = strToU8(sharedStringsXml);
  }

  const bytes = zipSync(files, { level: 1 });
  // No trailing onProgress(1) here: every 1,000-row checkpoint reports the
  // final position, and exportExcel emits the single terminal 1 for all paths
  // (emitting it here too duplicated the last callback on stream routes).
  return { bytes, rowCount: processed.count };
}
```

---

**【以下为历史实现（v1.9–v2.0，基于 modern-xlsx `StreamingXlsxWriter`；v2.5 起生产代码已不再使用，保留作设计推导记录】**

> 🚨 **v1.9 地位升级**：stream 从 v1.8 的"无样式降级"升为 **≥5 万行的主路径**。原因见顶部 v1.9 摘要硬伤 1/2——`Workbook.toBuffer()` 在 ≥8 万行首次导出实测 17 秒（性能塌方），而 `StreamingXlsxWriter.finish()` 同规模实测 ~93ms（v2.0 修正，v1.9 误记为 3ms）。stream 全流程 10 万行独立进程实测 ~1,548ms，是达成 10 万行 <2000ms（首次）指标的**唯一可行路径**。

`StreamingXlsxWriter` 逐行写入、最后 `finish()` 输出 `Uint8Array`，**不经过 Workbook 对象**，因此完全绕开 toBuffer 塌方。类型定义核实：`finish(): Uint8Array`（同步），实测 ~93ms（v2.0 修正，v1.9 误记为 3ms），与行列数弱相关。

```ts
import { StreamingXlsxWriter, type StreamingCellInput } from "modern-xlsx";
import type { SheetConfig } from "./types";
import { getWasmLoader } from "./wasm-loader";
import { toBlobPart } from "./download";
import { displayValue, validateSheetName } from "./format-utils";

export interface StreamResult {
  bytes: Uint8Array;
  rowCount: number;
}

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Streaming export -- the only viable path for >=50k rows.
 *
 * `Workbook.toBuffer()` has a severe performance cliff beyond ~55k rows
 * (verified: 100k rows ~21s), while StreamingXlsxWriter keeps constant memory
 * and finishes in ~1.6s for 100k rows (verified: writeRow ~1.5s + finish ~100ms).
 *
 * Must run off the main thread (the writeRow loop is ~1.5s of JS work). v1 does
 * not support StyleBuilder styles (StreamingCellInput.style requires a pre-built
 * styles.xml via setStylesXml -- a Phase 2 enhancement).
 */
export async function exportAsStream(
  sheets: SheetConfig[],
  onProgress?: (p: number) => void,
): Promise<StreamResult> {
  await getWasmLoader().ensureLoaded();
  const writer = StreamingXlsxWriter.create();
  let totalRows = 0;

  let totalExpected = 0;
  for (const s of sheets) totalExpected += s.data.length;

  for (const config of sheets) {
    validateSheetName(config.name);
    writer.startSheet(config.name);
    writer.writeRow(
      config.columns.map((c) => ({
        value: c.header,
        cellType: "sharedString",
      })),
    );
    // StreamingXlsxWriter has no column-width/freeze/autofilter/merge API.
    const skipped: string[] = [];
    if (config.columns.some((c) => c.width !== undefined))
      skipped.push("width");
    if (config.freezeRows) skipped.push("freezeRows");
    if (config.autoFilter) skipped.push("autoFilter");
    if (config.merges?.length) skipped.push("merges");
    if (skipped.length)
      console.warn(
        "[excel-exporter] stream mode: layout features not supported (" +
          skipped.join(", ") +
          ")",
      );
    for (const item of config.data) {
      const cells: StreamingCellInput[] = config.columns.map((col) => {
        const v = displayValue(col, item);
        if (typeof v === "number")
          return { value: String(v), cellType: "number" };
        if (typeof v === "boolean")
          return { value: v ? "1" : "0", cellType: "boolean" };
        return { value: v, cellType: "sharedString" };
      });
      writer.writeRow(cells);
      totalRows++;
      if (onProgress && totalRows % 1000 === 0)
        onProgress(totalRows / totalExpected);
    }
  }

  onProgress?.(1);
  const bytes = writer.finish();
  return { bytes, rowCount: totalRows };
}

/** Convenience wrapper returning a Blob. */
export async function exportAsStreamBlob(
  sheets: SheetConfig[],
): Promise<{ blob: Blob; rowCount: number }> {
  const { bytes, rowCount } = await exportAsStream(sheets);
  return { blob: new Blob([toBlobPart(bytes)], { type: XLSX_MIME }), rowCount };
}
```

> **stream 的样式边界（v1.9 明确）**：`StreamingCellInput` 有 `style?: number`（styleIndex）字段，但设置样式需要先用 `writer.setStylesXml(xml)` 注入完整 `xl/styles.xml`（OOXML 字符串）。类型定义核实：`setStylesXml` 必须在 `startSheet` 之前调用，缺省时用最小默认样式表（1 font / 2 fills / 1 border / 1 cellXf）。
>
> **v1.9 取舍**：stream 路径 **v1 只支持纯数据 + 表头样式（通过 setStylesXml 预注册有限样式）**，不支持 StyleBuilder 链式样式。原因：完整 styles.xml 的拼接逻辑较繁琐（按 OOXML 规范组装 fonts/fills/borders/cellXfs，约 80-120 行），列入 **Phase 2 高级特性**。需要完整样式的大数据导出（≥5万行+复杂样式）在 Phase 1 暂不支持，业务侧需：① 拆分为 <5 万行（≤49,999）/文件走 Workbook；② 或接受纯数据；③ 或等 Phase 2 的 `buildStylesXmlForStream()` 工具函数。
>
> **这与 v1.8 的差异**：v1.8 错误地认为"带样式必须走 Workbook（即使 ≥10 万行）"，导致撞上 toBuffer 塌方。v1.9 修正为：≥5 万行优先保性能（stream，纯数据或有限样式），样式完整性让位于"能在合理时间内导出"。

> **round-trip 正确性已验证**：stream 产出的 xlsx 经 `readBuffer` 读回，行数、表头、首末数据单元格全部一致（1000 行 / 50000 行两组用例 PASS）。stream 路径数据完整性可信。

> **stream 必须在 Worker 内执行**：`finish()` 实测 ~90ms（v2.0 修正，v1.9 误记为 3ms），10 万行的 `writeRow` 循环（JS 层逐行构造 `StreamingCellInput[]`）约 1.45s，放主线程会阻塞。pickMode 对 ≥500 行一律丢进 Worker，stream 也不例外（见 4.9/4.10）。（v2.6 注：本条写于 `WORKER_THRESHOLD=500` 时代；现行阈值为 20,000，浏览器 ≥20,000 行进 Worker，Node 的 stream 在主线程执行——fast-xlsx 100k 约 0.8s，产品接受。）

> **跨阈值的值语义差异（≤49,999 行 Workbook vs ≥50,000 行 stream）**：同一 `FormatSpec` 在两条路径产出的**单元格内部值不同**——`number` 在 Workbook 路径（`applyFormat`，见 4.7）保留全精度、靠 auto 注入的 `numFormat` 显示小数；在 stream 路径（`displayValue`，见 4.8）用 `Number(n.toFixed(decimals ?? 0))` 把小数**直接烤进值**（精度有损）。**`decimals` 未指定时默认 0（最常踩的坑）**：`{type:'number'}`（不带 `decimals`）在 Workbook 路径仍存全精度（如 `9999.99`），但在 stream 路径会被 `toFixed(0)` **四舍五入到整数**（实测 `9999.99 → 10000`）——即 ≥5 万行导出时小数被静默丢弃。大数据 number 列务必显式写 `decimals`，否则跨阈值会出现精度不一致。`date`/`datetime` 在 Workbook 存日期序列（数字），在 stream 存格式化字符串。若同一列数据量跨阈值（如分批导出 4 万 vs 6 万行），下游按单元格类型/精度处理会观察到差异。源码见 `format-utils.ts` 的 `applyFormat` vs `displayValue`。

### 4.9 Worker 模式（`worker-exporter.ts` + `src/workers/export.worker.ts`）— v1.9 重构

> 🚨 **v1.9 三项关键修正**（针对 v1.8 的硬伤 3/4/5）：
>
> - **删 flat-encoder**：v1.8 的扁平化编码（首行采样判列类型）在混合类型列静默损坏数据（硬伤 3），且收益被高估（省 81ms 占 17 秒塌方的 0.5%，硬伤 5）。改回**结构化克隆** `postMessage(options)`，简单可靠。
> - **修并发串台**：v1.8 的单例 Worker + 每次 `onmessage` 覆盖，导致并发请求第一次永久 pending（硬伤 4）。改用 **requestId 路由 + pending Map**。
> - **Worker 内路由 Workbook/stream**：Worker 接到请求后，根据行数决定走 `WorkbookBuilder`（≤5万，带完整样式）还是 `exportAsStream`（≥5万，绕开 toBuffer 塌方）。

**架构**：主线程 `postMessage(options)`（结构化克隆）→ Worker 内执行全部 WASM 工作（Workbook 或 stream）→ `postMessage(bytes, [bytes.buffer])` Transferable 零拷贝回传。

> 🔄 **v2.6 快照说明**：以下两段已替换为现行源码。与 v2.4 及以前快照的差异（对应提交 12d47a4）：① Worker 脚本把 `initWasm` 门在 `mode !== "stream"` 下（Fast stream 不需要 WASM），并在实际初始化时上报 `init` 阶段耗时、构建完成时上报 `build` 阶段耗时；② 主线程封装的 `onerror` 不再复用坏 Worker——出错实例被 `terminate()` 并清空缓存引用（下次导出重建），且只 reject 派发给**该实例**的请求；③ `stripFunctionFormats` 同时剥离回调（`onProgress`/`onPhase` 不能跨结构化克隆，由主线程包装后转发）。

**Worker 脚本**（`src/workers/export.worker.ts` → 构建为 `dist/export.worker.js`，见 4.3）：

```ts
import { initWasm } from "modern-xlsx";
import type { ExportOptions } from "../types";
import { WorkbookBuilder } from "../workbook-builder";
import { exportAsStream } from "../streaming-builder";

interface WorkerRequest {
  id: number;
  options: ExportOptions;
  wasmUrl?: string | URL;
  mode: "workbook" | "stream";
}
interface WorkerResponse {
  id: number;
  ok: boolean;
  bytes?: Uint8Array;
  rowCount?: number;
  engine?: "modern-xlsx";
  error?: string;
  progress?: number;
}

// Track the URL we initialized with; re-init if it changes (the main thread's
// configureWasm can swap the URL at runtime, and we must honor the new one).
let loadedWasmUrl: string | URL | undefined | null = null;
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, options, wasmUrl, mode } = e.data;
  try {
    if (mode !== "stream" && loadedWasmUrl !== wasmUrl) {
      const initStart = performance.now();
      await initWasm(wasmUrl);
      loadedWasmUrl = wasmUrl;
      (self as unknown as Worker).postMessage({
        id,
        phase: "init",
        duration: performance.now() - initStart,
      });
    }

    const buildStart = performance.now();
    let bytes: Uint8Array;
    let rowCount: number;

    if (mode === "stream") {
      // Forward per-row progress to the main thread (throttled inside exportAsStream).
      const r = await exportAsStream(options.sheets, (progress) => {
        (self as unknown as Worker).postMessage({ id, progress });
      });
      bytes = r.bytes;
      rowCount = r.rowCount;
    } else {
      const builder = await WorkbookBuilder.create();
      for (const s of options.sheets) builder.addSheet(s);
      bytes = await builder.toBuffer();
      rowCount = options.sheets.reduce((sum, s) => sum + s.data.length, 0);
    }

    (self as unknown as Worker).postMessage({
      id,
      phase: "build",
      duration: performance.now() - buildStart,
    });

    const resp: WorkerResponse = {
      id,
      ok: true,
      bytes,
      rowCount,
      engine: "modern-xlsx",
    };
    (self as unknown as Worker).postMessage(resp, [bytes.buffer]);
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
import { toBlobPart } from "./download";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface PendingEntry {
  resolve: (b: Uint8Array, rowCount: number) => void;
  reject: (e: Error) => void;
  /** The worker instance this request was dispatched to (see onerror). */
  worker: Worker;
  onProgress?: (progress: number) => void;
  onPhase?: (phase: "init" | "build", durationMs: number) => void;
}

let worker: Worker | null = null;
let requestIdSeq = 0;
// requestId -> pending; replaces the single-onmessage pattern that broke concurrency.
const pending = new Map<number, PendingEntry>();

interface WorkerOkResponse {
  id: number;
  ok: true;
  bytes: Uint8Array;
  rowCount: number;
  engine: "modern-xlsx";
}
interface WorkerErrResponse {
  id: number;
  ok: false;
  error: string;
}
interface WorkerProgressResponse {
  id: number;
  progress: number;
}
interface WorkerPhaseResponse {
  id: number;
  phase: "init" | "build";
  duration: number;
}
type WorkerResponse =
  | WorkerOkResponse
  | WorkerErrResponse
  | WorkerProgressResponse
  | WorkerPhaseResponse;

function getOrCreateWorker(): Worker {
  if (worker) return worker;
  const { workerUrl } = getWasmLoader().getOptions();
  if (!workerUrl) {
    throw new Error(
      '[excel-exporter] workerUrl not configured. Call configureWasm({ workerUrl: "..." }) to point at export.worker.js (see README).',
    );
  }
  const w = (worker = new Worker(workerUrl, { type: "module" }));
  // Single onmessage handler registered once, dispatches by id.
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const data = e.data;
    const p = pending.get(data.id);
    if (!p) return;
    // Progress messages do not complete the export; forward and keep pending.
    if ("progress" in data) {
      p.onProgress?.(data.progress);
      return;
    }
    if ("phase" in data) {
      p.onPhase?.(data.phase, data.duration);
      return;
    }
    pending.delete(data.id);
    if (data.ok && data.bytes) p.resolve(data.bytes, data.rowCount);
    else
      p.reject(
        new Error((data as WorkerErrResponse).error ?? "worker unknown error"),
      );
  };
  // A worker that errored (e.g. script failed to load) must not be reused:
  // terminate it and drop the cached reference so the next export creates a
  // fresh one, instead of failing forever into the SheetJS fallback. Only the
  // requests dispatched to THIS worker are rejected -- a replacement worker
  // may already be serving newer request ids.
  w.onerror = (err) => {
    if (worker === w) {
      w.terminate();
      worker = null;
    }
    for (const [id, p] of pending) {
      if (p.worker !== w) continue;
      pending.delete(id);
      p.reject(new Error(err.message || "worker error"));
    }
  };
  return w;
}

/** Strip function-form format before structured clone (functions cannot be cloned). */
function stripFunctionFormats(options: ExportOptions): ExportOptions {
  const { onProgress: _onProgress, onPhase: _onPhase, ...rest } = options;
  return {
    ...rest,
    sheets: options.sheets.map((s) => ({
      ...s,
      columns: s.columns.map((c) => {
        if (c.format && typeof c.format === "function") {
          console.warn(
            `[excel-exporter] column "${c.key}" uses a function format, stripped for worker mode. Use FormatSpec for worker compatibility.`,
          );
          const { format: _format, ...rest } = c;
          return rest;
        }
        return c;
      }),
    })),
  };
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
    const timeoutMs = 120_000; // 2-minute timeout
    const [bytes, workerRowCount] = await new Promise<[Uint8Array, number]>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error("export worker timed out after " + timeoutMs + "ms"),
          );
        }, timeoutMs);
        pending.set(id, {
          worker: w,
          resolve: (b: Uint8Array, rc: number) => {
            clearTimeout(timer);
            resolve([b, rc]);
          },
          reject: (e: Error) => {
            clearTimeout(timer);
            reject(e);
          },
          onProgress: options.onProgress,
          onPhase: (phase, duration) => options.onPhase?.(phase, duration),
        });
        w.postMessage({
          id,
          options: stripFunctionFormats(options),
          wasmUrl,
          mode,
        });
      },
    );
    const blob = new Blob([toBlobPart(bytes)], { type: XLSX_MIME });
    return {
      success: true,
      blob,
      engine: "modern-xlsx",
      mode: mode === "stream" ? "stream" : "worker",
      duration: performance.now() - start,
      rowCount: workerRowCount,
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
> - **并发安全（硬伤 4 修复）**：每条请求带递增 `id`，Worker 回传时带上，主线程用 `pending: Map<id, {resolve,reject}>` 路由。`onmessage` 只注册一次（Worker 创建时），不再每次覆盖。实测复现的"连点两次第一次永久 pending"已消除。另外，函数形式的 `format` 不能跨结构化克隆边界进 Worker——`exportInWorker` 在 `postMessage` 前已用 `stripFunctionFormats()` 把函数形式剥离（打 warning，仅保留 FormatSpec），因此 worker 模式只执行 FormatSpec 形式的 format；函数形式仅 main/Node 模式有效（见下方 v2.0 统一处理第 3 点，原 v1.9 此处"函数随 options 进 Worker 执行"与代码不符，已纠正）。
> - **删 flat-encoder（硬伤 3/5 修复）**：v1.8 的 `encodeFlat` 用首行采样判列类型，混合类型列（如订单号首行 number 后续 string）静默损坏数据（50% 行变 null）。且结构化克隆 10 万行实测仅 94ms（v1.8 谎报 163ms），扁平化省下的 81ms 在 toBuffer 17 秒塌方面前占比 0.5%，得不偿失。`src/flat-encoder.ts` **删除**，`encodeFlat`/`decodeFlat` 不再存在。
> - **Worker 内路由（配合硬伤 1/2 修复）**：主线程的 `pickMode`（4.10）已决定 mode，Worker 按 mode 执行 Workbook 或 stream。这样大数据量（≥5万）在 Worker 内走 stream，绕开 toBuffer 塌方，同时不阻塞主线程。
>   📌 **v2.0 format 统一处理（修正 v1.9 的两段自相矛盾）**：v1.9 第 1286 行说"format 是函数会 DataCloneError，必须改 FormatSpec"，第 1298 行又说"format 随 options 进 Worker 执行"——如果 format 是函数，postMessage 直接崩；如果是 FormatSpec 对象，builder 的 `col.format(raw,item)` 又会抛 TypeError。v1.9 两段都错了。v2.0 的统一方案：
>
> 1. **类型**：`ColumnConfig.format` 保持联合类型 `FormatSpec | 函数`（4.4），兼顾灵活性与 worker 兼容。
> 2. **builder 内部**：统一用 `resolveCellFormat(col, item)`（4.4 新增）分流——函数直接调，FormatSpec 走 applyFormat。两种输入都能正确工作（已最小验证）。
> 3. **worker 入口**：`worker-exporter.ts` 在 `postMessage` 前对 options 做一次"剥函数"预处理——把 format 中的函数过滤掉（置 undefined 并打 warning），只保留 FormatSpec。这样 worker 模式只接受 FormatSpec，函数形式的 format 只在 main/stream（Node）模式有效。
> 4. **执行位置**：main 模式 format 在主线程执行；worker 模式 format（FormatSpec 形式）在 Worker 线程执行（随 options 结构化克隆进 Worker，由 resolveCellFormat 解释）。

> **关键设计点（保留 v1.8 正确部分）**：
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
import { triggerDownload, toBlobPart } from "./download";
import { getWasmLoader } from "./wasm-loader";
import { tableExportToOptions, type TableExportOptions } from "./table-export";
import {
  echartsExportToOptions,
  type EChartsExportOptions,
} from "./echarts-export";

export * from "./types";
export * from "./style-presets";
export * from "./format-utils";
export * from "./table-export";
export * from "./echarts-export";
export { configureWasm, getWasmLoader } from "./wasm-loader";
export { WorkbookBuilder } from "./workbook-builder";
export { exportAsStream } from "./streaming-builder";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const STREAM_THRESHOLD = 50_000; // Workbook.toBuffer cliff starts ~55k rows
const WORKER_THRESHOLD = 20_000; // main-mode sync work is acceptable below this

type PickedMode = { mode: ExportMode; workerMode?: "workbook" | "stream" };

/**
 * Auto mode selection (verified against independent-process benchmarks).
 * - main fully blocks the thread; only for Node/SSR or browser <20,000 rows.
 * - browser >=20,000 rows go to a worker (main thread does one structured clone).
 * - inside the worker, >=50k rows use stream (avoids the toBuffer cliff).
 */
function pickMode(options: ExportOptions, totalRows: number): PickedMode {
  const explicit = options.mode ?? "auto";
  if (explicit === "stream") return { mode: "stream", workerMode: "stream" };
  if (explicit === "worker") {
    // Worker mode requires a Web Worker global. In environments without one
    // (Node/SSR), fall back to the main-thread path so styles are preserved
    // instead of silently degrading to the style-less SheetJS fallback.
    const isBrowser =
      typeof Worker !== "undefined" && typeof window !== "undefined";
    if (!isBrowser) {
      return totalRows >= STREAM_THRESHOLD
        ? { mode: "stream", workerMode: "stream" }
        : { mode: "main" };
    }
    return {
      mode: "worker",
      workerMode: totalRows >= STREAM_THRESHOLD ? "stream" : "workbook",
    };
  }
  if (explicit === "main") return { mode: "main" };

  // auto
  const isBrowser =
    typeof Worker !== "undefined" && typeof window !== "undefined";
  if (!isBrowser) {
    return totalRows >= STREAM_THRESHOLD
      ? { mode: "stream", workerMode: "stream" }
      : { mode: "main" };
  }
  if (totalRows < WORKER_THRESHOLD) return { mode: "main" };
  if (totalRows >= STREAM_THRESHOLD)
    return { mode: "worker", workerMode: "stream" };
  return { mode: "worker", workerMode: "workbook" };
}

/**
 * Export to Excel (main entry).
 *
 * @example
 * ```ts
 * import { exportExcel, StylePresets } from '@marcusok/excel-exporter';
 *
 * await exportExcel({
 *   filename: 'sales-report',
 *   sheets: [{
 *     name: 'Sales', freezeRows: 1, autoFilter: true,
 *     columns: [
 *       { key: 'product', header: 'Product', width: 20 },
 *       { key: 'revenue', header: 'Revenue', width: 15, style: StylePresets.currency },
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

  const picked = pickMode(options, totalRows);
  const needsWasm = picked.workerMode !== "stream";
  const loader = getWasmLoader();
  if (needsWasm && !loader.supported) {
    return exportWithSheetJS(options, start, "WebAssembly not supported");
  }

  // Node main/stream: execute directly on this thread (no Web Worker available).
  if (
    picked.mode === "main" ||
    (picked.mode === "stream" && typeof window === "undefined")
  ) {
    try {
      if (needsWasm) {
        const initStart = performance.now();
        await loader.ensureLoaded();
        options.onPhase?.("init", performance.now() - initStart);
      } else {
        // Fast stream does not use WASM; report an empty init phase so the
        // public phase sequence remains stable across main/stream routes.
        options.onPhase?.("init", 0);
      }
      options.onProgress?.(0);
      let result: ExportResult;
      const buildStart = performance.now();
      try {
        if (picked.workerMode === "stream") {
          const { bytes, rowCount } = await exportAsStream(
            options.sheets,
            options.onProgress,
          );
          result = {
            success: true,
            blob: new Blob([toBlobPart(bytes)], { type: XLSX_MIME }),
            engine: "modern-xlsx",
            mode: "stream",
            duration: performance.now() - start,
            rowCount,
          };
        } else {
          const builder = await WorkbookBuilder.create();
          options.sheets.forEach((s) => builder.addSheet(s));
          const bytes = await builder.toBuffer();
          result = {
            success: true,
            blob: new Blob([toBlobPart(bytes)], { type: XLSX_MIME }),
            engine: "modern-xlsx",
            mode: "main",
            duration: performance.now() - start,
            rowCount: totalRows,
          };
        }
      } finally {
        // Reported even when the build throws, so a failed attempt that falls
        // back to SheetJS still shows how long it spent before failing.
        options.onPhase?.("build", performance.now() - buildStart);
      }
      options.onProgress?.(1);
      // Node has no document: triggerDownload would be a no-op, so neither the
      // click nor the "download" phase is reported (matches ExportPhase docs).
      if (options.download !== false && typeof document !== "undefined") {
        const downloadStart = performance.now();
        triggerDownload(result.blob!, options.filename);
        options.onPhase?.("download", performance.now() - downloadStart);
      }
      return result;
    } catch (e) {
      return exportWithSheetJS(options, start, (e as Error).message);
    }
  }

  // Browser worker mode: offload to worker (main thread does one structured clone).
  try {
    options.onProgress?.(0);
    const result = await exportInWorker(options, picked.workerMode!);
    options.onProgress?.(1);
    if (result.success) {
      if (options.download !== false) {
        const downloadStart = performance.now();
        triggerDownload(result.blob!, options.filename);
        options.onPhase?.("download", performance.now() - downloadStart);
      }
      return result;
    }
    // Worker export failed (e.g. WASM init error inside the worker) -> degrade
    // to SheetJS, matching the main-thread path's failure handling.
    return exportWithSheetJS(
      options,
      start,
      result.error?.message ?? "worker export failed",
    );
  } catch (e) {
    return exportWithSheetJS(options, start, (e as Error).message);
  }
}

/**
 * Convenience wrapper for common table data shapes.
 *
 * Accepts Ant Design-style (`title` / `dataIndex`) and Element Plus-style
 * (`label` / `prop`) column descriptors, normalizes them to `SheetConfig`,
 * and delegates to {@link exportExcel}.
 */
export async function exportTable(
  options: TableExportOptions,
): Promise<ExportResult> {
  return exportExcel(tableExportToOptions(options));
}

/**
 * Convenience wrapper for a small, explicit subset of ECharts options.
 *
 * Supports category-axis series data, pie-like name/value data, and
 * scatter-like coordinate pairs. Unsupported `dataset` mode throws instead of
 * guessing.
 */
export async function exportEcharts(
  options: EChartsExportOptions,
): Promise<ExportResult> {
  return exportExcel(echartsExportToOptions(options));
}
````

> 🔄 **v2.6 快照说明**：以上已整体替换为 `src/index.ts` 现行源码（提交 0c0fbd5 调整 `WORKER_THRESHOLD` 500 → 20_000 起）。与 v2.4 及以前快照的差异：① `WORKER_THRESHOLD = 20_000`——浏览器 auto 1 万行现走 **main**（不再是 worker）；② WASM 能力检测改为 `needsWasm = workerMode !== "stream"`——**Fast stream 路径不需要 WASM**，不支持 WebAssembly 的浏览器 ≥5 万行仍可正常导出（engine 为 `modern-xlsx`），不再一律降级 SheetJS；③ 新增 `onPhase` 阶段打点（`init`/`build`/`download`，Node 下不报 `download`）与 build 失败也上报的 `finally` 语义；④ 新增 `exportTable` / `exportEcharts` 便捷适配器。

> **v1.9 pickMode 与 v1.8 的关键差异**：
>
> - **stream 阈值 10万 → 5万**：v1.8 认为 toBuffer 在 10 万行"热状态"744ms，把 stream 留到 10 万；v1.9 实测发现 8 万行首次塌方到 8 秒，5 万行（648ms）是 Workbook 路径的保守安全上限。
> - **stream 不再要求"无列样式"**：v1.8 把 stream 限制为纯数据（因为觉得带样式必须走 Workbook）；v1.9 修正为——性能优先，≥5 万行一律 stream（样式用 setStylesXml 有限支持，Phase 2 增强）。带复杂样式的大数据是已知取舍，非 bug。
> - **worker 模式内部分流**：v1.8 的 worker 只走 Workbook；v1.9 的 worker 按 workerMode 走 Workbook 或 stream，把 toBuffer 塌方挡在 Worker 内（不阻塞主线程）。
> - **workerUrl 缺失时的降级行为（v2.2 纠正：如实描述当前实现，原句"回退 main"是 v1.9 散文遗留错误）**：`pickMode` 只检测 `typeof Worker !== "undefined" && typeof window !== "undefined"` 来决定是否走 worker，**不检查 `workerUrl` 是否已配**（`index.ts` 的 `pickMode`）。因此浏览器里忘配 `workerUrl` 且 ≥20,000 行时，请求进入 worker 分支，`worker-exporter.ts` 的 `getOrCreateWorker()` 因 `workerUrl` 为空抛错，`exportInWorker` catch 后返回 `{success:false}`，`index.ts` 的 worker 分支随即 `return exportWithSheetJS(...)` 降级到 SheetJS（**丢样式**）。也就是说：`pickMode` 返回 worker 但 worker 实际不可用时，当前实现**直接降级 SheetJS，并不回退 main**（与 v1.8 行为一致，并非上方"v1.9"标签所写的"先回退 main 保样式"——那是与代码不符的遗留描述）。如希望 `workerUrl` 缺失时回退 main 模式（保留样式、接受主线程阻塞），需在 `pickMode`（提前检测 `workerUrl`）或 `exportInWorker` 失败分支（改走 `WorkbookBuilder` 主线程路径）增加显式判断——列为可选改进，当前未实现。

### 4.11 预设样式（`style-presets.ts`）

```ts
import type { CellStyle } from "./types";

export const StylePresets = {
  /** Header: bold, dark-blue fill, white text, centered. */
  header: {
    font: { bold: true, size: 12, color: "FFFFFF" },
    fill: { pattern: "solid", fgColor: "1F4E79" },
    alignment: { horizontal: "center", vertical: "center" },
  } satisfies CellStyle,

  /** Currency: thousands separator, 2 decimals, right-aligned. */
  currency: {
    numFormat: "#,##0.00",
    alignment: { horizontal: "right" },
  } satisfies CellStyle,

  /** Percentage. */
  percent: {
    numFormat: "0.00%",
    alignment: { horizontal: "right" },
  } satisfies CellStyle,

  /** Date: YYYY-MM-DD, centered. */
  date: {
    numFormat: "yyyy-MM-dd",
    alignment: { horizontal: "center" },
  } satisfies CellStyle,

  /** Datetime: YYYY-MM-DD HH:MM. */
  datetime: {
    numFormat: "yyyy-MM-dd HH:mm",
    alignment: { horizontal: "center" },
  } satisfies CellStyle,

  /** Data row: left-aligned, thin bottom border. */
  dataRow: {
    alignment: { horizontal: "left", vertical: "center" },
    border: { bottom: { style: "thin", color: "D0D0D0" } },
  } satisfies CellStyle,

  /** Danger: bold red text, centered. */
  danger: {
    font: { color: "C00000", bold: true },
    alignment: { horizontal: "center" },
  } satisfies CellStyle,
} as const;

export type StylePresetName = keyof typeof StylePresets;
```

### 4.12 降级实现（`fallback.ts`）

WASM 加载失败或不支持时，降级到 SheetJS 导出。**v1.8 修正（P4）**：npm 上的 `xlsx` 包停在 `0.18.5`（2022-01-26 发布，已 4 年未更新），官方早已停止向 npm 发版。降级应改用 SheetJS 官方 CDN 的最新版 `0.20.3`（实测 `https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs` 可访问）。

> **降级策略取舍**：SheetJS CE 无论哪个版本**写样式均需 Pro 授权**（已核实），降级路径必然丢样式。因此降级仅作为"WASM 不可用时的最后保底"，**不应作为常规路径**。生产环境优先确保 WASM 自托管 + 重试链路稳定（见 4.5），降级率应监控并趋近于 0。

```ts
import type { ExportOptions, ExportResult } from "./types";
import { displayValue, validateSheetName } from "./format-utils";
import { triggerDownload } from "./download";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// SheetJS is an optional peerDep. Both the local 'xlsx' module and the CDN URL
// lack type declarations in this workspace, so the loader is typed loosely.
type SheetJSApi = {
  utils: {
    book_new(): unknown;
    aoa_to_sheet(aoa: unknown[][]): unknown;
    book_append_sheet(wb: unknown, ws: unknown, name: string): void;
  };
  write(wb: unknown, opts: { type: string; bookType: string }): ArrayBuffer;
};

function cast<T>(m: unknown): T {
  return m as T;
}

async function loadSheetJS(): Promise<SheetJSApi> {
  try {
    // @vite-ignore: bare optional peer; must stay runtime-only so consumers
    // who did not install xlsx do not get a build-time resolve error.
    return cast<SheetJSApi>(await import(/* @vite-ignore */ "xlsx"));
  } catch {
    // Consumer did not install xlsx; load from the SheetJS official CDN
    // (npm xlsx@0.18.5 has been unmaintained since 2022).
    // A `string`-typed (non-literal) specifier makes TS skip module resolution
    // (import() then resolves to Promise<any>), so no @ts-expect-error is needed.
    const cdnUrl: string =
      "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
    return cast<SheetJSApi>(await import(/* @vite-ignore */ cdnUrl));
  }
}

/**
 * SheetJS fallback: used when WASM is unsupported or fails to load.
 * SheetJS CE has no style-write support, so styles are stripped. This is a
 * last-resort guarantee of "can export, no styles", not a regular path.
 */
export async function exportWithSheetJS(
  options: ExportOptions,
  start: number,
  reason: string,
): Promise<ExportResult> {
  console.warn(
    `[excel-exporter] Falling back to SheetJS (styles stripped). Reason: ${reason}`,
  );
  try {
    // Build phase includes the lazy SheetJS load (local module or CDN), which
    // is the dominant cost of this path when WASM is unavailable.
    const buildStart = performance.now();
    const XLSX = await loadSheetJS();
    const wb = XLSX.utils.book_new();
    for (const s of options.sheets) {
      validateSheetName(s.name);
      const aoa = [
        s.columns.map((c) => c.header),
        // Apply FormatSpec (enum/padding/number/date) for data semantics; dates
        // format to readable strings since SheetJS CE has no style-write support.
        ...s.data.map((row) => s.columns.map((c) => displayValue(c, row))),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    }
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const blob = new Blob([out], { type: XLSX_MIME });
    options.onPhase?.("build", performance.now() - buildStart);
    // Node has no document: no download happens, so the phase is not reported
    // (matches the ExportPhase contract in types.ts).
    if (options.download !== false && typeof document !== "undefined") {
      const downloadStart = performance.now();
      triggerDownload(blob, options.filename);
      options.onPhase?.("download", performance.now() - downloadStart);
    }
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

> **P4 修正要点**：
>
> - **npm `xlsx@0.18.5` 已过期**：发布于 2022-01-26，npm `latest` tag 一直停在此版本，官方不再向 npm 推送更新（已核实 `npm view xlsx`）。SheetJS 官方迁移到自建 CDN `cdn.sheetjs.com`，最新版 `0.20.3`（实测 HTTP 200）。
> - **降级加载优先级**：① 消费方显式安装的 `xlsx`（workspace 内的现代版）；② 官方 CDN `0.20.3`。不再使用 npm 的 `0.18.5`。
> - **样式丢失标记**：降级产出的 `ExportResult` 携带 `error` 字段（非致命，仅作 warning 标记"styles stripped"），业务方可据此提醒用户或上报降级率监控。
> - **4.2 peerDependencies 口径（v1.9 再修正）**：`xlsx` 的 `optional peerDependency` 版本定为 `>=0.18.5`。原因：npm registry 上 `xlsx` latest 就是 0.18.5，若 peerDep 写 `>=0.20.0`（v1.8 的建议），配合 `.npmrc` 的 `strict-peer-dependencies=true` 会让 `pnpm install` 直接报错（npm 无法满足该 range）。`>=0.18.5` 兼容 npm 现有版本，消费方装 npm 的 0.18.5 即可降级；若想要新版，从 SheetJS 官方 CDN tgz 装（`npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`），peerDep range 同样满足。

### 4.13 下载工具（`download.ts`）

```ts
/** Trigger a browser download from a Blob. No-op in Node (document undefined). */
export function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Coerce a Uint8Array into a BlobPart. TS 5.7+ widened Uint8Array to a generic
 * over ArrayBufferLike (which includes SharedArrayBuffer), making it incompatible
 * with BlobPart's ArrayBufferView<ArrayBuffer>. At runtime any Uint8Array is a
 * valid BlobPart; this cast is the documented workaround.
 */
export function toBlobPart(bytes: Uint8Array): BlobPart {
  return bytes as unknown as BlobPart;
}
```

### 4.14 阶段耗时上报（`onPhase`）

`ExportOptions.onPhase(phase, durationMs)` 在每个阶段完成时回调一次，供 play
指标面板做阶段分解（与 `onProgress` 的百分比不同，它给出的是各阶段真实墙钟毫秒数）：

- `init`：WASM 初始化。主线程路径测 `loader.ensureLoaded()`；worker 路径由
  `export.worker.ts` 在真正执行 `initWasm()` 时测量并回传（实例已缓存则不上报该阶段）。
  SheetJS 降级路径不涉及 WASM，无 `init` 阶段。
- `build`：工作簿构建（Workbook / 流式构建 / SheetJS 建表写文件）。若 modern-xlsx
  构建失败后降级到 SheetJS，会依次上报两次 `build`——对应两次真实发生的构建尝试，
  而不是合并成一个数字。
- `download`：`triggerDownload` 的同步开销，仅 `download !== false` 且浏览器环境时上报。

该回调不影响 `ExportResult.duration`（仍为整次导出的总耗时，保持向后兼容）。实现位置：
主线程路径在 `index.ts` 打点；worker 路径由 `export.worker.ts` 测量、经 phase 消息
回传后由 `worker-exporter.ts` 转发；降级路径在 `fallback.ts` 打点。

---

## 五、性能优化策略

### 5.1 批量写入优先（最关键）

所有数据写入走 `aoaToSheet` / `sheetAddAoa` / `StreamingXlsxWriter.writeRow`（API 简洁，错误处理集中）。

> **v1.8 修正（源码核实，纠正"批量比逐格快 8x"的误述）**：早期版本称"批量比逐格快 8x+，禁止逐格"。**源码核实推翻此论证**——`sheetAddAoa` 内部实现就是逐格调用 `ws.cell(ref)`：
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
  workerUrl: "/assets/export.worker.js",
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

> **主线程预热与 Worker 的并发初始化权衡**：上面的 `requestIdleCallback` 预热只在**主线程**初始化 WASM。当首次大导出触发 Worker 模式时，Worker 线程会**独立**再走一次 `initWasm(wasmUrl)`（Web Worker 有独立全局，见 4.9 澄清）。后果：
>
> - WASM **二进制只下载一次**（浏览器 HTTP 缓存，~700KB gzip）；
> - 但 WASM **编译/实例化各算一份**（主线程一份 + Worker 一份），双倍吃 CPU 与内存（每份约 1.9MB 解压后实例）。
>
> 三种策略，按场景选：
>
> 1. **不预热主线程**（推荐用于「导出基本都走 Worker」的 App）：删掉上面 `requestIdleCallback` 块，主线程永不初始化 WASM，省一份编译成本；`exportExcel` 的 `main` 模式（<20,000 行）仍能用，但首次会付一次主线程 init 成本（可接受，因为小数据量）。
> 2. **预热主线程 + Worker 预热**：在 `requestIdleCallback` 里同时 `postMessage` 一个 `init` 消息给 Worker（需在 `worker-exporter.ts` 增加 `init` 消息分支，调 `initWasm`），让两个线程都在空闲期完成编译，避免首次导出时的编译尖峰。
> 3. **保持现状（仅预热主线程）**：最简单，但首次 Worker 导出会有一次 Worker 内编译耗时（~50-150ms，含在 Worker 端到端耗时内，不影响主线程阻塞预算）。
>
> 默认采用策略 3（简单），若 7.3 实测发现首次 Worker 导出端到端超预算，切策略 2。

### 5.3 模式自动调度（v2.0 重写，对齐 4.10 pickMode；v2.6 阈值对齐）

> **v2.0 修正**：v1.9 的 5.3 是 v1.8 残留——用 10 万行阈值 + "结构化克隆入向"（v1.9 已删除 flat-encoder，称其为"硬伤 3"），与 4.10 pickMode（5 万行阈值 + 结构化克隆）直接冲突。照 5.3 实现会 reintroduce 已确认的数据损坏缺陷。v2.0 重写本表，与 4.10 完全一致。
>
> **v2.6 修正**：Worker 阈值随源码更新为 20,000（提交 0c0fbd5），下表已按现行 `pickMode` 修正浏览器 <20,000 / 20,000–49,999 的分档；v2.0 原表分档为 500。

| 数据量             | 运行环境     | auto 模式路由 | workerMode | 理由（v2.0 二次实测；v2.6 阈值）                                                                                                                                                                           |
| ------------------ | ------------ | ------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| < 20,000 行        | **浏览器**   | **main**      | —          | 10k×4 列 main 实测 ~117ms（1万 10列 263ms），主线程短阻塞可接受（产品决策，见 1.2 v2.6 注）                                                                                                                |
| < 50,000 行        | **Node/SSR** | **main**      | —          | Node 无 Web Worker，只能 main（接受阻塞，SSR 场景无交互预算约束）                                                                                                                                          |
| 20,000 – 49,999 行 | **浏览器**   | **worker**    | workbook   | Workbook 路径支持完整 StyleBuilder 样式；5万行实测 ~648ms 达标（<700ms）。入向结构化克隆 5万行 46ms                                                                                                        |
| ≥ 50,000 行        | **浏览器**   | **worker**    | **stream** | Workbook 路径 toBuffer 在 ≥5.5万行开始超线性塌方（6万 1.6s / 8万 7.6s / 10万 17.5s）。Fast stream（fast-xlsx）全流程 10万行实测 ~762ms 达标（<1000ms）。stream v1 不支持样式，需样式的大数据拆分或接受降级 |
| ≥ 50,000 行        | **Node/SSR** | **stream**    | stream     | 同上，Node 直接主线程跑 stream（fast-xlsx 不依赖 Worker 与 WASM）                                                                                                                                          |

> **stream 阈值从 10 万降到 5 万**（v1.9 确立，v2.0 确认）：toBuffer 塌方起始点在 5.5–6 万行（实测 6万 1.6s 已超线性）。5 万是 Workbook 路径的保守安全上限（实测 ~648ms）。≥5 万行一律走 stream，避开塌方边界的不确定性。
>
> **stream 的样式限制（已知取舍；v2.6 注）**：现行 fast-xlsx 完全不产出样式（连 `style`/`headerStyle` 数据列样式也 warn 后丢弃）；v2.0 时代的 `StreamingXlsxWriter` 也只接受 `StreamingCellInput.style` 数字索引（需配合 `setStylesXml`）。v1 的 stream 路径只支持纯数据，且 `width`/`freezeRows`/`autoFilter`/`merges` 等 `SheetConfig` 布局字段在 stream 模式下仅 `console.warn` 后丢弃（见 4.8 现行源码的 skipped 清单）。需要完整样式的大数据导出（≥5万行）在 Phase 1 暂不支持，业务侧需：① 拆分为 <5 万行（≤49,999）/文件走 Workbook；② 或接受纯数据。这是工程取舍，非 bug。
>
> **Worker 阈值 20,000 行（v2.6 对齐源码）**：main 模式 1万行4列实测 ~117ms、1万行10列 263ms 全阻塞（toBuffer 占大头）。现行产品决策为 <20,000 行接受主线程短阻塞、≥20,000 行进 Worker（提交 0c0fbd5，v1.8 时代曾为 500）。阈值可由调用方通过 `mode` 显式覆盖。

### 5.4 降级链路

```
WASM 不支持 ─┐
              ├─→ SheetJS（xlsx，无样式，保证可用）
WASM 加载失败 ─┘
```

降级时在控制台 `warn`，并在 `ExportResult.engine` 标记 `'sheetjs'`，便于业务方监控降级率。

### 5.5 内存控制

- 流式模式（v2.6 注：现行 `fast-xlsx`）以内存换吞吐——worksheet XML 在内存中一次拼装后用 fflate 同步压缩，内存占用随行数线性增长，但常数小、适配 5–10 万行档位（v2.0 时代的 `StreamingXlsxWriter` 为逐行写入、内存与行数无关，见 4.8 历史记录）。
- v1.9 修正（推翻 v1.8 的扁平化方案）：worker 模式下主线程只做一次 **结构化克隆** `postMessage(options)`（实测 10万行 94ms，非 v1.8 谎报的 163ms）。v1.8 的 `encodeFlat` 已删除——它在混合类型列静默损坏数据（硬伤 3），且省下的 81ms 在 toBuffer 17 秒塌方面前占比 0.5%（硬伤 5）。全部核心工作（Workbook 构造/fast-xlsx 拼装压缩）在 Worker 线程执行，结果 `Uint8Array` 通过 Transferable 零拷贝回传。大数据量（≥5万行）Worker 内走 stream（fast-xlsx 10万行 ~0.8s），绕开 `Workbook.toBuffer()` 的 ≥8 万行塌方（见硬伤 1）。
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
2. **`export.worker.js`**（来自 `@marcusok/excel-exporter` 包，自建薄 Worker 脚本，见 4.9）。

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
        const workerSrc = `${exporterDist}/export.worker.js`;
        if (!statSync(workerSrc, { throwIfNoEntry: false })) {
          throw new Error(
            `[excel-exporter] 未找到 export.worker.js：请先在库包内 pnpm build（产物在 dist/export.worker.js）。目录：${exporterDist}`,
          );
        }
        copyFileSync(workerSrc, "public/assets/export.worker.js");
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
  workerUrl: "/assets/export.worker.js",
});
```

> **路径选择说明**：`require.resolve('modern-xlsx')` 走 `exports['.']`（即 `./dist/index.mjs`）取得真实磁盘目录，自动跟随 pnpm 符号链接，比硬编码 `node_modules/modern-xlsx/dist` 稳。
>
> 若使用 webpack 5，需在 `module.rules` 配置 `type: 'asset/resource'` 处理 `.wasm` 与 `.mjs` worker，并设置 `experiments.asyncWebAssembly: false`（modern-xlsx 自己管理实例化）。Worker 脚本同理用 `asset/resource` 拷贝后以显式 URL 引用（本项目 Worker 已是标准 ESM 模块，勿用旧版 `worker-loader`）。

### 6.3 典型调用

> **v2.0 提示**：8 万行会走 worker + stream（≥5 万行阈值，见 4.10/5.3）。stream 路径 v1 不支持 StyleBuilder 样式，故本例中的 style 和 format 在 8 万行场景下实际不生效。若需带样式，请将数据量控制在 <5 万行（≤49,999 行，走 Workbook）。以下示例改用 FormatSpec（worker 兼容）而非函数形式。

```ts
import {
  exportExcel,
  StylePresets,
  configureWasm,
} from "@marcusok/excel-exporter";

configureWasm({
  wasmUrl: "/assets/modern-xlsx.wasm",
  workerUrl: "/assets/export.worker.js",
});

// 拉取数据后导出
const rows = await api.fetchSales(); // <5 万行（≤49,999）时带样式走 Workbook；≥5 万行（50000 起）走 stream（纯数据）

await exportExcel({
  filename: `销售明细-${Date.now()}`,
  sheets: [
    {
      name: "销售明细",
      freezeRows: 1,
      autoFilter: true,
      columns: [
        { key: "orderId", header: "订单号", width: 18 },
        { key: "product", header: "产品", width: 20 },
        {
          key: "amount",
          header: "金额",
          width: 12,
          style: StylePresets.currency,
        },
        {
          key: "createdAt",
          header: "下单时间",
          width: 18,
          style: StylePresets.datetime,
        },
        // v2.0: format 用 FormatSpec（worker 兼容），而非函数
        {
          key: "status",
          header: "状态",
          width: 10,
          format: {
            type: "enum",
            map: { paid: "已支付", pending: "待支付" },
            fallback: "未知",
          },
        },
      ],
      data: rows,
    },
  ],
});
```

> **format 两种形式的适用场景（v2.6 阈值对齐）**：函数形式 format: (v) => ... 在浏览器 main 路径（auto <20,000 行）与 Node（main / stream 主线程执行）有效；浏览器 worker 路径（auto ≥20,000 行或显式 worker/stream）会被剥离并 warn（见 4.9）。需要 worker 兼容时用 FormatSpec 对象。需要复杂逻辑时，在导出前自行预处理 data。

---

## 七、测试策略

### 7.1 单元测试（Vitest）

（v2.7 注：下表按现行 `src/__tests__/` 实际文件对齐；旧表列有 `style-utils` 行但仓库并无该测试文件，`fallback` 行的「可被 XLSX.read 解析」也非实际断言。）

| 测试文件                                      | 重点                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `format.test.ts`                              | applyFormat/displayValue/FormatSpec 各类型；日期 UTC 口径跨路径一致（v2.7 新增）                                    |
| `wasm-loader.test.ts`                         | error 态下任意 `configureWasm` 可重试、URL 变更重初始化、同 URL 不重复初始化（vi.mock 注入 modern-xlsx，v2.7 新增） |
| `builder.test.ts`                             | aoa 批量写入结果正确（行列、表头、样式、冻结、合并、headerStyle）                                                   |
| `stream.test.ts`                              | fast-xlsx 数据完整性、日期 pattern 字符串（UTC 口径）                                                               |
| `fallback.test.ts`                            | SheetJS 降级产出非空 Blob、`engine: "sheetjs"`、多 sheet rowCount                                                   |
| `adapters/routing/phases/performance.test.ts` | table/echarts 适配器、pickMode 路由阈值、onPhase 阶段序列、性能基准                                                 |

### 7.2 性能基准测试（关键验收）

`src/__tests__/performance.test.ts`，**本地**回归看门狗（Node 22，单线程；CI 以 `RUN_PERF=0` 跳过，因 shared runner 抖动大）。**本套件只测 WASM-core/fast-writer 回归下限，不替代 7.3 的浏览器端到端验收**（见下方「测什么 / 不测什么」说明）：

> **测什么 / 不测什么（v2.6 修订，与 1.2 验收表、4.10 pickMode 对齐）**：
>
> - **现行口径**：三档均用 `mode:'auto'`。Node 无浏览器 `Worker` 全局（`typeof Worker`/`typeof window` 任一为 `undefined`），auto 在 Node 解析为：<50,000 行 main（1 万行档，测 Workbook 回归）、≥50,000 行 stream（5 万/10 万行档，断言 `r.mode === "stream"`，测 fast-xlsx 回归）。**浏览器现行路由与旧口径不同**：`WORKER_THRESHOLD=20_000`（v2.6 对齐，提交 0c0fbd5），浏览器 1 万行 auto 走 **main**、5 万/10 万行走 worker——Node 数字作为 worker 内等价工作的代理依据，但 worker 端到端还叠加入向结构化克隆（1万 9ms / 5万 46ms / 10万 94ms）+ Worker 启动 + WASM 首次编译 + 出向 Transferable 回传，**从未实测**，属 7.3 Playwright 计划（当前未实现）。
> - **三档的真正端到端验收（worker 端到端耗时 + 主线程阻塞预算）只能在 7.3 Playwright 进行**（当前未实现）。Node 套件守"core 不退化"，Playwright 套件守"端到端达标"，两者缺一不可（见下方一句话总结）。
> - 一句话：**Node 套件守"core 不退化"，Playwright 套件守"端到端 + 主线程预算达标"**。两者缺一不可。

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { exportExcel } from "../index";
import { makeData, fourCols } from "./setup";

// CI skips these tests (RUN_PERF=0), so the local threshold is exactly the
// product SLA. Keep PERF_TIGHT for CI/local overrides if a future pipeline
// decides to run them on shared hardware.
const SLACK = Number(process.env.PERF_TIGHT ?? 1) > 0 ? 1.0 : 1.0;

// Perf 基线只在本地当回归看门狗；CI shared runner 抖动大，跑它只会 flake。
// 本地默认跑；设 RUN_PERF=0 跳过（CI 里用）。
const RUN_PERF = process.env.RUN_PERF !== "0";

describe.runIf(RUN_PERF)(
  "performance (Node WASM-core regression baseline)",
  () => {
    // Warm up WASM + JIT so init/compile cost isn't billed to the first case.
    beforeAll(async () => {
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

    it("10k rows x 4 cols (auto) < 200ms", async () => {
      const data = makeData(10_000);
      const t0 = performance.now();
      const r = await exportExcel({
        filename: "p10k",
        download: false,
        mode: "auto",
        sheets: [{ name: "s", columns: fourCols, data }],
      });
      const dt = performance.now() - t0;
      expect(r.success).toBe(true);
      expect(dt).toBeLessThan(200 * SLACK);
    });

    it("50k rows x 4 cols (auto) < 500ms", async () => {
      const data = makeData(50_000);
      const t0 = performance.now();
      const r = await exportExcel({
        filename: "p50k",
        download: false,
        mode: "auto",
        sheets: [{ name: "s", columns: fourCols, data }],
      });
      const dt = performance.now() - t0;
      expect(r.success).toBe(true);
      expect(r.mode).toBe("stream");
      expect(dt).toBeLessThan(500 * SLACK);
    });

    it("100k rows x 4 cols (auto) < 1000ms", async () => {
      const data = makeData(100_000);
      const t0 = performance.now();
      const r = await exportExcel({
        filename: "p100k",
        download: false,
        mode: "auto",
        sheets: [{ name: "s", columns: fourCols, data }],
      });
      const dt = performance.now() - t0;
      expect(r.success).toBe(true);
      expect(r.mode).toBe("stream");
      expect(dt).toBeLessThan(1000 * SLACK);
    });

    it("format function overhead does not dominate", async () => {
      const data = Array.from({ length: 10_000 }, (_, i) => ({ id: i }));
      const base = { name: "s", columns: [{ key: "id", header: "ID" }], data };

      const t0 = performance.now();
      await exportExcel({
        filename: "f1",
        download: false,
        mode: "main",
        sheets: [base],
      });
      const noop = performance.now() - t0;

      const t1 = performance.now();
      await exportExcel({
        filename: "f2",
        download: false,
        mode: "main",
        sheets: [
          {
            ...base,
            columns: [
              {
                key: "id",
                header: "ID",
                format: (v: unknown) => `#${String(v)}`,
              },
            ],
          },
        ],
      });
      const fn = performance.now() - t1;

      expect(fn - noop).toBeLessThan(30 * SLACK);
    });
  },
);

// The toBuffer cliff (Workbook 100k ~21s cold / ~600ms hot) is verified
// out-of-band via independent processes (see README). It cannot be asserted
// reliably in a single vitest process because the second run hits the hot
// cache (documented 28x first/hot gap). The 50k stream threshold is conservative.
```

> **容差（v2.6 对齐源码）**：`SLACK` 恒为 1.0——本地阈值即产品 SLA 本身（10k <200ms / 50k <500ms / 100k <1000ms）。历史版本的「默认 1.5x、`PERF_TIGHT=1` 收紧到 1.0x」机制已随 CI 跳过策略移除（`PERF_TIGHT` 现无效果，保留读取仅为兼容）。CI 以 `RUN_PERF=0` 跳过整套性能基准。`beforeAll` 的预热避免把 `initWasm()` 的编译耗时计入首个 case——否则首个 case 会无端超阈值 100ms+。
>
> **worker 模式为何不在 Node 测试（M5 修正）**：经源码核实，`modern-xlsx.worker.js` 与本库 `export.worker.ts` 都用 Web Worker 全局（`globalThis.addEventListener('message')` / `self.onmessage` / `postMessage`），Node 的 `worker_threads` 用 `parentPort`，两者不兼容。因此 5 万行（worker 路径）与 10 万行带样式（worker 路径）的**端到端耗时 + 主线程阻塞 ≤16ms** 必须在 7.3 的浏览器集成测试（Playwright）中验收。Node 套件的 50k/100k case 仅作 core 回归下限，**不能当作 worker 端到端验收通过的依据**——worker 端到端 = core 工作量 + 入向结构化克隆（5 万行 35-100ms，见附录 A）+ Worker 启动 + 出向回传，系统性高于 Node 测出的数值。

### 7.3 集成测试

- **浏览器端（功能）**：Playwright 跑一个 demo 页面，点击导出，验证下载文件可被 Excel/LibreOffice 打开、行列数正确。
- **浏览器端（worker 路径端到端 + 主线程预算，S3 关键验收点）**：分别用 5 万行（`mode:'worker'`，阈值 < 1000ms；50000 在 worker 内走 stream）与 10 万行（`mode:'worker'`，阈值 < 2000ms，**最紧张验收点**，见 1.2 表与附录 A 余量仅 1.3-2.2x）触发导出，通过 `PerformanceObserver({ entryTypes: ['longtask'] })` 记录导出期间 >50ms 的长任务数量并断言 longtask 数量（5万行应为 0；10万行因入向结构化克隆 ~94ms > 50ms，允许 ≤1，见附录 A 与下方 100k 用例）；同时记录端到端耗时达标。worker 路径的端到端验收**只能在此处**进行（7.2 Node 套件无法覆盖，见该节 M5 说明）。
- **Node 端（回读校验）**：用 `readBuffer` 读回导出文件，校验单元格值与样式 `styleIndex` 是否命中预期 `cellXfs`。

**Playwright 测试骨架（5 万行 + 10 万行 worker 端到端验收 + 降级）**：

> **以下为规划骨架，尚未实现**：本仓库当前未引入 `@playwright/test`（见附录 F），以下 Playwright 用例为设计阶段规划骨架，待 Phase 1/4 落地后再补齐 demo 页与触发钩子。

```ts
import { test, expect } from "@playwright/test";

test("worker-mode 5万行 × 4列: 端到端 < 1000ms 且无 longtask (4列基准)", async ({
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
  expect(result.duration).toBeLessThan(1000);
  // 断言主线程无 >16ms 阻塞（PerformanceObserver 检测 longtask > 50ms）
  const longTasks = await page.evaluate(() => (window as any).__longTasks);
  expect(longTasks).toBe(0);
});

test("worker-mode 10万行 × 4列: 端到端 < 2000ms 且无 longtask (4列基准, 最紧张验收点)", async ({
  page,
}) => {
  // 4 列基准（见 1.2 列数缩放规则）。列数增加时按 budget(4列)×(C/4) 放宽阈值。
  // 此 case 对应 1.2 表的最紧验收点。附录 A 自评余量仅 1.3-2.2x，
  // 若逼近上限，按附录 A 优化方向（减 format 开销 / 预分配 styleIndex / stream 阈值下调）。
  // 注意：100k 带样式走 worker（pickMode 见 4.10）；100k 无样式走 stream，stream 路径
  // 主线程天然不阻塞（v2.7 注：浏览器下 fast-xlsx 在 Worker 内执行——旧文「逐行写入在 WASM」
  // 是已退役的 StreamingXlsxWriter 模型，现行 fast-xlsx 不依赖 WASM），但端到端耗时仍在此验收。
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
  expect(longTasks).toBeLessThanOrEqual(1); // 100k structured clone ~94ms > 50ms longtask; see appendix A & 1.2
});

test("worker-mode WASM 初始化失败时触发降级", async ({ page }) => {
  await page.goto("/demo?wasmFail=1");
  const result = await page.evaluate(() => (window as any).triggerExport());
  expect(result.success).toBe(true);
  expect(result.engine).toBe("sheetjs");
});
```

> **demo 页面与触发钩子**：上述 `trigger50kExport()` / `trigger100kExport()` / `triggerExport()` 需由一个 Playwright 专用 demo 页面提供（在 `apps/demo` 或 `packages/excel-exporter/demo`，Phase 1 预研阶段搭建）。钩子内部调 `exportExcel({ mode: 'worker', sheets: [{...数据...}] })` 并把 `ExportResult` 挂到 `window` 供断言读取。`wasmFail=1` query 用于注入错误的 `wasmUrl` 触发降级路径（4.12）。**所有触发钩子默认用 4 列基准数据**（与 1.2 列数缩放规则一致）；如需测试更多列，在 query 参数指定（如 `?cols=10`），阈值按 `budget(4列)×(cols/4)` 放宽。
>
> **10 万行 timeout**：`waitForEvent('download', { timeout: 30000 })` 给足 Worker 端到端 + WASM 编译 + ZIP 序列化的时间。若 CI 频繁超时，先排查是否首次导出未预热（WASM 编译尖峰），参考 5.2 策略 2（主线程 + Worker 并发预热）。

---

## 八、实施计划与里程碑

| 阶段                   | 周期        | 关键交付物                                                                                                     | 验收标准                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 1：技术预研      | 第 1-2 周   | 选型报告、Vue3+Vite Demo                                                                                       | modern-xlsx 在 Vite 中跑通 WASM 加载 + 批量导出；**worker 自包含打包 go/no-go 关卡（S5）**：tsup 把 modern-xlsx 打进 `export.worker.js` 后，`new Worker(url,{type:'module'})` 能正常加载且 worker 内 `initWasm(wasmUrl)` 成功（实测 esbuild 对 `new URL("modern_xlsx_wasm_bg.wasm", import.meta.url)` 原样保留，技术路径成立，但必须真机验证产物可运行）                                                                                                                                                                                         |
| Phase 2：Monorepo 搭建 | 第 3 周     | pnpm+turbo+tsup+lint+CI 骨架                                                                                   | `pnpm build/test/lint` 全绿，CI 通过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Phase 3：核心包实现    | 第 4-6 周   | `@marcusok/excel-exporter` main 模式（WorkbookBuilder + StyleBuilder 样式 + FormatSpec 格式化 + SheetJS 降级） | main 模式导出 <5万行带完整样式可用；format/style/preset 单测全过；round-trip 读回校验通过；**对应 v0.1 发布节点**                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Phase 4：Worker + 流式 | 第 7-8 周   | Worker 多线程、流式写入                                                                                        | **4 列基准（v2.0 口径）**：1万行 worker 端到端 < 200ms；5万行 worker+stream 端到端 < 1000ms（对齐 1.2 验收表，50000 行走 stream）且 longtask 符合 1.2 主线程预算；10万行 worker+stream 端到端 < 2000ms 且无 longtask（7.3 Playwright 验收，列数缩放见 1.2 规则）；10 万行 stream 不 OOM；**worker 自包含打包 go/no-go 必须在 Phase 1 通过（见上），否则 Phase 4 无法验收**。**v2.6 注**：v2.5 切换 fast-xlsx 后已恢复原始硬指标（5万 <500ms / 10万 <1000ms，见 1.2 验收表），且现行 `WORKER_THRESHOLD=20_000` 下浏览器 1 万行走 main 而非 worker |
| Phase 5：首个 App 接入 | 第 9-10 周  | admin-a 接入上线                                                                                               | 线上稳定无报错，降级率 < 1%                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Phase 6：全面推广      | 第 11-12 周 | 所有 App 接入                                                                                                  | 接入率 100%，沉淀文档与监控                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**v0.1 发布节点（Phase 3 末）** 即可对外可用（main 模式 + 样式），Worker/流式在 v0.2 补齐。

---

## 九、风险与应对

| 风险                            | 概率 | 影响 | 应对                                                                                                                                              |
| ------------------------------- | :--: | :--: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| WASM 加载失败（CDN/网络）       |  中  |  高  | 自托管 `.wasm`；3 次指数退避重试；失败降级 SheetJS                                                                                                |
| 浏览器不支持 WASM               |  低  |  高  | `WebAssembly` 能力检测，直接走 SheetJS                                                                                                            |
| Worker 序列化开销大             |  中  |  中  | 仅 ≥20,000 行启用 Worker（auto；可用 `mode` 显式覆盖，v2.6 对齐源码）                                                                             |
| modern-xlsx 版本不兼容          |  低  |  中  | 锁定 `^1.2.0`；升级走 Changeset minor 流程 + 回归测试                                                                                             |
| 大文件 OOM                      |  中  |  高  | ≥5 万行走 fast-xlsx（fflate minimal OOXML，v2.5 起；旧写 `StreamingXlsxWriter` 已弃用）；监控内存                                                 |
| 颜色/样式在 Excel 中显示异常    |  低  |  中  | 用 6 位 RGB hex（不带 `#`）；样式单测 + 真机抽样验证                                                                                              |
| SheetJS 降级路径缺少样式        |  中  |  低  | 可接受；监控降级率，逐步修复 WASM 加载根因                                                                                                        |
| 浏览器 ≥20,000 行忘配 workerUrl |  中  |  中  | 当前实现降级 SheetJS 并打 console.warn（丢样式，非静默）；显式 configureWasm({workerUrl})；可选改进：检测缺失时回退 main 保样式（见 4.9 v2.2 注） |

---

## 十、附录

### 附录 A · 性能数据来源与口径（v1.9 重写）

> 🚨 **v1.9 整体重写**：v1.3 的五段模型基于"toBuffer 100-150ms"的错误估算，且全部采用同进程热状态数字，未发现首次惩罚。v1.9 用独立进程实测后，下表所有数字均为**独立进程首次跑**（最贴近真实浏览器首次导出），与正文 1.2 验收表一致。

**核心实测数据（modern-xlsx@1.2.0，Node 22，4 列，独立进程首次跑，每个数字多次稳定）**：

| 指标                     | 独立进程实测（首次）                          | 同进程第二次（热状态） | 数据来源                                             |
| ------------------------ | --------------------------------------------- | ---------------------- | ---------------------------------------------------- |
| Workbook 路径 1 万行     | 113–119 ms                                    | ~70 ms                 | 实测（sheetAddAoa + toBuffer）                       |
| Workbook 路径 5 万行     | 648 ms                                        | ~310 ms                | 实测                                                 |
| Workbook 路径 8 万行     | **8356 ms**                                   | —                      | 实测（塌方起始）                                     |
| Workbook 路径 10 万行    | **17578 ms**                                  | ~628 ms                | 实测（塌方，5 个独立进程稳定 17.3-18.3s）            |
| Stream 路径 10 万行      | **~1,548 ms**（writeRow ~1,451 + finish ~93） | —                      | v2.0 二次实测（v1.9 记为 1630ms，误差 < 6%，已对齐） |
| Stream finish() 10 万行  | **~93 ms**（92–128）                          | —                      | v2.0 二次实测（v1.9 误记为 3ms）                     |
| 结构化克隆 10 万行       | 94 ms                                         | —                      | 实测（structuredClone，中位）                        |
| 结构化克隆 5 万行        | 46 ms                                         | —                      | 实测                                                 |
| 结构化克隆 1 万行        | 9 ms                                          | —                      | 实测                                                 |
| drawTableFromData 5 万行 | 471 ms                                        | —                      | 诊断性测量（非本包生产路径，见附录 E）               |

**关于"首次惩罚"与"热状态"的差异（v1.9 关键发现）**：

`Workbook.toBuffer()` 在 ≥8 万行存在巨大的首次/热状态差异。独立进程首次跑 10 万行 17.5 秒，同进程第二次仅 628ms，相差 28 倍。这**不是** WASM 编译热身（`initWasm` 只占 3-4ms），而是 `toBuffer` 内部在大 workbook 序列化时的性能塌方——可能源于 ZIP 压缩或 shared strings 处理的超线性路径，具体成因列为 Phase 1 头号调研项。`WriteOptions` 只有 `password`，无压缩级别等可调参数，**无法通过 API 规避**。

**结论与方案选择**：

- **<5 万行（≤49,999）**：Workbook 路径首次 648ms，稳态 310ms，余量充足 → 用 Workbook（支持完整 StyleBuilder 样式）。
- **≥8 万行**：Workbook 首次塌方（8 万 8s / 10 万 17s），完全不可接受 → **必须走 Stream**（首次 ~1,548ms，是 Workbook 的 1/10）。
- **5-8 万行**：风险区。v1.9 保守地把 stream 阈值定在 5 万，彻底避开塌方边界的不确定性。

**关于官方 README benchmark**：README「写 10 万行 232ms / 5 万行 49ms」**只测 `aoaToSheet`（不含 toBuffer），且是热状态**。不可用作端到端验收依据，更不能据此外推 toBuffer 开销（v1.3 据此外推 100-150ms 是错的，首次实测 17 秒）。

> **Worker 入向结构化克隆开销（v1.9 实测，修正 v1.8 的 163ms）**：v1.8 声称"10 万行结构化克隆 163ms"是被高估的错误数字（v1.8 据此引入 flat-encoder）。v1.9 实测中位 94ms（5 次测量 92-106ms 稳定）。这个开销在 Worker 端到端里占比：① 10 万行 Workbook 路径首次 17.5s 中占 0.5%；② 10 万行 Stream 路径 1.6s 中占 6%。无论哪种，结构化克隆都不是瓶颈，**无需扁平化优化**（扁平化反而引入硬伤 3 的数据损坏）。

### 附录 B · 与参考 PDF 的差异修正（重要）

参考 PDF 整体方向正确，但部分 API 调用与实际 modern-xlsx@1.2.0 不符。本文档已逐一修正，列出以备追溯：

| PDF 中的写法                                            | 实际 API（已核实）                                                       | 修正说明                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ws.cell(0, colIndex)` 数字坐标                         | `ws.cell('A1')` A1 字符串                                                | `cell(ref: string)` 只接收 A1 ref                                                                                                                                                                                        |
| `ws.batch().writeRows(1, rowData)`                      | `aoaToSheet(aoa)` / `sheetAddAoa(ws, aoa, {origin})`                     | 不存在 `batch()` 方法；批量写靠工具函数                                                                                                                                                                                  |
| `ws.mergeRange(startRow, startCol, endRow, endCol, '')` | `ws.addMergeCell('A1:D1')`                                               | 合并只接收 A1 range 字符串                                                                                                                                                                                               |
| `ws.setFreezePanes(n, 0)`                               | `ws.frozenPane = { rows: n, cols: 0 }`                                   | 通过 setter，不是方法                                                                                                                                                                                                    |
| `setColumnWidth(colIndex, ...)` 0-based                 | `setColumnWidth(col, width)` **1-based**                                 | PDF 写法存在 off-by-one                                                                                                                                                                                                  |
| 自建 `export.worker.ts` + `self.onmessage`              | `createXlsxWorker` 只搬序列化；`Workbook.toJSON()` 可导出 `WorkbookData` | 方向**反转**：PDF 写法（自建薄 Worker）反而是本方案采用的正解——`createXlsxWorker.writeBuffer(wb.toJSON())` 技术可行，但只把 ZIP 序列化搬到 Worker，`aoaToSheet` 构造 + 整列样式赋值仍跑主线程，突破 ≤16ms 预算（见 4.9） |
| `wb.toBuffer()` 后手动 `new Blob([buffer])`             | `writeBlob(wb)` 直接返回 Blob                                            | 浏览器场景有更简洁 API                                                                                                                                                                                                   |
| WASM 体积「1.1MB」                                      | 实际 `.wasm` 文件 1.9MB（README 1.1MB 为压缩前理论值）                   | 体积评估按 1.9MB                                                                                                                                                                                                         |
| `s.font({}).build(wb.styles)` 链式                      | ✅ 正确                                                                  | StyleBuilder 链式 API 属实                                                                                                                                                                                               |
| `wb.createStyle()`                                      | ✅ 正确                                                                  | 存在该方法                                                                                                                                                                                                               |
| `initWasm()` 幂等                                       | ✅ 正确                                                                  | README 明确 safe to call multiple times                                                                                                                                                                                  |
| benchmark 数字（232/49/472ms）                          | ✅ 与官方 README 完全一致                                                | 数字属实                                                                                                                                                                                                                 |
| —（PDF 未提及）                                         | `Workbook.toJSON(): WorkbookData`                                        | 核心序列化方法存在，`writeBlob` 内部即 `wb.toJSON()`                                                                                                                                                                     |

### 附录 C · 关键依赖版本清单（建议锁定）

| 依赖               | 版本                          | 用途                                                                                             |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| modern-xlsx        | ^1.2.0                        | 核心引擎                                                                                         |
| xlsx（SheetJS CE） | >=0.18.5（npm latest 即此版） | 降级方案（optional peerDep）；v1.9 从 >=0.20.0 放宽，避免 strict-peer-dependencies 报错，见 4.12 |
| typescript         | ^5.9.3                        | 语言                                                                                             |
| tsup               | ^8.3.5                        | 包构建                                                                                           |
| vitest             | ^4.1.10                       | 测试                                                                                             |
| turbo              | ^2.3.3                        | Monorepo 编排                                                                                    |
| pnpm               | 9.12.0                        | 包管理（packageManager 字段）                                                                    |
| @changesets/cli    | ^2.27.10                      | 版本/发布                                                                                        |
| eslint             | ^9.16.0                       | Lint（flat config）                                                                              |
| typescript-eslint  | ^8.18.0                       | TS lint 规则（flat config 用）                                                                   |

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

**取舍建议**：`drawTableFromData` 适用于多数常规导出场景（单表头 + 统一列样式）。当需要非标准布局（多行表头、跨 Sheet 公式、条件格式、图表）或需要每列独立 `StyleBuilder` 构建的精细样式控制时，回退到 `WorkbookBuilder` 手动路径。`drawTableFromData` 内部也是 WASM 批量写入，性能不会比手动 AOA 差。对于仅需纯数据流式导出（无样式）的场景，仍使用 `StreamingXlsxWriter`（4.8）。建议在 `workbook-builder.ts` 中加入 `useDrawTable` 选项，默认走 `drawTableFromData`，用户可显式指定 `useDrawTable: false` 回退手动路径。

---

**文档版本**：v2.6 ｜ **核对基准**：modern-xlsx@1.2.0（npm tarball 解包 + `dist/index.d.mts` + `dist/validate-chart-D1O7LOfU.d.mts` 类型定义 + `dist/utils-Fc_qcAP_.mjs` / `dist/modern-xlsx.worker.js` 源码）+ **Node v22.22.2 独立进程二次实测**（toBuffer 塌方/stream/结构化克隆/finish 分步，共 30+ 次）+ **v2.6 仓库源码逐文件比对**（`packages/excel-exporter/src`，快照与源码 diff 一致）｜ **最后更新**：2026-08-17（v2.6 源码再对齐：WORKER_THRESHOLD 20,000、fast-xlsx/worker 快照刷新、PERF_TIGHT 机制移除说明；历史见文末修订历史）

---

### 附录 F · Node 版本与补充依赖（v2.1 重写）

> **本仓库用 Node 22，不升级到 24**：`@marcusok/excel-exporter` 与 monorepo 根的 `engines.node` 均为 `>=22.0.0`，`.nvmrc` 锁定 `22`，CI `node-version: 22`。核心依赖 modern-xlsx@1.2.0 的 `engines.node` 声明为 `>=24.0.0`，但其 WASM 核心面向浏览器、与 Node 版本无关；本仓库在 Node 22（v22.22.2）下 `lint/typecheck/test/build` 全绿（47 个用例实测通过；CI 以 `RUN_PERF=0` 跳过 4 个性能基准、实跑 43 个，v2.6 更新）。注意：modern-xlsx README 无 "Node Usage" 章节，其顶部声明要求 "Node.js 24+"，Node 22 可用性由本仓库测试实测而非 README 声明。`.npmrc` 设 `engine-strict=false`，避免 modern-xlsx 的 engines 声明在 Node 22 下阻断 `pnpm install`（见 3.5）。本地推荐 fnm/nvm 并 `fnm use`（读 `.nvmrc`）。
>
> v2.0 曾把 `@playwright/test`（`^1.62.0`）列入「补充依赖」、并写「Node 24+ 升级指引」，二者均与实际仓库不符（本仓库无 Playwright、CI 跑 Node 22），v2.1 已删除该依赖行与升级指引。关于 `unplugin`：6.2 的 Vite 插件是 Vite 原生插件对象（`{ name, buildStart() }`），全程未 import `unplugin`；若未来要让资源拷贝同时支持 Webpack，再按需引入。

---

> **StreamingXlsxWriter 样式工具函数（Phase 2 待实现，v2.0 规划）**：为降低 stream 模式下的样式构建门槛，
> 建议在 `streaming-builder.ts` 中提供 `buildStylesXmlForStream(wb: Workbook): string` 工具函数，
> 利用 `Workbook.styles`（类型 `StylesData`）按 OOXML 规范拼接 `<styleSheet>` XML。
> 拼接逻辑约需 80-100 行代码，实现后可通过 `writer.setStylesXml(xml)` 在 stream 模式下使用预注册的 styleIndex。
> 此功能优先级为 Phase 2（核心功能稳定后实现）。

---

### 修订历史

- **v2.7（跨路径日期口径统一 + wasm-loader 错误恢复修复 + 快照补齐，2026-08-18）**：
  - **P0 · 日期跨路径口径不一致（代码修复 + 实测确认）**：Workbook 路径 `applyFormat` date/datetime 走 modern-xlsx `dateToSerial`（内部 `toUtcMs` 取 **UTC 分量**，已核实 dist 源码），而 Stream/SheetJS 路径 `formatDateByPattern` 原取**本地分量**——同一输入两条路径显示可差一天（实测：UTC+8 下 `new Date(2025,0,5)` 本地 0 点经 Workbook 路径 serial=45661.6667，Excel 显示 2025-01-04；Stream 路径显示 2025-01-05）。既有测试未暴露的原因：round-trip 断言两端都走 UTC 约定，且测试机时区（UTC+8）下测试数据（14:30 / ISO 字符串）恰好不跨日。修复：`formatDateByPattern` 改用 `getUTC*` 分量；相关测试改 UTC 构造（断言与运行时区无关）并新增跨路径一致性回归用例；输入契约写入 `types.ts` JSDoc 与文档站（zh/en）。
  - **P1 · wasm-loader error 态粘滞（代码修复）**：`updateOptions` 原仅在 `wasmUrl` 变化时重置状态，加载失败（error）后按错误信息建议调 `configureWasm({timeoutMs:...})`（URL 不变）不会重试，后续 `ensureLoaded` 永远抛旧错误直接降级 SheetJS。修复：error 态下任何 `configureWasm` 调用都重置为 idle 重试（ready/loading 态语义不变）。新增 `wasm-loader.test.ts`（vi.mock 注入 modern-xlsx，隔离真实 initWasm 幂等性），并导出 `WasmLoader` 类供测试（不进包公开 API）。
  - **P2 · stream 进度重复上报（代码修复）**：`exportFastXlsx` 尾部与 `exportExcel` 各上报一次 `onProgress(1)`，stream/worker 路径末尾出现两次 1。修复：`exportFastXlsx` 不再自行收尾，由 `exportExcel` 统一上报（对 exportExcel 调用方行为不变：0 → 分段 → 1 各一次）。
  - **快照与残留清理**：4.4（types.ts 旧快照缺 `headerStyle`×2/`ExportPhase`/`onPhase`；format-utils 旧快照缺 `toStr` 的 Date→ISO 分支）、4.5（旧块无代码围栏、JSDoc 标记 `/_*`/`_/` 损坏；尾注建议的 `configureWasm({wasmUrl:<本地路径>})` 与 setup.ts 实测矛盾，改为 `initWasmSync(readFileSync(...))`）、4.7（旧快照缺 headerStyle 应用块）、4.12（旧快照缺 onPhase 上报）、4.6/4.11/4.13（注释/引号风格旧版）整体替换为现行源码，替换后经脚本 diff 校验逐字一致；4.2 两处与快照矛盾的文字（「exports 只保留 types+import 两段」「devDependencies 留空」）、1.2/7.3 的旧 StreamingXlsxWriter 成本模型残留（writeRow/finish/WASM ZIP/「逐行写入在 WASM」）、7.1 测试表（旧表含不存在的 style-utils 测试与未实际断言的 XLSX.read）均已按现状修正。
  - **文档站同步**：guide/04-formatting 与 api/03-format-spec（zh/en）补日期 UTC 约定；guide/02-installation（zh/en）修正 `configureWasm` 合并语义（error 态清除）。play/registry 注释修正（「静默降级」→ 有警告；durationMs 注释；wasm 改名理由）。
- **v2.6（源码再对齐，2026-08-17）**：
  - **WORKER_THRESHOLD 500 → 20,000 全文修正（P0）**：提交 0c0fbd5 将 `src/index.ts` 的 Worker 阈值从 500 调回 20,000，但正文（1.2 验收表与阻塞预算、4.10 pickMode 快照与 v2.2 注、5.2 策略、5.3 调度表与阈值注、6.3 format 适用场景、7.2 测什么说明、风险表、附录 G）仍按 500 口径陈述，已逐处修正并注明 v2.6；修订历史中 v1.8/v2.1/v2.4 条目对 500 的记载保留为历史记录。
  - **4.8/4.9/4.10/7.2 代码快照整体刷新**：streaming-builder.ts（薄委托）、fast-xlsx.ts（全量）、worker-exporter.ts、workers/export.worker.ts、index.ts、performance.test.ts 快照替换为现行源码，均与仓库文件 diff 校验一致。旧 StreamingXlsxWriter 实现块加【历史】标注保留。
  - **12d47a4 修复同步**：worker onerror 坏实例 terminate+重建、按实例过滤 reject、onPhase 从 Worker 转发、stripFunctionFormats 剥离回调——旧快照会复用坏 Worker「永远失败进 SheetJS」，已更新。
  - **stream 免 WASM**：4.10 旧快照在 pickMode 前无条件做 WASM 能力检测，现行 `needsWasm = workerMode !== "stream"`（fast-xlsx 不用 WASM）；不支持 WebAssembly 的浏览器 ≥5 万行不再降级 SheetJS。
  - **PERF_TIGHT/SLACK 机制说明修正**：现行 `SLACK` 恒为 1.0（本地阈值即产品 SLA），CI 以 `RUN_PERF=0` 跳过性能基准；7.2 旧文的「1.5x 容差、PERF_TIGHT=1 收紧」与「在 CI 上跑」均已过时。
  - **4.1/4.2 快照补齐**：文件清单补 fast-xlsx.ts / table-export.ts / echarts-export.ts / adapters.test.ts / phases.test.ts；package.json 快照更新为 1.0.1，补 `./package.json` 导出与 `fflate` 运行时依赖。
  - **附录 F 测试数更新**：35 → 47（CI 跳过 4 个性能基准、实跑 43）。
  - **顺手清理**：移除正文中 2 处残留的换页控制字符（v2.1「ormat 截断」修复的同类痕迹）；文档版本标签统一为 v2.6（v2.4 遗留的低优先级清理项，本次一并完成）。
- **v2.4（验收口径与值语义陷阱修正）**：
  - **P0 · 7.2「1 万行 = main 生产路径」自相矛盾（纠正）**：原 7.2 称 1 万行 `mode:'main'` "就是生产路径（pickMode 对 <500 行路由 main）"，但 1 万行 ≥ `WORKER_THRESHOLD`(500)，浏览器生产路径是 worker（与 5 万行同口径，见 `index.ts` pickMode）。"<500 行路由 main"是对 <500 行的描述，与 1 万行无关。已将 1/5/10 万行统一为同口径：Node 套件测的均是 WASM-core 回归下限，worker 端到端验收统一归 7.3 Playwright。
  - **P1 · 1.2 验收表列名误导（纠正）**：表头「端到端耗时上限」+「实测 109ms ✅」易被读成"worker 端到端已验收"，但实测数字均为 Node WASM-core 计时（worker E2E 从未实测）。已将列头改为「端到端耗时上限（目标）」+「WASM-core 实测（…worker E2E 见 7.3）」，去掉 ✅ 过度断言；同步修正 📌 注释中"端到端实测耗时"的自相矛盾措辞。
  - **P1 · 跨阈值 `number` decimals 默认陷阱（补充）**：实测确认 `{type:'number'}`（不指定 `decimals`）在 Workbook 路径存 `9999.99`、stream 路径存 `10000`（`toFixed(0)` 四舍五入）。原 4.8 📌 仅笼统说"精度有损"，已补明默认 0 陷阱；并在 `types.ts` 的 `ColumnConfig.format` JSDoc 补同一条警告。
  - 版本号三处不一致（顶部 v2.0 / 正文 v2.1 / 历史 v2.3）仍未统一，本次仅追加 v2.4，不动顶部/正文版本标签（留作后续低优先级清理）。
- **v2.3（5 万行边界口径纠正 + 跨阈值值语义提示）**：
  - **1.2 / 7.3 口径纠正**：原 "5 万行 = Workbook 路径 <700ms" 与代码矛盾 —— `STREAM_THRESHOLD=50_000` 用 `>=`，故恰好 50000 行（auto 与 `mode:'worker'`）实际走 stream（实测 ~850ms，独立进程复测 874–897ms）。已将 1.2 验收表 5 万行档改为 worker+stream / <1000ms / 实测 ~850ms，列数缩放标题、实测表 "选用" 列、塌方边界注释同步对齐，7.3 Playwright 5 万行用例断言 <700ms→<1000ms。Workbook 路径的 auto 适用范围明确为 <5 万行（≤49,999）。**未改代码**（代码行为合理、由 `routing.test.ts` 守护），仅纠正文档与代码/5.3/README 的矛盾。
  - **4.8 新增 📌**：补充跨阈值的值语义差异 —— `number` 在 Workbook（`applyFormat`，全精度 + numFormat 显示）与 stream（`displayValue`，`toFixed` 烤入值、精度有损）产出不同；`date`/`datetime` 在 Workbook 存日期序列、stream 存格式化字符串。
  - **撤回一项误判**：原疑 "源码 mojibake"（`format-utils.ts` / `performance.test.ts`），经 node 按字节复核证实为 **PowerShell 控制台 GBK 渲染 UTF-8 的假象**，源码为正确 UTF-8，无需修改。
  - 版本号标记（顶部 v2.1 / 正文 v2.2 / 本条 v2.3）尚未统一，列为低优先级后续清理。

- **v2.1（源码级对齐 + 渲染修复）**：
  - **7.2 测试代码对齐真实源码**：原 7.2 代码块与 `src/__tests__/performance.test.ts` 实际内容不符（内联 `genRows`、`SLACK` 默认 1.2、`beforeAll` 内联 WASM 初始化、50k 断言 `500ms`、100k 断言 `1000ms`、format 三变体）。整块替换为仓库真实源码（`makeData`/`fourCols` 来自 `./setup`、`describe.runIf(RUN_PERF)`、`SLACK` 默认 1.5、断言 10k<200ms / 50k<1000ms / 100k<2000ms，均 xSLACK；format 两变体，`fn-noop < 30*SLACK`）。
  - **渲染修复**：4.10 代码块开 fence 仅 2 个反引号（非法 fence，整段未渲染）-> 3 反引号；6.3 代码块 fence 损坏（开/闭各 1 反引号）、`filename:` 行为非法 JS、两处 ormat 截断 -> 修复为合法 TS。
  - **worker 产物名**：本库 worker 由 tsup 产出 `dist/export.worker.js`（`package.json` exports 即此），全文旧写的 `export.worker.mjs` 统一改为 `.js`（modern-xlsx 自带的 `modern-xlsx.worker.js`、`dist/index.mjs` 等不动）。
  - **阈值对齐源码**：风险表 Worker 序列化开销大 `>=5000 行`->`>=500 行`（`WORKER_THRESHOLD=500`）；大文件 OOM `>=10 万行`->`>=5 万行`（`STREAM_THRESHOLD=50_000`）；5.2 策略 1 `main 模式（<5000 行）`->`<500 行`。
  - **依赖清单**：附录 C 补 `typescript-eslint ^8.18.0`（`eslint.config.mjs` 直接 `import`，根 devDep）。
  - **Node 版本**：7.2 Node 24+ -> Node 22（`.nvmrc` 锁 22，CI 跑 22）。
  - **口径澄清**：7.2 prose 50k 阈值 `<700ms`->`<1000ms`（对齐 Node 回归断言；E2E `700ms` 仍见 1.2/7.3）；7.3 prose 阈值 `<500ms`/`<1000ms`->`<700ms`/`<2000ms`（对齐下方代码与 1.2）；容差 `1.2x`->`1.5x`（对齐 `SLACK`）；7.3 的 100k longtask 断言 `toBe(0)`->`toBeLessThanOrEqual(1)`（入向结构化克隆 10万行 ~94ms > 50ms longtask 阈值，见附录 A）。删除 1.2 重复段、Phase 4 重复行（旧 500/1000 阈值）。

- **v2.0（二次独立实测 + 源码核对评审修正）**：
  - **复确认**：v1.9 的 toBuffer 塌方论断二次复现成立（10万行 toBuffer 17,339ms，与 v1.9 的 17.3–18.3s 吻合）。架构方向（≥5万行走 stream）正确，保留。
  - **修正数字**：`finish()` 实测 ~93ms（非 v1.9 所写 3ms，6 次取中位 92–128）。全文 6 处 finish 3ms 已改为 ~90ms。stream 10万行全流程 ~1,548ms（writeRow ~1,451 + finish ~93）。
  - **修复代码缺陷**：format 联合类型调用 bug——4.4 定义 `FormatSpec | 函数`，但 4.7/4.8 builder 写 `col.format(raw,item)`，传 FormatSpec 对象时抛 TypeError（已最小复现）。引入 `resolveCellFormat()` 统一分流 + worker 入口剥函数。验证脚本确认 enum/number/padding + 函数 + 无 format 均正确。
  - **清理矛盾**：(a) 5.3 调度表是 v1.8 残留（10万阈值 + "扁平化入向"，与 4.10 的 5万阈值 + 结构化克隆冲突），重写对齐；(b) 4.9 format 两段自相矛盾（1263 行说改 FormatSpec，1298 行说函数进 Worker），重写为统一方案。
  - **wasm 文件名 / wasm-lite（v2.1 再修正，推翻 v2.0 的反向错修）**：tarball 内 `wasm-lite/` 目录**真实存在**（含 `modern_xlsx_wasm_bg.wasm` 1,877,118 B ≈ 1.88MB，lite 入口独立用），v2.0 误删了 v1.9 的正确描述；`dist/modern-xlsx.wasm`（2,000,604 B）与 `wasm/modern_xlsx_wasm_bg.wasm`（2,000,604 B）**并存**，worker.js glue 用后者名、主入口 `detectWasmUrl()` 用前者名，非"非此即彼"。详见 2.1 wasm 文件名说明。
  - **性能指标调整**：原 5万<500ms / 10万<1000ms 经实测结构性不可达（5万 Workbook 648ms、10万 stream 1548ms），放宽为 5万<700ms / 10万<2000ms，合并稳态/首次为单一首次口径。1万<200ms 保留（实测 109ms）。
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

modern-xlsx 的 `writeBlob(wb)` 同步执行 `wb.toJSON()` + WASM 序列化，**全程同步阻塞调用线程**。v1.9 实测：10 万行场景主线程开销独立进程首次 **17.5 秒**（塌方，见附录 A）、热状态 628ms——无论哪个都远超交互预算。`@marcusok/excel-exporter` 不暴露 `writeBlob`，也不在主线程调 `wb.toBuffer()`：① <5 万行（≤49,999）走 Workbook（浏览器 20,000–49,999 行在 Worker 内）；② ≥5 万行（50000 起）走 fast-xlsx（v2.5 起，浏览器在 Worker 内，不需要 WASM）。主线程 `toBuffer` 仅存在于 main 模式（浏览器 <20,000 行，数据量小可接受主线程阻塞；Node/SSR 无 Worker 可用也走此路径）。（v2.6 注：旧文按 `WORKER_THRESHOLD=500` 写作"<500 行"，已按现行阈值 20,000 修正。）
