# CI 工作流逐行解读（`.github/workflows/ci.yml`）

> 阅读对象：完全没接触过 GitHub Actions 的人。我会像讲给小学生听一样，每一步都先说"它在做什么"，再说"为什么要这么做"，并且每一条都能在本项目里找到对应的真实文件，不是凭空想象。

---

## 一、先认识三个"主角"

在看 workflow 之前，先把这个项目是什么搞清楚，否则后面看不懂。

1. **这是一个 monorepo（大仓库）**：名字叫 `marcus-monorepo`，里面目前只装了一个真正的工具包 `@marcusok/excel-exporter`（一个用 Rust+WASM 加速的高性能 Excel 导出库）。证据见 [pnpm-workspace.yaml](../pnpm-workspace.yaml)，里面写着 `packages/*`，意思是"packages 文件夹下的每一个子文件夹，都是一个独立的包"。
2. **它是用 pnpm + Turborepo 管理的**：根目录 [package.json](../package.json) 里 `"packageManager": "pnpm@9.12.0"`，并且所有命令（build/test/lint/typecheck）都是通过 `turbo run xxx` 来跑的（见 [turbo.json](../turbo.json)）。
3. **它最终会发布到 npm**：包名是 `@marcusok/excel-exporter`，当前版本 `1.0.3`（见 [packages/excel-exporter/package.json](../packages/excel-exporter/package.json)）。

打个比方：你写了一篇很长的作文，交给老师之前，你希望有个"自动批改机"先帮你检查错别字、检查格式对不对、检查有没有跑题。**CI 就是这个自动批改机**。每次你交作业（提交代码）的时候，它就自动开机检查一遍。

---

## 二、ci.yml 全文（先整体看一眼）

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    runs-on: ubuntu-latest
    env:
      HUSKY: "0"
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Lint commit messages
        if: github.event_name == 'pull_request'
        run: pnpm exec commitlint --from ${{ github.event.pull_request.base.sha }} --to HEAD
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
        env:
          RUN_PERF: "0"
      - run: pnpm build
```

下面逐块拆解。

---

## 三、`name: CI`

这只是给这个工作流起个名字，叫"CI"。CI 是 **Continuous Integration（持续集成）** 的缩写——意思是"代码一改动，就自动、持续地做集成检查"。你在 GitHub 网页的 Actions 标签页里，看到的就是这个名字。

---

## 四、`on:` —— 它什么时候开机？

```yaml
on:
  pull_request:
  push:
    branches: [main]
```

`on` 的意思是"触发条件"，也就是"什么情况下机器会自动启动"。这里规定了两种情况：

1. `pull_request:` —— 当有人发起一个 **Pull Request（简称 PR，合并请求）** 的时候。PR 就是你把自己分支上的代码，申请合并到主干上。这是最常见的检查时机：**合并之前先检查一遍**。
2. `push: branches: [main]` —— 当有人**直接往 main 分支推送代码**的时候（比如 PR 被合并、或有人直接 push）。

**注意一个细节**：普通的 PR 会触发，任何分支往 main 推送也会触发，但是"往别的分支 push"不会触发。这样能避免你在自己杂乱的试验分支上反复 push 时浪费机器时间。

---

## 五、`concurrency:` —— 防止"同一件事跑好几遍"

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

这段是用来**省资源**的。想象一下：你在一个 PR 上连续 push 了 3 次代码，机器就会启动 3 次检查。但其实前 2 次已经过时了（代码已经被第 3 次覆盖），跑它们纯属浪费电。

- `group: ci-${{ github.ref }}` —— 按分支（或 PR）分组。`github.ref` 在 PR 场景就是那个 PR 的引用。同一个分组里的任务，会被当成"同一件事"。
- `cancel-in-progress: true` —— 如果"同一件事"正在跑，又来了一个更新的，那就**把正在跑的那个取消掉**，只跑最新的。

效果：你在 PR 上狂 push 10 次，机器只会认真跑最后一次，前面的全被取消，既快又省钱。

---

## 六、`jobs:` → `quality:` —— 真正要干的活

```yaml
jobs:
  quality:
    runs-on: ubuntu-latest
```

一个 workflow 里可以有多个 job（工作），这里只有一个，起名叫 `quality`（质量检查）。

- `runs-on: ubuntu-latest` —— 这台"自动批改机"跑在 GitHub 免费提供的 Ubuntu Linux 服务器上。`ubuntu-latest` 就是"最新版的 Ubuntu 系统"。整个检查过程都在一台**干净的、临时的虚拟机**里完成，用完即销毁，不会影响你的电脑。

---

## 七、`env: HUSKY: "0"` —— 在 CI 里关掉本地钩子

```yaml
env:
  HUSKY: "0"
