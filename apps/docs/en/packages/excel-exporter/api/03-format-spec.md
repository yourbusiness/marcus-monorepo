# API: FormatSpec

A structured, thread-safe value-formatting description. Prefer FormatSpec on worker/stream paths; the actual reach of the function form is covered in "Function form" at the end.

## Type definition

```ts
type FormatSpec =
  | { type: "enum"; map: Record<string, string>; fallback?: string }
  | { type: "date"; pattern?: string } // default "yyyy-MM-dd"
  | { type: "datetime"; pattern?: string } // default "yyyy-MM-dd HH:mm"
  | { type: "number"; decimals?: number; thousands?: boolean }
  | { type: "padding"; fill: string; length: number; align?: "left" | "right" };
```

## Per type

### enum

```ts
{ type: "enum", map: { paid: "Paid", pending: "Pending" }, fallback: "Unknown" }
```

Outputs the mapped label; unmapped values use `fallback`, or pass through when absent.

### date / datetime

```ts
{ type: "date" }                       // default yyyy-MM-dd
{ type: "datetime", pattern: "yyyy-MM-dd HH:mm:ss" }
```

Accepts `Date` / parseable string / timestamp. The Workbook path writes an Excel date serial and auto-injects `numFormat`; Stream/SheetJS paths output the pattern-formatted string. Values are interpreted by their **UTC components** (matching the workbook serial's `dateToSerial` convention, so all paths and timezones render the same); ISO date strings parse as UTC midnight per ECMA-262 — see the timezone note in [Value Formatting](/en/packages/excel-exporter/guide/04-formatting).

### number

```ts
{ type: "number", decimals: 2, thousands: true }
```

`decimals` defaults to 0, `thousands` to false. **Always set `decimals` explicitly**: the Workbook path keeps full precision rendered via `numFormat`, while Stream/fallback paths bake decimals into the stored value — the two can differ otherwise.

### padding

```ts
{ type: "padding", fill: "0", length: 6 } // "42" -> "000042"
```

Omitting `align` (the default) maps to `padStart`: the fill goes on the **left** (value right-aligned) — right for leading-zero IDs. `align: "left"` maps to `padEnd`: the fill goes on the **right** (value left-aligned).

## Function form

```ts
format: (value, row) => string | number | boolean;
```

Can access the whole row for conditional formatting. Functions cannot cross the structured-clone boundary, so behavior differs per path:

- **main path** (auto mode: browser < 20,000 rows / Node < 50,000 rows; or any size with explicit `mode: "main"`): executed normally;
- **Node's stream path** (≥ 50,000 rows): also main-thread, executed normally;
- **browser worker path** (auto ≥ 20,000 rows, or explicit `mode: "worker"` / `mode: "stream"`): functions are **stripped with a `console.warn`** and the column exports its raw value (no error, no fallback to main).

Convert to FormatSpec to keep formatting on the worker path.
