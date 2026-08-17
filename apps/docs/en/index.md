---
layout: home

hero:
  name: "MarcusOK"
  text: "Frontend libraries for admin products"
  tagline: Declarative, composable TypeScript libraries for admin products. The flagship package is an Excel export engine powered by modern-xlsx and a custom Fast stream writer.
  actions:
    - theme: brand
      text: Get Started
      link: /en/guide/01-getting-started
    - theme: alt
      text: Play
      link: /en/play
---

## Ecosystem Highlights

<PackageHighlights />

<StatsBlock />

## Packages

<PackageCards />

## Performance Snapshot

Fast stream completes a 100k-row export in ~0.8s, while the same engine's Workbook path slows sharply beyond ~55k rows (17.5s at 100k).

<ClientOnly>
  <BenchmarkChart />
</ClientOnly>
