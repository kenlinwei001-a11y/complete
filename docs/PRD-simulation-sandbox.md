# PRD — 通用推演沙盘（任意行业 · 多租户 · 前端可配置 · 全栈改造）

> 状态：定稿设计，供其他 agent 遵循开发。**不分 A/B 侧**，按全栈链路组织。命名用平台自有术语（沙盘/仿真/传导），不用外部产品名。
> 一句话目标：把我方散落的仿真积木（模拟时钟 / what-if / 派生 / 时序求解器 / 动作 / 就绪闭包）**整合成一个有状态、可交互、可回滚、可分支的「推演沙盘」**——**跑在任意租户已发布的本体上（去行业锁死 R14），前端从配置渲染（不为锂电定制）**，全栈联动（数据管道→世界态→传导引擎→沙盘会话→AI 指挥台→可配前端）。
> 配套 UI 原型：`sandbox-mockup.html`（锂电只是**一次配置渲染**示例；同一沙盘可渲染银行反欺诈图 / 电网调度图）。

---

## 0. 问题与定位（对照参考产品的"推演沙盘"能力缺口）

我方现状（代码核实）：**积木齐全，缺整合层**——
- 模拟时钟 `SimulationClock.tick("1d"|"7d")`（`simclock.ts:80`）能推进时间，但服务时序数据/调度，非交互世界态。
- what-if `generic_inference`（`recompute(dryRun+apply)`，`/a/v1/inference/whatif`）单步套假设值重算派生，非多步时序。
- `risk_timeline`/`counterfactual_timeline` 是**求解器单发曲线**，非沿真实 link 图逐 tick 传导。
- 前端 `views/sim/`：`ProjectSimView`+`PropagationTimeline`(传导时间轴,但 risk_timeline 喂的固定 4 段)+`RadarChart`(五维雷达)+`PmDag`——**视觉组件已有，缺背后的交互式沙盘会话状态机**。
- 就绪：A10 `verifyBuild`/A18 相位/`GapReport` ≈ Trial Tick/认证，但未产品化为 L0-L4 + 雷达 + 逐实体准备度。

**缺口（要补的整层）**：① 统一交互式沙盘会话 ② 时序风险传导（系数+延迟，沿本体 link）③ 沙盘态 checkpoint/回滚/场景分支/KPI 对比 ④ 仿真就绪认证（L0-L4+Trial Tick+雷达）。**且必须行业无关、前端可配。**

---

## 1. 北极星（用户视角完成定义）

1. **任意行业开箱即用**：任一租户发布本体（供应链/银行风控/电网/医疗…）后，**无需写代码**即可对其对象图开沙盘——载世界基准+范围 → 逐 tick 推进 → 状态沿本体 link 传导 → 自然语言干预 → checkpoint/分支 → 多时间线 KPI 对比。锂电是其中一个租户的配置，**非内置**。
2. **前端可配置**：沙盘视图从 `SandboxViewConfig`（声明式）渲染——哪些对象类型作节点、哪些 link 作边、哪个状态变量给节点着色、哪些动作进指挥台、哪些指标作 KPI——**租户/行业各自配置，零写死**（复用我方 `ViewConfig`/`DASH_LAYOUT` 范式）。
3. **全栈联动**：数据管道（含实时流）→ 本体世界态 → 传导引擎 → 沙盘会话 → AI 指挥台 → 可配前端，端到端打通，事件驱动实时刷新。
4. **确定性可信**：同世界基准+同范围+同操作序列 = 字节一致（R6 确定性仿真）；沙盘态可变但**写真值仍经 R4 审批**；每 tick 变动可溯源（R13）。
5. **不在本次范围**（诚实边界）：连续微分方程级物理仿真；非本体可表达的外部黑盒模型；实时多人协同编辑（仅多租户隔离，不做 OT/CRDT）。

---

## 2. 全栈架构总览（改造即"把积木串成竖切")

