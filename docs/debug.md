# CI / Release 流水线排障与修复方案

> 本文档记录 `cefad0e`（fix(excel-exporter): tighten exports and declare xlsx as optional peer dep）推送到 main 后，CI 与 Release 两条 workflow 同时失败的诊断结论与详细修复步骤。

---

## 版本与时间记录

| 项目        | 值                                                                                   |
| ----------- | ------------------------------------------------------------------------------------ |
| 文档创建    | 2026-07-29 15:39 (GMT+08:00)                                                         |
| 涉及提交    | `cefad0e` fix(excel-exporter): tighten exports and declare xlsx as optional peer dep |
| 远程仓库    | `git@github.com:yourbusiness/marcus-monorepo.git`                                    |
| 包名 / 版本 | `@marcus/excel-exporter` @ `0.1.0`                                                   |
| 根工程版本  | `marcus-monorepo` @ `0.0.0`                                                          |
| Node        | 22.22.2（CI 固定 22，来源 `.nvmrc`）                                                 |
| pnpm        | 9.12.0（来源 `package.json` `packageManager`）                                       |
| 构建编排    | Turborepo 2.10.7                                                                     |
| 发版工具    | Changesets 2.31.1                                                                    |
| 诊断结论    | 代码与锁文件无问题；失败发生在 GitHub Actions 运行环境与仓库/npm 配置                |

---

## 0. 前提：两个 workflow 独立运行

`ci.yml` 和 `release.yml` 的触发条件都是 `on: push: branches: [main]`。push 到 main 的那一刻两条 workflow **同时起跑、互不依赖**：

- CI 失败不会拦住 Release。
- Release 也不会等 CI 通过。

所以它们各自失败，根因很可能并不相同。下面分开讲。

**CI** (`ci.yml`)：checkout → pnpm → node22 → `pnpm install --frozen-lockfile` → lint → typecheck → test → build（commitlint 只在 PR 时跑，直推 main 不跑）。

**Release** (`release.yml`)：checkout → pnpm → node22 → install → `changesets/action`。

---

## 1. 本地验证：代码本身没问题

以下命令在本地（Node 22.22.2 / pnpm 9.12.0）全部通过：

```
pnpm install --frozen-lockfile   → Lockfile is up to date ✓
pnpm lint                        → 1 successful ✓
pnpm exec turbo run typecheck test build --force
                                 → 3 successful, 27 tests passed ✓
```

锁文件里 Linux 平台的 optional 依赖（esbuild 各平台包、@esbuild/linux-* 等）都有记录，不存在「Windows 生成锁文件、Linux 装不上」的问题。

结论：失败几乎可以锁定在 CI 运行环境特有的环节，以及你还没完成的 GitHub/npm 配置上。

---

## 2. CI 失败：性能测试 flake（重点）

### 2.1 原因

[performance.test.ts](/packages/excel-exporter/src/__tests__/performance.test.ts) 里用**墙钟时间（performance.now 差值）做硬性断言**。GitHub Actions 的 ubuntu shared runner 对 CPU/WASM 任务通常比开发机慢 1.5~2x，且抖动大，必然 flake。

本地实测对照（`PERF_TIGHT` 未设，默认 1.5x slack）：

| 用例                      | 本地实测   | 阈值（1.5x 后） |
| ------------------------- | ---------- | --------------- |
| 50k 行 main               | 701ms      | < 1500ms        |
| 100k 行 stream            | **1864ms** | < 3000ms        |
| format 开销差值（10k 行） | 很小       | < **45ms**      |

CI runner 一抖，100k 那条冲过 3000ms 极常见；「format 差值 < 45ms」更脆，光噪声就能超。

明显征兆：本次提交把 slack 从 `1.2x` 提到了 `1.5x`（见 `git show cefad0e`），说明它一直在 CI 上 flake，一直在放宽阈值——**治标不治本**。

### 2.2 确认方式

去 GitHub 那次失败的 CI 运行，看是否挂在 `@marcus/excel-exporter:test` 步骤，日志里应该是 `expected ... to be less than ...`。

### 2.3 修复方案（三选一，推荐 A）

#### 方案 A（推荐）：CI 跳过 perf，本地保留

最干净。给 perf 测试加环境开关，CI 上默认不跑，本地照常当回归看门狗。

