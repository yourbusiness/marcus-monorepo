/**
 * Play mock 数据生成器。
 *
 * 用 mulberry32 这类确定性伪随机算法，保证同一个 seed 下同一档位生成的数据
 * 完全一致——重复导出、横向对比性能时才不会被数据随机性干扰。
 */

/** 数据档位：100 / 1k / 10k / 50k / 100k / 200k。 */
export const DATASET_PRESETS = [
  100, 1_000, 10_000, 50_000, 100_000, 200_000,
] as const;

/** 默认档位：10k（10,000 行）。 */
export const DEFAULT_ROWS = 10_000;

const CITIES = [
  "北京",
  "上海",
  "深圳",
  "广州",
  "杭州",
  "成都",
  "武汉",
  "南京",
] as const;
const STATUSES = ["待支付", "已支付", "已发货", "已完成", "已退款"] as const;

// 扩展 Record<string, unknown> 以满足 excel-exporter SheetConfig.data 的
// `Record<string, unknown>[]` 契约，同时保留字段的强类型。
export interface MockRow extends Record<string, unknown> {
  id: number;
  name: string;
  city: string;
  amount: number;
  orderDate: string;
  status: string;
}

/** mulberry32：小型、确定性、无状态的 32 位伪随机数生成器。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toIsoDate(year: number, month: number, day: number): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * 生成 rows 行 mock 数据。字段混入字符串、数字、日期与枚举类型，
 * 用于验证 excel-exporter 的 format / numFormat 能力。
 */
export function createDataset(rows: number, seed = 42): MockRow[] {
  const random = mulberry32(seed);
  const start = new Date(Date.UTC(2024, 0, 1));
  return Array.from({ length: rows }, (_, i) => {
    const offsetDays = Math.floor(random() * 365);
    const date = new Date(start.getTime() + offsetDays * 86_400_000);
    return {
      id: i + 1,
      name: `用户${String(i + 1).padStart(5, "0")}`,
      city: CITIES[Math.floor(random() * CITIES.length)]!,
      amount: Math.round(random() * 10_000 * 100) / 100,
      orderDate: toIsoDate(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
      ),
      status: STATUSES[Math.floor(random() * STATUSES.length)]!,
    };
  });
}
