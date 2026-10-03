# Phase 0: 技术验证 详细计划

## 计划概述
**阶段名称**: Phase 0 - 技术验证  
**核心目标**: 把影响架构的外部事实查清、实测，形成结论文档，供 Phase 1 起直接引用  
**当前状态**: [✓] 已完成，人类验收通过（2026-10-03）；结论见 `.dev/docs/others/phase0-findings.md`  
**产出位置**: 结论写入 `.dev/docs/others/phase0-findings.md`；探索代码放 `.dev/tests/phase0/<主题>/`（允许失败、不进正式源码）

## 现状分析

### 已有基础
- [✓] **需求 v0**: 功能边界已定
- [!] **未验证前提**: 需求中以下内容是假设，尚未对照源码或实测——Quartz 5 slug 规则、链接解析方式、aliases 重定向、secretStorage 可用性

## 详细实施步骤

### Phase 0-1: Quartz 5 网址规则
#### 具体任务
- 定位 Quartz 5 源码中的 `slugifyFilePath` 及相关函数（`sluggify`、`joinSegments` 等），记录源码版本 / commit
- 整理 slug 规则表：空格、大小写、中文、全角符号、`?#<>:"|*%&`、连续 `-`、`index.md`、文件夹名、`.md` 以外的扩展名
- 每条规则配一组「输入路径 → 期望网址」，作为 Phase 1 slug 模块的测试用例
#### 验收标准
- [✓] 规则表每条都有源码出处
- [✓] 测试用例表 ≥ 20 条，覆盖上面所有类别

### Phase 0-2: Quartz 5 链接解析
#### 具体任务
- 查清 Quartz 5 `markdownLinkResolution`（shortest / relative / absolute）各自对 `[[...]]` 与 `[text](path)` 的处理
- 在本地 Quartz 5 测试站实测：站内名与 vault 名不同时，哪种输出格式能稳定指向正确页面（含中文路径、空格、`#标题` 锚点）
- 确定插件输出格式，以及是否要求用户的 Quartz 配置满足某种前提
#### 验收标准
- [✓] 结论明确：插件输出的链接格式 + 对 Quartz 配置的前提（若有）
- [✓] 锚点链接（`[[笔记#标题]]`）的输出方式已验证

### Phase 0-3: aliases 重定向（需求 §11 待定问题）
#### 具体任务
- 在本地 Quartz 5 测试站给页面加 `aliases`，构建后访问旧网址
- 确认是否需要启用某个插件（如 AliasRedirects），以及中文 alias 的表现
#### 验收标准
- [✓] 结论：可用 / 不可用 / 有条件可用，写回需求文档 §11

### Phase 0-4: Obsidian API
#### 具体任务
- 确认 `secretStorage` 的 API 形态、引入版本，据此定 `minAppVersion`
- 确认 `requestUrl` 调用 GitHub API 无 CORS 问题、能发送 PUT/PATCH/DELETE 与二进制内容（附件 base64）
- 确认 vault 改名事件（`rename`）、右键菜单（`file-menu`、`files-menu` 多选）的可用性
#### 验收标准
- [✓] 每项给出 API 名称、最低版本、官方文档或类型定义出处

### Phase 0-5: GitHub Git Data API
#### 具体任务
- 新建一次性私有测试仓库（仓库名只放本地 gitignore 的配置文件，不进代码库）
- 用 `.dev/tests/phase0/github/` 下的探索脚本走通：读分支 ref → 建 blob（文本 + 二进制）→ 基于 base tree 建新 tree（含新增、修改、删除）→ 建 commit → 更新 ref
- 验证本地算出的 git blob SHA（`blob <len>\0<content>` 的 SHA-1）与 GitHub 返回一致，含中文与 CRLF 内容
- 观察 ref 非 fast-forward 时的报错，记录重试策略
- 确认 fine-grained token 只给 Contents 读写即可完成全部操作
#### 验收标准
- [✓] 一次提交内完成多文件新增 + 修改 + 删除
- [✓] 本地 blob SHA 与 GitHub 一致
- [✓] 最小 token 权限已确认

## 技术风险评估

### 高风险项
- **Quartz 链接解析无法满足「站内名 ≠ vault 名」**: 双链改写方案需重做
  - 缓解措施: Phase 0-2 最先做；若不满足，评估输出普通 Markdown 链接或要求特定配置

### 中风险项
- **secretStorage 版本过新**: 老版本用户无法安装
  - 缓解措施: 接受较高 `minAppVersion`（v1 只需覆盖作者与较新用户），结论写入 findings

### 低风险项
- **aliases 不可用**: 只影响挪动后的旧链接，不阻塞 v1
  - 缓解措施: 挪动时提示链接会失效（需求 §5.2 已有提示文案）

## 资源需求
- **测试环境**: 本地 Quartz 5 测试站（Node.js）、一次性 GitHub 测试仓库、fine-grained token
- **依赖库**: 探索脚本用 Node 自带 `crypto` / `fetch`，不引入新依赖

## 完成标准
1. [✓] `phase0-findings.md` 覆盖 0-1 至 0-5 全部结论，每条带出处
2. [✓] 需求文档 §11 待定问题有结论
3. [✓] 若结论改变需求，按「技术调整文档更新流程」更新需求与总体计划
4. [✓] 人类验收测试通过

**注意**: 按验收流程（见 `AGENTS.md`「验收通过触发流程」/ `rules/workflow.md`），只有收到人类「验收通过」确认后，才能标记 Phase 为完成状态。
