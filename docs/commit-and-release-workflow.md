# 提交代码 & CI/CD 自动发布流程

> 本文档基于仓库实际文件编写，每一条配置都标注了来源文件，可直接核对。

---

## 1. 项目技术栈

| 维度        | 实际值                           | 来源                                      |
| ----------- | -------------------------------- | ----------------------------------------- |
| 包管理器    | pnpm 9.12.0                      | `package.json` `packageManager`           |
| 构建编排    | Turborepo                        | `turbo.json`                              |
| 发版工具    | Changesets                       | `.changeset/config.json`                  |
| Git Hooks   | Husky                            | `.husky/`                                 |
| Commit 规范 | commitlint + config-conventional | `.commitlintrc.json`                      |
| Lint        | ESLint 9（flat config）          | `eslint.config.mjs`                       |
| 代码格式化  | Prettier                         | `package.json` devDependencies            |
| Node 版本   | >= 22.0.0                        | `package.json` `engines`；`.nvmrc` = `22` |

当前仓库只有一个可发布的包：`@marcusok/excel-exporter`（v0.1.0），见 `packages/excel-exporter/package.json`。

---

## 2. 提交前检查清单

不快照某个时刻的 `git status`（它会立刻过时），只列每次提交前该确认的事。

### 2.1 看清当前改动

```bash
git status              # 哪些文件暂存 / 未暂存 / 未追踪
git diff --cached       # 暂存区里到底改了什么
```

### 2.2 确认 changeset

发版由 `.changeset/*.md` 驱动，提交前确认它描述的是你想发布的变更：

```bash
ls .changeset/*.md      # 列出当前所有 changeset
```

本仓库现在有两个 changeset，都标 `@marcusok/excel-exporter: patch`：

| 文件                                      | 实际内容（UTF-8，正常）                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `.changeset/fix-exports-and-peer-deps.md` | 规范的英文说明：收紧 `exports`、把 `xlsx` 声明为可选 peer dep、给 SheetJS 动态 import 加 `@vite-ignore`、修 WASM loader 报错文案 |
| `.changeset/puny-parts-join.md`           | 中文「改了一些文件」——内容合法、编码正常，只是描述太笼统                                                                         |

两个 changeset 指向同一个包、同一级别（patch）：Changesets 会把它们**合并成一次 patch 升版**，两条说明都会写进 CHANGELOG。这不会出错；想让 changelog 更清晰的话，把笼统那条改成具体描述，或删掉它即可。

### 2.3 确认远程仓库地址

```bash
git remote -v
```

当前 remote 指向 `git@github.com:yourbusiness/marcus-monorepo.git`，`packages/excel-exporter/package.json` 的 `repository.url` 也是 `yourbusiness/marcus-monorepo`。如果这不是你真实的仓库，push 会失败：先在 GitHub 建好仓库，再 `git remote set-url origin <你的地址>`，并同步改 `repository.url`。

### 2.4 关于 PowerShell 里看到的「乱码」（只是显示问题，不是文件坏了）

中文 Windows 的 PowerShell 控制台默认用 GBK 代码页，直接读 UTF-8 中文文件会看到「鎻愪氦」这类乱码——这是**显示假象**，文件本身完好。可靠查看：用 VS Code 等编辑器（按 UTF-8）打开即可正常显示。本文档、以及上面两个 changeset 都是 UTF-8，同样道理。

---

## 3. 本地提交流程

### 3.1 写 Changeset（描述本次发版内容）

Changeset 是发版的「说明书」。它告诉 Changesets：这次改动影响哪个包、版本怎么升、CHANGELOG 写什么。

**命令：**

```bash
pnpm changeset
```

交互式选择：

1. 选择影响的包（`@marcusok/excel-exporter`）
2. 选择版本级别：`patch` / `minor` / `major`
3. 写一句 changelog 描述

完成后会在 `.changeset/` 下生成一个 markdown 文件（随机命名）。

**已有的 changeset 配置**（来源 `.changeset/config.json`）：

| 配置项                       | 值       | 含义                                           |
| ---------------------------- | -------- | ---------------------------------------------- |
| `baseBranch`                 | `main`   | 发版基准分支                                   |
| `access`                     | `public` | 发布为公开包                                   |
| `commit`                     | `false`  | changeset version 后不自动提交，由 action 接管 |
| `updateInternalDependencies` | `patch`  | 内部依赖变更默认按 patch 升                    |

