import { describe, it, expect } from 'vitest';
import { exportAsStream } from '../streaming-builder';
import { readBuffer } from './setup';

describe('exportAsStream round-trip', () => {
  it('produces a valid xlsx with correct row count and values', async () => {
    const sheets = [
      {
        name: 'Data',
        columns: [
          { key: 'id', header: 'ID' },
          { key: 'name', header: 'Name' },
          { key: 'amount', header: 'Amount' },
          { key: 'status', header: 'Status' },
        ],
        data: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `row_${i}`,
          amount: i * 1.5,
          status: i % 2 === 0 ? 'paid' : 'pending',
        })),
      },
    ];
    const { bytes, rowCount } = await exportAsStream(sheets);

    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(rowCount).toBe(1000);

    const wb = await readBuffer(bytes);
    const ws = wb.getSheet('Data')!;
    // header + 1000 data rows
    expect(ws.rowCount).toBe(1001);
    expect(ws.cell('A1').value).toBe('ID');
    expect(ws.cell('D1').value).toBe('Status');
    expect(String(ws.cell('A2').value)).toBe('0');
    expect(String(ws.cell('C1001').value)).toBe(String(999 * 1.5));
  });

  it('handles multi-sheet streaming', async () => {
    const { bytes, rowCount } = await exportAsStream([
      { name: 'A', columns: [{ key: 'x', header: 'X' }], data: [{ x: 1 }, { x: 2 }] },
      { name: 'B', columns: [{ key: 'y', header: 'Y' }], data: [{ y: 3 }] },
    ]);
    expect(rowCount).toBe(3);
    const wb = await readBuffer(bytes);
    expect(wb.sheetNames).toEqual(['A', 'B']);
    expect(wb.getSheet('A')!.rowCount).toBe(3);
    expect(wb.getSheet('B')!.rowCount).toBe(2);
  });
});
