# PRD：缺口-补齐用户面收敛为单一 Console（兄弟单 B）

> 状态：草案待审 · 版本 v1 · 日期：2026-07-09 · 作者：Claude
> 关系：`docs/PRD-gap-analysis-engine.md`（统一 GapAnalysis 引擎）的**兄弟单**。主单收敛的是**后端引擎/契约**（一个 `diffGap` 纯核 + 统一 `GapAnalysis`），本单收敛的是**用户可见面**——把同一"缺口→补齐"概念散落的三处界面**并成一个 console**（不是叠数据，是并面）。依赖主单契约先落。冲突时以平台总纲为准。
> 所有引用符号已核对真实存在，附 `file:line`。

---

## §0 本体引用与影响（铁律 0 · 门 `prd:check` 机器解析）

**触及对象类型（母体 §2）**：`GapAnalysis`（§2 · `databuilder.ts`）· `GapReport`（§2.H）· `WorklistItem`/`GrowthTicket`/`TicketBoardRow`/`TicketDetail`（§2.H · `growth.ts:224/176/271/323`）· `ClosureReport`/`StoryBuildRun`（§2 · `databuilder.ts`/`storybuildrun.ts`）。
**触及链路（母体 §3）**：编排链答案侧缺口卡（GapCard）· 倒序建域缺口（DataBuilder ClosureReport）· 统一工单 board（TicketBoardRow union WorklistItem+GrowthTicket）。
**不变量**：**R17 决策单页**（本单第一性锚点·一页看全 数据→推演→溯源→动作→AI·就地下钻不跳页）· R14（配置驱动·零业务常数·换租户换配置）· R-QUANT（视觉给精确值）· R-PRD（页面级附逐元素 PRD）· R4（补齐经 Action 审批·就地批复）· R2（tenant）· R13（溯源只读投影不造新真值）· RL2（暗发退役范式·tombstone 302 承接）。
**断点（母体 §8）**：G-1（全链闭合）· G-4（意图执行计划入口）。
**回写母体**：本单**不新增**对象类型/事件（复用既有 `TicketBoardRow`/`TicketDetail`/`GapAnalysis`）；落地时在 §2.H 更新 `TicketCenterPage` 承接范围描述、§3 补"三面收敛为单 console"关系措辞；退役旧面走既有 GROWTH-TICKET-MERGE 范式（tombstone 非静默删）。草案阶段仅本 §0 引用既有 R/G。

---

## §1 问题：一个概念，三处界面

"缺口→补齐"这**同一件事**,在系统里有三处**各自为政**的用户可见面：

| 面 | 位置 | 目标 | 模型/交互 |
|---|---|---|---|
| **GapCard**（对话内） | `components/Answer/GapCard.tsx` | query 目标·即时 | 单 finding + 三闸(CLARIFY/PREVIEW/HARD_BLOCK) + 触发补 |
| **TicketCenterPage**（管理台） | `pages/admin/TicketCenterPage.tsx` | query 目标·归集 | 统一 board(`TicketBoardRow`=WorklistItem∪GrowthTicket) + 诊断入口 + 指标头条 |
| **DataBuilderPage**（构建台） | `pages/admin/DataBuilderPage.tsx` | script 目标·建域 | 区6 全链闭包 BOUND/MISSING(`ClosureReport`) + 待审批补齐(就地批复) + 区5 模块同步矩阵 |

**已做的收敛（本单在其上继续，不重复）**：
- `TicketBoardRow`/`TicketDetail` 统一投影（`growth.ts:271/323`），`boardRowFromWorklist`/`boardRowFromTicket`（`server.ts:572/579`），端点 `GET /api/v1/growth/board` + `/tickets/:id/detail`（`server.ts:592/607`）。
- GROWTH-TICKET-MERGE：`GrowthCockpitPage` 已并入 `TicketCenterPage`，`/admin/growth` → 302 `/admin/tickets`（tombstone 承接·母体 §2.H）。

**仍散的**：query 目标(TicketCenter) 与 script 目标(DataBuilder 区6/待审批) 与对话内(GapCard) 是**三套面**，概念重叠(闭包/缺口/审批/补齐)却各画各的。主单把它们背后的**引擎**统一了(diffGap+GapAnalysis)，本单把**面**统一。

> 诚实边界：主单是"内核收敛 + 加一层咨询叠加(pre-analysis)"，用户可见入口没变少甚至 +1(全景条)。本单才是真正"减面"。

---

## §2 设计目标

| 目标 | 描述 | 优先级 |
|---|---|---|
| B1 单 Console | TicketCenter 升为唯一"缺口-补齐 Console"，吸收 DataBuilder 的 script-目标闭包/审批面为一个 `source` 透镜 | P0 |
| B2 R17 一页看全 | Console 内一页看全 缺什么(数据)→怎么补(动作)→为什么(溯源)→就地批(动作)，不跳页 | P0 |
| B3 GapCard 瘦身为入口 | 对话内 GapCard 保留为**上下文入口**，深链进 Console(不在对话里复制整个 console) | P1 |
| B4 additive 退役 | 旧面按既有 GROWTH-TICKET-MERGE 范式退役(tombstone 302 + 能力承接)，不静默删、不丢功能 | P1 |

**非目标**：不改后端引擎(主单已做)；不改 classify/求解器(兄弟单 A)；不新造 board/detail 契约(复用既有)。

---

## §3 方案：TicketBoardRow 增一个 `source` 维度，吸收 script 目标

`TicketBoardRow` 现为 `WORKLIST|GROWTH_TICKET` union。**additive 扩一个来源**——把 DataBuilder 的 script-目标缺口(ClosureReport 的 MISSING 段 + 待审批补齐 draft)也投影成同一 board 行：

