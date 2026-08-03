# 公开技术文档站（VitePress）建设方案

> 状态：待评审。本文基于仓库现状、VitePress 官方文档与 npm 实测数据整理，供评审后进入实施。

## 1. 目标

在 `apps/` 下新建一个 VitePress 子项目，作为本 monorepo 所有已发布库包的线上公开技术文档站，并部署到 GitHub Pages。文档站需包含：

- 库包介绍与生态总览
- 详细使用方法（安装、配置、API）
- 使用案例（含 mock 数据生成与可交互示例）
- 现代化、有吸引力的页面交互
- 面向未来多包扩展的结构（新增包时改动最小）

## 2. 现状梳理（基于事实）

### 2.1 仓库技术栈

| 项目      | 现状                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------- |
| 包管理器  | pnpm 9.12.0（`packageManager` 字段锁定，CI 用 `pnpm/action-setup@v4` 读取）                         |
| 编排      | Turborepo 2.x；`build` 任务 `dependsOn: ["^build"]`，`outputs: ["dist/**"]`                         |
| 语言/环境 | TypeScript 5.9、Node >= 22（`.nvmrc` = 22）、ESM-only                                               |
| workspace | `pnpm-workspace.yaml` 目前只包含 `packages/*`，**没有 apps/**                                       |
| 现有包    | `@marcusok/excel-exporter`（v0.1.3，已发布）、`@marcusok/playground`（私有）                        |
| CI/CD     | `.github/workflows/ci.yml`（lint/typecheck/test/build）、`release.yml`（changesets 发布 npm）       |
| 内部文档  | 根目录 `docs/` 存放设计/流程文档（excel-export-design.md 等），属于内部文档，与公开文档站**不混用** |

### 2.2 excel-exporter 公开 API（文档站内容来源）

已从 `packages/excel-exporter/src/` 核实，公开面包括：

- 入口：`exportExcel(options)`、`configureWasm()`、`WorkbookBuilder`、`exportAsStream`
- 类型：`ExportOptions`、`SheetConfig`、`ColumnConfig`、`CellStyle`、`FormatSpec`、`ExportMode`、`ExportResult`
- 样式：`StylePresets`（header / currency / percent / date / datetime / dataRow / danger，共 7 种）
- 能力：自动模式路由（<500 行 main；≥500 行 Worker+Workbook；≥50,000 行 Worker+Stream）、进度回调 `onProgress`、阶段回调 `onPhase`、SheetJS 降级兜底
- 依赖约定：`modern-xlsx` 为必装 peerDep，`xlsx` 为可选兜底；浏览器需静态部署 `modern-xlsx.wasm` 与 `export.worker.js`
- 性能数据：README/设计文档中有真实基准（1 万行 main 109ms / 5 万行 618ms / 10 万行 stream 1,548ms 等）

### 2.3 需要提前说明的现状问题

1. **git 远程是占位地址**：`git@github.com:yourbusiness/marcus-monorepo.git`。GitHub Pages 项目站点的访问路径是 `https://<owner>.github.io/<repo>/`，`base` 配置依赖真实仓库名，部署前需要确认真实 owner/repo。
2. **根 README 存在编码问题**（GBK 内容被当作 UTF-8 显示为乱码）。公开文档站内容将全部新写（UTF-8），不直接复用 README 文本；README 修复可作为独立事项另行处理。
3. GitHub Pages 需要仓库所有者先在仓库 Settings → Pages 中把 Source 设为 **GitHub Actions**；私有仓库的 Pages 服务需要付费计划（Pro/Team/Enterprise）。

## 3. 技术选型与依据

### 3.1 VitePress 版本：用 stable `1.6.4`，不用 `2.0.0-alpha.19`

实测 npm dist-tags（2026-08-03）：

```text
latest: 1.6.4（dependencies.vite = ^5.4.14）
next:   2.0.0-alpha.19
```

官方 Getting Started 目前引导安装 `vitepress@next`，但 2.0 仍是 alpha，且官方 Node 要求为 22+（仓库锁定 Node 22，满足）。对**公开生产站点**，选 stable 1.6.4：

- 1.6.4 已内置所需全部能力：默认主题、本地搜索、Markdown 增强、自定义主题扩展、`base` 子路径部署；
- 2.x 特性（如更快的构建）等 2.0 stable 后再升级，升级路径平滑（配置结构兼容）；
- 与仓库 Node 22 完全兼容（1.6.4 无 engines 限制，Vite 5 支持 Node 18+）。

### 3.2 部署：GitHub Pages 官方 Actions 工作流（VitePress 官方推荐）

依据 [VitePress Deploy 指南](https://vitepress.dev/guide/deploy.html#github-pages)，采用
`actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages` 三件套，
仓库 Settings → Pages → Source 选 "GitHub Actions"。官方示例当前版本为
configure-pages@v4 / upload-pages-artifact@v3 / deploy-pages@v4（实测各 Action 最新 major 为 v6/v5/v5，实施时按官方示例选一组互相兼容的版本）。

关键配置：

- `base: '/marcus-monorepo/'`（项目站点子路径部署必配，否则资源 404；真实仓库名确定后校准，支持用环境变量覆盖以便将来接自定义域名）；
- 触发：`push` 到 `main` + `workflow_dispatch` 手动触发；
- 构建：`pnpm install --frozen-lockfile` + `pnpm turbo run build --filter=@marcusok/docs`（turbo 会自动先构建上游依赖 excel-exporter）；
- 缓存：`actions/cache` 缓存 `apps/vitepress/.vitepress/cache`，加速构建；
- `lastUpdated` 需要 `fetch-depth: 0`。

### 3.3 与 monorepo 的集成方式

- `pnpm-workspace.yaml` 增加 `apps/*`，使 apps/vitepress 作为 workspace 包参与 `pnpm install`；
- 文档站提供 `dev / build / preview` 脚本并接入 turbo：根 `pnpm build` 会一并构建文档站，**CI 每次 PR 都会验证文档可构建**，提前发现问题；
- 文档站输出目录是 `.vitepress/dist`（不符合根 turbo 的 `dist/**` 输出规则），因此在 `apps/vitepress/turbo.json` 用 `{"extends": ["//"]}` 覆写 `build.outputs` 为 `[".vitepress/dist/**"]`；
- 根 package.json 增加 `docs:dev` / `docs:build` 便捷脚本（`turbo run ... --filter=@marcusok/docs`）；
- 文档站 v1 不接入 lint/typecheck（VitePress 构建本身会校验 config；根 eslint 面向 React/TS，`.vue` 组件需要额外的 vue 解析器，暂不引入，避免为文档站污染根工具链）；文档站通过 turbo build 在 CI 中持续受检。

## 4. 目录结构

```text
apps/vitepress/                          # workspace 包 @marcusok/docs（private）
├─ package.json                          # scripts: dev / build / preview
├─ tsconfig.json                         # 覆盖 .vitepress 与 src（仅做编辑器/类型支持）
├─ turbo.json                            # extends ["//"]，覆写 build.outputs
├─ .vitepress/
│  ├─ config.ts                          # 站点配置：base、title、nav、sidebar、search、lastUpdated
│  ├─ registry.ts                        # ★ 包注册表：包名/描述/版本/图标/文档目录 → 自动生成导航与首页卡片
│  └─ theme/
│     ├─ index.ts                        # 扩展默认主题（布局插槽、全局组件）
│     ├─ components/                     # 自定义 Vue 组件（见 §6）
│     └─ styles/                         # 品牌色、暗色/亮色变量、动画
├─ public/assets/                        # 构建时从 excel-exporter 拷贝 wasm/worker（live demo 用）
├─ index.md                              # 首页：Hero + 包卡片 + 特性区（由 registry 驱动）
├─ guide/                                # 生态级指南：介绍、快速上手、浏览器/Node 环境配置、FAQ
├─ packages/
│  └─ excel-exporter/                    # ★ 每个库包一个目录（与仓库 packages/ 一一对应）
│     ├─ index.md                        # 包介绍（what/why、能力清单、性能摘要）
│     ├─ guide/                          # 详细使用：安装、WASM 配置、自动模式、样式、格式化、Worker/Stream、兜底
│     ├─ examples/                       # 使用案例：销售报表、库存导出、多 Sheet 报表等（mock 数据 + 代码 + 可交互 demo）
│     └─ api/                            # API 参考：exportExcel、类型、StylePresets、FormatSpec、回调
└─ src/
   ├─ mock/                              # ★ 确定性 mock 数据生成器（见 §7）
   └─ utils/                             # 公共小工具（数字格式化、种子 PRNG 等）
```

### 新增包的约定（可拓展性核心）

1. 在 `apps/vitepress/packages/<name>/` 建文档目录（guide / examples / api）；
2. 在 `.vitepress/registry.ts` 增加一条记录（npm 名、简介、版本来源、目录、关键词）；
3. 侧边栏、顶部导航、首页包卡片**全部由 registry 自动生成**，无需再改三处；
4. 包版本号在构建期从 `packages/<name>/package.json` 读取，**不手工硬编码**，发版后文档自动同步。

## 5. 内容规划（第一版，中文）

### 5.1 生态级页面

- 首页：Hero（项目名 + 一句话定位 + 双 CTA）+ 包卡片网格 + 能力亮点 + 数据统计；
- `guide/getting-started.md`：环境要求（Node 22 / pnpm 9）、整体上手流程、常用命令；
- `guide/deployment.md`：消费方如何在自己的项目里接入各包（Vite / 非打包工具两种路径）；
- `guide/faq.md`：常见问题（WASM 404、Worker URL、peerDep 说明等）。

### 5.2 excel-exporter 内容（第一版主体）

- 介绍：定位（基于 modern-xlsx 的高性能 Excel 导出引擎）、能力矩阵、与 SheetJS 的关系与兜底策略；
- 使用指南：
  - 安装与浏览器配置（wasm/worker 静态资源部署，给出 Vite 插件复制方案，源自包 README 已验证做法）；
  - 自动模式路由与手动指定 mode；
  - 7 种 StylePresets 与自定义 CellStyle；
  - FormatSpec（enum/date/datetime/number/padding）及跨模式精度注意点（如 `decimals` 显式声明）；
  - 合并单元格、冻结行、自动筛选；
  - 进度回调 onProgress 与阶段回调 onPhase 的可视化用法；
  - Node/SSR 场景用法；
  - SheetJS 兜底触发条件与排查；
- 使用案例（每个案例 = 场景说明 + 完整代码 + 预览）：
  - 销售月报导出（mock 1 万行，演示自动模式 + 样式 + 汇总行）；
  - 库存台账导出（合并单元格 + 冻结 + 筛选）；
  - 大文件导出（mock 10 万行，演示 Worker+Stream 与进度条）；
  - 多 Sheet 工作簿（多部门报表）；
- API 参考：`exportExcel` 参数逐项说明、类型定义、`StylePresets` 明细表、`FormatSpec` 用例、回调签名；
- 性能页：真实基准数据（来源标注为设计文档/README，非 mock）+ 交互式图表（行数 vs 耗时，main/stream/worker 曲线）。

> 说明：**性能数字是真实基准数据并标注来源**；"数据采用 mock" 指**案例演示数据**由确定性 mock 生成器产生（见 §7），不混用真实业务数据。

## 6. 现代化交互设计（v1 范围）

基于 VitePress 默认主题扩展，不引入重型 UI 框架：

| 交互             | 实现方式                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 品牌视觉         | CSS 变量定制主题色，亮/暗双主题（默认主题内置）                                                                                                                                               |
| 首页动效         | 自定义 Home 组件：渐变背景 + 浮动光斑 + 包卡片 hover 上浮/描边，纯 CSS 动画                                                                                                                   |
| 本地全文搜索     | 默认主题内置 minisearch，配置中文文案；后续如需中文分词优化，加 `@vitepress-org/plugin-search` 自定义 tokenize                                                                                |
| 代码体验         | 默认主题自带代码复制、行号；多环境（npm/pnpm）代码用 Tab 组件切换                                                                                                                             |
| 可交互 live demo | 文档站内嵌真实导出组件：选择 mode（auto/main/worker/stream）、mock 数据规模、点击导出真实 .xlsx、显示进度与耗时；组件用 Vue `<ClientOnly>` 包裹避免 SSR 报错（导出依赖 Blob/Worker/document） |
| 数据可视化       | 性能页用轻量图表（自绘 SVG 曲线，零依赖）展示真实基准数据                                                                                                                                     |
| 数据统计         | 首页统计块（包数量、npm 版本、性能数字）用 IntersectionObserver + 计数动画                                                                                                                    |

## 7. Mock 数据方案

- 自研**确定性生成器**：mulberry32 种子 PRNG + 数据模板（不引入 faker 等额外依赖）；
- 确定性是关键：VitePress 页面在构建期 SSR，随机数据会导致每次构建内容漂移甚至 hydration 不匹配；种子固定则构建结果稳定、可测试；
- 提供数据集：销售订单（含金额/状态/日期/区域）、库存台账、人员花名册、多部门销售汇总等，规模参数化（1 千 / 1 万 / 10 万行）；
- mock 模块同时被文档站 live demo 与示例页复用；配套单元测试（Vitest）校验生成行数与字段完整性（复用仓库现有 Vitest 能力）。

## 8. 部署方案与前置条件

### 8.1 新增 `.github/workflows/deploy.yml`

参照 VitePress 官方 GitHub Pages 示例（含 cache、configure-pages、upload-pages-artifact、deploy-pages），按仓库约定调整：

- checkout@v4 / pnpm/action-setup@v4 / setup-node@v4（node 22, cache: pnpm，与 ci.yml 一致）；
- `pnpm install --frozen-lockfile`；
- `pnpm exec turbo run build --filter=@marcusok/docs`；
- 上传 `apps/vitepress/.vitepress/dist`；
- Pages 专用 Actions 版本按官方示例选取（实施时以官方 deploy 文档最新示例为准，当前为 configure-pages@v4 / upload-pages-artifact@v3 / deploy-pages@v4；实测最新 major 为 v6/v5/v5）。

### 8.2 一次性前置条件（需用户确认/执行）

1. 确认真实 GitHub 仓库地址（当前 remote 为占位 `yourbusiness/marcus-monorepo`），并据此校准 `base`；
2. 仓库 Settings → Pages → Build and deployment → Source = **GitHub Actions**；
3. 如为私有仓库，确认 GitHub 计划支持 Pages；
4. 确认文档语言：建议**中文优先**（与现有 README 语言一致），VitePress 天然支持 i18n，后续可加英文；
5. 确认选型：**VitePress 1.6.4 stable**（推荐，理由见 §3.1）。

## 9. 实施里程碑

| 阶段    | 内容                                                               | 产出                                                    |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| M1 骨架 | workspace 接入 apps/*、文档站脚手架、config、首页雏形、deploy.yml  | 本地 `pnpm dev` 可跑，PR 即构建校验，push main 自动部署 |
| M2 内容 | excel-exporter 介绍/指南/API/FAQ 全部页面                          | 完整可查阅的文档主体                                    |
| M3 交互 | 自定义 Home、mock 生成器、live demo、性能图表、搜索中文文案        | 现代化观感 + 真实可用的在线示例                         |
| M4 收尾 | 404 页、lastUpdated、README 入口链接、文档站使用说明（如何加新包） | 可长期维护                                              |

## 10. 风险与权衡

| 风险/权衡                     | 说明                                                                                 | 应对                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 2.0 仍是 alpha                | 生产站点选 stable 1.6.4，短期不追新                                                  | 2.0 stable 后评估升级                                          |
| live demo 引入构建依赖        | 文档站 build 依赖 excel-exporter 先构建（turbo `^build` 自动排序）；dev 下同样先构建 | 已由 turbo 依赖图保证；CI 每次 PR 验证                         |
| eslint/typecheck 未覆盖文档站 | 文档站代码质量检查弱于 packages                                                      | v1 用构建校验兜底；如需补齐再引入 vue-eslint-parser / tsc 项目 |
| base 与仓库名耦合             | 改名/换仓库会导致静态资源 404                                                        | base 由单一常量管理 + 环境变量覆盖，换域名时一行切换           |
