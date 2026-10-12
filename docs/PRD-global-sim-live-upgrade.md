# PRD · 全局推演「活系统」升级 — 从结构化驾驶舱到人机对话·自由变量·方案分支比对

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-07-24 |
| 取代/扩展 | 扩展 `PRD-global-sim.md`（七维联合数学 + 闭决策环已落）· `WO-GSIM-4-AGENT`（NL 大脑 §3.1 骨架已落·本 PRD 收 §3.2/§3.3 + 前端接线） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `docs/PRD-global-sim.md` · `docs/PRD-simulation-sandbox.md` · `docs/PRD-query-orchestration-service.md` |
| 页面 | 全局联合推演页 = view key **`global-sim`** · `apps/frontend-shell/src/views/sim/GlobalSimView.tsx`（五区七块·`:17-33`） |

> 一句话：全局推演驾驶舱今天**能算但不"活"**——`portfolio` 七维联合最优真跑、七维 KPI 上屏、洞察→行动闭决策环都在，但（①）**没有 NL 框接线**（`sim-planner` 大脑仅经 QueryDock 可达·`GlobalSimView` 全是结构化控件）；（②）杠杆盘只有 **preset**（`frozenCapacityMode/method`）——**契约里的自由 `levers[]`（key/target/delta）根本没在 UI 暴露**；（③）用户**不能存/命名/分支/横比自己的方案**（`portfolio.scenarios[]` 是每次求解的临时预设目标·`SimSession` 会话状态机建好却未被任何业务页复用）。本 PRD 把三者补上，让全局推演成为**"活系统"**：**问它、给它任意变量、存/分支/比自己的方案、采纳回灌**。**引擎全已建，本 PRD 是接线 + 补 §3.2/§3.3 + 沙盘会话首次业务复用。**

---

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（§2）：`GlobalSim`（=`portfolio` 求解器产物·`GlobalSimResponse`）· `SimSession`/`SimCheckpoint`（方案存/分支·首次被业务页复用）· `Order`/`Base`/`Line`/`InterBaseTransfer`/`DemandSegment`（联合最优读写）· `ActionDraft`（采纳 R4）· `Intent`/`ExecutionPlan`（NL→compose 路径）。
- **触及链路**（§3）：联合最优组合链（§3 line 450-467·`portfolio` 七维 + 自由 `levers[]` ⑤ line 467）· 推演 NL 大脑链（line 251-262·`sim-planner buildSimNavSlice`→compose）· 闭决策环链（line 483-495·采纳回灌）· **新接** 沙盘方案快照链（`SimCheckpoint` solve-mode·§3 line 418-427 沙盘链路的 solve-mode 变体）。
- **触及事件/数据流**（§4）：`sim.session_created`/`sim.checkpoint_saved`/`sim.branched`（方案存/分支·L-sim）· `compose_step`/`compose_fallback`（NL SSE·QOS §8.2）· `action.executed`（回灌·G-LOOP-FEEDBACK）· 遵守 D-29。
- **触及不变量**（§5，R1–R18）：**R6** 确定性（`portfolio` `forecastStart` 锚·禁 Date/random·同杠杆两跑字节一致）· **R13** 每 KPI/杠杆 delta/方案数字带 provenance · **R14** 自由杠杆/边界/文案非内联（杠杆自 `discoverLevers`/契约派生·`debattery:check` 守）· **R4/RL4** 采纳走 Action 不静默写真值 · **R17** 决策单页 · **R3** 暗发（`qos.compose-path`/`sim.*` defaultOn:false·关=404 不回归现有租户）· **RL3/RL10** 方案存比复用既有 `SimCheckpoint`/`compare`/`decision_play` 不平行造第二套。
- **CLI 打通（R15，强制）**：`portfolio`（`/b/v1/solvers/portfolio/run`）· `decision_play` 已在 `OPERATION_CATALOG`·`platform do` 可达；NL 推演经 QOS `POST /b/v1/operations/classify`；本 PRD 无新对外能力洼地。
- **关闭/影响的已知断点**（§8）：新登 **G-GSIM-DEAD-COCKPIT**（无 NL 接线·自由 levers[] 未暴露·无方案存分比）+ **G-SIMSESSION-NO-BIZ-REUSE**（沙盘会话未被业务页复用·PAUSED/ENDED 迁移未实现）；收 `WO-GSIM-4-AGENT` 残口（§3.2/§3.3 未完全落地·前端无 NL 框）；复用/延伸 **G-WHATIF-HARDCODED-LEVERS**（已闭·自由杠杆范式）、**G-DECISION**（已闭·比对矩阵范式）、**G-PORTFOLIO-LOCAL-ONLY**（已闭·联合守恒）、**G-LOOP-FEEDBACK**（闭决策环）。
- **需走的检测门禁**（§7）：`sim:check`（sim.* 暗发不回潮·R9 四处·端点过 entitlement）· `genuine-sim:check` · `debattery:check` · `chain:check`（compose 求解器注册）· `ontology:check` · `prd:check` · 四包 gate + `xservice-smoke`（B↔A NL 跨系统）。
- **回写承诺**：WO 落地后回写——§3 补「全局推演 NL 前端接线 + 沙盘 solve-mode 方案快照」、§8 收 G-GSIM-DEAD-COCKPIT/G-SIMSESSION-NO-BIZ-REUSE 状态、§2.I 补「SimSession 首次被业务页（全局/产能推演）复用 + PAUSED/ENDED 迁移补全」。**本体不回写即过期失效。**