```

这一行很容易被忽略，但很重要。

本项目用了 **husky** 这个工具，它在本地会给 git 装上"钩子（hook）"——也就是你每次 `git commit` 的时候，它会自动拦截，先帮你跑一遍检查（见 [.husky/pre-commit](../.husky/pre-commit) 里写着 `pnpm exec lint-staged`，[.husky/commit-msg](../.husky/commit-msg) 里写着 `pnpm exec commitlint --edit $1`）。

但是在 CI 服务器上，我们**不想让这些钩子被触发**，原因有二：

- CI 里本来就有一堆明确的步骤要跑（lint / typecheck / test / build），钩子会重复、甚至干扰。
- 钩子在某些自动提交场景下会报错或卡住。

`HUSKY: "0"` 就是告诉 husky："请装作自己不存在"。这是 husky 官方推荐的、在 CI 里禁用钩子的标准做法。证据：[package.json](../package.json) 的 `"prepare": "husky"` 会在安装时初始化 husky，所以必须用环境变量显式关掉。

---

## 八、逐步骤拆解（`steps:`）

下面是 `quality` 这个 job 里真正一步步执行的命令。每一步都是在那台临时 Ubuntu 机器上执行的。

### 步骤 1：拉取代码 `actions/checkout@v4`

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
```

新机器是空的，第一件事就是把你的代码整个下载下来。`actions/checkout@v4` 是 GitHub 官方提供的"拉代码"小工具。

- `fetch-depth: 0` 是关键细节。默认情况下，为了快，checkout 只会拉"最新这一个版本"的代码（`fetch-depth: 1`），不包含历史记录。但这里设成 `0`，意思是**把完整的 git 历史全部拉下来**。

为什么要全部历史？因为后面的"检查提交信息"那一步，需要对比两个提交点之间的所有 commit，没有历史就比不了。所以这里必须拉全。

### 步骤 2：安装 pnpm `pnpm/action-setup@v4`

```yaml
- uses: pnpm/action-setup@v4
```

新机器上没有 pnpm（项目的包管理器），得先装上。这里有个巧妙之处，看注释：

> `# version omitted: action reads packageManager from package.json (pnpm@9.12.0), keeping CI in sync with local corepack.`

意思是：这里**故意不写版本号**。这个 action 会自动去读 [package.json](../package.json) 里的 `"packageManager": "pnpm@9.12.0"`，然后用这个版本。好处是：**你在本地用什么版本的 pnpm，CI 就用什么版本，永远不会错位**。如果哪天升级 pnpm，只要改 package.json 一处，CI 自动跟着变。

### 步骤 3：安装 Node.js `actions/setup-node@v4`

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: pnpm
```

装 Node.js 运行环境，指定版本 22。这个数字和项目里多处保持一致：

- [.nvmrc](../.nvmrc) 文件里写着 `22`。
- [package.json](../package.json) 里 `"engines": { "node": ">=22.0.0" }`。
- 包 [packages/excel-exporter/package.json](../packages/excel-exporter/package.json) 里同样 `"engines": { "node": ">=22.0.0" }`。

也就是说，**项目要求 Node 22 以上，CI 也老老实实用 22**。

`cache: pnpm` 是加速用的：第一次跑的时候，它会把 pnpm 下载的依赖缓存起来；下次再跑，直接用缓存，省去重新下载的时间。缓存用 pnpm 自己的格式。

### 步骤 4：安装依赖 `pnpm install --frozen-lockfile`

```yaml
- run: pnpm install --frozen-lockfile
```

根据 [pnpm-lock.yaml](../pnpm-lock.yaml)（锁定文件）安装所有依赖。

`--frozen-lockfile` 的意思是"**冻结锁定文件**"：只按照锁文件里记录的精确版本安装，**绝对不允许偷偷改版本**。如果有人忘了提交锁文件的更新，导致 lock 文件和 package.json 对不上，这一步会直接报错失败——这是好事，能防止"本地能跑、CI 跑不了"的玄学问题。

### 步骤 5：检查提交信息（只在 PR 时）`Lint commit messages`

```yaml
- name: Lint commit messages
  if: github.event_name == 'pull_request'
  run: pnpm exec commitlint --from ${{ github.event.pull_request.base.sha }} --to HEAD