### 3.2 Git Hooks（提交时自动触发）

来源 `.husky/pre-commit` 和 `.husky/commit-msg`。

**pre-commit**（提交动作触发）：

```bash
pnpm exec lint-staged
```

lint-staged 对暂存文件执行（来源 `.lintstagedrc.json`）：

- `*.{ts,tsx,mjs,js}` → `eslint --fix` + `prettier --write`
- `*.{json,md,yaml,yml}` → `prettier --write`

**commit-msg**（写完 commit message 触发）：

```bash
pnpm exec commitlint --edit $1
```

commitlint 校验规则（来源 `.commitlintrc.json`）：extends `@commitlint/config-conventional`，**强制 Conventional Commits 格式**。

### 3.3 Commit Message 格式

必须是：

```
type(scope): subject
```

合法 type（来自 config-conventional 约定）：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert`。

示例：

```
fix(excel-exporter): tighten exports and declare xlsx as optional peer dep
```

### 3.4 完整提交命令

```bash
# 1. 暂存改动（先按 2.2 确认 .changeset/ 里的内容是你想发布的）
git add -A

# 2. 提交（触发 pre-commit 的 lint-staged + commit-msg 的 commitlint）
git commit -m "fix(excel-exporter): tighten exports and declare xlsx as optional peer dep"

# 3. 推送到远程 main
git push origin main
```

> 不要在本地手动跑 `pnpm release` 或 `npm publish`。发版只在 CI 里发生（见第 4、5 节），本地装好依赖、写好 changeset、push 即可。

---

## 4. CI/CD 自动化流程

推送后，GitHub Actions 会触发两条 workflow。来源 `.github/workflows/` 下两个文件。

### 4.1 CI Workflow —— 质量门禁

来源：`.github/workflows/ci.yml`

**触发条件：**

```yaml
on:
  pull_request: # 任何 PR
  push:
    branches: [main] # 推送到 main
```

**并发控制：**

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true # 同分支新推送会取消旧的运行
```

**执行步骤（顺序执行，任一失败即终止）：**

| 步骤 | 命令                             | 说明                                                       |
| ---- | -------------------------------- | ---------------------------------------------------------- |
| 1    | `actions/checkout@v4`            | 拉代码，`fetch-depth: 0`（全历史，commitlint 需要比对）    |
| 2    | `pnpm/action-setup@v4`           | 安装 pnpm，版本读 `packageManager`（9.12.0）               |
| 3    | `actions/setup-node@v4`          | Node 22，启用 pnpm 缓存                                    |
| 4    | `pnpm install --frozen-lockfile` | 按锁文件安装，CI 不允许锁文件漂移                          |
| 5    | `commitlint`（仅 PR）            | 校验 PR 中所有 commit message，`--from base.sha --to HEAD` |
| 6    | `pnpm lint`                      | turbo 跑各包 `eslint src`                                  |
| 7    | `pnpm typecheck`                 | turbo 跑各包 `tsc --noEmit`                                |
| 8    | `pnpm test`                      | turbo 跑各包 `vitest run`                                  |
| 9    | `pnpm build`                     | turbo 跑各包 `tsup` 构建，产物 `dist/**`                   |

> 注意：CI 里设了 `HUSKY: "0"`（来源 ci.yml 的 env），所以 CI 环境不会触发 husky hooks，质量检查由 workflow 自己跑。

> **commitlint 在 CI 里只对 PR 生效**：ci.yml 的 commitlint 步骤带 `if: github.event_name == 'pull_request'`。第 3.4 节的 happy path 是 `git push origin main` 直推——直推不触发 PR 事件，commitlint 在 CI 里不会跑。此时 commit message 的唯一约束是本地 `.husky/commit-msg`，`--no-verify` 或 GitHub 网页端编辑都能绕过。要让 commit 规范在服务端强制生效，改为走 PR 流程合并代码。

### 4.2 Release Workflow —— 自动发版

来源：`.github/workflows/release.yml`

**触发条件：**

```yaml
on:
  push:
    branches: [main] # 仅推送到 main
```

**并发控制：**

