# Performance

Numbers below come from local measurements (real Chrome, 6 mixed-type columns); Node independent-process regression lives in `src/__tests__/performance.test.ts`.

## Benchmarks

| Rows    | Workbook (main) | Fast stream | What `auto` picks    |
| ------- | --------------- | ----------- | -------------------- |
| 10,000  | ~120ms          | —           | main + Workbook      |
| 50,000  | —               | ~400ms      | Worker + Fast stream |
| 100,000 | 17.5s (legacy)  | ~780ms      | Worker + Fast stream |

<ClientOnly>
  <BenchmarkChart dir="excel-exporter" />
</ClientOnly>

## Takeaways

1. `Workbook.toBuffer()` shows a superlinear cliff beyond ~55k rows (17.5s at 100k), while Fast stream stays at ~0.8s — hence `STREAM_THRESHOLD = 50_000`;
2. In the browser, ≥ 20,000 rows run in a Worker; the main thread only does one structured clone (~94ms at 100k rows);
3. Stream's cost is missing styles/layout (v1), so small files keep the fully-styled Workbook path.

## Optimization tips

- Stay on `mode: "auto"`; never force `main` for large files;
- Keep styled exports under 50k rows; for larger data accept degraded styling or split sheets;
- **Set `decimals` explicitly** on `number` columns for consistent stored values across paths (Workbook/Stream/fallback);
- Run large server-side exports in background tasks.