```
┌── 数据管道（DataCore，改造+新增）────────────────────────────────────────┐
│ 连接器(文件/同步/【新】WebSocket 实时流) → RawDataset → 物化 ObjectInstance/Link │
│   → 派生引擎(瞬时) ⊕【新】传导派生(系数+延迟,沿 link 逐 tick)               │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ 世界态快照（任意租户本体图）
┌── 推演沙盘引擎（DataCore,【新】/a/v1/sim/*）──────────────────────────────┐
│ SimSession(世界基准+范围+状态) ── tick ──> 传导引擎 ⊕ 沙盘态Action ──> 状态更新 │
│   ├ checkpoint / rollback / branch(多时间线)                              │
│   ├ 仿真就绪认证(L0-L4 + Trial Tick + Health/Trust雷达,从本体算)            │
│   └ 目标-冲突-多场景KPI对比                                                │
└──────────────┬──────────────────────────────────────┬────────────────┘
        OBO    │ /a/v1/sim/*（service token / 用户JWT）  │ 领域事件 sim.*
┌── AI 推演指挥台（AgentCore,QOS 接入）──┐      ┌── 可配前端（frontend-shell）──────┐
│ 自然语言 → classify → 沙盘技能(MCP工具) │      │ SandboxViewConfig 驱动:            │
│   sim.act/sim.tick/sim.branch/sim.goal │ SSE  │ 拓扑图(节点色/传导动画)+时间轴scrubber │
│ → 工具结果卡片 + 审计 + 变动原因解析    │─────▶│ +就绪认证面板(复用RadarChart)+指挥台  │
└────────────────────────────────────┘      └──────────────────────────────────┘
```

---

## 3. 后端设计（DataCore，全部行业无关）

### 3.1 `SimSession`（沙盘会话 · 新一等对象）
```ts
SimSession {
  id, tenantId, name,
  baseTime: string,                 // 世界基准（实时快照 / 历史 asOfEpoch）
  scope: { rootTypes: string[], linkTypes: string[], filters: Record<string,unknown>,
           expandDepth: number, maxPerType: number },  // 范围裁剪（行业无关，按本体类型）
  worldState: Record<objId, Record<stateVar, value>>,  // 当前世界态（沿本体）
  tick: number, timelineId: string, parentCheckpointId?: string,
  certification: { level: "L0".."L4", trialTick: TrialTickReport, radars: {...}, score3: {struct,knowledge,behavior} },
  status: "DRAFT"|"CERTIFIED"|"RUNNING"|"PAUSED",
}
```
端点（行业无关，按本体类型操作）：
- `POST /a/v1/sim/sessions`（init：基准时间+范围+范围预检→世界完整度）
- `POST /a/v1/sim/sessions/:id/tick`（推进 N tick，复用 `simclock` 推进 + 传导引擎）
- `POST /a/v1/sim/sessions/:id/act`（沙盘态动作，§3.3）
- `POST /a/v1/sim/sessions/:id/checkpoint` · `…/rollback` · `…/branch`
- `POST /a/v1/sim/sessions/:id/goals`（目标+冲突，§3.6）· `GET …/compare?branches=`（多时间线 KPI）
- `GET /a/v1/sim/sessions/:id/world`（当前态，供前端渲染）
- 事件：`sim.session_created/ticked/acted/branched/goal_evaluated`（outbox，前端 SSE 实时刷新，D-29）

### 3.2 时序传导引擎（`PropagationRule`，派生引擎扩展，**行业无关**）
- 现状：派生 `DerivationSpec` 瞬时重算。**新增"传导型派生"**：沿指定 `linkType` 按 `coefficient` + `delayTicks` 逐 tick 传播状态变量。
- **配置化（R14，接「规则即引用」PRD）**：系数/延迟/目标状态变量是 `rule.params`（可编辑）——改规则即改传导，无需改代码。
  ```
  PropagationRule { sourceStateVar, viaLinkType, direction, targetStateVar,
                    coefficient(param), delayTicks(param), combine: "max"|"sum"|"last" }
  // 例(锂电租户配): supplier.delay_risk --SUPPLIES,0.85,delay0--> factory.supply_risk
  //                 factory.supply_risk --FULFILLS,0.70,delay1--> order.fulfill_risk
  // 例(银行租户配): account.fraud_score --TRANSFERS,0.6,delay1--> account.fraud_score (环检测)
  ```
- 引擎 `propagate(session, ticks)`：拓扑序 + 延迟队列，确定性（R6 同输入同输出）；环用 `combine` + 阻尼收敛。落 `ontology-core.ts` 派生引擎旁路。
- **关键：传导沿"租户自己的本体 link"**，不认识"基地/订单"，只认识"类型+link+状态变量"——行业无关。

### 3.3 沙盘态 Action（双态，**复用既有 ActionType**）
- 现有 `ActionType/ActionDraft` 是 R4 审批写**真值**。**新增"沙盘模拟态"**：同一 ActionType 在 SimSession 内执行 → 只改 `session.worldState`（可变、不提交、可回滚），不写真值、不进 R4。
- 动作定义不变（行业无关，租户自定义：断供/调产能 ↔ 冻结账户/降额）；执行路径分叉：`sandbox=true` → mutate session；`sandbox=false` → 现有 R4 草稿。
- **沙盘结论可一键"采纳→真值"**：把模拟动作序列转成 R4 ActionDraft 走审批（R4 不破）。