```typescript
// 现有 TicketBoardRow.source: "WORKLIST" | "GROWTH_TICKET"（growth.ts:271）
// 扩一枚(向后兼容·kind 已是开放 z.string())：
//   "BUILD_CLOSURE"  —— 来自 StoryBuildRun.ClosureReport 的 forwardMissing/dataOrphans 等 MISSING 段
// 新投影器（DataCore→AgentCore 或前端聚合·R13 只读投影不造新真值）：
//   boardRowFromClosure(run: StoryBuildRun): TicketBoardRow[]
```

- Console 顶部 **source 透镜切换**（全部 / query 目标 / script 目标 / 对话缺口），默认"全部"——**一页看全所有来源的缺口-补齐**(R17)。
- 详情 `TicketDetail` 已含 `supply`(fillPlan/requires/boundary/dataRequest/ioContract/ontologyRefs/acceptance)——script 目标行的详情复用同结构，补 `closure` 段(全链闭包逐段 BOUND/MISSING)。
- **就地批复**：DataBuilder 的"待审批补齐"(`db-approvals` 就地 R4 批复·`DataBuilderPage.tsx:28`)整合进 Console 详情抽屉——不跳 `/admin/actions`(R17 就地下钻)。

---

## §4 前端逐元素（R-QUANT + R-PRD · 融合既有 Console 不新造）

> 页面级改动，落地时附完整逐元素 PRD;此处给锚点与量化骨架。

### 4.1 TicketCenterPage → 缺口-补齐 Console（扩既有页，不新页）
- **source 透镜**：Tab 组复用既有 `.badge`(radius 999px·padding 4px 10px·12px·mono·`global.css:117`)；当前项 `badge blue`(`--accent #5B7CFA`)、其余默认灰。
- **指标头条**(已有 answerRate/fillRate/待认领/我的在办)additive 增 script 目标：闭包通过率、待审批数。
- **board 行** additive `source` 徽章：`WORKLIST`→蓝 / `GROWTH_TICKET`→琥珀 / `BUILD_CLOSURE`→(复用 `--warn`)——**仅用既有 token·零新色**(CSS 门 `check-css-vars`)。
- **详情抽屉**：复用既有侧滑抽屉，script 目标行加"全链闭包逐段"块(CHAIN/SHAPE/OBJECT/DATA/FORWARD·复用 DataBuilder 区6 组件·`DataBuilderPage.tsx:222`)+ 就地批复按钮(复用 `db-approve`/`db-reject` 交互)。

### 4.2 GapCard 瘦身(B3·呼应主单 §7 融合式)
- 主单 §7 已让 GapCard 顶部叠只读全景条 + 深链 `/admin/tickets?taskId=`。本单进一步：GapCard 保持"对话内诊断 + 即时触发(既有三闸)"，**不在对话里复制 Console**；"看全景/系统性补齐"一律深链进 Console(R17 单页在 Console 侧)。

### 4.3 DataBuilderPage 退役范式(B4)
- 建域**编辑/运行**能力(故事脚本/comprehend/模块同步矩阵)**保留**在 DataBuilderPage(那是构建工作台，非缺口面)；只把其中**缺口-补齐/闭包/待审批**面收进 Console。
- 若某子面完全被 Console 承接 → 走既有 GROWTH-TICKET-MERGE 范式：tombstone 深链 302 + 能力承接测试(`f63.growth-ticket-merge.test.tsx` 同款)，**不静默删**(RL2/RL9)。

---

## §5 实施计划(约 4 周·2 Phase·依赖主单契约)

- **Phase B0 · 前置**：主单 `GapAnalysis`/`PreAnalysisReport` 契约落地(依赖)。
- **Phase B1 · board 吸收 script 目标(2 周)**：`boardRowFromClosure` 投影 + `TicketBoardRow.source += BUILD_CLOSURE`(additive) + `/growth/board` 支持 source 过滤;Console source 透镜 + 详情闭包段。真实测试:一次建域的 ClosureReport MISSING 段出现在 Console board,详情逐值对 `GET /tickets/:id/detail`。
- **Phase B2 · 就地批复整合 + 旧面退役(2 周)**：DataBuilder 待审批补齐整合进 Console 详情就地 R4 批复;被完全承接的子面按范式 tombstone;逐元素 PRD 过审(R-PRD)。

---

## §6 风险与回滚
| 风险 | 缓解 |
|---|---|
| Console 吸太多变巨页(反 R17) | source 透镜默认聚焦、就地下钻;不把 DataBuilder 建域编辑塞进来(只收缺口面) |
| script 目标投影造新真值 | `boardRowFromClosure` 纯只读投影(R13),源仍是 StoryBuildRun/ClosureReport |
| 退役旧面丢功能 | 走既有 GROWTH-TICKET-MERGE 范式:承接测试 + tombstone 302,不静默删(RL2/RL9) |
| 新色/内联业务文案 | 仅用既有 token + i18n(R14/R-QUANT/CSS 门) |

**回滚**：`source=BUILD_CLOSURE` 透镜为 additive,关闭即回到现状 query 目标 board;DataBuilder 各面未删(承接前保留),可随时回退。

## 附录 · 关键文件索引(均已核对存在)
`components/Answer/GapCard.tsx`·`pages/admin/TicketCenterPage.tsx`·`pages/admin/DataBuilderPage.tsx:28/222`(待审批/区6 闭包)·`contracts/growth.ts:271/323`(TicketBoardRow/TicketDetail)·`agentcore/src/server.ts:572/579/592/607`(投影器/board/detail 端点)·`contracts/databuilder.ts`(ClosureReport)·`styles/tokens.css`+`global.css:117`(token/badge)·母体 §5 R17 决策单页。
