# PRD · 需求拉动的自成长发动机（Demand-Pulled Growth Engine）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-17 |
| 取代/扩展 | **扩展** A7「数据构建发动机」(`apps/datacore/src/databuilder/`) 与 `PRD-unified-build-engine.md`；落实 `OPERATING-MODEL.md` 融合层（P5）与 `sys.meta.change_loop`（§10.3）|
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `docs/OPERATING-MODEL.md` · `docs/PRD-unified-build-engine.md` · `docs/PRD-addendum-validation-loop.md` |
| 核心一句话 | 把"**一个明确的客户问题**"当作系统进化的最小燃料：**真跑一遍 QOS** 诊断系统缺什么（数据 or 功能），**能自动补的经审批补上（走真人正门）**、不能的（真·新功能）由**厂商中立的 code agent** 按带 I/O 契约的工单施工，**循环重跑直到答得出**，并把每次"问题→缺口→补法"记入**成长账本**。需求侧（发动机）⊕ 施工侧（code agent）合成完整的需求拉动自成长闭环。|

## 0. 本体引用与影响（强制）

- **触及对象类型**（本体 §2）：BuildPlan / BuildJob / ClosureReport / DataBuilderAgent · OntologyType / SliceSpec / Rule / Solver / SyntheticJob / Connector / RawDataset · ActionType / ActionDraft · Intent / ExecutionPlan / Task / Query / ScenarioCard · **新增：GapReport（缺口报告）/ GrowthTicket（成长工单）/ GrowthLedger（成长账本）**。
- **触及链路**（§3）：编排链 `Query→Intent→Plan→Solver→render`（探针在此真跑）· 数据→本体→推演链（自动补齐写此）· 数据构建发动机链（扩为"运行时缺口闭环"）· **新增 `sys.meta.change_loop` 的自动化半边**（需求→缺口→补→重跑）。
- **触及事件/数据流**（§4）：复用 `ontology.published`/`materialize.completed`/`rules.updated`/`dataset.regenerated`/`action.executed`/`raw_dataset.uploaded`；**新增** `growth.gap_detected` / `growth.fill_proposed` / `growth.ticket_opened` / `growth.converged`（须登记 §4 + 下游订阅，遵守 R10 D-29）。
- **触及不变量**（§5）：**R11 全链闭包**（探针把"场景→答案可运行"从静态校验升级为**运行时实跑**）· **R4 真值经 Action 审批**（一切自动补齐经审批，且**就地批复**）· **R6 确定性**（同问句同 seed → 同缺口同补法字节级一致）· **R10 D-29**（产出必发事件）· **R13 结论可溯源**（补齐后答案六要素溯源）· **R3 entitlement**（`feature.growth-engine`）。
- **关闭/影响断点**（§8）：**G-8**（闭包从单系统静态 → 全链运行时实跑）· **G-1**（场景端到端可答由实跑保证，而非静态接通）。
- **需走门禁**（§7）：全链闭包门 · VLE（验证补齐对不对）· validate · 准备度 · 断链审计 · `ontology:check` · `chain:check` · `prd:check`。
- **回写承诺**：落地后回写本体 §2（GapReport/GrowthTicket/GrowthLedger 三制品）、§3（探针链路 + 自成长闭环）、§4（四个 growth 事件）、§5（R11 升为运行时实跑）、§8（G-8/G-1 状态推进）。

## 1. 目标 / 非目标

### 1.1 目标
1. **需求即燃料**：任意"明确的客户问题"（场景脚本）可作为发动机输入，一句话从对话面（CLI/QOS）提交。
2. **QOS 运行时缺口探针**：把问句**真提交给 orchestrator**，捕获它**断在哪一类**，产出结构化 **GapReport**（§5 缺口分类法）。这是与现状"静态闭包"的根本区别——查的是"真跑通没通"，不是"制品在不在"。
3. **缺口→自动补（经审批、走真人正门）**：
   - **数据维度全自动**：缺数据 → **生成 Excel → 在数据连接器对应页面自动导入 → 物化 → 持久化可见**，与真人手动用系统的路径**逐跳一致**（正门红线，§6.1）。
   - 缺切片/规则/意图/计划 → 自动 scaffold。
   - 一切**真值写入经 Action 审批**，且 admin 可在**数据构建发动机页内就地批复**（无跳转，§6.4）。
