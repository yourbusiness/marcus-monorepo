---
layout: home

hero:
  name: "MarcusOK"
  text: "后台业务前端公共库"
  tagline: 面向后台业务的声明式、可组合的 TypeScript 库集合。当前核心是 modern-xlsx 与自研 Fast stream 组成的 Excel 导出引擎。
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

Fast stream 在 10 万行数据下约 0.8s 完成导出，而同一引擎的 Workbook 整表序列化路径在约 5.5 万行后耗时陡增（10 万行 17.5s）。

<ClientOnly>
  <BenchmarkChart />
</ClientOnly>
