import {
  Workbook,
  sheetAddAoa,
  encodeCellRef,
  type Worksheet,
} from "modern-xlsx";
import type { SheetConfig, ColumnConfig } from "./types";
import { buildStyleIndex } from "./style-utils";
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
    // Auto-inject an Excel numFormat for typed FormatSpecs (date/datetime/number)
    // so the cell renders correctly without forcing the caller to also set
    // style.numFormat (otherwise dates show as raw serials, numbers as text).
    const columns = config.columns.map(withAutoNumFormat);
    const headers = columns.map((c) => c.header);
    const rows = config.data.map((item) =>
      columns.map((col) => resolveCellFormat(col, item)),
    );
    const aoa = [headers, ...rows];

    validateSheetName(config.name);
    const ws = this.wb.addSheet(config.name);
    sheetAddAoa(ws, aoa, { origin: "A1" });

    return this.applyLayout(ws, { ...config, columns }, rows.length);
  }

  private applyLayout(
    ws: Worksheet,
    config: SheetConfig,
    dataRowCount: number,
  ): this {
    // Column widths (1-based)
    config.columns.forEach((c, i) => {
      if (c.width !== undefined) ws.setColumnWidth(i + 1, c.width);
    });

    // Header styles. Column-level headerStyle wins over the sheet-level default.
    config.columns.forEach((c, i) => {
      const headerStyle = c.headerStyle ?? config.headerStyle;
      if (headerStyle) {
        const idx = buildStyleIndex(this.wb, headerStyle);
        const cell = ws.rows[0]?.cells[i];
        if (cell) cell.styleIndex = idx;
      }
    });

    // Column styles: apply to data cells only, matching the `style: not the
    // header` contract in types.ts. Header styling is handled separately above
    // via headerStyle. ws.rows[0] is the header row, so slice(1) iterates only
    // data rows; mutating styleIndex is a plain JS property write, bypassing
    // ws.cell(ref) ref-parsing overhead.
    config.columns.forEach((c, i) => {
      if (c.style) {
        const idx = buildStyleIndex(this.wb, c.style);
        for (const row of ws.rows.slice(1)) {
          const cell = row.cells[i];
          if (cell) cell.styleIndex = idx;
        }
      }
    });

    // Freeze header rows
    if (config.freezeRows && config.freezeRows > 0) {
      ws.frozenPane = { rows: config.freezeRows, cols: 0 };
    }

    // Auto-filter over header range A1:<lastCol><lastRow>
    if (config.autoFilter) {
      const lastCol = encodeCellRef(0, config.columns.length - 1).match(
        /[A-Z]+/,
      )![0];
      ws.autoFilter = `A1:${lastCol}${dataRowCount + 1}`;
    }

    // Merges: row/col are 0-based relative to the data area; +1 to skip the header row.
    config.merges?.forEach((m) => {
      const start = encodeCellRef(m.row + 1, m.col);
      const end = encodeCellRef(m.row + m.rowspan, m.col + m.colspan - 1);
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
