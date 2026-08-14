import type {
  CellStyle,
  ColumnConfig,
  ExportMode,
  ExportOptions,
  ExportPhase,
  MergeRange,
  SheetConfig,
} from "./types";

/**
 * A deliberately dependency-free table column descriptor.
 *
 * It accepts the common field names used by Ant Design (`title` / `dataIndex`)
 * and Element Plus (`label` / `prop`). `key` / `header` take precedence when
 * both naming styles are present.
 */
export interface TableColumnInput {
  key?: string;
  dataIndex?: string;
  prop?: string;
  header?: string | number;
  title?: string | number;
  label?: string | number;
  width?: number;
  style?: CellStyle;
  headerStyle?: CellStyle;
  format?: ColumnConfig["format"];
}

export interface TableSheetInput {
  columns: TableColumnInput[];
  data: Record<string, unknown>[];
  sheetName?: string;
  freezeRows?: number;
  autoFilter?: boolean;
  merges?: MergeRange[];
}

export interface TableExportOptions extends TableSheetInput {
  filename: string;
  mode?: ExportMode;
  onProgress?: (progress: number) => void;
  onPhase?: (phase: ExportPhase, durationMs: number) => void;
  download?: boolean;
}

function normalizeHeader(
  value: string | number | undefined,
  key: string,
): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error(
    `[excel-exporter] table column "${key}" has no usable header. Provide header, title, or label.`,
  );
}

/**
 * Convert a common table `columns + data` shape into the library's generic
 * `SheetConfig`. This keeps the adapter explicit and easy to test.
 */
export function tableToSheet(input: TableSheetInput): SheetConfig {
  const columns = input.columns.map((col, index): ColumnConfig => {
    const key = col.key ?? col.dataIndex ?? col.prop;
    if (!key || typeof key !== "string") {
      throw new Error(
        `[excel-exporter] table column #${index} has no usable key. Provide key, dataIndex, or prop.`,
      );
    }
    return {
      key,
      header: normalizeHeader(col.header ?? col.title ?? col.label, key),
      ...(col.width !== undefined && { width: col.width }),
      ...(col.style !== undefined && { style: col.style }),
      ...(col.headerStyle !== undefined && { headerStyle: col.headerStyle }),
      ...(col.format !== undefined && { format: col.format }),
    };
  });

  return {
    name: input.sheetName ?? "Sheet1",
    columns,
    data: input.data,
    ...(input.freezeRows !== undefined && { freezeRows: input.freezeRows }),
    ...(input.autoFilter !== undefined && { autoFilter: input.autoFilter }),
    ...(input.merges !== undefined && { merges: input.merges }),
  };
}

/**
 * Convert `exportTable()` options into the generic `ExportOptions` consumed by
 * `exportExcel()`. Kept free of `exportExcel` imports to avoid a circular
 * dependency between the main entrypoint and this adapter.
 */
export function tableExportToOptions(input: TableExportOptions): ExportOptions {
  const {
    columns,
    data,
    sheetName,
    freezeRows,
    autoFilter,
    merges,
    filename,
    mode,
    onProgress,
    onPhase,
    download,
  } = input;

  return {
    filename,
    sheets: [
      tableToSheet({
        columns,
        data,
        sheetName,
        freezeRows,
        autoFilter,
        merges,
      }),
    ],
    ...(mode !== undefined && { mode }),
    ...(onProgress !== undefined && { onProgress }),
    ...(onPhase !== undefined && { onPhase }),
    ...(download !== undefined && { download }),
  };
}
