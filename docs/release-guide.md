# 从写代码到发布 npm：完整流程详解（小白版）

> 这篇文档假设你完全不懂 CI/CD、npm 发布、Git 的高级用法。每个术语都会解释，每个命令都会说"为什么"。照着做就能把代码安全地发布到 npm。
>
> 本文档基于 `docs/debug.md` 里记录的真实排障过程写成——里面每一个"注意"都是真实踩过的坑。

---

## 先认识几个"角色"

在看流程前，先搞懂有几个工具/服务在参与，它们各干什么。这一节不涉及操作，只是让你心里有数。

| 角色                   | 是什么                    | 在流程里干什么                                      |
| ---------------------- | ------------------------- | --------------------------------------------------- |
| **Git**                | 版本管理工具              | 记录你每次代码改动，能回到任意历史版本              |
| **GitHub**             | 存放代码的网站            | 存仓库、跑自动化脚本（Actions）、管 PR              |
| **GitHub Actions**     | GitHub 提供的自动化机器人 | 你 push 代码后，它自动在云端跑测试、发版            |
| **pnpm**               | 包管理器（类似 npm/yarn） | 装依赖、跑脚本。本项目用它                          |
| **Turborepo**（turbo） | 多包仓库的"任务调度员"    | 一条命令跑所有子包的 lint/test/build                |
| **Changesets**         | 发版助手                  | 管理版本号怎么涨、CHANGELOG 写什么、自动开"发版 PR" |
| **Husky**              | Git 钩子管家              | 你 commit 时自动跑检查（格式、提交信息规范）        |
| **npm**                | JavaScript 的包仓库网站   | 最终包要发到这里，别人才能 `npm install` 装到       |
| **Vitest**             | 测试运行器                | 跑你的单元测试                                      |

一个关键认知：**GitHub Actions 跑在 GitHub 的电脑上，不是你的电脑上**。所以本地能跑通的，到 GitHub 那台电脑上不一定能跑通（它可能更慢、环境不同）。这是后面很多坑的根源。

---

## 全局地图：一张图看懂整个流程

```
你的电脑                        GitHub（云端）                    npm（网站）
────────                        ────────────                      ──────────

[1] 写代码
[2] 本地跑测试
    （lint/test/build）
[3] 写 changeset
    （要发版时才写）
[4] git commit
    └─ husky 自动检查
[5] git push ──────────────────→ [6] 两条机器人流水线同时启动：
                                     ├─ CI：跑质量检查（lint/test/build）
                                     │   （失败不影响发版，只是亮红灯）
                                     └─ Release：发版机器人
                                         │
                                         ├─ 有 changeset？
                                         │   是 → 消费它，开一个"发版 PR"
                                         │        （PR 里只有版本号和 CHANGELOG 改动）
                                         │        等你审核
                                         │
                                         │   否 → 执行 npm publish
                                         │
[7] 你在网页审核 PR ←──────────────  开出 "chore: release packages" PR
[8] 你点 Merge ────────────────→  合并 = 又一次 push 到 main
                                     └─ Release 再次启动
                                         这次没有 changeset
                                         → 执行 pnpm release
                                           = 跑质量检查 + npm publish
                                                                    [9] 包出现在 npm
                                                                        @marcusok/xxx
```

**核心要点**：每次发版要"碰" main **两次**：

1. 第一次：你推带 changeset 的代码 → 机器人开"发版 PR"。
2. 第二次：你合并那个 PR → 机器人执行真正的 npm publish。

为什么是两次？因为 Changesets 的设计是：先让你看一眼"版本号要怎么涨、更新日志写什么"，确认没问题，再真正发布。

---

# 第一部分：一次性准备（只做一次，以后不用重复）

这一部分是"开机配置"，配好之后日常发版就不用再动了。

## 1.1 本地环境

**Node.js**：装 22 版（见 `.nvmrc` 文件，里面写 `22`）。用 nvm 管理：

```bash
nvm install 22
nvm use 22
```

