# 目录说明

| 目录 / 文件 | 用途 |
|------------|------|
| `.dev/docs/requirements/v0/` | 需求：`requirements.md` 为当前版本（v1），`requirements_v0.md` 为历史原稿 |
| `.dev/docs/others/phase0-findings.md` | Phase 0 技术验证结论（slug 用例表、链接解析、aliases、Obsidian API、GitHub API） |
| `.dev/plans/` | `implementation_plan.md` 总体计划；`implementing/` 进行中；`implemented/` 已完成；`future/` 未来 |
| `.dev/tests/phase0/slug/` | 调用 Quartz 实际 slug 函数生成用例表（需传入装好依赖的 Quartz 目录） |
| `.dev/tests/phase0/quartz/` | 在本地 Quartz 测试站实测三种链接解析策略与 aliases |
| `.dev/tests/phase0/github/` | Git Data API 探索脚本；`.env.local`（gitignore）存测试仓库名与 token |
| `.dev/changelog/` | 开发日志 |
| `.agents/conversationlog/` | 对话日志（Session ID 与决策要点） |
| `src/`、`tests/` | 插件源码与活跃测试（Phase 1 起） |
