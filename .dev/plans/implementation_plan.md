# Pressroom 实施计划

## 项目状态概览
**目标**: 免费、开源的 Obsidian 发布插件——多站点、逐篇发布、零 frontmatter、带管理面板，替换 Enveloppe  
**当前状态**: Phase 3 完整内容转换与隔离已验收通过；需求 v1（`.dev/docs/requirements/v0/requirements.md`）  
**项目性质**: Obsidian 社区插件（仅桌面端），作者自用 + 开源发布  
**技术约束**: 仅 Quartz 5 + GitHub；不修改笔记与 frontmatter；站点之间不得产生可追溯关联；仓库内容必须脱敏（见 `.agents/AGENTS.md`）  
**分支架构**: 标准单仓库，主分支开发  
**下一阶段**: Phase 4 多站点与目录模式（待编写详细计划）

## 技术架构
- **语言**: TypeScript，esbuild 打包，基于官方 obsidian-sample-plugin 工程结构
- **生成器适配层**（~~`src/generator/`~~ `src/core/generator/`）: 网址 slug 规则、链接输出格式封装为接口，v1 只实现 Quartz 5，以后可接 Hugo
  - **Phase 0 调整**: slug 直接依赖 `@quartz-community/utils/path`（~~自行实现 slug~~）；链接格式按站点 `markdownLinkResolution` 适配
- **存储后端**（~~`src/backend/`~~ `src/core/backend/`）: GitHub Git Data API（blob → tree → commit → 更新 ref），经 Obsidian `requestUrl` 调用（`src/platform/http.ts` 注入），一次操作一次提交
- **manifest**（~~`src/manifest/`~~ `src/core/manifest/`）: 每站仓库内 `.pressroom/manifest.json`，仓库为唯一真相源
- **内容转换**（`src/transform/`）: 纯函数管线——frontmatter 白名单 → 嵌入展开 → 双链改写 → 附件收集
- **状态计算**（`src/state/`）: 转换结果的 git blob SHA 与仓库比对，得出 已同步 / 有修改 / 已移动 / 源已删除
- **界面**: Obsidian API（右键菜单、命令、Modal、设置页），i18n 中英文字集中在 `src/i18n/`
  - **Phase 0 调整**: 右键菜单 ~~二级子菜单~~ → 一级菜单项 + 站点选择弹窗（公开 API 无子菜单）；token 用 `secretStorage` + `SecretComponent`，`minAppVersion` ~~1.11.4~~ 1.13.0（Phase 1 调整：设置页用声明式 API）
- **测试**: vitest 覆盖纯逻辑模块（slug、转换、状态、manifest）；GitHub 交互用一次性测试仓库做手动/半自动验证
- **架构特点**: 纯逻辑与 Obsidian/网络层分离，核心模块不依赖 `obsidian` 包，可直接单元测试

## 开发计划

### [ ] Phase 4: 多站点与目录模式 (下一步，待编写详细计划)
**核心目标**: 补齐需求 §4「全部站点」、§5，以及跟随 vault 站点的连带发布（§7）
- 发布 / 撤稿 / 获取链接的「全部站点」；多站首次发布的分块弹窗（多站选择与灰显已在 Phase 3 实测通过）
- 跟随 vault 模式；模式切换（切换本身不挪动站上内容，手动 → 跟随时弹确认清单）
- 监听 vault 改名 / 移动，更新 manifest 源路径，产生「已移动」状态
- **（自 Phase 3 移入）连带发布**：跟随 vault 站点的三选一（纯文本 / 一层 / 到底），连带笔记位置即 vault 位置；连带确认清单；更新时出现新的未发布链接按设置默认值处理，连带时弹清单；收集时去重防循环

### [ ] Phase 5: 管理面板 (未来计划)
**核心目标**: 补齐需求 §6
- ribbon 呼出的弹窗：站点选项卡 + 站内目录树 + 状态标签
- 单项操作：更新、站内改名/移动（仅手动站点）、撤稿、复制链接、打开网页、在 vault 中打开
- 批量：一键同步 / 更新 / 重排 / 清理已删除，每个批量操作合并为一次提交
- 文件列表多选批量发布 / 撤稿；命令面板命令

### [ ] Phase 6: 迁移与发布 (未来计划)
**核心目标**: 作者站点从 Enveloppe 迁移，插件公开发布
- 「导入已有内容」：按路径匹配仓库现有文件与 vault 笔记，生成 manifest
- ~~挪动后旧链接处理（依 Phase 0 aliases 验证结论实现或放弃）~~ → Phase 0 已确认 aliases 可用：挪动时写入 aliases（实现位置随 Phase 4/5 的挪动功能），此处只保留迁移时的旧链接核对
- README、LICENSE、发布流程（GitHub Release），提交 Obsidian 社区插件审核
- 接入作者自己的站点（站点信息只存本机设置，不进仓库）

