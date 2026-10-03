# 决策记录

## 2026-10-03 Phase 0 后的架构决策

依据：`.dev/docs/others/phase0-findings.md`

- **slug 不重写，依赖 `@quartz-community/utils`**：Quartz 5 自身即从该包导入 `slugifyFilePath`，依赖它可保证规则一致；用例表（findings §0-1）做回归，Quartz 升级时同步升级依赖。
- **链接输出完整站内路径**：只写文件名在同名文件存在时成死链（`.dev/tests/phase0/quartz/link-resolution.mjs` L08）；relative 策略下需输出相对路径。
- **冲突检测范围**：Quartz `slugCollisions.ts` 只警告、last-write-wins，因此插件必须拦截，且比较对象包括非 Pressroom 管理的文件与 aliases 重定向页。
- **右键菜单方案 B**：`obsidian.d.ts` 中 `MenuItem` 无 `setSubmenu`，不依赖未公开 API。
- **不在 OneDrive 内放 Quartz 测试站**：`node_modules` 体积大，测试站放 `C:\tmp\pressroom-quartz-test`。
