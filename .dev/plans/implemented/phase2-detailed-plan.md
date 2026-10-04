# Phase 2: 单站发布闭环 详细计划

## 计划概述
**阶段名称**: Phase 2 - 单站发布闭环  
**核心目标**: 在一个**手动模式**站点上，右键完成 发布（首次 / 更新）、撤稿、获取链接、打开网页；内容做基础转换，附件随笔记上传；能判断「已同步 / 有修改」  
**当前状态**: [✓] 已完成，人类验收通过（2026-10-04）  
**依据**: 需求 v1 §4、§5.3、§6.1、§7、§9；Phase 1 的 core 模块（`.dev/plans/implemented/phase1-detailed-plan.md`）  
**不在本阶段**: 嵌入笔记展开、连带发布、站点隔离（Phase 3）；「全部站点」、跟随 vault 模式、改名监听（Phase 4）；管理面板与批量操作（Phase 5）

## 现状分析

### 已有基础（Phase 1）
- [✓] `core/generator/quartz.ts`：slug、网址、冲突检测、`formatLink`、站点配置读取
- [✓] `core/backend/github.ts`：`commit(message, build(head))`，非 fast-forward 时重取 head 重建
- [✓] `core/manifest/manifest.ts`：结构、校验、稳定序列化、`manifestChange`
- [✓] `ui/site-picker.ts`：站点选择弹窗；设置页能取 token、测试连接

### 待验证前提
- [!] **Quartz 对图片 / 附件的链接解析**：Markdown 图片 `![alt](<assets/图 1.png>)` 在三种链接策略下是否正确，附件文件是否按 slug 后的路径输出（Phase 0 只验证了笔记链接）→ 2-2 中先做 Quartz 实际构建验证

## 架构约定

```text
src/core/
├── note.ts            # ParsedNote：正文 + frontmatter 范围 + 链接/嵌入列表（由平台层构造）
├── transform/         # 内容转换（纯函数）：frontmatter 白名单、链接改写、附件收集
├── attachments.ts     # 附件站内路径分配：按内容 SHA 去重、按 slug 判同名、冲突加后缀
├── publish.ts         # 发布 / 更新 / 撤稿：生成 Change[] 与新 manifest（在 commit 的 build 回调中运行）
└── ~~status.ts~~      # **调整**：状态判定（noteStatus、deletedSources）与发布共用准备逻辑，并入 publish.ts
    （另增：site-path.ts 站内路径拼接与校验；generator/ignore.ts Quartz ignorePatterns 匹配）
src/platform/
├── vault.ts           # VaultAccess：读文本 / 二进制、解析链接目标、metadataCache → ParsedNote
└── ~~yaml.ts~~        # **调整**：parseYaml / stringifyYaml 直接在 ui/actions.ts 构造上下文时注入，不单独成文件
src/ui/
├── menu.ts            # 右键菜单与命令面板
├── actions.ts         # （新增）四个操作的流程 + 站点快照缓存（取代计划中的 site-state.ts）
├── errors.ts          # （新增）错误 → 界面文字
├── location-modal.ts  # 首次发布位置弹窗
└── site-state.ts      # 每站 manifest + 文件树的缓存（右键菜单显示状态用）
```

- **笔记解析交给 Obsidian**：链接、嵌入、frontmatter 的位置取自 `metadataCache`（`links`、`embeds`、`frontmatterPosition`），core 只按位置替换文本，不自己写正则解析 Markdown（避免代码块内的 `[[...]]` 被误改）。单元测试中直接构造 `ParsedNote`。
- **一次操作一次提交**：内容、附件、manifest 放进同一个 `commit` 的 build 回调；回调内基于当次 head 重读 manifest 与文件树，所以非 fast-forward 重试时能正确合并其他设备的改动。
- **提交信息不含 vault 路径**，只写站内路径，如 `Pressroom: 发布 笔记/数学/示例标题`。

## 详细实施步骤

