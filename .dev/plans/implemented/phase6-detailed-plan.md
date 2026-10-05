# Phase 6: 体验收尾与发布准备 详细计划

## 计划概述
**阶段名称**: Phase 6 - 体验收尾与发布准备（原「迁移与发布」）  
**核心目标**: 网址显示中文、站点读取提速、中英文 README、发布流程与社区审核材料就绪  
**当前状态**: 6-1 ~ 6-4 已完成（单元测试 402 项、build、lint 通过）；待用户审阅 README 与发布清单；2026-10-05 人类验收通过；6-5 中撤销测试 token 待用户发布后执行  
**依据**: `.agents/notes/deferred.md`（网址显示中文、站点读取提速、README 两项说明）；需求 v1 §9（隐私说明）；Obsidian 社区插件提交要求  
**范围调整（2026-10-05 用户决定）**:
- ~~「导入已有内容」（从 Enveloppe 迁移）~~ → 不在插件中做，用户在另一边自行迁移
- ~~接入作者自己的站点~~ → 用户自行在本机设置，不进仓库
- 发布：插件侧只做到「准备好」——发布流程、版本号、审核材料；**建 GitHub 仓库、推送、打 tag、向 obsidian-releases 提交 PR 由用户操作**（对外公开的动作）

## 详细实施步骤

### Phase 6-1: 网址显示中文
#### 具体任务
- `core/generator/quartz.ts` 新增 `displayUrl(url)`：对 `urlOf` 的结果做安全的 `decodeURI`（解码失败时原样返回）
- 显示处改用解码后的形式：位置弹窗网址预览、发布 / 更新 / 移动成功提示、「已复制链接」提示、撤稿确认框中的网址、管理面板
- **复制到剪贴板与打开网页仍用编码形式**（中文网址在部分聊天软件中会断开；deferred 中待定项按此处理）
#### 验收标准
- [✓] 单元测试：中文、ASCII、slug 不含 `%25`、非法序列回退（`slug.test.ts`）
- [✓] GUI：用户实测中文网址显示正常

### Phase 6-2: 站点读取提速
#### 具体任务
- 先测量：右键「发布…」从点击到站点列表出现的耗时（首次 / 缓存命中），记录基线
- 右键操作只读取可用站点的快照（现状）；跨站查询改为**按需**：只有本篇存在「本站未发布」的链接时才读取其他站点
- 快照缓存：右键状态显示的缓存时长由 30 秒放宽（如 5 分钟）；本插件的任何提交、改名写回后立即失效；发布 / 撤稿本身仍在 commit 回调中基于最新 head 计算（不受缓存影响）
- 管理面板：选项卡切换已缓存；刷新按钮强制重读
- 再测量并记录结果
#### 验收标准
- [~] ~~单元测试：跨站按需读取的判定~~ 实测后改方案，见调整记录
- [✓] 实测：读取一个站点快照约 1.0–1.2 秒（ref / commit / tree / blob 四次串行请求，各约 250 ms；`.dev/tests/phase6/snapshot-timing.mjs`）

### Phase 6-3: README（中英双语）
#### 具体任务
- `README.md`（英文，社区插件市场展示）与 `README.zh.md`（中文），内容一致、互相链接
- 章节：简介与定位；前提（Quartz 5 站点、GitHub 仓库、fine-grained token 只给 Contents 读写）；安装；设置（全局 / 站点 / 两种目录模式 / 隔离）；日常使用（右键四个操作、全部站点、状态含义、首次发布、连带发布、反向链接提醒）；改名与移动（aliases 跳转、依赖 AliasRedirects）；管理面板与批量按钮；多选；**隐私与限制**（站点仓库建议私有：manifest 中 vault 路径为明文；同一仓库同一分支只能配一个站点；仅桌面端；仅 Quartz 5 + GitHub）；开发说明
- 示例一律脱敏（站点 A / B、`https://example.pages.dev`）
#### 验收标准
- [✓] 用户审阅通过

