import type {
  ColumnConfig,
  ExportMode,
  ExportOptions,
  ExportPhase,
  SheetConfig,
} from "./types";

export type EChartsScalar = number | string | null;
export type EChartsDatum =
  | EChartsScalar
  | [number, number]
  | { name?: string; value?: EChartsScalar | [number, number] };

export interface EChartsSeriesInput {
  name?: string;
  type?: string;
  data?: EChartsDatum[];
}

export interface EChartsXAxisInput {
  type?: string;
  data?: Array<number | string>;
}

/**
 * A minimal structural subset of an ECharts option. The adapter intentionally
 * does not depend on the ECharts runtime or its full type system.
 */
export interface EChartsOptionInput {
  xAxis?: EChartsXAxisInput | EChartsXAxisInput[];
  series?: EChartsSeriesInput[];
  dataset?: unknown;
}

export type EChartsLayout = "wide" | "long";

export interface EChartsSheetInput {
  option: EChartsOptionInput;
  sheetName?: string;
  layout?: EChartsLayout;
  categoryHeader?: string;
  seriesHeader?: string;
  nameHeader?: string;
  valueHeader?: string;
}

export interface EChartsExportOptions extends EChartsSheetInput {
  filename: string;
  mode?: ExportMode;
  onProgress?: (progress: number) => void;
  onPhase?: (phase: ExportPhase, durationMs: number) => void;
  download?: boolean;
}

const DEFAULT_CATEGORY_HEADER = "类目";
const DEFAULT_SERIES_HEADER = "系列";
const DEFAULT_NAME_HEADER = "名称";
const DEFAULT_VALUE_HEADER = "数值";

type ResolvedEChartsSheetInput = EChartsSheetInput & {
  series: EChartsSeriesInput[];
};

function seriesName(series: EChartsSeriesInput, index: number): string {
  return series.name ?? `系列${index + 1}`;
}

function isCoordinatePair(value: EChartsDatum): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === "number")
  );
}

function assertCategoryValue(value: EChartsDatum, context: string): void {
  if (
    isCoordinatePair(value) ||
    (value !== null && typeof value === "object")
  ) {
    throw new Error(
      `[excel-exporter] unsupported ECharts datum for category layout in ${context}. Use long layout for scatter/pie item data.`,
    );
  }
}

function buildCategorySheet(
  input: ResolvedEChartsSheetInput,
  categories: Array<number | string>,
): SheetConfig {
  const series = input.series ?? [];
  const layout = input.layout ?? "wide";
  const categoryHeader = input.categoryHeader ?? DEFAULT_CATEGORY_HEADER;
  const seriesHeader = input.seriesHeader ?? DEFAULT_SERIES_HEADER;
  const valueHeader = input.valueHeader ?? DEFAULT_VALUE_HEADER;

  for (let i = 0; i < series.length; i++) {
    const data = series[i]?.data;
    if (!Array.isArray(data) || data.length !== categories.length) {
      throw new Error(
        `[excel-exporter] ECharts series "${seriesName(series[i], i)}" must have the same length as xAxis.data.`,
      );
    }
    for (const value of data) assertCategoryValue(value, `series ${i}`);
  }

  if (layout === "long") {
    const data: Record<string, unknown>[] = [];
    for (let i = 0; i < series.length; i++) {
      const name = seriesName(series[i], i);
      const values = series[i].data ?? [];
      for (let j = 0; j < categories.length; j++) {
        data.push({
          [seriesHeader]: name,
          [categoryHeader]: categories[j],
          [valueHeader]: values[j],
        });
      }
    }
    return {
      name: input.sheetName ?? "图表数据",
      columns: [
        { key: seriesHeader, header: seriesHeader },
        { key: categoryHeader, header: categoryHeader },
        { key: valueHeader, header: valueHeader },
      ],
      data,
    };
  }

  const columns: ColumnConfig[] = [
    { key: categoryHeader, header: categoryHeader },
    ...series.map((s, i) => ({
      key: `__series_${i}`,
      header: seriesName(s, i),
    })),
  ];
  const data = categories.map((category, rowIndex) => {
    const row: Record<string, unknown> = { [categoryHeader]: category };
    for (let i = 0; i < series.length; i++) {
      row[`__series_${i}`] = (series[i].data ?? [])[rowIndex];
    }
    return row;
  });

  return {
    name: input.sheetName ?? "图表数据",
    columns,
    data,
  };
}

