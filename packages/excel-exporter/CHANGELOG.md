# @marcusok/excel-exporter

## 1.1.0

### Minor Changes

- e92f6d6: feat: 支持多级表头与单元格合并

  - `ColumnConfig` 新增 `children`：列可组成树形结构，生成多行表头。分组表头格自动跨其全部叶子列合并，叶子表头格纵向跨满剩余表头行，无需手工计算合并范围。
  - 多级表头与合并（含表头合并）在 Workbook / Fast stream / SheetJS 兜底三条路径均可用；数据区 `merges` 的相对偏移随表头行数自适应，扁平列配置的输出与旧版逐字节一致。
  - `exportTable` 支持 Ant Design / Element Plus 的 `children` 分组列。

## 1.0.8

### Patch Changes

- 08239dd: 修复 onProgress 兜底契约与 sharedStrings `count` 规范偏差：

  - `onProgress` 的收尾 `1` 此前只在成功路径由 `exportExcel` 上报，三条 SheetJS 兜底路径（WASM 不支持早退、主线程构建失败降级、Worker 失败/抛错降级）均不上报，早退路径连起始 `0` 也不上报，与 `types.ts`「final 1 由 `exportExcel` 恰好上报一次」的契约不符。现 `exportExcel` 在入口统一上报 `0`，兜底调用统一经 `.finally` 收尾 `1`（兜底自身失败也收尾），任何路径下回调序列均为 `0 → … → 1` 各一次，进度 UI 可确定性关闭。
  - fast-xlsx 的 `xl/sharedStrings.xml` 原把 `count` 与 `uniqueCount` 同填去重数；按 ECMA-376，`count` 应为含重复的总字符串引用数。现按实际引用计数填写（Excel 等读取器原本也容忍该偏差，属规范正确性修正）。
  - 清理 `PERF_TIGHT` 残留：性能基准的 `SLACK` 恒等式（两分支同为 1.0）改为直赋 `1.0` 并修正注释；`turbo.json` `globalEnv` 移除无效的 `PERF_TIGHT` 声明。
  - 新增两个回归用例（兜底路径进度收尾、sst count/uniqueCount 规范），测试数 52 → 54（CI 跳过 4 个性能基准后实跑 50）。

## 1.0.7

### Patch Changes

- cd54ef1: README 修正函数形式 `format` 的适用范围表述：

  - 原「`main` 模式额外支持函数形式」与设计决策摘要「Worker/Stream 仅接受 `FormatSpec`」均不完整：Node 的 stream 路径在主线程执行，函数同样生效；会剥离函数的只有浏览器 Worker 路径（含 Worker 内执行的 stream）。
  - 同步修正文档站 FAQ 的日期条目（按 Workbook / stream·SheetJS 兜底路径分述默认文本形态）与基准图 caption（注明 6 列测量口径与在线演示 9 列数据集不可直接对照）。

## 1.0.6

### Patch Changes

- 8b28fab: 修改文档
- 8b28fab: 文档与包元数据措辞修正：

  - `package.json` description 移除 "High-performance" 营销化措辞，改为事实性描述（与 1.0.4 清理 README 同类措辞的决定对齐）。
  - README 修正测试数量为当前实际值（共 52 个用例，CI 跳过 4 个性能基准后实跑 48 个；此前写的 47/43 已漂移）。
  - README 环境要求澄清：`pnpm >= 9` 是本仓库的开发环境要求，不是消费方的安装要求。

## 1.0.5

### Patch Changes

- 480737b: 跨路径一致性修复：

  - `date` / `datetime` 统一按 **UTC 分量**解释：Stream/SheetJS 路径的 pattern 字符串此前取本地分量，与 Workbook 路径 `dateToSerial`（UTC 口径）相反，非 UTC 时区下同一输入在 5 万行阈值两侧（或降级前后）可能相差一天。现两条路径在任何时区输出一致；日期列建议传 ISO 字符串或用 `Date.UTC(...)` 构造（见文档「值格式化」的时区约定）。
  - WASM 加载失败（error 态）后，任意 `configureWasm()` 调用都会清除错误态并在下次导出时按新配置重试（此前仅 `wasmUrl` 变化才会重置，错误信息建议的重试方式实际不可行）。
  - stream 路径不再在内部重复上报最终进度 `1`，由 `exportExcel` 统一收尾（回调序列 0 → 分段 → 1 各一次）。
  - 新增 `wasm-loader.test.ts` 与日期跨路径一致性回归用例；`types.ts` 补日期输入契约与 `onProgress` 精确语义。

