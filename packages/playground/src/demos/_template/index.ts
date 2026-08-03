/**
 * 新增包联调 demo 模板。
 *
 * 接入步骤：
 *   1. 复制此目录 → src/demos/<your-pkg>/
 *   2. 在 playground package.json 的 dependencies 里声明 "workspace:*"
 *   3. 取消下方注释，填写 name/label/description，并在 load() 里动态 import 实现
 *   4. 启动/重启 dev server —— main.tsx 的 import.meta.glob 是启动时静态展开的，
 *      运行中新增的 demo 目录不会被发现，需要重启 dev server 才会识别
 *
 * 重要：index.ts 只放元信息（name/label/description/load），不要在这里静态
 * import 重依赖。真正的 UI 实现放在单独的 *.demo.tsx 文件里，load() 中用动态
 * import 按需加载，这样首页只加载轻量元信息，进入该 demo 时才加载实现及其依赖。
 *
 * 注意：vite.config.ts 会自动为所有 @marcusok/* 包的主入口生成源码别名，
 * 所以 import "@marcusok/your-pkg" 直接走源码，无需额外配置。
 * 前提是包遵循约定提供 src/index.ts（或 src/index.tsx），否则会有启动警告并走 dist。
 * 接入完整性由测试强制校验：pnpm --filter playground test。
 *
 * 如果 demo 有异步操作（定时器、fetch、WebSocket 等），在 React 组件里用
 * useEffect 的 cleanup 清理资源，避免导航离开后残留。参考 excel-exporter demo。
 *
 * 如果你的包用到 Worker / WASM 等运行时资源（不是普通 JS import），
 * 需要通过 Vite 的 ?url 后缀导入资源路径，然后传给包的配置函数：
 *
 *   import workerUrl from "@marcusok/your-pkg/dist/your.worker.js?url";
 *   import wasmUrl from "your-wasm-dep/your.wasm?url";
 *   yourPkg.configure({ workerUrl, wasmUrl });
 *
 * 第三方包如果 "exports" 没暴露你需要的子路径（如 wasm/），
 * 在 vite.config.ts 的 externalOverrides 数组里加一条即可。
 */

// import { registerDemo } from "../../common/registry.js";
//
// registerDemo({
//   name: "your-pkg",
//   label: "your-pkg · 说明",
//   description: "一句话说明这个 demo 演示什么。",
//   async load() {
//     return import("./your-pkg.demo.js");
//   },
// });
