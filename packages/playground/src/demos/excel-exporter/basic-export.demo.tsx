import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  InputNumber,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  type TableProps,
} from "antd";
import { ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import {
  configureWasm,
  exportExcel,
  getWasmLoader,
  type ColumnConfig,
  type ExportMode,
  type ExportPhase,
  type ExportResult,
} from "@marcusok/excel-exporter";
import workerUrl from "@marcusok/excel-exporter/dist/export.worker.js?url";
import wasmUrl from "modern-xlsx/wasm/modern_xlsx_wasm_bg.wasm?url";
import {
  createDataset,
  DATASET_PRESETS,
  DEFAULT_ROWS,
} from "../../mock/rows.js";
import {
  formatByteRate,
  formatBytes,
  formatClockTime,
  formatDuration,
  formatThroughput,
} from "./metrics.js";

// 模块加载时配置 WASM + worker URL，保证 worker/stream 模式可用。
// 不配置 workerUrl 时 exportExcel 会静默降级到 SheetJS fallback。
configureWasm({ workerUrl, wasmUrl });

const HISTORY_LIMIT = 10;

const MODES: readonly ExportMode[] = ["auto", "main", "worker", "stream"];
const MODE_LABEL: Record<ExportMode, string> = {
  auto: "auto · 自动",
  main: "main · 主线程",
  worker: "worker · Worker",
  stream: "stream · 流式",
};
const PHASE_LABEL: Record<ExportPhase, string> = {
  init: "初始化 WASM",
  build: "构建工作簿",
  download: "触发下载",
};

type RunStatus = "ok" | "degraded" | "error";
const STATUS_LABEL: Record<RunStatus, string> = {
  ok: "成功",
  degraded: "降级",
  error: "失败",
};

/** 与 mock 字段一一对应的列配置；数字/日期列用 FormatSpec 验证 format 能力。 */
const COLUMNS: ColumnConfig[] = [
  { key: "id", header: "ID", width: 10 },
  { key: "name", header: "姓名", width: 16 },
  { key: "city", header: "城市", width: 12 },
  {
    key: "amount",
    header: "金额",
    width: 14,
    format: { type: "number", decimals: 2, thousands: true },
  },
  { key: "orderDate", header: "下单日期", width: 14, format: { type: "date" } },
  { key: "status", header: "状态", width: 12 },
];

interface RunRecord {
  id: number;
  at: string; // HH:mm:ss
  requestedMode: ExportMode;
  actualMode: string;
  engine: string;
  rows: number;
  cols: number;
  durationMs: number | null; // 库内测量：init + build
  wallMs: number | null; // playground 测量：点击 -> exportExcel resolve
  sizeBytes: number | null;
  mime: string | null;
  status: RunStatus;
  error: string | null;
  phases: { phase: ExportPhase; durationMs: number }[];
}

// 模块级历史：demo 切换后仍保留本次会话内的导出记录（刷新后重置）。
const history: RunRecord[] = [];
let historySeq = 0;

export default function BasicExportDemo() {
  const { message } = AntdApp.useApp();
  const [rows, setRows] = useState<number>(DEFAULT_ROWS);
  const [mode, setMode] = useState<ExportMode>("auto");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    percent: number;
    phase: string;
    elapsedMs: number;
  } | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>(() => [...history]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      // 卸载（导航离开/路由切换）后，异步导出不再触碰组件状态。
      cancelledRef.current = true;
    };
  }, []);

  const presetOptions = useMemo(
    () =>
      DATASET_PRESETS.map((n) => ({
        label: n >= 1000 ? `${n / 1000}k` : String(n),
        value: n,
      })),
    [],
  );

  const pushRecord = (input: {
    result: ExportResult | null;
    requestedMode: ExportMode;
    rows: number;
    cols: number;
    wallMs: number;
    phases: RunRecord["phases"];
    thrown?: Error;
  }): void => {
    const {
      result,
      requestedMode,
      rows: totalRows,
      cols,
      wallMs,
      phases,
      thrown,
    } = input;
    const success = result?.success === true;
    const blob = result?.blob ?? null;
    const engine = result?.engine ?? "unknown";
    const actualMode = result?.mode ?? "unknown";
    const durationMs = result?.duration ?? null;
    const sizeBytes = blob?.size ?? null;
    const error = thrown
      ? thrown.message
      : success
        ? null
        : (result?.error?.message ?? "导出失败");
    const status: RunStatus = !success
      ? "error"
      : engine === "sheetjs"
        ? "degraded"
        : "ok";

    const record: RunRecord = {
      id: ++historySeq,
      at: formatClockTime(new Date()),
      requestedMode,
      actualMode,
      engine,
      rows: totalRows,
      cols,
      durationMs,
      wallMs,
      sizeBytes,
      mime: blob?.type ?? null,
      status,
      error,
      phases,
    };
    history.unshift(record);
    if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
    setRun(record);
    setRuns([...history]);
  };

  const runExport = async (): Promise<void> => {
    if (running) return;
    const totalRows = Math.max(
      1,
      Math.min(200_000, Number.isFinite(rows) ? rows : DEFAULT_ROWS),
    );
    const requestedMode = mode;
    const cols = COLUMNS.length;
    // 数据生成不计入导出耗时，保证各模式对比的是引擎本身的性能。
    const dataset = createDataset(totalRows);
    const t0 = performance.now();
    const phases: RunRecord["phases"] = [];
    cancelledRef.current = false;
    setRunning(true);
    setRun(null);
    setProgress({ percent: 0, phase: "初始化 WASM…", elapsedMs: 0 });

    const tick = (): void =>
      setProgress((prev) =>
        prev ? { ...prev, elapsedMs: performance.now() - t0 } : prev,
      );
    const elapsedTimer = window.setInterval(tick, 100);
    tick();

    try {
      const result = await exportExcel({
        sheets: [{ name: "示例表", columns: COLUMNS, data: dataset }],
        filename: "playground-demo.xlsx",
        mode: requestedMode,
        onProgress: (p) => {
          if (cancelledRef.current) return;
          const percent = Math.round(p * 100);
          setProgress((prev) => ({
            percent,
            phase:
              p >= 1
                ? "触发下载…"
                : percent > 0
                  ? `导出中 ${percent}%`
                  : (prev?.phase ?? "初始化 WASM…"),
            elapsedMs: performance.now() - t0,
          }));
        },
        onPhase: (phase, durationMs) => {
          if (cancelledRef.current) return;
          phases.push({ phase, durationMs });
          setProgress((prev) => ({
            percent: prev?.percent ?? 0,
            phase: `${PHASE_LABEL[phase]}…`,
            elapsedMs: performance.now() - t0,
          }));
        },
      });
      if (cancelledRef.current) return;
      pushRecord({
        result,
        requestedMode,
        rows: totalRows,
        cols,
        wallMs: performance.now() - t0,
        phases,
      });
    } catch (err) {
      if (cancelledRef.current) return;
      pushRecord({
        result: null,
        requestedMode,
        rows: totalRows,
        cols,
        wallMs: performance.now() - t0,
        phases,
        thrown: err as Error,
      });
    } finally {
      window.clearInterval(elapsedTimer);
      if (!cancelledRef.current) {
        setRunning(false);
        setProgress(null);
      }
    }
  };

  const resetWasm = (): void => {
    // 同样的 wasmUrl 会复用已加载实例（wasm-loader.updateOptions 只在 URL
    // 变化时重置），因此提示文案说明实际情况而不是承诺一次不会发生的重初始化。
    configureWasm({ workerUrl, wasmUrl });
    message.info(
      getWasmLoader().isReady
        ? "WASM 配置已重新应用；URL 未变化，已加载的 WASM 实例继续复用。"
        : "WASM 配置已重新应用，下次导出时初始化。",
    );
  };

  const columns: TableProps<RunRecord>["columns"] = [
    { title: "时间", dataIndex: "at", width: 90 },
    {
      title: "请求 → 实际模式",
      render: (_value, r) => `${MODE_LABEL[r.requestedMode]} → ${r.actualMode}`,
    },
    {
      title: "引擎",
      render: (_value, r) =>
        r.engine === "sheetjs" ? <Tag color="orange">sheetjs</Tag> : r.engine,
    },
    {
      title: "行数",
      align: "right",
      render: (_value, r) => r.rows.toLocaleString(),
    },
    {
      title: "导出耗时",
      align: "right",
      render: (_value, r) => formatDuration(r.durationMs),
    },
    {
      title: "文件大小",
      align: "right",
      render: (_value, r) => formatBytes(r.sizeBytes),
    },
    {
      title: "行吞吐",
      align: "right",
      render: (_value, r) => formatThroughput(r.rows, r.durationMs),
    },
    {
      title: "结果",
      render: (_value, r) => <StatusTag status={r.status} />,
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        配置行数与模式后导出，展示文件大小、耗时、吞吐等指标；多次导出会记录在下方
        历史中对比（行数 ≥ 500 走 Worker，≥ 50,000 走流式）。
      </Typography.Paragraph>

      <Card>
        <Flex wrap gap={24} align="flex-end">
          <Space orientation="vertical" size={6}>
            <Typography.Text type="secondary">数据量</Typography.Text>
            <Space wrap>
              <Segmented<number>
                options={presetOptions}
                value={rows}
                onChange={setRows}
              />
              <Space.Compact>
                <Button disabled>自定义</Button>
                <InputNumber
                  min={1}
                  max={200_000}
                  value={rows}
                  onChange={(value) => setRows(value ?? DEFAULT_ROWS)}
                  style={{ width: 150 }}
                />
              </Space.Compact>
            </Space>
          </Space>
          <Space orientation="vertical" size={6}>
            <Typography.Text type="secondary">导出模式</Typography.Text>
            <Select<ExportMode>
              style={{ minWidth: 180 }}
              value={mode}
              onChange={setMode}
              options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
            />
          </Space>
          <Space>
            <Button
              type="primary"
              size="large"
              icon={<ThunderboltOutlined />}
              loading={running}
              onClick={() => void runExport()}
            >
              导出 Excel
            </Button>
            <Button size="large" icon={<ReloadOutlined />} onClick={resetWasm}>
              重置 WASM
            </Button>
          </Space>
        </Flex>
      </Card>

      {progress && (
        <Card size="small">
          <Flex justify="space-between" style={{ marginBottom: 8 }}>
            <Typography.Text>{progress.phase}</Typography.Text>
            <Typography.Text type="secondary">
              {formatDuration(progress.elapsedMs)}
            </Typography.Text>
          </Flex>
          <Progress percent={progress.percent} status="active" />
        </Card>
      )}

      {run && (
        <Card title="导出结果">
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <Statistic title="文件大小" value={formatBytes(run.sizeBytes)} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic
                title="导出耗时"
                value={formatDuration(run.durationMs)}
              />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="链路耗时" value={formatDuration(run.wallMs)} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic
                title="行吞吐"
                value={formatThroughput(run.rows, run.durationMs)}
              />
            </Col>
          </Row>
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2 }}
            style={{ marginTop: 16 }}
            items={[
              {
                key: "engine",
                label: "引擎",
                children:
                  run.engine === "sheetjs" ? (
                    <Tag color="orange">SheetJS（降级）</Tag>
                  ) : (
                    run.engine
                  ),
              },
              {
                key: "mode",
                label: "请求模式 → 实际模式",
                children: `${MODE_LABEL[run.requestedMode]} → ${run.actualMode}`,
              },
              {
                key: "scale",
                label: "数据规模",
                children: `${run.rows.toLocaleString()} 行 × ${run.cols} 列 = ${(run.rows * run.cols).toLocaleString()} 单元格`,
              },
              {
                key: "byterate",
                label: "体积吞吐",
                children: formatByteRate(run.sizeBytes, run.durationMs),
              },
              {
                key: "filename",
                label: "文件名",
                children: "playground-demo.xlsx",
              },
              { key: "mime", label: "MIME 类型", children: run.mime ?? "-" },
              {
                key: "wasm",
                label: "WASM 支持",
                children: getWasmLoader().supported
                  ? "可用"
                  : "不可用（走 SheetJS 降级）",
              },
              {
                key: "status",
                label: "结果",
                children: <StatusTag status={run.status} />,
              },
            ]}
          />
          {run.error && (
            <Alert
              style={{ marginTop: 12 }}
              type={run.status === "degraded" ? "warning" : "error"}
              showIcon
              message={
                run.status === "degraded"
                  ? `已降级：${run.error}`
                  : `导出失败：${run.error}`
              }
            />
          )}
          {run.phases.length > 0 && (
            <Descriptions
              title="阶段耗时（onPhase）"
              size="small"
              column={{ xs: 1, sm: 3 }}
              style={{ marginTop: 16 }}
              items={run.phases.map((p) => ({
                key: p.phase,
                label: PHASE_LABEL[p.phase],
                children: formatDuration(p.durationMs),
              }))}
            />
          )}
        </Card>
      )}

      {runs.length > 0 && (
        <Card title={`历史对比（保留最近 ${HISTORY_LIMIT} 次）`}>
          <Table<RunRecord>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={runs}
            pagination={false}
            scroll={{ x: 960 }}
          />
        </Card>
      )}
    </Space>
  );
}

function StatusTag({ status }: { status: RunStatus }) {
  const color =
    status === "ok" ? "success" : status === "degraded" ? "warning" : "error";
  return <Tag color={color}>{STATUS_LABEL[status]}</Tag>;
}
