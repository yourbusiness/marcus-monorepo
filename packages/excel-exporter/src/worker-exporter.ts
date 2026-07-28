import type { ExportOptions, ExportResult } from "./types";
import { getWasmLoader } from "./wasm-loader";
import { toBlobPart } from "./download";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface PendingEntry {
  resolve: (b: Uint8Array, rowCount: number) => void;
  reject: (e: Error) => void;
  onProgress?: (progress: number) => void;
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
  engine: "modern-xlsx";
}
interface WorkerErrResponse {
  id: number;
  ok: false;
  error: string;
}
interface WorkerProgressResponse {
  id: number;
  progress: number;
}
type WorkerResponse =
  WorkerOkResponse | WorkerErrResponse | WorkerProgressResponse;

function getOrCreateWorker(): Worker {
  if (worker) return worker;
  const { workerUrl } = getWasmLoader().getOptions();
  if (!workerUrl) {
    throw new Error(
      '[excel-exporter] workerUrl not configured. Call configureWasm({ workerUrl: "..." }) to point at export.worker.js (see README).',
    );
  }
  worker = new Worker(workerUrl, { type: "module" });
  // Single onmessage handler registered once, dispatches by id.
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const data = e.data;
    const p = pending.get(data.id);
    if (!p) return;
    // Progress messages do not complete the export; forward and keep pending.
    if ("progress" in data) {
      p.onProgress?.(data.progress);
      return;
    }
    pending.delete(data.id);
    if (data.ok && data.bytes) p.resolve(data.bytes, data.rowCount);
    else
      p.reject(
        new Error((data as WorkerErrResponse).error ?? "worker unknown error"),
      );
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
        if (c.format && typeof c.format === "function") {
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
  mode: "workbook" | "stream",
): Promise<ExportResult> {
  const start = performance.now();
  const { wasmUrl } = getWasmLoader().getOptions();
  const id = ++requestIdSeq;

  try {
    const w = getOrCreateWorker();
    const timeoutMs = 120_000; // 2-minute timeout
    const [bytes, workerRowCount] = await new Promise<[Uint8Array, number]>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error("export worker timed out after " + timeoutMs + "ms"),
          );
        }, timeoutMs);
        pending.set(id, {
          resolve: (b: Uint8Array, rc: number) => {
            clearTimeout(timer);
            resolve([b, rc]);
          },
          reject: (e: Error) => {
            clearTimeout(timer);
            reject(e);
          },
          onProgress: options.onProgress,
        });
        w.postMessage({
          id,
          options: stripFunctionFormats(options),
          wasmUrl,
          mode,
        });
      },
    );
    const blob = new Blob([toBlobPart(bytes)], { type: XLSX_MIME });
    return {
      success: true,
      blob,
      engine: "modern-xlsx",
      mode: mode === "stream" ? "stream" : "worker",
      duration: performance.now() - start,
      rowCount: workerRowCount,
    };
  } catch (e) {
    return {
      success: false,
      error: e as Error,
      duration: performance.now() - start,
    };
  }
}

export function terminateWorker(): void {
  worker?.terminate();
  worker = null;
  for (const [, p] of pending) p.reject(new Error("worker terminated"));
  pending.clear();
}