4. **缺功能：B 兜底 + C 骨架工单**：缺领域求解器 → **B**：`generic-inference` 自动兜底（保证"当下能答"，近似可溯）；**C**：同时**自动产出带 I/O 契约的求解器骨架工单**（GrowthTicket），把人/agent 的工作从"从零设计"降到"填逻辑"。
5. **厂商中立的 code-agent 施工执行器**：GrowthTicket 是**agent 中立契约**（I/O 契约 + 本体引用 + 验收门），经 **MCP/CLI 活查询面**交给任意 code agent（Claude Code 或其他厂商）→ 读本体+工单 → 写功能 → 回写本体 → 过门禁 → **人审批（R4）** → 发动机重跑。落实 OPERATING-MODEL 融合层 P5。
6. **LOOP + 收敛终态**（§8）：补完**重新提交问句**，直到 QOS 出可验证答案，或收敛到"除这 N 个已列明的功能工单外都通了"。
7. **成长账本**：每个"答不出"的问题 = 一条成长记录（问题→缺口→补法→状态），按需求索引可查；待开发 backlog **100% 需求拉动**。

### 1.2 非目标
- 自动**发明并实现**领域算法（缺功能时 B 兜底 + C 出骨架工单，**逻辑由人/agent 填、经审批**，不臆造业务算法）。
- 真值的真实世界有效性（归真数据试点 / M11 元闭环 / VLE 边界）。
- 替换 QOS / 合成器 / Action / 连接器 / 本体服务（**全部复用**，发动机只做"诊断—驱动—收敛"的编排层 + code-agent 接缝）。
- 实时流式自成长（本期批量、按问句触发）。

## 2. 现状与缺口（对照代码，确认差距真实）

**已存在（复用）**：A7 七阶段 `intake→comprehend→gap→rawin→transform→closure→publish`（`databuilder/service.ts`）· 静态闭包 `validateClosure`（`closure.ts`：反向-对象/反向-data/正向-求解器入参 + CHAIN + SHAPE）· QOS orchestrator（`apps/agentcore/src/router/orchestrator.ts`）· 合成器确定性 R6（`synthetic/service.ts`）· 连接器上传→RawDataset→物化（活数据可溯）· Action 审批 R4（`datacore/actions.ts`）· `generic-inference`（`POST /a/v1/inference/whatif`）· VLE 预言机（`PRD-addendum-validation-loop.md`）· MCP B3 · CLI `scripts/platform-cli.mjs`（人与 AI 共用对话面）。

**缺口（本次确认）**：
- BuildPlan **不含 QOS 栈**，`validateClosure` **纯静态、纯进程内、从不调用 QOS**（`contracts/databuilder.ts:145`、`closure.ts:1-2`）——**没有任何一步真把客户问题喂给 orchestrator 跑**。
- gap 阶段**只列已有制品、标复用**，不跑场景、不扫缺功能、不按运行时缺口触发数据生成（`databuilder/service.ts` gap 段）。
- 缺功能**只能标"需开发"然后停**（`PRD-unified-build-engine.md` §1.2 非目标），无 code-agent 执行器闭合。
- **无 LOOP / 无收敛终态 / 无成长账本**：七阶段是单向瀑布。
- OPERATING-MODEL 融合层 P5（CLI/QOS 统一入口 + 本体活查询面 + code agent 施工）**待建**。

## 3. 核心概念与架构

