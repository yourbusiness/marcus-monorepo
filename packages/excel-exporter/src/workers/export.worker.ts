import { initWasm } from 'modern-xlsx';
import type { ExportOptions } from '../types';
import { WorkbookBuilder } from '../workbook-builder';
import { exportAsStream } from '../streaming-builder';

interface WorkerRequest {
  id: number;
  options: ExportOptions;
  wasmUrl?: string | URL;
  mode: 'workbook' | 'stream';
}
interface WorkerResponse {
  id: number;
  ok: boolean;
  bytes?: Uint8Array;
  rowCount?: number;
  engine?: 'modern-xlsx';
  error?: string;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, options, wasmUrl, mode } = e.data;
  try {
    await initWasm(wasmUrl);

    let bytes: Uint8Array;
    let rowCount: number;

    if (mode === 'stream') {
      const r = await exportAsStream(options.sheets);
      bytes = r.bytes;
      rowCount = r.rowCount;
    } else {
      const builder = await WorkbookBuilder.create();
      for (const s of options.sheets) builder.addSheet(s);
      bytes = await builder.toBuffer();
      rowCount = options.sheets.reduce((sum, s) => sum + s.data.length, 0);
    }

    const resp: WorkerResponse = { id, ok: true, bytes, rowCount, engine: 'modern-xlsx' };
    (self as unknown as Worker).postMessage(resp, [bytes.buffer]);
  } catch (err) {
    const resp: WorkerResponse = { id, ok: false, error: (err as Error).message };
    (self as unknown as Worker).postMessage(resp);
  }
};
