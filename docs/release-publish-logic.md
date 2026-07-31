# 为什么 `.changeset/` 为空时 Release 还要走 publish？

> 本文是对 [release-guide.md](./release-guide.md) 第 3.1 节"分支 B"的深入解释。读完 release-guide 后，如果对"`.changeset/` 空了为什么还要走 `changeset publish`"有疑问，看这篇。
>
> 配套阅读：[release.yml](../.github/workflows/release.yml)、[`.changeset/config.json`](../.changeset/config.json)。

---

## 一个常见误解

读 release-guide 时很容易形成这个印象：

> `.changeset/` 里有文件 = 要发版；`.changeset/` 为空 = 不用发版。

顺着这个印象推下去，就会得出"空了为什么还走 `changeset publish`"的疑问。但这两件事其实不是一回事：

- `.changeset/` 里有文件，表示"有人声明了新的发版意图，还没被处理"。
- `.changeset/` 为空，只表示"当前没有新的、待处理的发版意图"，**并不等于"没有版本要发"**。

真正决定"包要不要发出去"的，不是 `.changeset/` 是否为空，而是 `changeset publish` 运行时，本地 `package.json` 的版本号是否比 npm registry 上已发布的版本更新。

---

## Changesets 是两阶段发布模型

`changesets/action`（release.yml 里用的就是它）在每次 push 到 main 时跑一次，内部是个 if/else：

- 有待消费的 changeset → 执行 `version` 命令，开/更新一个发版 PR。
- 没有待消费的 changeset → 执行 `publish` 命令。

两个分支互斥，同一次运行只走一个。这是理解"为什么空了走 publish"的钥匙。

### 阶段 1：version（`.changeset/` 非空）

release.yml 里 version 命令配的是 `pnpm version-packages`，底层是 `changeset version`：

1. 读取 `.changeset/*.md`，算出每个包的目标版本。
2. 把新版本写进 `package.json`。
3. 更新 `CHANGELOG.md`。
4. 删掉已消费的 changeset 文件（这一步很关键，见下）。
5. 把这些改动打成一个 commit，推到一个分支，开标题为 "chore: release packages" 的 PR。

**这个阶段只动版本号和 CHANGELOG，不发包。** npm 上还是旧版本。

注意第 4 步：version 执行完，`.changeset/` 就被清空了。这是两个阶段能衔接的关键——下一轮 Release 启动时，看到的就是"空"。

### 阶段 2：publish（`.changeset/` 为空）

你审核并合并那个发版 PR。Merge 等于往 main 又 push 了一次，Release 再次启动。这时：

- 版本号（比如 0.1.3）已经写进 main 的 `package.json` 了（阶段 1 干的）。
- 但 `.changeset/` 是空的（阶段 1 第 4 步删的）。

所以这次走 publish 分支，执行 `pnpm release`：

```
turbo run lint typecheck test build && changeset publish
```

这才是真正发包的地方。

---

## 为什么"空"反而要走 publish

因为阶段 2 必须靠"空"这个状态来触发。如果设计成"`.changeset/` 空就什么都不做"，阶段 2 就丢了——版本号永远停在 `package.json` 里，包永远发不出去。

换句话说，分支 B 走 publish，不是因为"这次不用发版"，恰恰相反：**是因为 version 阶段已经完成，轮到 publish 阶段收尾了。** `.changeset/` 空是"version 已完成"的信号，不是"不用发版"的信号。

---

## 会不会误发？不会，有两层保护

让 publish 在每次 `.changeset/` 为空的 push 上都跑，看起来危险，其实安全。

### 保护一：`changeset publish` 自己做版本检查（幂等性）

真正做版本比对的是 `changeset publish`，**不是裸 `npm publish`**。它对每个包的行为是：

1. 先查 npm registry，看这个包的本地版本是否已经存在。
2. 已经存在的版本，跳过，不调用 `npm publish`。
3. 只有本地版本在 registry 上不存在的包，才执行它的发布脚本（本项目走 setup-node 配的 `NODE_AUTH_TOKEN`，最终落到 `npm publish`）。

所以三种情况：

