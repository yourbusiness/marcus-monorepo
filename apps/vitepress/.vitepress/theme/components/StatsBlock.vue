<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useData } from "vitepress";
import { getAllHomeStats } from "../../registry";

const { lang } = useData();
const isEn = computed(() => lang.value === "en-US");

// Stats come from the registry (package count + per-package homeStats),
// so adding a package automatically extends the block without code changes.
const targets = getAllHomeStats();

const display = ref<Record<string, string>>({});
const rootRef = ref<HTMLElement | null>(null);
let raf = 0;
let io: IntersectionObserver | null = null;

onMounted(() => {
  const el = rootRef.value;
  if (!el || typeof IntersectionObserver === "undefined") {
    for (const s of targets) display.value[s.key] = s.value.toFixed(s.decimals);
    return;
  }
  io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io?.disconnect();
      const t0 = performance.now();
      const dur = 900;
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - k, 3);
        const next: Record<string, string> = {};
        for (const s of targets) {
          next[s.key] = (s.value * eased).toFixed(s.decimals);
        }
        display.value = next;
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    { threshold: 0.2 },
  );
  io.observe(el);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  io?.disconnect();
});
</script>

<template>
  <div ref="rootRef" class="stats-grid">
    <div v-for="s in targets" :key="s.key" class="stat-card">
      <div class="stat-card__value">
        {{ display[s.key] ?? "0" }}<span v-if="s.suffix">{{ s.suffix }}</span>
      </div>
      <div class="stat-card__label">{{ isEn ? s.en : s.zh }}</div>
    </div>
  </div>
</template>
