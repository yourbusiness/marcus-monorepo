# marcus-monorepo

High-performance Excel export engine built on [modern-xlsx](https://github.com/ABCrimson/modern-xlsx) (Rust + WASM). pnpm + Turborepo monorepo.

## Packages

| Package | Description |
|---------|-------------|
| [`@marcus/excel-exporter`](./packages/excel-exporter) | Core Excel export library (WASM-backed, styled, streaming) |

## Quick start

```bash
pnpm install
pnpm build
pnpm test
```

Requires Node >= 22 (modern-xlsx@1.2.0 engines asks for >=24; the runtime target is the browser).