### 3.4 Checkpoint / Rollback / Branch（多时间线）
- `checkpoint`：存 `session.worldState + tick` 快照（复用 temporal `asOfEpoch` 机制 + 建域 checkpoint 范式）。
- `rollback`：恢复到 checkpoint。`branch`：从 checkpoint 派生新 `timelineId`，独立推进 → 多时间线并存 → `compare` 跨线对齐 KPI。

### 3.5 仿真就绪认证（L0-L4 + Trial Tick + 雷达，**从本体算，行业无关**）
- 把 A10/A18/闭包升级为产品化认证：
  - **三件套门**：本体须有 ①派生/传导规则 ②可执行动作 ③图谱查询/状态变量 → 缺则不可进入推演（对应参考产品"三件套齐"）。
  - **L0-L4**：Invalid→Configured→Runnable→Verified(Trial Tick 通过)→Certified(Fanout 安全/Writeback 完整/Observability 达标)。
  - **Trial Tick**：空跑 1 tick 触发规则验证"真能跑"（复用 `verifyBuild` 思路，但针对沙盘）。
  - **Health/Trust 雷达 + 结构/知识/行为三维评分 + 逐实体准备度**：纯函数从本体算（规则覆盖率/状态变量激活率/Fanout/可观测…），确定性 R6。
- 端点 `GET /a/v1/sim/sessions/:id/certification`（或本体级 `GET /a/v1/ontology/:pkg/sim-readiness`）。

### 3.6 数据管道改造（接入→世界态）
- **新增 WebSocket 实时连接器**（`connectors/registry.ts` 加 `websocket` 类）：实时流注入 RawDataset/对象态 → 沙盘"实时跟进世界演进"。
- **物化→世界态快照**：SimSession init 时把租户已发布本体的对象图按 scope 裁剪成 `worldState`（行业无关投影）。
- **目标-冲突引擎**：复用 `Metric`/`PlanTarget` —— 设整体/单项目标 → 评估达成 → 检测冲突（如"订单风险清零"与"现金垫≥X"互斥）。

---

## 4. 前端设计（**可配置，去行业锁死**）

### 4.1 `SandboxViewConfig`（声明式驱动，**核心抽象**）
前端沙盘**不写死任何实体**，从配置渲染（复用 `ViewConfig`/`DASH_LAYOUT` 范式，租户级下发）：
```ts
SandboxViewConfig {
  nodes:  { objectType: string, labelField, colorByStateVar, shape }[],  // 哪些类型作节点、按哪个状态变量着色
  edges:  { linkType: string, label, animateStateVar }[],               // 哪些 link 作边、按哪个状态变量做传导动画
  riskBands: { low: number, high: number, colors: [g,a,r] },            // 风险分级阈值（配置）
  commands: { actionType: string, label, params }[],                    // 指挥台可用动作（= 租户 ActionType）
  kpis:   { metricKey: string, label, unit }[],                         // 底部 KPI（= 租户 Metric）
  timeline: { unit: "1d"|"7d"|"tick", horizon: number },
}
```
- 锂电租户配 `nodes=[{Supplier,colorBy:delay_risk},{Base,colorBy:supply_risk},{Order,colorBy:fulfill_risk}]`；银行租户配 `nodes=[{Account,colorBy:fraud_score}]`——**同一前端组件，不同配置**。
- 配置来源：`GET /a/v1/sim/view-config`（按租户/本体，admin 可在"沙盘配置"页编辑——前端可配兑现）。

### 4.2 沙盘主视图（**改造 `ProjectSimView`，复用现有组件**）
- 三栏（见 `sandbox-mockup.html`）：左拓扑图（节点色+传导动画，新增 `SandboxGraph` 或扩 `OntologyGraphView`）+ 中下时间轴 scrubber + tick 控制 + KPI（复用 `useLiveSolver` 范式）+ 右 AI 指挥台。
- **复用**：`RadarChart`（就绪认证 Health/Trust 雷达，改喂就绪维度而非五维经营）；`PropagationTimeline`（从"risk_timeline 4 段"进化为"沙盘 tick 轴"）；`PmDag`（传导链下钻）。

### 4.3 配套面板
- **初始化向导**（3 步：世界基准时间→推演范围→范围预检/世界完整度）。
- **就绪认证面板**（L0-L4 阶梯 + Trial Tick + 三维评分 + 雷达 + 逐实体 75/100 待补全）。
- **AI 指挥台**（接 QOS：自然语言→沙盘技能 MCP 工具→工具结果卡片→审计/变动原因；复用对话坞）。