## 风险管控

### 技术风险
- **Quartz 5 slug 规则与插件不一致**: 网址冲突检测、获取链接全部失准 → ~~Phase 0 对照源码建测试表~~ **已缓解**：直接依赖 Quartz 所用的 `@quartz-community/utils`，用例表做回归；Quartz 升级时同步升级依赖
- **Quartz 链接解析方式不支持插件输出的链接**: 双链改写失效 → **已缓解**：Phase 0 实测完整路径在 shortest/absolute 下可用，relative 输出相对路径
- **secretStorage 不可用或需较新 Obsidian 版本**: token 无处安全存放 → **已确认** 1.11.4 起可用，`minAppVersion` 定为 ~~1.11.4~~ 1.13.0（Phase 1 中为采用声明式设置 API 提高）
- **Git Data API 并发冲突**（多设备同时发布、外部推送）: 更新 ref 失败 → 提交前取最新 ref，非 fast-forward 时重试并重读 manifest
- **manifest 与仓库实际内容不一致**（手工改仓库）: 状态误判 → 状态以仓库实际 blob 为准，manifest 只做索引；提供重新扫描

### 项目风险
- **范围膨胀**（往 Enveloppe 式选项发展）: → 严格按需求 v0「v1 不做」清单，新想法记入 `.agents/notes/deferred.md`
- **脱敏遗漏**（测试仓库名、作者站点信息进入仓库）: → 测试仓库配置放 gitignore 的本地文件；提交前检查（见 `.agents/AGENTS.md`）

---

**开发原则**:
- 严格遵循「计划先行」（先文档后编码，见 `rules/development.md` / `rules/workflow.md` 计划模式）
- 渐进式开发，每阶段充分测试验证
- 优先保证核心功能稳定，再扩展高级特性

---

## 开发历史

### [✓] 项目初始化 (已完成)
**详细计划**: 无独立计划文档  
**完成时间**: 2026-10-03  
**技术成果**: 建立治理目录结构，需求 v0 入库并脱敏，确立脱敏约定

- [✓] **目录骨架**: `.agents/`、`.consult/`、`.dev/`、`src/`、`tests/`，行尾配置
- [✓] **需求文档**: 移入 `.dev/docs/requirements/v0/requirements.md`，去除真实站点与示例信息
- [✓] **脱敏约定**: 写入 `.agents/AGENTS.md`

### [✓] Phase 0: 技术验证 (已完成)
**详细计划**: `.dev/plans/implemented/phase0-detailed-plan.md`  
**结论文档**: `.dev/docs/others/phase0-findings.md`  
**完成时间**: 2026-10-03 17:35 (耗时约 1 小时)  
**技术成果**: 查清并实测影响架构的五项外部前提，需求据此升级为 v1

- [✓] **Quartz 5 slug 规则**: 实现在 `@quartz-community/utils`，决定直接依赖；30 条用例表
- [✓] **Quartz 链接解析**: 输出完整站内路径，按站点 `markdownLinkResolution` 适配
- [✓] **aliases 重定向**: 可用，进入 v1
- [✓] **Obsidian API**: `secretStorage` 1.11.4 起可用；公开 API 无二级子菜单
- [✓] **GitHub Git Data API**: 单次提交增改删与挪动、blob SHA 一致、422 重试、仅需 Contents 读写
- [✓] **验收确认**: 人类验收通过

**技术调整/发现/突破**:
- **右键菜单**: ~~二级子菜单~~ **[!] 公开 API 不支持** → [✓] 一级菜单项 + 站点选择弹窗
- **冲突检测**: ~~只比 manifest~~ → [✓] 站点内容目录全部文件 + aliases（Quartz 冲突只警告、后者覆盖）

### [✓] Phase 1: 工程骨架与核心纯逻辑 (已完成)
**详细计划**: `.dev/plans/implemented/phase1-detailed-plan.md`  
**完成时间**: 2026-10-03 22:55 (耗时约 5 小时)  
**技术成果**: 插件工程与设置页可用，Quartz 适配 / GitHub 客户端 / manifest 三个核心模块完成并有 217 项单元测试

