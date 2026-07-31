# Release 工作流逐行解读（`.github/workflows/release.yml`）

> 阅读对象：完全没接触过"自动发布"的人。和 CI 那篇一样，每一步都先说"它在做什么"再说"为什么"，而且每条结论都能在本项目里找到真实证据。如果还没看 [ci-workflow-analysis.md](/C:/Users/wangbo/Desktop/marcus-monorepo/docs/ci-workflow-analysis.md)，建议先看那一篇，因为这边会用到里面的概念（PR、pnpm、Node 22、HUSKY 等）。

---

## 一、这篇要解决什么问题：把代码"自动卖出去"

CI 文档讲的是"怎么保证代码质量"。这篇讲的是**另一件事：怎么把写好的代码，自动打包、自动发到 npm（一个全世界都能下载的代码仓库）上去**。

打个比方：

- 你写了一本书（代码）。
- CI 是"交稿前的校对机器"。
- **Release 是"印刷厂 + 发行商"**：它自动把你的书印好（构建），贴上版本号，然后摆到书店（npm）的货架上，让全世界的人都能 `npm install` 买走。

这个项目要发布的"书"，就是那个 Excel 导出库 `@marcusok/excel-exporter`（当前版本 `0.1.2`，见 [packages/excel-exporter/package.json](/C:/Users/wangbo/Desktop/marcus-monorepo/packages/excel-exporter/package.json)）。

而且这事不是手动点的，是**全自动**的——只要你把代码合并到 main 分支，机器就会自己决定"要不要发新版本、发哪个版本"，你睡着了它也在发。

---

## 二、release.yml 全文（先整体看一眼）

```yaml
name: Release
on:
  push:
    branches: [main]

concurrency: { group: release, cancel-in-progress: false }

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    env:
      HUSKY: "0"
      RUN_PERF: "0"
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          publish: pnpm release
          version: pnpm version-packages
          commit: "chore: release packages"
          title: "chore: release packages"
        env:
          GITHUB_TOKEN: ${{ secrets.CHANGESETS_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_CONFIG_PROVENANCE: "true"
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

下面逐块拆解。

---

## 三、`name: Release`

工作流的名字，叫"Release（发布）"。在 GitHub 的 Actions 页面里和"CI"并列显示。

---

## 四、`on:` —— 只有"合并到 main"才触发

```yaml
on:
  push:
    branches: [main]
```

注意它和 CI 不一样：CI 在 PR 时就触发，而 **Release 只在代码真正进入 main 分支时才触发**（也就是 PR 被合并、或有人直接 push 到 main）。

为什么这样设计？因为发布是"对外公开"的动作，应该只对"已经确定要保留的代码"做。main 分支就是"确定要保留"的地方。你在试验分支上改代码，不应该触发发布。

---

## 五、`concurrency:` —— 发布绝不能被打断

```yaml
concurrency: { group: release, cancel-in-progress: false }
```

这是 YAML 的一种简写（把多行压成一行）。展开就是：

```yaml
concurrency:
  group: release
  cancel-in-progress: false
```

和 CI 那篇正好**相反**，这里有两个关键不同：

1. `group: release` —— 注意它**没有 `${{ github.ref }}`**，是一个写死的固定名字 `release`。意思是：整个仓库，同一时间**只允许有一个"发布任务"在跑**，不管是谁触发的。
2. `cancel-in-progress: false` —— 如果一个发布正在跑，又来了一个新的触发，**新来的不会打断旧的，而是排队等着**。

为什么和 CI 反着来？因为发布是"改版本号、上传到 npm"这种**有副作用的危险操作**。如果两个发布任务同时跑，可能同时改同一个版本号、同时上传，把发布记录搞乱。CI 检查挂了重跑就行，发布搞乱了很难收拾。所以发布必须**老老实实排队、一个一个来，绝对不能中途取消**。

---

## 六、`permissions:` —— 给机器发"授权牌照"

```yaml
permissions:
  contents: write
  pull-requests: write
  id-token: write
