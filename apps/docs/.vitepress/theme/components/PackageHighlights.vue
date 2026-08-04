<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";
import { useVisiblePackages } from "../composables/useVisiblePackages";

const { lang } = useData();
const isEn = computed(() => lang.value === "en-US");
const { visiblePackages } = useVisiblePackages();

// Every package contributes its own `highlights` from the registry, so the
// home page grows automatically when a new package is added.
const highlights = computed(() =>
  visiblePackages.value.flatMap((p) =>
    (p.highlights ?? []).map((h) => ({
      npmName: p.npmName,
      icon: h.icon,
      title: isEn.value ? h.title.en : h.title.zh,
      details: isEn.value ? h.details.en : h.details.zh,
    })),
  ),
);
</script>

<template>
  <div class="highlight-grid">
    <div
      v-for="(h, i) in highlights"
      :key="`${h.npmName}-${i}`"
      class="highlight-card"
    >
      <div class="highlight-card__icon">{{ h.icon }}</div>
      <h3 class="highlight-card__title">{{ h.title }}</h3>
      <p class="highlight-card__details">{{ h.details }}</p>
    </div>
  </div>
</template>
