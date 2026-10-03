# Phase 1: 工程骨架与核心纯逻辑 详细计划

## 计划概述
**阶段名称**: Phase 1 - 工程骨架与核心纯逻辑  
**核心目标**: 搭好插件工程，完成不依赖界面的核心模块（Quartz 适配、GitHub 客户端、manifest），配单元测试；设置页能保存配置并「测试连接」  
**当前状态**: [✓] 已完成，人类验收通过（2026-10-03）  
**依据**: 需求 v1（`.dev/docs/requirements/v0/requirements.md`）、Phase 0 结论（`.dev/docs/others/phase0-findings.md`）  
**不在本阶段**: 右键菜单、发布 / 撤稿流程、内容转换（Phase 2 起）

## 现状分析

### 已有基础
- [✓] **Phase 0 结论**: slug 依赖 `@quartz-community/utils/path`；链接输出完整站内路径并按 `markdownLinkResolution` 适配；Git Data API 单次提交、blob SHA、422 重试已验证；`secretStorage` 1.11.4 起可用
- [✓] **参照工程**: 官方 `obsidianmd/obsidian-sample-plugin`（commit `07ceb81`，2026-08-02）：esbuild、TypeScript strict、`eslint-plugin-obsidianmd`、`version-bump.mjs`
- [!] **限制因素**: `@quartz-community/utils` 只提供 ESM 的 `exports` 子路径 → TypeScript 需 `moduleResolution: "bundler"`（sample 用的是 `node`）

### 已确认的决定（2026-10-03）
- 许可证 MIT；`manifest.json` 作者为 GitHub 用户名（只出现在 manifest / LICENSE，不写入其他文档）
- 测试 vault 放 `.dev/unit-tests/test-vault/`：示例笔记入库（脱敏）；`.obsidian/` 整体 gitignore（插件 `data.json` 含站点与仓库配置）

## 架构约定

```text
src/
├── main.ts              # 插件入口：加载设置、注册设置页（Phase 1 只做这些）
├── i18n/                # 中英文字典 + t()；语言取 Obsidian getLanguage()
├── settings/            # 设置数据结构、默认值、设置页 UI
├── core/                # 纯逻辑，禁止 import "obsidian"
│   ├── types.ts         # SiteConfig、ManifestV1 等共享类型
│   ├── hash.ts          # git blob SHA（Web Crypto）、base64
│   ├── generator/       # 生成器适配层（接口 + quartz/ 实现）
│   ├── backend/         # 存储后端（接口 + github/ 实现），HTTP 由外部注入
│   └── manifest/        # manifest 结构、校验、版本、读写
└── platform/            # 与 Obsidian 绑定的实现：requestUrl 版 HTTP、parseYaml、secretStorage
.dev/unit-tests/         # 正式单元测试（必须通过），按模块分子目录
├── generator/ backend/ manifest/ i18n/ ...   # vitest，只测 core/ 与 i18n/
└── test-vault/          # 开发用测试 vault（示例笔记入库，.obsidian/ 不入库）
```

- 测试目录遵循全局规则：正式单元测试在 `.dev/unit-tests/`，探索性测试在 `.dev/tests/`；根目录不设 `tests/`（~~根目录 `tests/` 放 vitest~~，2026-10-03 用户确认改）。README 中注明测试位置。

- `core/` 不依赖 `obsidian` 包，所有平台能力（HTTP、YAML 解析）通过参数注入 → 可在 Node 中单元测试。
- 代码注释与界面文字以外的开发文档用中文；界面文字只经 `t()` 输出。

## 详细实施步骤

