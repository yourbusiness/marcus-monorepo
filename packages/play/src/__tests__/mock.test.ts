import { describe, expect, it } from "vitest";
import { createDataset, DATASET_PRESETS, DEFAULT_ROWS } from "../mock/rows";

describe("mock dataset generator", () => {
  it("presets cover the required buckets and default to 10k", () => {
    expect([...DATASET_PRESETS]).toEqual([
      100, 1_000, 10_000, 50_000, 100_000, 200_000,
    ]);
    expect(DEFAULT_ROWS).toBe(10_000);
  });

  it("generates the requested number of rows", () => {
    expect(createDataset(100)).toHaveLength(100);
    expect(createDataset(1_000)).toHaveLength(1_000);
    expect(createDataset(200_000)).toHaveLength(200_000);
  });

  it("is deterministic for the same seed", () => {
    expect(createDataset(10, 42)).toEqual(createDataset(10, 42));
  });

  it("differs across seeds", () => {
    expect(createDataset(10, 1)).not.toEqual(createDataset(10, 2));
  });

  it("keeps field values within expected ranges", () => {
    const [row] = createDataset(1, 7);
    expect(row!.id).toBe(1);
    expect(row!.name).toMatch(/^用户\d{5}$/);
    expect(row!.amount).toBeGreaterThanOrEqual(0);
    expect(row!.amount).toBeLessThanOrEqual(10_000);
    expect(row!.orderDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(["待支付", "已支付", "已发货", "已完成", "已退款"]).toContain(
      row!.status,
    );
  });
});