```
 客户明确问题（场景脚本）= 燃料
        │  对话面：CLI / QOS QueryDock / MCP（人与 AI 共用同一入口）
        ▼
 ┌──────────────────────── 需求拉动的自成长发动机（扩 A7）────────────────────────┐
 │ ① QOS 缺口探针 ── 真提交问句 → orchestrator 实跑 → 捕获断点 → GapReport(§5)     │
 │ ②a 自动补·数据  ── 生成 Excel → 连接器页自动导入 → 物化 → 持久化可见（真人正门）│ ── R4 就地审批
 │ ②b 自动补·结构  ── 缺切片/规则/意图/计划 → scaffold                            │ ── R4 就地审批
 │ ②c 兜底·求解器  ── 缺求解器 → generic-inference 绑定（当下能答）              │
 │ ③ 缺功能 → C    ── 产出带 I/O 契约的求解器骨架 GrowthTicket（§7）             │
 │ ④ LOOP          ── 补完重跑问句 → 收敛(§8)                                     │
 │ ⑤ 成长账本      ── 问题→缺口→补法→状态，demand-indexed（§9）                  │
 └──────────────────────────────────┬───────────────────────────────────────────┘
                                     │ GrowthTicket（厂商中立契约）经 MCP/CLI 活查询面
                                     ▼
            ┌──────── 施工执行器（code agent，厂商中立）────────┐
            │ 读本体+工单 → 写求解器/功能 → 回写本体 → 过门禁    │ ── R4：产草稿/PR，人审批
            └──────────────────────────┬────────────────────────┘
                                        └──→ 发动机重跑问句 → 现在答得出（闭环）
```

**两半一环**：发动机 = 需求侧（诊断+自动补数据/结构+兜底+出工单+收敛）；code agent = 施工侧（补功能）。合起来 = `sys.meta.change_loop` 的**需求拉动自动化**版（触发器从"人手挑 PRD"换成"客户问题"）。

## 4. 主链：从问句到收敛（端到端）

1. **提交**：人/AI 经对话面提交场景脚本（问句 + 可选 presetContext）。`feature.growth-engine` 门控（R3）。
2. **探针实跑**：发动机以**服务内 OBO** 把问句提交 QOS orchestrator（路径A 优先；分类→意图→计划→step→render）。捕获每一步的成败与失败码 → **GapReport**。
3. **诊断分类**：按 §5 把每个失败归类（数据/切片/规则/意图·计划/求解器/形状/真功能）。
4. **自动补齐（经 Action 审批，§6）**：可自动补的逐项生成补齐 Action 草稿 → admin 就地批复 → 经真人正门物化 → 发 growth/领域事件（R10）。
5. **兜底 + 出工单**：缺求解器 → 绑 generic-inference（B）+ 产出骨架 GrowthTicket（C）。真缺功能 → GrowthTicket（经 MCP/CLI 交 code agent）。
6. **重跑（LOOP）**：补齐生效后**重新提交问句** → 回到步骤 2。每轮记录进度。
7. **收敛**：达到 §8 终态即停；账本落终态。

## 5. 缺口分类法（GapReport taxonomy，法定清单）

> 探针把 orchestrator 实跑的失败映射为下列**唯一枚举**；每类有确定的补齐策略。

| 缺口码 | 触发（探针在 QOS 实跑捕获） | 补法 | 审批 |
|---|---|---|---|
| `NO_INTENT` / `NO_PLAN` | 分类无候选命中 / `PLAN_NOT_FOUND` | scaffold 意图+计划（跨系统经 B catalog） | R4 |
| `NO_SLICE` | `resolve_slice` 未注册/解析失败 | 建切片（root→hops） | R4 |
| `EMPTY_DATA` | 切片/查询返回空集（对象类型在、数据无） | **生成 Excel→连接器页导入→物化（真人正门，§6.1）** | R4 |
| `NO_RULE` | `evaluate_rules` 引用规则不存在 | 建规则（DSL） | R4 |
| `SOLVER_NOT_FOUND` | `invoke_solver` 求解器未注册 | **B**：绑 generic-inference；**C**：出骨架工单 | R4（绑定）|
| `SHAPE_MISMATCH` | 渲染绑定字段 ∉ 求解器输出形状（G-2） | 修渲染绑定 / 出工单 | R4 |
| `NO_CAPABILITY` | 问题需要本体/求解器**根本没有**的领域能力 | **GrowthTicket → code agent（§7）** | R4（上线）|

