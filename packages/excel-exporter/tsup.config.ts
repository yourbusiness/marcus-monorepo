import { defineConfig } from 'tsup';

// Two configs:
//  - Main entrypoints are external on modern-xlsx (consumer bundler resolves the peerDep).
//  - Worker entrypoint bundles modern-xlsx IN: browser module workers cannot resolve
//    bare specifiers like 'modern-xlsx' (WHATWG: import maps do not apply to WorkerGlobalScope),
//    so the worker script must be self-contained.
export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'style-presets': 'src/style-presets.ts',
      'worker-utils': 'src/worker-exporter.ts',
    },
    format: ['esm'],
    dts: true,
    splitting: true,
    treeshake: true,
    clean: true,
    sourcemap: true,
    target: 'es2022',
    external: ['modern-xlsx', 'xlsx'],
  },
  {
    entry: { 'export.worker': 'src/workers/export.worker.ts' },
    format: ['esm'],
    dts: false,
    treeshake: true,
    sourcemap: true,
    target: 'es2022',
    // Force modern-xlsx to be bundled into the worker (not left external).
    // xlsx is only used in the main-thread fallback path, never in the worker.
    noExternal: ['modern-xlsx'],
    external: ['xlsx'],
    clean: false,
  },
]);
