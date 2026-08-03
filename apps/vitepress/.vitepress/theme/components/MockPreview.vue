<script setup lang="ts">
import { computed, ref } from "vue";
import { useData } from "vitepress";
import { getDataset, previewRows } from "../../../src/mock/datasets";

const props = withDefaults(
  defineProps<{ dataset: string; rows?: number; seed?: number }>(),
  { rows: 5, seed: 42 },
);

const { lang } = useData();
const isEn = computed(() => lang.value === "en-US");
const seedRef = ref(props.seed);
const ds = computed(() => getDataset(props.dataset));
const items = computed(() =>
  previewRows(props.dataset, props.rows, seedRef.value),
);

function reshuffle() {
  seedRef.value = Math.floor(Math.random() * 2 ** 31);
}
</script>

<template>
  <div class="mock-preview">
    <div class="mock-preview__toolbar">
      <span>Mock · {{ items.length }} rows · seed {{ seedRef }}</span>
      <button type="button" @click="reshuffle">
        {{ isEn ? "Reshuffle" : "换一批" }}
      </button>
    </div>
    <table>
      <thead>
        <tr>
          <th v-for="c in ds.columns" :key="c.key">
            {{ isEn ? c.header.en : c.header.zh }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in items" :key="i">
          <td v-for="c in ds.columns" :key="c.key">
            {{ String(row[c.key] ?? "") }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