### Phase 2-1: 笔记解析与 vault 访问（`core/note.ts`、`platform/vault.ts`）
#### 具体任务
- `ParsedNote`：`vaultPath`、`text`、`frontmatter`（范围 + 解析后的对象）、`refs[]`（`{ start, end, embed, target, subpath, display }`，target 为原始链接文字）
- `VaultAccess` 接口（core 定义、platform 实现）：`readText`、`readBinary`、`resolve(target, fromPath) → vault 文件路径 | undefined`（Obsidian `metadataCache.getFirstLinkpathDest`）、`isExcluded(path)`
- 平台实现：`metadataCache.getFileCache` → `ParsedNote`；缓存尚未就绪时等待 `resolved` 事件而非读到空数据
- 同时覆盖维基链接 `[[...]]` 与 Markdown 链接 `[..](..)`（Obsidian 均记入 `links` / `embeds`）
#### 验收标准
- [✓] 单元测试：由构造的 `ParsedNote` 驱动后续模块；`isExcluded` 覆盖子文件夹、同名前缀（`Private2/` 不算 `Private/`）
- [✓] ~~测试 vault 中：示例笔记解析出的链接、嵌入位置与原文一致（开发期调试输出，验证后删除）~~ → 改为 `parseNote` 内置校验：每条缓存链接在正文对应偏移处的原文必须与 `original` 一致，否则等待索引更新后重试，仍不一致即报错；2-5 实测中链接、图片、代码块改写全部正确

### Phase 2-2: 内容转换（`core/transform/`）
#### 具体任务
- **frontmatter 白名单**：只保留设置中的属性；无剩余属性时去掉整个 frontmatter 块；YAML 序列化由平台注入（Obsidian `stringifyYaml`）
- **笔记链接**（非嵌入）：目标已在本站发布 → `formatLink`（按站点链接策略）；未发布 / 无法解析 / 在排除文件夹 → 纯文本（显示文字，无则用链接文字）
- **嵌入笔记** `![[笔记]]`：Phase 2 临时变为纯文本（被嵌入笔记的名字）；Phase 3 改为展开
- **调整（前置验证结论）**：附件链接复用 `formatLink`，图片前加 `!`；嵌入的非图片附件（PDF 等）输出为普通链接（`![](x.pdf)` 会被当作坏图片）；空显示文字（`![](图.png)`）视为未写，图片 alt 用文件名、纯文本用链接目标
- **附件**（非 `.md` 文件，嵌入 `![[图.png]]` / `![](图.png)` 与普通链接 `[[资料.pdf]]` 均上传）：收集为待上传列表，改写为站内路径（图片 `![alt](<路径>)`，其他文件 `[文件名](<路径>)`）
- **先做 Quartz 实际构建验证**：图片与 PDF 链接在三种策略下的写法（扩展 `.dev/tests/phase1/quartz/format-link-e2e.mjs` 或新建 phase2 脚本），确定最终格式后再写转换
- 转换结果：`{ text, attachments: VaultFile[] }`；同一输入多次转换结果逐字节相同
#### 验收标准
- [✓] Quartz 实际构建：图片、PDF、带空格与中文的附件在三种策略下均可显示 / 打开
- [✓] 单元测试：白名单（保留、去除、全部去除、无 frontmatter）、已发布 / 未发布 / 排除 / 无法解析的链接、锚点、显示文字、代码块内链接不被改动（由 refs 决定）、附件嵌入两种语法、输出稳定

### Phase 2-3: 附件路径分配（`core/attachments.ts`）
#### 具体任务
- 存放在站点内容目录下的 `assets/`，保留原文件名
- 已在 manifest 中、内容 SHA 相同 → 复用原路径，不重复上传
- 新附件：slug 后与现有附件 / 内容文件冲突且内容不同 → 文件名加后缀（`图 1.png` → `图 1-2.png`），直到不冲突
- 撤稿不删附件（需求 §7）；manifest 中笔记的 `attachments` 记录引用关系
#### 验收标准
- [✓] 单元测试：同内容去重、同名不同内容加后缀、大小写 / 空格不同视为同名（按 slug）、后缀递增、多篇共享同一附件

