# Phase 0 技术验证结论

> 验证日期：2026-10-03  
> Quartz 版本：`jackyzha0/quartz` 分支 `v5`（package 5.0.0，commit `97a2d05`，2026-09-20）；`@quartz-community/utils` 1.0.1  
> Obsidian API：npm `obsidian` 1.13.1（`obsidian.d.ts`）  
> 探索脚本：`.dev/tests/phase0/`（`slug/`、`quartz/`、`github/`），可重跑

---

## 0-1 Quartz 5 网址规则

### 出处
- Quartz 5 的 `quartz/util/path.ts` 只是转出，`slugifyFilePath`、`transformLink`、`splitAnchor` 等实现位于 npm 包 **`@quartz-community/utils`**（`dist/path.js`，MIT）。
- slug 只由「相对于内容目录的文件路径」决定：`quartz/processors/parse.ts:105` `file.data.slug = slugifyFilePath(file.data.relativePath)`。

### 规则（`slugifyPath`，逐段处理）
1. 去掉开头 `/`；`.md`、`.html` 与无扩展名去掉扩展名，**其他扩展名保留**（原大小写）。
2. 每一段：空白（`\s`，含全角空格、制表符）→ `-`；`&` → `-and-`；`%` → `-percent`；删除 `?`、`#`、`<>:"|*`；转小写。
3. 不合并连续 `-`，不处理全角标点、括号、点号、中文、emoji。
4. 末段为 `_index` → `index`。
5. **末段与父文件夹同名 → `index`**（Obsidian 文件夹笔记约定）：`笔记/笔记.md` → `笔记/index`，与 `笔记/index.md` 冲突。

### 用例表（由 `slug/slug-cases.mjs` 调用实际函数生成）

| # | 类别 | 输入路径 | slugifyFilePath | simplifySlug |
|---|------|---------|-----------------|--------------|
| 1 | 基础 | `note.md` | `note` | `note` |
| 2 | 大写转小写 | `Note.md` | `note` | `note` |
| 3 | 空格转 - | `my note.md` | `my-note` | `my-note` |
| 4 | 多个空格不合并 | `a  b.md` | `a--b` | `a--b` |
| 5 | 制表符等空白 | `a\tb.md` | `a-b` | `a-b` |
| 6 | 中文保留 | `笔记/数学/示例标题.md` | `笔记/数学/示例标题` | `笔记/数学/示例标题` |
| 7 | 中文 + 空格 | `笔记/示例 标题.md` | `笔记/示例-标题` | `笔记/示例-标题` |
| 8 | 全角空格 | `示例　标题.md` | `示例-标题` | `示例-标题` |
| 9 | 全角标点保留 | `标题：副标题（一）.md` | `标题：副标题（一）` | `标题：副标题（一）` |
| 10 | & 转 -and- | `A&B.md` | `a-and-b` | `a-and-b` |
| 11 | % 转 -percent | `100%.md` | `100-percent` | `100-percent` |
| 12 | ? # 删除 | `what?#.md` | `what` | `what` |
| 13 | `<>:"\|*` 删除 | `a<b>c:d"e\|f*g.md` | `abcdefg` | `abcdefg` |
| 14 | 半角括号保留 | `f(x).md` | `f(x)` | `f(x)` |
| 15 | 点号保留 | `v1.2 notes.md` | `v1.2-notes` | `v1.2-notes` |
| 16 | 已有 - 保留 | `a-b.md` | `a-b` | `a-b` |
| 17 | 冲突对：空格版 | `A B.md` | `a-b` | `a-b` |
| 18 | 冲突对：连字符版 | `a-b.md` | `a-b` | `a-b` |
| 19 | index.md | `folder/index.md` | `folder/index` | `folder/` |
| 20 | _index.md | `folder/_index.md` | `folder/index` | `folder/` |
| 21 | 文件夹笔记 | `笔记/笔记.md` | `笔记/index` | `笔记/` |
| 22 | 文件夹笔记（大小写不同） | `Notes/notes.md` | `notes/index` | `notes/` |
| 23 | 文件夹名也 slug | `My Folder/Sub Dir/x.md` | `my-folder/sub-dir/x` | `my-folder/sub-dir/x` |
| 24 | 开头斜杠去除 | `/a/b.md` | `a/b` | `a/b` |
| 25 | 图片保留扩展名 | `assets/My Image.png` | `assets/my-image.png` | `assets/my-image.png` |
| 26 | PDF 保留扩展名 | `assets/文档 1.pdf` | `assets/文档-1.pdf` | `assets/文档-1.pdf` |
| 27 | 无扩展名 | `README` | `readme` | `readme` |
| 28 | 扩展名大写不变 | `assets/IMG.PNG` | `assets/img.PNG` | `assets/img.PNG` |
| 29 | emoji 保留 | `🌱 garden.md` | `🌱-garden` | `🌱-garden` |
| 30 | 日文/韩文保留 | `メモ/메모.md` | `メモ/메모` | `メモ/메모` |

