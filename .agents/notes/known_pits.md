# 已知坑

## Bash 工具中的文件重定向不可靠（`>>` 会覆盖整个文件）

- **现象**：本项目会话中两次用 `cat >> 文件 <<'EOF'` 追加内容，结果文件原有内容全部丢失，只剩追加部分（2026-10-03：`.gitignore`、`changelog-001.md`）；`git show ... > /tmp/x` 也没有生成文件。
- **根因**：未查明（Claude Code 的 Bash 工具 / Git Bash / OneDrive 目录之一）。
- **解法**：**不要用 shell 重定向写文件**，追加、修改一律用 Edit / Write 工具；写完用 `git diff --numstat` 确认只有预期的增删。被覆盖时可从 `git show HEAD:<文件>` 取回原内容再用 Edit 补回。
- 同一环境下 `cmd1 && grep ...` 有时不显示后面命令的输出；用 Grep / Read 工具核对文件内容，不要据此判断文件已损坏。`sed -i` 含引号的模式容易匹配失败，复杂替换用 Edit 工具。

## Git Bash 中 npm 安装脚本失败

- **现象**：在 Git Bash 里运行 `npm ci`，带 install 脚本的依赖（esbuild、@parcel/watcher）报 `ERR_INVALID_ARG_TYPE: The "file" argument must be of type string. Received undefined`。
- **根因**：Git Bash 环境缺少 `ComSpec`，npm 起不了 shell。
- **解法**：npm / npx 一律在 PowerShell 中运行。

## vitest 报 Cannot find native binding（rolldown）

- **现象**：`npx vitest run` 报 `Cannot find module '@rolldown/binding-wasm32-wasi'`，`npm test` 输出被截断。
- **根因**：npm 可选依赖 bug（npm/cli#4828）：在已有 `node_modules` 上再 `npm install <包>` 时，删掉了 `@rolldown/binding-win32-x64-msvc`。
- **解法**：删除 `node_modules` 与 `package-lock.json` 后重新 `npm install`；装完确认 `node_modules/@rolldown/binding-win32-x64-msvc` 存在。

## `@quartz-community/utils` 运行时找不到 github-slugger

- **根因**：该包把 `github-slugger` 声明为**可选 peer 依赖**，不会自动安装（Quartz 本体自己装了它）。
- **解法**：Pressroom 在 `dependencies` 中显式声明 `github-slugger@^2.0.0`（与 Quartz 5 一致）。
- 另：`slugifyFilePath` 参数是品牌类型 `FilePath`，普通字符串需显式断言；适配层内部统一处理。

## requestUrl 会按 GitHub 的 Cache-Control 缓存 GET（提交后 60 秒内读到旧数据）

- **现象**：提交后 1 分钟内再操作，误报「分支持续被其他来源更新」（旧 head → 更新 ref 一直 422），或误报「已是最新」（读到旧 manifest）。重试或等一分钟就好。单元测试的假 GitHub 没有 HTTP 缓存，测不出来。
- **根因**：GitHub API 对 `git/ref/heads/*`、`contents/*`、`git/trees/*` 返回 `Cache-Control: private, max-age=60`；Obsidian 的 `requestUrl` 走 Chromium 网络层，遵守该缓存。
- **解法**：读取会变化的资源（仓库信息、分支指向、按分支读文件）时请求头加 `Cache-Control: no-cache`（`github.ts` 的 `request(..., { fresh: true })`）；按 sha 读取的 commit / tree / blob 内容不可变，保留缓存。新增读取「会变的东西」的接口时必须带 `fresh`。

## metadataCache 的 displayText 不能用来判断「用户写了别名」

- `[[笔记#标题]]` 的 `displayText` 是 Obsidian 自动生成的「笔记 > 标题」，与 `link`（`笔记#标题`）不同，但用户并没有写别名。
- 判断方式：维基链接看原文是否含 `|`；Markdown 链接看方括号内是否有文字（`platform/vault.ts` 的 `isCustomDisplay`）。

## 同一仓库同一分支配两个站点会共用 manifest

- manifest 固定在分支根目录 `.pressroom/manifest.json`，两个站点共用后互相把对方的发布当成自己的（Phase 3 GUI 测试发现）。现已禁止（设置页校验 + 操作入口跳过）；测试第二个站点用测试仓库的 `site2` 分支（`sandbox-reset.mjs` 会创建 / 复位）。

## GUI 测试 agent 的注意事项

- 子 agent 的上下文会很长（一次完整 GUI 测试约 30 万 token），续跑旧 agent 容易撞会话额度上限；新一轮测试新开 agent，把环境、清单和工具坑一次写清楚。
- 耗时数秒的操作要有进度提示，完成提示停留足够久，否则人和测试 agent 都容易错过结果。

## Obsidian 声明式设置页（1.13）

- 在声明式 `page` 子页面打开时调用 `SettingTab.update()`，子页面会变空白，并打断输入法组字（未上屏的拼音被当作文字保存）。需要在子页面里改动会影响列表的数据时，用自定义 `SettingPage` 子类，在 `hide()` 中再 `update()`。
- `list` 的 `onDelete` 对 `page` 类型条目不显示删除按钮，只能选中后按 Delete；API 也没有用代码打开 / 返回子页面的方法。
- lint（`eslint-plugin-obsidianmd`）不允许关闭 `hardcoded-config-path` 等规则，也不允许 `console.log`；提示文字需句首大写。

## 控制台输出中文

- PowerShell 下 Node 脚本输出中文时，先 `Out-File -Encoding utf8` 写文件再用 `Get-Content -Encoding UTF8` 读，避免控制台编码造成误判。