每条 GapFinding 携带：`{gapCode, atStep, evidence(实跑证据), suggestedFill, blocking(bool)}`。

## 6. 自动补齐策略（经审批、走真人正门）

### 6.1 缺数据 = 真人正门（关键决策落地）
缺数据**绝不走后门 API 直插对象**，而是**模拟真人逐跳**：
1. 发动机据 BuildPlan/切片所需字段 + 行业模板，**确定性生成 Excel**（R6，同 seed 字节级一致）。
2. 在**数据连接器对应页面**以 `file_upload` 连接器**自动导入该 Excel**（复用 `POST /a/v1/uploads` 正门）→ RawDataset/RawRow。
3. 走既有 **建模建议→发布→物化** 正门 → ObjectInstance（origin 可溯回该 Excel 行）。
4. **数据持久化、UI 可见**（数据源页见原始 Excel + 字段画像；对象库见物化对象）——与真人手动使用系统**结果一致、路径一致**。
> 正门红线（继承 VLE）：发动机只经**公开 API/页面流程**注入，不直读直写持久层；保证"自动补的数据"和"人补的数据"在系统里**没有任何区别**。

### 6.2 缺切片/规则/意图/计划 = scaffold
经本体服务/规则引擎/ B catalog 正门生成草稿制品；全链闭包门校验"补完是否接通"。

### 6.3 缺求解器 = B 兜底 + C 工单
- **B（默认，当下能答）**：把缺的 solverKey 绑到 `generic-inference`（对相关对象属性施 Δ→沿派生/链路重算→近似输出），答案标 `AGENT_EXPLORATORY`/近似 + 溯源。
- **C（产出物）**：同时按问句反推该求解器的 **I/O 契约**（输入字段、输出形状=渲染要的键），生成**求解器骨架 GrowthTicket**（含 stub 签名 + 输出 schema 声明 + 验收用例），交 §7 执行器。

### 6.4 就地审批（数据构建发动机页内，无跳转）
- 发动机的每个自动补齐 = 一条 Action 草稿（复用 `actions.ts` 审批机）。
- **数据构建发动机页**嵌入**就地审批面板**：admin 账号在**当前页**直接看到待批补齐项 + diff 预览 + **批复按钮**，批准即触发物化/发布；**无需跳转 `/admin/actions`**。
- 审批链/不得自批/审计留痕全部复用既有 S2（R4 不破）。

## 7. code-agent 施工执行器接缝（厂商中立）

### 7.1 GrowthTicket（agent 中立契约）
缺功能（`NO_CAPABILITY`）或求解器骨架（C）→ 产出 **GrowthTicket**，字段：
```
{ ticketId, fromQuestion(问句), gapCode, ioContract{ inputs[], outputShape{keys} },
  ontologyRefs{ objectTypes[], slices[], rules[] }, acceptance{ 验收用例, 门禁清单 },
  status: OPEN→IN_PROGRESS→IN_REVIEW→MERGED→VERIFIED, assignee(任意 code agent) }
```
**厂商中立**：任何能"读本体 + 读工单 + 写代码 + 过门禁"的 code agent（Claude Code 或其他）均可认领；契约不绑死单一厂商。

### 7.2 活查询面（MCP / CLI）—— 落实 OPERATING-MODEL P5
- 经 **MCP 工具** + CLI（`platform-cli.mjs` 扩 `tickets`/`ontology` 子命令）暴露：`列待施工工单`、`读本体切片/不变量`、`读某缺口的实跑证据`、`提交施工草稿`。
- **人与 AI 共用同一对话入口**：人用 CLI/QueryDock 提问与审批；code agent 用同一 MCP/CLI 面问系统、领工单、交草稿。

### 7.3 施工→上线（R4 守闸）
code agent：读本体（铁律0）→ 实现求解器/功能 → **回写本体** → 过 `ontology:check`/`chain:check`/测试/全链闭包 → 产**草稿/PR**（不直接改真值库，OPERATING-MODEL §8）→ **人审批** → 合并上线 → 发动机**重跑问句** → 工单置 `VERIFIED`。

