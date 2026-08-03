# 高级特性

## 多工作表

`sheets` 是数组，一次调用即可生成多页工作簿：

```ts
await exportExcel({
  filename: "department-report",
  sheets: [
    { name: "销售", columns: [...], data: salesData },
    { name: "人员", columns: [...], data: staffData },
  ],
});
```

工作表名需满足 ECMA-376 约束：非空、不超过 31 字符、不含 `: \ / ? * [ ]`。违反时导出会抛出明确错误，避免生成损坏文件。

## 冻结行

`freezeRows: 1` 冻结表头（映射到 `frozenPane`），浏览大表时表头始终可见。

## 合并单元格

```ts
{
  name: "库存汇总",
  columns: [...],
  data: [...],
  merges: [
    { row: 0, col: 0, rowspan: 1, colspan: 2 }, // 第一行数据跨两列
  ],
}
```

`MergeRange` 相对数据区定位：`row` / `col` 从 0 开始（`row 0` = 第一条数据行），`rowspan` / `colspan` 为跨度。

## 自动筛选

`autoFilter: true` 为表头范围添加筛选下拉。

## 进度与阶段回调

```ts
await exportExcel({
  ...,
  onProgress: (progress) => {
    // 0 → 1，worker/stream 路径有效（stream 每 1000 行上报一次）
    bar.style.width = `${progress * 100}%`;
  },
  onPhase: (phase, durationMs) => {
    // phase: "init" | "build" | "download"，严格按序执行
    console.log(`${phase} took ${durationMs.toFixed(1)}ms`);
  },
});
```

各阶段语义：

| 阶段       | 说明                                                          |
| ---------- | ------------------------------------------------------------- |
| `init`     | WASM 初始化（首次加载才测量）；SheetJS 兜底不报告             |
| `build`    | 工作簿构建（Workbook / Stream / SheetJS 兜底各报告一次）      |
| `download` | 浏览器触发下载（`download: false` 时不报告；Node 下无此阶段） |

> `onPhase` 只反映各阶段耗时，不影响 `ExportResult.duration`（始终测量完整导出）。

## 关闭自动下载

```ts
const result = await exportExcel({ ..., download: false });
// result.blob 可直接使用
```

## 导出结果

```ts
interface ExportResult {
  success: boolean;
  blob?: Blob;
  engine?: "modern-xlsx" | "sheetjs"; // 实际使用的引擎
  mode?: ExportMode; // 实际使用的模式
  duration?: number; // 完整导出耗时 ms
  rowCount?: number;
  error?: Error;
}
```

建议在失败分支展示 `result.error` 并提示用户重试；引擎为 `sheetjs` 时提示样式可能被剥离。