### Phase 1-1: 工程初始化
#### 具体任务
- 以 sample-plugin 为蓝本建：`package.json`（name `pressroom`，MIT）、`manifest.json`（id `pressroom`，`isDesktopOnly: true`，`minAppVersion: ~~"1.11.4"~~ "1.13.0"`）、`versions.json`、`version-bump.mjs`、`tsconfig.json`（`moduleResolution: "bundler"`，include `src`、`.dev/unit-tests`）、`vitest.config.ts`（只收集 `.dev/unit-tests/**/*.test.ts`）、`esbuild.config.mjs`、`eslint.config.mts`（`eslint-plugin-obsidianmd`）、`styles.css`、`LICENSE`、`README.md`（占位）
- 依赖：`obsidian`（锁定版本，不用 `latest`）、`@quartz-community/utils@^1.0.1`、`vitest`；开发依赖与 sample 一致
- 开发部署：esbuild 构建后把 `main.js`、`manifest.json`、`styles.css` 复制到 `PRESSROOM_VAULT/.obsidian/plugins/pressroom/`；`PRESSROOM_VAULT` 从根目录 `.env.local`（gitignore）读取，未配置则只构建不复制。不用符号链接
- `.gitignore` 补：`main.js`（已有）、`.dev/unit-tests/test-vault/.obsidian/`
- npm / npx 一律在 PowerShell 运行（见 `.agents/notes/known_pits.md`）
#### 验收标准
- [✓] `npm run build`（tsc 类型检查 + 生产构建）、`npm run lint`、`npm test` 均通过
- [✓] 在测试 vault 中能启用插件，无控制台报错

### Phase 1-2: i18n
#### 具体任务
- `src/i18n/en.ts`、`zh.ts` 字典 + `t(key, vars)`；`getLanguage()`（1.8.7+）以 `zh` 开头用中文，否则英文
- 字典键类型由 `en.ts` 推导，`zh.ts` 缺键时编译报错
#### 验收标准
- [✓] 单元测试：两份字典键集合一致、插值正确
- [✓] 切换 Obsidian 语言后设置页文字随之切换（人工）

### Phase 1-3: 设置页
#### 具体任务
- 数据结构（`data.json`）：`sites[]`（id、名称、`owner/repo`、分支、内容目录、站点网址、目录模式、隔离）、`tokenSecretId`、排除文件夹、双链处理默认值、属性白名单（默认 `title`、`tags`、`date`、`description`）
- 站点增删改；token 用 `SecretComponent`，`data.json` 只存密钥 id，token 本体在 `secretStorage`
- 输入校验：`owner/repo` 格式、网址格式、内容目录去首尾 `/`；校验失败就地提示、不保存
- 每个站点一个「测试连接」按钮：验证 token 与仓库 / 分支可访问，读取站点 `quartz.config.yaml`，显示链接解析策略与 AliasRedirects 是否启用
- 目录模式在本阶段只存本地；写回仓库 manifest 随 Phase 4「切换模式」实现
- **调整（2026-10-03）**：设置页 ~~命令式 `display()`~~ → 1.13 声明式 `getSettingDefinitions()`：站点用 `list`（自带添加 / 删除），每个站点一个 `page`；~~校验用控件自带的 `validate`；控件键 `site:<id>:<字段>` 由 `getControlValue` / `setControlValue` 解析~~ **[!] 实测：在子页面内调用 `update()` 使子页面变空白并打断输入法组字** → 站点子页面改为自定义 `SettingPage` 子类（`site-page.ts`）命令式渲染，离开子页面（`hide`）时再 `update()` 刷新列表；token 行用 `render` 嵌入 `SecretComponent`。「测试连接」在 1-5 完成后作为站点页内的 action 行接入
#### 验收标准
- [✓] 重启 Obsidian 后设置保留；`data.json` 中不含 token 明文
- [✓] 测试连接对正确 / 错误 token、不存在的仓库、不存在的分支给出明确提示（人工，用测试仓库）

