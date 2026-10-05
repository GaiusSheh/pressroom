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

## 2026-10-04 Phase 2 的实现决策

依据：`.dev/plans/implemented/phase2-detailed-plan.md`

- **vault 路径维持明文**（用户决定）：曾提出 manifest 存每站加盐哈希、或移到本机，用户选择维持需求现状，自行保证站点仓库私有；README 需提示（见 deferred）。
- **解析交给 metadataCache，并校验偏移原文**：不自己写 Markdown 解析器，避免代码块等边界错误；校验 `original` 防止缓存过期时按错位偏移改写。
- **快照从同一棵树按 blob 读 manifest 与 Quartz 配置**（`loadSnapshot`），保证与 head 一致，而不是用按分支读取的 contents API。
- **GUI 测试交给 windows-mcp 子 agent**：用户不想逐项手点；agent 逐步操作 Obsidian 并用 gh 核对仓库，发现了单元测试测不到的 HTTP 缓存 bug。之后的阶段可沿用，注意：不要在屏幕上打开 `.env.local` 等敏感文件；Type 的 `clear=true` 清不掉 Obsidian 输入框，需 Ctrl+A。
- **嵌入笔记临时纯文本、非图片嵌入输出为链接**：Phase 3 改为展开嵌入笔记时，`transform.ts` 中 `rewrite` 的 `note` 分支是改动点。

## 2026-10-04 Phase 3 的实现决策

依据：`.dev/plans/implemented/phase3-detailed-plan.md`

- **连带发布只在跟随 vault 站点提供**（用户提出）：手动模式的意义是每篇位置由用户决定，插件不替用户放置；手动站点靠「先发布这一篇 + 反向链接提醒」补链接。
- **反向链接提醒不自动更新**：重新发布会带上那些笔记在 vault 中尚未发布的改动，必须用户点按钮确认；只影响一层，不会循环。
- **嵌入预加载 + 同步转换**：`loadEmbeds` 在转换前异步读取所有可达嵌入，`transformNote` 保持同步纯函数；防循环靠展开链，深度上限 10。
- **跨站查询放在发布层**（`crossSiteLookup`）：隔离规则集中一处，转换层只拿到一个查询函数；位置弹窗的「未发布链接」判断复用同一查询，避免两处规则不一致。
- **仓库 + 分支唯一**（用户决定）：manifest 位于分支根目录，不按内容目录拆分（同一分支放两个 Quartz 站点不是正常用法）。
- **设置页离开输入框才保存**：每次按键保存会存下打到一半的合法值，且与「不合法不保存」组合时，输入框显示与实际保存不一致。
- **GUI 测试每轮新开子 agent**：续跑旧 agent 上下文过长，两次撞会话额度上限。

## 2026-10-05 Phase 4 的实现决策

依据：`.dev/plans/implemented/phase4-detailed-plan.md`

- **目录模式在 core 中以仓库 manifest 为准**（`publishBatch` 读 `snap.manifest.mode`），跟随站点的站内路径一律为 vault 路径：因此任何发布（含一并更新、全部站点）都会把「已移动」的笔记同步过去，不需要在调用处区分。
- **未写回的改名放进 `PublishContext.renames`、在 `loadSnapshot` 中先应用**：改名后立即发布不会重复发布；之后任何提交的 manifest 都已包含改名。改名映射按前缀、顺序应用且幂等，不依赖 Obsidian 对文件夹改名触发几次事件。
- **改名待写队列按站点、条目带递增 id**：写回成功只移除已写回的 id，写回期间新发生的改名不丢；提交信息只写篇数（vault 路径不进提交信息）。
- **`plainLinks` 写进 manifest 而不是本地**：「更新时只问新链接」要跨设备一致；字段为空不写入，已有 manifest 逐字节不变。
- **aliases 用旧站内路径去掉 `.md`**：Quartz alias-redirects 对不以 `./`、`../` 开头的别名按内容根解析（已读源码核对）；挪回旧位置时去掉同网址的 alias，否则与页面本身冲突。
- **全部站点逐站提交**：无法跨仓库原子；所有弹窗（位置、各站连带清单）在任何提交之前完成，取消即整体取消。
- **GUI 测试的环境问题**：Windows 锁屏会中断测试（用户已设为常亮）；测试 agent 改名时点击文件名会打开笔记把文字打进正文，改名要用右键「重命名」或 F2 后截图确认焦点；桌面上可能开着用户的私人 vault，提示词中要限定只操作 test-vault 窗口；agent 可能卡在最后汇报，可用 gh 查测试仓库提交判断进度。

## 2026-10-05 Phase 5 的实现决策

依据：`.dev/plans/implemented/phase5-detailed-plan.md`

- **一键重排只改 frontmatter 的 aliases**（用户决定）：写 aliases 必然改变文件内容，「复用原 blob」做不到；正文保持旧版本以保留「有修改」。relative 链接策略的站点不提供（正文相对链接换位置会失效）。
- **发布副本中 Pressroom 的 aliases 按码点排序**：manifest 序列化时已排序，按写入顺序写副本会使读回 manifest 后渲染结果不同，被误判「有修改」。凡是新增「由 manifest 字段生成发布内容」的地方，都要保证顺序与序列化后一致。
- **面板单项操作复用右键的单站流程**（`publishOnSite` / `unpublishOnSite`），不另写一套：跟随站点上「更新」已移动的笔记即同步，与 2026-10-04 的决定一致。
- **状态全部算完前批量按钮禁用**：避免只作用于已算出状态的部分笔记。
- **多选发布不弹位置窗口**：手动站点未发布的跳过并说明（用户决定）；多选撤稿不做反向链接的一并更新。