### Phase 2-4: 发布服务与状态（`core/publish.ts`、`core/status.ts`）
#### 具体任务
- **首次发布**：输入站内路径 → 冲突检测（站点内容目录全部文件 + manifest 中的 aliases）→ 转换 → 附件分配 → Change[] + manifest 新记录
- **更新**：已发布的笔记再次发布，位置不变，只推内容与新增附件
- **撤稿**：删除笔记文件与 manifest 记录，附件保留
- **状态**：源笔记存在时，转换结果的 blob SHA 与仓库文件树中该路径的 SHA 比较 → 已同步 / 有修改；源笔记已删除 → 源已删除（需求 §6.1；「已移动」属 Phase 4）
- 全部在 `commit` 的 build 回调中基于当次 head 计算；build 返回空（内容无变化）时不提交，提示「已是最新」
- 站点 manifest 不存在时按设置中的模式创建
#### 验收标准
- [✓] 单元测试（假 GitHub）：首次发布、更新、内容无变化不提交、撤稿保留附件、冲突拦截、发布期间其他设备推送（非 fast-forward）后结果正确、仓库外部手改该文件后状态为「有修改」

### Phase 2-5: 界面（`ui/`）
#### 具体任务
- **右键菜单**（`file-menu`，仅 Markdown 文件、排除文件夹中不显示）：`Pressroom：发布…`、`撤稿…`、`获取链接…`、`打开网页…` → 站点选择弹窗（只有一个站点时跳过）；未发布的站点在撤稿 / 获取链接 / 打开网页中灰显并不可选
- **站点状态**：弹窗中每站显示 ✓ 已同步 / ● 有修改 / 未发布；manifest 与文件树按站缓存，打开弹窗时后台刷新，先显示缓存结果
- **首次发布位置弹窗**（手动模式，需求 §5.3）：「按 Vault 内目录发布」勾选框（勾选即填入 vault 目录与文件名，仍可改）；站内目录（从站上已有目录选择或输入新目录）；站内名称；网址预览；实时冲突提示（冲突时不能发布）；路径命中站点 `ignorePatterns` 时提示「该位置不会被 Quartz 构建」。双链处理一栏留到 Phase 3（本阶段未发布链接一律纯文本）
- **命令面板**：同样四条命令，作用于当前打开的笔记
- **提示**：发布成功「已发布到 xxx，约 1 分钟后生效」并提供复制链接；失败按错误类型给出可读原因（沿用 Phase 1 的错误分类）；获取链接复制到剪贴板；打开网页用系统浏览器
- 文件列表多选（`files-menu`）批量发布 / 撤稿属 Phase 5，本阶段不做
#### 验收标准
- [✓] 测试 vault 人工验证（2026-10-04，用户 + windows-mcp 测试 agent）：四个菜单项与命令；单站跳过选择；位置弹窗的勾选、目录建议（不含 assets）、网址预览、冲突拦截；排除文件夹不显示菜单；提示文字中英文。未覆盖：多站时的站点选择与灰显（只有一个站点，Phase 4 多站时验证）、ignorePatterns 黄色提示（测试仓库无 Quartz 配置）
  - **实测发现并修复**：`requestUrl` 按 GitHub 的 `Cache-Control: max-age=60` 缓存 GET，提交后 1 分钟内读到旧 head / 旧 manifest，导致误报「分支被其他来源更新」与「已是最新」→ 会变化的资源请求加 `Cache-Control: no-cache`；回归测试在 60 秒内连续发布 / 撤稿全部正确
  - 小调整：站内目录建议排除 `assets/`；位置弹窗错误 / 警告整行着色
  - 观察：`[[笔记#标题]]` 的显示文字为「笔记 > 标题」（与 Obsidian 阅读模式一致）