```

这一步检查的是**你写 commit（提交）时的那句话合不合格**，不是检查代码。

本项目要求所有 commit 都遵守一个固定格式，叫 **Conventional Commits（约定式提交）**。证据在 [.commitlintrc.json](../.commitlintrc.json)：

```json
{ "extends": ["@commitlint/config-conventional"] }
```

合法的 commit 标题长这样（看 git 历史，全是这种格式）：

- `feat: 添加了版本信息`
- `fix(excel-exporter): rename scope to @marcusok and skip perf tests on CI`
- `docs: add beginner-friendly release workflow guide`
- `chore: release packages`

也就是 `类型: 描述` 的形式，类型必须是 `feat`/`fix`/`docs`/`chore` 等规定词。如果你写成"随便改了点东西"这种大白话，commitlint 就会让你挂掉。

- `if: github.event_name == 'pull_request'` —— 这一步**只在 PR 时跑**，直接 push 到 main 时不跑。为什么？因为直接 push 到 main 的代码，往往是 PR 合并进来的（已经检查过了），或者像"自动发布"那种机器人提交，没必要再查。
- `--from ${{ github.event.pull_request.base.sha }} --to HEAD` —— 检查范围是"从 PR 的起点，到最新提交"。这就是为什么步骤 1 必须用 `fetch-depth: 0`：没有完整历史，`--from` 那个老提交点就找不到。

> 顺带一提：本地你每次 commit 时，[.husky/commit-msg](../.husky/commit-msg) 也会触发 commitlint。所以同一条规则，本地和 CI 都在守。

### 步骤 6：代码风格检查 `pnpm lint`

```yaml
- run: pnpm lint
```

跑 [package.json](../package.json) 里的 `"lint": "turbo run lint"`，最终会调到每个包的 lint 命令。本项目用的是 ESLint，配置在 [eslint.config.mjs](../eslint.config.mjs)。

它检查的是"代码写得规不规范"，比如：

- 有没有定义了却没用的变量（`no-unused-vars`）。
- 有没有忘记 `await` 的 Promise（`no-floating-promises`，对这种异步密集的项目特别重要）。
- import 类型时有没有统一用 `import type`（`consistent-type-imports`）。

可以理解为"检查你作文里有没有错别字和不合语法的句子"。

### 步骤 7：类型检查 `pnpm typecheck`

```yaml
- run: pnpm typecheck
```

跑 `"typecheck": "turbo run typecheck"`，对应包里是 `tsc --noEmit`（TypeScript 编译器只检查、不输出文件）。它验证"类型对不对"——比如你把一个数字传给了一个要字符串的函数，它就会报错。这是 TypeScript 项目最关键的防线之一。类型规则在 [tsconfig.base.json](../tsconfig.base.json) 里，开了 `strict: true`（最严格）。

### 步骤 8：跑测试 `pnpm test`

```yaml
- run: pnpm test
  env:
    RUN_PERF: "0"
```

跑 `"test": "turbo run test"`，最终用 **vitest** 跑所有测试（excel-exporter 的测试在 [packages/excel-exporter/src/**tests**](../packages/excel-exporter/src/__tests__) 下，比如 builder、format、stream、fallback、routing 等；play 与 apps/docs 也各有测试任务）。

重点是这个环境变量 **`RUN_PERF: "0"`**，它的来龙去脉很有意思，是项目踩过坑后加的：

项目里有一个 [performance.test.ts](../packages/excel-exporter/src/__tests__/performance.test.ts)，它是**性能测试**——比如测"导出 10 万行 Excel 要多久，有没有超过 2 秒"。代码里是这样写的：

```ts
const RUN_PERF = process.env.RUN_PERF !== "0";
// ...
describe.runIf(RUN_PERF)("performance ...", () => { ... });
```

意思是：**只有当 `RUN_PERF` 不等于 `"0"` 时，才跑这些性能测试**。CI 里设成 `"0"`，所以 CI 不跑性能测试。

为什么不跑？因为性能测试对"机器快慢"很敏感。GitHub 免费服务器（shared runner）本身比开发电脑慢 1.5~2 倍，而且时快时慢。如果在 CI 上卡死一个"必须 200 毫秒内完成"的硬指标，就会经常**误报失败（术语叫 flaky，时好时坏的测试）**。代码注释里写得很清楚：

> `// Perf 基线只在本地当回归看门狗；CI shared runner 抖动大，跑它只会 flake。`

所以策略是：**性能测试在本地当"看门狗"跑，CI 里跳过，避免假报警**。

历史上这里还有一个 `PERF_TIGHT` 设计（同一文件里 `SLACK` 那行）：本地想跑严格模式可以设 `PERF_TIGHT=1`。该机制现已移除——`SLACK` 目前恒为 1.0，`PERF_TIGHT` 不再产生任何效果（turbo.json 的 `globalEnv` 里仍保留声明，属残留）。而 [turbo.json](../turbo.json) 的 `globalEnv` 里列了 `RUN_PERF` 和 `PERF_TIGHT`：

