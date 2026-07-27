## NPM_TOKEN 配置指南

### 背景：NPM_TOKEN 在你的 release 工作流里怎么被用到的

`release.yml` 第 30-36 行：

```yaml
      - run: pnpm install --frozen-lockfile
      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          publish: pnpm release
          version: pnpm version-packages
          commit: 'chore: release packages'
          title: 'chore: release packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_CONFIG_PROVENANCE: 'true'
```

Changesets Action 内部逻辑是：

1. 检查 `main` 分支上有没有 `.changeset/*.md` 文件
2. 如果有 → 说明开发者标记了"下次发版要包含这些改动"，Action 执行 `pnpm version-packages`，把版本号写进各子包的 `package.json`，生成 `CHANGELOG.md`，删除 changeset 文件，然后把这些改动作为一个新 commit 推上 main
3. 如果没有 changeset 文件 → 说明所有改动都已经版本化了，该发布了，Action 执行 `pnpm release`，也就是 `turbo run build && changeset publish`

第 3 步里的 `changeset publish` 最终调用的是 `npm publish`。npm 要求 publish 操作必须认证，认证方式就是读取环境变量 `NPM_TOKEN`。没有这个变量 → `npm publish` 直接报 401。

---

### A 路线：已有 npm 账号，生成 token

#### A-1：进入 Access Tokens 页面