```yaml
concurrency: { group: release, cancel-in-progress: false }
```

> 与 CI 不同，`cancel-in-progress: false` 意味着不会取消正在进行的发布，保证发版完整性。

**权限声明（来源 release.yml `permissions`）：**

```yaml
permissions:
  contents: write # 推送 commit（版本号、CHANGELOG）
  pull-requests: write # 创建 Version PR
  id-token: write # npm provenance 需要 OIDC token
```

这三项各自对应什么操作、为什么需要，见第 6 节。

### 4.3 Changesets Action 的两阶段逻辑

release.yml 的核心步骤：

```yaml
- name: Create Release Pull Request or Publish
  uses: changesets/action@v1
  with:
    publish: pnpm release
    version: pnpm version-packages
    commit: "chore: release packages"
    title: "chore: release packages"
```

Action 内部逻辑（`changesets/action` 的标准行为）：

**情况一：main 上有待消费的 changeset 文件**

→ Action 执行 `pnpm version-packages`（= `changeset version`，来源 `package.json` scripts）：

- 读取 `.changeset/*.md`
- 给受影响的包 bump 版本号（写入 `package.json`）
- 生成 / 追加 `CHANGELOG.md`
- 删除已消费的 changeset 文件
- 把这些改动作为一个 commit，开一个标题为 "chore: release packages" 的 Pull Request

> **Version PR 不跑质量检查**：`changeset version` 只做版本号 bump 和 CHANGELOG 生成，不执行 lint / typecheck / test / build。所以「Version PR 存在」不等于「代码能编译」。真正的兜底是合并后情况二的 `pnpm release`——它先跑 `turbo run lint typecheck test build`，全过才 `changeset publish`。审查 Version PR 时注意：它只含版本号和 changelog 改动，没有跑过任何测试。

**情况二：main 上没有待消费的 changeset 文件**

→ 说明所有变更都已版本化，Action 执行 `pnpm release`（来源 `package.json` scripts）：

```
turbo run lint typecheck test build && changeset publish
```

即：先跑 lint → typecheck → test → build，全过后再 `changeset publish`（最终调用 `npm publish`）把包发到 npm。

---

## 5. 完整发布时间线

以下是从本地 push 到包出现在 npm 的完整过程：

> **CI 与 Release 并行，不是串行**：ci.yml 和 release.yml 的触发条件都是 `on: push: branches: [main]`（来源：两个 workflow 文件）。push 到 main 的那一刻两条 workflow 同时起跑，互不阻塞。CI 失败不会阻止 Release workflow 开 Version PR。真正的代码质量兜底是最后一步 `pnpm release` 里的 `turbo run lint typecheck test build`（见下方第 6 步）——它全过才 `changeset publish`。

```
本地                          GitHub                          npm
────                          ──────                          ───

1. pnpm changeset
   （生成 .changeset/xxx.md）

2. git add .changeset/
   git commit -m "fix(...): ..."
   git push origin main
                          ────→  3. push 到 main，CI 与 Release 同时触发（互不阻塞）：
                                    ├─ CI workflow
                                    │    lint / typecheck / test / build
                                    │    （结果不拦截 Release）
                                    │
                                    └─ Release workflow
                                         检测到 .changeset/ 有文件
                                         执行 changeset version
                                         开 Version PR
                                         "chore: release packages"
   ←────                        4. 你在 GitHub 收到 PR 通知
                                      审查版本号、CHANGELOG
                                      （注意：Version PR 本身不跑 lint/test，
                                       见第 4.3 节「Version PR 不跑质量检查」）

   5. 点击 Merge PR
                          ────→  6. 合并 = 再次 push 到 main，Release workflow 再触发
                                    检测到 .changeset/ 已空
                                    执行 pnpm release
                                    turbo lint typecheck test build  ← 发版前最终质量兜底
                                    changeset publish                  （全过才发布）
                                                            ────→ 7. npm publish
                                                                   @marcusok/excel-exporter
                                                                   版本号 +1
```

**关键点：每次发版要碰 main 两次：**

1. 第一次：你推送带 changeset 的代码 → CI 与 Release 同时触发，机器人开 Version PR
2. 第二次：你合并 Version PR（合并即产生一次 push 到 main）→ Release workflow 执行 `pnpm release`（含 lint/typecheck/test/build 兜底），全过后 `npm publish`

