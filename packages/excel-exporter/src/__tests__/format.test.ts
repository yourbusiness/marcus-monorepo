import { describe, it, expect } from 'vitest';
import { applyFormat, resolveCellFormat } from '../format-utils';
import type { ColumnConfig } from '../types';

describe('applyFormat', () => {
  it('enum: maps known values, falls back for unknown', () => {
    const spec = { type: 'enum' as const, map: { paid: 'Paid' }, fallback: '?' };
    expect(applyFormat('paid', spec)).toBe('Paid');
    expect(applyFormat('unknown', spec)).toBe('?');
  });

  it('number: decimals + thousands', () => {
    expect(applyFormat(1234567, { type: 'number', decimals: 2, thousands: true })).toBe('1,234,567.00');
    expect(applyFormat(3, { type: 'number', decimals: 2 })).toBe('3.00');
  });

  it('padding: left/right align', () => {
    expect(applyFormat(42, { type: 'padding', fill: '0', length: 5 })).toBe('00042');
    expect(applyFormat('ab', { type: 'padding', fill: ' ', length: 5, align: 'left' })).toBe('ab   ');
  });

  it('date/datetime: formats Date objects', () => {
    const d = new Date(2025, 0, 5, 14, 30);
    expect(applyFormat(d, { type: 'date' })).toBe('2025-01-05');
    expect(applyFormat(d, { type: 'datetime' })).toBe('2025-01-05 14:30');
  });
});

describe('resolveCellFormat (union dispatch)', () => {
  it('returns raw value when no format', () => {
    const col: ColumnConfig = { key: 'x', header: 'X' };
    expect(resolveCellFormat(col, { x: 'raw' })).toBe('raw');
    expect(resolveCellFormat(col, {})).toBe(''); // missing key -> ''
  });

  it('calls function form', () => {
    const col: ColumnConfig = { key: 'n', header: 'N', format: (v) => Number(v) * 2 };
    expect(resolveCellFormat(col, { n: 5 })).toBe(10);
  });

  it('dispatches FormatSpec via applyFormat', () => {
    const col: ColumnConfig = {
      key: 's',
      header: 'S',
      format: { type: 'enum', map: { a: 'Alpha' } },
    };
    expect(resolveCellFormat(col, { s: 'a' })).toBe('Alpha');
  });
});
