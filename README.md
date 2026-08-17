# marcus-monorepo

pnpm + Turborepo 前端基建 monorepo，为多个后台应用提供统一的公共能力包。当前首个共享包是基于 [modern-xlsx](https://github.com/ABCrimson/modern-xlsx)（Rust + WASM）的高性能 Excel 导出引擎，后续将扩展 PDF 导出、文件上传、虚拟表格渲染等包。

## 当前包

| 包                                                      | 说明                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`@marcusok/excel-exporter`](./packages/excel-exporter) | Excel 导出核心库（WASM 驱动、带样式、流式写入、Worker 多线程、table/ECharts 便捷适配） |

## 快速开始

```bash
pnpm install     # 安装依赖
pnpm build       # 构建全部包
pnpm test        # 运行全部测试
pnpm lint        # ESLint
pnpm typecheck   # TypeScript 类型检查
```

环境：Node >= 22、pnpm >= 9。`.nvmrc` 锁定 22。依赖 modern-xlsx@1.2.0 声明 `engines.node >= 24`，但其 WASM 核心面向浏览器，仓库在 Node 22 下全绿，`.npmrc` 设 `engine-strict=false` 放行。

## 工程化

| 关注点    | 选型                             | 说明                                                                   |
| --------- | -------------------------------- | ---------------------------------------------------------------------- |
| 包管理    | pnpm workspace                   | 硬链接节省磁盘，`workspace:*` 协议，严格依赖隔离                       |
| 构建编排  | Turborepo                        | 并行构建 + 远程缓存，`^build` 自动编排包依赖顺序                       |
| 包构建    | tsup                             | esbuild 驱动，TS → ESM + DTS 一把梭，统一 ESM-only                     |
| 语言      | TypeScript 5.x                   | `moduleResolution: bundler`，`lib` 同时含 DOM 与 WebWorker             |
| 代码规范  | ESLint 9 + Prettier              | flat config，`no-floating-promises` 防止遗漏 await                     |
| 提交规范  | Husky + lint-staged + commitlint | Conventional Commits，配合 Changesets 自动 changelog                   |
| 版本/发布 | Changesets                       | 多包独立发版、自动生成 changelog、支持 prerelease                      |
| 测试      | Vitest                           | ESM 原生兼容，WASM 友好                                                |
| CI/CD     | GitHub Actions                   | `ci.yml`（lint → typecheck → test → build）+ `release.yml`（自动发布） |

## 目录结构

```
marcus-monorepo/
├── apps/                       # 应用（水平扩展）
│   └── docs/                   # VitePress 公开文档站（中英双语，GitHub Pages）
├── packages/                   # 共享包（水平扩展）
│   ├── excel-exporter/         # 当前：Excel 导出
│   │   ├── src/                # 24 个 .ts 文件（15 个源文件 + 9 个测试文件）
│   │   └── dist/               # tsup 构建产物
│   └── play/                   # 本地联调沙箱（React 19 + antd 6，private 包）
├── docs/                       # 设计文档
│   └── excel-export-design.md  # Excel 导出核心设计文档（13 万字符）
├── scripts/                    # 仓库级脚本（dev.mjs 统一 dev 启动器）
├── .changeset/                 # Changesets 配置
├── .github/workflows/          # CI/CD
├── turbo.json                  # Turborepo 任务编排
├── tsconfig.base.json          # 共享 TypeScript 基线
├── pnpm-workspace.yaml
├── eslint.config.mjs           # ESLint flat config
└── package.json
```

## 新增包规范

1. 在 `packages/<name>/` 下创建，使用 `workspace:*` 引用内部依赖。
2. 子包 `package.json` 声明 `type: "module"`，构建用 tsup，测试用 Vitest。
3. 跨包共享配置直接复用仓库根的 `tsconfig.base.json` 与 `eslint.config.mjs`（暂无 `packages/_shared/`，出现包级共享配置需求时再抽取）。
4. `turbo.json` 的 `^build` 依赖图自动处理构建顺序，新增包无需改动 CI/CD。
5. Changesets 为每个包独立发版，互不阻塞。

## 发布流程

```bash
pnpm changeset                # 创建变更记录，选择受影响的包与 semver 类型
# 提交 .changeset/*.md → 合并到 main → release.yml 自动执行：
#   changeset version         改版本号 + 更新 CHANGELOG
#   changeset publish         发布到 npm
```

预发布：

```bash
pnpm changeset pre enter next  # 进入 next 预发布模式
pnpm changeset version         # → 0.1.3-next.0
pnpm changeset publish         # 以 next dist-tag 发布
```

## 参考文档

- [`docs/excel-export-design.md`](./docs/excel-export-design.md) — Excel 导出核心设计文档
- [`docs/release-guide.md`](./docs/release-guide.md) — 发布指南
- [`docs/release-publish-logic.md`](./docs/release-publish-logic.md) — 发布逻辑详解
- [`docs/release-workflow-analysis.md`](./docs/release-workflow-analysis.md) — 发布工作流分析
- [`docs/ci-workflow-analysis.md`](./docs/ci-workflow-analysis.md) — CI 工作流分析
- [`docs/changeset-walkthrough.md`](./docs/changeset-walkthrough.md) — Changesets 使用说明
- [`docs/vitepress-docs-plan.md`](./docs/vitepress-docs-plan.md) — 文档站规划
- [`docs/debug.md`](./docs/debug.md) — 调试指南

## License

MIT
