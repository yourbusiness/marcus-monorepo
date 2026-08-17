# @marcusok/docs

面向 `marcus-monorepo` 所有库包的公开技术文档站（VitePress），部署于 GitHub Pages：
`https://yourbusiness.github.io/marcus-monorepo/`。默认中文，提供英文版。

## 常用命令

从仓库根目录运行（推荐，turbo 会先构建上游依赖）：

```bash
pnpm dev:docs      # 本地开发，端口 5174
pnpm build:docs    # 构建（先构建 excel-exporter，再拷贝 wasm/worker 到 public/assets）
pnpm preview:docs  # 本地预览构建产物
pnpm test          # turbo 全仓测试（docs 执行 zh/en 页面镜像校验）
pnpm typecheck     # turbo 全仓类型检查（docs 执行 vue-tsc --noEmit）
```

> 注意：不要直接在本目录裸跑 `pnpm build`，它依赖 `@marcusok/excel-exporter` 的
> `dist/` 产物与 `modern-xlsx` 的 wasm 资源，turbo 依赖图会保证顺序。

## 目录约定

```text
.vitepress/config.ts                 # 站点配置（base、i18n、导航、自动侧边栏）
.vitepress/registry.ts               # ★ 包注册表：新增包只需在此登记（含侧边栏/统计/亮点）
.vitepress/theme/components/         # 自定义 Vue 组件（首页卡片、live demo 等）
scripts/check-i18n.mjs               # zh/en 页面镜像校验（`pnpm test` 会执行）
src/demos/<name>/                    # 每个包各自的确定性 mock 数据生成器
packages/<name>/                     # 每个库包一份文档（guide / examples / api）
en/                                  # 英文版镜像（根目录为中文默认）
```

## 新增一个包

1. 在 `apps/docs/package.json` 的 `dependencies` 中加入该包（`workspace:*`）并 `pnpm install`——registry 构建期要读取它的 `package.json` 版本号，live demo 也要 import 它；
2. 在 `packages/<name>/` 下写文档（`guide/`、`examples/`、`api/`，md 文件即页面，H1 即侧边栏标题）；
3. 在 `.vitepress/registry.ts` 的 `packages` 数组中加一条记录；
4. 侧边栏、导航、首页包卡片自动生成；如需首页亮点，给该条目补 `homeStats`（统计卡片）与 `highlights`（亮点卡片）；如需非默认章节（如 `migration/`），用 `sections` 覆盖默认的 guide/examples/api 分组；
5. 如需英文版，同步在 `en/packages/<name>/` 写英文页（文件名含数字前缀时须与中文一致）；**暂时只提供中文时不要创建 `en/packages/<name>/` 目录**，`pnpm test` 会跳过该包的镜像校验，en 导航/侧边栏/首页包卡片/统计/亮点会自动隐藏仅中文的包；之后补英文时建目录并补齐镜像页面即可；
6. 页面顺序由文件名数字前缀控制：`NN-` 开头（如 `01-quick-start.md`）按数字升序排列，无前缀文件排在最后按字母序；
7. 任何 `packages/**` 的改动都会触发 `deploy.yml`，合并到 main 后自动重建并部署文档站。

## 部署

`.github/workflows/deploy.yml` 在 push 到 `main` 时构建文档站并发布到 GitHub Pages
（仓库 Settings → Pages → Source 需为 "GitHub Actions"）。`base` 默认从 git remote 自动推导
（`/<repo>/`），可在构建时用环境变量 `DOCS_BASE` 覆盖（例如接自定义域名时设为 `/`）；
`DOCS_BASE` 已声明在根 `turbo.json` 的 `globalEnv`，不同取值不会命中同一份构建缓存；
修改 git remote 后首次构建请用 `pnpm build:docs --force` 让 turbo 绕过缓存。
