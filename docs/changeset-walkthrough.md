# 本项目的 Changesets 全景

> 本文把仓库里所有和 Changesets 相关的配置、脚本、流水线、文件串成一条完整线索，逐项讲清楚。读完能回答这些问题：changeset 文件长什么样？config.json 每个字段什么意思？version 和 publish 两个阶段具体动了哪些文件？为什么这样配？
>
> 配套阅读：[release-guide.md](./release-guide.md)（高层流程）、[release-publish-logic.md](./release-publish-logic.md)（为什么空了还走 publish）、[release.yml](../.github/workflows/release.yml)、[.changeset/config.json](../.changeset/config.json)。

---

## 1. 涉及的文件清单

Changesets 在本项目里不是一个单独的命令，而是横跨好几个文件协作：

| 文件                                                                            | 作用                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [.changeset/config.json](../.changeset/config.json)                             | Changesets 的核心配置：changelog 生成器、发版范围、版本联动策略、baseBranch                                  |
| `.changeset/*.md`（除 config.json）                                             | 每次发版的"说明书"，`pnpm changeset` 生成，`changeset version` 消费后删除（目录下有 `.md` 即处于待发版状态） |
| [package.json](../package.json)                                                 | 三个脚本：`changeset` / `version-packages` / `release`，外加 `@changesets/cli` 依赖                          |
| [packages/excel-exporter/package.json](../packages/excel-exporter/package.json) | 被发布的包：版本号、`files`、`publishConfig`、`exports`                                                      |
| [packages/excel-exporter/CHANGELOG.md](../packages/excel-exporter/CHANGELOG.md) | `changeset version` 自动维护的更新日志                                                                       |
| [.github/workflows/release.yml](../.github/workflows/release.yml)               | 接入 `changesets/action`，在 push main 时自动跑 version 或 publish                                           |
| [.github/workflows/ci.yml](../.github/workflows/ci.yml)                         | 独立的质量检查流水线，和 Release 互不阻塞                                                                    |

---

## 2. config.json 逐字段详解

```json
{
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["@marcusok/play", "@marcusok/docs"]
}
```

- **`changelog`**：用哪个函数生成 CHANGELOG 条目。`@changesets/cli/changelog` 是官方默认，生成的格式是「commit 哈希前缀 + changeset 里写的那句话」。看现有 CHANGELOG 就能验证：`31b0cfe: 修复了部分代码问题`。如果想自定义格式（比如只留一句话、去掉哈希），这里换成自己的函数。
- **`commit`**：`changeset version` 改完文件后**要不要自动 git commit**。设 `false` 表示不自动提交——版本号、CHANGELOG 的改动留在工作区。这看起来奇怪，其实是因为提交动作交给 `changesets/action` 来做（它要打 commit、开 PR）。如果手动跑 `pnpm version-packages` 测试，改完的文件会堆在工作区等你 `git add`。
- **`fixed: []`**：固定版本组。组里的包永远同版本号（一个涨全涨）。本项目只有一个发布包，用不上，留空。
- **`linked: []`**：联动版本组。组里的包版本号各自独立，但会保持「同步前进」（不会出现 A 比 B 落后）。同样用不上，留空。
- **`access`**：发布到 npm 时的可见性。`public` = 公开包。对于 scoped 包（`@marcusok/...`），npm 默认是 restricted（私有），所以这里显式声明 `public` 是必需的，否则 changesets publish 会按 scoped 默认值处理而出错。`packages/excel-exporter/package.json` 里也有 `publishConfig.access: "public"`——那是手动 `npm publish` 时生效的字段；两处都写上，覆盖 changesets 发布和手动发布两条路径。
- **`baseBranch: "main"`**：Changesets 把哪个分支当作「基线」来计算「有哪些新改动需要发版」。`changesets/action` 跑 version 时，就是基于这个分支的 diff 判断该消费哪些 changeset。本项目主干是 main，所以填 main。
- **`updateInternalDependencies: "patch"`**：**多包联动策略**。当 monorepo 里包 A 依赖包 B，且 B 发版时，A 的依赖版本要不要跟着涨、涨多少。`patch` 表示按 patch 级别涨。当前只有 `excel-exporter` 一个发布包，这条暂时不生效；等以后拆出第二个包（比如内部共享工具包）才会真正起作用。
- **`ignore`**：即使有针对这些包的 changeset，`changeset publish` 也跳过不发。用于「只 bump 不发到 npm」的内部包。当前列了 `@marcusok/play`（本地联调沙箱）与 `@marcusok/docs`（文档站），两者都不需要发到 npm。

