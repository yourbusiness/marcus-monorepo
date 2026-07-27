import type { Workbook } from 'modern-xlsx';
import type { CellStyle } from './types';

/**
 * Compile a business CellStyle into a modern-xlsx styleIndex (0-based index into
 * the workbook's cellXfs table). StyleBuilder chain methods mutate in place and
 * return `this` (verified in modern-xlsx 1.2.0 source), so direct calls suffice.
 */
export function buildStyleIndex(wb: Workbook, style: CellStyle): number {
  const builder = wb.createStyle();

  if (style.font) {
    const { bold, italic, size, color, name } = style.font;
    builder.font({
      ...(bold !== undefined && { bold }),
      ...(italic !== undefined && { italic }),
      ...(size !== undefined && { size }),
      ...(color !== undefined && { color }),
      ...(name !== undefined && { name }),
    });
  }

  if (style.fill && (style.fill.fgColor || style.fill.bgColor)) {
    builder.fill({
      pattern: style.fill.pattern ?? 'solid',
      fgColor: style.fill.fgColor ?? null,
      bgColor: style.fill.bgColor ?? null,
    });
  }

  if (style.alignment) {
    const { horizontal, vertical, wrapText, textRotation } = style.alignment;
    builder.alignment({
      ...(horizontal && { horizontal }),
      ...(vertical && { vertical }),
      ...(wrapText !== undefined && { wrapText }),
      ...(textRotation !== undefined && { textRotation }),
    });
  }

  if (style.border) {
    builder.border({
      top: style.border.top,
      bottom: style.border.bottom,
      left: style.border.left,
      right: style.border.right,
    });
  }

  if (style.numFormat) {
    builder.numberFormat(style.numFormat);
  }

  return builder.build(wb.styles);
}