---

## 6. 发版前提条件（一次性配置）

> 配好之后日常发版不再需要动这一节。第一次发布前逐项确认。

### 6.1 npm 账号与发布 token（必填）

发版最后一步是 `changesets publish` → `npm publish`，必须用 npm token 认证（来源 release.yml：`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`，由 `setup-node` 的 `registry-url` 写入 `~/.npmrc`）。没有 token → 报 401。

**没有 npm 账号，先注册：**

1. 打开 `https://www.npmjs.com/signup`
2. 填写：
   - **Username**：会是你包的 scope 名（当前包是 `@marcusok/excel-exporter`，确认 scope 对得上），选好改不了
   - **Email**：用来收验证邮件
   - **Password**：要有大小写字母和数字
3. 勾选同意条款，Create Account
4. npm 发验证邮件，点里面的 **Verify Email Address** 链接（没收到查垃圾邮件箱）
5. 开 2FA：登录后头像 → **Account** → 左侧 **Two-Factor Authentication** → **Enable 2FA**，用手机上 Google Authenticator / Authy / 1Password 等 app 扫码，输入生成的 6 位验证码确认

**创建发布 token：**

release.yml 最终靠 `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` 认证（来源 release.yml env），由 setup-node 的 `registry-url` 写入 `~/.npmrc`。任何类型的 npm token 都能配合它工作。

npm 网站创建 token 时有两类可选，**关键约束是 2FA**：账号开了 2FA 后，普通的 read-write token 在 `npm publish` 时要求输入验证码，CI 里没人能输——必须用能绕过 2FA 的 token。

| 类型                      | 适合 CI？    | 说明                                                                        |
| ------------------------- | ------------ | --------------------------------------------------------------------------- |
| **Classic — Automation**  | 可以         | 专为自动化发布设计，天然绕过 2FA，配置最简单。缺点是不能限定 scope 和有效期 |
| **Granular Access Token** | 可以（推荐） | 可限定 scope（`@marcus`）、设有效期、勾选 bypass 2FA。最小权限原则下首选    |

> 下面以 **Granular Access Token** 为例（可限定范围，更安全）。想省事用 Classic — Automation 也行，创建后同样存为 `NPM_TOKEN`。

1. 登录 npmjs.com，点右上角头像 / 首字母圆圈 → **Access Tokens**（URL 变成 `https://www.npmjs.com/settings/<你的用户名>/tokens`）
2. 点 **Generate New Token** → 选 **Granular Access Token**
3. 填写：
   - **Token name**：随便起，例如 `marcus-monorepo CI publish`
   - **Expiration**：建议设 1 年，到期前回来换新
   - **Packages and scopes**：权限选 **Read and write**，把 scope 加进来（`@marcus`，或具体到 `@marcusok/excel-exporter`）
   - 账号开了 2FA 的话：勾选 **Allow bypass 2FA for this token**（或同类字样）—— 否则 CI 里没人能输入验证码，`npm publish` 会被 2FA 拦
4. 点 **Generate Token**
5. 页面顶部出现绿色提示，里面是一串 `npm_` 开头的字符串，**立刻复制**——这串只在这一次显示，刷新或关闭页面后 npm 不会再展示

### 6.2 把 token 存为 GitHub Secret（名称必须叫 `NPM_TOKEN`）

1. 浏览器打开你的仓库页 `https://github.com/<你的org>/<你的repo>` → 顶部 **Settings** tab
2. 左侧竖排菜单，往下找到 **Secrets and variables**（钥匙图标），点它展开 → 点 **Actions**
3. 页面中间标题 **Repository secrets**，右边绿色按钮 **New repository secret**，点它
4. 弹出两栏：
   - **Name** 填 `NPM_TOKEN`（必须完全一致，大小写也要对）
   - **Secret** 粘贴 `npm_xxxxxxxxxxxx`
5. 点绿色 **Add secret**

完成后列表多一行 `NPM_TOKEN`，值显示为 `****`。从这一刻起 release.yml 里的 `${{ secrets.NPM_TOKEN }}` 就能拿到它了。

### 6.3 `CHANGESETS_GITHUB_TOKEN`：让 Version PR 能跑 CI（建议配置）

