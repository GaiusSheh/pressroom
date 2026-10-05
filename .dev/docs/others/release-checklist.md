# Pressroom 发布清单（Phase 6-4）

首个公开版本：`1.0.0`（2026-10-05 用户确认）。插件侧准备工作已完成；下面「用户操作」中的步骤都是对外公开的动作，由用户执行。

## 一、社区插件提交要求自查（2026-10-05）

| 项目 | 结果 |
|------|------|
| `manifest.json`：`id` 为 `pressroom`（不含 obsidian）、`name` 不含 Obsidian | [✓] |
| `manifest.json`：`description` 以动词开头、句号结尾、不含 Obsidian、少于 250 字符 | [✓] |
| `manifest.json`：`author` / `authorUrl`、`minAppVersion` 1.13.0、`isDesktopOnly` true | [✓] |
| `versions.json` 含 `1.0.0 → 1.13.0`；`package.json` / `package-lock.json` 版本一致 | [✓] |
| LICENSE（MIT）；README（英文，附中文 README.zh.md） | [✓] |
| 无 `innerHTML` / `outerHTML` / `insertAdjacentHTML` | [✓] grep 为 0 |
| 无 `console.log`（只用 warn / error 报告真实问题） | [✓] grep 为 0 |
| 网络请求只经 `requestUrl`，无 `fetch` | [✓] |
| 不用全局 `app`、不用 `vault.adapter`、不在卸载时 detach 视图、不设默认快捷键 | [✓] |
| 样式只用 CSS 变量，无硬编码颜色、无 `!important` | [✓] |
| 设置页不使用「General」之类的顶层标题 | [✓] 已改为「发布 / Publishing」 |
| 命令名称不带插件名（Obsidian 自动加前缀） | [✓] |
| 不收集任何数据；token 存 Obsidian 密钥库 | [✓] |
| `eslint-plugin-obsidianmd` 全部规则通过 | [✓] `npm run lint` |
| `npm test`（402 项）、`npm run build` 通过 | [✓] |

## 二、发布流程（`.github/workflows/release.yml`）

- 推送与 `manifest.json` 版本相同、**不带 v** 的 tag（如 `1.0.0`）时触发
- 检查 tag 与 manifest 版本一致 → `npm ci` → lint、单元测试、生产构建 → 创建**草稿** Release，附 `main.js`、`manifest.json`、`styles.css`
- 构建脚本在没有 `.env.local` 时跳过「复制到测试 vault」，CI 中不受影响；锁文件已含 Linux 的 rolldown / esbuild 原生包

## 三、用户操作步骤

1. **发布前确认仓库内容可以公开**：仓库已按约定脱敏；`.env.local`、测试 vault 的 `.obsidian/`（含插件 data.json）均在 `.gitignore` 中。可再执行 `git ls-files` 抽查。
   - [✓] **用户决定保持现状（2026-10-05）**：不敏感，直接发布。原记录：本机用户名与 OneDrive 路径出现在开发文档中——`.agents/conversationlog/conversationlog-001.md`（工作目录、原始记录路径）、`.agents/notes/known_pits.md`、`.agents/notes/observations.md`、`.dev/plans/implemented/phase1-detailed-plan.md`。测试仓库名、token 扫描结果为 0；GitHub 用户名只在 `manifest.json`、`LICENSE`。可选：替换为 `~` / `<项目目录>`；或 `.agents/`、`.dev/` 不随公开仓库发布；或保持现状。
   - 注意：已推送的 git 历史中同样包含这些内容，若要彻底去除，需要在首次推送前处理（或推送一个不含旧历史的新仓库）。
2. [✓] **新建公开仓库并推送**（2026-10-05）：`https://github.com/GaiusSheh/pressroom`，默认分支 `master`。推送 workflow 文件需要 token 带 `workflow` 权限（`gh auth refresh -h github.com -s workflow`）。
3. [✓] **打 tag 并推送**：`1.0.0`，Release workflow 约 27 秒通过。
4. [✓] **发布 Release**：草稿已确认含 `main.js`、`manifest.json`、`styles.css`，已发布为 Latest。
5. **提交到社区目录**——[!] **流程已变更（2026-10-05 核对官方文档）**：~~fork `obsidianmd/obsidian-releases` 并在 `community-plugins.json` 追加条目提交 PR~~ → 改为在社区目录网站提交，需要用户本人的 Obsidian 账号：
   1. 打开 [community.obsidian.md](https://community.obsidian.md/)，用 Obsidian 账号登录；
   2. 在个人资料中关联 GitHub 账号（用于验证仓库归属）；
   3. 添加插件（Add a plugin），选择仓库 `GaiusSheh/pressroom`。目录读取默认分支 HEAD 上的 `manifest.json`，安装时下载与 `version` 同名 tag 的 Release 附件；
   4. 提交后自动审核，目录页面会列出需要修改的地方；修改后提升版本号（`npm version patch`，会同步 `manifest.json` 与 `versions.json`）、提交、推送并打新 tag 发布新 Release。
   - 已按《Submission requirements for plugins》复核：无 `fundingUrl`；`minAppVersion` 1.13.0；description 以动词开头、句号结尾、少于 250 字符、专有名词大小写正确；命令 id 不含插件 id；`isDesktopOnly` true；无示例代码。

## 四、发布后

- 公开后可在 [论坛 Share & showcase](https://forum.obsidian.md/c/share-showcase/9) 与 Discord `#updates` 发布介绍
- 撤销测试仓库的 fine-grained token，清空 Obsidian 密钥库与 `.dev/tests/phase0/github/.env.local` 中的值（deferred）