```json
"globalEnv": ["NODE_ENV", "CI", "PERF_TIGHT", "RUN_PERF", "DOCS_BASE"]
```

为什么要列出来？因为 Turborepo 是靠这些环境变量来决定**缓存能不能复用**的。把这些变量登记进去，Turborepo 才知道"换了 `RUN_PERF` 的值，缓存就得重新算"。git 历史里有一条提交 `87855d6 fix(turbo): declare RUN_PERF in globalEnv so CI can skip perf tests` 就是在修这个坑。

### 步骤 9：构建 `pnpm build`

```yaml
- run: pnpm build
```

跑 `"build": "turbo run build"`，对应包里是 `tsup`（一个打包工具，配置在 [packages/excel-exporter/tsup.config.ts](../packages/excel-exporter/tsup.config.ts)）。它把 TypeScript 源码编译、打包成最终能被别人 `import` 用的 `dist/` 产物。

这一步放在最后，因为构建最耗时，前面（lint/typecheck/test）如果有问题，早点失败、早点停下，省时间。

> Turborepo 的智能之处（见 [turbo.json](../turbo.json)）：`build` 任务声明了 `"dependsOn": ["^build"]`，意思是"先把我依赖的包构建好，再构建我"；还声明了 `"outputs": ["dist/**"]`，让 Turborepo 知道构建产物在哪，可以缓存。工作区现有 excel-exporter / play / docs 多个包，docs 的构建要消费 excel-exporter 的 `dist/` 产物，`^build` 编排已经实际生效。

---

## 九、整体串起来：CI 在守护什么

把九步连起来看，CI 其实是一道道**层层把关**的流水线：

| 顺序 | 步骤                  | 守的是什么       | 对应项目文件                                                                      |
| ---- | --------------------- | ---------------- | --------------------------------------------------------------------------------- |
| 1    | checkout（拉全历史）  | 准备代码         | 整个仓库                                                                          |
| 2    | 装 pnpm（自动读版本） | 工具版本一致     | [package.json](../package.json) 的 `packageManager`                               |
| 3    | 装 Node 22 + 缓存     | 运行环境一致     | [.nvmrc](../.nvmrc)、`engines`                                                    |
| 4    | install（冻结锁文件） | 依赖版本一致     | [pnpm-lock.yaml](../pnpm-lock.yaml)                                               |
| 5    | commitlint（仅 PR）   | 提交信息规范     | [.commitlintrc.json](../.commitlintrc.json)                                       |
| 6    | lint                  | 代码风格规范     | [eslint.config.mjs](../eslint.config.mjs)                                         |
| 7    | typecheck             | 类型正确         | [tsconfig.base.json](../tsconfig.base.json)                                       |
| 8    | test（跳过性能测试）  | 功能正确         | [packages/excel-exporter/src/**tests**](../packages/excel-exporter/src/__tests__) |
| 9    | build                 | 能成功打包出产物 | [tsup.config.ts](../packages/excel-exporter/tsup.config.ts)                       |

任何一步失败，整条流水线就亮红灯，PR 上会出现一个红叉，提醒你"这次改动有问题，先别合并"。

---

## 十、几个容易踩的小知识点（新手向）

- **`uses:` vs `run:`**：`uses:` 是"调用别人写好的现成小工具"（比如 checkout、setup-node）；`run:` 是"直接在命令行敲一条命令"（比如 `pnpm test`）。
- **`${{ }}` 这种写法**：这是 GitHub Actions 的"表达式"，用来读取上下文变量。比如 `${{ github.ref }}` 就是"当前分支或 PR 的名字"，`${{ github.event.pull_request.base.sha }}` 就是"PR 起点的 commit 编号"。
- **为什么顺序是 lint → typecheck → test → build**：从快到慢、从便宜到贵。前面试错成本低，越往后越费时。
- **`actions/checkout@v4` 里的 `@v4`**：是版本号，锁定用第 4 版，避免哪天工具升级了行为变了，CI 莫名其妙挂掉。

---

## 十一、一句话总结

ci.yml 是这个项目的**自动质检员**：每当有人提 PR 或往 main 推代码，它就在一台干净的 Ubuntu 机器上，用和本地完全一致的 pnpm 9.12 + Node 22 环境，依次检查"提交信息规不规范、代码风格、类型、功能测试（性能测试跳过）、能否构建成功"，全部通过才放行；同一分支重复推还会自动取消旧的，省时省钱。
