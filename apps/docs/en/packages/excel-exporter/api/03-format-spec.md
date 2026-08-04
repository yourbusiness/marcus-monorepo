# API: FormatSpec

A structured, thread-safe value-formatting description. Worker/Stream paths only accept FormatSpec; the function form is main-path only.

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

Accepts `Date` / parseable string / timestamp. The Workbook path writes an Excel date serial and auto-injects `numFormat`; Stream/SheetJS paths output the pattern-formatted string.

### number

```ts
{ type: "number", decimals: 2, thousands: true }
```

`decimals` defaults to 0, `thousands` to false. **Always set `decimals` explicitly**: the Workbook path keeps full precision rendered via `numFormat`, while Stream/fallback paths bake decimals into the stored value — the two can differ otherwise.

### padding

```ts
{ type: "padding", fill: "0", length: 6, align: "left" }
```

Pads left (`padEnd`) or right (`padStart`) to a fixed length; good for IDs.

## Function form (main path)

```ts
format: (value, row) => string | number | boolean;
```

Can access the whole row for conditional formatting. Columns using function form restrict exports to the `main` path; convert to FormatSpec for worker/stream.
