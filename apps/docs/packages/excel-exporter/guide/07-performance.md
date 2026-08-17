# 性能参考

以下数字为本机实测（真实 Chrome，6 列混合类型数据），用来说明自动路由的取舍依据；Node 独立进程回归见 `src/__tests__/performance.test.ts`。

## 基准数据

| 数据量     | Workbook（main）  | Fast stream | auto 实际选择        |
| ---------- | ----------------- | ----------- | -------------------- |
| 10,000 行  | ~120ms            | —           | main + Workbook      |
| 50,000 行  | —                 | ~400ms      | Worker + Fast stream |
| 100,000 行 | 17.5s（历史基线） | ~780ms      | Worker + Fast stream |

<ClientOnly>
  <BenchmarkChart dir="excel-exporter" />
</ClientOnly>

## 结论

1. `Workbook.toBuffer()` 在 ~5.5 万行开始出现超线性断崖（10 万行 17.5s），而 Fast stream 约 0.8s，因此 `STREAM_THRESHOLD = 50_000`；
2. 浏览器 ≥ 20,000 行走 Worker 后，主线程只做一次结构化克隆（10 万行约 94ms），其余工作在 Worker 内完成；
3. Stream 路径的代价是样式/布局特性缺失（v1），所以小文件默认走带完整样式的 Workbook 路径。

## 优化建议

- 默认使用 `mode: "auto"`，不要手动指定 `main` 导出大文件；
- 需要样式的场景控制在 5 万行以内（< 50,000）；更大数据量接受样式降级，或拆成多个 Sheet；
- `number` 类型列**显式声明 `decimals`**，保证跨路径（Workbook/Stream/兜底）存储值一致；
- 服务端大批量导出放到异步任务中执行。
