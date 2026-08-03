---
layout: home

hero:
  name: "MarcusOK"
  text: "High-performance frontend libraries"
  tagline: Declarative, high-performance, composable TypeScript libraries for admin products. The flagship package is a Rust + WASM powered Excel export engine.
  actions:
    - theme: brand
      text: Get Started
      link: /en/guide/01-getting-started
    - theme: alt
      text: Playground
      link: /en/playground
---

## Ecosystem Highlights

<PackageHighlights />

<StatsBlock />

## Packages

<PackageCards />

## Performance Snapshot

The Rust + WASM streaming writer keeps constant memory and ~1.5s latency at 100k rows, while the batch serialization path hits a performance cliff.

<ClientOnly>
  <BenchmarkChart />
</ClientOnly>