---

## 3. 三个核心命令

根 [package.json](../package.json) 里定义了三个脚本，分别对应发版的三个动作：

```json
"changeset": "changeset",
"version-packages": "changeset version",
"release": "turbo run lint typecheck test build && changeset publish"
```

### `pnpm changeset` —— 写发版说明书（人工）

交互式命令，依次问你：

1. 选哪些包（本项目只有 `@marcusok/excel-exporter`）
2. 选版本级别：`patch` / `minor` / `major`
3. 写一句 CHANGELOG 描述

完成后在 `.changeset/` 下生成一个随机文件名的 `.md`，内容形如：

```markdown
---
"@marcusok/excel-exporter": patch
---

修复了导出大文件时的内存泄漏
```

第一部分是 frontmatter，声明「哪个包、涨几级」；第二部分是要写进 CHANGELOG 的那句话。这个文件本身不碰版本号，只是个声明。

### `pnpm version-packages`（= `changeset version`）—— 算版本号（阶段 1，机器跑）

读 `.changeset/*.md`，做四件事：

1. 按所有 changeset 的最高级别算出每个包的目标版本，写进对应 `package.json`（比如 `0.1.2` → `0.1.3`）。
2. 生成或追加每个包的 `CHANGELOG.md`。
3. 删掉已消费的 `.changeset/*.md`（这就是为什么阶段 2 启动时 `.changeset/` 是空的）。
4. 因为 `config.json` 里 `commit: false`，这些改动留在工作区，**不自动提交**。

### `pnpm release` —— 质量门禁 + 发包（阶段 2，机器跑）

```bash
turbo run lint typecheck test build && changeset publish
```

前半段是质量门禁：turbo 跑 lint / typecheck / test / build（lint、typecheck、build 在 turbo.json 里都声明了 `"dependsOn": ["^build"]`，会先构建被依赖的包再执行；test 无此声明）。后半段 `&&` 表示**全过才发**——turbo 整体退出码非 0 时 changeset publish 不会执行。`changeset publish` 真正发包时，会先查 npm registry，只有本地版本比线上新的包才调 `npm publish`，已发布的跳过（幂等）。

> 为什么门禁放在 publish 这一步、而不是 version 那一步？因为 version PR 只改版本号和 CHANGELOG，不涉及代码能不能编译；真正的代码质量把关放在发包前最合理，避免「版本号已经发出去，但代码其实是坏的」。

---

## 4. 接入 Release 流水线

[release.yml](../.github/workflows/release.yml) 用 `changesets/action@v1` 把上面三个命令串进 CI：

```yaml
- name: Create Release Pull Request or Publish
  uses: changesets/action@v1
  with:
    publish: pnpm release
    version: pnpm version-packages
    commit: "chore: release packages"
    title: "chore: release packages"
```

这个 action 的内部逻辑就是一个 if/else：

- **有待消费的 changeset**（`.changeset/` 非空）→ 跑 `version` 命令（`pnpm version-packages`）→ 把它产生的改动打成一个 commit，commit 信息和 PR 标题都用 `commit`/`title` 配的字符串 → 开或更新一个发版 PR。**不发包。**
- **没有待消费的 changeset**（`.changeset/` 为空）→ 跑 `publish` 命令（`pnpm release`）→ 真正发包。

两个分支互斥，同一次运行只走一个。这就是两阶段模型。

### action 用到的环境变量

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.CHANGESETS_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}
  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
  NPM_CONFIG_PROVENANCE: "true"
  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- **`GITHUB_TOKEN`**：给 action 用来打 commit、开 PR 的凭证。优先用 `CHANGESETS_GITHUB_TOKEN`（一个 PAT），因为 GitHub 默认 token 触发的事件不会再触发别的 workflow（防递归），用 PAT 能让发版 PR 正常触发 ci.yml。没配 PAT 就退回默认 token，PR 照开但 CI 不跑。
