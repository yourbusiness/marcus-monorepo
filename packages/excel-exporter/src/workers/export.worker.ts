import { initWasm } from "modern-xlsx";
import type { ExportOptions } from "../types";
import { WorkbookBuilder } from "../workbook-builder";
import { exportAsStream } from "../streaming-builder";

interface WorkerRequest {
  id: number;
  options: ExportOptions;
  wasmUrl?: string | URL;
  mode: "workbook" | "stream";
}
interface WorkerResponse {
  id: number;
  ok: boolean;
  bytes?: Uint8Array;
  rowCount?: number;
  engine?: "modern-xlsx";
  error?: string;
  progress?: number;
}

// Track the URL we initialized with; re-init if it changes (the main thread's
// configureWasm can swap the URL at runtime, and we must honor the new one).
let loadedWasmUrl: string | URL | undefined | null = null;
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, options, wasmUrl, mode } = e.data;
  try {
    if (loadedWasmUrl !== wasmUrl) {
      await initWasm(wasmUrl);
      loadedWasmUrl = wasmUrl;
    }

    let bytes: Uint8Array;
    let rowCount: number;

    if (mode === "stream") {
      // Forward per-row progress to the main thread (throttled inside exportAsStream).
      const r = await exportAsStream(options.sheets, (progress) => {
        (self as unknown as Worker).postMessage({ id, progress });
      });
      bytes = r.bytes;
      rowCount = r.rowCount;
    } else {
      const builder = await WorkbookBuilder.create();
      for (const s of options.sheets) builder.addSheet(s);
      bytes = await builder.toBuffer();
      rowCount = options.sheets.reduce((sum, s) => sum + s.data.length, 0);
    }

    const resp: WorkerResponse = {
      id,
      ok: true,
      bytes,
      rowCount,
      engine: "modern-xlsx",
    };
    (self as unknown as Worker).postMessage(resp, [bytes.buffer]);
  } catch (err) {
    const resp: WorkerResponse = {
      id,
      ok: false,
      error: (err as Error).message,
    };
    (self as unknown as Worker).postMessage(resp);
  }
};
