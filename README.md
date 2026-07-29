# marcus-monorepo

High-performance Excel export engine built on [modern-xlsx](https://github.com/ABCrimson/modern-xlsx) (Rust + WASM). pnpm + Turborepo monorepo.

## Packages

| Package                                                 | Description                                                |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| [`@marcusok/excel-exporter`](./packages/excel-exporter) | Core Excel export library (WASM-backed, styled, streaming) |

## Quick start

```bash
pnpm install
pnpm build
pnpm test
```

Requires Node >= 22. Note: modern-xlsx@1.2.0 declares `engines: node>=24`, but the package runtime target is the browser and all 24 tests pass on Node 22; the dependency is pinned to exactly `1.2.0` so a future minor with Node 24-only APIs cannot sneak in. Re-verify if you upgrade modern-xlsx.
