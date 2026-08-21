# Fallback (SheetJS)

When the WASM path is unavailable, the library automatically degrades to SheetJS, so most failures still produce a file (one exception is listed under "When it triggers").

## When it triggers

- The environment does not support `WebAssembly` (this only affects the main and Worker + Workbook paths; the ≥ 50,000-row stream path does not use WASM and is unaffected);
- `modern-xlsx.wasm` fails to load (after `maxRetries` attempts, default 3);
- The Worker path fails to initialize (e.g. workerUrl 404);
- The build throws (e.g. an internal modern-xlsx build error). Note: an invalid sheet name is not rescuable here — the fallback re-validates the same name and fails, so the export resolves with `success: false`.

## Behavioral differences

| Dimension                  | modern-xlsx path | SheetJS fallback                                                                         |
| -------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `ExportResult.engine`      | `"modern-xlsx"`  | `"sheetjs"`                                                                              |
| Cell styles                | full             | stripped (SheetJS CE cannot write styles)                                                |
| Multi-row headers / merges | supported        | supported (merges are structure, not styles)                                             |
| Width / freeze / filter    | supported        | not supported                                                                            |
| FormatSpec                 | supported        | supported (enum/padding/number/date semantics kept; dates become readable strings)       |
| Number formats             | `numFormat`      | `decimals` baked into stored value                                                       |
| Warning                    | —                | console prints `[excel-exporter] Falling back to SheetJS (styles stripped). Reason: ...` |

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

The fallback is an insurance path for failures, not a regular one. When it fires, first check that the wasm URL is not 404 and that `configureWasm` was called before exporting.