---

## 1. 目标 / 非目标

**目标**
1. **人机对话接线**：`GlobalSimView` 内嵌**真 NL 框**（复用 `SimCommanderDock` 范式·带 sessionId）→ orchestrator compose 路径 → `portfolio` 联合求解 → 叙述带溯源。用户可问「把大客户 SO-3437 排在小客户前整体按期率怎么变」「储能份额提到 30% 要加多少产线」。**收 `WO-GSIM-4-AGENT` §3.2 多方案叙述 / §3.3 自由追问残口。**
2. **自由变量推演**：把契约已有的自由 `levers[]`（key/target/delta）在 UI 暴露为**交互杠杆盘**——`discoverLevers` 反推候选 + 用户拨动/新增任意杠杆 → `portfolio` 携 `levers[]` 重解 → `leverDeltas` before/after。**不再只有 preset `frozenCapacityMode/method`。**
3. **方案存/分支/横比**：用户把一次推演（含自定义杠杆/优先级锁/目标）**存为命名方案**、**分支**变体、**多方案横比矩阵**（复用 `decision_play` 范式 + `SimCheckpoint` solve-mode 存档）→ 一键采纳走 Action。**让 `SimSession` 会话状态机首次被业务页复用**（闭 G-SIMSESSION-NO-BIZ-REUSE）。

**非目标**
- 不改 `portfolio` 联合数学内核（`globalSimOptimize`·CP-SAT sidecar）。
- 不做产能页的原子因子深化（那是 `PRD-capacity-live-cockpit.md`·本页是全订单×全基地全局最优）。
- 不重画驾驶舱视觉（`WO-GLOBALSIM-GLASS-REDESIGN` 另管视觉·本 PRD 只加交互能力）。

---

## 2. 现状与缺口（对照代码 · file:line）

| # | 现状（AS-IS） | 缺口 | 锚点 |
|---|---|---|---|
| G1 | `GlobalSimView` 全结构化控件·`useLiveSolver("portfolio")` 同步求解·**无 NL 框** | NL 大脑（`sim-planner`）仅经 QueryDock/orchestrator 可达·未接进页 | `GlobalSimView.tsx:132`（无 submitQuery）；brain `sim-planner.ts:28-93` |
| G2 | 杠杆盘 `GlobalSimLevers` 仅 preset `{frozenCapacityMode, method}` segmented | 契约自由 `levers[]`（key/target/delta）**未在 UI 暴露**·用户不能给任意变量 | `GlobalSimLevers.tsx:14,:39-66`；契约 `global-sim.ts:50-55,:84` |
| G3 | 方案比对 ⑥ 仅 preset 目标（max_ontime/min_cost/min_delay） | 用户不能存/命名/分支/横比**自己参数化**的方案 | `GlobalSimView.tsx:357-369`；scenario set `sim-planner.ts:40` |
| G4 | `WO-GSIM-4-AGENT` 仅 §3.1 组合骨架·§3.2/§3.3 未完全·§3.3 自由追问退回 path-B `runAgentLoop` | 多方案叙述口径/自由追问契约未随附 | 自陈 `sim-planner.ts:14-17` |
| G5 | `SimSession` 会话状态机（init/tick/checkpoint/rollback/branch/compare）建好·`SandboxView` 主屏可用 | **未被任何业务推演页复用**（GlobalSim/ProjectSim/capacity 全走 `useLiveSolver` 另一血脉）·PAUSED/ENDED 迁移未实现 | 路由 `app.ts:1228-1496`；PAUSED/ENDED 无 set `:1235,:1294,:1331`；仅 `SandboxView.tsx` 用 |