```

GitHub 出于安全考虑，默认给每个 workflow 的权限是**最小**的（只能读）。但发布任务要做不少"写"操作，所以必须显式申请权限。三条分别是：

- `contents: write` —— 允许**修改仓库内容**。因为发布过程要往仓库里提交东西（更新版本号、写 CHANGELOG、打 tag）。
- `pull-requests: write` —— 允许**创建和操作 PR**。这个工作流会自动创建一个"发布准备 PR"（后面会讲）。
- `id-token: write` —— 允许**生成一个身份令牌**。这个专门给 npm 的"出处证明"功能用（后面 `NPM_CONFIG_PROVENANCE` 会讲）。

可以理解成：你让一个员工去办几件需要授权的事（盖公章、提申请、出示身份证），得先给他分别签发这几张"授权牌"。

---

## 七、`env:` —— 关钩子 + 跳过性能测试

```yaml
env:
  HUSKY: "0"
  RUN_PERF: "0"
```

两个环境变量，和 CI 那篇解释过的一样：

- `HUSKY: "0"` —— 关掉 husky 本地钩子，避免发布时被钩子干扰。
- `RUN_PERF: "0"` —— 跳过性能测试。为什么发布也要跳？因为发布流程里会跑一遍完整的检查（见后面的 `pnpm release`），而性能测试在 CI 服务器上不可靠（会 flaky），发布更不能因为假报警卡住。

---

## 八、逐步骤拆解（`steps:`）

### 步骤 1-4：拉代码、装 pnpm、装 Node、装依赖

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: pnpm
    registry-url: https://registry.npmjs.org
- run: pnpm install --frozen-lockfile
```

这几步和 CI 几乎一模一样（拉全历史、自动读 pnpm 9.12、装 Node 22、缓存、冻结安装），不再重复。**唯一多出来的一行**是：

```yaml
registry-url: https://registry.npmjs.org
```

`registry-url` 的作用：告诉 setup-node"我要发布的 npm 官方仓库地址是 https://registry.npmjs.org"。setup-node 会自动写一个 `~/.npmrc` 文件，配置好发布时往这个地址传、并且从环境变量 `NODE_AUTH_TOKEN` 里读取登录令牌（后面会用到）。没有这一行，`npm publish` 不知道往哪发。

### 步骤 5：核心中的核心 —— `changesets/action@v1`

```yaml
- name: Create Release Pull Request or Publish
  uses: changesets/action@v1
  with:
    publish: pnpm release
    version: pnpm version-packages
    commit: "chore: release packages"
    title: "chore: release packages"
```

这是整个 Release 工作流的**大脑**。要理解它，必须先理解一个概念：**Changesets（变更集）**。

#### 什么是 Changesets？为什么要用它？

想象你改了代码，想发布新版本。你会遇到几个问题：

1. 版本号怎么涨？是大改（1.0→2.0）还是小修（1.0.1）？
2. 这次改了啥，要不要写个更新日志（CHANGELOG）给别人看？
3. 一个仓库里有好几个包时，谁涨谁不涨？

如果全靠人脑手动决定，很容易出错或忘了写日志。**Changesets 就是帮你把这些事自动化的工具**。它的核心思路是：**每次改代码时，顺手留一张"小纸条"，写清楚这次改了啥、要不要升级版本、升多少**。发布时，机器收集所有小纸条，自动算版本号、自动写日志。

本项目用了 Changesets，证据：

- 根 [package.json](/C:/Users/wangbo/Desktop/marcus-monorepo/package.json) 里装了 `@changesets/cli`，还定义了两个脚本：
  - `"version-packages": "changeset version"` —— 用来"消化小纸条、算版本、写日志"。
  - `"release": "turbo run lint typecheck test build && changeset publish"` —— 先跑完整检查，再发布到 npm。
- 配置文件 [.changeset/config.json](/C:/Users/wangbo/Desktop/marcus-monorepo/.changeset/config.json)：

