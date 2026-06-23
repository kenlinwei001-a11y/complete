# PRD · 场景启动器 自检-自愈 LOOP（跑场景 → 断点汇聚 → 开发需求 · 有界 · 不改架构）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 后端编排（前端轻探针） |
| 性质 | 发育闭环（R16）的**首个可跑实例**：正序跑场景 → GapReport 生长信号 → **汇聚断点 → 形成开发需求**（本阶段**只跑+诊断+出需求,不自动开发**）→ 生成新卡片再跑 → 有界收敛。 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R2/R4/R6/R13/R16 · §8 G-3 · §2 GapReport/GrowthTicket）· `apps/agentcore/src/growth/loop.ts:17 runGrowthLoop` · `apps/agentcore/src/server.ts`（`/api/v1/growth/probe`:168 · `/api/v1/growth/run`:183 · `/b/v1/scenarios/:key/launch`:1888）· `apps/agentcore/src/growth/probe.ts classifyGap` · `apps/datacore/src/databuilder/comprehend.ts deriveGeneratedScripts` · `docs/PRD-demand-pulled-growth-engine.md` · `docs/PRD-system-ontogenesis-spec.md` · `docs/PRD-admin-self-approval.md` |

> 一句话：把本租户**已有场景卡片**逐张自动跑——**前后端双重判通**（后端 QOS 答得出 ∥ 前端视图渲染出数据）——跑不通即出 **GapReport**;能经 Action 审批补的就地补（admin 自审）,**其余汇聚成结构化"断点报告 + 开发需求清单"(GrowthTicket,含原因/IO契约/本体引用/建议方案),不自动写代码**;现有卡片收敛后,自动**生成 10 张新卡片**再跑;全程**有界收敛 + 不改架构 + 回写本体**。约 70% 机制已有(probe/run/loop/ticket/场景生成),新建的是**编排 loop + 前端渲染判空探针 + 断点三分路由 + 强制回写**。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2）：`Scenario/SceneEntry`(场景卡)·`QueryTask`(probe 终态)·`GapReport`(7 码 + 新 `VIEW_EMPTY`)·`GrowthTicket`(开发需求,OPEN→VERIFIED)·`GrowthLedgerEntry`(每卡跑→断点→处置)·`ActionDraft`(可补项,R4)·`ViewDef`(前端判空依据)。
- **触及链路**（§3 / §10.3 `sys.meta.ontogenesis_loop` + `sys.orch.query_to_answer`）：`场景卡 → launch(view+presetContext) → {后端 probe(主问句过 QOS) ∥ 前端 render-probe(ViewDef 数据源判空)} → classifyGap → {AUTO 补(fill-data/Action) | 汇聚→GrowthTicket(开发需求)} → 收敛 → 生成 10 卡 → 再跑`。
- **触及事件/数据流**（§4）：复用 `growth.gap_detected`/`growth.ticket_opened`/`growth.converged`;新增 loop 终态记入 GrowthLedger。
- **触及不变量**（§5）：**R16**(发育闭环:生长信号→倒序生长→回写)·**R4**(可补项经 Action,admin 自审)·**R6**(probe/classify 确定性)·**R2**(本租户隔离)·**R13**(断点/需求可溯)·**R-边界**(不改架构,见 §3.5)。
- **关闭/影响断点**（§8）：**G-3**(场景启动器 + presetContext 注入 QOS)——本 loop 把"场景能不能真跑通"变成可批量自检的闭环。
- **门禁**（§7）：`chain:check`(probe 命中真实端点)·`pnpm -r build && test`(loop 回归)·跨服务冒烟·`prd:check`·FDE 亲手跑(一轮 loop:跑卡→出断点报告→出工单)。
- **数据闭环合规**（`data-closure-spec §6`）：`// 不涉新数据闭环`（编排+诊断;补数据走既有 fill-data 单一上传口/R4）。
- **回写承诺**：loop 编排 + `VIEW_EMPTY` 码 + 前端渲染探针 + 开发需求工单 → 回写本体 §2(GapReport 码/GrowthTicket)+ §3(链路)+ §8(G-3)+ §10.3(ontogenesis 切片);**每轮产出的断点/需求/新卡片回写模块同步矩阵**。

