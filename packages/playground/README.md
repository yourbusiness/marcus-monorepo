# playground

Monorepo 本地联调沙箱，基于 **React 19 + TypeScript + Vite 8 + Ant Design 6**
搭建。每个被测包在 `src/demos/<pkg>/` 下有一个独立目录，demo 实现按需加载，
首页只加载轻量元信息。

## 技术栈

| 依赖                 | 版本说明                                                |
| -------------------- | ------------------------------------------------------- |
| react / react-dom    | 19.2.x                                                  |
| antd                 | 6.5.x（原生支持 React 19）                              |
| vite                 | 8.2.x（Rolldown 内核）                                  |
| @vitejs/plugin-react | 6.x                                                     |
| vitest               | 4.1.x（peer 支持 vite 8）                               |
| typescript           | 5.9.x（typescript-eslint 8.65 约束 < 6.1，暂不升 TS 7） |

## 用法

```bash
# 推荐：从仓库根目录启动（turbo 会先 build 上游包，再并行启动上游 dev 与 playground）
pnpm dev

# 只起 playground：先 build 上游包，再启动 vite（不启动 tsup --watch）
pnpm dev:playground
```

两种方式的区别：

- `pnpm dev`：等价于 `turbo run dev`。turbo 会先执行上游的 `build`（把
  `excel-exporter` 等包构建出 `dist/`），再对所有定义了 `dev` script 的包并行执行
  `dev`（目前是 excel-exporter 的 `tsup --watch` 和 playground 的 `vite`）。
- `pnpm dev:playground`：等价于 `turbo run dev --filter=@marcusok/playground`，
  同样会先 build 上游，再只启动 playground 的 vite。

Vite dev server 固定监听 `http://localhost:5173`（`strictPort`：端口被占用时直接
报错，而不是静默换到 5174/5175；确需其它端口用 `vite --port <n>`）。

质量门禁：

```bash
pnpm --filter playground typecheck
pnpm --filter playground lint
pnpm --filter playground test
```

> playground 是 `private` 包，不参与 changeset 发布；`build`（`vite build`）仅作为
> 产物可构建性校验（CI 与根目录 `pnpm build` 会执行，产出 `dist/` 不入库）。

## 布局与交互

- 暗色可折叠侧边栏（品牌区 + demo 列表）+ 顶部栏（当前 demo 名 + 亮/暗主题切换）。
- 首页用卡片网格展示 demo（label + description，悬停反馈）。
- 主题由 `src/app/theme.ts` 统一配置：主色、圆角、亮/暗算法，选择存 localStorage。
- 路由为轻量 hash 路由（`#/excel-exporter`），刷新不丢当前 demo、URL 可分享；
  结构只有「概览 / 详情」两层，不需要引入 react-router。

## Mock 数据

`src/mock/rows.ts` 提供确定性 mock 生成器（mulberry32 伪随机，固定 seed）：

- 档位：`100 / 1k / 10k / 50k / 100k / 200k`，常量 `DATASET_PRESETS`。
- 默认档位：`10,000` 行（`DEFAULT_ROWS`，改这一处即可调整默认值）。
- 字段混入字符串、数字、日期、枚举，供 excel-exporter 的 `format` / `numFormat`
  验证使用。

同一 seed 下同一档位数据完全一致，重复导出、横向对比性能时才不会被数据随机性干扰。

## 新增一个包的联调

1. 复制 `src/demos/_template/` → `src/demos/<your-pkg>/`
2. 在 playground `package.json` 的 dependencies 中声明
   `"@marcusok/<your-pkg>": "workspace:*"`，然后 `pnpm install`
3. 取消 `index.ts` 里的注释模板，填写 `name` / `label` / `description`，并在
   `load()` 里动态 import 实现（返回 `{ default: React 组件 }`）
4. **重启 dev server**：`import.meta.glob` 是启动时静态展开的，运行中新增的 demo
   目录不会被发现（新增 demo、改 demo 名都需要重启）

### 包布局约定（由测试强制校验）

`pnpm --filter playground test` 会校验以下规则，新包接入不合规会直接红：