**pnpm**：通过 corepack 启用（Node 自带 corepack）：

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
```

为什么是 9.12.0？因为 `package.json` 里 `packageManager` 字段写死了这个版本，所有人、CI 都用同一个版本，避免"我这能跑你那不能跑"。

**验证**：

```bash
node -v    # 应显示 v22.x.x
pnpm -v    # 应显示 9.12.0
```

**装项目依赖**（在仓库根目录）：

```bash
pnpm install
```

这一步会读 `package.json` 和 `pnpm-lock.yaml`，装好所有依赖，并自动跑 `husky` 安装（`prepare` 脚本）把 Git 钩子装上。

## 1.2 GitHub 仓库设置

仓库网页 → **Settings** → **Actions** → **General** → 滚到 **Workflow permissions** 区域：

1. **勾上** "Allow GitHub Actions to create and approve pull requests"。
   - 为什么：发版机器人要用这个权限去开"发版 PR"。不勾，它会报 `Resource not accessible by integration`，PR 开不出来。
2. **选** "Read and write permissions"。
3. 滚到该区域底部，点 **Save**。
   - 注意：这个页面每个区块是独立保存的，不点 Save 不生效。

## 1.3 npm 账号准备（最容易踩坑的一步，仔细看）

发版的终点是 npm，所以 npm 那边要配好三件事：**账号 + scope 归属 + token**。

### 1.3.1 注册 npm 账号

去 [npmjs.com/signup](https://www.npmjs.com/signup) 注册。

> ⚠️ **大坑（真实踩过）**：npm 的 scope（包名里 `@` 后面那部分）归属规则是死的——`@xxx` 这个 scope 只属于**用户名或 org 名等于 `xxx`** 的账号。
>
> 比如本项目包叫 `@marcusok/excel-exporter`，那 `@marcusok` 这个 scope 必须归你。两种方式：
>
> - 你的 npm **用户名**就是 `marcusok`；或
> - 你在 npm 建一个 **组织（org）** 叫 `marcusok`。
>
> 如果你的用户名是别的（比如 `marcus_w`），那 `@marcus` 这个 scope 就不属于你，发布会报 403。本项目就是因为这个原因，专门建了 `marcusok` 这个 org。

**如果包名里的 scope 还没归你，先建 org**：登录 npm → 头像 → **Create an Organization** → 名字填 scope 名（本项目是 `marcusok`）。

### 1.3.2 开 2FA（强烈建议）

登录 npm → 头像 → **Account** → **Two-Factor Authentication** → Enable。用手机验证器 app 扫码。

为什么：账号安全。但开了 2FA 后，CI 里的 `npm publish` 没法输验证码，所以下一步的 token 要能绕过 2FA（见 1.3.3 的"勾选 bypass 2FA"）。

### 1.3.3 创建发布 token

> ⚠️ **大坑（真实踩过）**：token 要在 scope 归属确认**之后**再建。如果先建 token、后建 org，token 的权限边界里不会包含那个 scope，发布会报 `E404 Not Found`（看起来像"包不存在"，其实是"token 没这个 scope 的权限"）。

登录 npm → 头像 → **Access Tokens** → **Generate New Token** → 选 **Granular Access Token**：

- **Token name**：随便，比如 `marcus-monorepo CI publish`
- **Expiration**：设 1 年（到期前回来换）
- **Packages and scopes**：权限选 **Read and write**，把 scope 加进来（`@marcusok`，或具体到 `@marcusok/excel-exporter`）
- 账号开了 2FA 的话：**勾上** "Allow bypass 2FA for this token"——不勾，CI 里没人工输验证码，`npm publish` 会被 2FA 拦
- 点 Generate Token
- 页面顶部出现 `npm_` 开头的串，**立刻复制**——只显示这一次，关掉就再也看不到

> 备选：嫌麻烦可以用 **Classic → Automation** 类型 token，它天然绕过 2FA、不限定 scope，配置最简单。缺点是不能限定范围、设有效期。

## 1.4 GitHub Secrets（把 token 安全地告诉 GitHub）

GitHub Actions 跑在云端，要发版就得知道你的 npm token。但 token 是密码，不能写在代码里（会被别人看到）。GitHub 提供 **Secrets**（加密存储，日志里只显示 `***`）。

仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**：

| Secret 名                               | 值                   | 干什么用                           |
| --------------------------------------- | -------------------- | ---------------------------------- |
| `NPM_TOKEN`                             | 刚才复制的 `npm_...` | 给 `npm publish` 做认证            |
| `CHANGESETS_GITHUB_TOKEN`（可选但推荐） | 一个 GitHub PAT      | 让发版机器人开的 PR 能触发 CI 检查 |

**NPM_TOKEN** 是必填的，没有它 publish 会报 401。

**CHANGESETS_GITHUB_TOKEN** 解释：发版机器人用 GitHub 默认 token 开的 PR，**不会触发 CI**（GitHub 有防递归机制：机器人触发的事件不再触发别的机器人）。如果你将来给 main 分支加了保护、把 CI 设成合并前必过，那机器人开的 PR 就永远绿不了、合不了。配一个 PAT（Personal Access Token）能绕过这个限制：

- GitHub 头像 → Settings → Developer settings → Personal access tokens → Fine-grained → Generate
- Repository access：Only select repositories → 选你的仓库
- Permissions：Contents = Read and write，Pull requests = Read and write
- 复制 `github_pat_` 开头的串，存为 secret `CHANGESETS_GITHUB_TOKEN`

`release.yml` 里已经写好了 `CHANGESETS_GITHUB_TOKEN || GITHUB_TOKEN` 的回退：配了 PAT 就用 PAT，没配就退回默认 token（PR 照开，只是不触发 CI）。

---

# 第二部分：日常开发（每次改代码都走这个循环）

配置都弄好之后，日常就重复这个循环。

## 2.1 写代码

在 `packages/excel-exporter/src/` 下改你的代码。

## 2.2 本地跑质量检查（提交前必做）

```bash
pnpm lint        # 代码风格检查（ESLint）
pnpm typecheck   # TypeScript 类型检查
pnpm test        # 跑单元测试（Vitest）
pnpm build       # 构建产物（tsup，产出 dist/）
```

> ⚠️ **重要**：本地验证必须走**根目录的 `pnpm xxx`**（它会经过 turbo 调度），不要 cd 到 `packages/excel-exporter` 里直接跑。
>
> 为什么（真实踩过的坑）：CI 走的是根目录 `pnpm test` = `turbo run test`，中间隔着 turbo。turbo 默认会**过滤没在 turbo.json 声明的环境变量**。如果你在子目录直接跑 vitest，绕过了 turbo，本地"通过"的验证到 CI 上可能失效。**本地怎么验证，CI 就怎么跑，路径要完全一致**。

一条命令全跑：

```bash
pnpm exec turbo run lint typecheck test build --force
```

`--force` = 忽略缓存，强制重跑（turbo 有缓存机制，平时能加速，但想确认"真的能跑通"时加这个）。

## 2.3 写 changeset（要发版时才做这一步）

> **什么时候写 changeset**：当这次代码改动要让 npm 上的包**版本号上涨**时，才写。纯改文档、改测试、内部重构不想发版，就不写。

changeset 是发版的"说明书"，告诉 Changesets：这次改动影响哪个包、版本怎么涨、CHANGELOG 写什么。

```bash
pnpm changeset
```

交互式选择：

1. 选影响的包（本项目是 `@marcusok/excel-exporter`）
2. 选版本级别：`patch`（修小 bug）/ `minor`（新功能）/ `major`（破坏性改动）
3. 写一句 changelog 描述（建议用英文，避免编码问题）

完成后会在 `.changeset/` 下生成一个随机命名的 `.md` 文件。

> ⚠️ **坑（真实踩过）**：`pnpm changeset` 命令不要拿来"测试"，因为生成的文件只要推到 main，机器人就会消费它、真的发版。验证流程时如果生成了 changeset，验完**一定要删掉**，别误发版。
>
> 看 `.changeset/` 下有哪些文件：`ls .changeset/*.md`（除了 `config.json`）。正式发版前确认里面只剩你真正想发的。

## 2.4 暂存改动

```bash
git add -A
```

`-A` = 所有改动（新增、修改、删除）都纳入暂存区。用 `git status` 复查一眼，确认没漏没多。

## 2.5 提交（commit）

```bash
git commit -m "fix(excel-exporter): 修复了某个问题"
```

**提交信息必须符合格式 `type(scope): subject`**，否则会被拦下来：

| 部分    | 说明     | 例子                                                                                                                    |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| type    | 改动类型 | `fix`（修 bug）/ `feat`（新功能）/ `docs`（文档）/ `chore`（杂务）/ `refactor`（重构）/ `test`（测试）/ `ci`（CI 配置） |
| scope   | 影响范围 | `excel-exporter`                                                                                                        |
| subject | 简短描述 | 小写开头，**不加句号**                                                                                                  |

提交时会自动触发两个钩子（husky 装的），你不用手动干预：

- **pre-commit**：跑 `lint-staged`，对你改的文件做 `eslint --fix` + `prettier --write`（自动修正格式）。
- **commit-msg**：跑 `commitlint`，检查提交信息格式对不对。格式错了会报错、中止提交，改对再 commit。

> 这两个钩子只在本地拦你。CI 里设了 `HUSKY: "0"` 跳过 husky 钩子，但 CI workflow 里有独立的 commitlint 步骤（仅 PR 时跑，检查提交信息）和独立的 lint 步骤——该查的 CI 自己查，只是不走 husky。

## 2.6 推送（push）

```bash
git push origin main
```

push 到 main 的瞬间，GitHub 上两条机器人流水线**同时启动**（见第三部分）。

---

# 第三部分：自动发布（push 后自动发生，你只需要在网页点几下）

## 3.1 两条流水线同时跑

push 到 main 后，GitHub Actions 同时启动两个 workflow：

### CI 流水线（`ci.yml`）——质量检查

跑 `pnpm install` → `commitlint`（仅 PR 时）→ `lint` → `typecheck` → `test` → `build`。

- commitlint 这一步只在 **PR** 时跑，检查 PR 里所有提交信息格式；直接 push 到 main 不跑。
- 失败了**只是亮红灯**，不会阻止发版（它和 Release 互不影响）。
- 它的作用是让你在网页上一眼看到代码质量有没有问题。

### Release 流水线（`release.yml`）——发版机器人

这是发版的核心。它内部有个判断分支：

**分支 A：`.changeset/` 里有待消费的 changeset 文件**

机器人执行 `changeset version`：

- 读 `.changeset/*.md`
- 给包涨版本号（写进 `package.json`）
- 生成/追加 `CHANGELOG.md`
- 删掉已消费的 changeset 文件
- 把这些改动打包成一个 commit，开一个标题 "chore: release packages" 的 **Pull Request（发版 PR）**

> **这个发版 PR 不跑质量检查**。它只有版本号和 CHANGELOG 的改动。"代码能不能编译"的真正把关，在分支 B（合并后）的 `pnpm release` 里。

**分支 B：`.changeset/` 是空的**

机器人执行 `pnpm release`，等价于：

```
turbo run lint typecheck test build && changeset publish
```

先跑质量门禁（lint→typecheck→test→build），**全过**才执行 `changeset publish`（最终调用 `npm publish` 把包发出去）。

> ⚠️ **关键理解**：`&&` 表示"前面全过了才跑后面"。所以如果 test 挂了，`changeset publish` 根本不会执行——包不会被发出去。这是质量门禁的护栏。前面踩的坑就是 test 里的性能测试挂了，把 publish 挡住。

## 3.2 你要做的：审核并合并发版 PR

当机器人开出 "chore: release packages" PR 后：

1. 去 GitHub 仓库的 **Pull requests** tab，找到这个 PR。
2. 看一眼里面的改动：版本号对不对、CHANGELOG 写得对不对。
3. 确认没问题，点 **Merge pull request**。

> ⚠️ **注意**：合并这个 PR = 往 main 又 push 了一次 = Release 流水线**再次启动**。这次 `.changeset/` 已经空了（机器人之前删掉了），所以走分支 B，执行真正的 `pnpm release` → `npm publish`。
>
> 这就是为什么"每次发版要碰 main 两次"。

## 3.3 包出现在 npm

合并后，Release 跑完 `pnpm release`，`npm publish` 成功，包就出现在 npm 上了：

- 网页：[npmjs.com/package/@marcusok/excel-exporter](https://www.npmjs.com/package/@marcusok/excel-exporter)
- 验证：`npm view @marcusok/excel-exporter`

---

# 完整时间线：一次真实发版的全程

以"修了一个 bug 要发版"为例，从开始到包出现在 npm：

```
你                              GitHub 云端                         npm 网站
─                               ─────────                           ────────

1. 改代码
2. pnpm test（本地验证）
3. pnpm changeset
   （选 patch，写描述）
4. git add -A
5. git commit
   └─ husky 自动检查格式
6. git push origin main ───────→ 7. CI + Release 同时启动
                                     │
                                     ├─ CI：lint/test/build
                                     │   （亮绿灯或红灯，不影响发版）
                                     │
                                     └─ Release：发现 .changeset/ 有文件
                                         → changeset version
                                         → 开 "chore: release packages" PR
8. 收到 PR 通知 ←────────────────
9. 审核 PR（版本号、CHANGELOG）
10. 点 Merge ──────────────────→ 11. 合并 = 又一次 push 到 main
                                      → Release 再次启动
                                      这次 .changeset/ 空
                                      → pnpm release
                                        = turbo lint/typecheck/test/build
                                        （全过才继续）
                                        && changeset publish
                                                                      12. 包出现
                                                                          @marcusok/
                                                                          excel-exporter
                                                                          版本号 +1
```

**耗时参考**：从 push 到包出现在 npm，如果一切顺利，大概 5 到 10 分钟（CI 跑 2 到 4 分钟 + 你审核 PR 的时间 + Release 再跑 2 到 4 分钟）。

---

# 第四部分：常见坑速查表

下面这些都是真实踩过的坑，按"看到的报错"反查"原因和解法"。

## 4.1 push 后 CI 红灯

| 你看到的                                                | 原因                             | 解法                                                       |
| ------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| `expected X to be less than Y`（performance 测试）      | CI 电脑比你慢，性能测试超时      | 性能测试在 CI 跳过：`RUN_PERF=0`（已配）                   |
| perf 测试明明该跳过却还在跑                             | turbo 过滤了 `RUN_PERF` 环境变量 | 确认 `turbo.json` 的 `globalEnv` 里有 `"RUN_PERF"`（已配） |
| 本地能过、CI 过不了                                     | 你在子目录直接跑，绕过了 turbo   | 本地验证走根目录 `pnpm xxx`，和 CI 一致                    |
| `ERR_PNPM_OUTDATED_LOCKFILE` / `--frozen-lockfile` 失败 | 锁文件和 package.json 不同步     | 本地 `pnpm install` 更新锁文件后提交                       |

## 4.2 push 后 Release 失败

| 你看到的                                            | 原因                                             | 解法                                                  |
| --------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `HttpError: Resource not accessible by integration` | 仓库没开"允许 Actions 建 PR"                     | Settings → Actions → General → 勾上对应选项（见 1.2） |
| `Publish command exited with code 1`                | 质量门禁（lint/test/build）挂了，把 publish 挡住 | 看具体是哪步挂，先修代码                              |
| `E401` / `ENEEDAUTH`                                | NPM_TOKEN 不存在或无效                           | 去 GitHub Secrets 确认 NPM_TOKEN 存在且有效           |
| `E403 Forbidden`                                    | npm scope 不归你                                 | 确认 npm 上 scope 归属（见 1.3.1）                    |
| `E404 Not Found` on PUT                             | NPM_TOKEN 没有 scope 的发布权限                  | 重建 token，确保覆盖该 scope（见 1.3.3）              |

## 4.3 push 本身失败

| 你看到的                                  | 原因                                 | 解法                                               |
| ----------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| `! [rejected] main -> main (fetch first)` | 远程有你没有的提交（可能机器人推过） | `git pull --rebase origin main` 再 push            |
| rebase 时冲突                             | 本地和远程改了同一处                 | 手动解决冲突，`git add` 后 `git rebase --continue` |

## 4.4 commit 失败

| 你看到的         | 原因                                            | 解法                                         |
| ---------------- | ----------------------------------------------- | -------------------------------------------- |
| commitlint 报错  | 提交信息格式不对（不是 `type(scope): subject`） | 改成正确格式，小写开头，不加句号             |
| lint-staged 报错 | 代码有格式/语法问题                             | 按提示修，或它已自动 `--fix`，重新 `git add` |

---

# 第五部分：几个关键概念再解释一遍

## 5.1 为什么要有锁文件（pnpm-lock.yaml）

锁文件记录"每个依赖的确切版本"。没有它，今天装的依赖版本和明天可能不一样（依赖的作者发了新版），导致"我这能跑、你那不能跑"。锁文件锁死版本，保证所有人、CI 装的一模一样。

CI 用 `pnpm install --frozen-lockfile`——`--frozen-lockfile` 意思是"严格按锁文件装，锁文件和 package.json 不一致就报错"。所以你改了 package.json 的依赖，必须本地 `pnpm install` 更新锁文件，否则 CI 会挂。

## 5.2 为什么性能测试在 CI 上不可靠

GitHub Actions 的免费 runner 是"共享电脑"——同一台机器上跑着很多任务，CPU/内存随时被别人占用，性能波动很大。实测同一个测试，你本地 700ms，CI 上可能 2000ms、4000ms。

用"绝对时间"做断言（`期望耗时 < 1500ms`）在这种环境下必然时好时坏（flake）。所以本项目的做法：性能测试在 CI 上跳过（`RUN_PERF=0`），只在本地当"回归看门狗"用。

## 5.3 为什么环境变量要"层层放行"

从你设一个环境变量到它真正生效，要穿过多层进程：

```
GitHub Actions 步骤（设 RUN_PERF=0）
    ↓
pnpm（继承）
    ↓
turbo（这里会过滤！默认只放行 turbo.json 里声明过的）
    ↓
vitest（子进程，要拿到 RUN_PERF 才能决定跳不跳过）
```

turbo 这层默认是"严格模式"，没在 `turbo.json` 声明的变量一律过滤掉。所以改测试行为的环境变量，必须**同时在 turbo.json 的 globalEnv 里声明**，否则到 vitest 那层就没了。

## 5.4 changeset 和发版 PR 的关系

changeset 是"我打算发个版"的声明。它本身不改版本号。真正改版本号的是 `changeset version` 命令（机器人执行），它读 changeset、算版本、写 CHANGELOG，然后把这些改动开成一个 PR 让你审核。

你合并那个 PR，才触发真正的发布。所以 changeset 是"意图"，发版 PR 是"确认"，合并后的 publish 是"执行"。

---

# 速查：日常发版只需要这 6 步

配置都弄好后，每次发版就重复这个最小循环：

```bash
# 1. 改完代码，本地验证
pnpm exec turbo run lint typecheck test build --force

# 2. 写 changeset（不想发版就跳过这步）
pnpm changeset

# 3. 暂存 + 提交（husky 自动检查）
git add -A
git commit -m "fix(excel-exporter): 描述你的改动"

# 4. 推送
git push origin main

# 5. 去网页合并机器人开的 "chore: release packages" PR
# 6. 等 Release 跑完，包就出现在 npm 了
```

记住一句话：**本地怎么验证，CI 就怎么跑**。只要你本地在根目录用 `pnpm xxx` 跑通了，CI 基本就能过。
