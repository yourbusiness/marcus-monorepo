# CI / Release 流水线排障与修复方案

> 本文完整记录 `cefad0e` 推送到 main 后，CI 与 Release 两条 workflow 连续失败的排障全过程：从最初的诊断推断，到拿到真实日志后的根因纠正，再到最终的四类改动与 push。供后续同类问题对照。

---

## 版本与时间记录

| 项目       | 值                                                                        |
| ---------- | ------------------------------------------------------------------------- |
| 文档创建   | 2026-07-29 15:39 (GMT+08:00)                                              |
| 文档更新   | 2026-07-29 16:40 (GMT+08:00)（补全完整排障过程与最终改动）                |
| 远程仓库   | `git@github.com:yourbusiness/marcus-monorepo.git`                         |
| 包名（原） | `@marcus/excel-exporter`                                                  |
| 包名（现） | `@marcusok/excel-exporter` @ `0.1.1`                                      |
| 根工程版本 | `marcus-monorepo` @ `0.0.0`                                               |
| Node       | 22.22.2（CI 固定 22，来源 `.nvmrc`）                                      |
| pnpm       | 9.12.0（来源 `package.json` `packageManager`）                            |
| 构建编排   | Turborepo 2.10.7                                                          |
| 发版工具   | Changesets 2.31.1                                                         |
| npm 账号   | 用户名 `marcus_w`，新建 org `marcusok` 持有 `@marcusok` scope             |
| 最终结论   | 两条 workflow 的失败根因都是性能测试 flake；publish 层另有 scope 归属问题 |

**关键提交链**：

```
21c4f2a fix(excel-exporter): rename scope to @marcusok and skip perf tests on CI  ← 最终修复
5907517 fix(ci): skip perf tests on CI and drop test changeset
cc879b9 Merge pull request #1 ...（机器人 Version PR，远程已有）
8cb658a chore: release packages（机器人 bump 到 0.1.1）
cefad0e fix(excel-exporter): tighten exports and declare xlsx as optional peer dep  ← 失败起点
```

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

结论：失败几乎可以锁定在 CI 运行环境特有的环节，以及 GitHub/npm 配置上。

---

## 2. 第一阶段诊断：基于本地全绿的推断

> 这一节的推断后来被真实日志部分纠正（见第 3 节）。保留原推断是为了说明「为什么一开始会往权限问题上猜」。

### 2.1 当时对 CI 失败的推断

[performance.test.ts](/packages/excel-exporter/src/__tests__/performance.test.ts) 用**墙钟时间（performance.now 差值）做硬性断言**。GitHub Actions 的 ubuntu shared runner 对 CPU/WASM 任务通常比开发机慢 1.5~2x，且抖动大，必然 flake。

本地实测对照（`PERF_TIGHT` 未设，默认 1.5x slack）：

| 用例                      | 本地实测 | 阈值（1.5x 后） |
| ------------------------- | -------- | --------------- |
| 50k 行 main               | 701ms    | < 1500ms        |
| 100k 行 stream            | 1864ms   | < 3000ms        |
| format 开销差值（10k 行） | 很小     | < 45ms          |

明显征兆：本次提交把 slack 从 `1.2x` 提到了 `1.5x`（见 `git show cefad0e`），说明它一直在 CI 上 flake，一直在放宽阈值——治标不治本。

### 2.2 当时对 Release 失败的推断（后来被纠正）

当时猜测 Release 卡在「创建 Version PR」那一步，报 `HttpError: Resource not accessible by integration`，原因是仓库 Settings 的 Workflow permissions 没开「Allow GitHub Actions to create and approve pull requests」。

**这个猜测后来被证明是错的**，原因见第 3 节。

---

## 3. 第二阶段诊断：拿到真实日志后的根因纠正

用户提供了一段 Release workflow 的真实失败日志。日志的关键内容：

```
src/__tests__/performance.test.ts (4 tests | 3 failed) 7446ms
  10k rows x 4 cols (main) < 200ms   →  1296ms  expected to be less than 300
  50k rows x 4 cols (main) < 1000ms  →  2008ms  expected to be less than 1500
  100k rows x 4 cols (stream) < 2000ms → 3971ms  expected to be less than 3000

Failed: @marcus/excel-exporter#test
Error: Publish command exited with code 1
```

### 3.1 日志说了什么