---

## 3. 设计（复用现有接缝优先）

### 3.1 复用清单（全复用·零绿地引擎）

| 能力 | 复用什么 | 锚点 |
|---|---|---|
| NL 大脑 | `sim-planner`（isSimComposeQuery/buildSimNavSlice/SIM_SCENARIO_SET）+ orchestrator compose + execute-plan 一次综合 | `sim-planner.ts:28-93`；`orchestrator.ts:1009-1035`；`execute-plan.ts:160-166` |
| NL 前端框 | `SimCommanderDock` 范式（带 sessionId·`sim.commander` 门控·提交 QOS path-B） | `SandboxView.tsx:156-210` |
| 自由杠杆反推 | `discoverLevers`（`generic_inference mode:"levers"`）供候选 + 契约 `levers[]` 已被 `portfolio` ⑤消费 | `service.ts:466`；`global-sim.ts:84`；ontology §3 line 467 |
| 方案存/分支/比对 | `SimSession`/`SimCheckpoint`/`branch`/`GET /a/v1/sim/compare`（solve-mode 快照）+ `decision_play` 比对矩阵范式 | `app.ts:1307-1338`；`decisionPlay service.ts:2295-2388` |
| 采纳回灌 | `plan_change` ActionDraft（`WO-GSIM-5-ACTION` 已落·G-LOOP-FEEDBACK） | `PRD-global-sim.md §3` |

### 3.2 三段"活"能力落点

- **活①·人机对话**（WO-LIVE-NL 共享 + WO-GSLIVE-1 前端）：`GlobalSimView` 内嵌 `SimCommanderDock` 式 NL 框 → orchestrator 识别 global-sim compose 意图（`sim-planner` 已判 global-sim 视图直命中 `:30`）→ `portfolio` 逐方案联合求解 → SSE 叙述。补 §3.2 多方案叙述 + §3.3 自由追问（根因→`gap_attribution`·本体语义→`ontology_query`）。
- **活②·自由变量**（WO-GSLIVE-1 前端）：杠杆盘 `GlobalSimLevers` 加"自由杠杆"区——`discoverLevers` 反推候选 top-K + 用户拨动/新增 `{key,target,delta}` → `useLiveSolver("portfolio", {..., levers})` 重解 → `leverDeltas` 展示。preset 区保留。
- **活③·方案存/分支/横比**（WO-LIVE-SCENARIO 共享 + WO-GSLIVE-1 前端）：一次推演存为 `SimCheckpoint`（solve-mode·`state`=jsonb{request, kpis, provenance}）→ 分支 → `decision_play` 范式横比矩阵（七维 KPI × 方案）→ 采纳走 `plan_change`。**SimSession 首次被业务页复用**。

---

## 4. 契约 / 端点 / 数据模型

- **自由杠杆 UI**：契约 `GlobalSimLever{key,target,delta}` 已存（`global-sim.ts:50-55`）· `GlobalSimRequest.levers[]` 已被引擎消费（`:84`）——**零契约改动**，纯前端暴露 + `discoverLevers` 反推候选。
- **NL**：复用 QOS `POST /b/v1/operations/classify` + compose 路径·`qos.compose-path`（`registry.ts:103` defaultOn:false）——**零新端点**，补 `sim-planner` §3.2/§3.3 逻辑。
- **方案快照**（WO-LIVE-SCENARIO）：`SimSession` solve-mode——`POST /a/v1/sim/sessions`（`base_snapshot`=推演 scope·`curTick` 恒 0·不跑 propagation）→ `POST …/checkpoint`（`state`=jsonb{page,request,kpis,provenance,label}）→ `POST …/branch` → `GET …/compare`。**复用现表**（migration 026·R9 双实现）·如需 `page`/`kind` 判别列则**双仓储四处同改**。补 `SimSession` PAUSED/ENDED 迁移（`app.ts` 加 pause/end 路由·闭状态机残口）。

