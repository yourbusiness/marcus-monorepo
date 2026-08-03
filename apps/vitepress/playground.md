# 在线演示

下面的面板在浏览器里直接运行 `@marcusok/excel-exporter`：选择数据集、数据量与导出模式，点击导出即可得到真实 `.xlsx` 文件，同时展示进度、各阶段耗时与最终引擎信息。

<ClientOnly>
  <ExportDemo />
</ClientOnly>

## 演示要点

- **auto（推荐）**：按数据量自动选择 main / worker / stream 最优路径；
- **main**：主线程同步构建，10 万行时可以看到明显的性能断崖；
- **worker**：Web Worker 多线程，主线程只做一次结构化克隆；
- **stream**：流式写入，恒定内存，10 万行约 1.5s，但不支持样式与布局特性。

数据由文档站的确定性 mock 生成器产生（mulberry32 种子 PRNG），同一配置多次生成结果一致，方便复现。完整用法见 [excel-exporter 文档](/packages/excel-exporter/)。