CI 实测数据触目惊心，shared runner 比本地慢了将近 **3 倍**：

| 用例           | 本地实测 | CI 实测    | 阈值（1.5x 后） |
| -------------- | -------- | ---------- | --------------- |
| 10k 行 main    | —        | 1282ms     | < 300ms         |
| 50k 行 main    | 701ms    | **2008ms** | < 1500ms        |
| 100k 行 stream | 1864ms   | **3971ms** | < 3000ms        |

最后那行 `Publish command exited with code 1` 是 turbo test 失败后 `&&` 短路，`changeset publish` 根本没机会执行。

### 3.2 对 Release 失败原因的纠正（重要）

**两个 workflow 失败的根因是同一个：perf 测试在 CI runner 上 flake。不是权限问题，不是 npm 问题。**

之前猜 Release 卡在「建 Version PR」那一步（`Resource not accessible by integration`），**这个猜测是错的**。证据在日志里：带 `Publish command exited with code 1`，说明 Release 已经走到了 publish 分支（`.changeset/` 为空），也就是 Version PR 早就建好并合并了（`cc879b9`）。所以 GitHub 权限其实是通的，建 PR 没卡。

真正的卡点是：Version PR 合并触发第二次 Release，走 `pnpm release` 质量门禁，perf 测试炸了，`changeset publish` 被挡在 `&&` 后面永远跑不到。

### 3.3 这也解释了 npm 上为何查不到包

`npm view @marcus/excel-exporter` 返回 404——**包从来没被成功 publish 过**，不是 token 或 scope 的问题，是质量门禁先把它拦了。

---

## 4. CI 失败修复：性能测试开关

### 4.1 方案选择

三个方案，选了最干净的方案 A：CI 跳过 perf，本地保留。

- 方案 A（采用）：环境开关，CI 跳过、本地照跑。
- 方案 B：改成相对基线断言，改动大维护重。
- 方案 C：极端放宽阈值，即现在的状态（1.2x → 1.5x），治标不治本。

### 4.2 具体改动

**第 1 步**：[performance.test.ts](/packages/excel-exporter/src/__tests__/performance.test.ts) 加 `RUN_PERF` 开关，`describe` 包一层 `describe.runIf`：

```ts
const RUN_PERF = process.env.RUN_PERF !== "0";

describe.runIf(RUN_PERF)(
  "performance (Node WASM-core regression baseline)",
  () => {
    // ... 原有内容完全不动
  },
);
```

**第 2 步**：[ci.yml](/.github/workflows/ci.yml) 的 `pnpm test` 加 env：

```yaml
- run: pnpm test
  env:
    RUN_PERF: "0"
```

**第 3 步**：[release.yml](/.github/workflows/release.yml) 的 job env 加一行（让 `pnpm release` 里的 turbo test 也跳过 perf）：

```yaml
env:
  HUSKY: "0"
  RUN_PERF: "0"
```

### 4.3 本地验证

- `RUN_PERF` 不设（本地）：27 个测试全过，perf 照常当回归看门狗。
- `RUN_PERF=0`（模拟 CI）：perf 4 个 skip，其余 23 个全过。开关行为符合预期。

---

## 5. 顺带处理：测试 changeset 残留

### 5.1 问题

`.changeset/bumpy-tables-grin.md`（原名 `funny-pugs-leave.md`）是旧版文档验证步骤留下的测试残留，内容是「修改了一些配置文件」。它和真正的 changeset 一起会把版本多 bump 一次、changelog 混进模糊描述。

### 5.2 处理

`git rm .changeset/bumpy-tables-grin.md`，留 [fix-exports-and-peer-deps.md](/.changeset/fix-exports-and-peer-deps.md) 那条真实的。

> 注：PowerShell 里看到的中文乱码是 GBK 控制台显示问题，文件本身是 UTF-8、内容完好。

---

## 6. 第一次 push 被拒与 rebase

### 6.1 现象

```
! [rejected] main -> main (fetch first)
```

### 6.2 原因

在我改代码这段时间，远程发生了变化（Version PR 已被建出并 Merge）：

```
cc879b9 Merge pull request #1 ...（远程）
8cb658a chore: release packages（机器人 bump 到 0.1.1、消费了两个 changeset）
cefad0e fix(excel-exporter): ...（本地基于这个）
```

