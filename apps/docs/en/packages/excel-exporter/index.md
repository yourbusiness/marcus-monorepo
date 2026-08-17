# @marcusok/excel-exporter

An Excel export engine built on [modern-xlsx](https://github.com/ABCrimson/modern-xlsx) (WASM) plus a custom Fast stream writer: declarative API, auto mode routing, full cell styling, Web Worker threading, fast large-file writes and a SheetJS fallback.

## Capabilities

| Capability                 | Description                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Declarative API            | Describe exports with `sheets + columns + data`; no cell-level coding                                               |
| Auto mode routing          | `auto` picks main / worker / Fast stream by row count (20,000 / 50,000 thresholds)                                  |
| Full cell styling          | Font, fill, alignment, borders, number formats; 7 built-in `StylePresets`                                           |
| Value formatting           | Structured `FormatSpec` (enum / date / datetime / number / padding)                                                 |
| Worker threading           | Main thread only does one structured clone; building runs in a Worker (the ≥ 50k-row stream path does not use WASM) |
| Streaming writes           | Custom `fast-xlsx.ts` + `fflate`, ~0.8s at 100k rows                                                                |
| Layered fallback           | Auto-degrades to SheetJS (styles stripped) when WASM is unavailable                                                 |
| Progress / phase callbacks | `onProgress`, `onPhase` for visualizations and telemetry                                                            |

## Install

```bash
pnpm add @marcusok/excel-exporter modern-xlsx
```

Browser consumers must also deploy `modern-xlsx.wasm` and `export.worker.js` and call `configureWasm` — see [Getting Started](/en/guide/01-getting-started).

## Quick example

```ts
import { exportExcel, StylePresets } from "@marcusok/excel-exporter";

await exportExcel({
  filename: "sales-report",
  sheets: [
    {
      name: "Sales",
      freezeRows: 1,
      autoFilter: true,
      columns: [
        { key: "orderId", header: "Order ID", width: 18 },
        {
          key: "amount",
          header: "Amount",
          width: 14,
          style: StylePresets.currency,
        },
      ],
      data: [{ orderId: "ORD-001", amount: 9999.99 }],
    },
  ],
});
```

## Documentation map

- **Guide**: installation, auto mode, styles, formatting, advanced features, worker/streaming, fallback, Node/SSR, performance
- **Examples**: sales report, inventory, large files, multi-sheet workbooks (with mock previews)
- **API reference**: entry point, types, style presets, FormatSpec

## Version & dependencies

- Version: read from npm registry (the home card reads the workspace `package.json` automatically)
- peerDependencies: `modern-xlsx@^1.2.0` (required), `xlsx@>=0.18.5` (optional, fallback)
- Environment: Node >= 22; browsers need WebAssembly support

> Performance numbers are local measurements (real Chrome, 6 mixed-type columns). See [Performance](/en/packages/excel-exporter/guide/07-performance).
