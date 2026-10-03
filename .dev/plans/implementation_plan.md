# Pressroom 实施计划

## 项目状态概览
**目标**: 免费、开源的 Obsidian 发布插件——多站点、逐篇发布、零 frontmatter、带管理面板，替换 Enveloppe  
**当前状态**: Phase 0 技术验证已验收通过；需求已按验证结论修订为 v1（`.dev/docs/requirements/v0/requirements.md`）  
**项目性质**: Obsidian 社区插件（仅桌面端），作者自用 + 开源发布  
**技术约束**: 仅 Quartz 5 + GitHub；不修改笔记与 frontmatter；站点之间不得产生可追溯关联；仓库内容必须脱敏（见 `.agents/AGENTS.md`）  
**分支架构**: 标准单仓库，主分支开发  
**下一阶段**: Phase 1 工程骨架与核心纯逻辑（待编写详细计划）

## 技术架构
- **语言**: TypeScript，esbuild 打包，基于官方 obsidian-sample-plugin 工程结构
- **生成器适配层**（`src/generator/`）: 网址 slug 规则、链接输出格式封装为接口，v1 只实现 Quartz 5，以后可接 Hugo
  - **Phase 0 调整**: slug 直接依赖 `@quartz-community/utils/path`（~~自行实现 slug~~）；链接格式按站点 `markdownLinkResolution` 适配
- **存储后端**（`src/backend/`）: GitHub Git Data API（blob → tree → commit → 更新 ref），经 Obsidian `requestUrl` 调用，一次操作一次提交
- **manifest**（`src/manifest/`）: 每站仓库内 `.pressroom/manifest.json`，仓库为唯一真相源
- **内容转换**（`src/transform/`）: 纯函数管线——frontmatter 白名单 → 嵌入展开 → 双链改写 → 附件收集
- **状态计算**（`src/state/`）: 转换结果的 git blob SHA 与仓库比对，得出 已同步 / 有修改 / 已移动 / 源已删除
- **界面**: Obsidian API（右键菜单、命令、Modal、设置页），i18n 中英文字集中在 `src/i18n/`
  - **Phase 0 调整**: 右键菜单 ~~二级子菜单~~ → 一级菜单项 + 站点选择弹窗（公开 API 无子菜单）；token 用 `secretStorage` + `SecretComponent`，`minAppVersion` 1.11.4
- **测试**: vitest 覆盖纯逻辑模块（slug、转换、状态、manifest）；GitHub 交互用一次性测试仓库做手动/半自动验证
- **架构特点**: 纯逻辑与 Obsidian/网络层分离，核心模块不依赖 `obsidian` 包，可直接单元测试

## 开发计划

### [ ] Phase 1: 工程骨架与核心纯逻辑 (未来计划)
**核心目标**: 搭工程，完成不依赖界面的核心模块并有单元测试
- 工程初始化（manifest.json `isDesktopOnly: true`、esbuild、tsconfig、vitest、lint）
- i18n 框架；设置页（站点增删、token 存 secretStorage、排除文件夹、属性白名单、双链默认值）
- ~~Quartz slug 模块~~ 封装 `@quartz-community/utils` 的 slug 适配层 + 网址冲突检测（比较站点内容目录全部文件 + aliases；Phase 0 的 30 条用例表转为测试）
- 补测：Markdown 链接尖括号写法带 `#` 锚点；`requestUrl` 运行时（二进制上传）在测试 vault 实测
- GitHub 客户端（读 tree / 读文件 / 单次多文件提交；422 非 fast-forward 时有上限重试）
- manifest 数据结构、读写与版本字段

### [ ] Phase 2: 单站发布闭环 (未来计划)
**核心目标**: 一个手动模式站点上，右键完成 发布 / 更新 / 撤稿 / 获取链接 / 打开网页
- 首次发布位置弹窗（手动模式、「按 Vault 目录」快捷填入、网址预览、冲突拦截）
- 基础转换：frontmatter 白名单、指向已发布笔记的双链改写、未发布链接 → 纯文本
- 附件上传到 `assets/`，按内容哈希去重，同名不同内容加后缀；撤稿不删附件
- 状态：已同步 / 有修改（blob SHA 比对），右键菜单显示状态标记

### [ ] Phase 3: 完整内容转换与隔离 (未来计划)
**核心目标**: 补齐需求 §7、§8
- 嵌入展开（整篇 / `#标题` / `#^块`，递归、防循环）
- 连带发布：一层 / 到底，确认清单；排除文件夹约束
- 站点隔离：指向其他站点的链接一律纯文本；不注入任何账号或仓库信息

### [ ] Phase 4: 多站点与目录模式 (未来计划)
**核心目标**: 补齐需求 §4「全部站点」、§5
- 发布 / 撤稿 / 获取链接的「全部站点」；多站首次发布的分块弹窗
- 跟随 vault 模式；模式切换（切换本身不挪动站上内容，手动 → 跟随时弹确认清单）
- 监听 vault 改名 / 移动，更新 manifest 源路径，产生「已移动」状态

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
- **secretStorage 不可用或需较新 Obsidian 版本**: token 无处安全存放 → **已确认** 1.11.4 起可用，`minAppVersion` 定为 1.11.4
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
