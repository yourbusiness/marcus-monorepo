import type { ExportOptions, ExportResult } from './types';
import { getWasmLoader } from './wasm-loader';
import { toBlobPart } from './download';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface PendingEntry {
  resolve: (b: Uint8Array) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let requestIdSeq = 0;
// requestId -> pending; replaces the single-onmessage pattern that broke concurrency.
const pending = new Map<number, PendingEntry>();

interface WorkerOkResponse {
  id: number;
  ok: true;
  bytes: Uint8Array;
  rowCount: number;
  engine: 'modern-xlsx';
}
interface WorkerErrResponse {
  id: number;
  ok: false;
  error: string;
}
type WorkerResponse = WorkerOkResponse | WorkerErrResponse;

function getOrCreateWorker(): Worker {
  if (worker) return worker;
  const { workerUrl } = getWasmLoader().getOptions();
  if (!workerUrl) {
    throw new Error(
      '[excel-exporter] workerUrl not configured. Call configureWasm({ workerUrl: "..." }) to point at export.worker.mjs (see README).',
    );
  }
  worker = new Worker(workerUrl, { type: 'module' });
  // Single onmessage handler registered once, dispatches by id.
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const { id, ok } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok && e.data.bytes) p.resolve(e.data.bytes);
    else p.reject(new Error((e.data as WorkerErrResponse).error ?? 'worker unknown error'));
  };
  worker.onerror = (err) => {
    for (const [, p] of pending) p.reject(new Error(err.message));
    pending.clear();
  };
  return worker;
}

/** Strip function-form format before structured clone (functions cannot be cloned). */
function stripFunctionFormats(options: ExportOptions): ExportOptions {
  return {
    ...options,
    sheets: options.sheets.map((s) => ({
      ...s,
      columns: s.columns.map((c) => {
        if (c.format && typeof c.format === 'function') {
          console.warn(
            `[excel-exporter] column "${c.key}" uses a function format, stripped for worker mode. Use FormatSpec for worker compatibility.`,
          );
          const { format: _format, ...rest } = c;
          return rest;
        }
        return c;
      }),
    })),
  };
}

export async function exportInWorker(
  options: ExportOptions,
  mode: 'workbook' | 'stream',
): Promise<ExportResult> {
  const start = performance.now();
  const { wasmUrl } = getWasmLoader().getOptions();
  const id = ++requestIdSeq;

  try {
    const w = getOrCreateWorker();
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, options: stripFunctionFormats(options), wasmUrl, mode });
    });
    const blob = new Blob([toBlobPart(bytes)], { type: XLSX_MIME });
    const totalRows = options.sheets.reduce((s, sh) => s + sh.data.length, 0);
    return {
      success: true,
      blob,
      engine: 'modern-xlsx',
      mode: mode === 'stream' ? 'stream' : 'worker',
      duration: performance.now() - start,
      rowCount: totalRows,
    };
  } catch (e) {
    return { success: false, error: e as Error, duration: performance.now() - start };
  }
}

export function terminateWorker(): void {
  worker?.terminate();
  worker = null;
  for (const [, p] of pending) p.reject(new Error('worker terminated'));
  pending.clear();
}