```json
{
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

关键几项：`baseBranch: "main"`（主分支是 main）、`access: "public"`（公开发布）、`updateInternalDependencies: "patch"`（包之间互相依赖时，按 patch 级别自动升）。

#### `changesets/action` 这个工具到底干嘛？

它是一个"聪明的调度员"，每次 main 分支有新代码进来，它会做**判断**：

**情况 A：仓库里还有"没消化的小纸条"（待发布的 changeset）**
→ 它执行 `version` 那条命令（这里是 `pnpm version-packages`，即 `changeset version`）：

- 收集所有小纸条，算出该升到哪个版本号。
- 自动改 [packages/excel-exporter/package.json](/C:/Users/wangbo/Desktop/marcus-monorepo/packages/excel-exporter/package.json) 里的 `version`。
- 自动往 [packages/excel-exporter/CHANGELOG.md](/C:/Users/wangbo/Desktop/marcus-monorepo/packages/excel-exporter/CHANGELOG.md) 追加这次的更新内容。
- 吃掉这些小纸条（删掉 `.changeset/xxx.md` 文件）。
- 把以上所有改动，打包成一个**自动提交的 PR**（标题就是 `title: "chore: release packages"`）。

**情况 B：没有待处理的小纸条了，但是那个"发布准备 PR"已经被合并进来了**
→ 它执行 `publish` 那条命令（这里是 `pnpm release`）：

- 先跑 `turbo run lint typecheck test build`（完整质检 + 构建）。
- 再跑 `changeset publish`，把构建好的包真正上传到 npm，并打上 git tag。

两种情况是**自动二选一**的，你不用操心。

#### 这套流程在本项目里真的跑过（证据）

不要以为这是理论，本项目已经实打实发布过了。看 git 历史：

- **git tag（版本标签）有两个**：`@marcusok/excel-exporter@0.1.1`、`@marcusok/excel-exporter@0.1.2`。这些 tag 正是 `changeset publish` 自动打的。
- **真实的发布提交**：`3a5782f chore: release packages`，作者署名是 `github-actions[bot]`（机器人），正好对应 release.yml 里的 `commit: "chore: release packages"`。这条提交做的事，和 changeset 文档描述的一模一样：
  - 删掉了 `.changeset/solid-worlds-design.md`（消化掉那张小纸条）。
  - 更新了 [packages/excel-exporter/CHANGELOG.md](/C:/Users/wangbo/Desktop/marcus-monorepo/packages/excel-exporter/CHANGELOG.md)（追加 0.1.2 的更新记录）。
  - 把 [packages/excel-exporter/package.json](/C:/Users/wangbo/Desktop/marcus-monorepo/packages/excel-exporter/package.json) 的版本从 0.1.1 改成 0.1.2。
- **还有两个机器人 PR**：git 历史里有 `Merge pull request #1` 和 `#2 from yourbusiness/changeset-release/main`，正是 changesets/action 自动创建的"发布准备 PR"，分支名 `changeset-release/main` 是它的固定名字。

#### `commit` 和 `title` 两个小参数

```yaml
commit: "chore: release packages"
title: "chore: release packages"
```

- `commit` —— 自动提交时用的 commit 信息（所以 git 里能看到 `chore: release packages`）。
- `title` —— 自动创建的那个 PR 的标题。

注意它们都用了 `chore:` 这个前缀，符合 commitlint 的 Conventional Commits 规则（CI 那篇讲过）。这样自动提交的代码也不会被 CI 的提交信息检查卡住。

---

## 九、`env:`（action 的环境变量）—— 几把"钥匙"

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.CHANGESETS_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}
  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
  NPM_CONFIG_PROVENANCE: "true"
  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

发布需要各种"通行证/钥匙"，这些钥匙是存在 GitHub 的 **Secrets（加密仓库密钥）** 里的，明面上看不到。四把钥匙分别管不同的事：

### 1. `GITHUB_TOKEN` —— 操作 GitHub 仓库的钥匙

`${{ secrets.CHANGESETS_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}` 这个写法的意思是：**优先用 `CHANGESETS_GITHUB_TOKEN`，如果它没设置，就退而用 `GITHUB_TOKEN`**。

为什么搞这么复杂？注释里说得很明白：

> `# PAT so the Version PR triggers ci.yml. The default GITHUB_TOKEN is exempt from GitHub's anti-recursion rule (it cannot trigger other workflows).`

翻译成人话：GitHub 有个**防递归规则**——用默认的 `GITHUB_TOKEN` 创建的提交/PR，**不会触发其他 workflow**（比如不会触发 ci.yml）。这是 GitHub 故意的，防止"机器人的动作又触发机器人，无限循环"。

但本项目希望：机器人创建的"发布准备 PR"也能正常跑 CI 检查。所以建议配一个 **PAT（Personal Access Token，个人访问令牌）**，存成 secret `CHANGESETS_GITHUB_TOKEN`。PAT 创建的提交不受那条防递归规则限制，能正常触发 CI。如果没配 PAT，就退回用默认 `GITHUB_TOKEN`，只是那 PR 不会触发 CI 而已（功能不丢，只是少了 PR 上的 CI 检查）。

