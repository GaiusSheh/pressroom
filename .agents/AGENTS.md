# Pressroom

## 项目概述
免费开源的 Obsidian 发布插件：多站点、逐篇发布、零 frontmatter、带管理面板，目标生成器 Quartz 5、存储后端 GitHub，用于替换 Enveloppe。

## 当前状态
- **阶段**: Phase 1 工程骨架与核心纯逻辑已完成（2026-10-03 验收通过）
- **已有能力**: 设置页（站点、token、测试连接）；core 模块（Quartz 适配、GitHub 客户端、manifest）均有单元测试；尚无发布功能
- **下一步**: 编写 Phase 2（单站发布闭环：右键发布 / 更新 / 撤稿 / 取链接）详细计划
- **真相源**: 需求 `.dev/docs/requirements/v0/requirements.md`（当前为 v1）；总体计划 `.dev/plans/implementation_plan.md`；验证结论 `.dev/docs/others/phase0-findings.md`

## 关键技术决策
- `src/core/` 不依赖 `obsidian`，HTTP、YAML 解析由 `src/platform/` 注入 → 可在 Node 中单元测试
- slug 直接依赖 `@quartz-community/utils/path`；链接目标写目标的 slug，格式按站点 `markdownLinkResolution` 适配
- 网址冲突检测比较站点内容目录全部文件 + aliases（Quartz 遇冲突只警告、后者覆盖）
- 右键菜单用一级菜单项 + 站点选择弹窗（`src/ui/site-picker.ts`；公开 API 无二级子菜单）
- token 存 `secretStorage`，权限仅 Contents 读写
- `minAppVersion` 1.13.0：设置页用声明式 API；站点子页面是自定义 `SettingPage`（子页面内不能调用 `update()`）
- manifest 与内容在同一次提交写入；序列化稳定，内容不变则 blob SHA 不变

## 项目约定

- **脱敏（开源仓库，必须遵守）**：仓库内任何文件（文档、conversationlog、changelog、注释、测试数据、fixture）都不得出现作者的真实站点名、站点网址、仓库名、真实人名或私人笔记内容。示例一律用占位：站点「站点 A / 站点 B」、网址 `https://example.pages.dev`、分支 `main`、排除文件夹 `Private`、笔记「示例笔记 / 示例标题」。
  - 原因：同时写出多个真实站点，会让外人看出这些站属于同一人，直接违背需求 §8「站点隔离」要保护的东西。
- 代码注释、README、commit message 用中文。
- 本地凭据与测试仓库名只放 gitignore 的 `.env.local`。
- npm 命令在 PowerShell 中运行；写文件用 Edit / Write 工具，不用 shell 重定向（见 `.agents/notes/known_pits.md`）。
- 正式单元测试在 `.dev/unit-tests/`（`npm test`），探索性脚本在 `.dev/tests/`。
