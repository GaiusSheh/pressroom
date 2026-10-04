# 暂缓事项

不属于当前 Phase 计划、但已确认要做或值得考虑的事。

- [ ] **网址显示中文而非百分号编码**（2026-10-04 用户提出，「之后做」）：位置弹窗的网址预览、发布成功提示、获取链接目前显示 `encodeURI` 后的形式（`%E7%A4%BA…`）。改为显示解码后的中文；复制到剪贴板的链接是否也用中文需再定（中文网址在部分聊天软件里会断开）。涉及 `src/core/generator/quartz.ts` 的 `urlOf` 与调用处。
- [ ] **全部测试结束后撤销测试仓库的 fine-grained token**（2026-10-04 用户决定）：Phase 2 GUI 测试时 token 明文被截屏（VS Code 打开了 `.dev/tests/phase0/github/.env.local`）；权限仅限测试仓库 Contents 读写，用户评估风险可控，等所有阶段测试完成后在 GitHub 上撤销，并清空密钥库与 `.env.local` 中的值。之后 GUI 测试时避免在屏幕上打开 `.env.local`。
- [ ] **README 提示 vault 路径隐私**（需求 §9）：manifest 中 vault 路径为明文，提醒用户站点仓库应设为私有。Phase 6 写 README 时处理。