1. 登录 [npmjs.com](https://www.npmjs.com) 后，页面右上角是你的头像或首字母圆圈，点它
2. 弹出一个下拉菜单，点 **Access Tokens**
3. 页面 URL 会变成 `https://www.npmjs.com/settings/<你的用户名>/tokens`

#### A-2：选择 token 类型

这个页面有个 **Generate New Token** 的黄色按钮。点它会出现一个选择界面，有三种 token：

| Token 类型 | 能用吗 | 为什么 |
|---|---|---|
| Classic Token | ⚠️ 看情况 | 如果你的 npm 账号开了 2FA（双因素认证），CI 环境里 npm 会自动弹出 2FA 验证码输入提示，但 GitHub Actions 里没有人能输这个码，所以 publish 会卡住。没用 2FA 的话可以 |
| Granular Access Token | ❌ 不行 | 细粒度 token 设计用于"读取/安装"场景，不支持 `npm publish` 命令 |
| Automation Token | ✅ 推荐 | 专为 CI/CD 设计，自动绕过 2FA，权限限定在 publish/read，不会给账号管理权限 |

**选 Automation Token**。只要你用 GitHub Actions 发版，这是唯一可靠的选择。

如果下拉里没有 Automation Token 选项，说明你的账号没开 2FA。去 `https://www.npmjs.com/settings/<你的用户名>/tfa` 开启双因素认证后再回来，Automation Token 选项就会出现。

#### A-3：生成 token

选 Automation Token 后：

1. npm 会让你确认。点 **Generate Token**
2. 页面刷新后，顶端会出现一个绿色的提示条，里面是类似这样的字符串：
   ```
   npm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
3. **立刻复制**。复制后把这串字符贴到记事本之类的地方暂存。这个字符串只在这一次显示，刷新或关闭页面后 npm 不会再展示它。

#### A-4：验证 token 是否有效（可选）

在本地终端执行：

```bash
npm whoami --registry=https://registry.npmjs.org
```

如果返回你的 npm 用户名，说明当前登录态有效。这一步不重要，CI 里用的是 token 不是本地登录态。

---

### B 路线：没有 npm 账号，先注册

#### B-1：注册

1. 打开 [https://www.npmjs.com/signup](https://www.npmjs.com/signup)
2. 填写：
   - **Username**：会是你包的 scope 名（比如 `@yourname/excel-exporter`），选好就改不了了
   - **Email**：用来收验证邮件
   - **Password**：要有大小写字母和数字
3. 勾选 "I agree to the terms of service"
4. 点 **Create Account**

#### B-2：验证邮箱

npm 会往你的邮箱发一封验证邮件。点邮件里的 **Verify Email Address** 链接。没收到的话检查垃圾邮件箱。

#### B-3：开启 2FA（双因素认证）

1. 登录 npm 后，点右上角头像 → **Account**
2. 左侧菜单点 **Two-Factor Authentication**
3. 点 **Enable 2FA**，用手机上的 Google Authenticator / Authy / 1Password 等 app 扫码
4. 输入 app 生成的 6 位验证码，确认

开启 2FA 后，跳回上面的 **A 路线**生成 Automation Token。

---

### 把 token 放入 GitHub Secret

1. 浏览器打开 `https://github.com/yourbusiness/marcus-monorepo`
2. 页面顶部一排 tab：Code / Issues / Pull requests / Actions / Projects / Wiki / Security / Insights / **Settings**，点 **Settings**
3. 左侧竖排菜单，往下找到 **Secrets and variables**（有个钥匙图标），点它展开
4. 展开后有两个子项：**Actions** 和 **Codespaces**，点 **Actions**
5. 页面中间标题是 **Repository secrets**，下面如果已经有其他 secret 会列出来。右边有个绿色按钮 **New repository secret**，点它
6. 弹出两栏表单：
   - 上面一栏标签是 **Name**，填 `NPM_TOKEN`（必须完全一致，大小写也要对）
   - 下面一栏是 **Secret**，粘贴 `npm_xxxxxxxxxxxx`
7. 点绿色 **Add secret** 按钮

添加完成后页面会刷新，列表里多一行 `NPM_TOKEN`，值显示为 `****` 掩码。从这一刻起，release 工作流里的 `${{ secrets.NPM_TOKEN }}` 就能拿到这个值了。

---

### 为什么 GITHUB_TOKEN 不用管

release.yml 第 29 行也引用了一个 secret：

```yaml
GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

这个不用你手动创建。`GITHUB_TOKEN` 是 GitHub 在每个工作流运行时自动注入的临时 token，生命周期等于工作流运行时长。只要 Actions 权限那一步里把 Workflow permissions 改成了读写，这个 token 就自动拥有 `contents: write` 和 `pull-requests: write` 权限。不需要你去 Secrets 页面手动添加任何东西。

---

## Actions 权限配置

### 为什么需要改权限

先看 release.yml 第 13-16 行声明了什么：

```yaml
permissions:
  contents: write
  pull-requests: write
  id-token: write
```

YAML 里声明权限只是"申请"，GitHub 会不会真的给你，取决于仓库的 Actions 设置。这三项权限分别对应 release 工作流的三个关键操作：

#### `contents: write` — 允许工作流向仓库推送代码

Changesets 的 Version Packages 步骤会做这些事：

1. 读取当前 main 分支上的 `.changeset/*.md` 文件
2. 根据 changeset 内容，修改受影响子包的 `package.json`（把 `version` 从 `1.0.0` 改成 `1.0.1` 等）
3. 为每个被修改的包生成或追加 `CHANGELOG.md`
4. 删除已经消费掉的 `.changeset/*.md` 文件
5. 把这些改动作为一个新 commit push 回 main 分支

第 4 步和第 5 步需要 `contents: write`。没有这个权限，Action 执行到 git push 那一步会直接失败，报 403 权限拒绝。

#### `pull-requests: write` — 允许工作流创建 PR

Changesets 的 Create Release Pull Request 步骤的完整流程：

1. 工作流在 main push 时触发
2. Changesets Action 检查 main 上是否有 changeset 文件
3. 如果有，它创建一个新分支（比如 `changeset-release/main`）
4. 在上面做版本号和 CHANGELOG 的修改
5. 通过 GitHub API 提交一个 Pull Request，标题是 `chore: release packages`
6. 等你 review 并合并这个 PR

第 5 步需要 `pull-requests: write`。没有这个权限，GitHub API 返回 403，PR 创建失败。

#### `id-token: write` — 生成 OIDC token 用于 npm provenance

release.yml 第 33 行：

```yaml
NPM_CONFIG_PROVENANCE: 'true'
```

这个配置告诉 npm："这个包是由 GitHub Actions 发布的，我需要你记录下发布来源"。npm provenance 是 npm 的一个安全特性，它在包的发布记录里加上一条可验证的签名，证明这个包确实是从哪个 GitHub 仓库的哪个 workflow 跑出来的，没有被篡改过。

实现方式：GitHub Actions 生成一个 OIDC (OpenID Connect) token，里面包含仓库名、workflow 文件名、Git ref 等信息，npm 用这个 token 做来源验证和签名。生成这个 OIDC token 需要 `id-token: write` 权限。

如果不开这个权限，npm publish 会因为无法获取 provenance 信息而失败（npm 在 `NPM_CONFIG_PROVENANCE: 'true'` 时会强制要求 OIDC token）。

### 为什么默认不生效

GitHub 对 Actions 的默认权限策略是**最小权限原则**——只读。打开一个全新仓库，Workflow permissions 默认选中：

> **Read repository contents and packages permissions**

这意味着 `GITHUB_TOKEN` 只有只读权限。你的 release.yml 虽然声明了 `contents: write`，但 GitHub 的仓库级设置覆盖了它——声明被降级为只读。所以必须手动改。

### 第一步：启用读写权限

**操作路径：**

1. 打开 `https://github.com/yourbusiness/marcus-monorepo`
2. 点顶部 **Settings** tab（如果 Settings 不显示，说明你不是仓库管理员，需要找 owner 操作）
3. 左侧竖排菜单往下拉，找到 **Actions**，点它展开（不要直接点 Actions 到 Actions 运行页面，要展开后点下面的 **General**）
4. 点开 **General** 后，页面往下滚动，找到 **Workflow permissions** 区块
5. 你会看到两个单选项：
   - ☐ **Read repository contents and packages permissions**（默认选中）
   - ☐ **Read and write permissions**（我们需要这个）
6. 勾选 **Read and write permissions**
7. 左侧会出现一个提示，建议你按 workflow 文件里的 `permissions` 字段做更细粒度的控制——你的 release.yml 已经写了 `permissions: { contents: write, pull-requests: write, id-token: write }`，所以已经是最细粒度的了，不需要额外操作
8. 滚动到页面最底部，点绿色 **Save** 按钮

**如果不保存**，改动不会生效。GitHub 的 Settings 页面每个区块都是独立保存的。

### 第二步：允许 Actions 创建和审批 PR

这个设置和第一步在同一个页面，在 Workflow permissions 区块的正下方。

**操作路径：**

1. 往下滚动，找到 **"Workflow permissions"** 下方的一个复选框区块
2. 标题是：**☐ Allow GitHub Actions to create and approve pull requests**
3. 勾选它
4. 滚动到页面底部，点绿色 **Save**

**这个设置控制什么？**

GitHub 默认不允许自动化工具（包括 Actions）创建 PR，只允许人类用户通过 UI 创建。这是为了防止恶意 workflow 自动提交恶意 PR。

对于 Changesets 来说，Create Release Pull Request 步骤就是自动创建 PR 的过程——它不在浏览器里点按钮，而是通过 GitHub REST API 调用 `POST /repos/{owner}/{repo}/pulls`。如果这个复选框没勾，GitHub 服务端直接拒绝这个 API 调用，返回 403。

勾选后，Action 创建的 PR 会显示是由 `github-actions[bot]` 这个机器人账号提交的。

### 设置后的效果验证

全部配置完成后，你的仓库 Actions 权限状态应该是：

- Workflow permissions: **Read and write**
- Allow Actions to create PRs: **已勾选**

此时 release 工作流拥有全部三项权限：`contents: write`、`pull-requests: write`、`id-token: write`。

### 常见问题

**Q: 我只改了 Workflow permissions 为读写，没勾"允许 Actions 创建 PR"，会怎样？**

CI 工作流（`ci.yml`）不受影响，因为 CI 不需要创建 PR。但 release 工作流会在 "Create Release Pull Request" 步骤报错，日志显示类似：

```
HttpError: Resource not accessible by integration
```

这是因为 Changesets 调用 `POST /repos/{owner}/{repo}/pulls` 被 GitHub 拒绝了。

**Q: 我如果不想放开全局权限，能不能只针对 release.yml 放开？**

可以。Workflow permissions 保持默认的 **Read**，然后在 release.yml 所在的 `.github/workflows/` 目录下，GitHub 会识别 workflow 文件内声明的 `permissions` 字段。前提是 Settings → Actions → General → 最底部的 **"Allow GitHub Actions to create and approve pull requests"** 依然要勾选，这个没有按 workflow 级别的控制。

但是，如果 Workflow permissions 选的是 **Read**，那么即使你的 release.yml 声明了 `permissions: { contents: write }`，GitHub **仍然会以仓库级设置为准**，把权限降级为只读。所以 Workflow permissions 必须选 **Read and write**，才能让 workflow 文件里的权限声明生效。

**Q: provenance 不开行不行？**

可以。在 release.yml 里把 `NPM_CONFIG_PROVENANCE: 'true'` 删掉或者改成 `'false'`，就不再需要 `id-token: write` 权限了。但保留 provenance 是 npm 推荐的安全实践，能让使用者验证包来源，建议保留。

---

## 如何验证配置生效

最简单的验证方式：

1. 在本地项目根目录执行：
   ```bash
   pnpm changeset
   ```
   按提示选一个包（`packages/excel-exporter`），选一个版本类型（比如 `patch`），写一句 change 描述。

2. 提交并推送：
   ```bash
   git add .changeset/
   git commit -m "chore: test changeset"
   git push
   ```

3. 推送到 main 后，release 工作流会自动运行，如果一切正常，它会在仓库的 Pull requests 页面创建一个标题为 `chore: release packages` 的 PR。

4. 合并这个 PR 后，release 工作流会再次触发，这次它会执行 `pnpm release`，把包发到 npm。

如果到期没创建 PR，去 Actions 页面点开 release 工作流的运行记录，看哪个步骤报错了。