机器人提交 `8cb658a` 消费了 `.changeset/` 里两个 changeset，把包 bump 到 `0.1.1`，并删除了 `.changeset/` 里的两个 `.md`。

### 6.3 处理

```
git pull --rebase origin main
```

rebase 干净完成，无冲突（`bumpy-tables-grin.md` 两边都删了，git 自动处理）。本地提交挪到远程最新之上。

---

## 7. publish 层根因：npm scope 归属

### 7.1 触发

确认 `@marcus/excel-exporter` 在 npm 上是 404 后，需要排查 publish 前提。确认 npm 用户名是关键。

### 7.2 规则

npm 的 scope 归属规则：`@scope-name` 只能由用户名（或 org 名）等于 `scope-name` 的账号发布。`@marcus` 这个 scope 只属于 npm 用户名为 `marcus` 的账号。

### 7.3 确认

用户 npm 用户名是 `marcus_w`，不是 `marcus`。所以不管 NPM_TOKEN 对不对，`@marcus/excel-exporter` 的 publish 都会被 npm 拒绝（403 scope 未授权）。

### 7.4 解决

用户在 npm 新建了一个 org 名叫 `marcusok`，于是 `@marcusok` scope 归用户所有。把包名从 `@marcus/excel-exporter` 改成 `@marcusok/excel-exporter`。

### 7.5 其他选项（未采用，备查）

- 选项一（采用）：改 scope 到 `@marcusok`，确定能发。
- 选项二（未用）：在 npm 建 org 叫 `marcus`，若 `marcus` 名字没被 squatter 占用则 package.json 不用改。但 `marcus` 这种短名字极可能被占，有不确定性。

---

## 8. scope 重命名：改动清单

### 8.1 功能层（影响 publish，必须改）

- [package.json](/packages/excel-exporter/package.json) 的 `name` — 核心
- [README.md](/packages/excel-exporter/README.md) — 会发布到 npm 的安装/导入示例
- [src/index.ts](/packages/excel-exporter/src/index.ts)、[src/types.ts](/packages/excel-exporter/src/types.ts) — JSDoc 注释里的 import 示例
- [CHANGELOG.md](/packages/excel-exporter/CHANGELOG.md) — 标题里的包名
- `pnpm-lock.yaml` — 实测：pnpm 按 workspace 路径引用内部包，改名不影响锁文件哈希，`pnpm install` 报 `Lockfile is up to date`，无需重新生成

### 8.2 文档层（不影响 publish，为一致性一起改）

- 根 [README.md](/README.md)
- docs 下的 design / workflow / debug 三份文档

### 8.3 验证

`rg "@marcus/" --glob '!node_modules' --glob '!pnpm-lock.yaml'` 无匹配，仓库内 59 行对称改动，全部替换为 `@marcusok/`。`pnpm exec turbo run lint typecheck test build --force` 全绿，27 测试通过，包名已是 `@marcusok/excel-exporter@0.1.1`。

---

## 9. PowerShell 脚本误改编码的事故与修复

### 9.1 事故

scope 重命名时，用了一段 PowerShell 批量替换 docs 文件的脚本：

```powershell
Get-ChildItem -Path docs,README.md -Recurse -File | ForEach-Object {
  (Get-Content $_.FullName -Raw) -replace '@marcus/', '@marcusok/' |
    Set-Content -Path $_.FullName -NoNewline -Encoding UTF8
}
```

两个问题：

1. **递归误伤 node_modules**：`-Recurse` 把 `node_modules` 里成千上万个第三方包的 README 也改了。好在 `node_modules` 在 `.gitignore` 里，git 不跟踪，不会进仓库。后续 `pnpm install --force`（重装 477 个包）恢复了干净状态。
2. **编码损坏**：`Get-Content` 按 GBK 读取 UTF-8 中文 → 乱码，`Set-Content -Encoding UTF8` 写回时加了 BOM。三份 docs 中文全乱、加了 BOM。

### 9.2 修复

用 git 原始内容 + .NET API 精确控制编码重写：

```powershell
foreach ($f in @("docs/commit-and-release-workflow.md","docs/debug.md","docs/excel-export-design.md")) {
  $original = git show "HEAD:$f"
  $new = $original -replace '@marcus/', '@marcusok/'
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines((Resolve-Path $f).Path, $new, $utf8NoBom)
}
```