## 8. 收敛终态（量化的关键，法定定义）

一个场景脚本 **DONE** 当且仅当：
- **① 完全收敛**：QOS 返回 `VERIFIED_WORKFLOW` 答案（全链实跑通）；或
- **② 边界收敛**：唯一剩余阻塞是**已列明的 GrowthTicket（缺功能）**——系统已自动做完它能做的一切，剩下的是人/agent 的施工边界。

LOOP 有界：单问句自动补齐轮数 ≤ **K**（默认 K=8，超出即停并报"疑似环/不收敛"）。

## 9. 成长账本（GrowthLedger）

- 每个问句一条记录：`{question, tenantId, rounds[ {gapReport, fills[], rerunResult} ], terminalState, openTickets[] }`，**按需求（问句/域/缺失制品）索引**。
- 用途：① 发现系统盲区（高频缺口=优先建）；② 量化覆盖度演进；③ 待开发 backlog **100% demand-traced**。
- 接前期已埋的「后台域/缺失切片记录」（TODO `to-do consider`），升格为一等成长账本。
- 遵 R2 tenant 隔离 + R9 仓储双实现四处同改 + R10 事件闭环。

## 10. 契约 / 端点 / 数据模型

- **新契约**（`packages/contracts`）：`GapFinding` / `GapReport` / `GrowthTicket` / `GrowthLedgerEntry` + `GrowthRunConfig{ seed, maxRounds }`。
- **新端点**（DataCore，`feature.growth-engine` 门控）：
  - `POST /a/v1/growth/run`（提交场景脚本 → 启动探针-补齐-重跑 LOOP，返回 runId + SSE）
  - `GET /a/v1/growth/runs/:id`（GapReport + 补齐进度 + 收敛态）
  - `GET /a/v1/growth/tickets` · `POST /a/v1/growth/tickets/:id/submit`（草稿）
  - `GET /a/v1/growth/ledger`（成长账本，demand-indexed）
  - 就地审批复用 `GET/POST /a/v1/actions*`（页内嵌入，§6.4）
- **探针**：发动机经服务内 OBO 调 B `POST /api/v1/queries` + 读 `GET /api/v1/queries/:id`（捕获 status/error/step 事件）。
- **MCP**：新增 growth 工具集（列工单/读本体/交草稿），注册进 B3 MCP 运行时。
- **仓储**：新表 `growth_runs` / `growth_tickets` / `growth_ledger` 四处同改（migrations + pg + memory + repo 接口，R9）。
- **事件**（§4 登记 + 下游订阅，R10）：`growth.gap_detected` / `growth.fill_proposed` / `growth.ticket_opened` / `growth.converged`。

## 11. 量化指标（发布门禁级，参照 VLE 工程验证度）

```
需求可答率      = 自动补齐后端到端可答的脚本数 ÷ 提交脚本数        （随成长单调上升 = 发动机有效的总证据）
缺口诊断查全    = 注入 n 个缺口 → 命中恰 n（漏判即红）            （目标 100%）
缺口诊断查准    = 干净脚本零误报                                   （目标 100%）
自动补齐率      = 可自动补的缺口 ÷ 全部缺口；补集 = 真实待开发边界
功能缺口闭合率  = 经 code agent 补齐并过门禁的功能缺口 ÷ 全部功能缺口
收敛步数        = "答不出"→收敛的平均 LOOP 轮数（有界 ≤K）
确定性(R6)      = 同问句+同 seed → GapReport + 补法字节级一致     （可做 gate）
账本完整性      = 每条 问题→缺口→补法 留痕、demand-indexed、零孤儿
需求拉动覆盖率  = 待开发 backlog 中源自真实问句的占比             （目标 →100%）
```
发布纪律：诊断查全/查准 100% + 确定性 gate 绿 + 账本零孤儿，方可发布发动机版本。

## 12. 验收（DoD，可证伪）

