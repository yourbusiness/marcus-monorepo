import type { SheetConfig } from "./types";
import { exportFastXlsx } from "./fast-xlsx";

export interface StreamResult {
  bytes: Uint8Array;
  rowCount: number;
}

/**
 * Streaming export -- the large-data path for >=50k rows.
 *
 * v1 does not support StyleBuilder/layout styles, matching the documented
 * stream-mode contract. The fast writer assembles a valid minimal XLSX with
 * fflate and keeps the 50k/100k exports well below the public SLAs.
 */
// Fast writer is synchronous internally; the async signature is kept for API
// compatibility with the previous StreamingXlsxWriter implementation.
// eslint-disable-next-line @typescript-eslint/require-await
export async function exportAsStream(
  sheets: SheetConfig[],
  onProgress?: (p: number) => void,
): Promise<StreamResult> {
  return exportFastXlsx(sheets, onProgress);
}
