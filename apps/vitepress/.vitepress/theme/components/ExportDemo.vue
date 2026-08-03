<script setup lang="ts">
import { computed, ref } from "vue";
import { useData } from "vitepress";
import type { ColumnConfig } from "@marcusok/excel-exporter";
import { getDataset, mockDatasets } from "../../../src/mock/datasets";

const { lang } = useData();
const isEn = computed(() => lang.value === "en-US");

const modes = ["auto", "main", "worker", "stream"] as const;
const modeLabels = computed<Record<string, string>>(() => ({
  auto: isEn.value ? "auto (recommended)" : "auto（自动，推荐）",
  main: isEn.value ? "main" : "main（主线程）",
  worker: isEn.value ? "worker" : "worker（多线程）",
  stream: isEn.value ? "stream" : "stream（流式）",
}));

const rowCounts = [1000, 10000, 50000, 100000];

const selectedMode = ref<(typeof modes)[number]>("auto");
const datasetKey = ref("sales");
const rowsCount = ref(10000);
const exporting = ref(false);
const progress = ref(0);
const phases = ref<{ phase: string; ms: number }[]>([]);
const result = ref<{
  success?: boolean;
  engine?: string;
  mode?: string;
  duration?: number;
  rowCount?: number;
} | null>(null);
const error = ref<string | null>(null);

const statusText = computed(() =>
  isEn.value
    ? {
        run: "Export Excel",
        running: "Exporting…",
        progress: "Progress",
        phases: "Phase timings",
        result: "Result",
        hint: "auto picks the best path in-browser. Try main with 100,000 rows to see why.",
        dataset: "Dataset",
        mode: "Mode",
        rows: "Rows",
        engine: "engine",
        ok: "OK",
        fail: "failed",
      }
    : {
        run: "导出 Excel",
        running: "导出中…",
        progress: "进度",
        phases: "阶段耗时",
        result: "结果",
        hint: "auto 会在浏览器内自动选择最优路径；可以试试 main + 10 万行，看看为什么需要 auto。",
        dataset: "数据集",
        mode: "模式",
        rows: "数据量",
        engine: "引擎",
        ok: "成功",
        fail: "失败",
      },
);

async function run() {
  exporting.value = true;
  progress.value = 0;
  phases.value = [];
  result.value = null;
  error.value = null;
  try {
    const { configureWasm, exportExcel, StylePresets } =
      await import("@marcusok/excel-exporter");
    configureWasm({
      wasmUrl: `${import.meta.env.BASE_URL}assets/modern-xlsx.wasm`,
      workerUrl: `${import.meta.env.BASE_URL}assets/export.worker.js`,
    });

    const ds = getDataset(datasetKey.value);
    const data = ds.rows(rowsCount.value);
    const columns: ColumnConfig[] = ds.columns.map((c) => {
      const col: ColumnConfig = {
        key: c.key,
        header: isEn.value ? c.header.en : c.header.zh,
      };
      if (c.width) col.width = c.width;
      if (c.hint?.kind === "style" && c.hint.preset) {
        col.style = StylePresets[c.hint.preset as keyof typeof StylePresets];
      }
      if (c.hint?.kind === "format" && c.hint.spec) col.format = c.hint.spec;
      return col;
    });

    const res = await exportExcel({
      filename: `${ds.fileName}-${rowsCount.value}`,
      sheets: [
        {
          name: ds.sheetName[isEn.value ? "en" : "zh"],
          columns,
          data,
          freezeRows: 1,
          autoFilter: true,
        },
      ],
      mode: selectedMode.value,
      onProgress: (p) => (progress.value = p),
      onPhase: (phase, ms) => phases.value.push({ phase, ms }),
    });
    result.value = res;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="demo-panel">
    <div class="demo-panel__controls">
      <label>
        {{ statusText.mode }}
        <select v-model="selectedMode" :disabled="exporting">
          <option v-for="m in modes" :key="m" :value="m">
            {{ modeLabels[m] }}
          </option>
        </select>
      </label>
      <label>
        {{ statusText.dataset }}
        <select v-model="datasetKey" :disabled="exporting">
          <option v-for="d in mockDatasets" :key="d.key" :value="d.key">
            {{ d.key }}
          </option>
        </select>
      </label>
      <label>
        {{ statusText.rows }}
        <select v-model.number="rowsCount" :disabled="exporting">
          <option v-for="n in rowCounts" :key="n" :value="n">
            {{ n.toLocaleString() }}
          </option>
        </select>
      </label>
      <button type="button" :disabled="exporting" @click="run">
        {{ exporting ? statusText.running : statusText.run }}
      </button>
    </div>

    <div class="progress">
      <div class="progress__bar" :style="{ width: `${progress * 100}%` }" />
    </div>

    <div v-if="result" class="demo-panel__result">
      <strong>{{ statusText.result }}：</strong>
      <code>{{ result.success ? statusText.ok : statusText.fail }}</code>
      ·
      <code>{{ statusText.engine }}: {{ result.engine }}</code>
      ·
      <code>mode: {{ result.mode }}</code>
      ·
      <code>{{ result.duration?.toFixed(1) }}ms</code>
      ·
      <code>{{ result.rowCount?.toLocaleString() }} rows</code>
    </div>

    <div v-if="phases.length" class="demo-panel__result">
      <strong>{{ statusText.phases }}：</strong>
      <code v-for="(p, i) in phases" :key="i">
        {{ p.phase }} {{ p.ms.toFixed(1) }}ms{{
          i < phases.length - 1 ? " → " : ""
        }}
      </code>
    </div>

    <div v-if="error" class="demo-panel__error">{{ error }}</div>
    <p
      v-if="!result && !error"
      style="font-size: 0.85rem; color: var(--vp-c-text-2); margin-top: 10px"
    >
      {{ statusText.hint }}
    </p>
  </div>
</template>
