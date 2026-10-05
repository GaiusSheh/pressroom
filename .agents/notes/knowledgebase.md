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
| `.dev/docs/others/release-checklist.md` | 社区插件提交自查、`community-plugins.json` 条目、PR 草稿与用户发布步骤 |
| `.github/workflows/release.yml` | 推送版本 tag 时检查版本、lint / 测试 / 构建并创建草稿 Release |
| `.dev/tests/phase6/snapshot-timing.mjs` | 测量读取一个站点快照的各次请求耗时 |
| `README.md`、`README.zh.md` | 用户文档（英文 / 中文，内容一致） |
| `.agents/conversationlog/` | 对话日志（Session ID 与决策要点） |
| `src/main.ts` | 插件入口：语言、设置加载、设置页注册、`getToken()` |
| `src/core/` | 纯逻辑，禁止 import `obsidian`：`generator/`（Quartz 适配、`ignore.ts` 忽略规则）、`backend/`（GitHub 客户端）、`manifest/`、`note.ts`（ParsedNote / VaultAccess）、`transform/`（内容转换）、`attachments.ts`（附件路径分配）、`publish.ts`（发布 / 更新 / 撤稿 / 状态）、`site-path.ts`、`connection.ts`（测试连接）、`hash.ts`、`types.ts` |
| `src/platform/` | 与 Obsidian 绑定的实现：`http.ts`（requestUrl 版 HttpFn）、`vault.ts`（metadataCache → ParsedNote、vault 读取） |
| `src/core/transform/embed.ts` | 嵌入笔记预加载（`loadEmbeds`）、引用范围筛选 |
| `src/core/backlinks.ts` | 反向链接（本站已发布、链接到某篇）与未发布链接目标 |
| `src/ui/actions.ts` | 四个操作的流程与站点快照缓存（30 秒）、跨站上下文、反向链接提醒、跟随站点的连带清单、「全部站点」（逐站执行 + 汇总）、模式切换写回 |
| `src/ui/renames.ts` | vault 改名监听与待写队列（防抖自动提交、`data.json` 的 `pendingRenames`） |
| `src/ui/companions-modal.ts`、`publish-modal.ts` | 连带清单弹窗（三选一 + 勾选）；「全部站点」分块位置弹窗 |
| `src/core/panel.ts` | 管理面板数据：站内目录树、各批量按钮显示与作用对象 |
| `src/ui/panel/panel-modal.ts` | 管理面板弹窗（选项卡、批量按钮、目录树、单项菜单；状态逐篇填入） |
| `src/core/renames.ts`、`companions.ts` | 改名映射应用到 manifest；连带收集（一层 / 到底） |
| `src/ui/commit-message.ts` | 提交信息（单篇 / 多篇分段，只含站内路径） |
| `src/ui/menu.ts`、`location-modal.ts`、`site-picker.ts`、`errors.ts` | 右键菜单与命令、首次发布位置弹窗（`LocationBlock` 可复用）、站点选择（含「全部站点」）、错误文字 |
| `.dev/unit-tests/transform/make-note.ts` | 测试辅助：用简化正则从文本构造 ParsedNote |
| `src/settings/` | 设置数据（`settings.ts`）、校验（`validate.ts`）、声明式设置页（`tab.ts`）、站点子页面（`site-page.ts`）、测试连接结果文字（`connection-view.ts`） |
| `src/ui/confirm-modal.ts` | 通用确认弹窗 |
| `src/i18n/` | `en.ts` 定义全部键，`zh.ts` 必须同键 |
| `.dev/unit-tests/backend/fake-github.ts` | 内存版 GitHub Git Data API，测试提交流程与非 fast-forward |
| `.dev/unit-tests/` | 正式单元测试（vitest，必须通过）；`test-vault/` 为开发用测试 vault（`.obsidian/` 不入库） |
| `.dev/tests/` | 探索性测试（允许失败） |
| `.dev/tests/phase1/quartz/format-link-e2e.mjs` | 打包真实 `formatLink`，在本地 Quartz 测试站验证三种链接策略的实际构建产物（在 Pressroom 根目录运行，参数为 Quartz 测试站目录） |
| `.dev/tests/phase2/quartz/attachment-e2e.mjs` | 图片 / PDF 附件链接在三种链接策略下的 Quartz 实际构建验证 |
| `.dev/tests/phase3/sandbox-reset.mjs` | 测试仓库复位：main 只留基线文件与对应 manifest 记录；创建 / 复位只含 README 的 `site2` 分支（第二个测试站点）；main 的目录模式复位为手动 |
| `.dev/tests/phase3/quartz/callout-probe.mjs` | callout 各种写法在 Quartz 的渲染验证 |
| `.dev/unit-tests/transform/fake-vault.ts` | 测试辅助：内存版 VaultAccess（含 loadEmbed 的标题 / 块范围规则） |
| `.dev/tests/phase2/quartz/sandbox-build.mjs` | 把测试仓库某个提交的 content/ 拉到本地 Quartz 构建，检查页面、链接、图片、锚点与不应出现的文字（仓库名读 phase0 的 `.env.local`） |
| `.dev/unit-tests/generator/fixtures/` | Quartz 5 自带的默认 `quartz.config.default.yaml`，供 `readSiteConfig` 测试 |