---

## 5. 关键流程（端到端 · 沿链路）

```
[活①] NL 框问「储能份额提到30%要加多少产线」→ orchestrator(compose,isSim) → sim-planner buildSimNavSlice
  → portfolio 逐方案联合求解(七维) → execute-plan 一次 llm.compose → SSE 叙述(数字带溯源·无provider则确定性兜底)
[活②] 杠杆盘拨"常州化成通道+2" → discoverLevers 反推候选 → useLiveSolver("portfolio",{levers:[{key:"formationChannels",target:"changzhou",delta:2}]})
  → 联合重解 → leverDeltas before/after 七维KPI + <Provenance>(drillType=Lever)
[活③] 存方案A(max_ontime+自定义杠杆) → 分支方案B(priorityLock=大客户) → SimCheckpoint 各存
  → decision_play 范式横比矩阵(七维KPI×A/B·被挤单·按期率) → 采纳A → plan_change ActionDraft → S2审批 → 回灌基线 → 下一轮读真变
```

---

## 6. 非功能与约定（§5 逐条）

- **R6**：`portfolio`/`discoverLevers`/快照 无 Date/random；同杠杆同种子两跑字节一致。
- **R13**：七维 KPI/leverDeltas/方案矩阵每格挂 `<Provenance>`；`genuine-sim:check` 守 dataMode。
- **R14**：自由杠杆自 `discoverLevers`/契约派生、边界自规则闸、文案 i18n；`debattery:check` 守。
- **R3/RL2**：`qos.compose-path`/`sim.*` 暗发 defaultOn:false·关=404 不动现有租户。
- **RL3/RL10**：方案存比复用 `SimCheckpoint`/`compare`/`decision_play`·不平行造第二套。
- **R4/RL4/R17**：采纳走 Action·决策单页就地完成。

---

## 7. 验收（DoD）

- [ ] **四包全绿** + `xservice-smoke`（B↔A NL 真跑）；金值：无新 solver key（SOLVER_KEYS 保 57）；若加 SimSession 判别列则 golden 迁移计数同步。
- [ ] **SEAM-GATE 组合测通**（见各 WO）。
- [ ] 门：`sim:check`/`genuine-sim:check`/`debattery:check`/`chain:check`/`ontology:check`/`prd:check` 全绿。
- [ ] **亲手真跑**：内存态 → 全局推演页 NL 问一句得联合求解叙述 → 拨自由杠杆看七维 KPI 真变 → 存 A 分支 B 横比 → 采纳走审批 → 下一轮读真变。
- [ ] **本体回写**：§3/§8/§2.I。

---

## 8. 分期与 WO 拆分（并行可派 · 靠文件边界不靠身份）

> 本页 1 张 page-specific WO（`WO-GSLIVE-1-COCKPIT`）+ 2 张跨页共享 WO（`WO-LIVE-NL`/`WO-LIVE-SCENARIO`·产能推演页也用·**在此定义一次·两 PRD 共用派发**）。加 `PRD-capacity-live-cockpit.md` 的 2 张 capacity WO，**全程序共 5 张并行 WO**，文件边界严格三分（datacore/frontend/agentcore）不相交。

### WO-GSLIVE-1-COCKPIT（前端整单 · 1 fresh dev · owns GlobalSimView）

