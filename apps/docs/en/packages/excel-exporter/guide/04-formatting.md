# Value Formatting

Column `format` can be a structured **FormatSpec** (thread-safe; used by worker/stream paths) or a **function** (main path only — functions cannot cross the structured-clone boundary).

## FormatSpec

| Type       | Options                                 | Example                                                        | Description                                                                        |
| ---------- | --------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `enum`     | `map`, `fallback?`                      | `{ type: "enum", map: { paid: "Paid" }, fallback: "Unknown" }` | Maps raw values to labels; unmapped values use `fallback` or pass through          |
| `date`     | `pattern?` (default `yyyy-MM-dd`)       | `{ type: "date" }`                                             | Converts to an Excel date serial and auto-injects `numFormat`                      |
| `datetime` | `pattern?` (default `yyyy-MM-dd HH:mm`) | `{ type: "datetime" }`                                         | Same, with time                                                                    |
| `number`   | `decimals?` (default 0), `thousands?`   | `{ type: "number", decimals: 2, thousands: true }`             | Numeric semantics; the Workbook path keeps full precision rendered via `numFormat` |
| `padding`  | `fill`, `length`, `align?` (left/right) | `{ type: "padding", fill: "0", length: 6, align: "left" }`     | Pads to a fixed length (IDs, codes)                                                |

```ts
columns: [
  { key: "orderId", header: "Order ID", width: 12 },
  {
    key: "date",
    header: "Date",
    width: 12,
    format: { type: "date", pattern: "yyyy/MM/dd" },
  },
  {
    key: "amount",
    header: "Amount",
    width: 14,
    format: { type: "number", decimals: 2, thousands: true },
  },
  {
    key: "status",
    header: "Status",
    width: 10,
    format: { type: "enum", map: { paid: "Paid" }, fallback: "Unknown" },
  },
  {
    key: "code",
    header: "Code",
    width: 12,
    format: { type: "padding", fill: "0", length: 6, align: "right" },
  },
];
```

## Function form (main path only)

```ts
{
  key: "amount",
  header: "Amount",
  width: 14,
  format: (value, row) => {
    const n = Number(value);
    return n >= 1000 ? `Large ${n.toFixed(2)}` : n.toFixed(2);
  },
}
```

Signature: `(value: unknown, row: Record<string, unknown>) => string | number | boolean`. Columns using function form limit the export to the `main` path (browser < 20,000 rows / Node); convert to FormatSpec for worker/stream.

## Cross-path precision notes

Behavior differs slightly between paths — always set `decimals` explicitly:

- **Workbook path** (main / worker+workbook): full precision is preserved; display decimals come from the auto-injected `numFormat`;
- **Stream path** (≥ 50,000 rows): no `numFormat` support; `decimals` are baked into the stored value (`9999.99` → `10000`);
- So **without explicit `decimals` (default 0), the stored cell value can differ between paths** — explicit `decimals` is the main way to guarantee cross-threshold consistency.

## Dates

`date` / `datetime` accept `Date` objects, parseable strings or timestamps. The Workbook path writes a serial + `numFormat`; Stream / SheetJS paths (no `numFormat` support) emit readable strings per the pattern (`mm` resolves to minutes vs month by its context).
