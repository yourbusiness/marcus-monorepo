import { computed } from "vue";
import { useData } from "vitepress";
import { packages } from "../../registry";

/**
 * Locale-aware package list shared by the home components.
 *
 * Visibility is driven by the `en` flag declared in the registry
 * (validated against the filesystem at build time), so there is a single
 * source of truth and no themeConfig snapshot to keep in sync.
 */
export function useVisiblePackages() {
  const { lang } = useData();
  const isEn = computed(() => lang.value === "en-US");
  const visiblePackages = computed(() =>
    isEn.value ? packages.filter((p) => p.en) : packages,
  );
  return { isEn, visiblePackages };
}