- 每个被测包必须提供 `src/index.ts`（或 `src/index.tsx`）作为主入口，否则无法获得
  源码别名 HMR。Vite 启动时对不合规的依赖包会打印警告并走 dist 解析。
- 每个声明在 dependencies 里的 `@marcusok/*` 包，必须存在
  `src/demos/<pkg>/index.ts`，且通过 `registerDemo({ name: "<pkg>", ... })` 注册。

### Demo 生命周期

每个 demo 的入口 `index.ts` 只注册轻量元信息（`name` / `label` / `description` /
`load`），实际 UI 在单独的 `*.demo.tsx` 里，由 `load()` 动态 import 按需加载：

```ts
// index.ts —— 只放元信息，不要在这里静态 import 重依赖
registerDemo({
  name: "your-pkg",
  label: "your-pkg · 说明",
  description: "一句话说明这个 demo 演示什么。",
  async load() {
    return import("./your-pkg.demo.js");
  },
});
```

`load()` 返回的模块默认导出是 React 组件，由 `App.tsx` 的 Suspense 边界渲染；
资源清理（定时器、fetch、WebSocket 等）在组件 `useEffect` 的 cleanup 里做，
导航离开时自动执行，不再需要手写的 `destroy()` 机制。

## 模块解析规则（vite.config.ts）

- 主入口 `@marcusok/<pkg>` → `src/index.ts(.tsx)` 源码（HMR 友好）。
- 子路径 `@marcusok/<pkg>/<sub>` → 依次尝试：`src/<sub>.ts(.tsx)` /
  `src/<sub>/index.*` 源码 → 根据包 `exports` 映射回源码（支持嵌套条件，如
  `{"import": {"types": ..., "default": ...}}`；即使导出键名与源文件名不同也能走
  源码）→ `dist/<sub>` 构建产物。因此子路径也能 HMR；用到 `dist/` 产物（如 worker）
  时需上游 build。
- 第三方包未在 `exports` 里暴露的子路径（如 `modern-xlsx/wasm/*`）：在
  `vite.config.ts` 的 `externalOverrides` 数组里加一条
  `{ pkg, dir, excludeFromOptimizeDeps }` 即可，resolver 会自动重写到物理文件。
- 解析与别名的纯函数逻辑在 `src/vite/workspace-resolver.ts`，有单测覆盖
  （`src/__tests__/workspace-resolver.test.ts`）。

## Worker / WASM 资源

如果你的包用到 Worker 或 WASM 等运行时资源（无法通过普通 import 解析），需要用
Vite 的 `?url` 后缀导入资源路径，再传给包的配置函数。参考 `excel-exporter` demo：

```ts
import workerUrl from "@marcusok/your-pkg/dist/your.worker.js?url";
import wasmUrl from "your-wasm-dep/your.wasm?url";

yourPkg.configure({ workerUrl, wasmUrl });
```

注意 `@marcusok/<pkg>/dist/*.worker.js` 是构建产物，必须 build 上游包（`pnpm dev`
与 `pnpm dev:playground` 都会自动做）。dist 产物的改动不会触发 HMR（源码别名只覆盖
主入口与子路径源码），改 worker 等产物后需手动 build 上游并刷新页面。不配置
worker/wasm 的话，包可能会静默降级到 fallback 路径（如 excel-exporter 会降级到
SheetJS，丢失样式）。

## 工具链

- pnpm 版本由根 `package.json` 的 `packageManager` 固定（`pnpm@9.12.0`），请通过
  corepack（或等价方式）运行，避免不同版本 pnpm 重写 lockfile 造成大范围 diff。
- playground 使用 Vite 8，要求 Node >= 22.12（playground `package.json` 的
  `engines` 已声明）；本机 Node 22.22.2 满足。
- vitest 4.1.x 与 vite 8 对齐（peer 支持 `^6 || ^7 || ^8`），仓库内只有一套 vite
  主版本。

## HMR

编辑 demo 源码后，`@vitejs/plugin-react` 提供 React Fast Refresh，原地热更新当前
demo，不整页刷新；当前 hash 路由会被保留。demo 组件卸载时由 React 自动执行
`useEffect` cleanup（等价于旧版手写 HMR 里的 `destroy()`）。
