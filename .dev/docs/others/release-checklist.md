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
2. **在 GitHub 上新建公开仓库**（名称建议 `pressroom`），在本地添加远端并推送 `master` 分支。
3. **打 tag 并推送**：`git tag 1.0.0` → `git push origin 1.0.0`。
4. **检查草稿 Release**：在仓库 Releases 页确认三个附件齐全，可下载 `main.js` 等放入一个空 vault 试装；无误后点「Publish release」。
5. **提交社区插件 PR**：fork `obsidianmd/obsidian-releases`，在 `community-plugins.json` 末尾追加下面的条目（`author` 与 `manifest.json` 一致，`repo` 为第 2 步建的仓库），按模板填写 PR 说明并提交。
6. 审核期间按审核意见修改，修改后提升版本号（`npm version patch`，会同步 `manifest.json` 与 `versions.json`），重复第 3–4 步。

### `community-plugins.json` 条目

```json
{
	"id": "pressroom",
	"name": "Pressroom",
	"author": "<与 manifest.json 的 author 相同>",
	"description": "Publish individual notes to one or more Quartz sites on GitHub, with a management panel and no frontmatter changes.",
	"repo": "<owner>/<repo>"
}
```

### PR 说明草稿

```markdown
# I am submitting a new Community Plugin

## Repo URL

Link to my plugin: https://github.com/<owner>/<repo>

## Release Checklist
- [x] I have tested the plugin on
  - [x] Windows
  - [ ] macOS
  - [ ] Linux
  - [ ] Android (if applicable)
  - [ ] iOS (if applicable)
- [x] My GitHub release contains all required files (as individual files, not just in the source.zip / source.tar.gz)
  - [x] `main.js`
  - [x] `manifest.json`
  - [x] `styles.css` _(optional)_
- [x] GitHub release name matches the exact version number specified in my manifest.json (_**Note:** Use the exact version number, don't include a prefix `v`_)
- [x] The `id` in my `manifest.json` matches the `id` in the `community-plugins.json` file.
- [x] My README.md describes the plugin's purpose and provides clear usage instructions.
- [x] I have read the developer policies at https://docs.obsidian.md/Developer+policies, and have assessed my plugins's adherence to these policies.
- [x] I have read the tips in https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines and have self-reviewed my plugin to avoid these common pitfalls.
- [x] I have added a license in the LICENSE file.
- [x] My project respects and is compatible with the original license of any code from other plugins that I'm using.
      I have given proper attribution to these other projects in my `README.md`.
```

> 平台勾选按实际测试情况填写：目前只在 Windows 上测试过；插件为仅桌面端（`isDesktopOnly`）。

## 四、发布后

- 撤销测试仓库的 fine-grained token，清空 Obsidian 密钥库与 `.dev/tests/phase0/github/.env.local` 中的值（deferred）