release.yml 用这个值开 Version PR 并推代码：

```yaml
GITHUB_TOKEN: ${{ secrets.CHANGESETS_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}
```

**为什么不能只用默认 `GITHUB_TOKEN`：** GitHub 有一道防递归机制——用 `GITHUB_TOKEN` 触发的事件（开 PR、push）不会再次触发其他 workflow（官方文档：Triggering a workflow from a workflow）。Changesets 用 `GITHUB_TOKEN` 开的 "chore: release packages" PR **不会跑 ci.yml**。如果 main 设了 branch protection、把 CI 设为必需检查，这个 PR 永远凑不齐 → 合不了 → 发布卡死。

表达式做了优雅降级：配了 PAT 就用 PAT，没配就退回默认 token（PR 照开，只是 CI 不在 PR 上跑，流程不报错）。所以可以先不配，配了就生效。

**创建 fine-grained PAT：**

1. GitHub → 头像 → **Settings** → 左侧最下方 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. **Repository access**：选 Only select repositories → 选 marcus-monorepo 仓库
3. **Permissions**（Repository permissions 下）：**Contents = Read and write**，**Pull requests = Read and write**
4. 生成后复制 `github_pat_` 开头的字符串
5. 按 6.2 同样的路径存为 Secret，**Name 填 `CHANGESETS_GITHUB_TOKEN`**

### 6.4 npm Provenance（来源真实性签名）

来源 release.yml env：`NPM_CONFIG_PROVENANCE: "true"`。

它告诉 npm：发布时记录来源（哪个 GitHub 仓库、哪个 workflow）。实现方式是 GitHub Actions 生成一个 OIDC (OpenID Connect) token（含仓库名、workflow 文件名、Git ref 等信息），npm 用它做来源验证和签名。生成 OIDC token 需要 `id-token: write` 权限（已在 release.yml permissions 声明）。不开这个权限，npm publish 会因为无法获取 provenance 信息而失败。

> npm 账号如果开了 2FA，要用支持 bypass 2FA 的 token（见 6.1 第 3 步），否则 CI 里没人能输入验证码，publish 会被拦。

### 6.5 GitHub Actions 仓库侧权限设置

位置：仓库 **Settings** → 左侧 **Actions** → **General**，页面下方 **Workflow permissions** 区域。两项都要看：

**第一步 — 允许 Actions 创建 PR（必须勾）：**

标题为 **Allow GitHub Actions to create and approve pull requests** 的复选框，**勾选它**。不勾的话，Changesets 用 `GITHUB_TOKEN` 调 GitHub API 开 Version PR 会被拒，Release workflow 报：

```
HttpError: Resource not accessible by integration
```

**第二步 — Workflow permissions（建议选 Read and write）：**

两个单选项里选 **Read and write permissions**。

说明：`release.yml` 已经用 `permissions:` 显式声明了 `contents / pull-requests / id-token: write`，按 GitHub 规则，workflow 里的 `permissions:` 会覆盖仓库默认值，所以理论上即使仓库默认是只读，这三项写权限也拿得到；但选 Read and write 是最稳妥的通用做法。

两项都改完后，滚动到页面最底部点绿色 **Save**（GitHub 的 Settings 页面每个区块都是独立保存的，不点不生效）。

> 如果 Settings tab 不显示，说明你不是仓库管理员，需要找 owner 操作。

**三项权限各自对应什么操作**（来源 release.yml `permissions`）：

| 权限                   | 对应操作                                                     | 没有会怎样                             |
| ---------------------- | ------------------------------------------------------------ | -------------------------------------- |
| `contents: write`      | Changesets 把版本号 / CHANGELOG 的改动 push 回 main          | git push 那一步报 403                  |
| `pull-requests: write` | Changesets 通过 GitHub API 创建 "chore: release packages" PR | API 返回 403，PR 创建失败              |
| `id-token: write`      | GitHub Actions 生成 OIDC token 供 npm provenance 签名        | publish 因无法获取 provenance 信息失败 |

### 6.6 常见问题

**Q：我只改了 Workflow permissions 为读写，没勾「允许 Actions 创建 PR」，会怎样？**