## 1.0.4

### Patch Changes

- 6046e9b: README（npm 页面）文案修正：

  - 移除「高性能」「降级保底」「保证数据可用」等无基准或绝对化的措辞，改用实测口径描述。
  - 性能测量口径说明更新为「6 列混合类型」，移除与当前 Play 演示（9 列）不符的「Play 同款 6 列」表述。

## 1.0.3

### Patch Changes

- c6e0964: README（npm 页面）更新：

  - 顶部新增在线文档链接：<https://yourbusiness.github.io/marcus-monorepo/packages/excel-exporter/>。
  - 修正 peerDependency 安装说明：npm 7+ / pnpm 8+ 起默认会自动安装 peerDependency（原「pnpm 默认不自动安装 peerDep」的说法已过时），显式安装的意义在于锁定版本意图。
  - 修复指向 `docs/excel-export-design.md` 的相对链接在 npm 页面失效的问题（改为 GitHub 绝对链接）。

## 1.0.2

### Patch Changes

- 12d47a4: Fix three robustness issues found in a code review:

  - **wasm-loader race**: calling `configureWasm()` with a new `wasmUrl` while a load was in flight left the loader marked ready with the _old_ URL's WASM (the superseded load clobbered the reset state). The in-flight promise is now captured locally so a superseded load can no longer mark the loader ready/error; the new URL takes effect on the next `ensureLoaded()`.
  - **broken worker reuse**: after a `Worker` `onerror` (e.g. failed script load), the errored instance stayed cached and every later export failed into the style-less SheetJS fallback. The errored worker is now terminated and dropped so the next export creates a fresh one; only requests dispatched to that instance are rejected.
  - **`download` phase in Node**: `onPhase("download", ...)` was reported in Node even though no download can happen there, contradicting the documented `ExportPhase` contract. The phase is now only reported when a browser `document` exists.
  - Stream mode now also warns when data-cell column `style`s are dropped (previously only `headerStyle`/`width`/layout features warned); the console message changed from `stream mode: layout features not supported (...)` to `stream mode: features not supported (...)`.

## 1.0.1

### Patch Changes

- 6194890: 大文件导出切换为自研 Fast stream（fflate minimal OOXML），修复浏览器 Worker 回调克隆失败导致降级 SheetJS 的问题，并将 10 万行导出耗时降至 1000ms 以内。

## 1.0.0

### Major Changes

- 4ad5ee1: update docs & finish beta

## 0.4.0

### Minor Changes

- 0c0fbd5: 性能优化

### Patch Changes

- 0c0fbd5: 大文件导出路径切换为 fflate-based fast-xlsx，10 万行 4 列首次导出从约 1.5s 降至约 600ms，恢复 5 万行 <500ms / 10 万行 <1000ms 硬性指标。

## 0.3.1

### Patch Changes

- fee37db: 添加下载模式

## 0.3.0

### Minor Changes

- bbb89a6: 添加在线文档

### Patch Changes

- ed3e961: Expose `./package.json` in the exports map so consumers (e.g. the docs site) can read the installed version at runtime.

## 0.2.0

### Minor Changes

- cb98c84: feat: `exportExcel` 新增 `onPhase` 阶段耗时回调（`init` / `build` / `download`），
  每个阶段完成时上报实际毫秒数，便于 play 指标面板展示下载链路的分阶段耗时。

### Patch Changes

- f182d80: fix some config error
- cb98c84: 添加了play

## 0.1.3

### Patch Changes

- c474368: 改了一下小配置

## 0.1.2

### Patch Changes

- 31b0cfe: 修复了部分代码问题

## 0.1.1

### Patch Changes

- cefad0e: 修改了一些配置文件
- cefad0e: Tighten package `exports`: add a `default` condition to each entry so resolvers/bundlers that do not understand the `import` condition can still resolve the ESM entry points (the package is ESM-only, `type: "module"`; this is not CommonJS/CJS support), expose `./dist/export.worker.js` as a resolvable subpath, declare `xlsx` as an optional peer dependency, and add `@vite-ignore` to the SheetJS dynamic import so builds do not fail when xlsx is not installed. Also fixed a typo in the WASM loader error message.