验证：三份文档无 BOM（首字节是 `#` 的 ASCII 35），中文恢复正常，diff 行数回归正常（只含 scope 替换）。

### 9.3 教训

批量改文件编码时，不要用 PowerShell 的 `Get-Content`/`Set-Content` 处理含中文的 UTF-8 文件——默认走 GBK 且会加 BOM。要么用 `rg` 替换，要么显式用 `[System.IO.File]` + `UTF8Encoding($false)`。

---

## 10. 最终提交与 push

### 10.1 提交

两个本地提交：

```
21c4f2a fix(excel-exporter): rename scope to @marcusok and skip perf tests on CI
5907517 fix(ci): skip perf tests on CI and drop test changeset
```

### 10.2 push 前确认

- GitHub 仓库 Workflow permissions：Version PR 能建出说明权限已通，无需再动。
- `NPM_TOKEN` secret：用户确认存在。
- npm scope：`@marcusok` org 已建，归属已解决。

### 10.3 push

```
git push origin main
```

push 后 CI 和 Release 同时起跑。预期：

- **CI**：带 `RUN_PERF=0`，perf 4 个测试显示 skipped，其余 23 个通过，应该绿。
- **Release**：`.changeset/` 为空走 publish 分支，质量门禁这次能过（perf 跳过），`changeset publish` 第一次真正执行，把 `@marcusok/excel-exporter@0.1.1` 发到 npm。

---

## 11. 问题汇总与根因地图

把整个排障过程中遇到的问题按类别归一遍，供对照：

**1. CI 失败（第一根因）**

- 根因：性能测试用墙钟时间做绝对断言，shared runner 抖动必然 flake。
- 修复：`RUN_PERF` 开关，CI 跳过、本地保留。

**2. Release 失败（第一根因）**

- 根因：同 CI——`pnpm release` 里的 `turbo run ... test` 被 perf 测试挡住，`&&` 短路，`changeset publish` 跑不到。
- 修复：同 CI 的 `RUN_PERF` 开关（release.yml 的 job env）。

**3. CI / Release 第二次失败（第二根因，关键）**

- 根因：`RUN_PERF` 只在 ci.yml / release.yml 声明了，但没在 `turbo.json` 的 `globalEnv` 声明，turbo 的 Strict Mode 把它过滤掉，vitest 子进程拿不到。
- 修复：`turbo.json` 的 `globalEnv` 加 `"RUN_PERF"`。
- 教训：环境变量穿过多层进程时每一层都要放行；本地验证必须走和 CI 一致的调用路径（根目录 turbo，不是子目录直接跑）。

**4. push 被拒**

- 根因：排障期间机器人的 Version PR 已在远程合并，本地落后。
- 修复：`git pull --rebase origin main`。

**5. npm 查不到包**

- 根因：质量门禁把 publish 挡住了（问题 2 的连锁结果），不是 token 或 scope 问题。
- 修复：随问题 2/3 一起解决。

**6. publish 会失败的隐患（暴露在质量门禁修复后）**

- 根因：npm 用户名 `marcus_w` 不持有 `@marcus` scope。
- 修复：新建 npm org `marcusok`，包名改为 `@marcusok/excel-exporter`。

**7. 测试 changeset 残留**

- 根因：旧版文档验证步骤的遗留文件没删。
- 修复：`git rm`。

**9. publish E404（第四轮，token 缺 scope 权限）**

- 根因：NPM_TOKEN 在创建 marcusok org 前就建好，权限边界没包含 @marcusok scope，PUT 报 E404。
- 修复：重新生成覆盖 @marcusok 的 token，更新 GitHub secret，re-run Release。
- 教训：新建 org/scope 后要同步重建 token；区分 publish 报错看关键字——Publish command exited（门禁挡）、403（scope 归属）、404（token 权限边界）、401（token 无效）。

**8. PowerShell 脚本编码事故（排障过程引入）**

- 根因：批量脚本递归误伤 + GBK/BOM 编码损坏。
- 修复：git 原始内容 + .NET UTF8 无 BOM 重写 + `pnpm install --force`。

---

## 12. 三轮失败完整时间线

整个排障跨了三轮 push，每一轮 CI 和 Release 都失败。下面把三轮的数据和根因对照清楚。

### 第一轮：`cefad0e`（最初触发）

