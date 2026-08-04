# API：FormatSpec 值格式化

结构化、可跨线程的值格式化描述。Worker/Stream 路径只能使用 FormatSpec；函数形式仅在 main 路径可用。

## 类型定义

```ts
type FormatSpec =
  | { type: "enum"; map: Record<string, string>; fallback?: string }
  | { type: "date"; pattern?: string } // 默认 "yyyy-MM-dd"
  | { type: "datetime"; pattern?: string } // 默认 "yyyy-MM-dd HH:mm"
  | { type: "number"; decimals?: number; thousands?: boolean }
  | { type: "padding"; fill: string; length: number; align?: "left" | "right" };
```

## 各类型说明

### enum

```ts
{ type: "enum", map: { paid: "已支付", pending: "待支付" }, fallback: "未知" }
```

命中 `map` 输出映射值；未命中输出 `fallback`，无 fallback 时原样输出。

### date / datetime

```ts
{ type: "date" }                       // 默认 yyyy-MM-dd
{ type: "datetime", pattern: "yyyy-MM-dd HH:mm:ss" }
```

接受 `Date` / 可解析字符串 / 时间戳。Workbook 路径写入 Excel 日期序列并自动注入 `numFormat`；Stream/SheetJS 路径输出 pattern 格式化字符串。

### number

```ts
{ type: "number", decimals: 2, thousands: true }
```

`decimals` 默认 0，`thousands` 默认 false。**务必显式声明 `decimals`**：Workbook 路径保留完整精度经 `numFormat` 渲染，Stream/兜底路径将 `decimals` 烧入存储值，两种路径存储值可能不同。

### padding

```ts
{ type: "padding", fill: "0", length: 6, align: "left" }
```

左（`padEnd`）/ 右（`padStart`）补全到固定长度，适合工号、订单号等。

## 函数形式（main 路径）

```ts
format: (value, row) => string | number | boolean;
```

可以访问整行数据做条件格式化。使用函数列后，导出路径被限制为 `main`；如需 Worker/Stream，请改写为 FormatSpec。
