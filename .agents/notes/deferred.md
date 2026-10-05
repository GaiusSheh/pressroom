# 暂缓事项

不属于当前 Phase 计划、但已确认要做或值得考虑的事。

- [ ] **全部测试结束后撤销测试仓库的 fine-grained token**（2026-10-04 用户决定）：Phase 2 GUI 测试时 token 明文被截屏（VS Code 打开了 `.dev/tests/phase0/github/.env.local`）；权限仅限测试仓库 Contents 读写，用户评估风险可控，等所有阶段测试完成后在 GitHub 上撤销，并清空密钥库与 `.env.local` 中的值。之后 GUI 测试时避免在屏幕上打开 `.env.local`。

## 已完成（2026-10-05 Phase 6）

- [✓] 网址显示中文（显示解码，复制与打开仍为编码形式）
- [✓] 站点读取提速（缓存 5 分钟、发布 / 撤稿复用缓存）
- [✓] README 说明「仓库 + 分支」唯一、vault 路径隐私