### Phase 6-4: 发布准备
#### 具体任务
- 版本号：`manifest.json` / `package.json` / `versions.json` 统一为首个公开版本（拟 `1.0.0`，见讨论项）
- `.github/workflows/release.yml`：推送版本 tag 时 `npm ci` → `npm run build` → 创建 GitHub Release，附 `main.js`、`manifest.json`、`styles.css`（草稿状态，由用户检查后发布）
- 对照 Obsidian 社区插件提交要求自查并记录：manifest 字段（id 不含 obsidian、description 句式、author / authorUrl、isDesktopOnly）、LICENSE、无 `innerHTML` 与 `console.log`、样式不硬编码颜色、命令不设默认快捷键、网络请求只走 `requestUrl`、不收集数据；`eslint-plugin-obsidianmd` 全部通过
- 写好提交到 `obsidianmd/obsidian-releases` 的 `community-plugins.json` 条目与 PR 说明草稿，放在 `.dev/docs/others/release-checklist.md`，附用户操作步骤（建仓库、推送、打 tag、检查草稿 Release、提交 PR）
#### 验收标准
- [✓] 自查清单全部通过（`.dev/docs/others/release-checklist.md`）；lint / test / build 本地通过；锁文件含 Linux 原生包
- [✓] 用户审阅发布清单

### Phase 6-5: 收尾
#### 具体任务
- 用户撤销测试仓库的 fine-grained token，清空密钥库与 `.env.local` 中的值（deferred）
- 清理 deferred 中已完成的条目；更新需求（导入移出范围）、总体计划
#### 验收标准
- [✓] deferred 清理完毕（只留撤销测试 token）

## 实施调整记录（2026-10-05）

- **6-2 改方案**：~~跨站按需读取~~ —— 实测与代码核对后发现无收益：右键时为显示各站状态本就读取全部站点快照，跨站查询复用这些缓存。实际浪费在于：缓存 30 秒过期太快；选定站点后发布 / 撤稿又强制重读一次该站（约 1 秒），而真正的写入本就在 commit 回调中按最新 head 重算。改为：缓存放宽到 5 分钟（本插件写入、记录改名后仍立即失效）；单站发布 / 撤稿复用缓存快照。代价：其他设备的改动在本机最多延迟 5 分钟显示
- **设置页标题**：「通用 / General」→「发布 / Publishing」（社区插件指南不建议顶层「General」标题）
- **全仓脱敏扫描**：测试仓库名、token 为 0；本机用户名与 OneDrive 路径出现在开发文档中，列入发布清单待用户决定

## 需要讨论（开工前请确认）

> **2026-10-05 用户确认**：版本 `1.0.0`；Release 为草稿

1. **首个公开版本号**：拟 `1.0.0`（功能已完整、经过多轮 GUI 测试）；也可用 `0.9.0` 表示公测
2. **Release workflow 是否直接发布**：拟创建**草稿** Release，由用户检查附件后手动点发布

## 技术风险评估
- **网址解码后的显示与实际不一致**：只改显示，复制与打开仍用编码形式，单元测试覆盖解码失败回退
- **放宽缓存导致状态陈旧**：本插件的写操作后立即失效；其他设备的改动最多延迟到缓存过期，且发布动作本身总按最新 head 计算，不会写错

## 需要用户做的
1. 确认讨论项
2. 审阅 README 与发布清单
3. 建 GitHub 仓库、推送、打 tag、提交社区 PR；测试结束后撤销测试 token

## 完成标准
1. [✓] `npm run build`、`npm run lint`、`npm test` 全部通过
2. [✓] 6-1 至 6-5 各验收项达成
3. [✓] 人类验收测试通过

**注意**: 按验收流程（见 `AGENTS.md`「验收通过触发流程」/ `rules/workflow.md`），只有收到人类「验收通过」确认后，才能标记 Phase 为完成状态。