CI 工作流（`ci.yml`）不受影响，它不需要创建 PR。但 Release workflow 会在 "Create Release Pull Request" 步骤报错，日志显示类似 `HttpError: Resource not accessible by integration`——因为 Changesets 调 GitHub API `POST /repos/{owner}/{repo}/pulls` 被拒绝了。

**Q：provenance 不开行不行？**

可以。把 release.yml 里 `NPM_CONFIG_PROVENANCE: "true"` 改成 `"false"` 或删掉，就不再需要 `id-token: write` 权限了。但保留 provenance 是 npm 推荐的安全实践，能让使用者验证包来源，建议保留。

---

## 7. 验证配置是否生效

> **危险：changeset 不分「测试」和「正式」。** 任何 `.changeset/*.md` 文件只要推到 main，Release workflow 就会消费它开 Version PR；一旦 Merge 那个 PR，包就会按 changeset 里的级别真实发到 npm。下面的验证步骤里，凡是生成了 changeset 的，验证完必须删掉或关闭对应 PR，绝不能 Merge。

### 7.1 先清理：检查 main 上有没有残留的测试 changeset

仓库 `origin/main` 上当前有一条测试残留 `.changeset/funny-pugs-leave.md`（内容「测试提交」，`@marcusok/excel-exporter: patch`）——是旧版文档的验证步骤留下的。只要它还在，下一次任何 push 到 main 都会触发 Release workflow 开一个带「测试提交」的 Version PR。正式发版前删掉它：

```bash
git rm .changeset/funny-pugs-leave.md   # 如果已暂存删除，确认 push 即可
git commit -m "chore: remove leftover test changeset"
git push origin main
```

### 7.2 验证 workflow 基础设施（不发版，零风险）

确认 `.changeset/` 下没有任何 `.md` 文件后，推一个无关紧要的改动（如 README 加一行注释），看 Release workflow 能否跑通：

```bash
ls .changeset/*.md            # 必须没有输出（config.json 不算）
# 改一个无关文件，比如 README.md
git add README.md
git commit -m "docs: ci smoke test"
git push origin main
```

push 后去 GitHub Actions 看：Release workflow 触发 → 检测到没有待消费 changeset → 执行 `pnpm release`（`turbo run lint typecheck test build && changeset publish`）。因为没有版本号变化，`changeset publish` 是 no-op——日志里不会 publish 任何包，流程跑完即止。这验证了 workflow 能触发、依赖能装、质量检查能跑，且**不会发版**。

### 7.3 验证 Version PR 创建（看完必须清理）

要确认「Changesets 能开 Version PR」这条链路，才需要造一个 changeset：

```bash
pnpm changeset                # 选 patch，描述写 "verify release pipeline"
git add .changeset/
git commit -m "chore: verify release pipeline"
git push origin main
```

push 后 Release workflow 会开一个 "chore: release packages" PR。**看到 PR 创建成功就证明链路通了——立刻关闭这个 PR（不要 Merge），并删除该 changeset：**

```bash
# 在 GitHub 上关闭（不要 Merge）那个 "chore: release packages" PR
git rm .changeset/<你刚生成的文件>.md
git commit -m "chore: cleanup verification changeset"
git push origin main
```

如果到时间没创建 PR，去 Actions → Release workflow 运行记录，看哪个步骤报错（常见：第 6.5 节的权限没配）。

---

## 8. 核心脚本速查

来源 `package.json` `scripts`：

| 命令                    | 实际执行                                                   | 用途                                                                 |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm changeset`        | `changeset`                                                | 交互式生成 changeset                                                 |
| `pnpm version-packages` | `changeset version`                                        | 消费 changeset，写版本号 + CHANGELOG（本地一般不用，由 action 执行） |
| `pnpm release`          | `turbo run lint typecheck test build && changeset publish` | 完整质量检查 + 发 npm（由 action 执行）                              |
| `pnpm build`            | `turbo run build`                                          | 构建所有包                                                           |
| `pnpm test`             | `turbo run test`                                           | 测试所有包                                                           |
| `pnpm lint`             | `turbo run lint`                                           | ESLint 所有包                                                        |
| `pnpm typecheck`        | `turbo run typecheck`                                      | TS 类型检查所有包                                                    |
| `pnpm format`           | `prettier --write "**/*.{ts,tsx,js,json,md}"`              | 格式化                                                               |
