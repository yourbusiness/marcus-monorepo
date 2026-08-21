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

工作表名需满足 ECMA-376 约束：非空、不超过 31 字符、不含 `: \ / ? * [ ]`。违反时不会生成损坏文件，也不会以异常形式抛出——校验错误会被捕获并走兜底流程，兜底路径会再次校验同一表名，最终以 `{ success: false, error }` 返回（错误信息明确）。

## 冻结行

`freezeRows: 1` 冻结表头（映射到 `frozenPane`），浏览大表时表头始终可见。多级表头建议 `freezeRows >= 表头行数`，让所有表头行都保持可见。

## 多级表头

列用 `children` 组成树形结构，即可生成多行表头；分组表头格会自动合并（跨其全部叶子列），叶子列表头自动纵向跨满剩余表头行——无需手工计算合并范围。

```ts
await exportExcel({
  filename: "月度销售",
  sheets: [
    {
      name: "销售",
      freezeRows: 3,
      columns: [
        { key: "product", header: "产品" },
        {
          header: "收入情况",
          children: [
            {
              header: "本月",
              children: [
                { key: "m_qty", header: "数量" },
                { key: "m_amt", header: "金额" },
              ],
            },
            {
              header: "本年累计",
              children: [
                { key: "y_qty", header: "数量" },
                { key: "y_amt", header: "金额" },
              ],
            },
          ],
        },
      ],
      data: [{ product: "A", m_qty: 1, m_amt: 2, y_qty: 3, y_amt: 4 }],
    },
  ],
});
```

生成 3 行表头：

| 行  | A    | B                    | C    | D                    | E    |
| --- | ---- | -------------------- | ---- | -------------------- | ---- |
| 1   | 产品 | 收入情况（合并 B–E） |      |                      |      |
| 2   |      | 本月（合并 B–C）     |      | 本年累计（合并 D–E） |      |
| 3   |      | 数量                 | 金额 | 数量                 | 金额 |

规则：

- 叶子列（无 `children`）必须有 `key`；分组列可省略 `key`，只贡献表头；
- `width` / `style` / `format` 只对叶子列生效；
- 分组表头样式用该列的 `headerStyle`，叶子表头样式同理（未设置时回退到表级 `headerStyle`）；
- 任意路径（main / worker / stream / SheetJS 兜底）都支持多级表头，stream 与兜底路径同样保留合并（样式除外）。

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
    // 0 → 1；首尾 0 与 1 由 exportExcel 在所有路径（含 SheetJS 兜底）各上报一次；
    // 分段进度仅 stream 路径有（每 1000 行上报一次）
    bar.style.width = `${progress * 100}%`;
  },
  onPhase: (phase, durationMs) => {
    // phase: "init" | "build" | "download"，严格按序执行
    console.log(`${phase} took ${durationMs.toFixed(1)}ms`);
  },
});
```

各阶段语义：

| 阶段       | 说明                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`     | WASM 初始化；main 路径每次导出上报（已加载约 0ms）；Node 主线程的 stream 路径不加载 WASM，但会上报一次 0ms 以保持阶段序列一致；Worker + Workbook 仅 Worker 初始化时上报；Worker + stream 与 SheetJS 兜底不上报 |
| `build`    | 工作簿构建（按实际构建次数报告，含兜底重试——失败后走 SheetJS 兜底会再报告一次）                                                                                                                                |
| `download` | 浏览器触发下载（`download: false` 时不报告；Node 下无此阶段）                                                                                                                                                  |

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