这把钥匙让 changesets 能：提交代码、创建 PR、打 tag。

### 2 & 4. `NPM_TOKEN` 和 `NODE_AUTH_TOKEN` —— 发布到 npm 的钥匙

两把钥匙名字不同，但指向的是**同一个 secret 值** `secrets.NPM_TOKEN`。区别只在于"谁去读它"：

- `NODE_AUTH_TOKEN` —— 这是**真正干活的那个**。前面步骤 3 设了 `registry-url`，setup-node 会自动在 `~/.npmrc` 里写一行 `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`，最终 `npm publish` 上传时读的就是它。本项目 [docs/release-publish-logic.md](/C:/Users/wangbo/Desktop/marcus-monorepo/docs/release-publish-logic.md) 也写明："本项目走 setup-node 配的 `NODE_AUTH_TOKEN`，最终落到 `npm publish`"。
- `NPM_TOKEN` —— 同样指向那个 secret，但在当前这套配置里**属于冗余**：publish 链路并不直接读它（[docs/changeset-walkthrough.md](/C:/Users/wangbo/Desktop/marcus-monorepo/docs/changeset-walkthrough.md) 里就是这么说的）。保留它不会出错，只是 changesets 生态的示例习惯都带上它。

更精确地说：缺了 `NODE_AUTH_TOKEN`，`npm publish` 会报 401 未授权。本项目发布时踩过的真实坑（[docs/debug.md](/C:/Users/wangbo/Desktop/marcus-monorepo/docs/debug.md) 第 16 节）就是这个 token 的 scope 权限没覆盖 `@marcusok`，导致发布时 E404。

### 3. `NPM_CONFIG_PROVENANCE: "true"` —— 给包贴"产地证明"

这是个比较新的安全特性。`provenance`（出处/来源证明）的意思是：发布到 npm 的包，会附带一份**加密签名**，证明"这个包确实是从这个 GitHub 仓库的这个 commit，通过这个 workflow 发出来的"。

为什么要这个？因为 npm 上经常有人上传**冒牌包**（名字一样，里面塞恶意代码）。有了 provenance，下载的人可以验证："这个包是不是真的从官方仓库发的？" 这对开源库的安全信誉很重要。

它依赖前面申请的 `id-token: write` 权限（用 OIDC 令牌来签名，不需要你手动保管签名密钥）。npm 官方很推荐开源包都开启它。**还有一个前提：仓库必须是 public（公开的）**，私有仓库没法签发 provenance。本项目是公开仓库，所以 [docs/debug.md](/C:/Users/wangbo/Desktop/marcus-monorepo/docs/debug.md) 的发布日志里能看到 `Signed provenance statement ... from GitHub Actions`，说明签名成功、`id-token: write` 确实生效。

---

## 十、把"两阶段发布"完整串一遍（重点）

很多人卡在"为什么发布要分两步"。用一个具体例子讲清楚。假设你改了代码，想让版本从 `0.1.2` 升到 `0.1.3`：

**第一阶段：准备（生成"发布准备 PR"）**

1. 你在本地写完代码，跑 `pnpm changeset`，机器问你"改了啥、升大升小"，你回答后，它生成一张小纸条 `.changeset/xxx.md`。
2. 你把代码 + 小纸条一起提 PR、合并到 main。
3. main 一变动，**release.yml 启动**。changesets/action 发现"还有没消化的小纸条"，于是执行 `changeset version`：
   - 算出版本 0.1.3，改 package.json。
   - 写 CHANGELOG。
   - 删小纸条。
   - 把这些改动打包成**第 2 个 PR**（机器人开的，标题 `chore: release packages`），分支叫 `changeset-release/main`。
4. 这个 PR 在 GitHub 上看起来就是"把版本号升上去 + 更新日志"的提议。

**第二阶段：真正发布（你点合并后）**

5. 你（或 reviewer）看了这个 PR 觉得 OK，**点合并**。它一进 main，**release.yml 再次启动**。
6. 这次 changesets/action 发现"小纸条都消化完了，没有待处理的了"，于是执行 `pnpm release`：
   - 先 `turbo run lint typecheck test build`——完整质检 + 构建。
   - 再 `changeset publish`——把 `dist/` 上传到 npm，打上 git tag `@marcusok/excel-exporter@0.1.3`。
