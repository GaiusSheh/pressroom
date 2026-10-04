# Pressroom 开发日志 001

## 2026-10-03 项目初始化与 Phase 0 技术验证

### 2026-10-03 16:50 项目初始化

**变更类型**: 项目初始化
**影响范围**: 整个项目结构

#### 实现功能详细

**目录骨架** [✓]
- 标准单仓库：`.agents/`、`.consult/tasks/`、`.dev/`（changelog、docs、plans、tests、tools、deprecated）、`src/`、`tests/`
- `.gitattributes`、`.editorconfig`（行尾与编码）、`.gitignore`

**需求入库与脱敏** [✓]
- 需求文档移入 `.dev/docs/requirements/v0/requirements.md`
- 去除真实站点网址、站名、人名等示例，统一改为占位
- `.agents/AGENTS.md` 写入脱敏约定

**状态**: 开发完成，验收通过（commit `b02619d`）

### 2026-10-03 17:30 Phase 0 技术验证

**变更类型**: 技术验证
**影响范围**: 需求文档、实施计划、`.dev/tests/phase0/`、`.dev/docs/others/phase0-findings.md`

#### 实现功能详细

**0-1 Quartz 5 网址规则** [✓]
- slug 实现位于 npm 包 `@quartz-community/utils`（MIT、纯函数），决定直接依赖、不自行重写
- 用实际函数生成 30 条用例表（`.dev/tests/phase0/slug/slug-cases.mjs`）
- 发现：文件夹同名笔记折叠为 `folder/index`；附件路径同样被 slug 化；Quartz 遇冲突只警告、后者覆盖

**0-2 链接解析** [✓]
- 本地 Quartz 5 测试站实测三种 `markdownLinkResolution`（`.dev/tests/phase0/quartz/link-resolution.mjs`）
- 结论：始终输出完整站内路径；shortest/absolute 输出完整路径，relative 输出相对路径

**0-3 aliases 重定向** [✓]
- AliasRedirects 默认启用，中文与空格别名可用；`permalink` 在 v5 只生成重定向页

**0-4 Obsidian API** [✓]
- `secretStorage` 1.11.4 起可用 → `minAppVersion` 1.11.4；公开 API 无二级子菜单

**0-5 GitHub Git Data API** [✓]
- 探索脚本 `.dev/tests/phase0/github/git-data-api.mjs`，16 项检查：单次提交内增改删与挪动、本地 blob SHA 一致、非 fast-forward 返回 422
- fine-grained token 仅 Contents 读写即可完成全部操作

#### 技术调整记录
- **右键菜单**：~~二级子菜单~~ **[!] 公开 API 不支持** → [✓] 一级菜单项 + 站点选择弹窗（用户选定）
- **需求升级为 v1**：冲突检测范围扩大到站点内容目录全部文件 + aliases；附件同名按 slug 判断；双链格式按站点配置适配；slug 依赖 `@quartz-community/utils`；aliases 重定向进入 v1。v0 原稿存为 `requirements_v0.md`

#### 验收标准达成
Phase 0 详细计划的所有验收标准均已达成：
- [✓] 结论文档覆盖 0-1 至 0-5，每条带出处
- [✓] 需求 §11 待定问题有结论
- [✓] 需求与总体计划已按技术调整流程更新

**状态**: 开发完成，验收通过

## 2026-10-03 Phase 1 工程骨架与核心纯逻辑

### 2026-10-03 22:50 Phase 1 工程骨架与核心纯逻辑

**变更类型**: 核心功能实现
**影响范围**: 插件工程、`src/`（i18n、设置页、core 模块）、`.dev/unit-tests/`

#### 实现功能详细

**1-1 工程初始化** [✓]
- 以官方 obsidian-sample-plugin 为蓝本：esbuild、TypeScript strict、`eslint-plugin-obsidianmd`、vitest、MIT 许可证
- `manifest.json`：id `pressroom`、仅桌面端、`minAppVersion` 1.13.0
- 构建后按根目录 `.env.local` 的 `PRESSROOM_VAULT` 把产物复制到测试 vault（`.dev/unit-tests/test-vault/`）
- 依赖：`@quartz-community/utils`、`github-slugger`（前者的可选 peer 依赖，需显式声明）

