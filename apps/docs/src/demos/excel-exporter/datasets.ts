import type { FormatSpec } from "@marcusok/excel-exporter";
import { createRng } from "../../utils/random";

export interface ExcelHint {
  kind: "style" | "format";
  preset?: "currency" | "date" | "datetime" | "percent" | "danger" | "header";
  spec?: FormatSpec;
}

export interface MockColumn {
  key: string;
  header: { zh: string; en: string };
  width?: number;
  hint?: ExcelHint;
}

export interface MockDataset {
  key: string;
  fileName: string;
  sheetName: { zh: string; en: string };
  columns: MockColumn[];
  rows(count: number, seed?: number): Record<string, unknown>[];
}

const SALES_STATUS: Record<string, string> = {
  paid: "已支付",
  pending: "待支付",
  refunded: "已退款",
};

const INVENTORY_STATUS: Record<string, string> = {
  "in-stock": "正常",
  low: "低库存",
  out: "缺货",
};

const STAFF_STATUS: Record<string, string> = {
  active: "在职",
  leave: "离职",
};

const REGIONS = ["华东", "华北", "华南", "西南", "东北"];
const PRODUCTS = [
  "机械键盘",
  "无线鼠标",
  "显示器支架",
  "降噪耳机",
  "USB-C 扩展坞",
  "人体工学椅",
  "4K 摄像头",
  "桌面氛围灯",
];
const CHANNELS = ["线上", "线下"];
const WAREHOUSES = ["上海仓", "北京仓", "广州仓", "成都仓"];
const CATEGORIES = ["外设", "影音", "配件", "家具"];
const DEPTS = ["研发部", "市场部", "销售部", "财务部", "人事部"];
const CITIES = ["上海", "北京", "深圳", "杭州", "成都"];
const POSITIONS = ["工程师", "产品经理", "设计师", "运营", "测试"];
const SURNAMES = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张";
const GIVEN = [
  "伟",
  "芳",
  "娜",
  "敏",
  "静",
  "磊",
  "军",
  "洋",
  "勇",
  "艳",
  "杰",
  "涛",
  "明",
  "超",
  "秀英",
  "霞",
  "平",
  "刚",
  "桂英",
];

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function randomName(rng: ReturnType<typeof createRng>): string {
  const s = rng.pick(SURNAMES.split(""));
  return `${s}${rng.pick(GIVEN)}`;
}

const sales: MockDataset = {
  key: "sales",
  fileName: "sales-report",
  sheetName: { zh: "销售明细", en: "Sales Detail" },
  columns: [
    { key: "orderId", header: { zh: "订单号", en: "Order ID" }, width: 18 },
    {
      key: "date",
      header: { zh: "日期", en: "Date" },
      width: 12,
      hint: { kind: "format", spec: { type: "date" } },
    },
    { key: "region", header: { zh: "区域", en: "Region" }, width: 10 },
    { key: "product", header: { zh: "商品", en: "Product" }, width: 18 },
    { key: "channel", header: { zh: "渠道", en: "Channel" }, width: 10 },
    { key: "quantity", header: { zh: "数量", en: "Qty" }, width: 8 },
    {
      key: "unitPrice",
      header: { zh: "单价", en: "Unit Price" },
      width: 12,
      hint: {
        kind: "format",
        spec: { type: "number", decimals: 2, thousands: true },
      },
    },
    {
      key: "amount",
      header: { zh: "金额", en: "Amount" },
      width: 14,
      hint: { kind: "style", preset: "currency" },
    },
    {
      key: "status",
      header: { zh: "状态", en: "Status" },
      width: 10,
      hint: {
        kind: "format",
        spec: { type: "enum", map: SALES_STATUS, fallback: "未知" },
      },
    },
  ],
  rows(count, seed = 42) {
    const rng = createRng(seed);
    const from = new Date("2026-07-01T00:00:00");
    const to = new Date("2026-07-31T23:59:59");
    return Array.from({ length: count }, (_, i) => {
      const unitPrice = rng.int(19, 1299) + rng.int(0, 99) / 100;
      const quantity = rng.int(1, 20);
      return {
        orderId: `ORD-${rng.padded(i + 1, 6)}`,
        date: formatDate(rng.date(from, to)),
        region: rng.pick(REGIONS),
        product: rng.pick(PRODUCTS),
        channel: rng.pick(CHANNELS),
        quantity,
        unitPrice: Number(unitPrice.toFixed(2)),
        amount: Number((unitPrice * quantity).toFixed(2)),
        status: rng.pick(["paid", "paid", "paid", "pending", "refunded"]),
      };
    });
  },
};

