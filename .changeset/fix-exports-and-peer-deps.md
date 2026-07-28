---
"@marcus/excel-exporter": patch
---

Tighten package `exports`: add a `default` condition to each entry so resolvers/bundlers that do not understand the `import` condition can still resolve the ESM entry points (the package is ESM-only, `type: "module"`; this is not CommonJS/CJS support), expose `./dist/export.worker.js` as a resolvable subpath, declare `xlsx` as an optional peer dependency, and add `@vite-ignore` to the SheetJS dynamic import so builds do not fail when xlsx is not installed. Also fixed a typo in the WASM loader error message.