function buildItemSheet(input: ResolvedEChartsSheetInput): SheetConfig {
  const series = input.series ?? [];
  const seriesHeader = input.seriesHeader ?? DEFAULT_SERIES_HEADER;
  const nameHeader = input.nameHeader ?? DEFAULT_NAME_HEADER;
  const valueHeader = input.valueHeader ?? DEFAULT_VALUE_HEADER;

  const allCoordinate = series.every((s) =>
    (s.data ?? []).every((item) => isCoordinatePair(item)),
  );
  const anyCoordinate = series.some((s) =>
    (s.data ?? []).some((item) => isCoordinatePair(item)),
  );

  if (anyCoordinate && !allCoordinate) {
    throw new Error(
      "[excel-exporter] mixing scatter coordinate data with name/value data is not supported by echartsToSheet.",
    );
  }

  if (allCoordinate) {
    const data: Record<string, unknown>[] = [];
    const xKey = "X";
    const yKey = "Y";
    for (let i = 0; i < series.length; i++) {
      const name = seriesName(series[i], i);
      for (const item of series[i].data ?? []) {
        if (!isCoordinatePair(item)) continue;
        data.push({ [seriesHeader]: name, [xKey]: item[0], [yKey]: item[1] });
      }
    }
    return {
      name: input.sheetName ?? "图表数据",
      columns: [
        { key: seriesHeader, header: seriesHeader },
        { key: xKey, header: "X" },
        { key: yKey, header: "Y" },
      ],
      data,
    };
  }

  const data: Record<string, unknown>[] = [];
  for (let i = 0; i < series.length; i++) {
    const name = seriesName(series[i], i);
    for (let j = 0; j < (series[i].data ?? []).length; j++) {
      const item = (series[i].data ?? [])[j];
      if (isCoordinatePair(item)) continue;
      if (item !== null && typeof item === "object") {
        data.push({
          [seriesHeader]: name,
          [nameHeader]: item.name ?? String(j + 1),
          [valueHeader]: item.value ?? null,
        });
      } else {
        data.push({
          [seriesHeader]: name,
          [nameHeader]: String(j + 1),
          [valueHeader]: item,
        });
      }
    }
  }

  return {
    name: input.sheetName ?? "图表数据",
    columns: [
      { key: seriesHeader, header: seriesHeader },
      { key: nameHeader, header: nameHeader },
      { key: valueHeader, header: valueHeader },
    ],
    data,
  };
}

/**
 * Convert a small structural ECharts option into a `SheetConfig`.
 *
 * Supported shapes:
 * - `xAxis.data` + multiple one-dimensional `series[].data` (wide/long).
 * - pie-like `series[].data: { name, value }[]` (long).
 * - scatter-like `series[].data: [x, y][]` (long).
 *
 * `dataset` mode and mixed coordinate/name-value series are rejected
 * explicitly rather than silently producing a misleading table.
 */
export function echartsToSheet(input: EChartsSheetInput): SheetConfig {
  if (input.option.dataset !== undefined) {
    throw new Error(
      "[excel-exporter] ECharts dataset mode is not supported by echartsToSheet. Flatten the data before calling it.",
    );
  }

  const series = input.option.series ?? [];
  if (series.length === 0) {
    throw new Error("[excel-exporter] ECharts option has no series to export.");
  }

  const xAxis = Array.isArray(input.option.xAxis)
    ? input.option.xAxis[0]
    : input.option.xAxis;
  const categories = xAxis?.data;

  if (categories && categories.length > 0) {
    return buildCategorySheet({ ...input, series }, categories);
  }

  return buildItemSheet({ ...input, series });
}

export function echartsExportToOptions(
  input: EChartsExportOptions,
): ExportOptions {
  const {
    option,
    sheetName,
    layout,
    categoryHeader,
    seriesHeader,
    nameHeader,
    valueHeader,
    filename,
    mode,
    onProgress,
    onPhase,
    download,
  } = input;

  return {
    filename,
    sheets: [
      echartsToSheet({
        option,
        sheetName,
        layout,
        categoryHeader,
        seriesHeader,
        nameHeader,
        valueHeader,
      }),
    ],
    ...(mode !== undefined && { mode }),
    ...(onProgress !== undefined && { onProgress }),
    ...(onPhase !== undefined && { onPhase }),
    ...(download !== undefined && { download }),
  };
}