- 只改了文档、没碰版本号就 push → 本地版本和 npm 一致 → publish 跳过，no-op。
- 本地版本比 npm 新（刚被 version bump 过）→ 真正发包。
- 已经发过的版本再跑一次 → publish 发现已存在，跳过。

这叫幂等：重复跑没有副作用。

> 补充：如果直接跑裸 `npm publish` 而版本已存在，npm 会报 `EPUBLISHCONFLICT` 或 `E403`。`changeset publish` 帮你提前过滤掉了这种情况，让重跑不会报错。

### 保护二：质量门禁的 `&&` 短路

`turbo run lint typecheck test build && changeset publish` 里的 `&&`，前面全过才跑后面。如果 lint / typecheck / test / build 任一项挂了，`changeset publish` 根本不执行，包发不出去。

这也是为什么 release-guide 里说"发版 PR 不跑质量检查，真正的把关在分支 B 的 `pnpm release` 里"——发版 PR 只改版本号和 CHANGELOG，没必要也不该在那时跑测试；真正发包前必须过一道门禁。

---

## 三态对照表

把 `.changeset/` 状态和"本地版本 vs npm 版本"放一起看：

| `.changeset/` | 本地版本 vs npm | 含义                       | 走哪              | 实际结果                                          |
| ------------- | --------------- | -------------------------- | ----------------- | ------------------------------------------------- |
| 非空          | 无所谓          | 有新的发版意图，还没 bump  | 阶段 1（version） | bump 版本号 + 开/更新发版 PR，不发包              |
| 空            | 本地比 npm 新   | version 已完成，待 publish | 阶段 2（publish） | 跑门禁 + 真正 `npm publish`                       |
| 空            | 本地 == npm     | 这次没有新版本要发         | 阶段 2（publish） | 门禁照跑，`changeset publish` 发现无新版本，no-op |

原先的困惑"空了为什么还 publish"，对应的是中间和下面两行。它们都走 publish，靠 `changeset publish` 的版本检查自己决定到底发不发，不需要在 action 层面再做一个"空就什么都不做"的分支。

---

## 两个补充点

### 发版 PR 会被"更新"而不是"新开"

如果已经有一个 open 的 "chore: release packages" PR，你又 push 了新的 changeset，`changesets/action` 不会开第二个 PR，而是把新的 version 改动追加上去、更新原来那个 PR。所以一般同一时间只有一个发版 PR。

### 分支 B 每次都跑门禁，即使无包可发

只要 push 到 main 且 `.changeset/` 为空，`pnpm release` 就会跑 `turbo run lint typecheck test build`。哪怕最终 `changeset publish` 是 no-op（没新版本），门禁照跑。这保证 main 上的代码质量持续受监控，代价是和 `ci.yml` 的检查有一定重叠。这是设计上的取舍，不是 bug。

---

## 发版失败时的恢复路径（印证上面的逻辑）

一种典型失败：你合并了发版 PR，版本号已经写进 main（`package.json` 变成 `0.1.3`），但 Release 的 publish 步骤挂了。结果 main 上是 `0.1.3`，npm 上还停在 `0.1.2`——版本号"超前"了。

恢复时不需要重新写 changeset：

- **纯配置问题**（token、权限、网络）：修好 GitHub Secret 后，去 Actions tab 对那次失败的 Release 点 **Re-run failed jobs**，用同一个 commit 重跑。
- **代码问题**（lint/test/build 挂）：修好代码再 push。这次 `.changeset/` 是空的，Release 走阶段 2，`changeset publish` 发现本地 `0.1.3` 比 npm `0.1.2` 新，把它发出去。

关键认知：这种恢复之所以能成功，正是因为"空 + 本地版本更新"会触发 publish。

> ⚠️ **不要**为了补发而再写一个 changeset。那会把版本从 `0.1.3` 再 bump 成 `0.1.4`，`0.1.3` 就被永久跳过、发不出去了。

---

## 一句话总结

`.changeset/` 为空走 publish，是两阶段模型的收尾：version 阶段把 changeset 消费成版本号（同时清空 `.changeset/`），publish 阶段必须靠"空"来触发，再用 `changeset publish` 的版本检查保证只发该发的、不误发。

**changeset 只决定"要不要 bump"，publish 看的是"本地版本是不是比 npm 新"。**
