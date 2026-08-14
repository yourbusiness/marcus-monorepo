import { StreamingXlsxWriter, type StreamingCellInput } from "modern-xlsx";
import type { SheetConfig } from "./types";
import { getWasmLoader } from "./wasm-loader";
import { displayValue, validateSheetName } from "./format-utils";

export interface StreamResult {
  bytes: Uint8Array;
  rowCount: number;
}

/**
 * Streaming export -- the only viable path for >=50k rows.
 *
 * `Workbook.toBuffer()` has a severe performance cliff beyond ~55k rows
 * (verified: 100k rows ~21s), while StreamingXlsxWriter keeps constant memory
 * and finishes in ~1.6s for 100k rows (verified: writeRow ~1.5s + finish ~100ms).
 *
 * Must run off the main thread (the writeRow loop is ~1.5s of JS work). v1 does
 * not support StyleBuilder styles (StreamingCellInput.style requires a pre-built
 * styles.xml via setStylesXml -- a Phase 2 enhancement).
 */
export async function exportAsStream(
  sheets: SheetConfig[],
  onProgress?: (p: number) => void,
): Promise<StreamResult> {
  await getWasmLoader().ensureLoaded();
  const writer = StreamingXlsxWriter.create();
  let totalRows = 0;

  let totalExpected = 0;
  for (const s of sheets) totalExpected += s.data.length;

  for (const config of sheets) {
    validateSheetName(config.name);
    writer.startSheet(config.name);
    writer.writeRow(
      config.columns.map((c) => ({
        value: c.header,
        cellType: "sharedString",
      })),
    );
    // StreamingXlsxWriter has no column-width/freeze/autofilter/merge API.
    const skipped: string[] = [];
    if (config.columns.some((c) => c.width !== undefined))
      skipped.push("width");
    if (
      config.headerStyle !== undefined ||
      config.columns.some((c) => c.headerStyle !== undefined)
    )
      skipped.push("headerStyle");
    if (config.freezeRows) skipped.push("freezeRows");
    if (config.autoFilter) skipped.push("autoFilter");
    if (config.merges?.length) skipped.push("merges");
    if (skipped.length)
      console.warn(
        "[excel-exporter] stream mode: layout features not supported (" +
          skipped.join(", ") +
          ")",
      );
    const reusableCells: StreamingCellInput[] = config.columns.map(() => ({
      value: "",
      cellType: "sharedString",
    }));
    for (const item of config.data) {
      for (let colIndex = 0; colIndex < config.columns.length; colIndex++) {
        const col = config.columns[colIndex];
        const cell = reusableCells[colIndex];
        const v = displayValue(col, item);
        if (typeof v === "number") {
          cell.value = String(v);
          cell.cellType = "number";
        } else if (typeof v === "boolean") {
          cell.value = v ? "1" : "0";
          cell.cellType = "boolean";
        } else {
          cell.value = v;
          cell.cellType = "sharedString";
        }
      }
      writer.writeRow(reusableCells);
      totalRows++;
      if (onProgress && totalRows % 1000 === 0)
        onProgress(totalRows / totalExpected);
    }
  }

  onProgress?.(1);
  const bytes = writer.finish();
  return { bytes, rowCount: totalRows };
}