## 1. 目标 / 非目标
### 目标
1. **批量自检**：本租户全部已有场景卡片逐张自动跑,**前后端双重判通**。
2. **断点结构化**：跑不通 → GapReport(7 码 + `VIEW_EMPTY` 前端空)+ 原因分析。
3. **可补即补**：能经 Action 审批补的(缺数据/待定稿)就地补(admin 自审,R4);记 GrowthLedger。
4. **汇聚成开发需求**：其余断点**汇聚为结构化清单 + GrowthTicket**(原因/IO 契约/本体引用骨架/建议方案/优先级),**不自动写代码**。
5. **生成新卡片再跑**：现有卡片收敛后,`deriveGeneratedScripts` 生成 **10 张**,再跑一轮。
6. **有界收敛**：K 轮上限 + 终态 CONVERGED/BOUNDARY/MAX_ROUNDS;不发散。
7. **回写本体**：每轮断点/需求/新卡片回写 SYSTEM-ONTOLOGY + 模块同步矩阵。

### 非目标（边界,硬）
- **不自动开发功能/不自动改代码**：真断点 → 出开发需求工单给人/dev,本阶段只跑+诊断+出需求。
- **不改系统/模块架构**：loop 只走现有扩展点(场景生成/数据补齐/Action/工单),**绝不重构模块**;真需改架构者 → 工单标"架构级,人工评审"。
- 不做像素级前端校验(本阶段=渲染判空,不是视觉对比;视觉留人工/后续)。

## 2. 现状与缺口
| 能力 | 现状 | 缺口 |
|---|---|---|
| 场景跑(后端) | ✅ `scenarios/:key/launch`(:1888)+ `growth/probe`(:168,QOS 实跑) | — |
| 断点分类 | ✅ `classifyGap`→GapReport 7 码 | 加 `VIEW_EMPTY`(前端空) |
| 自检 LOOP | ✅ `runGrowthLoop`(loop.ts:17,CONVERGED/BOUNDARY/MAX_ROUNDS) | 现按"问句"跑,需扩为"逐场景卡批量跑" |
| **前端渲染判空** | ❌ 无(parity-audit 是管理台真连,非业务视图判空) | **新建 render-probe**:按 ViewDef 数据源判空 |
| 可补项 | ✅ fill-data/scaffold + admin 自审(我 PRD) | 接入 loop |
| 开发需求 | ✅ GrowthTicket(IO 契约+本体引用) | 汇聚器 + 优先级 |
| 场景生成 | ✅ `deriveGeneratedScripts` | 接 loop,生成 10 张 |
| 回写本体 | ◐ 模块同步矩阵在 | loop 每轮强制回写 |

