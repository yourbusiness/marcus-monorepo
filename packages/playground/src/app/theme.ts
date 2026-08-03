import { theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";

export type PlaygroundThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "playground.theme";

export function loadThemeMode(): PlaygroundThemeMode {
  return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

/**
 * 全局主题：主色、圆角 + 亮/暗算法。
 * 侧边栏固定为深色（品牌区），内容区跟随亮/暗切换。
 */
export function createThemeConfig(mode: PlaygroundThemeMode): ThemeConfig {
  return {
    algorithm:
      mode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: "#6366f1",
      borderRadius: 10,
    },
    components: {
      Layout: {
        siderBg: "#0f172a",
      },
      Menu: {
        darkItemBg: "transparent",
        darkItemSelectedBg: "rgba(99, 102, 241, 0.18)",
      },
    },
  };
}