**第 1 步**：改 [performance.test.ts](/packages/excel-exporter/src/__tests__/performance.test.ts)

在 import 之后、`SLACK` 之前加：

```ts
// Perf 基线只在本地当回归看门狗；CI shared runner 抖动大，跑它只会 flake。
// 本地默认跑；设 RUN_PERF=0 跳过（CI 里用）。
const RUN_PERF = process.env.RUN_PERF !== "0";
```

把整个 `describe(...)` 用 `describe.runIf` 包一层：

```ts
describe.runIf(RUN_PERF)(
  "performance (Node WASM-core regression baseline)",
  () => {
    // ... 原有内容完全不动
  },
);
```

**第 2 步**：改 [ci.yml](/.github/workflows/ci.yml)

把 `pnpm test` 这一步加环境变量：

```yaml
- run: pnpm test
  env:
    RUN_PERF: "0"
```

**第 3 步**：改 [release.yml](/.github/workflows/release.yml)

Release 走的 `pnpm release` 里有 `turbo run ... test`，要同样跳过。给 release job 的 env 加一行（和现有的 `HUSKY: "0"` 并列），turbo 子进程能继承：

```yaml
env:
  HUSKY: "0"
  RUN_PERF: "0"
```

效果：perf 测试在你本地照常跑，CI 上彻底不跑，flake 根除。将来上自托管 runner 再把开关打开。

#### 方案 B：保留 perf 但改成相对基线

不断绝对时间，改用「本次 vs 热身 10 次的中位数的 N 倍」之类相对断言。改动大、维护成本高，除非有明确的回归门禁需求，否则不值当。测试文件末尾注释其实已点明：toBuffer 的冷热差距太大，无法在单进程 vitest 里稳定测——同一个问题的延伸。

#### 方案 C：极端放宽阈值

只把 `expect(dt).toBeLessThan(...)` 的数字放大到 CI 永远碰不到。这就是现在一直在做的（1.2x → 1.5x），治标不治本，哪天 runner 又慢了继续 flake。**不推荐**。

---

## 3. Release 失败：GitHub 仓库权限没开（最优先）

### 3.1 原因

本次 push 带了**两个 pending changeset**（`bumpy-tables-grin.md` 和 `fix-exports-and-peer-deps.md`）。按 `changesets/action` 逻辑，这种情况它**不会发布**，只执行 `pnpm version-packages` 然后创建一个标题「chore: release packages」的 Version PR。

失败极可能发生在「创建 PR」这一步，最常见报错（文档 6.5/6.6 节自己写过）：

```
HttpError: Resource not accessible by integration
```

原因：仓库 **Settings → Actions → General → Workflow permissions** 区域里，**Allow GitHub Actions to create and approve pull requests** 复选框没勾。即使 workflow 里声明了 `pull-requests: write`，没勾这个框，`GITHUB_TOKEN` 还是建不了 PR。

> 注：`NPM_TOKEN`、npm `@marcus` scope 归属、provenance 这些只在**真正 publish 时**才会绊倒你（merge Version PR 之后的第二次 push）。现在这次失败大概率还没走到那一步。

### 3.2 确认方式

去失败的 Release 运行日志，看挂在哪一步。如果是「Create Release Pull Request or Publish」那一步报 `Resource not accessible by integration`，就是这个权限问题。

### 3.3 修复步骤（纯配置，不改代码）

**第一步：开「允许 Actions 建 PR」**

浏览器打开仓库 → 顶部 **Settings** → 左侧 **Actions** → **General** → 滚到下方 **Workflow permissions** 区域：

1. 上半块复选框：**Allow GitHub Actions to create and approve pull requests** → **勾上**。这是 `changesets/action` 用 `GITHUB_TOKEN` 调 GitHub API 建 Version PR 的前提。
2. 下半块单选：选 **Read and write permissions**。

两块都改完，**滚到该区域最底部点绿色 Save**（这个页面每个区块独立保存，不点不生效）。

**第二步（推荐但非必须）：配 `CHANGESETS_GITHUB_TOKEN`**

光开上面的复选框，Version PR 能建出来，但用默认 `GITHUB_TOKEN` 建的 PR **不会触发 ci.yml**（GitHub 防递归机制）。将来给 main 加分支保护、把 CI 设成必需检查，这个 PR 永远绿不了。配 PAT 可绕过：