## 3. 设计
### 3.1 LOOP 状态机（编排,有界）
```
for round in 1..K:
  cards = 本租户场景卡(已有 + 本轮新生成)
  for card in cards:
    ctx = launch(card)                      # view + presetContext
    back = probe(card.mainQuery, ctx)       # 后端: QOS 答得出? → QueryTask 终态
    front = renderProbe(card.view, ctx)     # 前端: ViewDef 数据源判空?
    gap = classify(back, front)             # GapReport(7码 + VIEW_EMPTY)
    route(gap):                             # §3.3 三分
  if 全卡双通 且 无新生成: → CONVERGED
  else: 生成 10 张新卡 → 下一轮
  终态: CONVERGED / BOUNDARY(补不动) / MAX_ROUNDS(K 用尽)
```
### 3.2 双重判通（前后端都要看,§ 用户要求 c）
- **后端**：`probe` 把卡片主问句过 QOS orchestrator → 终态 ANSWERABLE/VERIFIED 才算后端通。
- **前端**：**新 `renderProbe`**——取该卡 `targetView` 的 `ViewDef`(layout/widget 的 query/solver 数据源),按 presetContext 实跑这些数据源,**全非空才算前端通**;任一空 → `VIEW_EMPTY`(防"QOS 绿但页面空"的假通过)。
- 双通才算"场景跑通";任一不通 → 出断点。
### 3.3 断点三分路由（本阶段:汇聚+需求,不自动开发）
| 类 | 断点码 | 处置（本阶段） |
|---|---|---|
| **AUTO 可补** | EMPTY_DATA / 真值待批 | fill-data(单一上传口)/ Action(admin 自审,R4)→ 就地补,记 GrowthLedger |
| **接线缺(目录已有未接)** | NO_PLAN / NO_SLICE / SHAPE_MISMATCH | 记为**需求**(轻接线,scaffold 草案附在工单,人工确认)——**不自动发布** |
| **真断点** | SOLVER_NOT_FOUND / NO_CAPABILITY / VIEW_EMPTY(结构性) | **汇聚 → GrowthTicket 开发需求**:原因分析 + IO 契约 + 本体引用骨架 + 建议方案 + 优先级;**不自动开发** |
> 关键:**没有"自动写功能代码"这一档**——与"不改架构"边界一致。
### 3.4 场景生成 + 收敛
- 现有卡处理完 → `deriveGeneratedScripts` 生成 **10 张**(映射真实对象/求解器,过质量门:能 launch + 有 targetView)→ 入下一轮。
- 收敛终态:CONVERGED(全双通)/ BOUNDARY(剩真断点补不动,已出工单)/ MAX_ROUNDS(K)。
### 3.5 护栏（你要求,硬）
1. **不改架构**：真断点只出工单,loop 不碰模块结构/不自动改代码;工单标级别(数据/接线/求解器/**架构级-人工**)。
2. **回写本体强制**：每轮 → 断点报告 + 开发需求 + 新卡片回写 `SYSTEM-ONTOLOGY.md`(R16)+ 模块同步矩阵;不回写即终态标 FAIL。
3. **有界**：K 上限 + 质量门(防无限生成垃圾卡)+ 去重(同断点不重复出工单)。
4. **R6/R2/R4**：probe/classify 确定性;本租户隔离;补真值经审批。
5. **诚实**：双通才算通;补不动诚实标 BOUNDARY + 工单,不假装收敛。
### 3.6 输出
- **断点汇聚报告**：每卡 × {后端/前端通否 · 断点码 · 原因 · 处置}。
- **开发需求清单**(GrowthTicket[]):按优先级,含原因/IO 契约/本体引用/建议方案/级别——**这就是给研发的产物**。
- GrowthLedger:每卡跑→断点→处置 的历史。

## 4. 契约 / 端点
- 新增 `POST /api/v1/scenario-selfheal/run`(编排 loop,入参 K/生成数 N=10)→ `SelfHealReport{rounds[], tickets[], ledger[], terminal}`。
- 新 `renderProbe`(AgentCore→DataCore:按 ViewDef 数据源判空)。
- `classifyGap` 加 `VIEW_EMPTY`。复用 `growth/probe`/`fill-data`/`action-drafts`/`deriveGeneratedScripts`/`scenarios/:key/launch`。
- contracts:`SelfHealReportSchema`、GapCode 加 VIEW_EMPTY。

## 5. 关键流程
逐卡 launch → 后端 probe ∥ 前端 renderProbe → classify → {AUTO 补 / 汇聚出开发需求工单} → 收敛 → 生成 10 卡 → 再跑 → 终态 + 断点报告 + 开发需求清单 + 回写本体。

## 6. 验收（DoD）
- 跑一轮:本租户全部场景卡**前后端双检**,出**断点汇聚报告 + 开发需求清单(工单)**;可补项经 admin 自审就地补。
- `VIEW_EMPTY` 能抓"QOS 绿但页面空"。
- 现有卡收敛 → **生成 10 张新卡再跑**;有界终态正确(CONVERGED/BOUNDARY/MAX_ROUNDS)。
- **无自动开发/无架构改动**:真断点全部落工单(含级别),loop 不改模块。
- 每轮**回写本体 + 模块同步矩阵**;不回写即 FAIL。
- `chain:check`/`pnpm -r build && test` 过;FDE 亲手跑一轮。
- 回写本体 §2/§3/§8/§10.3。

## 7. 分期
- **SH.1** loop 编排(逐卡 launch+probe)+ `VIEW_EMPTY` + `renderProbe`(前端判空)+ 断点汇聚报告。
- **SH.2** 三分路由(AUTO 补接 admin 自审/fill-data;真断点→GrowthTicket 开发需求)+ 去重/优先级。
- **SH.3** 场景生成 10 张 + 有界收敛 + 强制回写本体/模块同步矩阵 + 全链回归。

> 边界重申:**本阶段 loop 只跑+诊断+汇聚开发需求,不自动开发、不改架构**;真断点交人/dev,改动同步回本体。是发育闭环的安全首跑实例。