### 4.4 UI 原型
`sandbox-mockup.html`（已渲染）= 一次"锂电租户配置"的渲染；**换配置即换行业**。原型可经我方"原型导入正门"（`prototype_html` 连接器）反推为前端 schema。

---

## 5. 前后端联动（数据流 + 事件 + SSE）

```
前端沙盘 ──GET /a/v1/sim/view-config──> 拿配置渲染骨架
       ──POST /a/v1/sim/sessions(init)──> worldState + 范围预检 → 渲染拓扑
用户 NL 指令 ──> AgentCore QOS classify ──> 沙盘技能(MCP: sim.act/sim.tick/sim.branch/sim.goal)
       ──OBO /a/v1/sim/sessions/:id/{act,tick,...}──> 引擎改 worldState ⊕ 传导
       ──事件 sim.ticked/acted/branched(outbox)──SSE──> 前端实时刷新节点色/传导动画/KPI/时间轴
就绪认证 ──GET …/certification──> L0-L4/雷达/三维 面板
多场景 ──GET …/compare?branches=──> 跨时间线 KPI 对比表
采纳 ──> 模拟动作序列转 R4 ActionDraft ──> 审批写真值
```
- **AI 指挥台 = QOS 复用**：沙盘技能注册为 MCP 工具（`sim.*`），path A 工作流/path B agent 均可调；与现有对话坞同管线（不另起炉灶）。

---

## 6. 多租户 / 多行业抽象（**贯穿，去锂电定制**）

| 维度 | 抽象方式（行业无关） | 锂电是其中一例 |
|---|---|---|
| 世界对象 | 租户已发布本体的对象类型/link（任意） | Supplier/Base/Order/Material |
| 状态变量 | 对象属性 + 派生状态变量（任意） | delay_risk/supply_risk/fulfill_risk |
| 传导 | `PropagationRule`(沿任意 link，系数/延迟=可编辑 param) | SUPPLIES 0.85 / FULFILLS 0.70 delay1 |
| 动作 | 租户 ActionType（沙盘态执行） | 断供/调产能/订单延期 |
| KPI/目标 | 租户 Metric/PlanTarget | 全链平均风险/越线订单/现金垫 |
| 前端 | `SandboxViewConfig`（租户级，可编辑） | nodes/edges/colorBy/commands/kpis |
- **R14 红线**：沙盘引擎与前端**零业务常数**；任何"基地/订单"出现在代码即违规（门 `debattery:check` 扩沙盘维度）。
- **隔离**：`tenant_id` everywhere；SimSession/worldState/checkpoint/branch 全带租户；跨租户 403（R2）。

---

## 7. 基于现状的改造清单（复用 vs 新增，逐模块）

| 模块 | 动作 | 落点 |
|---|---|---|
| 模拟时钟 | **复用**：tick 推进 | `simclock.ts:80` → SimSession.tick 调用 |
| what-if 派生 | **复用+扩**：`recompute` 单步 → 传导引擎多步 | `ontology-core.ts` + 新 `propagate()` |
| 派生/规则 | **扩**：加传导型 `PropagationRule`（系数/延迟=param，接「规则即引用」） | `DerivationSpec` + `rule.params` |
| Action | **扩**：加沙盘模拟态（`sandbox=true` 改 session 不写真值） | `actions.ts` |
| 时序求解器 | **复用**：risk_timeline/counterfactual 作单 tick 计算核 | `solvers/risk.ts` |
| 就绪/闭包 | **升级**：A10/A18/闭包 → L0-L4+Trial Tick+雷达+三维 | `databuilder/closure.ts` + 新认证模块 |
| temporal | **复用**：asOfEpoch → checkpoint/rollback | `ontology.ts:279` |
| 数据接入 | **新增**：WebSocket 连接器 | `connectors/registry.ts` |
| 前端 sim 视图 | **改造**：ProjectSimView → SandboxView（配置驱动） | `views/sim/` |
| 前端组件 | **复用**：RadarChart(就绪雷达)/PropagationTimeline(tick轴)/PmDag/useLiveSolver | `views/sim/` |
| 前端配置 | **新增**：SandboxViewConfig + "沙盘配置"管理页（可编辑） | 新 `ViewConfig` 扩展 |
| AI 指挥台 | **复用**：QOS 对话坞 + 新沙盘 MCP 工具 `sim.*` | AgentCore orchestrator + MCP |
| 新一等对象 | **新增**：SimSession（仓储 memory+pg+migration） | DataCore 仓储四处 |