- **GE-A 诊断**：喂含已知缺口（删切片/求解器/数据）的脚本 → GapReport 分类全对、查全=查准=100%。
- **GE-B 缺数据真人正门**：删数据 → 发动机生成 Excel → **连接器页可见该 Excel + 字段画像** → 物化对象可见 → 重跑跨过该缺口（数据**持久化、可溯回 Excel 行**）。
- **GE-C 就地审批**：admin 在**数据构建发动机页内**（不跳转）批复一条补齐草稿 → 物化生效。
- **GE-D 求解器 B+C**：问一个无对应求解器的问题 → generic-inference 兜底出近似答案（B）**且**产出带 I/O 契约的骨架 GrowthTicket（C）。
- **GE-E code-agent 闭环**：一张 GrowthTicket 经 MCP/CLI 被（任意）code agent 认领 → 草稿 → 过门禁 → 人审批 → 重跑 → 工单 `VERIFIED`、问句可答。
- **GE-F 收敛**：问句从"答不出"→"出 VERIFIED 答案"在 ≤K 轮内；或边界收敛到 N 个已列明工单。
- **GE-G 账本**：成长账本可反查"哪些问题卡在哪个缺功能"。
- **GE-H 确定性**：同问句+同 seed 两次 run → GapReport + 补法逐字段一致。
- `pnpm -r build && test` 全绿 + `ontology:check` + `chain:check` + `prd:check` + VLE 验证补齐正确性；回写 SYSTEM-ONTOLOGY.md。

## 13. 非功能（§5 不变量逐条）

contracts-only-shared(R1) · tenant_id everywhere(R2) · entitlement 先于 authz(R3, `feature.growth-engine`) · **真值经 Action 审批 + 就地批复(R4)** · no-secrets-echo(R5) · **确定性 freezePlan+seed(R6)** · 错误信封(R7) · 认证(R8) · 双仓储四处同改(R9) · **D-29 产出必发事件(R10)** · **全链闭包：探针实跑即运行时 R11** · **结论可溯源(R13)** · 应用层无业务常数(R14)。**正门红线**：自动补齐只经公开 API/页面流程（继承 VLE），自动补的数据与人补的在系统里无差别。

## 14. 分期

| 期 | 范围 |
|---|---|
| P1 | **QOS 缺口探针 + GapReport**（实跑问句、结构化分类）→ 立即把"静态闭包"升级为"运行时实跑"，单独可用作 G-8/G-1 的运行时验收 |
| P2 | **缺数据真人正门自动补**（生成 Excel→连接器导入→物化→可见）+ **就地 Action 审批面板**（§6.1/§6.4）|
| P3 | 缺切片/规则/意图/计划 scaffold + 求解器 **B 兜底**（generic-inference 绑定）+ LOOP/收敛(§8) |
| P4 | **C 骨架工单 + GrowthTicket 契约 + 成长账本**（§7.1/§9）|
| P5 | **code-agent 执行器接缝**：MCP/CLI 活查询面 + 厂商中立工单领取/草稿/重跑闭环（落实 OPERATING-MODEL P5）|
| P6 | 量化指标仪表盘（§11）+ 端到端联调 + 文档回写（SYSTEM-ONTOLOGY/OPERATING-MODEL/DATA-BUILDER-PIPELINE）+ 全绿交付 |

> 每期：`pnpm -r build && test` 全绿 + `pnpm gates` + 该期回归锁；任何新链路/事件/对象类型回写系统本体。

## 15. 开放问题（OPEN_QUESTIONS）

1. **K（收敛轮数上限）** 默认 8，是否按缺口数动态？
2. **多缺口并行补 vs 串行重跑**：一轮探针出多缺口，是否一次性补齐再重跑（快）还是逐个补逐个重跑（精确归因）？倾向"一次补齐同类、跨类串行"。
3. **code agent 触发方式**：MCP 拉模式（agent 主动轮询工单）vs 推模式（`growth.ticket_opened` 事件唤起 agent 会话）——P5 决策。
4. **成长账本跨租户聚合**：盲区统计是否需平台级（元租户）视图（涉 §10.1 两级域隔离）。