- **原因不明确**，只有推断：本地全绿，猜测是 perf flake + Release 权限问题。
- **CI**：推测 perf 测试超时（无日志佐证，但后续验证了这个方向）。
- **Release**：推测卡在建 Version PR（`Resource not accessible by integration`）。
- **结果**：Version PR 实际建出并 Merge 了（`cc879b9`），说明权限推断是错的。

### 第二轮：`21c4f2a`（加了 RUN_PERF 开关 + 改 scope）

这一轮加了 `RUN_PERF` 开关，但没改 turbo.json，所以开关没生效。

**CI 日志**（实测数据）：

```
src/__tests__/performance.test.ts (4 tests | 1 failed) 4544ms
  10k rows   490ms   expected 463 to be less than 300      ← FAIL
  50k rows   1028ms                                          ← PASS（侥幸过）
  100k rows  2888ms                                          ← PASS（侥幸过）
```

关键：perf 测试在跑（没被 skip），`RUN_PERF=0` 没生效。50k 和 100k 这次侥幸没超阈值，只有 10k 那条挂了，但本质问题没解决。

**Release 日志**（实测数据）：

```
src/__tests__/performance.test.ts (4 tests | 3 failed) 8149ms
  10k rows   1265ms   expected 1213 to be less than 300     ← FAIL
  50k rows   2533ms   expected 2530 to be less than 1500    ← FAIL
  100k rows  4188ms   expected 4186 to be less than 3000    ← FAIL
```

三条全挂，CI 比 CI 那次还慢（同一 runner、不同时刻，抖动差异）。最后：

```
Tasks: 3 successful, 4 total   ← lint/typecheck/build 都过了，只有 test 挂
Error: Publish command exited with code 1   ← && 短路，changeset publish 跑不到
```

**两个数据对比说明**：CI 和 Release 跑在各自的 runner 上，性能数据有差异（Release 那次更慢，三条全挂），但根因完全相同——turbo 过滤了 `RUN_PERF`。

### 第三轮：`87855d6`（补 turbo.json globalEnv，待验证）

这一轮修复了 turbo.json，用根目录 turbo 路径本地验证通过：

- `RUN_PERF=0` + `pnpm exec turbo run test --force` → perf 4 个全部 skip，其余 23 个通过。

这是第一次用和 CI 一致的调用路径验证。结果待 push 后的 Actions 确认。

---

## 13. Release 失败的完整解读

### 13.1 Release 日志逐行解读

第二次失败时 Release 的日志，逐段说明：

```
@marcusok/excel-exporter#test
```

scope 名是 `@marcusok`，说明 `21c4f2a` 的 scope 重命名已生效。

```
src/__tests__/performance.test.ts (4 tests | 3 failed) 8149ms
```

perf 测试在跑（没被 skip），3 条超阈值。证明 `RUN_PERF=0` 没传到 vitest。

```
Tasks: 3 successful, 4 total
Failed: @marcusok/excel-exporter#test
```

lint、typecheck、build 三个 task 都过了，只有 test 挂。说明代码质量本身没问题，纯粹是 perf 测试的时间断言。

```
Error: Publish command exited with code 1
```

`pnpm release` 的脚本是 `turbo run lint typecheck test build && changeset publish`。test 失败 → `&&` 短路 → `changeset publish` 永远跑不到。这行不是 publish 本身报错，是 quality gate 失败的连锁结果。

### 13.2 为什么 CI 和 Release 挂在同一个地方

CI 和 Release 都调 `pnpm test`（= `turbo run test`），都经过 turbo。所以 turbo 的 Strict Mode 过滤 `RUN_PERF` 这个问题，两条流水线同时踩中。修 turbo.json 一个文件，两条一起解决。

### 13.3 Release 比 CI 数据更差的原因

CI 那次只有 1 条失败（10k），Release 那次 3 条全失败。这是因为 GitHub Actions 的不同 job 跑在不同 runner 实例上，shared runner 的 CPU/内存性能波动很大。这进一步印证了用绝对时间做断言不可靠——同一个 commit、同一段代码，不同 runner 上结果完全不同。

---

## 14. turbo Strict Mode 根因详解

### 14.1 现象

ci.yml 和 release.yml 的改动是对的（`RUN_PERF: "0"` 确实写了），但 perf 测试照样跑，说明环境变量没传到 vitest。

### 14.2 根因