锚点（`splitAnchor`，github-slugger）：`#第一节 Section A` → `#第一节-section-a`；`#^blk1` → `#blk1`；`#Hello, World!` → `#hello-world`；`#A & B` → `#a--b`；`#标题：副标题` → `#标题副标题`；PDF 的 `#page=3` 原样保留。

### 冲突
- Quartz 对冲突只打印警告，**后处理的文件覆盖前者**（`quartz/util/slugCollisions.ts`，last-write-wins）。Pressroom 必须在发布前自行拦截。
- 冲突检测的比较范围应为**站点仓库内容目录的全部文件**（含非 Pressroom 管理的文件），不能只比 manifest。
- 附件同样被 slug 化（#25、#28），附件「同名」判断要按 slug 比较：`My Image.png` 与 `my image.png` 在站上是同一网址。

### 结论：直接依赖 `@quartz-community/utils`
- `path` 子模块只依赖 `github-slugger`，纯函数、不用 Node API（`getBasePath` 等对 `document` 有判空），MIT，dist 约 8 KB，可经 esbuild 打包进插件。
- 直接 `import { slugifyFilePath, splitAnchor } from "@quartz-community/utils/path"`，**不自行重写**，规则与 Quartz 天然一致；Quartz 升级时只需升级依赖并跑用例表。
- 版本锁定与 Quartz 5 `package.json` 一致（`^1.0.1`）。

---

## 0-2 Quartz 5 链接解析

### 实测（`quartz/link-resolution.mjs`，源页面 `posts/source.md`，目标 `笔记/数学/示例 标题.md`）

| 写法 | shortest（默认） | absolute | relative |
|------|:---:|:---:|:---:|
| `[[笔记/数学/示例 标题]]` 完整路径维基链接 | ✓ | ✓ | ✗ |
| `[[…#第一节 Section A\|锚点]]`、`[[…#^blk1\|块]]` | ✓ | ✓ | ✗ |
| `[t](笔记/数学/示例%20标题.md)`、`[t](/笔记/…)`、`[t](<笔记/数学/示例 标题.md>)` | ✓ | ✓ | ✗ |
| `[t](../笔记/数学/示例%20标题.md)` 相对路径 | 仅因源在第一层而巧合 ✓ | 同左 | ✓ |
| `[[示例 标题]]` 只写文件名（存在同名文件） | ✗ 死链 | ✗ | ✗ |

- 在 shortest 下，完整路径为多段时按「slug 相等或以 `/路径` 结尾」匹配；多于一个匹配时回退为从根解析，结果仍正确。
- relative 下，非相对写法都被当作相对于源文件目录解析。

### 结论
- **插件始终输出完整站内路径**（从内容目录根算起），绝不只输出文件名。
- 输出格式按站点 `quartz.config.yaml` 中 CrawlLinks 的 `markdownLinkResolution` 决定：shortest / absolute → 完整路径；relative → 由源与目标站内路径计算相对路径。插件可经 GitHub API 读取站点仓库的配置自动判断，无需用户填写。
- 建议输出 Markdown 链接 `[显示文字](<站内路径.md#锚点>)`：不依赖 ObsidianFlavoredMarkdown 插件把维基链接转换为链接；锚点保留原标题文字，由 Quartz 自行 slug。尖括号写法中带 `#` 锚点的情况在 Phase 1 补测。

---

## 0-3 aliases 重定向（需求 §11 待定问题）

- **可用**。AliasRedirects 在 Quartz 5 默认配置中启用（`quartz.config.default.yaml`）。
- 实测：`moved.md` 写 `aliases: ["old/旧 位置", "old-loc"]` → 生成 `old/旧-位置.html`、`old-loc.html`，内容为 `<meta http-equiv="refresh" content="0; url=../moved">`，含中文与空格的别名正常。
- `permalink` 在 v5 实际只生成一个指向原页面的重定向页（`custom/永久.html` → `perm`），原网址不变；不改变 slug。
- 注意：
  1. alias 也参与链接解析，`[[old-loc]]` 会解析到重定向页；alias 生成的重定向页也占用网址，**冲突检测需把已写入的 aliases 计入**。
  2. 依赖站点启用 AliasRedirects；插件可读取站点配置，未启用时提示「挪动后旧链接将失效」。
  3. `aliases` 不在属性白名单中，由插件在发布副本中单独写入；若笔记自带 aliases 且用户把它加进白名单，需与插件写入的合并去重。

