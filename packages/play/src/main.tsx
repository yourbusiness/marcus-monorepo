import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "./app/play.css";
import { AppShell } from "./app/App.js";

// 与旧版 main.ts 相同的发现机制：eager glob 执行每个 demo 入口的注册逻辑。
// 首页只持有轻量元信息（name/label/description/load），实现按需动态 import。
// 新增包只需在 src/demos/<pkg>/index.ts 里调用 registerDemo()，无需手动改这里。
import.meta.glob(["./demos/*/index.ts", "!./demos/_*/**"], { eager: true });

const rootElement = document.getElementById("app")!;

createRoot(rootElement).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
