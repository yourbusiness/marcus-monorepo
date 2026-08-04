import type { ComponentType } from "react";

export interface DemoEntry {
  name: string;
  label: string;
  /** 一句话说明这个 demo 演示什么，展示在首页卡片与详情页头部。 */
  description?: string;
  /**
   * Lazy-load the demo implementation. The entry module (index.ts) must
   * stay lightweight — metadata only — so the home page never pulls heavy
   * dependencies. Put the actual UI in a separate *.demo.tsx file and
   * dynamic-import it here; the returned module's default export is a React
   * component rendered inside a Suspense boundary.
   */
  load: () => Promise<{ default: ComponentType }>;
}

// Map keyed by name so HMR re-execution of a demo module (which re-calls
// registerDemo) overwrites instead of appending — no duplicate nav entries.
const demos = new Map<string, DemoEntry>();

export function registerDemo(entry: DemoEntry): void {
  const existing = demos.get(entry.name);
  if (existing) {
    console.warn(
      `[play] demo "${entry.name}" 重复注册（旧 label: "${existing.label}"，新 label: "${entry.label}"）。请检查 src/demos/ 下是否有重名目录。`,
    );
  }
  demos.set(entry.name, entry);
}

export function getDemos(): readonly DemoEntry[] {
  return [...demos.values()];
}
