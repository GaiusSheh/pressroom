# Pressroom

## 项目概述
免费开源的 Obsidian 发布插件：多站点、逐篇发布、零 frontmatter、带管理面板，目标生成器 Quartz 5、存储后端 GitHub，用于替换 Enveloppe。

## 当前状态
- **阶段**: Phase 4 多站点与目录模式已完成（2026-10-05 验收通过）
- **已有能力**: 发布 / 更新 / 撤稿 / 取链接 / 打开网页（含「全部站点」）；手动与跟随 vault 两种目录模式及切换；改名自动写回、「已移动」与挪动（aliases 跳转）；跟随站点的连带发布；内容转换、跨站与隔离、反向链接提醒
- **尚未实现**: 管理面板与批量按钮（一键同步 / 更新 / 重排 / 清理已删除）、手动站点的站内改名 / 移动（Phase 5）；导入、README、发布（Phase 6）
- **下一步**: 编写 Phase 5（管理面板）详细计划；挪动 core（`publishBatch` 跟随站点自动挪动）可供「一键同步 / 重排」复用
- **测试**: 测试前运行 `.dev/tests/phase3/sandbox-reset.mjs` 复位测试仓库；Site 1 = main（手动），Site 2 = `site2` 分支（跟随 vault）；GUI 测试交给 windows-mcp 子 agent（每轮新开，只操作 test-vault 窗口，改名用右键重命名）
- **待办**: `.agents/notes/deferred.md`（网址显示中文、测试 token 测完后撤销等）
- **真相源**: 需求 `.dev/docs/requirements/v0/requirements.md`（当前为 v1）；总体计划 `.dev/plans/implementation_plan.md`；验证结论 `.dev/docs/others/phase0-findings.md`

## 关键技术决策
- `src/core/` 不依赖 `obsidian`，HTTP、YAML 解析由 `src/platform/` 注入 → 可在 Node 中单元测试
- slug 直接依赖 `@quartz-community/utils/path`；链接目标写目标的 slug，格式按站点 `markdownLinkResolution` 适配
- 网址冲突检测比较站点内容目录全部文件 + aliases（Quartz 遇冲突只警告、后者覆盖）
- 右键菜单用一级菜单项 + 站点选择弹窗（`src/ui/site-picker.ts`；公开 API 无二级子菜单）
- token 存 `secretStorage`，权限仅 Contents 读写
- `minAppVersion` 1.13.0：设置页用声明式 API；站点子页面是自定义 `SettingPage`（子页面内不能调用 `update()`）
- manifest 与内容在同一次提交写入；序列化稳定，内容不变则 blob SHA 不变
- 发布 / 撤稿在 `commit(message, build(head))` 回调中基于当次 head 重读 manifest 与文件树；读取会变化的资源必须带 `fresh`（`Cache-Control: no-cache`），否则 `requestUrl` 会用 GitHub 的 60 秒缓存
- 笔记中链接 / 嵌入的位置取自 `metadataCache`，core 只按偏移替换，不自己解析 Markdown
- manifest 中 vault 路径为明文（用户决定），站点仓库应为私有
- 每个站点的「仓库 + 分支」必须唯一（manifest 在分支根目录，共用会互相误判）；同仓库不同分支允许
- 连带发布只在跟随 vault 站点提供；手动站点未发布链接一律纯文本，靠反向链接提醒补链接（不自动更新）
- 设置页文本字段离开输入框或按回车时才保存，不要改回每次按键保存
- 目录模式以仓库 manifest 为准；跟随站点的站内路径 = vault 路径，发布已移动笔记即挪动（旧路径写 aliases）
- vault 改名自动提交（只改源路径），未写回的改名经 `PublishContext.renames` 参与计算；manifest 可选字段 `plainLinks` 用于更新时只问新的未发布链接

## 项目约定

- **脱敏（开源仓库，必须遵守）**：仓库内任何文件（文档、conversationlog、changelog、注释、测试数据、fixture）都不得出现作者的真实站点名、站点网址、仓库名、真实人名或私人笔记内容。示例一律用占位：站点「站点 A / 站点 B」、网址 `https://example.pages.dev`、分支 `main`、排除文件夹 `Private`、笔记「示例笔记 / 示例标题」。
  - 原因：同时写出多个真实站点，会让外人看出这些站属于同一人，直接违背需求 §8「站点隔离」要保护的东西。
- 代码注释、README、commit message 用中文。
- 本地凭据与测试仓库名只放 gitignore 的 `.env.local`。
- npm 命令在 PowerShell 中运行；写文件用 Edit / Write 工具，不用 shell 重定向（见 `.agents/notes/known_pits.md`）。
- 正式单元测试在 `.dev/unit-tests/`（`npm test`），探索性脚本在 `.dev/tests/`。
