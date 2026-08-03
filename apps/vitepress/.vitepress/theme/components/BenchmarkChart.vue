<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";

const { lang } = useData();
const isEn = computed(() => lang.value === "en-US");

const data = [
  { rows: "10k", label: "10,000", main: 109, stream: 184 },
  { rows: "50k", label: "50,000", main: 618, stream: 824 },
  { rows: "100k", label: "100,000", main: 17541, stream: 1548 },
];

const W = 620;
const H = 280;
const padL = 42;
const padT = 16;
const padB = 36;
const plotH = H - padT - padB;
const maxLog = Math.log10(17541);
const groupW = (W - padL - 20) / data.length;
const barW = 26;

function barH(value: number): number {
  return (Math.log10(value) / maxLog) * plotH;
}

function groupX(i: number): number {
  return padL + groupW * i + groupW / 2;
}

function tickY(value: number): number {
  return padT + plotH - barH(value);
}

const ticks = [10, 100, 1000, 10000];
const caption = computed(() =>
  isEn.value
    ? "Source: package design doc, Node v22.22.2, modern-xlsx@1.2.0, independent-process first run (ms)."
    : "数据来源：包设计文档，Node v22.22.2、modern-xlsx@1.2.0，独立进程首次实测（毫秒）。",
);
</script>

<template>
  <div class="benchmark-chart">
    <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" role="img">
      <line
        v-for="t in ticks"
        :key="t"
        :x1="padL"
        :x2="W - 10"
        :y1="tickY(t)"
        :y2="tickY(t)"
        stroke="var(--vp-c-divider)"
        stroke-dasharray="3 3"
      />
      <text
        v-for="t in ticks"
        :key="`lbl-${t}`"
        :x="padL - 6"
        :y="tickY(t) + 4"
        text-anchor="end"
      >
        {{ t >= 1000 ? `${t / 1000}k` : t }}
      </text>

      <g v-for="(d, i) in data" :key="d.rows">
        <text :x="groupX(i)" :y="H - 14" text-anchor="middle">
          {{ d.rows }}
        </text>
        <rect
          :x="groupX(i) - barW - 4"
          :y="padT + plotH - barH(d.main)"
          :width="barW"
          :height="barH(d.main)"
          rx="4"
          fill="var(--vp-c-brand-1)"
          opacity="0.9"
        >
          <title>main: {{ d.main }}ms</title>
        </rect>
        <rect
          :x="groupX(i) + 4"
          :y="padT + plotH - barH(d.stream)"
          :width="barW"
          :height="barH(d.stream)"
          rx="4"
          fill="#8b5cf6"
          opacity="0.9"
        >
          <title>stream: {{ d.stream }}ms</title>
        </rect>
      </g>
    </svg>

    <p style="font-size: 0.82rem; color: var(--vp-c-text-2); margin: 0">
      <span
        style="
          display: inline-block;
          width: 10px;
          height: 10px;
          background: var(--vp-c-brand-1);
          border-radius: 2px;
        "
      />
      {{ isEn ? "Workbook / main path" : "Workbook / main 路径" }}
      <span
        style="
          display: inline-block;
          width: 10px;
          height: 10px;
          background: #8b5cf6;
          border-radius: 2px;
          margin-left: 14px;
        "
      />
      {{ isEn ? "Streaming path" : "Stream 路径" }}
      <br />
      {{ caption }}
    </p>
  </div>
</template>
