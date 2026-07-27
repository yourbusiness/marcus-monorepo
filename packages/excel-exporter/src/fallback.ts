import type { ExportOptions, ExportResult } from './types';
import { triggerDownload } from './download';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// SheetJS is an optional peerDep. Both the local 'xlsx' module and the CDN URL
// lack type declarations in this workspace, so the loader is typed loosely.
type SheetJSApi = {
  utils: {
    book_new(): unknown;
    aoa_to_sheet(aoa: unknown[][]): unknown;
    book_append_sheet(wb: unknown, ws: unknown, name: string): void;
  };
  write(wb: unknown, opts: { type: string; bookType: string }): ArrayBuffer;
};

function cast<T>(m: unknown): T { return m as T; }

async function loadSheetJS(): Promise<SheetJSApi> {
  try {
    // @ts-expect-error -- optional peerDep, may not be installed
    return cast<SheetJSApi>(await import('xlsx'));
  } catch {
    // Consumer did not install xlsx; load from the SheetJS official CDN
    // (npm xlsx@0.18.5 has been unmaintained since 2022).
    // @ts-expect-error -- remote URL has no type declaration
    return cast<SheetJSApi>(await import(/* @vite-ignore */ 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'));
  }
}

/**
 * SheetJS fallback: used when WASM is unsupported or fails to load.
 * SheetJS CE has no style-write support, so styles are stripped. This is a
 * last-resort guarantee of "can export, no styles", not a regular path.
 */
export async function exportWithSheetJS(
  options: ExportOptions,
  start: number,
  reason: string,
): Promise<ExportResult> {
  console.warn(`[excel-exporter] Falling back to SheetJS (styles stripped). Reason: ${reason}`);
  try {
    const XLSX = await loadSheetJS();
    const wb = XLSX.utils.book_new();
    for (const s of options.sheets) {
      const aoa = [
        s.columns.map((c) => c.header),
        ...s.data.map((row) => s.columns.map((c) => row[c.key] ?? '')),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    }
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([out], { type: XLSX_MIME });
    if (options.download !== false) triggerDownload(blob, options.filename);
    const totalRows = options.sheets.reduce((s, sh) => s + sh.data.length, 0);
    return {
      success: true,
      blob,
      engine: 'sheetjs',
      mode: 'main',
      duration: performance.now() - start,
      rowCount: totalRows,
      error: new Error('Fallback: styles stripped (SheetJS CE has no style-write support)'),
    };
  } catch (e) {
    return { success: false, error: e as Error, duration: performance.now() - start };
  }
}
