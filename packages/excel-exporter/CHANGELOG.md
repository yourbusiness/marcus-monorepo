# @marcusok/excel-exporter

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
