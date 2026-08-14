# Play

The panel below runs `@marcusok/excel-exporter` directly in your browser: pick a dataset, row count and export mode, click export to get a real `.xlsx` file, and watch progress, phase timings and the actual engine used.

<ClientOnly>
  <PackageDemo dir="excel-exporter" />
</ClientOnly>

## What to try

- **auto (recommended)**: picks the optimal main / worker / stream path by row count;
- **main**: synchronous main-thread build — notice the cliff at 100k rows;
- **worker**: Web Worker threading; the main thread only does one structured clone;
- **stream**: Fast stream, ~0.8s at 100k rows, but no styles or layout features.

Data comes from the docs site's deterministic mock generator (mulberry32 seeded PRNG), so repeated runs with the same settings produce identical output. Full usage docs: [excel-exporter](/en/packages/excel-exporter/).