### Phase 1-4: Quartz 适配层（`core/generator/`）
#### 具体任务
- 接口 `Generator`：`slugOf(sitePath)`、`urlOf(siteUrl, sitePath)`、`formatLink(sourcePath, targetPath, anchor, text, strategy)`、`readSiteConfig(text)`
- `slugOf`：直接调用 `@quartz-community/utils/path` 的 `slugifyFilePath`；`urlOf`：`simplifySlug` 后拼站点网址并编码
- 冲突检测 `findConflicts(candidate, existingPaths, aliasSlugs)`：按 slug 比较，覆盖站点内容目录全部文件与 aliases；返回冲突对象列表（供界面显示「与 xxx 冲突」）
- `formatLink`：shortest / absolute 输出 ~~`[文字](<完整站内路径.md#锚点>)`~~ **`[文字](<目标 slug#锚点>)`**（以 slug 作链接目标，避开 `%`、`#`、空格的转义问题，见 findings §0-2 Phase 1 补测）；relative 输出相对路径；锚点保留原标题文字
- `readSiteConfig`：解析 `quartz.config.yaml`（YAML 解析器注入），取 crawl-links 的 `markdownLinkResolution`（~~缺省 `shortest`~~ 未配置时按插件默认 `absolute` 并标记）与 alias-redirects 是否启用，另读 `ignorePatterns`、`baseUrl`；文件不存在或格式不识别时返回失败原因
- **Phase 0 补测**：~~扩展 `.dev/tests/phase0/quartz/link-resolution.mjs`~~ 新建 `.dev/tests/phase1/quartz/format-link-e2e.mjs`（打包真实 `formatLink` 生成链接），在本地 Quartz 测试站验证三种策略的实际产物，结论补进 findings
#### 验收标准
- [✓] 单元测试：Phase 0 的 30 条 slug 用例全部通过；冲突检测覆盖「空格 vs 连字符」「文件夹同名笔记 vs index」「与 alias 冲突」「附件大小写」（`.dev/unit-tests/generator/`）
- [✓] 单元测试：`formatLink` 三种策略各自的期望输出；`readSiteConfig` 覆盖默认配置（Quartz 5 自带 `quartz.config.default.yaml` 作 fixture）、relative 配置、alias-redirects 关闭、文件缺失、YAML 错误
- [✓] 补测脚本：三种策略 × 3 个深度的源笔记 × 7 个目标，63 条链接全部指向正确页面，锚点 id 全部存在

### Phase 1-5: GitHub 客户端（`core/backend/github/`）
#### 具体任务
- 接口 `Backend`：`getHead()`、`getTree(commitSha)`（recursive，`truncated` 时抛错并说明）、`readText(path)`、`readBlob(sha)`、`commit(changes, message)`
- `changes`：`{ path, content: string | Uint8Array }`（新增 / 修改）、`{ path, reuseSha }`（挪动复用 blob）、`{ path, delete: true }`
- `commit`：建 blob → 基于 base tree 建 tree → 建 commit → `PATCH ref`（`force: false`）；422 非 fast-forward 时调用方提供的 `rebuild(newHead)` 重新生成 changes，最多重试 3 次，超出抛错
- HTTP 以 `HttpFn`（method、url、headers、body → status、json）注入；`platform/` 提供 `requestUrl` 实现（`throw: false`，由客户端判断状态码）
- 错误信息带期望值与实际值（状态码、GitHub message），401 / 403 / 404 / 422 分别给出可读提示
- `core/hash.ts`：`gitBlobSha(bytes)`（`crypto.subtle` SHA-1，Obsidian 与 Node 22 均可用）、`bytesToBase64`
#### 验收标准
- [✓] 单元测试（假 HttpFn + 内存版假 GitHub `.dev/unit-tests/backend/fake-github.ts`）：提交流程请求顺序与内容、删除条目 `sha: null`、挪动复用 sha、422 重试成功 / 超限、`truncated` 报错、各状态码的错误提示
- [✓] 单元测试：`gitBlobSha` 与 `git hash-object` 对中文、CRLF、二进制样本结果一致
- [✓] 测试 vault 中实测（人工触发调试命令，Phase 1 末删除或隐藏）：经 `requestUrl` 向测试仓库提交一个文本 + 一个二进制文件并清理，验证 Obsidian 运行时无 CORS 问题、二进制 base64 上传正确（2026-10-03 用户实测：自检全部通过）

