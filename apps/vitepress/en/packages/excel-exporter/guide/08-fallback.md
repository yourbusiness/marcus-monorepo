# Fallback (SheetJS)

The library guarantees "export always succeeds": when the WASM path is unavailable it automatically degrades to SheetJS.

## When it triggers

- The environment does not support `WebAssembly`;
- `modern-xlsx.wasm` fails to load (after `maxRetries` attempts, default 3);
- The Worker path fails to initialize (e.g. workerUrl 404);
- The build throws (e.g. invalid sheet name).

## Behavioral differences

| Dimension                        | modern-xlsx path | SheetJS fallback                                                                         |
| -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `ExportResult.engine`            | `"modern-xlsx"`  | `"sheetjs"`                                                                              |
| Cell styles                      | ✅ full          | ❌ stripped (SheetJS CE cannot write styles)                                             |
| Width / freeze / filter / merges | ✅               | ❌                                                                                       |
| FormatSpec                       | ✅               | ✅ (enum/padding/number/date semantics kept; dates become readable strings)              |
| Number formats                   | ✅ `numFormat`   | ❌ `decimals` baked into stored value                                                    |
| Warning                          | —                | console prints `[excel-exporter] Falling back to SheetJS (styles stripped). Reason: ...` |

## Where SheetJS comes from

1. The consumer-installed `xlsx` package (optional peerDependency, `>= 0.18.5`) is loaded first;
2. If missing, `xlsx.mjs` (0.20.3) is loaded dynamically from the official SheetJS CDN.

> For production, install and self-host `xlsx` instead of depending on a third-party CDN at runtime.

## Detecting the fallback

```ts
const result = await exportExcel(options);
if (result.engine === "sheetjs") {
  // warn the user: compatibility export, styles may be stripped
}
```

The fallback is a last-resort guarantee, not a regular path. When it fires, first check that the wasm URL is not 404 and that `configureWasm` was called before exporting.