- **`NPM_TOKEN` / `NODE_AUTH_TOKEN`**：发包认证。`setup-node` 步骤配了 `registry-url`，会写一份 `~/.npmrc`，让 `npm publish` 实际读取 `NODE_AUTH_TOKEN` 这个变量——所以 `NODE_AUTH_TOKEN` 是当前配置下真正生效的那个。`NPM_TOKEN` 也指向同一个 secret，属于冗余（保留它不会出错，但本项目的 publish 链路并不直接读它）。
- **`NPM_CONFIG_PROVENANCE: "true"`**：让 `npm publish` 自动带上来源签名（provenance）。配合 workflow 顶部的 `permissions.id-token: write`，npm 会用这次构建的来源信息签一份公开声明。前提是仓库 public。

---

## 5. 完整生命周期

把前面所有零件串起来，一次真实发版是这样的（以 0.1.2 → 0.1.3 为例）：

```
你本地                          GitHub 云端                         npm
────                            ────────                            ────

1. 改代码
2. pnpm changeset
   → .changeset/xxx.md 生成
3. git commit + push main ────→ 4. release.yml 启动
                                   changesets/action 发现 .changeset/ 非空
                                   → 跑 pnpm version-packages
                                     · package.json: 0.1.2 → 0.1.3
                                     · CHANGELOG.md 追加 0.1.3 条目
                                     · 删掉 xxx.md
                                   → 打 commit「chore: release packages」
                                   → 开发版 PR
5. 审核 PR ─────────────────→
6. 点 Merge ────────────────→ 7. Merge = 再 push main → release.yml 再次启动
                                   这次 .changeset/ 空
                                   → 跑 pnpm release
                                     · turbo lint/typecheck/test/build（全过）
                                     · changeset publish
                                       · 查 registry：0.1.3 不存在 → 发
                                       · npm publish（带 provenance）
                                                                8. 0.1.3 上线
```

关键衔接点：阶段 1 删掉 changeset 文件 → 阶段 2 靠「`.changeset/` 空」这个状态触发。如果空了就什么都不做，版本号会永远卡在 `package.json` 里发不出去。详见 [release-publish-logic.md](./release-publish-logic.md)。

---

## 6. 哪些包会被发布

Changesets 不是无脑发所有包，有两道筛选：

1. **`package.json` 的 `private` 字段**：根 [package.json](../package.json) 是 `"private": true`，永远不会被发布（它是工作区根，只是个壳）。`packages/excel-exporter/package.json` 没设 `private`（默认 false），才会被发布。
2. **`config.json` 的 `ignore`**：即使包不是 private，也可以列进 `ignore` 让它「只 bump 不发」。当前列了 `@marcusok/play` 与 `@marcusok/docs`（本地沙箱与文档站，只参与工作区内部引用，不发 npm）。

所以本项目只有 `@marcusok/excel-exporter` 一个包会真正发到 npm。根包 `marcus-monorepo`（version 0.0.0，private）只在工作区内部存在，changeset 会自动忽略它。

### 包发布时打进哪些文件

`packages/excel-exporter/package.json` 的 `files` 字段决定了发包内容：

```json
"files": ["dist", "README.md", "LICENSE"]
```

只发构建产物 `dist/`、README、LICENSE。源码 `src/` 不发。所以发包前必须先 `build`（这正是 `release` 脚本里 turbo 跑 build 的原因之一）。

---

## 7. CHANGELOG 的真实样子

[packages/excel-exporter/CHANGELOG.md](../packages/excel-exporter/CHANGELOG.md) 是 `changeset version` 自动维护的（最新条目见该文件头部；以下为 0.1.x 时期的示例片段）：

```markdown
# @marcusok/excel-exporter

## 0.1.2

### Patch Changes

- 31b0cfe: 修复了部分代码问题

## 0.1.1

### Patch Changes

- cefad0e: 修改了一些配置文件
- cefad0e: Tighten package `exports` ...
```

几个细节：

