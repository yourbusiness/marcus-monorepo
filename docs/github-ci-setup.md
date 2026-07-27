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

这个不用你手动创建。`GITHUB_TOKEN` 是 GitHub 在每个工作流运行时自动注入的临时 token，生命周期等于工作流运行时长。只要 Actions 权限那一步里把 Workflow permissions 改成了读写，这个 token 就自动拥有 `contents: write` 和 `pull-requests: write` 权限。

---

## Actions 权限配置

### 为什么需要它

release.yml 第 13-16 行声明了三项权限：

```yaml
permissions:
  contents: write
  pull-requests: write
  id-token: write
```

- **contents: write** — 允许工作流往仓库推送代码（Changesets 会在发版时修改 `package.json` 版本号、更新 `CHANGELOG.md`，然后 push 回 main）
- **pull-requests: write** — 允许工作流创建 PR（Changesets bot 会在检测到新 changeset 文件时，创建一个标题为 `chore: release packages` 的 PR）
- **id-token: write** — 配合 `NPM_CONFIG_PROVENANCE: 'true'`（第 33 行）使用，生成 OIDC token 给 npm 做包来源签名（npm provenance），证明这个包确实是由这个 GitHub 仓库的 Actions 发布的

GitHub Actions 默认给每个工作流的权限是**只读**的，所以必须手动改成读写。

### 第一步：启用读写权限

1. 仓库页面顶部点 **Settings**
2. 左侧菜单往下拉，找到 **Actions**，点它展开，点 **General**
3. 页面中间有个 **Workflow permissions** 区块，默认选中的是 **"Read repository contents and packages permissions"**
4. 改为选中 **"Read and write permissions"**
5. 页面底部点 **Save**（不点保存的话改动不生效）

### 第二步：允许 Actions 创建和审批 PR

同一个页面（**Settings → Actions → General**），在 Workflow permissions 下方还有一个区块叫 **"Allow GitHub Actions to create and approve pull requests"**：

1. 勾选这个复选框
2. 同样点页面底部的 **Save**

不勾这一项的话，Changesets bot 创建 release PR 时会失败，因为 GitHub 不允许非人工账号创建 PR。

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
