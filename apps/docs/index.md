---
layout: home

hero:
  name: "MarcusOK"
  text: "高性能前端库集合"
  tagline: 面向后台业务的声明式、高性能、可组合的 TypeScript 库。当前核心是 Rust + WASM 驱动的 Excel 导出引擎。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/01-getting-started
    - theme: alt
      text: 在线演示
      link: /play
---

## 生态亮点

<PackageHighlights />

<StatsBlock />

## 包生态

<PackageCards />

## 性能参考

基于 Rust + WASM 的流式写入在 10 万行数据下保持恒定内存与 ~1.5s 耗时，而传统的整表序列化路径会出现性能断崖。

<ClientOnly>
  <BenchmarkChart />
</ClientOnly>