- [✓] **工程初始化**: esbuild、TypeScript、`eslint-plugin-obsidianmd`、vitest；构建产物自动复制到测试 vault
- [✓] **中英双语**: 字典类型约束，语言跟随 Obsidian
- [✓] **设置页**: 声明式 API + 自定义站点子页面；token 存密钥库；测试连接
- [✓] **Quartz 适配层**: slug / 网址 / 冲突检测 / 链接格式 / 站点配置读取；Quartz 实际构建验证 63 条链接
- [✓] **GitHub 客户端**: 单次提交增改删与挪动、非 fast-forward 重试、错误分类；测试 vault 实测 `requestUrl` 上传文本与二进制
- [✓] **manifest**: 结构校验、稳定序列化、与内容同一次提交
- [✓] **验收确认**: 人类验收通过

**技术调整/发现/突破**:
- **最低版本**: ~~1.11.4~~ → [✓] 1.13.0（声明式设置 API）
- **站点子页面**: ~~声明式 items + 改名时 `update()`~~ **[!] 子页面变空白、打断拼音输入** → [✓] 自定义 `SettingPage`，离开时刷新
- **链接格式**: ~~`站内路径.md`~~ → [✓] 目标 slug（避开 `%`、`#`、空格转义）
- **工具链**: npm 可选依赖 bug 会删 rolldown 原生二进制；`github-slugger` 需显式依赖；Bash 工具 `>>` 会覆盖文件（均见 known_pits）

### [✓] Phase 2: 单站发布闭环 (已完成)
**详细计划**: `.dev/plans/implemented/phase2-detailed-plan.md`  
**完成时间**: 2026-10-04 16:15 (耗时约 6 小时，含 GUI 测试)  
**技术成果**: 插件第一次能真正发布：右键完成首次发布 / 更新 / 撤稿 / 取链接 / 打开网页，内容转换与附件上传正确，Quartz 构建后网页效果经验证

- [✓] **笔记解析**: 位置取自 metadataCache 并校验原文
- [✓] **内容转换**: frontmatter 白名单、链接改写、附件链接；嵌入笔记临时纯文本
- [✓] **附件**: assets/ 下按内容去重、按 slug 判同名加后缀
- [✓] **发布服务**: 首次发布 / 更新 / 撤稿 / 状态判定，一次操作一次提交，冲突拦截
- [✓] **界面**: 右键菜单、命令面板、站点选择、首次发布位置弹窗、可读错误提示
- [✓] **验收确认**: 人类验收通过（GUI 测试由 windows-mcp 测试 agent 执行）

**技术调整/发现/突破**:
- **HTTP 缓存**: ~~直接读取分支指向~~ **[!] requestUrl 遵守 GitHub max-age=60，提交后 1 分钟内读到旧数据，误报冲突与「已是最新」** → [✓] 会变化的资源加 `Cache-Control: no-cache`
- **附件链接**: 复用 `formatLink`（原文件名写法在 relative 下失效）；非图片嵌入输出为普通链接
- **用户决定**: vault 路径维持明文；嵌入笔记临时纯文本；普通附件链接也上传
- **未覆盖**: 多站点选择与灰显（Phase 4）；ignorePatterns 提示（测试仓库无 Quartz 配置）

### [✓] Phase 3: 完整内容转换与隔离 (已完成)
**详细计划**: `.dev/plans/implemented/phase3-detailed-plan.md`  
**完成时间**: 2026-10-04 20:30 (耗时约 4 小时，含多轮 GUI 测试)  
**技术成果**: 嵌入展开、跨站链接与隔离、反向链接提醒、多篇一次提交；测试仓库可一键复位

- [✓] **多篇一次提交**: `publishBatch`（批内互链、整批冲突拒绝、共享附件），单篇接口改为封装
- [✓] **嵌入展开**: 整篇 / 标题 / 块 → `quote` callout，嵌套、防循环、排除不展开、去块标记
- [✓] **跨站链接与隔离**: 非隔离 → 他站网址；任一方隔离 → 纯文本；优先本站
- [✓] **反向链接提醒**: 发布后「一并更新」；撤稿时默认一并更新
- [✓] **手动站点说明**: 首次发布列出未发布链接（不含会输出跨站链接的）
- [✓] **验收确认**: 人类验收通过（GUI 测试由 windows-mcp 测试 agent 执行，多站选择与灰显一并通过）

**技术调整/发现/突破**:
- **连带发布**: ~~所有站点三选一~~ → [✓] 只在跟随 vault 站点提供，移到 Phase 4（用户决定）
- **同仓库多站点**: ~~允许同仓库同分支~~ **[!] 共用 manifest 互相误判** → [✓] 仓库 + 分支必须唯一（用户决定）
- **设置页保存**: ~~每次按键保存~~ **[!] 打到一半的值被存下** → [✓] 离开输入框或回车时保存
- **callout 标题**: ~~displayText 判断别名~~ **[!] `[[笔记#标题]]` 自动生成「笔记 > 标题」** → [✓] 按原文判断
