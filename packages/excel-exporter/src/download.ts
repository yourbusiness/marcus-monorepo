/** Trigger a browser download from a Blob. No-op in Node (document undefined). */
export function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Coerce a Uint8Array into a BlobPart. TS 5.7+ widened Uint8Array to a generic
 * over ArrayBufferLike (which includes SharedArrayBuffer), making it incompatible
 * with BlobPart's ArrayBufferView<ArrayBuffer>. At runtime any Uint8Array is a
 * valid BlobPart; this cast is the documented workaround.
 */
export function toBlobPart(bytes: Uint8Array): BlobPart {
  return bytes as unknown as BlobPart;
}
