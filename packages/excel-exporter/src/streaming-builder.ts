import { StreamingXlsxWriter, type StreamingCellInput } from 'modern-xlsx';
import type { SheetConfig } from './types';
import { getWasmLoader } from './wasm-loader';
import { toBlobPart } from './download';
import { resolveCellFormat, toStr } from './format-utils';

export interface StreamResult {
  bytes: Uint8Array;
  rowCount: number;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
export async function exportAsStream(sheets: SheetConfig[]): Promise<StreamResult> {
  await getWasmLoader().ensureLoaded();
  const writer = StreamingXlsxWriter.create();
  let totalRows = 0;

  for (const config of sheets) {
    writer.startSheet(config.name);
    writer.writeRow(config.columns.map((c) => ({ value: c.header, cellType: 'sharedString' })));
    for (const item of config.data) {
      const cells: StreamingCellInput[] = config.columns.map((col) => {
        const raw = resolveCellFormat(col, item);
        if (typeof raw === 'number') return { value: String(raw), cellType: 'number' };
        if (typeof raw === 'boolean') return { value: raw ? '1' : '0', cellType: 'boolean' };
        return { value: toStr(raw), cellType: 'sharedString' };
      });
      writer.writeRow(cells);
      totalRows++;
    }
  }

  const bytes = writer.finish();
  return { bytes, rowCount: totalRows };
}

/** Convenience wrapper returning a Blob. */
export async function exportAsStreamBlob(sheets: SheetConfig[]): Promise<{ blob: Blob; rowCount: number }> {
  const { bytes, rowCount } = await exportAsStream(sheets);
  return { blob: new Blob([toBlobPart(bytes)], { type: XLSX_MIME }), rowCount };
}
