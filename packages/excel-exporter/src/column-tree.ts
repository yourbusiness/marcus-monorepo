import type { ColumnConfig } from "./types";

/**
 * Multi-row header flattening, shared by the Workbook, stream and SheetJS
 * fallback paths (and, via bundling, the worker).
 *
 * A column tree (`ColumnConfig.children`) is flattened into:
 * - `leaves`: the ordered data columns (only these produce data cells),
 * - `headerRowCount` (H): the header depth = 1 + max leaf depth (1 for flat),
 * - `headerGrid`: an H x leaves grid of header texts (null where a merge
 *   covers the cell), fed straight into the aoa/XML/SheetJS writers,
 * - `headerCells`: every header cell's top-left + its owning column, used for
 *   header styling,
 * - `headerMerges`: the subset of `headerCells` that actually spans more than
 *   one cell (single-cell spans are not merged, so flat output stays
 *   byte-identical to the pre-tree exporter).
 */

export interface HeaderCell {
  /** 0-based sheet row (0 = Excel row 1). */
  row: number;
  /** 0-based column. */
  col: number;
  rowSpan: number;
  colSpan: number;
  /** The column owning this header cell (its `header`/`headerStyle`). */
  column: ColumnConfig;
}

export interface FlattenedColumnTree {
  /** Data columns, in leaf order. Guaranteed to have a `key`. */
  leaves: ColumnConfig[];
  headerRowCount: number;
  headerGrid: (string | null)[][];
  headerCells: HeaderCell[];
  headerMerges: HeaderCell[];
}

/**
 * Flatten a (possibly nested) column list into its leaf columns and multi-row
 * header layout. Standard grouped-header semantics:
 *
 * - a leaf column emits one data column and a header cell at its depth with
 *   `rowSpan = H - depth` (it spans the remaining header rows below),
 * - a group column emits no data column and a header cell at its depth with
 *   `colSpan = leafCount(subtree)`.
 *
 * Throws when a leaf column lacks a string `key`, or when `children` contain a
 * reference cycle (would otherwise overflow the stack in the DFS).
 */
export function flattenColumnTree(
  columns: ColumnConfig[],
): FlattenedColumnTree {
  assertAcyclic(columns);

  // Depth of every node; H = 1 + max depth over all nodes.
  const depthOf = new Map<ColumnConfig, number>();
  (function computeDepth(cols: ColumnConfig[], depth: number) {
    for (const c of cols) {
      depthOf.set(c, depth);
      if (c.children?.length) computeDepth(c.children, depth + 1);
    }
  })(columns, 0);
  let maxDepth = 0;
  depthOf.forEach((d) => {
    if (d > maxDepth) maxDepth = d;
  });
  const headerRowCount = maxDepth + 1;

  // Leaf count per node, memoized (post-order) so each subtree is counted once.
  const leafCountOf = new Map<ColumnConfig, number>();
  function countLeaves(col: ColumnConfig): number {
    const cached = leafCountOf.get(col);
    if (cached !== undefined) return cached;
    let n = 0;
    if (col.children?.length) {
      for (const ch of col.children) n += countLeaves(ch);
    } else {
      n = 1;
    }
    leafCountOf.set(col, n);
    return n;
  }

  const leaves: ColumnConfig[] = [];
  const headerCells: HeaderCell[] = [];
  const headerMerges: HeaderCell[] = [];
  let leafIndex = 0;

  (function walk(cols: ColumnConfig[]) {
    for (const c of cols) {
      const depth = depthOf.get(c)!;
      if (c.children?.length) {
        const colSpan = countLeaves(c);
        pushHeaderCell(depth, leafIndex, 1, colSpan, c);
        walk(c.children);
      } else {
        if (typeof c.key !== "string" || c.key.length === 0) {
          throw new Error(
            `[excel-exporter] leaf column "${c.header}" must have a non-empty string key`,
          );
        }
        pushHeaderCell(depth, leafIndex, headerRowCount - depth, 1, c);
        leaves.push(c);
        leafIndex++;
      }
    }
  })(columns);

  const headerGrid: (string | null)[][] = Array.from(
    { length: headerRowCount },
    () => Array<null>(leaves.length).fill(null),
  );
  for (const cell of headerCells)
    headerGrid[cell.row][cell.col] = cell.column.header;

  return { leaves, headerRowCount, headerGrid, headerCells, headerMerges };

  function pushHeaderCell(
    row: number,
    col: number,
    rowSpan: number,
    colSpan: number,
    column: ColumnConfig,
  ): void {
    const cell: HeaderCell = { row, col, rowSpan, colSpan, column };
    headerCells.push(cell);
    // Single-cell spans need no <mergeCell>; skipping keeps flat (H=1) output
    // identical to the pre-tree exporter.
    if (rowSpan > 1 || colSpan > 1) headerMerges.push(cell);
  }
}

/**
 * Render a 0-based sheet-relative range as an A1 ref (e.g. row 0/col 0 with
 * rowSpan 2/colSpan 1 -> "A1:A2"). Dependency-free so the stream writer can
 * use it without importing modern-xlsx.
 */
export function a1Range(
  row: number,
  col: number,
  rowSpan: number,
  colSpan: number,
): string {
  return `${columnName(col)}${row + 1}:${columnName(col + colSpan - 1)}${
    row + rowSpan
  }`;
}

function columnName(index: number): string {
  let n = index;
  let name = "";
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

function assertAcyclic(columns: ColumnConfig[]): void {
  const visiting = new Set<ColumnConfig>();
  const visit = (col: ColumnConfig): void => {
    if (visiting.has(col)) {
      throw new Error(
        "[excel-exporter] circular children reference in column tree",
      );
    }
    visiting.add(col);
    col.children?.forEach(visit);
    visiting.delete(col);
  };
  columns.forEach(visit);
}
