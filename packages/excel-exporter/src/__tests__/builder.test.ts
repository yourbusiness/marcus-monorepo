import { describe, it, expect } from 'vitest';
import { WorkbookBuilder } from '../workbook-builder';
import { StylePresets } from '../style-presets';
import { readBuffer, makeData } from './setup';

describe('WorkbookBuilder round-trip', () => {
  it('writes data, headers, styles, freeze, autofilter and merges', async () => {
    const data = makeData(5);
    const builder = await WorkbookBuilder.create();
    builder.addSheet({
      name: 'Sales',
      freezeRows: 1,
      autoFilter: true,
      merges: [{ row: 0, col: 0, rowspan: 2, colspan: 1 }],
      columns: [
        { key: 'id', header: 'ID', width: 10 },
        { key: 'name', header: 'Name', width: 18, style: StylePresets.dataRow },
        { key: 'amount', header: 'Amount', width: 14, style: StylePresets.currency },
        {
          key: 'status',
          header: 'Status',
          width: 10,
          format: { type: 'enum', map: { paid: 'Paid', pending: 'Pending' }, fallback: 'Unknown' },
        },
      ],
      data,
    });
    const bytes = await builder.toBuffer();

    // Valid XLSX (ZIP local file header magic)
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));

    const wb = await readBuffer(bytes);
    const ws = wb.getSheet('Sales')!;
    expect(ws).toBeDefined();

    // Header row present, freeze applied
    expect(ws.cell('A1').value).toBe('ID');
    expect(ws.frozenPane).toEqual({ rows: 1, cols: 0 });

    // Auto-filter covers header..last data row (5 data rows -> A1:D6)
    // autoFilter reads back as AutoFilterData { range: 'A1:D6' }
    expect((ws.autoFilter as { range: string }).range).toBe('A1:D6');

    // Data row 1 values
    expect(String(ws.cell('A2').value)).toBe('0');
    expect(ws.cell('B2').value).toBe('user_0');
    // enum format: paid -> Paid
    expect(ws.cell('D2').value).toBe('Paid');
    expect(ws.cell('D3').value).toBe('Pending');

    // Column style applied: B (dataRow) and C (currency) have non-null styleIndex
    expect(ws.cell('B2').styleIndex).not.toBeNull();
    expect(ws.cell('C2').styleIndex).not.toBeNull();
    // A has no style config -> default (null or 0)
    expect(ws.cell('A2').styleIndex).toBeNull();

    // Merge: A2:A3 (row 0 data-area, rowspan 2 -> rows 2-3 in Excel)
    expect(ws.mergeCells.some((r) => r === 'A2:A3')).toBe(true);
  });

  it('handles multiple sheets', async () => {
    const builder = await WorkbookBuilder.create();
    builder
      .addSheet({ name: 'S1', columns: [{ key: 'a', header: 'A' }], data: [{ a: 1 }] })
      .addSheet({ name: 'S2', columns: [{ key: 'b', header: 'B' }], data: [{ b: 2 }] });
    const bytes = await builder.toBuffer();
    const wb = await readBuffer(bytes);
    expect(wb.sheetNames).toEqual(['S1', 'S2']);
    expect(String(wb.getSheet('S1')!.cell('A2').value)).toBe('1');
    expect(String(wb.getSheet('S2')!.cell('A2').value)).toBe('2');
  });

  it('toBlob returns a Blob with xlsx mime type', async () => {
    const builder = await WorkbookBuilder.create();
    builder.addSheet({ name: 'S', columns: [{ key: 'x', header: 'X' }], data: [{ x: 'hi' }] });
    const blob = await builder.toBlob();
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(blob.size).toBeGreaterThan(0);
  });
});