### Phase 1-6: manifest（`core/manifest/`）
#### 具体任务
- `ManifestV1`：`version: 1`、`mode: "manual" | "follow"`、`notes[]`（`vaultPath`、`sitePath`（相对内容目录、含文件名）、`blobSha`、`publishedAt`、`attachments[]`、`aliases[]`）、`attachments[]`（`sitePath`、`blobSha`~~、引用它的 `sitePath` 列表~~）
  - **调整**：引用关系只记在 `notes[].attachments`，附件侧不重复存储（两处各存一份会不一致），需要时由 `attachmentRefs()` 反查；校验时要求笔记引用的附件必须在 `attachments` 中登记
- `parseManifest(text)`：校验结构，字段缺失或类型错误时抛错并指出路径；`version` 高于当前支持版本时 ~~拒绝写入~~ **读写都拒绝**（新版本结构本插件不认识，读出也可能误解），提示升级插件；另校验站内路径 / vault 路径 / 附件路径不重复
- `serializeManifest`：稳定排序 + 两空格缩进，保证内容不变时 blob SHA 不变
- 读：仓库 `.pressroom/manifest.json` 不存在 → 空 manifest；写：作为一个 change 与内容放进**同一次提交**（不单独提交）
#### 验收标准
- [✓] 单元测试：往返序列化一致、内容相同则 SHA 相同、各类非法输入报错信息、未来版本拒绝；与假 GitHub 联测「同一次提交写入并读回」（`.dev/unit-tests/manifest/`）

## 技术风险评估

### 中风险项
- **ESM-only 依赖与工具链**: `@quartz-community/utils`、`github-slugger` 为 ESM
  - 缓解措施: esbuild 打包为 cjs；TypeScript `moduleResolution: "bundler"`；vitest 原生支持 ESM；1-1 先验证三者打通
- **`eslint-plugin-obsidianmd` 规则与本项目写法冲突**（如禁止 `innerHTML`、要求 `requestUrl`）
  - 缓解措施: 从 1-1 起启用 lint，按规则写，避免 Phase 6 提交审核时返工

### 低风险项
- **`crypto.subtle` 为异步**: hash 相关 API 全部 async
  - 缓解措施: 接口设计时即为 Promise
- **测试 vault 在 OneDrive 内**: 同步 `.obsidian/` 运行时文件
  - 缓解措施: 体积小，可接受；`.obsidian/` 不入库

## 资源需求
- **测试环境**: Obsidian 最新版 + `.dev/unit-tests/test-vault/`；本地 Quartz 测试站 `C:\tmp\pressroom-quartz-test`；Phase 0 的测试仓库与 fine-grained token（7 天有效，过期需重新生成）
- **依赖库**: `obsidian`、`@quartz-community/utils`、`vitest`、esbuild、typescript、eslint + `eslint-plugin-obsidianmd`

## 需要用户做的
1. 1-1 完成后在 Obsidian 中「打开文件夹作为仓库」打开测试 vault，在第三方插件中启用 Pressroom
2. 1-3 完成后在设置页把 token 存进 Obsidian 密钥库、填测试仓库，点「测试连接」看各种情况的提示
3. 1-5 末在测试 vault 运行一次实测命令
4. 测试仓库 token 过期时重新生成

## 完成标准
1. [✓] `npm run build`、`npm run lint`、`npm test` 全部通过
2. [✓] 1-1 至 1-6 各验收项达成
3. [✓] 测试 vault 中：设置页可用、测试连接正确、`requestUrl` 运行时实测通过
4. [✓] 人类验收测试通过
5. [✓] findings 补测结论、`.agents/notes/` 更新

**注意**: 按验收流程（见 `AGENTS.md`「验收通过触发流程」/ `rules/workflow.md`），只有收到人类「验收通过」确认后，才能标记 Phase 为完成状态。
