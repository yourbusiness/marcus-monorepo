<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";
import { useVisiblePackages } from "../composables/useVisiblePackages";

const { lang } = useData();
const isEn = computed(() => lang.value === "en-US");
const { visiblePackages } = useVisiblePackages();

const statusText = computed<Record<string, string>>(() => ({
  stable: isEn.value ? "Stable" : "稳定",
  beta: "Beta",
  alpha: "Alpha",
}));

function cardHref(dir: string): string {
  return withBase(`/${isEn.value ? "en/" : ""}packages/${dir}/`);
}
</script>

<template>
  <div class="package-grid">
    <a
      v-for="p in visiblePackages"
      :key="p.npmName"
      class="package-card"
      :href="cardHref(p.dir)"
    >
      <div class="package-card__head">
        <code class="package-card__name">{{ p.npmName }}</code>
        <span class="badge" :class="`badge--${p.status}`">
          {{ statusText[p.status] }}
        </span>
      </div>
      <div class="package-card__version">v{{ p.version }}</div>
      <p class="package-card__tagline">
        {{ isEn ? p.tagline.en : p.tagline.zh }}
      </p>
      <ul class="package-card__keywords">
        <li v-for="k in p.keywords" :key="k">{{ k }}</li>
      </ul>
    </a>
  </div>
</template>
