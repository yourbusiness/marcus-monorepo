import { describe, it, expect } from "vitest";
import { flattenColumnTree, a1Range } from "../column-tree";
import type { ColumnConfig } from "../types";

/** 3-level grouped header: 产品(leaf) | 收入情况(本月/本年累计). */
const groupedColumns: ColumnConfig[] = [
  { key: "product", header: "产品" },
  {
    header: "收入情况",
    children: [
      {
        header: "本月",
        children: [
          { key: "m_qty", header: "数量" },
          { key: "m_amt", header: "金额" },
        ],
      },
      {
        header: "本年累计",
        children: [
          { key: "y_qty", header: "数量" },
          { key: "y_amt", header: "金额" },
        ],
      },
    ],
  },
];

describe("flattenColumnTree", () => {
  it("keeps flat columns byte-compatible: H=1, no header merges, same leaf order", () => {
    const flat = flattenColumnTree([
      { key: "a", header: "A" },
      { key: "b", header: "B" },
    ]);
    expect(flat.headerRowCount).toBe(1);
    expect(flat.leaves.map((l) => l.key)).toEqual(["a", "b"]);
    expect(flat.headerGrid).toEqual([["A", "B"]]);
    // Single-cell spans must not produce merges, so flat output is unchanged.
    expect(flat.headerMerges).toHaveLength(0);
    expect(flat.headerCells).toHaveLength(2);
  });

  it("flattens a 3-level grouped header into leaves + merges", () => {
    const t = flattenColumnTree(groupedColumns);
    expect(t.headerRowCount).toBe(3);
    expect(t.leaves.map((l) => l.key)).toEqual([
      "product",
      "m_qty",
      "m_amt",
      "y_qty",
      "y_amt",
    ]);

    // 产品 spans the 3 header rows in column 0.
    expect(t.headerGrid[0][0]).toBe("产品");
    expect(t.headerGrid[1][0]).toBeNull();
    expect(t.headerGrid[2][0]).toBeNull();
    // Group headers at their own depth.
    expect(t.headerGrid[0][1]).toBe("收入情况");
    expect(t.headerGrid[1][1]).toBe("本月");
    expect(t.headerGrid[1][3]).toBe("本年累计");
    // Leaf headers on the bottom row.
    expect(t.headerGrid[2][1]).toBe("数量");
    expect(t.headerGrid[2][2]).toBe("金额");
    expect(t.headerGrid[2][3]).toBe("数量");
    expect(t.headerGrid[2][4]).toBe("金额");

    const merges = t.headerMerges.map((m) =>
      a1Range(m.row, m.col, m.rowSpan, m.colSpan),
    );
    expect(merges).toEqual(["A1:A3", "B1:E1", "B2:C2", "D2:E2"]);
  });

  it("handles mixed depth: a depth-0 leaf next to a 1-level group", () => {
    const t = flattenColumnTree([
      { key: "a", header: "A" },
      {
        header: "G",
        children: [
          { key: "b", header: "B" },
          { key: "c", header: "C" },
        ],
      },
    ]);
    expect(t.headerRowCount).toBe(2);
    // Leaf A spans both header rows.
    expect(
      t.headerMerges.map((m) => a1Range(m.row, m.col, m.rowSpan, m.colSpan)),
    ).toEqual(["A1:A2", "B1:C1"]);
    expect(t.headerGrid).toEqual([
      ["A", "G", null],
      [null, "B", "C"],
    ]);
    expect(t.leaves.map((l) => l.key)).toEqual(["a", "b", "c"]);
  });

  it("treats children: [] as a leaf", () => {
    const t = flattenColumnTree([{ key: "a", header: "A", children: [] }]);
    expect(t.headerRowCount).toBe(1);
    expect(t.leaves.map((l) => l.key)).toEqual(["a"]);
  });

  it("throws when a leaf column has no usable key", () => {
    expect(() => flattenColumnTree([{ header: "no key" }])).toThrow(
      /must have a non-empty string key/,
    );
  });

  it("throws on circular children references instead of overflowing", () => {
    const a: ColumnConfig = { header: "A", children: [] };
    const b: ColumnConfig = { header: "B", children: [a] };
    a.children!.push(b);
    expect(() => flattenColumnTree([a])).toThrow(/circular children/);
  });

  it("a1Range renders 0-based ranges as A1 refs", () => {
    expect(a1Range(0, 0, 1, 1)).toBe("A1:A1");
    expect(a1Range(0, 0, 3, 1)).toBe("A1:A3");
    expect(a1Range(2, 1, 1, 4)).toBe("B3:E3");
    expect(a1Range(1, 26, 1, 2)).toBe("AA2:AB2");
  });
});
