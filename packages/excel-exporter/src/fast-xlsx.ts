import { strToU8, zipSync } from "fflate";
import type { SheetConfig } from "./types";
import { displayValue, validateSheetName } from "./format-utils";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const CONTENT_NS =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const INVALID_XML_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export interface FastXlsxResult {
  bytes: Uint8Array;
  rowCount: number;
}

interface SharedStringTable {
  map: Map<string, number>;
  parts: string[];
  intern(value: string): number;
}

function createSharedStringTable(): SharedStringTable {
  const map = new Map<string, number>();
  const parts: string[] = [];
  return {
    map,
    parts,
    intern(value: string): number {
      const existing = map.get(value);
      if (existing !== undefined) return existing;
      const index = map.size;
      map.set(value, index);
      parts.push(`<si><t xml:space="preserve">${escapeXml(value)}</t></si>`);
      return index;
    },
  };
}

function sanitizeXml(value: string): string {
  return value.replace(INVALID_XML_CHARS, "");
}

function escapeXml(value: string): string {
  const v = sanitizeXml(value);
  if (
    v.indexOf("&") === -1 &&
    v.indexOf("<") === -1 &&
    v.indexOf(">") === -1 &&
    v.indexOf('"') === -1 &&
    v.indexOf("'") === -1
  ) {
    return v;
  }
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number): string {
  let n = index;
  let name = "";
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

function stringifyCell(value: unknown): string | number | boolean {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  return JSON.stringify(value);
}

function appendCell(
  out: string[],
  ref: string,
  value: string | number | boolean,
  intern: (value: string) => number,
): void {
  if (typeof value === "number") {
    out.push(`<c r="${ref}" t="n"><v>${value}</v></c>`);
    return;
  }
  if (typeof value === "boolean") {
    out.push(`<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`);
    return;
  }
  out.push(`<c r="${ref}" t="s"><v>${intern(value)}</v></c>`);
}

function buildWorksheetXml(
  config: SheetConfig,
  onProgress?: (progress: number) => void,
  totalExpected?: number,
  processedRows?: { count: number },
  stringTable?: SharedStringTable,
): string {
  validateSheetName(config.name);
  const cols = config.columns.map((c, i) => ({
    col: c,
    letter: columnName(i),
  }));
  const out: string[] = [];

  // Header row.
  out.push(`<row r="1">`);
  for (const { col, letter } of cols) {
    appendCell(out, `${letter}1`, stringifyCell(col.header), (value) =>
      stringTable!.intern(value),
    );
  }
  out.push(`</row>`);

  for (let rowIndex = 0; rowIndex < config.data.length; rowIndex++) {
    const item = config.data[rowIndex];
    const rowNumber = rowIndex + 2;
    out.push(`<row r="${rowNumber}">`);
    for (const { col, letter } of cols) {
      appendCell(
        out,
        `${letter}${rowNumber}`,
        displayValue(col, item),
        (value) => stringTable!.intern(value),
      );
    }
    out.push(`</row>`);
    processedRows!.count++;
    if (onProgress && totalExpected && processedRows!.count % 1000 === 0) {
      onProgress(processedRows!.count / totalExpected);
    }
  }

  return (
    XML_DECL +
    `<worksheet xmlns="${MAIN_NS}"><sheetData>${out.join(
      "",
    )}</sheetData></worksheet>`
  );
}

/**
 * Fast, dependency-light XLSX writer for the large-data stream path.
 *
 * It intentionally trades streaming memory for throughput: the worksheet XML
 * is assembled once in memory and zipped synchronously with fflate. That is
 * the right trade for the supported 50k-100k+ export envelope and is what
 * makes the public API hit its sub-second targets. For feature parity with the
 * modern-xlsx stream path, layout/styling features are still skipped with the
 * same warnings.
 */
export function exportFastXlsx(
  sheets: SheetConfig[],
  onProgress?: (progress: number) => void,
): FastXlsxResult {
  const totalExpected = sheets.reduce((sum, s) => sum + s.data.length, 0);
  const processed = { count: 0 };
  const worksheetXmls: string[] = [];
  const workbookSheets: string[] = [];
  const workbookRels: string[] = [];
  const contentOverrides: string[] = [];
  const stringTable = createSharedStringTable();

  sheets.forEach((config, index) => {
    const sheetNumber = index + 1;
    const skipped: string[] = [];
    if (config.columns.some((c) => c.width !== undefined))
      skipped.push("width");
    if (
      config.headerStyle !== undefined ||
      config.columns.some((c) => c.headerStyle !== undefined)
    )
      skipped.push("headerStyle");
    // Data-cell styles are dropped just like layout features; warn so the
    // degradation is visible instead of silent (headerStyle above already did).
    if (config.columns.some((c) => c.style !== undefined))
      skipped.push("style");
    if (config.freezeRows) skipped.push("freezeRows");
    if (config.autoFilter) skipped.push("autoFilter");
    if (config.merges?.length) skipped.push("merges");
    if (skipped.length) {
      console.warn(
        "[excel-exporter] stream mode: features not supported (" +
          skipped.join(", ") +
          ")",
      );
    }

    worksheetXmls.push(
      buildWorksheetXml(
        config,
        onProgress,
        totalExpected,
        processed,
        stringTable,
      ),
    );
    workbookSheets.push(
      `<sheet name="${escapeXml(
        config.name,
      )}" sheetId="${sheetNumber}" r:id="rId${sheetNumber}"/>`,
    );
    workbookRels.push(
      `<Relationship Id="rId${sheetNumber}" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet${sheetNumber}.xml"/>`,
    );
    contentOverrides.push(
      `<Override PartName="/xl/worksheets/sheet${sheetNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
  });

  const sharedStringsIndex = sheets.length + 1;
  const hasSharedStrings = stringTable.parts.length > 0;
  if (hasSharedStrings) {
    workbookRels.push(
      `<Relationship Id="rId${sharedStringsIndex}" Type="${OFFICE_REL}/sharedStrings" Target="sharedStrings.xml"/>`,
    );
    contentOverrides.push(
      `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`,
    );
  }

  const contentTypes =
    XML_DECL +
    `<Types xmlns="${CONTENT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${contentOverrides.join(
      "",
    )}</Types>`;
  const rootRels =
    XML_DECL +
    `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook =
    XML_DECL +
    `<workbook xmlns="${MAIN_NS}" xmlns:r="${OFFICE_REL}"><sheets>${workbookSheets.join(
      "",
    )}</sheets></workbook>`;
  const workbookRelationships =
    XML_DECL +
    `<Relationships xmlns="${REL_NS}">${workbookRels.join("")}</Relationships>`;
  const sharedStringsXml = hasSharedStrings
    ? XML_DECL +
      `<sst xmlns="${MAIN_NS}" count="${stringTable.parts.length}" uniqueCount="${stringTable.parts.length}">${stringTable.parts.join(
        "",
      )}</sst>`
    : null;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationships),
  };
  worksheetXmls.forEach((xml, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(xml);
  });
  if (sharedStringsXml) {
    files["xl/sharedStrings.xml"] = strToU8(sharedStringsXml);
  }

  const bytes = zipSync(files, { level: 1 });
  onProgress?.(1);
  return { bytes, rowCount: processed.count };
}