### Phase 2-6: 端到端验证
#### 具体任务
- 测试 vault + 测试仓库：发布示例笔记（含中文标题、图片、链接到已发布 / 未发布笔记、私有属性）→ 更新 → 撤稿
- 把测试仓库内容拉到本地 Quartz 测试站构建（脚本放 `.dev/tests/phase2/`），检查页面、链接、图片、frontmatter 白名单在网页上的实际效果
#### 验收标准
- [✓] 测试仓库中的文件、manifest 与预期一致；每次操作只产生一个提交（首次发布、更新、无变化不提交、撤稿保留附件、状态联动均经 gh 核对）
- [✓] Quartz 构建后页面、链接、图片正确，私有属性不出现在页面与仓库中（`.dev/tests/phase2/quartz/sandbox-build.mjs`，测试仓库提交 9598cbb：2 篇页面、4 处站内链接与图片、`#第一节` 锚点全部正确，`private-field` 及其值不出现）

## 需要讨论（开工前请确认）

> **2026-10-03 用户决定**：第 1 项选 **B 维持明文**（由用户自行保证站点仓库私有）；第 2 项选 **A 变为纯文本**；第 3 项选 **同样上传**。

1. **manifest 中的 vault 路径会随站点仓库公开**：GitHub Pages 等常用公开仓库，`.pressroom/manifest.json` 里的 `vaultPath` 会暴露 vault 的目录结构与文件名；两个站点的 manifest 含同一 vault 的路径，还可能被关联起来，与需求 §8「站点隔离」冲突。可选：
   - A. 仓库 manifest 只存 vault 路径的哈希（加每站随机盐），真实路径映射存本机插件数据；换设备时通过「导入已有内容」按哈希重新匹配
   - B. 维持需求现状（明文 vault 路径），由用户自行保证仓库私有
   - C. vault 路径整体移到本机插件数据，仓库 manifest 只存站内信息（换设备需重新匹配，代价更大）
2. **Phase 2 中嵌入笔记 `![[笔记]]` 的临时处理**（Phase 3 才展开）：A. 变为纯文本（笔记名）；B. 发布时拒绝并提示「含嵌入笔记，Phase 3 支持」；C. 原样保留（Quartz 会尝试按文件名嵌入，结果不可控）
3. **非嵌入的附件链接** `[[文件.pdf]]`（不带 `!`）：是否同样上传附件并改写链接（需求只写了「嵌入的附件」）

## 技术风险评估

### 中风险项
- **metadataCache 尚未就绪**：插件刚加载或文件刚修改时缓存可能是旧的
  - 缓解措施: 发布前检查缓存对应的文件修改时间，必要时等待 `changed` / `resolved` 事件
- **大附件**：GitHub blob API 单个上限约 100 MB，大文件上传慢
  - 缓解措施: 超过阈值（如 25 MB）提示并拒绝，记录到 deferred
- **Quartz 附件链接写法**：图片路径解析可能与笔记链接不同
  - 缓解措施: 2-2 先做实际构建验证再定格式

### 低风险项
- **右键菜单缓存过期**：状态显示与仓库实际不一致
  - 缓解措施: 发布动作本身总是基于最新 head 计算，缓存只影响显示

## 资源需求
- **测试环境**: 测试 vault、测试仓库与 fine-grained token（Phase 0 生成，7 天有效，Phase 2 期间可能需要重新生成）、本地 Quartz 测试站
- **依赖库**: 无新增（YAML 序列化用 Obsidian `stringifyYaml`，测试用已有的 `yaml` 包）

## 需要用户做的
1. 确认上面三个讨论项
2. 2-5、2-6 在测试 vault 中人工验证
3. token 过期时重新生成并填入密钥库与 `.env.local`

## 完成标准
1. [✓] `npm run build`、`npm run lint`、`npm test` 全部通过
2. [✓] 2-1 至 2-6 各验收项达成
3. [✓] 人类验收测试通过
4. [✓] 需求、计划、findings、`.agents/notes/` 按调整更新

**注意**: 按验收流程（见 `AGENTS.md`「验收通过触发流程」/ `rules/workflow.md`），只有收到人类「验收通过」确认后，才能标记 Phase 为完成状态。
