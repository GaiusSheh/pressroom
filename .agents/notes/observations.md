# 决策记录

## 2026-10-03 Phase 0 后的架构决策

依据：`.dev/docs/others/phase0-findings.md`

- **slug 不重写，依赖 `@quartz-community/utils`**：Quartz 5 自身即从该包导入 `slugifyFilePath`，依赖它可保证规则一致；用例表（findings §0-1）做回归，Quartz 升级时同步升级依赖。
- **链接输出完整站内路径**：只写文件名在同名文件存在时成死链（`.dev/tests/phase0/quartz/link-resolution.mjs` L08）；relative 策略下需输出相对路径。
- **冲突检测范围**：Quartz `slugCollisions.ts` 只警告、last-write-wins，因此插件必须拦截，且比较对象包括非 Pressroom 管理的文件与 aliases 重定向页。
- **右键菜单方案 B**：`obsidian.d.ts` 中 `MenuItem` 无 `setSubmenu`，不依赖未公开 API。
- **不在 OneDrive 内放 Quartz 测试站**：`node_modules` 体积大，测试站放 `C:\tmp\pressroom-quartz-test`。

## 2026-10-03 Pressroom 自身的 node_modules 留在 OneDrive 内

- Node 按「导入文件所在目录逐级向上」查找 `node_modules`，无法像 Python venv 那样放到任意外部目录；Junction / pnpm 链接会被 OneDrive 跟随同步，Yarn PnP 与逐工具配置外部路径维护成本高。
- 用户决定：**保持现状**，接受 `node_modules` 被 OneDrive 同步；不要再提议移出或外置，除非出现同步冲突等实际问题。

## 2026-10-03 Phase 1 的实现决策

依据：`.dev/plans/implemented/phase1-detailed-plan.md`

- **core 不依赖 obsidian**：HTTP（`HttpFn`）、YAML 解析由 `src/platform/` 或调用方注入；`core/` 可在 Node 中完整单元测试。提交流程用内存版假 GitHub（`.dev/unit-tests/backend/fake-github.ts`）测试，而不是逐请求 mock。
- **最低版本 1.13.0**（用户决定）：设置页用声明式 API，不保留 `display()` 兼容写法。
- **站点子页面为自定义 `SettingPage`**：声明式子页面内调用 `update()` 会使页面变空白并打断输入法；离开子页面（`hide`）时再刷新列表（用户在「声明式去掉刷新」与此方案中选定）。
- **链接目标写目标的 slug**：原文件名中的 `%` 会让 Quartz `decodeURI` 抛错、`#` 被当作锚点；slug 对已 slug 的路径幂等（`.dev/unit-tests/generator/slug.test.ts` 有用例保证）。实际构建验证见 `.dev/tests/phase1/quartz/format-link-e2e.mjs`。
- **`commit(message, build(head))`**：改动由回调按当前 head 生成，非 fast-forward 时重新取 head 再调用，调用方（发布流程）在回调内重读 manifest 即可正确合并。
- **manifest 附件引用只记在笔记侧**，避免两处不一致；未来版本 manifest 读写都拒绝。
- **测试连接无法验证写权限**：fine-grained token 的权限不在只读响应中体现，结果中明确说明「首次发布时确认」。
