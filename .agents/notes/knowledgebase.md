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
| `src/main.ts` | 插件入口：语言、设置加载、设置页注册、`getToken()` |
| `src/core/` | 纯逻辑，禁止 import `obsidian`：`generator/`（Quartz 适配、`ignore.ts` 忽略规则）、`backend/`（GitHub 客户端）、`manifest/`、`note.ts`（ParsedNote / VaultAccess）、`transform/`（内容转换）、`attachments.ts`（附件路径分配）、`publish.ts`（发布 / 更新 / 撤稿 / 状态）、`site-path.ts`、`connection.ts`（测试连接）、`hash.ts`、`types.ts` |
| `src/platform/` | 与 Obsidian 绑定的实现：`http.ts`（requestUrl 版 HttpFn）、`vault.ts`（metadataCache → ParsedNote、vault 读取） |
| `src/ui/actions.ts` | 四个操作的流程与站点快照缓存（30 秒） |
| `src/ui/menu.ts`、`location-modal.ts`、`site-picker.ts`、`errors.ts` | 右键菜单与命令、首次发布位置弹窗、站点选择、错误文字 |
| `.dev/unit-tests/transform/make-note.ts` | 测试辅助：用简化正则从文本构造 ParsedNote |
| `src/settings/` | 设置数据（`settings.ts`）、校验（`validate.ts`）、声明式设置页（`tab.ts`）、站点子页面（`site-page.ts`）、测试连接结果文字（`connection-view.ts`） |
| `src/ui/confirm-modal.ts` | 通用确认弹窗 |
| `src/i18n/` | `en.ts` 定义全部键，`zh.ts` 必须同键 |
| `.dev/unit-tests/backend/fake-github.ts` | 内存版 GitHub Git Data API，测试提交流程与非 fast-forward |
| `.dev/unit-tests/` | 正式单元测试（vitest，必须通过）；`test-vault/` 为开发用测试 vault（`.obsidian/` 不入库） |
| `.dev/tests/` | 探索性测试（允许失败） |
| `.dev/tests/phase1/quartz/format-link-e2e.mjs` | 打包真实 `formatLink`，在本地 Quartz 测试站验证三种链接策略的实际构建产物（在 Pressroom 根目录运行，参数为 Quartz 测试站目录） |
| `.dev/tests/phase2/quartz/attachment-e2e.mjs` | 图片 / PDF 附件链接在三种链接策略下的 Quartz 实际构建验证 |
| `.dev/tests/phase2/quartz/sandbox-build.mjs` | 把测试仓库某个提交的 content/ 拉到本地 Quartz 构建，检查页面、链接、图片、锚点与不应出现的文字（仓库名读 phase0 的 `.env.local`） |
| `.dev/unit-tests/generator/fixtures/` | Quartz 5 自带的默认 `quartz.config.default.yaml`，供 `readSiteConfig` 测试 |
