# @marcusok/excel-exporter

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
