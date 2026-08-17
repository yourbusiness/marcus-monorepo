# 生态介绍

`marcus-monorepo` 是一个 pnpm + Turborepo 组织的前端基础 monorepo，为多个后台应用提供统一的公共能力包。每个包独立版本、独立发布（Changesets），通过 `workspace:*` 在仓库内互引。

## 当前包

| 包                                                      | 状态   | 说明                                                                                         |
| ------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| [`@marcusok/excel-exporter`](/packages/excel-exporter/) | stable | Excel 导出核心库：modern-xlsx + Fast stream、完整样式、Worker 多线程、快速写入、SheetJS 兜底 |

## 工程约定

- 包管理器：pnpm workspace（`pnpm >= 9`）
- 构建编排：Turborepo（`^build` 自动处理包依赖顺序）
- 包构建：tsup（TS → ESM + DTS，ESM-only）
- 语言：TypeScript 5.x（`moduleResolution: bundler`）
- 测试：Vitest；代码规范：ESLint 9 + Prettier
- 版本/发布：Changesets（多包独立发版、自动 changelog、支持 prerelease）
- CI/CD：GitHub Actions（`ci.yml` 校验、`release.yml` 自动发布 npm、`deploy.yml` 部署本文档站到 GitHub Pages）

## 路线图

生态将按需扩展，规划方向包括：

- PDF 导出
- 文件上传（分片 / 进度）
- 虚拟表格渲染

新包发布后，只需在文档站 `apps/docs/.vitepress/registry.ts` 登记一条记录并补充对应文档，即可自动出现在本站在线文档中。