**1-2 中英双语** [✓]
- 字典键由英文字典推导，中文缺键编译报错；插值缺参抛错；语言跟随 Obsidian `getLanguage()`

**1-3 设置页** [✓]
- Obsidian 1.13 声明式设置 API：全局设置（token、排除文件夹、链接默认处理、属性白名单）+ 站点列表
- token 用 `SecretComponent` 存 Obsidian 密钥库，`data.json` 只存密钥 id
- 站点子页面：字段校验、测试连接、移除站点

**1-4 Quartz 适配层**（`src/core/generator/`）[✓]
- slug / 网址 / alias slug 复用 Quartz 5 的 `@quartz-community/utils`
- 冲突检测（文件 + aliases，按 slug 比较，支持排除被移动笔记自身）
- `formatLink`：以目标 slug 作链接目标，按站点链接策略输出完整路径或相对路径
- `readSiteConfig`：读取链接策略、AliasRedirects、ignorePatterns、baseUrl

**1-5 GitHub 客户端**（`src/core/backend/`）[✓]
- Git Data API 单次提交（增 / 改 / 删 / 复用 blob 挪动），非 fast-forward 时重新取 head 重建，最多重试 3 次
- 错误分类（token 无效、无权限、频率上限、不存在、冲突等），信息带状态码与 GitHub 原文
- 「测试连接」流程（`src/core/connection.ts`）与结果文字（`src/settings/connection-view.ts`）
- `requestUrl` 版 HTTP（`src/platform/http.ts`）；站点选择弹窗（`src/ui/site-picker.ts`，供 Phase 2 使用）

**1-6 manifest**（`src/core/manifest/`）[✓]
- `ManifestV1` 结构与逐字段校验（含路径合法性、重复、附件登记、未来版本拒绝）
- 稳定序列化：内容相同则 blob SHA 相同；与内容同一次提交写入

#### 技术调整记录
- **最低版本**：~~1.11.4~~ → [✓] 1.13.0（用户决定，采用声明式设置 API，旧 `display()` 已弃用）
- **站点子页面**：~~声明式 `items` + 每次改名 `update()`~~ **[!] 实测子页面变空白并打断拼音输入** → [✓] 自定义 `SettingPage` 子类，离开子页面时再刷新列表
- **删除站点**：框架对 page 类型列表项不显示删除按钮（仅 Delete 键可删）→ [✓] 子页面内增加「移除站点」按钮
- **链接格式**：~~`[文字](<站内路径.md#锚点>)`~~ → [✓] `[文字](<目标 slug#锚点>)`（原文件名中的 `%` 会使 Quartz `decodeURI` 抛错）
- **esbuild**：sample 的 0.25.5 与 vitest 5 冲突 → [✓] `^0.28.2`
- **测试位置**：~~根目录 `tests/`~~ → [✓] `.dev/unit-tests/`（遵循全局规则）

#### 测试验证结果
- [✓] **单元测试**：12 个文件、217 项全部通过（slug 30 条用例、冲突检测、链接格式、站点配置、blob SHA 对照 `git hash-object`、内存版假 GitHub 联测提交流程与非 fast-forward 重试、manifest 校验与稳定序列化、设置规整与校验、i18n）
- [✓] **Quartz 实际构建**：`formatLink` 三种策略 × 3 个深度 × 7 个目标，63 条链接全部指向正确页面与锚点
- [✓] **测试 vault 人工实测**：中英界面、站点增删改与校验、拼音改名、token 不落 `data.json`、测试连接四种情况、`requestUrl` 自检提交（文本 + 二进制）
- [✓] `npm run build`、`npm run lint` 零错误零警告

#### 验收标准达成
Phase 1 详细计划的所有验收标准均已达成；开发用自检命令已按计划删除。

**状态**: 开发完成，验收通过

## 2026-10-04 Phase 2 单站发布闭环