---

## 0-4 Obsidian API

| API | 结论 | 版本 |
|-----|------|------|
| `app.secretStorage`：`setSecret(id, secret)`、`getSecret(id)`、`listSecrets()` | 可用；id 须为小写字母数字加 `-`；**没有删除方法** | 1.11.4 |
| `SecretComponent`（设置页的密钥选择控件） | 可用，推荐用法：data.json 只存密钥 id，token 本身在 secretStorage | 1.11.1（`setValue`/`onChange` 1.11.4） |
| `requestUrl` | 无 CORS 限制，支持 `method`、`headers`、`body: string \| ArrayBuffer`，可调用 GitHub API 的 GET/POST/PATCH | 0.12.11 |
| `workspace.on('file-menu')` | 单个文件右键菜单 | 0.9.12 |
| `workspace.on('files-menu')` | 多选文件右键菜单 | 1.4.10 |
| `vault.on('rename', (file, oldPath))` | 改名 / 移动事件 | 0.9.7 |
| `MenuItem` 二级子菜单 | **公开 API 中不存在**（只有 `setSection`），见下方需讨论项 | — |

- **`minAppVersion` 建议 1.11.4**（secretStorage 的最低版本）。
- 运行时验证（CORS、真实二进制上传、子菜单）放到 Phase 1 工程骨架里，在测试 vault 中实测。

---

## 0-5 GitHub Git Data API

运行 `github/git-data-api.mjs`（一次性私有测试仓库，结束时自动清理），16 项全部通过：

- 本地计算的 blob SHA（`sha1("blob <字节长度>\0" + 内容)`）与 GitHub 一致：中文 LF、CRLF、二进制、JSON 均一致 → 「有修改」判定方案成立。
- 基于 `base_tree` 的一棵新 tree 内同时完成 **修改 + 删除（条目 `sha: null`）+ 新增 + 挪动（新路径复用原 blob SHA）**，产生 1 个 commit；GitHub 把复用 blob 的挪动识别为 `renamed`。
- `GET /git/trees/{sha}?recursive=1` 一次拿到全部路径与 blob SHA，可用于批量状态计算（需检查 `truncated`，GitHub 上限约 10 万条 / 7 MB）。
- 中文内容 base64 往返一致。
- 基于过期父提交更新 ref（`force: false`）→ **422 `Update is not a fast forward`** → 重试策略：重新取 ref、重读 manifest、重建 tree 与 commit，有上限地重试。
- 最小权限：fine-grained token（仅选测试仓库，Repository permissions 仅 **Contents: Read and write**，Metadata 只读自动附带）运行 `git-data-api.mjs --fine`，16 项全部通过 → **v1 所需 token 权限仅 Contents 读写**。

---

## 需要讨论 / 待用户决定

> **2026-10-03 用户决定**：第 1 项选 **B**（一级菜单项 + 站点选择弹窗）；第 2 项修订建议全部同意，已写入需求 v1（`.dev/docs/requirements/v0/requirements.md`，v0 原稿存为 `requirements_v0.md`）。

1. **右键菜单没有公开的二级子菜单 API**（需求 §4）。可选：
   - A. 使用未公开的 `setSubmenu()`（很多插件在用，但未来 Obsidian 版本可能失效，社区插件审核可能提出意见）；
   - B. 一级菜单项 + 站点选择弹窗：「Pressroom：发布…」点击后弹出站点列表（含「全部站点」与状态标记）；
   - C. 平铺：「发布到 站点 A」「发布到 站点 B」……用 `setSection` 分组，站点多时菜单很长。
2. **需求修订建议**（确认后按「技术调整文档更新流程」写入需求 v1）：
   - §5.3 冲突检测范围：manifest → 站点内容目录全部文件 + 已写入的 aliases；补充「文件夹笔记」折叠规则；
   - §7 附件同名判断改为按 slug 比较；
   - §7 双链输出格式按站点 `markdownLinkResolution` 自动适配（新增实现要点）；
   - §10 slug 规则改为直接依赖 `@quartz-community/utils`；
   - §11 aliases：可用，进入 v1 范围（AliasRedirects 未启用时提示）。