- 每个版本号一个 `##` 标题，最新的在最上面。
- 条目前面的 `31b0cfe` / `cefad0e` 是 commit 哈希前 7 位，由默认 changelog 生成器（`@changesets/cli/changelog`）加上。**关键**：这个哈希是「引入该 changeset 文件的那个 commit」——git 历史里第一次添加这个 `.md` 文件的提交，**不是**发版 PR 的 commit。本仓库可验证：0.1.2 的 `31b0cfe` 对应 `feat: 添加了版本信息`，只改了 `.changeset/solid-worlds-design.md`；0.1.1 的 `cefad0e` 对应 `fix(excel-exporter): tighten exports...`，代码和 changeset 在同一 commit 引入。真正的发版 commit `3a5782f` / `8cb658a`（`chore: release packages`）不会出现在 CHANGELOG 里。所以这个哈希可能是纯加 changeset 的提交，也可能同时含代码改动，取决于你怎么提交。
- 条目内容就是你在 `pnpm changeset` 时写的那句话，原样保留。

---

## 8. 容易忽略的细节

### 两个 workflow 的并发策略不一样

- [ci.yml](../.github/workflows/ci.yml)：`concurrency: { cancel-in-progress: true }`。新 push 会**取消**正在跑的旧 CI，省资源。
- [release.yml](../.github/workflows/release.yml)：`concurrency: { cancel-in-progress: false }`。发版**排队不取消**，多次 push 的 Release 请求会依次跑完。

这个差异很关键：发版不能中途取消（否则版本号算到一半、或者发到一半会出问题），所以宁可排队。CI 只是质量信号，取消无所谓。

### 发版 PR 是「更新」不是「新开」

如果已有一个 open 的 "chore: release packages" PR，你又 push 了新 changeset，`changesets/action` 不会开第二个 PR，而是把新版本改动追加进去、更新原 PR。所以同一时间一般只有一个发版 PR。这意味着你可以攒几个 changeset 一次性发。

### `commit: false` 的真实含义

config.json 里 `commit: false` 不是「不提交版本改动」，而是「`changeset version` 命令本身不自动 git commit」。提交动作由 `changesets/action` 接管——它把 version 产生的改动 stage 后打成一个 commit。如果脱离 action 手动跑 `pnpm version-packages`，改完的文件会留在工作区，需要你自己 `git add` + `git commit`。

### husky 在 CI 里被跳过

根 package.json 有 `"prepare": "husky"`，本地 `pnpm install` 会装钩子（pre-commit 跑 lint-staged，commit-msg 跑 commitlint）。但两个 workflow 都设了 `env: HUSKY: "0"`，CI 里 husky 直接禁用，避免和 CI 自己的 lint/commitlint 步骤重复或冲突。

### changeset 文件不要拿来做实验

`pnpm changeset` 生成的 `.md` 只要进了 main，机器就会消费它、真的发版。本地试验流程时如果手滑生成了，**一定删掉再提交**，别误发版。

### 版本号「超前」时的恢复

合并发版 PR 后 publish 挂了（比如 token 过期），会出现 main 上版本号是 0.1.3、npm 上还是 0.1.2。**不要**再写一个 changeset 去补发——那会把版本再 bump 成 0.1.4，0.1.3 就永久跳过了。正确做法：修好配置后 re-run 那次失败的 Release，或修好代码再 push（这次 `.changeset/` 空，走 publish，changeset publish 发现本地 0.1.3 比 npm 新，照样能发出去）。

---

## 9. 如何确认仓库当前的发版状态

静态快照总会过时，建议直接用下面几条命令亲眼看：

- `ls .changeset/` —— 只有 `config.json` 就是「干净」状态，没有待发版本；还有其它 `.md` 文件就是有待消费的 changeset，合并进 main 后会触发 version 流程。
- `node -p "require('./packages/excel-exporter/package.json').version"` —— 本地版本号。
- `npm view @marcusok/excel-exporter version` —— npm 线上版本号。两者一致说明没有超前；本地更新说明有版本待 publish。

举例（2026-08-17 核实过的实际状态）：当时 `.changeset/` 干净、本地与 npm 同为 `1.0.3` → 那时直接 push 一次不带 changeset 的代码，release.yml 走 publish 分支，`changeset publish` 发现版本一致，no-op，不会发任何东西。这是正常的安全行为。