const inventory: MockDataset = {
  key: "inventory",
  fileName: "inventory-ledger",
  sheetName: { zh: "库存台账", en: "Inventory" },
  columns: [
    { key: "sku", header: { zh: "SKU", en: "SKU" }, width: 16 },
    { key: "name", header: { zh: "商品名称", en: "Product" }, width: 20 },
    { key: "category", header: { zh: "类目", en: "Category" }, width: 10 },
    { key: "warehouse", header: { zh: "仓库", en: "Warehouse" }, width: 12 },
    {
      key: "stock",
      header: { zh: "库存", en: "Stock" },
      width: 10,
      hint: { kind: "format", spec: { type: "number", thousands: true } },
    },
    {
      key: "safetyStock",
      header: { zh: "安全库存", en: "Safety Stock" },
      width: 12,
    },
    { key: "unit", header: { zh: "单位", en: "Unit" }, width: 8 },
    {
      key: "updatedAt",
      header: { zh: "更新时间", en: "Updated" },
      width: 12,
      hint: { kind: "format", spec: { type: "date" } },
    },
    {
      key: "status",
      header: { zh: "状态", en: "Status" },
      width: 10,
      hint: {
        kind: "format",
        spec: { type: "enum", map: INVENTORY_STATUS, fallback: "未知" },
      },
    },
  ],
  rows(count, seed = 7) {
    const rng = createRng(seed);
    const from = new Date("2026-07-01T00:00:00");
    const to = new Date("2026-07-31T23:59:59");
    return Array.from({ length: count }, (_, i) => {
      const stock = rng.int(0, 800);
      const safetyStock = rng.int(20, 100);
      return {
        sku: `SKU-${rng.padded(i + 1, 5)}`,
        name: rng.pick(PRODUCTS),
        category: rng.pick(CATEGORIES),
        warehouse: rng.pick(WAREHOUSES),
        stock,
        safetyStock,
        unit: "件",
        updatedAt: formatDate(rng.date(from, to)),
        status: stock === 0 ? "out" : stock < safetyStock ? "low" : "in-stock",
      };
    });
  },
};

const staff: MockDataset = {
  key: "staff",
  fileName: "staff-roster",
  sheetName: { zh: "人员花名册", en: "Staff Roster" },
  columns: [
    { key: "id", header: { zh: "工号", en: "ID" }, width: 10 },
    { key: "name", header: { zh: "姓名", en: "Name" }, width: 12 },
    { key: "dept", header: { zh: "部门", en: "Department" }, width: 12 },
    { key: "city", header: { zh: "城市", en: "City" }, width: 10 },
    { key: "position", header: { zh: "职位", en: "Position" }, width: 14 },
    {
      key: "salary",
      header: { zh: "月薪", en: "Monthly Salary" },
      width: 14,
      hint: { kind: "style", preset: "currency" },
    },
    {
      key: "hiredAt",
      header: { zh: "入职日期", en: "Hired" },
      width: 12,
      hint: { kind: "format", spec: { type: "date" } },
    },
    {
      key: "status",
      header: { zh: "状态", en: "Status" },
      width: 10,
      hint: {
        kind: "format",
        spec: { type: "enum", map: STAFF_STATUS, fallback: "未知" },
      },
    },
  ],
  rows(count, seed = 99) {
    const rng = createRng(seed);
    const from = new Date("2018-01-01T00:00:00");
    const to = new Date("2026-07-01T00:00:00");
    return Array.from({ length: count }, (_, i) => ({
      id: `E${rng.padded(i + 1001, 4)}`,
      name: randomName(rng),
      dept: rng.pick(DEPTS),
      city: rng.pick(CITIES),
      position: rng.pick(POSITIONS),
      salary: Number((rng.int(8, 60) * 1000 + rng.int(0, 999)).toFixed(2)),
      hiredAt: formatDate(rng.date(from, to)),
      status: rng.bool(0.85) ? "active" : "leave",
    }));
  },
};

export const mockDatasets: MockDataset[] = [sales, inventory, staff];

export function getDataset(key: string): MockDataset {
  const ds = mockDatasets.find((d) => d.key === key);
  if (!ds) throw new Error(`Unknown mock dataset: ${key}`);
  return ds;
}

/** Preview rows (first N) with a fixed seed, used by <MockPreview>. */
export function previewRows(
  key: string,
  count: number,
  seed: number,
): Record<string, unknown>[] {
  return getDataset(key).rows(count, seed);
}