**🚦范围边界·只碰**：`apps/frontend-shell/src/views/sim/GlobalSimView.tsx`（内嵌 NL 框挂点 + 方案存分比 UI）· `apps/frontend-shell/src/views/sim/GlobalSimLevers.tsx`（加"自由杠杆"区·discoverLevers 反推 + 用户拨/增 `levers[]`·保 preset 区）· 新 `apps/frontend-shell/src/views/sim/GlobalSimScenarioBar.tsx`（方案存/分支/横比矩阵·decision_play 范式）· `apps/frontend-shell/src/locales/zh.ts`（additive）· `apps/frontend-shell/src/api/endpoints.ts`（append 客户端封装）。
**禁碰**：datacore、agentcore、`portfolio` 求解逻辑、`SimSession` 引擎。
**SEAM-GATE（前端 + datacore/agentcore merge 态·头号判据）**：`gslive-cockpit.test.tsx`——① 拨自由杠杆→`portfolio` 携真 `levers[{key,target,delta}]`→`leverDeltas` 七维 KPI 真变（KILL-MOCK 喂显式 mock）② NL 框提交→走 compose 路径→叙述含被挤单/按期率（`runAgentLoop` 未调·compose-path 早返）③ 存 A 分支 B→横比矩阵七维×方案各格真算→采纳→PENDING_APPROVAL。
**handoff 分支**：`claude/handoff-wo-gslive-cockpit`。

### WO-LIVE-NL（agentcore 整单 · 1 fresh dev · 跨页共享 · owns sim-planner/orchestrator NL）

**🚦范围边界·只碰**：`apps/agentcore/src/agent/sim-planner.ts`（收 §3.2 多方案叙述 + §3.3 自由追问 + **加产能 what-if 意图**路由到 `generic_inference`/`gap_attribution(scope)`/`capacity_forecast`）· `apps/agentcore/src/router/orchestrator.ts`（compose 分支·`:1009-1035` 挂点扩产能页）· `apps/agentcore/src/router/execute-plan.ts`（叙述模板·如需）· 对应契约 `SOLVER_ARGS_SCHEMAS` 登记（若 `gap_attribution` scope 入参需登记）。
**禁碰**：前端、datacore 求解器算法、`portfolio` 数学。
**SEAM-GATE（跨系统 B↔A·非各半绿）**：扩 `compose-sim-seam.test.ts`——① 产能 what-if NL（「常州化成良率降到92%产能少多少」）→ 识别产能意图→路由 `generic_inference` 真算→叙述带溯源（`runAgentLoop` 未调）② global-sim §3.2 多方案叙述真出三方案 KPI ③ §3.3 自由追问根因→`gap_attribution` 不劫持 compose-path · R6。
**handoff 分支**：`claude/handoff-wo-live-nl`。

### WO-LIVE-SCENARIO（datacore 整单 · 1 fresh dev · 跨页共享 · owns SimSession solve-mode）

**🚦范围边界·只碰**：`apps/datacore/src/app.ts`（`/a/v1/sim` 路由段·加 solve-mode session/checkpoint 承载 what-if 快照 + **补 PAUSED/ENDED 迁移路由**·闭状态机残口）· `packages/contracts/src/sim.ts`（`SimCheckpoint.state` 加 what-if 快照可选字段/`page` 判别·additive）· `apps/datacore/src/repo/{repo,pg,memory}.ts` + `migrations/*.sql`（若加判别列则 R9 四处同改 + down）。
**禁碰**：前端、agentcore、`propagateTick` 传导核算法（solve-mode 不跑 tick）、`portfolio`/`capacity` 求解器。
**SEAM-GATE（datacore·复用不重造·变异反证）**：`sim-solve-scenario.test.ts`——① 存 what-if 方案为 checkpoint→`GET /compare` 返 A/B 七维差异真值（改方案 KPI→compare 真变）② 分支→`parentCheckpointId` 挂真 ③ PAUSED/ENDED 迁移真置位（闭残口）④ R2 跨租户 404 ⑤ R6 + `sim:check` 暗发不回潮。
**handoff 分支**：`claude/handoff-wo-live-scenario`。

> **接缝纪律声明**：三张 WO 文件边界严格三分（frontend/agentcore/datacore），可并行。跨半/跨系统特性（NL 前端框↔agentcore 大脑·自由杠杆前端↔portfolio 引擎·方案快照前端↔datacore SimSession）各由**对应 WO 的 merge 态 SEAM 组合测**作对接铁证——**审核方复验头号判据 = 组合测在合并态通、亲手真跑，非各半绿**（"绿测试≠能用·断在接缝"）。
