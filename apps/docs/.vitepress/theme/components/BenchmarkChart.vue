<script setup lang="ts">
import { computed } from "vue";
import type { BenchmarkBar, BenchmarkSeriesDef } from "../../registry";
import { useVisiblePackages } from "../composables/useVisiblePackages";

/**
 * When `dir` is set, only that package's benchmarks are shown (used on a
 * package's own performance page). Without it, all visible packages'
 * benchmarks are shown (home page). The data model is fully generic: each
 * benchmark declares its own series (legend entries + colors), so any number
 * of bars can be compared per group.
 */
const props = defineProps<{ dir?: string }>();

const { isEn, visiblePackages } = useVisiblePackages();

const scopedPackages = computed(() =>
  props.dir
    ? visiblePackages.value.filter((p) => p.dir === props.dir)
    : visiblePackages.value,
);

const W = 620;
const H = 280;
const padL = 48;
const padT = 16;
const padB = 36;
const plotH = H - padT - padB;
const gap = 8;

const FALLBACK_COLORS = [
  "var(--vp-c-brand-1)",
  "#8b5cf6",
  "#ec4899",
  "#22c55e",
  "#f59e0b",
];

function colorFor(defs: BenchmarkSeriesDef[], index: number): string {
  return defs[index]?.color ?? FALLBACK_COLORS[index] ?? FALLBACK_COLORS[0]!;
}

/** Generate log-scale reference ticks from the data max (not hardcoded). */
function computeTicks(maxVal: number): number[] {
  if (maxVal <= 0) return [];
  const ceil = Math.ceil(Math.log10(maxVal));
  const ticks: number[] = [];
  for (let p = 0; p <= ceil; p++) {
    const v = 10 ** p;
    if (v <= maxVal * 1.5) ticks.push(v);
  }
  return ticks;
}

interface ComputedSeries {
  key: string;
  source: string;
  legend: { label: string; color: string }[];
  tickYs: { v: number; y: number }[];
  bars: {
    x: number;
    label: string;
    segments: {
      x: number;
      w: number;
      y: number;
      h: number;
      color: string;
      value: number;
      seriesKey: string;
    }[];
  }[];
}

const series = computed<ComputedSeries[]>(() =>
  scopedPackages.value.flatMap((p, pi) =>
    (p.benchmarks ?? []).map((b, bi) => {
      const data = b.data;
      const defs = b.series;
      const allValues = data.flatMap((d) => Object.values(d.values));
      const maxVal = Math.max(...allValues, 1);
      // Guard: maxLog <= 0 means all values are 0 or 1 -- clamp to 1 so
      // barH never produces Infinity/NaN.
      const maxLog = Math.max(Math.log10(maxVal), 1);
      const barH = (v: number) =>
        v > 0 ? (Math.log10(v) / maxLog) * plotH : 0;

      const tickValues = computeTicks(maxVal);
      const groupW = (W - padL - 20) / data.length;
      const groupX = (i: number) => padL + groupW * i + groupW / 2;
      const seriesCount = defs.length;
      const barW = Math.min(26, (groupW - gap) / seriesCount - gap);

      return {
        key: `${p.dir}-${pi}-${bi}`,
        source: isEn.value ? b.source.en : b.source.zh,
        legend: defs.map((d, i) => ({
          label: isEn.value ? d.label.en : d.label.zh,
          color: colorFor(defs, i),
        })),
        tickYs: tickValues.map((t) => ({
          v: t,
          y: padT + plotH - barH(t),
        })),
        bars: data.map((d: BenchmarkBar, i) => {
          const cx = groupX(i);
          const totalSpan = seriesCount * barW + (seriesCount - 1) * gap;
          const startX = cx - totalSpan / 2;
          return {
            x: cx,
            label: d.label,
            segments: defs.map((def, si) => {
              const value = d.values[def.key] ?? 0;
              return {
                x: startX + si * (barW + gap),
                w: barW,
                y: padT + plotH - barH(value),
                h: barH(value),
                color: colorFor(defs, si),
                value,
                seriesKey: def.key,
              };
            }),
          };
        }),
      };
    }),
  ),
);
</script>

<template>
  <div class="benchmark-chart">
    <div v-for="s in series" :key="s.key" class="benchmark-chart__block">
      <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" role="img">
        <line
          v-for="t in s.tickYs"
          :key="t.v"
          :x1="padL"
          :x2="W - 10"
          :y1="t.y"
          :y2="t.y"
          stroke="var(--vp-c-divider)"
          stroke-dasharray="3 3"
        />
        <text
          v-for="t in s.tickYs"
          :key="`lbl-${t.v}`"
          :x="padL - 6"
          :y="t.y + 4"
          text-anchor="end"
        >
          {{ t.v >= 1000 ? `${t.v / 1000}k` : t.v }}
        </text>

        <g v-for="(bar, i) in s.bars" :key="`g-${i}`">
          <text :x="bar.x" :y="H - 14" text-anchor="middle">
            {{ bar.label }}
          </text>
          <rect
            v-for="(seg, si) in bar.segments"
            :key="`b-${i}-${si}`"
            :x="seg.x"
            :y="seg.y"
            :width="seg.w"
            :height="seg.h"
            rx="4"
            :fill="seg.color"
            opacity="0.9"
          >
            <title>{{ seg.seriesKey }}: {{ seg.value }}ms</title>
          </rect>
        </g>
      </svg>

      <p class="benchmark-chart__caption">
        <span
          v-for="(leg, li) in s.legend"
          :key="`leg-${li}`"
          class="benchmark-chart__legend-item"
        >
          <span
            class="benchmark-chart__swatch"
            :style="{ background: leg.color }"
          />
          {{ leg.label }}
        </span>
        <br />
        {{ s.source }}
      </p>
    </div>
  </div>
</template>