1. GitHub 右上头像 → Settings → 左侧最底部 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → Generate new token。
2. **Repository access**：Only select repositories → 勾中 `marcus-monorepo`。
3. **Permissions**（Repository permissions 下）：Contents = **Read and write**，Pull requests = **Read and write**。
4. 生成后复制 `github_pat_` 开头的串。
5. 回仓库 Settings → Secrets and variables → Actions → New repository secret → Name 填 `CHANGESETS_GITHUB_TOKEN`，值粘贴刚才的串。

[release.yml](/.github/workflows/release.yml) 已写好 `CHANGESETS_GITHUB_TOKEN || GITHUB_TOKEN` 的回退，配了就生效，没配退回默认 token。

**第三步：准备 publish 前置（等 Version PR 合并后才用到，建议先备好）**

真正 merge Version PR 触发 `npm publish` 时还需要：

- `NPM_TOKEN`（GitHub Secret）：npm 账号建 Granular Access Token，scope 限定 `@marcus`，勾 **Allow bypass 2FA**（账号开了 2FA 才有），存为 secret。
- npm 上 `@marcus` scope 要归你所有——注册 npm 账号时 username 会成为 scope 名，确认对得上，否则 publish 报 403 scope 未授权。
- provenance（`NPM_CONFIG_PROVENANCE: "true"`）依赖 `id-token: write`，workflow 已声明，不用额外动。想先跳过就改成 `"false"`，不影响发布本身。

---

## 4. 顺带：操作与文档不一致的两处

### 4.1 遗留的测试 changeset 没清

文档 7.1 节写「正式发版前删掉测试残留」，但 `funny-pugs-leave.md` 只是改名成了 `bumpy-tables-grin.md`，还在。它和真正的 changeset 一起会把版本 bump 成 0.1.1，changelog 混进「修改了一些配置文件」（PowerShell 里看到的乱码，其实文件是好的，纯 GBK 显示问题）。

### 4.2 `repository.url` 还是占位符

[package.json](/packages/excel-exporter/package.json) 里 `yourbusiness/marcus-monorepo` 是占位符。push 能成说明 remote 指向的真实仓库存在，但这个值会写进 npm 包元数据和 provenance 签名，指向不存在的地址。

---

## 5. 具体修复动作（按优先级，含命令）

### 5.1 Release 权限（纯 GitHub 设置，零风险，立刻验证）

按第 3.3 节操作：勾「Allow GitHub Actions to create and approve pull requests」+ 选 Read and write + Save。

可选配 `CHANGESETS_GITHUB_TOKEN`。

### 5.2 清理测试 changeset

只想发「收紧 exports + xlsx 可选 peer dep」这一个变更，留 [fix-exports-and-peer-deps.md](/.changeset/fix-exports-and-peer-deps.md)，删另一条：

```bash
git rm .changeset/bumpy-tables-grin.md
git commit -m "chore: drop leftover test changeset"
```

> 提醒：删 changeset 后再 push，Release workflow 会重新开 Version PR。确保此时 `.changeset/` 里只剩你真正想发的那一条——只要 push 到 main 且有 pending changeset，机器人就会开 PR，merge 那个 PR 等于真的发版到 npm。

### 5.3 改造性能测试（方案 A）

见第 2.3 节方案 A 的三步：改 `performance.test.ts`、`ci.yml`、`release.yml`。

### 5.4 修正 repository.url

[package.json](/packages/excel-exporter/package.json)：

```json
"url": "git+https://github.com/<真实owner>/marcus-monorepo.git"
```

顺带 `bugs.url` 里的 `yourbusiness` 一起改。确认方式：`git remote -v` 里 origin 显示的 owner。

---

## 6. 推荐操作顺序

分两步验证，把问题隔离清楚：

1. **先做 5.1**（纯 GitHub 设置）。推个无关紧要的改动（如 README 加一行）触发 Release，确认 Version PR 能建出来。
2. **再做 5.2 + 5.3 + 5.4**，一个提交推上去：验证 CI 不再因 perf 挂、开出干净的 Version PR。

---

## 7. 待确认事项

以上 CI 判断是「本地全绿 + Linux 唯一脆点是 perf 测试」的强推断；Release 判断是「pending changeset + 文档点名的权限错误」的推断。**最稳的下一步是把那次失败的 Actions 日志贴过来**，可把猜测坐实到具体那一步、那行报错。
