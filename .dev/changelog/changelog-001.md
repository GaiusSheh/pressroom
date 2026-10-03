# Pressroom 开发日志 001

## 2026-10-03 项目初始化与 Phase 0 技术验证

### 2026-10-03 16:50 项目初始化

**变更类型**: 项目初始化
**影响范围**: 整个项目结构

#### 实现功能详细

**目录骨架** [✓]
- 标准单仓库：`.agents/`、`.consult/tasks/`、`.dev/`（changelog、docs、plans、tests、tools、deprecated）、`src/`、`tests/`
- `.gitattributes`、`.editorconfig`（行尾与编码）、`.gitignore`

**需求入库与脱敏** [✓]
- 需求文档移入 `.dev/docs/requirements/v0/requirements.md`
- 去除真实站点网址、站名、人名等示例，统一改为占位
- `.agents/AGENTS.md` 写入脱敏约定

**状态**: 开发完成，验收通过（commit `b02619d`）

### 2026-10-03 17:30 Phase 0 技术验证

**变更类型**: 技术验证
**影响范围**: 需求文档、实施计划、`.dev/tests/phase0/`、`.dev/docs/others/phase0-findings.md`

#### 实现功能详细

**0-1 Quartz 5 网址规则** [✓]
- slug 实现位于 npm 包 `@quartz-community/utils`（MIT、纯函数），决定直接依赖、不自行重写
- 用实际函数生成 30 条用例表（`.dev/tests/phase0/slug/slug-cases.mjs`）
- 发现：文件夹同名笔记折叠为 `folder/index`；附件路径同样被 slug 化；Quartz 遇冲突只警告、后者覆盖

**0-2 链接解析** [✓]
- 本地 Quartz 5 测试站实测三种 `markdownLinkResolution`（`.dev/tests/phase0/quartz/link-resolution.mjs`）
- 结论：始终输出完整站内路径；shortest/absolute 输出完整路径，relative 输出相对路径

**0-3 aliases 重定向** [✓]
- AliasRedirects 默认启用，中文与空格别名可用；`permalink` 在 v5 只生成重定向页

**0-4 Obsidian API** [✓]
- `secretStorage` 1.11.4 起可用 → `minAppVersion` 1.11.4；公开 API 无二级子菜单

**0-5 GitHub Git Data API** [✓]
- 探索脚本 `.dev/tests/phase0/github/git-data-api.mjs`，16 项检查：单次提交内增改删与挪动、本地 blob SHA 一致、非 fast-forward 返回 422
- fine-grained token 仅 Contents 读写即可完成全部操作

#### 技术调整记录
- **右键菜单**：~~二级子菜单~~ **[!] 公开 API 不支持** → [✓] 一级菜单项 + 站点选择弹窗（用户选定）
- **需求升级为 v1**：冲突检测范围扩大到站点内容目录全部文件 + aliases；附件同名按 slug 判断；双链格式按站点配置适配；slug 依赖 `@quartz-community/utils`；aliases 重定向进入 v1。v0 原稿存为 `requirements_v0.md`

#### 验收标准达成
Phase 0 详细计划的所有验收标准均已达成：
- [✓] 结论文档覆盖 0-1 至 0-5，每条带出处
- [✓] 需求 §11 待定问题有结论
- [✓] 需求与总体计划已按技术调整流程更新

**状态**: 开发完成，验收通过
