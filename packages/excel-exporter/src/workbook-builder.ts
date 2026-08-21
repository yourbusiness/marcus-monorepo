import {
  Workbook,
  sheetAddAoa,
  encodeCellRef,
  type Worksheet,
} from "modern-xlsx";
import type { SheetConfig, ColumnConfig } from "./types";
import { buildStyleIndex } from "./style-utils";
import { flattenColumnTree, type HeaderCell } from "./column-tree";
import { getWasmLoader } from "./wasm-loader";
import {
  resolveCellFormat,
  numFormatForSpec,
  validateSheetName,
} from "./format-utils";
import { toBlobPart } from "./download";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Workbook builder -- batch write path. All data goes through `sheetAddAoa`
 * (array of arrays). For <=50k rows this is the fast, fully-styled path;
 * `Workbook.toBuffer()` is well-behaved here (verified: 50k rows ~700-830ms).
 */
export class WorkbookBuilder {
  private wb: Workbook;

  private constructor() {
    this.wb = new Workbook();
  }

  static async create(): Promise<WorkbookBuilder> {
    await getWasmLoader().ensureLoaded();
    return new WorkbookBuilder();
  }

  addSheet(config: SheetConfig): this {
    const { leaves, headerGrid, headerCells, headerMerges, headerRowCount } =
      flattenColumnTree(config.columns);

    // Auto-inject an Excel numFormat for typed FormatSpecs (date/datetime/number)
    // so the cell renders correctly without forcing the caller to also set
    // style.numFormat (otherwise dates show as raw serials, numbers as text).
    const columns = leaves.map(withAutoNumFormat);
    const rows = config.data.map((item) =>
      columns.map((col) => resolveCellFormat(col, item)),
    );
    const aoa = [...headerGrid, ...rows];

    validateSheetName(config.name);
    const ws = this.wb.addSheet(config.name);
    sheetAddAoa(ws, aoa, { origin: "A1" });

    return this.applyLayout(
      ws,
      config,
      columns,
      headerCells,
      headerMerges,
      headerRowCount,
      rows.length,
    );
  }

  private applyLayout(
    ws: Worksheet,
    config: SheetConfig,
    columns: ColumnConfig[], // flattened leaf columns (numFormat-injected)
    headerCells: HeaderCell[], // every header cell, for header styling
    headerMerges: HeaderCell[], // span > 1 header cells, for <mergeCell>
    headerRowCount: number,
    dataRowCount: number,
  ): this {
    // Column widths (1-based) -- leaf columns only.
    columns.forEach((c, i) => {
      if (c.width !== undefined) ws.setColumnWidth(i + 1, c.width);
    });

    // Header styles. Column-level headerStyle wins over the sheet-level default.
    // The top-left cell of every header cell carries the style; merged group
    // headers inherit it across the merged region (OOXML styles the anchor cell).
    // Note: `ws.rows[r].cells[c]` cannot be used here -- modern-xlsx packs a
    // row's cells densely, so a header row with merge-covered gaps (multi-row
    // headers) misaligns `cells[c]` from absolute column c. Resolve by ref.
    headerCells.forEach((cell) => {
      const headerStyle = cell.column.headerStyle ?? config.headerStyle;
      if (headerStyle) {
        const idx = buildStyleIndex(this.wb, headerStyle);
        const target = ws.cell(encodeCellRef(cell.row, cell.col));
        if (target) target.styleIndex = idx;
      }
    });

    // Column styles: apply to data cells only, matching the `style: not the
    // header` contract in types.ts. Header styling is handled separately above
    // via headerStyle. Data rows start at sheet row headerRowCount (0-based), so
    // slice(headerRowCount) iterates only data rows; mutating styleIndex is a
    // plain JS property write, bypassing ws.cell(ref) ref-parsing overhead.
    columns.forEach((c, i) => {
      if (c.style) {
        const idx = buildStyleIndex(this.wb, c.style);
        for (const row of ws.rows.slice(headerRowCount)) {
          const cell = row.cells[i];
          if (cell) cell.styleIndex = idx;
        }
      }
    });

    // Freeze header rows
    if (config.freezeRows && config.freezeRows > 0) {
      ws.frozenPane = { rows: config.freezeRows, cols: 0 };
    }

    // Auto-filter over the last header row .. last data row
    if (config.autoFilter) {
      const lastCol = encodeCellRef(0, columns.length - 1).match(/[A-Z]+/)![0];
      ws.autoFilter = `A${headerRowCount}:${lastCol}${headerRowCount + dataRowCount}`;
    }

    // Header merges: rows are already sheet-relative (0-based).
    headerMerges.forEach((m) => {
      const start = encodeCellRef(m.row, m.col);
      const end = encodeCellRef(m.row + m.rowSpan - 1, m.col + m.colSpan - 1);
      ws.addMergeCell(`${start}:${end}`);
    });

    // Data merges: MergeRange is data-relative (row 0 = first data row); add
    // headerRowCount to reach the sheet.
    config.merges?.forEach((m) => {
      const start = encodeCellRef(headerRowCount + m.row, m.col);
      const end = encodeCellRef(
        headerRowCount + m.row + m.rowspan - 1,
        m.col + m.colspan - 1,
      );
      ws.addMergeCell(`${start}:${end}`);
    });

    return this;
  }

  /** Serialize to Uint8Array (async, avoids sync writeBlob blocking main thread). */
  async toBuffer(): Promise<Uint8Array> {
    return this.wb.toBuffer();
  }

  /** Convenience: serialize and wrap in a Blob. */
  async toBlob(): Promise<Blob> {
    const bytes = await this.toBuffer();
    return new Blob([toBlobPart(bytes)], { type: XLSX_MIME });
  }
}

/**
 * If a column has a typed FormatSpec (date/datetime/number) but no explicit
 * style.numFormat, inject the matching Excel numFormat so the value displays
 * correctly. Explicit numFormat on the column style always wins.
 */
function withAutoNumFormat(c: ColumnConfig): ColumnConfig {
  const spec = typeof c.format === "object" ? c.format : null;
  const nf = spec ? numFormatForSpec(spec) : null;
  if (nf && !c.style?.numFormat) {
    return { ...c, style: { ...(c.style ?? {}), numFormat: nf } };
  }
  return c;
}