> 新增表：`sim_sessions`/`sim_checkpoints`（migrations/*.sql + repo/pg.ts + memory.ts + repo.ts，仓储双实现纪律）。

## 8. 《本体引用与影响》

- **对象类型**（§2）：新增 `SimSession`、`SimCheckpoint`、`PropagationRule`、`SandboxViewConfig`、`SimCertification`；触及 `SimulationClock`(复用)、`DerivationSpec`(扩)、`ActionType/ActionDraft`(双态)、`ObjectPropHistory`(checkpoint)、`Metric/PlanTarget`(目标)、`Solver`(单 tick 核)、`Connection`(WS)、`GapReport`(就绪)。
- **链路**（§3）：新增**沙盘链路** `本体世界态 --init/范围预检--> SimSession --tick--> 传导(沿 link,系数+延迟) ⊕ 沙盘态Action --> 状态更新 --checkpoint/branch--> 多时间线 --compare--> KPI`；`沙盘结论 --采纳--> R4 ActionDraft`（真值经审批）；AI 指挥台经 QOS+MCP `sim.*` 工具驱动。
- **事件**（§4）：新增 `sim.session_created/ticked/acted/checkpointed/branched/goal_evaluated/certified`（outbox，前端 SSE 订阅，D-29）。
- **不变量**：R6（确定性仿真：同基准+范围+操作序列=字节一致）、R4（沙盘可变但写真值经审批）、R13（每 tick 变动溯源）、R14（沙盘零业务常数，去行业锁死，核心）、R2/R3（租户隔离+entitlement 门）、R16（就绪认证接发育闭环三环）。
- **断点**（§8）：新登记 **G-11「有仿真积木无交互沙盘 + 沙盘若硬编码行业则违 R14」**，本 PRD 即其修法；与 G-9（发育闭环：就绪认证）、G-10（规则即引用：传导系数可编辑）强耦合复用。
- **门禁**（§7）：扩 `debattery:check`（沙盘维度零业务常数）+ 新 `sim-readiness:check`（三件套门+L0-L4 算法确定性）。
- **回写**：实施后 §2（5 新对象）/§3（沙盘链路）/§4（sim.* 事件）/§7（新门）/§8（G-11）全部回写 `docs/SYSTEM-ONTOLOGY.md`。

## 9. 验收（FDE 亲手 · 多行业证明抽象）

1. **两行业证明（核心，证去锂电锁死）**：① 锂电租户（供应链断供传导）② **另一行业租户**（如银行账户欺诈环传导，或电网负荷传导）——**同一前端、同一引擎，仅换本体 + SandboxViewConfig**，两者都能 init→tick→传导→分支→对比，跑出真结果。**代码里 grep 不到任何行业实体名**（`debattery:check` 沙盘维绿）。
2. **全栈联动**：前端点"推进 tick"→后端传导→SSE→前端节点色/动画/KPI/时间轴实时变（截图改前/改后）。
3. **改规则即改传导**：编辑某 `PropagationRule` 系数 0.85→0.6 发布→同一沙盘传导结果随之变（接「规则即引用」）。
4. **就绪认证**：本体缺一件套→L4 不通过、显式"缺动作/缺查询"；补齐→可进入推演。
5. **沙盘态不污染真值**：沙盘内断供/调产能多步后，真值对象库不变；"采纳"才生成 R4 草稿待审批。
6. **确定性**：同基准+范围+操作序列重跑→字节一致（R6）；分支独立。
7. **门 + 测试全绿**：`pnpm -r build && pnpm -r test` + `pnpm gates`（含新门）。
8. **北极星距离**：汇报列"还差哪几环 + 哪些是 happy-path/合成"（fde-delivery）。

## 10. 分期

- **P1（沙盘最小可跑·单行业打通全栈）**：SimSession(init/tick/act/world) + 传导引擎(系数+延迟) + 沙盘态Action + 前端配置驱动主视图(改造 ProjectSimView,复用组件) + QOS 沙盘 MCP 工具 + SSE 联动。**先把"一个租户从前端点一遍跑通传导"立住。**
- **P2（沙盘完整能力）**：checkpoint/rollback/branch + 多时间线 KPI 对比 + 目标-冲突 + 就绪认证(L0-L4+Trial Tick+雷达+三维) + 沙盘配置管理页。
- **P3（抽象证明 + 实时 + 回写）**：第二行业租户验收(证 R14) + WebSocket 实时源 + `debattery:check`/`sim-readiness:check` 门 + 本体回写。

> 与其它 PRD 关系：本 PRD 的"传导系数可编辑"复用 `PRD-rules-as-references`（规则即引用）；"就绪认证接三环"复用 `PRD-scenario-ontogenesis`（发育闭环）。三者构成"建（发育闭环）→ 规则（即引用）→ 用（推演沙盘）"的完整竖切。