### 2026-10-04 16:15 Phase 2 单站发布闭环

**变更类型**: 核心功能实现
**影响范围**: `src/core/`（note、transform、attachments、publish、site-path、generator/ignore）、`src/platform/vault.ts`、`src/ui/`（actions、menu、location-modal、site-picker、errors）、GitHub 客户端缓存处理

#### 实现功能详细

**笔记解析** [✓]
- 链接、嵌入、frontmatter 的位置取自 Obsidian `metadataCache`，core 只按位置替换，代码块内的 `[[...]]` 不受影响
- 解析时校验缓存偏移处的原文与 `original` 一致，索引未更新时等待后重试

**内容转换** [✓]
- frontmatter 只保留白名单属性，全部去除时删掉整个块
- 指向本站已发布笔记的链接改写为站内 slug 路径（按站点链接策略）；未发布、排除、无法解析的链接与嵌入笔记变为纯文本
- 附件（嵌入与普通链接）上传并改写为站内路径：图片为图片语法，其他文件为链接

**附件** [✓]
- 统一放在内容目录 `assets/`，按内容 SHA 去重（含站上已有但未登记的文件），同名不同内容加 `-2`、`-3` 后缀；撤稿不删附件

**发布服务** [✓]
- 首次发布（网址冲突拦截）、更新（位置不变，内容无变化不提交）、撤稿；全部在一次提交内完成，基于当次 head 重读 manifest 与文件树
- 状态判定：已同步 / 有修改 / 未发布；发布或撤稿其他笔记后，引用它的笔记自动变为「有修改」

**界面** [✓]
- 右键菜单与命令面板：发布、撤稿、获取链接、打开网页；排除文件夹中的笔记不显示
- 站点选择弹窗（状态标记、未发布灰显；单站时跳过）
- 首次发布位置弹窗：按 vault 目录填入、目录建议、网址预览、实时冲突拦截、Quartz ignorePatterns 提示
- 发布成功提示带「复制链接」；错误按类型给出可读原因

#### 技术调整记录
- **附件链接格式**：Quartz 实际构建验证后确定复用 `formatLink`（图片加 `!`）；原文件名写法在 relative 策略下会失效
- **嵌入的非图片附件**：~~`![](x.pdf)`~~ **[!] 会被当作坏图片** → [✓] 输出为普通链接
- **状态模块**：~~单独的 `status.ts`~~ → [✓] 与发布共用准备逻辑，并入 `publish.ts`
- **HTTP 缓存**：~~直接读取分支指向~~ **[!] Obsidian `requestUrl` 遵守 GitHub 的 `Cache-Control: max-age=60`，提交后 1 分钟内读到旧 head，误报「分支被其他来源更新」与「已是最新」** → [✓] 会变化的资源请求加 `Cache-Control: no-cache`，按 sha 读取的保留缓存
- **用户决定**：manifest 中 vault 路径维持明文（用户自行保证站点仓库私有）；嵌入笔记在 Phase 2 临时变为纯文本；普通链接指向的附件也上传

#### 测试验证结果
- [✓] **单元测试**：17 个文件、310 项全部通过（转换、附件分配、发布服务与假 GitHub 联测、ignorePatterns 匹配、站内路径、错误文字、缓存请求头）
- [✓] **Quartz 实际构建**：附件链接三种策略 × 3 个深度全部正确；测试仓库发布结果构建后页面、链接、图片、锚点正确，私有属性不出现
- [✓] **测试 vault 实测**（用户 + windows-mcp 测试 agent）：首次发布、冲突拦截、更新、无变化不提交、状态联动、撤稿、获取链接、命令面板、排除文件夹；缓存修复后在 60 秒内连续发布 / 撤稿全部正确
- [!] **未覆盖**：多站点时的站点选择与灰显（留到 Phase 4）；ignorePatterns 黄色提示（测试仓库无 Quartz 配置，单元测试覆盖）

#### 验收标准达成
Phase 2 详细计划的验收标准均已达成（未覆盖项已注明）。

**状态**: 开发完成，验收通过
