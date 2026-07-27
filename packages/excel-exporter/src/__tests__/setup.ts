import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { initWasmSync, readBuffer } from 'modern-xlsx';

/**
 * Shared WASM bootstrap for Node test environment.
 *
 * Node's undici fetch rejects file:// URLs, so initWasm(path) fails. Use
 * initWasmSync with a pre-loaded buffer instead (verified approach).
 */
const require = createRequire(import.meta.url);
const wasmPath =
  require('path').dirname(require.resolve('modern-xlsx')) + '/modern-xlsx.wasm';
initWasmSync(readFileSync(wasmPath));

export { readBuffer };
export function makeData(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `user_${i}`,
    amount: Number((i * 7.13).toFixed(2)),
    createdAt: new Date(2025, 0, 1 + (i % 28)),
    status: i % 2 === 0 ? 'paid' : 'pending',
  }));
}
export const fourCols = [
  { key: 'id', header: 'ID' },
  { key: 'name', header: 'Name' },
  { key: 'amount', header: 'Amount' },
  { key: 'createdAt', header: 'Date' },
];