调用链：GitHub Actions step（设 `RUN_PERF=0`）→ `pnpm test` → `turbo run test` → turbo 启动 vitest 子进程 → **turbo 在这层把未声明的环境变量过滤掉**。

Turbo 官方文档原文：

> Strict Mode is the default environment handling mechanism, ensuring that only explicitly configured environment variables are made available to tasks. Tasks will only see variables listed in `env`, `globalEnv`, `passThroughEnv`, or `globalPassThroughEnv`, with any unlisted variables being filtered out.

`turbo.json` 的 `globalEnv` 当时是 `["NODE_ENV", "CI", "PERF_TIGHT"]`——有 `PERF_TIGHT`（所以它能生效），但**没有 `RUN_PERF`**（所以被过滤）。

vitest 里 `process.env.RUN_PERF` 是 undefined → `undefined !== "0"` 为 true → `describe.runIf(true)` → 测试照跑。

### 14.3 为什么本地验证没发现（疏漏复盘）

之前的本地验证是在 `packages/excel-exporter` 目录直接跑 `pnpm test`（= `vitest run`），**绕过了 turbo 这一层**。vitest 进程直接继承了 shell 的 `RUN_PERF=0`，所以验证「通过」。

但 CI 走的是**根目录** `pnpm test`（= `turbo run test`），中间隔着 turbo 的环境变量过滤。本地验证没复现这条真实路径。

### 14.4 修复

[turbo.json](/turbo.json) 的 `globalEnv` 加 `RUN_PERF`：

```json
"globalEnv": ["NODE_ENV", "CI", "PERF_TIGHT", "RUN_PERF"],
```

### 14.5 验证（这次走 turbo 真实路径）

在**根目录**用 `pnpm exec turbo run test` 验证，复现 CI 的调用方式：

- `RUN_PERF` 不设（本地默认）：27 个测试全过，perf 照跑。
- `RUN_PERF=0`（模拟 CI）：

```
src/__tests__/performance.test.ts (4 tests | 4 skipped)
Test Files  4 passed | 1 skipped (5)
Tests       23 passed | 4 skipped (27)
```

4 个 perf 全部 skip，其余 23 个通过。这次走的是和 CI 完全一致的 turbo 路径。

### 14.6 教训

**环境变量要穿过多层进程时，每一层都要能放行。** 链路是 GitHub Actions → turbo → vitest，中间 turbo 默认拦截。改测试行为的环境变量，必须同时在 turbo.json 声明。本地验证也必须走和 CI 完全一致的调用路径——根目录 turbo，不是子目录直接跑。

---

## 15. 第三轮结果：质量门禁通过，publish 第一次真正执行

push `87855d6` 后的结果：

- **CI**：✅ 成功。`RUN_PERF=0` 这次生效了（turbo.json 补了 `globalEnv`），perf 4 个测试 skip，质量门禁通过。三轮里第一次 CI 绿。
- **Release**：✅ 质量门禁通过，`changeset publish` 第一次真正执行——不再被 `&&` 短路挡住。

至此 perf 测试这个贯穿前三轮的根因彻底解决。但 Release 在 publish 那一步报了新的错（见第 16 节），这是 publish 层的第三个子问题。

---

## 16. 第四轮失败：publish E404（NPM_TOKEN 缺 scope 发布权限）

### 16.1 现象

CI 绿了，Release 质量门禁过了，`changeset publish` 终于执行，但发布报 E404：

```
warn  Received 404 for npm info "@marcusok/excel-exporter"
info  @marcusok/excel-exporter is being published because our local version (0.1.1) has not been published
error E404 Not Found - PUT https://registry.npmjs.org/@marcusok%2fexcel-exporter - Not found
error npm error code E404
```

最后：

```
packages failed to publish:
  @marcusok/excel-exporter@0.1.1
```

### 16.2 日志逐行解读：先排除不是什么

这个 404 容易误判。日志里有几条关键信息，能排除常见错误方向：

**不是认证失败**。日志里有这两行：

```
npm notice publish Signed provenance statement with source and build information from GitHub Actions
npm notice publish Provenance statement published to transparency log: https://search.sigstore.dev/?logIndex=2280026470
```

provenance 签名能成功，说明 OIDC token 认证通过、`id-token: write` 生效、`NPM_TOKEN` 是有效 token。如果 token 无效，会报 401（`ENEEDAUTH`），而不是走到 provenance 签名这一步。