7. 全世界的人现在可以 `pnpm add @marcusok/excel-exporter@0.1.3` 用上新版了。

为什么要分两步、中间留一个 PR 给人看？因为**版本号和发布日志一旦发出去就难收回**。留一个 PR，等于给你一次"再确认一眼"的机会：看看自动算的版本对不对、日志写得对不对，没问题了才真正发出去。这是一种安全阀门。

> 对着本项目的 git 历史能一一对应上：
>
> - **第一阶段的产物**是 `chore: release packages` 这类提交（`3a5782f`、`8cb658a`，作者署名都是 `github-actions[bot]`）。它们先出现在 `changeset-release/main` 分支上，再通过 PR #1、#2 合并进 main（所以你会看到 `Merge pull request #1/#2 from yourbusiness/changeset-release/main`）。这些提交干的就是"改版本号 + 写 CHANGELOG + 删小纸条"。
> - **第二阶段的产物**不是新的 main 提交，而是 **git tag**（`@marcusok/excel-exporter@0.1.1`、`@marcusok/excel-exporter@0.1.2`）和 npm 上对应的那个包。实际验证：0.1.1 的 tag 指向 commit `2ee13e8`、0.1.2 的 tag 指向 `469dd43`，都是 main 上**已经存在**的提交——说明 publish 阶段只是"在当时的 main 最新提交上贴一个版本标签 + 把包传到 npm"，并不会给 main 增加新 commit。

---

## 十一、和 CI 对比着看

| 维度             | ci.yml                   | release.yml                            |
| ---------------- | ------------------------ | -------------------------------------- |
| 什么时候触发     | 提 PR 或推到 main        | 只在推到 main                          |
| 主要目的         | 防止坏代码进仓库         | 把好代码自动卖到 npm                   |
| concurrency 策略 | 取消旧的，跑最新（省钱） | 排队，绝不打断（怕出乱子）             |
| 跑测试           | 跑（跳过性能测试）       | 跑（跳过性能测试，且在发布前再跑一遍） |
| 构建产物         | 只验证"能构建成功"       | 构建 + 真的上传到 npm                  |
| 额外权限         | 默认（只读够用）         | 要 contents/PR/id-token 写权限         |
| 谁来执行关键动作 | 一串 `pnpm xxx` 命令     | changesets/action 这个"调度员"         |
| 失败后果         | 改完重提就行             | 可能版本号乱了，要小心处理             |

---

## 十二、几个新手容易迷糊的点

- **"发布"和"构建"不是一回事**：构建（build）只是把源码编译成 dist；发布（publish）是把 dist 连同 package.json 一起上传到 npm。Release 工作流两件都做，但顺序是先构建再上传。
- **`secrets.XXX` 是什么**：是你在 GitHub 仓库设置里存好的"密码"（比如 npm 的登录令牌），workflow 里用 `secrets.名字` 引用，但 GitHub 会在日志里把它们打码，不会泄露。
- **为什么要 `fetch-depth: 0`**：和 CI 一样的道理，changesets 需要完整 git 历史来判断"哪些包变了、要发哪个版本"。
- **`@v1` 为什么不用 `@main`**：固定用第 1 版，避免 changesets/action 哪天更新了行为变了，发布突然出问题。和 CI 里锁 `@v4` 一个道理。
- **万一发布失败怎么办**：因为 `cancel-in-progress: false`，不会被打断；如果 `npm publish` 失败（比如令牌过期、网络问题），可以修好后重跑。注意：**npm 上同一个版本号只能发一次**，所以如果已经发上去了再失败，下次得换新版本号。本项目 [docs/debug.md](/C:/Users/wangbo/Desktop/marcus-monorepo/docs/debug.md) 里就记录过发布踩坑的排查过程（比如 turbo 严格模式、404、令牌权限等），遇到问题可以去翻。

---

## 十三、一句话总结

release.yml 是这个项目的**自动印刷厂+发行商**：只要代码进了 main，它就交给 changesets/action 这个"调度员"。调度员先看有没有待发布的改动说明（changeset）：有，就自动算版本号、写更新日志，开一个"发布准备 PR"让人最后过目；没有（说明人已经确认合并了），就执行完整质检+构建+上传 npm+打 tag，把新版本发布给全世界。整个过程排队执行绝不打断，还用 npm provenance 给包贴上"官方出品"的防伪证明。
