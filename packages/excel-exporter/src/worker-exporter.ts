import type { ColumnConfig, ExportOptions, ExportResult } from "./types";
import { getWasmLoader } from "./wasm-loader";
import { toBlobPart } from "./download";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface PendingEntry {
  resolve: (b: Uint8Array, rowCount: number) => void;
  reject: (e: Error) => void;
  /** The worker instance this request was dispatched to (see onerror). */
  worker: Worker;
  onProgress?: (progress: number) => void;
  onPhase?: (phase: "init" | "build", durationMs: number) => void;
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
interface WorkerPhaseResponse {
  id: number;
  phase: "init" | "build";
  duration: number;
}
type WorkerResponse =
  | WorkerOkResponse
  | WorkerErrResponse
  | WorkerProgressResponse
  | WorkerPhaseResponse;

function getOrCreateWorker(): Worker {
  if (worker) return worker;
  const { workerUrl } = getWasmLoader().getOptions();
  if (!workerUrl) {
    throw new Error(
      '[excel-exporter] workerUrl not configured. Call configureWasm({ workerUrl: "..." }) to point at export.worker.js (see README).',
    );
  }
  const w = (worker = new Worker(workerUrl, { type: "module" }));
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
    if ("phase" in data) {
      p.onPhase?.(data.phase, data.duration);
      return;
    }
    pending.delete(data.id);
    if (data.ok && data.bytes) p.resolve(data.bytes, data.rowCount);
    else
      p.reject(
        new Error((data as WorkerErrResponse).error ?? "worker unknown error"),
      );
  };
  // A worker that errored (e.g. script failed to load) must not be reused:
  // terminate it and drop the cached reference so the next export creates a
  // fresh one, instead of failing forever into the SheetJS fallback. Only the
  // requests dispatched to THIS worker are rejected -- a replacement worker
  // may already be serving newer request ids.
  w.onerror = (err) => {
    if (worker === w) {
      w.terminate();
      worker = null;
    }
    for (const [id, p] of pending) {
      if (p.worker !== w) continue;
      pending.delete(id);
      p.reject(new Error(err.message || "worker error"));
    }
  };
  return w;
}

/** Strip function-form format before structured clone (functions cannot be cloned). */
function stripFunctionFormats(options: ExportOptions): ExportOptions {
  const { onProgress: _onProgress, onPhase: _onPhase, ...rest } = options;
  return {
    ...rest,
    sheets: options.sheets.map((s) => ({
      ...s,
      columns: s.columns.map(stripColumn),
    })),
  };
}

/** Recursively strip function-form formats; group columns carry `children`. */
function stripColumn(c: ColumnConfig): ColumnConfig {
  const children = c.children?.map(stripColumn);
  if (c.format && typeof c.format === "function") {
    console.warn(
      `[excel-exporter] column "${c.key ?? c.header}" uses a function format, stripped for worker mode. Use FormatSpec for worker compatibility.`,
    );
    const { format: _format, ...rest } = c;
    return children ? { ...rest, children } : rest;
  }
  return children ? { ...c, children } : c;
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
          worker: w,
          resolve: (b: Uint8Array, rc: number) => {
            clearTimeout(timer);
            resolve([b, rc]);
          },
          reject: (e: Error) => {
            clearTimeout(timer);
            reject(e);
          },
          onProgress: options.onProgress,
          onPhase: (phase, duration) => options.onPhase?.(phase, duration),
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