**不是包已存在**。404 on PUT 配合 `npm info` 也 404，说明包在 registry 上根本不存在。正常情况全新包第一次 PUT 会创建包、返回成功，不该 404。

**不是 scope 归属问题**。第 7 节已经解决：`@marcusok` org 已建、归属用户。如果是 scope 不归你，报的是 403 Forbidden（`forbidden access`），不是 404。

### 16.3 真正的根因：NPM_TOKEN 没有 @marcusok scope 的发布权限

查询 registry 端点印证：

```
registry.npmjs.org/-/org/marcusok   → 404
registry.npmjs.org/@marcusok        → 405
registry.npmjs.org/@marcusok/excel-exporter → 404
```

这个 404 on PUT 是 npm registry 找不到 token 对应账号在 `@marcusok` scope 下的发布入口——token 的权限边界里没包含这个 scope。

最可能的原因：**`NPM_TOKEN` 是在创建 `marcusok` org 之前就建好的**。npm token 有 scope 权限边界：

- 如果是 **Granular Access Token**：建 token 时要选 scope，当时 `marcusok` org 还不存在，token 的 scope 列表里没有它，自然发不进去。
- 如果是 **Classic Automation token**：虽然不限定 scope，但 404 on PUT 通常意味着 token 对应账号与 org 的成员关系/权限没对上。

无论哪种，解法都是**重新生成 token，让它覆盖 `@marcusok` scope**。

### 16.4 修复步骤

**第一步：重新生成 npm token**

1. 登录 [npmjs.com](https://www.npmjs.com) → 右上头像 → **Access Tokens**。
2. 建一个新的 Granular Access Token：
   - **Packages and scopes**：权限选 **Read and write**，把 `@marcusok` scope 加进来（org 已存在，能选到）。
   - **Expiration**：设 1 年。
   - 账号开了 2FA：勾 **Allow bypass 2FA for this token**。
3. 生成后复制 `npm_` 开头的串。

> 备选：用 Classic Automation token（不限定 scope、天然绕开这个问题），创建时选 "Automation" 类型即可，同样存为 `NPM_TOKEN`。

**第二步：更新 GitHub secret**

1. 仓库 **Settings → Secrets and variables → Actions**。
2. 找到 `NPM_TOKEN` → 点 **Update**（编辑铅笔图标）。
3. 粘贴新 token → Save。

**第三步：重新触发 Release**

`NPM_TOKEN` 更新后不用改代码。当前这次 Release 已失败结束，需要重新触发一次。最简单的办法是在 GitHub 上 re-run：

1. 仓库 **Actions** tab → 左侧 **Release** workflow。
2. 找到这次失败的那次运行 → 右上角 **Re-run failed jobs**（或 Re-run all jobs）。

re-run 会用最新的 secret（含刚更新的 `NPM_TOKEN`）重跑，不用改代码、不用重新 push。

### 16.5 经验：publish 层的三个子问题

publish 这一关前后踩了三个坑，按暴露顺序：

| 顺序 | 问题                 | 症状                                                | 根因                                            |
| ---- | -------------------- | --------------------------------------------------- | ----------------------------------------------- |
| 1    | 质量门禁挡住 publish | `Publish command exited with code 1`（perf 测试炸） | perf 测试 flake + turbo 过滤 RUN_PERF           |
| 2    | scope 归属错         | （未实际触发，提前发现）                            | npm 用户名 `marcus_w` 不持有 `@marcus`          |
| 3    | token 缺 scope 权限  | E404 on PUT                                         | token 在建 org 前生成，权限边界没含 `@marcusok` |

前两个是「publish 跑不到」，第三个是「publish 跑到了但被拒」。区分这三类，看报错关键字：`Publish command exited`（门禁挡）、403（scope 归属）、404（token 权限边界）、401（token 无效）。

---

## 17. 待观察

换 token + re-run 后的结果待确认。这次 publish 层的三个子问题都已清除：

- 质量门禁：perf 已跳过（第 14 节）。
- scope 归属：`@marcusok` org 已建（第 7 节）。
- token 权限：换覆盖 `@marcusok` 的新 token（第 16 节）。

预期 re-run 后 publish 成功，`@marcusok/excel-exporter@0.1.1` 出现在 [npmjs.com](https://www.npmjs.com/package/@marcusok/excel-exporter)。如仍有红的，根据具体报错进一步处理。
