# Performance

Numbers below come from independent-process benchmarks in the package design doc (Node v22.22.2, modern-xlsx@1.2.0, 6 mixed-type columns). They explain the auto-routing trade-offs.

## Benchmarks

| Rows    | Workbook (main) | Stream      | What `auto` picks |
| ------- | --------------- | ----------- | ----------------- |
| 10,000  | 109ms           | 184ms       | Worker + Workbook |
| 50,000  | 618ms           | 824ms       | Worker + Stream   |
| 100,000 | **17,541ms**    | **1,548ms** | Worker + Stream   |

<ClientOnly>
  <BenchmarkChart dir="excel-exporter" />
</ClientOnly>

## Takeaways

1. `Workbook.toBuffer()` shows a superlinear cliff beyond ~55k rows (17.5s at 100k), while `StreamingXlsxWriter` stays at ~1.5s — hence `STREAM_THRESHOLD = 50_000`;
2. In the browser, ≥ 500 rows run in a Worker; the main thread only does one structured clone (~94ms at 100k rows);
3. Stream's cost is missing styles/layout (v1), so small files keep the fully-styled Workbook path.

## Optimization tips

- Stay on `mode: "auto"`; never force `main` for large files;
- Keep styled exports ≤ 50k rows; for larger data accept degraded styling or split sheets;
- **Set `decimals` explicitly** on `number` columns for consistent stored values across paths (Workbook/Stream/fallback);
- Run large server-side exports in background tasks.
