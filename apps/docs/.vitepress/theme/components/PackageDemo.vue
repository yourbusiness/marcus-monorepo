<script setup lang="ts">
import { computed } from "vue";
import { packages } from "../../registry";

/**
 * Renders the live-demo component declared by a package's registry entry
 * (`demo` field). The component must be globally registered (theme/index.ts
 * auto-registers every SFC in components/). If no demo is declared, shows a
 * neutral placeholder instead of crashing.
 *
 * Usage in markdown:
 *   <PackageDemo dir="excel-exporter" />
 */
const props = defineProps<{ dir: string }>();

const demoComponent = computed(() => {
  const pkg = packages.find((p) => p.dir === props.dir);
  return pkg?.demo;
});
</script>

<template>
  <component v-if="demoComponent" :is="demoComponent" />
  <div v-else class="package-demo-missing">
    <p>No live demo registered for package "{{ dir }}".</p>
    <p>
      Add a <code>demo: "ComponentName"</code> field to this package's entry in
      <code>.vitepress/registry.ts</code>, then place the component in
      <code>theme/components/</code>.
    </p>
  </div>
</template>

<style scoped>
.package-demo-missing {
  padding: 20px;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 12px;
  text-align: center;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}

.package-demo-missing p {
  margin: 4px 0;
}

.package-demo-missing code {
  color: var(--vp-c-brand-1);
}
</style>
