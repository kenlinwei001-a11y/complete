# PRD · Skill Runtime 与 Reasoning Graph 编排器

| 项 | 值 |
|---|---|
| 版本 | v1.0（2026-08-03） |
| 上游 | `docs/SPEC-industrial-skill.md`（12 层结构 · §6 包模板 · §7 两项定案 · §8 SDK/Runtime 链）· `docs/WO-ROUTING-RETRIEVAL-FIRST.md`（Track A/B/C/D/E · 证据链 E1–E12） |
| 解决问题 | SPEC §1-⑥「Reasoning Graph」与 §8「Runtime 链」今天在仓里落不下去——**执行是线性 for…await 串行**（`apps/agentcore/src/workflow/executor.ts:104`）、**预算是全局常数不分题型**、**取消只到同步求解通道一半**、**过程可见在半数执行路径上结构性为 0**、**Runtime 的第一站被 13 道前置门抢答**。本文把这五条从"目标形态"翻译成可施工、可门控、**效果层可验收**的运行时设计 |
| 交付范畴 | Runtime（执行层）。**不含**：Skill 契约字段定案（→ Skill 契约 PRD）· Skill 编译器/CLI/包格式（→ Skill Compiler PRD）· 路由检索前置本体（→ WO-ROUTING-RETRIEVAL-FIRST Track A） |
| 一句话立场 | **不造新执行器**。Reasoning Graph 是既有 `PlanStep` 派发的**调度层超集**；今天三处各自实现的并行/串行扇出收敛成一处，否则「互不知情」从 10 处变成 11 处 |

---

## 0. 本体引用与影响

> 依 `CLAUDE.md` 铁律 0 与 `docs/SYSTEM-ONTOLOGY.md` §0 read-first 协议。本节为机器可读段（`pnpm prd:check` 解析）。

### 0.1 触及对象类型（本体 §2）

| 域 | 对象类型 | 本 PRD 的动作 |
|---|---|---|
| §2.H 交互/编排 | **Skill**（`packages/contracts/src/agentcore.ts:236 SkillDefinitionSchema`） | additive 扩 `execution`（Reasoning Graph）· `budget`（题型预算）· `progress`（可观测声明）；**`maxBudgetRounds` 由"零消费方"接上真消费方** |
| §2.H | **ExecutionPlan / Workflow**（`packages/contracts/src/qos.ts:180 ExecutionPlanSchema`·`steps 1–12`） | 语义**逐字节保留**，降为 Reasoning Graph 的**链式退化形态**；`compileGraph(plan.steps)` 为唯一升格入口 |
| §2.H | **Intent** | 不改结构。`intent → skill` 这条边由 Skill 契约 PRD 定案，本文只消费 |
| §2.H | **AgentDefinition** | 不改结构。`agent` 节点 = 既有 `invoke_agent` 步 |
| §2.H | **Task / Query（QueryTask）** | additive：`reasoningGraphRun`（图运行态留痕）+ `routing.completed` 载荷补 `routeSource`/`skillKey` |
| §2.H | **AgentRole / CeoAgentProfile / Coordinator 编排** | Coordinator 的三角色扇出收编为「一张三节点并行图」；`coordinator.ts buildDispatchSteps` 产出的 `invoke_agent` 步不变 |
| §2.E 求解/推演 | **Solver**（`apps/datacore/src/solvers/service.ts:44 SOLVER_KEYS`，实测 57） | 不改。`solver` 节点 = 既有 `invoke_solver` 步 + 本次补齐的 `AbortSignal` 透传 |
| §2.C 规则/约束 | **RuleEntry**（C01–C33） | 不改。`rule` 节点 = 既有 `evaluate_rules` 步（BLOCK 短路语义保留） |
| §2.D 行动/权限 | **ActionDraft / ActionType / approvalChain** | 不改。`human` 节点 = 既有 `create_action_draft` + 审批链，**不新造审批机制** |
| §2.G 治理/平台 | **FeatureFlag** | 新增暗发键 `qos.reasoning-graph`（BLOCK·`defaultOn:false`·双注册 datacore `features.ts` + agentcore `features/registry.ts`） |

### 0.2 触及链路（本体 §3「编排链（问句→答案）」）

```
现状（本 PRD 不动其左半）：
  Query → [13 道前置门] → classify → τ 决策 → proceedWithIntent → fillSlots
        → plan 步（resolve_slice → invoke_solver → evaluate_rules → render_answer）  ← 线性·串行

目标（本 PRD 只改最右一段的形状，并在其上加调度层）：
  … → proceedWithIntent → fillSlots
        → **compileGraph**（Skill.execution ⊕ legacy plan.steps）
        → **GraphScheduler**（拓扑波前 · 并行边 Promise.all · 取消到底 · 逐节点 progress）
        → node dispatch（**复用今天 executor 的同一 switch 体**：slice/solver/rule/agent/mcp/compose/human/render）
```

- **新增链路**：`Skill --execution--> ReasoningGraph --node--> {agent|solver|rule|human|slice|render|mcp|compose}`；`ReasoningGraph --edge(seq|parallel|cond)--> ReasoningGraph`；`Skill --dependsOn--> Skill`（编译期内联展开，非运行期新会话）。
- **收编（不新增第二/三套）**：`apps/agentcore/src/router/multi-route.ts:210` 的 `Promise.all` 多域扇出、`apps/agentcore/src/router/orchestrator.ts:2233` 的 Coordinator 串行扇出，**统一为图的两种退化形态**。
- **回写要求**：本体 §3「编排链」须补最右段的图形态与三处收编说明（见 §11 回写清单）。

### 0.3 触及事件（本体 §4 · QOS-PRD §8.2）

**不新增任何事件名**（守 QOS-PRD §8.2 一字不差；`pnpm ontology:check` 的 §4 事件集校验同样不受影响——本文不新增领域事件）。全部扩载荷：

| 事件 | 现状 | 本 PRD 的扩载荷 |
|---|---|---|
| `routing.completed` | 已发，载荷 `{path, note?, role?, agentId?}`（`orchestrator.ts:888/985/1424/1588/2075/2166/2284`） | 补 `routeSource`（哪道门做的决定，与 WO Track A Phase 1 **同一字段同一口径**）+ `skillKey`（本题最终由哪个 Skill 执行） |
| `step.started` / `step.completed` | 伪 step 已是既定承载（narration `type=agent_narration`·`loop.ts:848`；多域 `det_multi_domain_*`·`multi-route.ts:199/215/232`） | 补 `nodeId` · `nodeKind` · `role`/`roleLabel`（并行后**必须**由节点自带，不得再靠串行序推导）· `phase`（Skill 声明的阶段名）· `budgetLeft` |
| `task.cancelled` | 已发 | 补 `cancelledNodes[]`（哪些在跑的节点收到了取消） |
| `routing.degraded` · `coordinator.planned` | 代码已有（`orchestrator.ts:1001/2027`、`:2172`），**不在 QOS-PRD §8.2 表内**——属既有事实，本文不扩不删 | — |

### 0.4 触及不变量（本体 §5）

| 不变量 | 影响 | 处置 |
|---|---|---|
| **R1** contracts-only-shared | `ReasoningGraph`/`SkillBudget` schema 必须落 `@platform/contracts`，两 app 与前端同源 | 契约先行；agentcore 不得本地重定义（`workflow/executor.ts:19 ExtraToolStep` 那种局部放宽是既有技术债，本次一并收进契约或明确登记豁免） |
| **R2** tenant_id everywhere | 图运行态、节点缓存键、取消注册表均带 tenantId | 调度器所有 Map 的键 = `${tenantId}:${taskId}:${nodeId}` |
| **R3** entitlement 先于 authz | `qos.reasoning-graph` 关 → 图能力**不存在**（走今天的线性 plan，逐字节不变），不是 403 | 暗发默认关；`enabledSet` 判定沿用既有链路（注意 §12 已知残口 `G-ENTITLEMENT-FAIL-OPEN-DEBUG`：`X-Debug-User` 链路 entitlement 恒失效，本文不修但验收不得依赖 debug 链路证明"关了就没有"） |
| **R4** 真值写入经 Action | `human` 节点**只能**产 `ActionDraft` 走既有 `approvalChain`，绝不在图里直写真值 | 图执行器无写真值能力（无该 dispatch 分支）；`action-wiring:check` 口径不变 |
| **R6** 确定性 | **红线**：今天 32 个意图的确定性 plan 秒级、同输入同输出、可溯源；图化后不得把这唯一没病的一段变成有病的 | 节点带 `determinism: PURE\|LLM`；`execution.mode=DETERMINISTIC` 的 Skill 图内出现 LLM 节点 → **发布拒绝**。迁移验收 = 同意图同槽位，answer 与 provenance **字节相等**（§10 A1） |
| **R7** 错误信封 | 并行节点失败聚合后仍须单一 `{error:{code,message,requestId}}` | 多失败取**首个按节点声明序**的错（R6 稳定），其余入 `partialFailures[]` 诚实列出 |
| **R9** 仓储双实现 | 图运行态若落库（Phase 2 `human` 节点跨请求 resume）→ migrations + pg + memory + repo 接口四处同改 | Phase 1 **不落库**（图在单次请求内跑完），故不触发；Phase 2 立单时四处同改 |
| **R11** 全链闭包 | 图必须以 `render` 节点收口（对应今天 `render_answer` 须末步的 validate 规则） | `compileGraph` 校验：至少一条从入口到 `render` 节点的可达路径；否则拒绝发布 |
| **R13** 结论可溯源 | 并行/条件边不得丢 ⟦ref⟧；`human` 节点的等待与超时须诚实标注 | 每节点产出携 `toolCallId`+`snapshotVersion`（今天 `executor.ts:190-198 stepAudits` 已有，图化后按 nodeId 索引） |
| **R14** 应用层无业务常数 | 图拓扑不得内联业务实体名（基地/型号/工序） | 图节点只引用 solverKey/ruleKey/sliceKey/objectType；`debattery:check` 扫描面覆盖新增文件 |
| **R15** CLI 对等 | Runtime 新增对外能力（跑图/看图运行态）须有 CLI 或 GUI 深链 | `OPERATION_CATALOG` 登记；`cli-parity:check` 守 |
| **R16** 发育闭环 | 新增 need 类型（Skill 的 execution graph）须注册 provisioner，否则倒序发育漏一环 | `databuilder/provisioners.ts` 同步；`provisioners.test` 自动变红即门 |
| **R-ARG-FIDELITY** | 并行边下 args 更易丢：一路解析出的过滤实体不得静默不达另一路 | 每节点 args 由**该节点自己的槽映射**产出；`arg-drop-seam:check` 口径扩到图节点 |
| **R-一致** | 同一份预算/取消/进度不得有两套口径 | 单一调度器 + 单一 `RuntimeContext`（§6.3） |

### 0.5 触及断点（本体 §8）

| 断点 | 关系 |
|---|---|
| **G-2**（跨服务形状） | `outputSchema` 今天零消费方（SPEC §2-⑪）；图的 `render` 节点是天然的校验点——本文只声明校验位置，实施归 Skill 契约 PRD |
| **G-9**（场景卡未走发育闭环 · 缺则**静默掉探索**→预算耗尽→"未能产出回答"） | 直接相关。按题型预算（§4）+ 诚实降级（§5.5）正是这条的处置面；**有界终止本身不放松** |
| **G-10**（规则被引用/被写死，非一等可编辑引用） | `rule` 节点必须是**引用**（只列 ruleKey），呼应 SPEC §5「引用而非内联」；残口 `G-C08-EXPR-PARAM-SPLIT` 不在本文范围 |
| `G-AGENT-BLIND-REACT` | 图化不解决路由劫持；见 §7 与 Track A 的关系裁决 |
| `G-SKILL-UNREACHABLE-FREE-QA`（#90，已暗发接线 `orchestrator.ts:1730-1734`） | 本文的 `RuntimeContext` 统一工厂（§6.3）是这条债的**结构解**，防同族复发 |
| `G-WORKFLOW-BUDGET-LEAK`（嵌套 workflow 不消费外层预算，已闭） | 并行边引入新的同族风险：check-then-act 竞态（§3.5-b），须新增不变量守 |
| `G-SIDEEFFECT-VOCAB-SPLIT` | `human` 节点的触发判定必须复用 contracts `isWriteEffectSkill()` 单一来源，不得手抄第二份词表 |
| `G-SHIP-CONFIG-IGNORES-CODE`（#88） | 题型预算只能**收紧**部署上界不能放宽（§4.3），否则 Skill 作者可绕过 compose 治理 |
| `G-ENTITLEMENT-FAIL-OPEN-DEBUG`（#89） | 验收不得在 `X-Debug-User` 链路上证明"feature 关了就不存在" |
| **未回写断点（本文依赖，但本体 §8 今天查无此条）** | `G-ROUTE-REGEX-PREEMPTS-RETRIEVAL` · `G-TIMEOUT-AS-VERDICT` · `G-SYNC-SOLVE-TIMEOUT-NO-CANCEL` —— 三条写在 `docs/WO-ROUTING-RETRIEVAL-FIRST.md:87-101`，**实测 `grep` 本体 §8 命中 0**。本文不代为回写（属 Track A 的交付物，避免两处并写打架），但在 §11 登记为**并线前置**：Runtime 相关 WO 合入前这三条须在本体存在，否则 §0 引用悬空 |

### 0.6 触及门禁（本体 §7）

| 门 | 动作 |
|---|---|
| `ontology:check` · `prd:check` · `prd:coverage` | 沿用；本文入 `docs/prd-ontology-index.json` |
| `chain:check`（R11） | 扩：图必须可达 `render` 节点（今天只校验"场景声明的求解器已注册"+SHAPE） |
| `loop-control:check` | 扩：`degrade` 仍是 loop.ts 唯一诚实出口；**图调度器不得新开第二个降级出口** |
| `arg-drop-seam:check` | 扩：图节点 args 的槽映射同守 |
| `deploy-governance:check`（#88） | 扩：题型预算的部署上界建议值须在 `docker-compose.yml` 照做 |
| **新增 `graph-runtime:check`** | 静态守四条：① 全仓只有**一处**图调度实现（`Promise.all` 扇出不得散落）② 节点派发复用 executor 同一 switch（不得复制第二份）③ 预算 reserve-then-run（`await` 前完成计数）④ `RuntimeContext` 由统一工厂产出（无裸传参调用点）。并入 `pnpm gates` |
| **新增 `progress-reachability:check`** | 静态守：凡构造 agent/图执行上下文的调用点都经统一工厂 → 新增路径不可能"忘了传 emitNarration"（治 E9/#90/#92 同族） |

---

## 1. 问题陈述：五个必须正面回应的既有病灶

> 判定口径：**「已有」= 机制在且有真消费方**。以下每条给 `file:line` 或可复跑命令；标「未核实」的绝不当结论用。

### 1.1 病灶 A · 执行是串行，图化即三倍串行

`apps/agentcore/src/workflow/executor.ts:104` 是 `for (const step of input.steps)` + 逐个 `await`（本会话逐行读取核实），**循环体内全文无 `Promise.all`**（同文件 grep `Promise.all` 零命中）。

- WO E5 实测拆解：三角色 `60059 + 82842 + 60025 = 202,926 ms ≈ 总时长`；其中两段精确等于 `QOS_AGENT_LLM_TIMEOUT_MS=60000`（`apps/agentcore/src/config.ts:30` 默认 60s），有效计算 `invoke_solver` **527 ms = 0.26 %**。（此数字为 WO 记录的审核方实测，本文引用不复跑。）
- 直接后果：**一张三节点 Reasoning Graph 今天跑就是串行三倍**。SPEC §1-⑥ 的图若落在今天的执行器上，只是把线性步骤画成了图。

**但仓里已有两处并行的先例**，这决定了设计不能是"再写一个并行"：

| 处 | 位置 | 形态 |
|---|---|---|
| 多域分路 | `apps/agentcore/src/router/multi-route.ts:210` | `await Promise.all(routes.map(...))` —— 真并行 solver 扇出 + 零 LLM 块装配 |
| Coordinator 角色扇出 | `apps/agentcore/src/router/orchestrator.ts:2233 runWorkflowSteps` | 走 `executor.ts:104` 串行 |

→ 再加一套图并行 = **第三套扇出**。本文的第一条约束由此而来（§3.4）。

### 1.2 病灶 B · 预算是全局常数，字段早在、零消费方

- `SkillDefinitionSchema.maxBudgetRounds` 存在于 `packages/contracts/src/agentcore.ts:260`。
- 全仓引用（`grep -rn maxBudgetRounds --include=*.ts --include=*.tsx --include=*.mjs`，排除 node_modules/dist）**只有 3 处**：契约定义 1 处 + `apps/agentcore/test/skill-contract.test.ts:65,77` 断言"存了能读出来" 2 处。**生产代码零消费方**。
- 出厂 7 个 Skill（`apps/agentcore/src/mocks/seed.ts:866..1137`）**无一填写** `maxBudgetRounds`，亦无一填写 `dependsOn`（同文件 grep 两键均零命中）——与 SPEC §4 实测的 `7/7 全空` 一致。
- 真正在跑的预算：`AgentBudget`（`packages/contracts/src/qos.ts:601`），`DEFAULT_AGENT_BUDGET.maxRoundTrips=24 / maxDiscoverCalls=8`（同文件 :616-627），部署态经 env `QOS_AGENT_MAX_ROUND_TRIPS`/`QOS_AGENT_MAX_DISCOVER_CALLS` 收紧（`config.ts:38-39`，注释建议 `4`/`1`），由 `orchestrator.ts:389 computeResidualBudget` 注入 **9 个 `new BudgetTracker(...)` 站点**（`orchestrator.ts:882/981/1439/1617/2077/2195/2286` + `server.ts:1146` + `skill-probe.ts:377`）。

→ **所有题共用一个数字**：跨基地对比与单点归因拿到同样的轮数。这正是 SPEC §4-D4 判定的"203 s 成因之一"，也是 #92（账本记得对没人读）同族第三例。

### 1.3 病灶 C · 取消只做了一半

`01c05948`（已并线，本会话 `git show` 核实）把**同步求解代理** `POST /b/v1/solvers/:key/run` 的取消打通到底：`apps/agentcore/src/server.ts:1746-1789` 建 `AbortController`，超时/客户端断开 → `solver.invoke(..., cancel.signal)` → `apps/agentcore/src/tools/datacore-http.ts:216` 直达 `fetch(signal)` → DataCore `apps/datacore/src/solvers/cancellation.ts`（AsyncLocalStorage 请求作用域取消令牌）→ sidecar fetch / A18 沙箱 SIGKILL / 贪心循环检查点。审核方探针复验：**504 后 700ms 底层 `finished=0`**。

**但 QOS 编排通道没有这条线**：

- `apps/agentcore/src/tools/executor.ts:401` 是 `this.deps.dataCore.solver.invoke(ctx, String(args.solverKey), (args.args ?? {}) as Record<string, unknown>)` —— **第四个参数 `signal` 不传**。
- 任务级取消是**轮询标志**：`orchestrator.ts:401` 的 `private readonly cancelled = new Set<string>()`，经 `isCancelled: () => this.cancelled.has(taskId)`（`orchestrator.ts:1752/2090/2299`）在 loop/step 边界检查（`executor.ts:109`、`loop.ts:734`）。**边界之间正在跑的 DataCore 求解不受影响，跑到底**。

→ 长流程 Runtime 若不补这半条，"点取消"在图上等于"不再等"，与 D1 修掉的病同形。

### 1.4 病灶 D · 过程可见在半数路径上结构性为 0

WO E9 实测（对照实验，非 grep）：同一份 LLM 脚本、同样点亮 `qos.reasoning-trace`，path-B 单 agent **往返 2 次 → 旁白 1 条**；Coordinator **往返 6 次 → 旁白 0 条**。前端 💭 气泡早已写好（`apps/frontend-shell/src/components/QueryDock/Timeline.tsx:57,73-85`）。

**本会话在本分支复核的现状（已部分修复，其余仍缺）**：

| 执行路径 | 入口 file:line | `emitNarration` | 结构化进度 |
|---|---|---|---|
| path-B 通用探索 | `orchestrator.ts:1736 runAgentLoop` | ✅ `:1743` 传 | ❌ 无 |
| Coordinator 多角色 | `orchestrator.ts:2233 runWorkflowSteps` | ✅ `:2243` 传（`518e46b1` 落地） | ❌ 无 |
| **单域角色 agent** | `orchestrator.ts:2081 runRegisteredAgent` | ❌ **不传** → 恒 0 条 | ❌ 无 |
| **场景入口 agent**（AGENT_FIRST/ONLY） | `orchestrator.ts:2291 runRegisteredAgent` | ❌ **不传** → 恒 0 条 | ❌ 无 |
| path-A 确定性 plan | `executor.ts:106/127` | n/a（无 LLM，本就无旁白） | ◐ 有 `step.started/completed`，无阶段/预算余量 |
| 确定性多域并行 | `multi-route.ts:199/215/232` | n/a | ◐ **只发 `step.completed`，不发 `step.started`** → 前端 `running` 态永远点不亮 |
| 同步求解通道 | `server.ts:1746` | n/a | ❌ 无任何过程事件（`isFetching` 二值） |

两条结构性观察（本会话核实，是设计的硬约束）：

- **a) 角色标识靠"串行序"推导** —— `orchestrator.ts:2203-2211` 注释与实现明写：「角色归属靠 workflow executor 的**串行步序**确定性推导：executor 逐步 `for (const step of input.steps)` 串行执行并先发 `step.started`（`workflow/executor.ts:104-106`）→ 记住当前 `dispatch_i` 即当前角色」。
  → **并行化会直接打断这条推导**：三路交错发 `step.started`，`current` 指针串台，旁白会挂到错误的角色名下。**并行边与角色标识必须同一单做**，拆开必炸。
- **b) 结构化 role 字段今天零消费方** —— orchestrator `:2222-2229` 发出 `role`/`roleLabel`/`agentId`，而前端 `apps/frontend-shell/src/sse/taskStreamReducer.ts:139-160 selectStepRows` **只取 `stepId/type/outcome/durationMs/text`**，role 三字段被丢弃；角色之所以还看得见，是因为 `:2228` 把 `【label】` 前缀**塞进了 text**。这是 #92 同族的第四例：发了没人读。

### 1.5 病灶 E · Runtime 的第一站排在第 14 位

SPEC §8 的 Runtime 链首两站是「Intent 识别 → Skill 匹配」。仓里的 LLM 分类器在 `apps/agentcore/src/router/orchestrator.ts:727`，其**上游有 13 个可 `return` 的决策点**（本会话逐行核实）：

| # | 门 | file:line | 判据种类 | 命中去向 |
|---|---|---|---|---|
| 1 | 场景入口 AGENT_FIRST/ONLY | `orchestrator.ts:521` | 配置 | `runSceneAgent` |
| 2 | 候选池空 | `orchestrator.ts:545` | 结构 | path-B / WORKFLOW_ONLY miss |
| 3 | 场景卡确定性绑定 | `orchestrator.ts:566` | 显式 `scenarioIntentKey`（内含正则抽参 `:574`） | path-A |
| 4 | S01 场景变体继承 | `orchestrator.ts:598` | **正则/结构签名** | path-A |
| 5 | 沙盘 NL 指挥 | `orchestrator.ts:603` | 上下文标志 | path-B |
| 6 | ② 确定性多域分路 | `orchestrator.ts:625` | **关键词打分** | `runMultiRoute` |
| 7 | Coordinator 多角色会诊 | `orchestrator.ts:637` | **正则共现** | `runCoordinator` |
| 8 | opt-whatif 路由 | `orchestrator.ts:651` | **关键词** | path-A |
| 9 | A 确定性优先门 | `orchestrator.ts:667-672` | **关键词打分** | path-A |
| 10 | L2 真分解 | `orchestrator.ts:690` | **长度/复合度**（`ceo-route.ts:217` `q.length >= 24`） | `runParallelRoutes` |
| 11 | free-LLM 深问 | `orchestrator.ts:695` | 同上 | `runCeoFreeLLM` → path-B |
| 12 | 确定性绑定（原位·块级/CEO） | `orchestrator.ts:709` | **正则**（`ceo-route.ts:187 isCeoQuestion`） | path-A |
| 13 | 单候选短路 | `orchestrator.ts:714` | 结构 | path-A |
| **14** | **LLM 分类器** | **`orchestrator.ts:727`** | LLM | τ 决策 |

> **口径说明（不与 WO 打架）**：WO 记的是「分类器排第 11 站、前有 10 道正则门」，口径是跨 4 个文件的**正则门**计数；本表口径是 `runPipeline` 内**可 return 的决策点**计数（含配置/结构门）。其中判据为正则/关键词/长度启发的是 #4、6、7、8、9、10、11、12 共 **8 道**（另 #3 内含正则抽参）。两个数字不矛盾，是两种数法；施工时以本表 `file:line` 为准。

→ **不拆门，新 Runtime 照样被劫持**：一道门在 Skill 尚未参与时就 `return`，则该题的 `maxBudgetRounds` / `progress.phases` / Reasoning Graph 一个都不会生效。裁决见 §7。

---

## 2. 目标与非目标

**目标**

1. G1 · **并行边**：Reasoning Graph 的独立节点真并发执行，且**不引入第三套扇出**。
2. G2 · **确定性可保**：图节点允许是确定性求解器/规则；全 PURE 图与今天线性 plan **字节等价**。
3. G3 · **按题型预算**：`maxBudgetRounds` 等从"字段存在"变成"改这个数 → 该类题实际轮次真变"。
4. G4 · **取消到底**：任务取消/超时穿透到 DataCore 求解，继承 D1 语义。
5. G5 · **过程真发**：progress 在**每条会走到它的路径上**都发，且新增路径不可能漏接（结构保证 > 纪律保证）。
6. G6 · **Skill Graph**：多 Skill 编排与 `dependsOn` 有真语义、真校验、真运行。

**非目标（明确排除，防长成上帝对象）**

- 不定义 Skill 契约字段最终形态（→ Skill 契约 PRD）；本文只声明 Runtime 消费哪些字段、怎么消费。
- 不做 Skill CLI / 编译器 / `.skill` 包 / 签名（→ Skill Compiler PRD）。
- 不改路由门次序（→ WO-ROUTING-RETRIEVAL-FIRST Track A）；本文只声明依赖关系与接口。
- 不引入第二套规则语法/约束 DSL（SPEC §5 定案：引用不内联）。
- 不做真 token 级流式（Track C5/B3-d，依赖 `packages/llm-adapters` 接 streaming，跨包）。
- 不做跨请求持久化图运行态（Phase 2，见 §3.6）。

---

## 3. Reasoning Graph

### 3.1 结构（契约位于 `@platform/contracts`）

```
ReasoningGraph {
  nodes: ReasoningNode[]          // ≥1，含至少一个可达 render 节点（R11）
  edges: ReasoningEdge[]          // 有向无环（编译期 DFS 检环）
  entry: nodeId[]                 // 入度 0 的节点集（可多个 = 天然并行起点）
}

ReasoningNode {
  id            : string                    // 图内唯一
  kind          : "agent" | "solver" | "rule" | "human"
                | "slice" | "render" | "mcp" | "compose"     // 前四类为 SPEC 要求，后四类为既有步的图内表达
  determinism   : "PURE" | "LLM"            // 派生自 kind（agent/compose = LLM，其余 PURE），显式写出以便门校验
  params        : Record<string, TemplateValue>   // 与今天 PlanStep.params 逐字段同构
  role?         : string                    // 角色标识（Coordinator 扇出用）—— **并行后角色必须由节点自带**
  phase?        : string                    // 对应 Skill.progress.phases[]（过程可见的语义名）
  onError?      : "FAIL" | "SKIP"           // 与今天 PlanStep.onError 同义
  timeoutMs?    : number
  budgetWeight? : number                    // 预留：跨节点预算分配（Phase 2）
}

ReasoningEdge {
  from : nodeId
  to   : nodeId
  kind : "seq"        // 数据/顺序依赖：to 必须在 from 完成后开始
       | "parallel"   // 显式声明可与兄弟并发（语义上等价于共同前驱的多条 seq，独立标出以便审阅与门校验）
       | "cond"       // 条件边：guard 为确定性纯谓词（见 3.3），假则 to 及其后继整体 SKIP
  guard? : DeterministicPredicate   // 仅 kind="cond"
}
```

**节点类型 ↔ 今日派发的一一对应**（这就是"不造新执行器"的落点）：

| 节点 kind | 今日 `PlanStep.type` | 今日派发位置 |
|---|---|---|
| `solver` | `invoke_solver` | `executor.ts:133-141` → `tools/executor.ts:400` |
| `rule` | `evaluate_rules` | `executor.ts:134` + BLOCK 短路 `executor.ts:201-213` |
| `agent` | `invoke_agent` | `executor.ts:268-296` → `engine.runRegisteredAgent` |
| `human` | `create_action_draft` + `approvalGate` | `executor.ts:135` + Action `approvalChain` |
| `slice` | `resolve_slice` / `plan_slice` | `executor.ts:131/138` |
| `render` | `render_answer` | `executor.ts:315-325` |
| `mcp` | `invoke_mcp_tool` | `executor.ts:298-313` |
| `compose` | `llm_compose` | `executor.ts:251-266` |

### 3.2 编译：线性 plan → 链式图（零行为漂移的唯一入口）

```
compileGraph(source) :
  source = Skill.execution.graph            → 直接用
  source = ExecutionPlan.steps[]（legacy）   → 链式图：node_i --seq--> node_{i+1}，逐字段搬运 params/onError/timeoutMs
```

- **默认保守**：legacy plan 一律编成**全 seq 链**，即便相邻步之间没有 `{{steps.X}}` 引用。理由：今天的 plan 从不声明依赖，盲目推断并行会破坏隐式副作用顺序（如 `invoke_solver` 的 M11 forecastSnapshots 副作用，`tools/executor.ts:218` 注释已载明），"更快但偶尔错"是本仓最贵的错法。
- **并行只能显式声明**：想并行必须在 Skill 的 `execution.graph` 里写出 `parallel` 边。**没有隐式提速**。
- 副产物 `derivedEdges`（从模板引用 `{{steps.X.output}}` 反推的真实数据依赖）只作**审阅提示与门校验**：若作者声明了 `parallel` 边但存在跨这条边的模板引用 → **编译拒绝**（防"声明并行、实际读了没跑完的兄弟输出"）。

### 3.3 确定性红线（R6 · 本文最要害的一条）

> 今天 32 个意图走确定性 plan：秒级、同输入同输出、可溯源。**Reasoning Graph 必须允许节点是确定性求解器**，否则会把全链唯一没病的一段变成有病的。

三条硬规定：

1. **`Skill.execution.mode = DETERMINISTIC` 的图内不得出现 `determinism:"LLM"` 节点**（即 `agent`/`compose`）。违反 → 发布期拒绝（`skill-lint` 扩一条规则）。
2. **`cond` 边的 guard 必须是确定性纯谓词**：只允许对上游节点输出做 `exists / eq / neq / gt / gte / lt / lte / in / notEmpty` 这九种比较（枚举封闭，非表达式求值），禁止函数调用、禁止 `Date.now()`/随机、**禁止调 LLM 判分支**。理由：一旦分支靠 LLM 判，同输入不同输出，R6 当场破。
3. **调度顺序不得影响结果**：并行波内节点产物写入 `stepOutputs` 的顺序按**节点声明序**（非完成序）归并；答案块装配、⟦ref:N⟧ 编号同样按声明序。→ 同一张图重跑，即便网络抖动导致完成顺序不同，answer 与 provenance **字节一致**。

### 3.4 调度器：三处扇出收敛成一处

**问题**：今天已有两处并行/串行扇出实现（§1.1），Reasoning Graph 会是第三处。

**决策**：新增**唯一**的 `GraphScheduler`，把三者收编：

| 今日形态 | 收编后 |
|---|---|
| `executor.ts:104` 线性 for…await | 链式图（全 seq 边），调度器逐波执行 → **行为逐字节不变** |
| `multi-route.ts:210` 多域 `Promise.all` | 一张「N 个独立 solver 节点 + 1 个 render 节点」的图；`assembleMultiDomainAnswer` 成为该 render 节点的装配器 |
| `orchestrator.ts:2233` Coordinator 串行扇出 | 一张「N 个 `agent` 节点（`parallel` 边）+ 1 个 synthesize render 节点」的图 |

**调度算法**（确定性拓扑波前）：

```
ready = entry 节点集（按声明序排序）
while ready 非空:
    wave = ready 中所有前驱已完成且未被 cond 剪枝的节点（按声明序）
    并发执行 wave（Promise.allSettled）—— 组内并发上限 = min(wave.length, maxParallelNodes)
    归并产物（按声明序写 stepOutputs）
    重算 ready
```

- `maxParallelNodes` 缺省 = wave 全宽；部署态可经 env 收紧（须登记进 `deploy-governance:check`）。
- **失败传播**：某节点 `onError=FAIL` 且失败 → 立即 abort 同波兄弟（§5.4）→ 整图 FAILED；`onError=SKIP` → 该节点及其纯后继标 SKIPPED，其余照跑（今天 `executor.ts:169-173` 的 SKIP 语义原样保留）。
- **规则 BLOCK 短路**：`rule` 节点判出 BLOCK → 与今天 `executor.ts:212-213` 同义，整图终止并返回 rule_violation 模板答案（COMPLETED 非 FAILED），同波兄弟按失败传播规则 abort。

**为什么不是"给 executor.ts:104 的循环加个 Promise.all"**：因为今天的 `steps[]` **不带依赖信息**，任何自动分组都是猜；且加了之后 `multi-route.ts` 与 Coordinator 仍是各自一套。这条路会把"三处扇出"变成"四处扇出"。

### 3.5 并行边的三条不变量（并发安全）

**a) 预算 reserve-then-run（新增不变量，`graph-runtime:check` 守）**

Node 单线程不代表没有竞态：`await` 之间的 check-then-act 会让 N 路并行**各自看到未耗尽的预算**而超发。规定：**预算消费必须在发起调用前同步完成**（先扣后跑，失败则该节点直接 BUDGET_EXCEEDED）。

今天 `apps/agentcore/src/tools/executor.ts` 已是 run 前 `tryConsume`（`tools/budget.ts:57` 同步方法），本条把既有实现**钉成不变量**，防并行化时被改成"跑完再扣"。呼应 `G-WORKFLOW-BUDGET-LEAK` 的同族风险。

**b) 角色/身份必须由节点自带，不得靠"当前串行步"推导**

`orchestrator.ts:2203-2211` 今天的做法（记住当前 `dispatch_i` 即当前角色）在并行下必然串台。规定：`role`/`roleLabel`/`agentId`/`phase` 由 `ReasoningNode` 自带，emit 时从**该节点的执行上下文**读，与全局"当前指针"无关。

同时修 §1.4-b：`stepId` 前缀改为 `nodeId/…`（今天用 `dispatch_i/narration-j` 前缀防 Map 覆盖，图化后 nodeId 天然唯一）。

**c) 取消是波级的，不是全局标志轮询**

见 §5。

### 3.6 `human` 节点（长流程审批）

SPEC §1-⑩ 要求 `Trigger → 数据准备 → 模型计算 → 专家审核 → 生成方案 → 审批 → 执行`。仓里**有审批链**（Action `approvalChain` 1–3 级），但**没有跨请求存活的工作流运行态**：`apps/agentcore/src/workflow/checkpoint.ts:22` 是 `NoopWorkflowCheckpointStore`（本会话核实；本体 §8 G-11 亦载明）。

**分期决策（诚实边界）**：

- **Phase 1（本 PRD 范围）**：`human` 节点 = **非阻塞**形态 —— 产出 `ActionDraft`（走既有 `create_action_draft` 派发 + `action_draft.created` 事件），图在此节点后**以 render 收口**，答案含 action_draft 块。语义与今天完全一致，**不承诺"图会等审批回来再往下跑"**。
- **Phase 2（另立单）**：跨请求 resume。落点**不新造**：范式复用 DataCore `BuildWorkflowRun`（本体 §2.A：6 步持久化状态机 + 检查点 + resume + 孤儿恢复 + `buildworkflow.*` 可观测流），迁移四处同改（R9）。
- **红线**：Phase 1 的 UI/文案**绝不**出现"等待审批中，审批后自动继续"——那是界面替后端许一个它兑现不了的承诺（同 WO D5 对 D1 的硬依赖判据）。

---

## 4. 预算与红线按题型声明

### 4.1 现状（§1.2 已给证据）

一个全局常数服务所有题：`DEFAULT_AGENT_BUDGET`（24 轮 / 8 次盲扫）+ env 收紧（建议 4 / 1）→ 9 个 `BudgetTracker` 站点。`maxBudgetRounds` 零消费方。

### 4.2 消费方接线（本 PRD 的核心增量）

```
Skill.budget {                      ← 声明（Skill 契约 PRD 定字段，本文定语义）
  maxBudgetRounds?    : number      ← 已有字段，本次接消费方
  maxDiscoverCalls?   : number      ← 新增（additive optional）
  expectedDurationMs? : number      ← 新增（用于进度呈现的"预计"，不作硬门）
  cancellable?        : boolean     ← 新增（默认 true；false 仅用于不可中断的原子写回节点）
}
        │
        ▼  orchestrator 在**绑定 Skill 之后、建 BudgetTracker 之前**组装
resolveTaskBudget(skill, config) → Partial<AgentBudget>
        │
        ▼  单一入口（替换今天 9 处各自 `new BudgetTracker(this.residualBudgetFromConfig())`）
new BudgetTracker(resolved)
```

**接线点清单**（9 处全覆盖，漏一处即"某条路径上 Skill 预算无效"，正是 E9 同族债的形状）：
`orchestrator.ts:882`（多域）· `:981`（L2/多意图）· `:1439`（path-A workflow · `proceedWithIntent` 段）· `:1617`（residual path-B）· `:2077`（角色 agent）· `:2195`（Coordinator）· `:2286`（场景 agent）· `server.ts:1146` · `skill-probe.ts:377`。

> 施工要求：这 9 处必须改为**同一个工厂**产出预算，并由 `graph-runtime:check` 静态断言"无裸 `new BudgetTracker(` 调用点"，否则下一个新路径又会漏。

### 4.3 优先级链：Skill 只能收紧，不能放宽

```
effective = min(env 部署上界, Skill 声明值, DEFAULT)
```

理由：`G-SHIP-CONFIG-IGNORES-CODE`（#88）刚坐实"代码里的建议值出货容器不照做"。若允许 Skill 声明放宽，等于给每个 Skill 作者一把绕过部署治理的钥匙——治理开关会在**数据里**被悄悄放开，而 `deploy-governance:check` 只看得见 compose 文件。

**诚实标注**：当 Skill 声明值被 env 上界压住时，`AgentRunRecord` 须记 `budgetClamped: {declared, applied, by:"env"}`，并在 degrade 文案里说明"本次受部署上界限制"，不许悄悄按小的跑却让作者以为按大的跑。

### 4.4 效果层验收（不接受运输层断言）

| 判据 | 断言 |
|---|---|
| **B1（头号）** | 同一道探索题、同一份 mock LLM 脚本：`skill.maxBudgetRounds=2` vs `=6` → `AgentRunRecord.iterations` / `budget.roundTrips` **实际不同**（2 时 ≤2，6 时 >2）。**只断言"字段读出来了"不算过** |
| B2 | `=2` 时以 `degrade(BUDGET_EXHAUSTED)` 诚实收尾（诚实部分发现），**不是空答、不是 500**（复用 `loop-control:check` 的唯一诚实出口口径） |
| B3 | env `QOS_AGENT_MAX_ROUND_TRIPS=3` + `skill.maxBudgetRounds=6` → 实际 ≤3，且 `budgetClamped.by="env"` 出现在 run 记录里 |
| B4（反证） | 删掉 `resolveTaskBudget` 的消费点 → B1 变红（先证 `tsc --noEmit` RC=0，确保红的不是编译红） |
| B5（覆盖） | 9 个预算站点各跑一次同一 Skill，`applied` 值全相同（防"只接了主路径"） |

---

## 5. 取消语义（继承 D1）

### 5.1 现状与缺口（§1.3 已给证据）

- ✅ 同步求解通道：`server.ts:1746-1789` → `datacore-http.ts:216 fetch(signal)` → `datacore/src/solvers/cancellation.ts`（ALS）→ sidecar/沙箱/循环检查点。
- ❌ QOS 编排通道：`tools/executor.ts:401` 不传 signal；任务级取消是 `Set<string>` 轮询标志。

### 5.2 Runtime 取消模型（三层，一根信号贯穿）

```
① 任务级   POST /queries/{taskId}/cancel（QOS-PRD §8.3）或 SSE 客户端断开
              → 现有 `cancelled.add(taskId)`（保留，向后兼容）
              → **新增** 每 task 一个 AbortController（RuntimeContext 持有）
② 图级     GraphScheduler 监听 signal：
              · 未开始的波：不再启动（等价于今天的边界检查）
              · 在跑的节点：逐个 abort（下沉到 ③）
③ 节点级   node.signal → GuardedToolExecutor.run(..., {signal})
              → dataCore.solver.invoke(ctx, key, args, **signal**)   ← 补 executor.ts:401 的缺口
              → OBO fetch(signal) → DataCore reply.raw "close"
              → runWithCancellation(ALS) → sidecar fetch / 沙箱 SIGKILL / 循环检查点
```

**关键补线**：`tools/executor.ts:401` 增第四参 `signal`。这是 D1 已经修好的下半条链**在 QOS 通道上的接口**——链的下游全部现成，缺的只是这一个参数。

### 5.3 取消与超时的关系（不把"慢"当"坏"）

WO Track B3 判定：超时应是**信号**不是**判决**。本文只做**不越界**的部分：

- 节点超时（`node.timeoutMs`）触发 → **先发一条现场取证 `step.completed`**（`type=node_timeout_diagnostic`，伪 step，不新增事件名），载荷含 `nodeId/nodeKind/modelId?/elapsedMs/budgetLeft/toolCallsSoFar`，**再**执行取消。
- 分流处置（换非推理档重试 / 裁剪输入重试 / 延长一次）属 Track B3-c，**不在本文范围**；本文只保证"取证包在取消之前发出去了"，让 B3 落地时有数据可用。
- 顺序要紧（D1 已踩过）：**先定死对外结果，再 abort**——否则取消信号的同步监听会让被取消的错误抢跑赢，把 504 塌成 500（`server.ts:1770-1773` 注释原文记录了这一次真实踩坑）。图调度器沿用同一顺序。

### 5.4 并行波内的取消策略

| 情形 | 处置 |
|---|---|
| 用户取消整任务 | 全波 abort；`task.cancelled` 载荷带 `cancelledNodes[]` |
| 某节点 FAIL 且 `onError=FAIL` | **立即** abort 同波兄弟（省服务端算力；这正是 D1 病灶"叠加求解压垮优化器"的图版本） |
| 某节点 FAIL 且 `onError=SKIP` | 兄弟继续；该节点产物置 null（今天 `executor.ts:170` 同义） |
| 某节点声明 `cancellable=false` | 不 abort 它，但**不再等它的结果**，并在答案里诚实标"该节点已脱离本次任务，可能仍在后台执行" |

### 5.5 诚实边界（照抄 D1 的诚实位，不粉饰）

`apps/datacore/src/solvers/cancellation.ts:24-32` 已写明：**CP-SAT sidecar 进程本身不可取消**（`services/optimizer/server.py` 是 `ThreadingHTTPServer`，无取消接口、不感知客户端断开）；单次同步 `compute()` 在 Node 单线程内也无法从外部打断，取消只在 `await` 边界/循环检查点生效。

→ Runtime **绝不报告"已取消"来掩盖下层仍在跑**。`cancelledNodes[]` 只列真收到并响应了取消的节点；不可取消的节点标 `detached:true`。

### 5.6 效果层验收

| 判据 | 断言 |
|---|---|
| **C1（头号·真跑）** | 提交一张含 3 个并行 solver 节点的图（stub 求解 600ms），300ms 后 `POST /queries/{taskId}/cancel` → DataCore 侧探针 **3 个 solver 全部 `finished=0`**（复用 `apps/agentcore/test/solver-cancel-seam.test.ts` 的探针范式：`started/finished` 计数 + 是否收到 signal） |
| C2 | 同上但不取消 → 3 个全部 `finished=1`（证探针有效，不是恒 0 的假绿） |
| C3 | 节点超时 → `node_timeout_diagnostic` 伪 step **早于** 取消动作发出，且载荷含 elapsedMs/budgetLeft |
| C4 | `onError=FAIL` 的兄弟被 abort：故意让节点 A 立即失败，断言节点 B/C 的 DataCore 侧 `finished=0` |
| C5（反证） | 去掉 `executor.ts:401` 的 signal 透传 → C1 变红（先证 `tsc --noEmit` RC=0——类型系统看不见这种断线，D1 已证） |

---

## 6. 过程可见：progress 在每条路径上都真发

### 6.1 目标陈述

Skill 声明 `progress.emitsNarration` 与 `progress.phases[]`；Runtime **保证**：凡走到该 Skill 的路径，进度事件都真发。「声明了 → 点亮了 → 这条路径上没接线」（#90/#92/E9 同一形状）必须被**结构**堵死，而不是靠下一个 dev 记得传参。

### 6.2 事件承载（零新事件名）

复用 `step.started`/`step.completed` 伪 step（既定范式：narration `loop.ts:848`、多域 `multi-route.ts:199`、DRIL 注入 `orchestrator.ts:1702`）：

| 伪 step type | 何时发 | 载荷要点 |
|---|---|---|
| `node_started`（或直接用真 `step.started`） | 每个节点开始 | `nodeId/nodeKind/phase/role/roleLabel` |
| `agent_narration`（既有） | agent 节点每轮思考旁白 | 既有字段 + `nodeId/role/roleLabel`（**由节点自带**，§3.5-b） |
| `node_progress` | agent 节点每轮边界 | `iteration/toolsUsed[]/elapsedMs/budgetLeft`（Track C2 要的结构化进度，非流式也能发——每轮边界是天然进度点） |
| `node_timeout_diagnostic` | 节点超时 | §5.3 |

**必须补的一处**：`multi-route.ts` 今天只发 `step.completed` 不发 `step.started`（§1.4 表）→ 前端 `selectStepRows` 的 `running` 态永远点不亮。图化后由调度器统一发 `started`，这条自动消失。

### 6.3 结构保证：`RuntimeContext` 统一工厂（本文最重要的一条防复发设计）

**病根形状**：`emitNarration` 今天是**每个调用点各自决定传不传**——于是 `runPathB` 传了（`:1743`）、Coordinator 后来补传了（`:2243`），而 `runRolePathB`（`:2081`）与 `runSceneAgent`（`:2291`）**至今不传**。新增第 5 条路径时，同样会忘。

**结构解**：把"这次任务的可观测/预算/取消/租户"收进一个 `RuntimeContext`，由**唯一工厂**产出，所有执行入口只接受它：

```
makeRuntimeContext({ task, auth, skill, enabledFeatures, config }) → RuntimeContext {
    tenantId, taskId,
    budget      : BudgetTracker        // §4.2 单一入口
    signal      : AbortSignal          // §5.2 单一信号
    emit        : (event, payload) => Promise<void>
    observability: { emitNarration, phases }   // 从 Skill.progress + feature flag 一次算出
}
```

- 执行入口（`runAgentLoop` / `runWorkflowSteps` / `GraphScheduler` / `runRegisteredAgent`）**只接 `RuntimeContext`**，不再逐参数透传。
- 门 `progress-reachability:check`：静态断言全仓**无裸构造**（不存在直接给 `runAgentLoop` 传散装 `emitNarration/budget/isCancelled` 的调用点）。green→red 有牙：新增一个裸调用点 → 门红。
- 收益不是整洁，是**新增路径不可能漏接**——这正是 #90/#92/E9 三条债共缺的东西。

### 6.4 前端半（必须同一 dev 整单做）

- `apps/frontend-shell/src/sse/taskStreamReducer.ts:139-160 selectStepRows` 扩 `role/roleLabel/nodeId/phase/iteration/budgetLeft`（今天全被丢弃，§1.4-b）。
- `Timeline.tsx` 按 `role` 分栏呈现多角色并行进度（Track C3）；长静默显示「某角色仍在思考（已 xx s）」而非空白。
- **红线**：前端不得为了好看而造中间态（WO C6 诚实边界原文）。没有 `node_progress` 就只显示"求解中 + 已耗时"。

> **为什么是一个 dev**：C1 是后端接线、C3/C4 是前端消费，拆开做必然出现"后端发的字段前端不认"或"前端等的事件后端不发"——本仓老坑高发区（WO 四之二原话）。

### 6.5 效果层验收

| 判据 | 断言 |
|---|---|
| **D1（头号·路径全覆盖）** | 对**每条**执行路径（path-B / Coordinator / 角色 agent / 场景 agent / path-A / 多域并行）各跑一次同一个声明了 `emitsNarration` 的 Skill：进度事件数 **> 0**。今天该表有 2 条路径恒 0（§1.4），此判据直接咬住 |
| D2 | 并行三节点、**打乱完成顺序**（stub 让 C 先完成、A 最后）→ 三路旁白的 `role` 标识各自正确、不串台（咬 §3.5-b） |
| D3 | 前端断言：`selectStepRows` 产出的行含 `role` 字段且渲染出分栏（**不接受**"role 塞在 text 前缀里"作为通过条件——那是今天的绕法） |
| D4 | 首个进度信号到达时间 ≤ T（T 由 §3.4 并行落地后的实测首轮时延定，立单时填实测值，不预设） |
| D5（反证） | 从 `RuntimeContext` 工厂里去掉 observability 透传 → D1 全红 |

---

## 7. Runtime 链第一站与 Track A 的关系（必答题）

### 7.1 裁决：**前置依赖 · 但精确到 Phase 2，且有一条必须合并实施的交集**

| Track A 分期 | 与 Runtime 的关系 | 说明 |
|---|---|---|
| **Phase 0**（先量后改·DRIL 金标集与召回率） | **可并行** | 纯度量，不改生产代码；Runtime 不依赖其结论即可施工 |
| **Phase 1**（给 10 道门打 `routeSource` 标签） | **必须合并实施** | 见 7.2 |
| **Phase 2**（正则门降级为白名单） | **Runtime 的硬前置** | 见 7.3 |
| **Phase 3**（检索前置 / 分类器吃收窄目录） | **可后置** | Runtime 不依赖；两者落地后收敛为"一处检索 + 一处声明" |
| **Phase 4**（`discover` 补 intents kind / 探索强制序） | **可后置** | 但探索强制序与 Reasoning Graph 的 `entry` 语义有重叠，立单时须交叉评审防造两套 |

### 7.2 必须合并实施的交集：`routeSource` + `skillKey` 是同一条载荷

Track A Phase 1 要给每道门打 `routeSource`（哪道门做的决定）；Runtime 需要在同一条 `routing.completed` 上标 `skillKey`（本题最终由哪个 Skill 执行）——**因为验收判据要能回答"这题走了哪道门、最终用了谁的预算"**。

若拆两单做，必然出现两套标签口径（一套叫 `routeSource`、一套叫 `route`/`source`/`model` 前缀），而 `classification.model` 今天已经在承担半个标签职责（`deterministic:ceo-route` / `agent:role:<role>` / `llm-multi-intent` …）。**同一份载荷两处定义 = 两处会漂**（§0.4 R-一致）。

→ **合并成一张 WO**：`routing.completed` 载荷补 `{routeSource, skillKey}` + metrics 计数器 `qos_route_source_total{source,skill}`（今天 `apps/agentcore/src/metrics.ts` 无此计数器，本会话核实）。

### 7.3 为什么 Phase 2 是硬前置（不拆门会怎样）

具体路径，不是泛论：

1. 用户问「常州 4680-NCM 涂布良率掉了，交付还来得及吗」。
2. `orchestrator.ts:637` 的 Coordinator 门（正则共现）在**任何 Skill 参与之前**开火 → `runCoordinator`。
3. Coordinator 用的是 `residualBudgetFromConfig()`（`:2195`）—— **全局 env 预算**，与任何 Skill 的 `maxBudgetRounds` 无关。
4. 结果：作者给这类题声明了 3 轮，实际按全局 24（或 env 4）跑；声明的 `phases[]` 一个都不会出现；声明的 `execution.graph` 一个节点都不会被调度。
5. 用户看到的是 WO E11 记录的那一类失败：**出厂场景自己的注册原句都会落错意图**（80 条措辞用例 74/80，失败 6 条全部 `model=coordinator`，集中在 S12 `yield_diag` 与 S13 `maint_stagger`）。

→ **不拆门，Runtime 只对"漏网之题"生效**。这会制造最坏的一种假象：Skill 声明齐全、门全绿、而线上大部分题根本没走 Runtime。这正是本仓反复吃亏的「声明了没接线」，只是换了一层。

**Phase 2 的最小充分条件**（Runtime 立单可以只等这一条，不必等 Phase 3 全量检索前置）：每道门从"认得半个词就拦截"改成"**显式白名单才短路**"，判据不满足即放行下游。这一步不动次序、风险最低，且 E1 类事故整类消失。

### 7.4 依赖图（可执行的分期）

```
Track A Phase 0（度量·可并行）
Track A Phase 1  ⊕  Runtime W1（routeSource + skillKey 同一载荷）   ← 合并一 WO
Track A Phase 2（白名单化）
        │  硬前置
        ▼
Runtime W2（Reasoning Graph 编译 + 调度器 + 三处扇出收编）
Runtime W3（RuntimeContext 统一工厂 + 预算接线 + 取消补线 + 进度全路径）  ← 与 W2 同一 dev 或紧邻
        │
        ▼
Runtime W4（Skill Graph / dependsOn 内联 + 引用可校验硬门）
        │
        ▼
Runtime W5（human 节点跨请求 resume · 依赖持久化运行态 · 另立）
```

---

## 8. Skill Orchestrator / Skill Graph

### 8.1 `dependsOn` 的运行时语义（今天 7/7 空 · 零语义）

**定为「发布期硬依赖 + 编译期内联展开」**，而不是"运行期新起一个子 agent 会话"：

```
Skill A.dependsOn = [B]
  → A 的图里可出现 kind="skill" 的引用节点（ref=B）
  → compileGraph 在**编译期**把 B 的图内联展开进 A 的图（节点 id 加 `B/` 前缀防碰撞）
  → 运行期只有一张扁平图：预算共享、取消共享、⟦ref⟧ 溯源共享、progress 同一条流
```

**为什么不是子会话**：子会话 = 又一个预算边界 + 又一条取消链 + 又一处进度可能漏接（`G-WORKFLOW-BUDGET-LEAK` 与 E9 的合体）。内联展开让"多 Skill 编排"退化成"一张更大的图"，**复用全部已建的图机制**。

### 8.2 环与深度

- **编译期检环**：`skill-lint.ts:194-232 detectSkillDependencyCycle` 已有 `dependsOn` 图有向环检测（按 key 归一化，忽略版本），**复用不新造**。
- **展开深度上界**：复用 `apps/agentcore/src/runtime.ts:27 MAX_DEPTH = 3` 的口径（`enterNesting` 的 callChain 语义），编译期即拒绝超深，避免运行期才炸。
- **节点数上界**：展开后总节点数上界（建议 64，立单时定）——防"三层 dependsOn 展开成千节点图"，超限拒绝发布。

### 8.3 引用可校验硬门（SPEC §5 的"直接新增能力"）

今天 `skill-lint.ts:165-191 validateRefResolution` **只解析 `kind=skill`** 的引用——第 175 行原文 `if (ref.kind !== "skill") continue; // 非 skill 引用由发布时的跨系统探针或各自注册表保证`。

⚠ **本会话核实：那个"发布时的跨系统探针"不存在。** 发布端点 `apps/agentcore/src/server.ts:1230-1268` 串的是 lint → 评测用例数 → 三类覆盖 → `runSkillProbe`，**没有任何一处校验 `solver`/`rule`/`slice`/`ontologyType` 引用的 key 真已注册**。即出厂 Skill 的 `references: [{kind:"solver", key:"capacity_forecast"}]` 若写成 `capacity_forecastX`，今天照样发布得出去，运行期才炸。这是 SPEC §5「必配硬门：引用可校验（否则引用退化成空指针）」的实测缺口。

**扩到全 kind**（契约现有 8 类：`packages/contracts/src/agentcore.ts:216 SKILL_REFERENCE_KINDS = ["rule","constraint","slice","ontologyType","solver","skill","workflow","agent"]`）：

| kind | 权威源 | 校验方式 |
|---|---|---|
| `solver` | `apps/datacore/src/solvers/service.ts:44 SOLVER_KEYS`（57） | 跨系统只读端点 + `SERVICE_TOKEN`（B→A 已有服务间通道），带 60s 缓存 + `{kind}.updated` 事件失效（本体 §5 既有约定，传播 SLO ≤60s） |
| `rule` | 已发布规则库（C01–C33） | 同上；呼应 `rule-closure:check` 口径 |
| `slice` | `SliceSpec` / 切片库 | 同上 |
| `ontologyType` | 已发布本体 ACTIVE 类型 | 同上 |
| `workflow`/`agent`/`skill` | 本租户 PUBLISHED | 本地（今天只做了 `skill` 一类） |
| `constraint` | **无权威注册表** | ⚠ SPEC §5-C2 定案「约束只在求解器里定义一次」→ `constraint` 这个 kind 今天**没有独立真值源可校验**。处置二选一（归 Skill 契约 PRD 定）：① 退役该 kind（约束经 `solver` 引用表达）② 定义为 `solver.constraintFamily` 的子引用并随 solver 一起校验。**不得**留一个"校验不了但看起来能校验"的 kind |

**契约缺口（不在本文改，登记给 Skill 契约 PRD）**：SPEC §5 的引用清单含 `tools[]` 与 `mcp[]`，而 `SKILL_REFERENCE_KINDS` **无 `tool`/`mcp`**（本会话核实）。要么扩枚举，要么另设字段——两种都属契约决策；Runtime 侧只承诺"契约里有的 kind，装载时全部校验"。

**反向收益**（SPEC §5 原话）：「改 C08 会影响哪些 Skill」变成一次查询，而不是 grep（grep 会骗人）。

**两处已知的接线诚实边界（本会话核实，一并记）**：
- `apps/agentcore/src/server.ts:1304` 的 `POST /b/v1/skills/lint` 调 `lintSkill(target)` **不传 ctx** → 依赖图/环检测/PUBLISHED 检查在该端点上是空转；发布路径 `server.ts:1242` 才传全（`requirePublishedDeps: true`）。扩门时须两处一并接，否则"lint 通过、发布被拒"会让作者以为门在骗人。
- 本条不属 Runtime 范畴的必修项，但属同一片文件边界，建议同单收。

### 8.4 Skill Graph 的可视与治理（R17 决策单页的延伸）

- `GET /b/v1/skills/:id/graph` 返回编译后的扁平图（含内联来源标注 `fromSkill`），供管理台渲染。
- `R15 CLI 对等`：`platform skill graph <key>` 或登记 `uiDeepLink`。
- 不做新可视化框架：复用既有 `apps/frontend-shell/src/components/Dag/taskDag.ts`（本会话核实其消费 `selectStepRows`），把"任务 DAG"与"Skill 图"统一到同一渲染。

---

## 9. 分期与 WO 拆分（每单一 dev · 附范围边界）

> 依 `CLAUDE.md` LOOP 纪律：一 WO 一 handoff 分支；跨"数据/引擎两半"或"前后端两半"的必须一个 dev 整单做。

| WO | 内容 | 🚦 范围边界（只碰） | 头号 SEAM 判据 |
|---|---|---|---|
| **W1** | `routeSource` + `skillKey` 载荷统一 + metrics 计数器（**与 Track A Phase 1 合并**） | `router/orchestrator.ts`（仅 emit 载荷）· `metrics.ts` · `sse/taskStreamReducer.ts` · 对应 test | 每条执行路径各跑一次 → `routing.completed.routeSource` 互不相同且与实际门一一对应 |
| **W2** | Reasoning Graph 契约 + `compileGraph` + `GraphScheduler` + 三处扇出收编 | `packages/contracts/src/qos.ts`（additive）· `agentcore/src/workflow/*` · `router/multi-route.ts` · `router/orchestrator.ts`（Coordinator 段） · scripts/check-graph-runtime.mjs（新建） | **A1 字节等价**（§10）+ **A2 并行真快**（§10） |
| **W3** | `RuntimeContext` 统一工厂 + 预算接线（9 站点）+ 取消补线（`executor.ts:401`）+ 进度全路径 + 前端消费 | `agentcore/src/{engine,runtime}.ts` · `router/orchestrator.ts` · `tools/{executor,budget}.ts` · `agent/loop.ts`（仅 opts 收编）· `frontend-shell/src/sse/taskStreamReducer.ts` · `components/QueryDock/*` · scripts/check-progress-reachability.mjs（新建） | **B1 预算真变** + **C1 取消真停** + **D1 路径全覆盖**（§4/§5/§6） |
| **W4** | `dependsOn` 内联展开 + 引用可校验硬门（全 kind） | `agentcore/src/skill-lint.ts` · `skill-compile*.ts`（新）· `server.ts`（lint/publish 两处）· `tools/clients.ts`（只读校验通道） | 「改 C08 影响哪些 Skill」一次查询返回真集合；引用不存在的 key → 发布真被拒（变异反证） |
| **W5** | `human` 节点跨请求 resume（持久化运行态） | 另立·依赖 R9 四处同改 | 进程重启后图从未完成节点续跑（复用 `BuildWorkflowRun` 范式验收） |

---

## 10. SEAM-GATE 验收判据总表（效果层 · 审核方复验头号依据）

> 不接受运输层断言（"字段传到了"/"事件发出来了"/"字段读出来了"）。每条给可复跑口径 + 变异反证。

| # | 判据 | 断言（效果层） | 变异反证 |
|---|---|---|---|
| **A1** | **确定性零漂移（R6 红线）** | 32 个既有意图逐个跑：图化前后 `answer` 与 `provenance` **字节相等**（含 ⟦ref:N⟧ 编号）；`classification.model` 不变 | 把某节点的归并顺序从"声明序"改成"完成序" → A1 红 |
| **A2** | **并行真快** | 三独立节点各 stub 600ms：墙钟 ≤ 900ms（今天串行 ≥1800ms）。**同时**断言总 solver 调用数 = 3（没靠少调省时间） | 去掉 `Promise.allSettled` 波并发 → A2 红 |
| **A3** | **并行不串台** | 打乱完成顺序，三路旁白 `role` 各自正确（§6.5-D2） | 把 role 改回"当前串行步指针"推导 → A3 红 |
| **A4** | **确定性节点可入图** | 一张「2 solver 并行 + 1 rule + 1 render」的**全 PURE 图**跑通，`agentRequests=0`，两次重跑字节一致 | 把 mode=DETERMINISTIC 的图塞一个 agent 节点 → 发布应被拒；若通过则红 |
| **B1** | **预算按题型真生效** | §4.4-B1 | §4.4-B4 |
| **C1** | **取消真停到底** | §5.6-C1（DataCore 侧 `finished=0`） | §5.6-C5 |
| **D1** | **进度全路径真发** | §6.5-D1（6 条路径进度事件均 >0） | §6.5-D5 |
| **E1** | **不新增第二套扇出** | `graph-runtime:check`：全仓 `Promise.all(`/`allSettled(` 出现在扇出语境的位置**唯一** | 在 `multi-route.ts` 留一份并行实现 → 门红 |
| **E2** | **无裸调用点** | `progress-reachability:check` + `graph-runtime:check`：无裸 `new BudgetTracker(`、无裸 `runAgentLoop({emitNarration...})` | 新增一个裸调用点 → 门红 |
| **F1** | **四包全绿** | `pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest） | — |
| **F2** | **门显式捕获退出码** | 一律 `bash scripts/gate.sh`；**禁止** `cmd \| tail -n; echo "EXIT=$?"`（`$?` 取的是 tail 的退出码，本仓已真实据此把编译失败判为通过） | — |

---

## 11. 回写清单（本体 `docs/SYSTEM-ONTOLOGY.md`）

> 铁律 0：改动新增/改变了链路 / 事件 / 对象类型 / 不变量 / 门禁 → **必须回写**。本 PRD 不代写（避免与 Track A 的 §8 回写并写打架），但列成实施 WO 的 DoD；漏写即退单。

| 章节 | 回写内容 | 归属 WO |
|---|---|---|
| §2.H | `Skill` 条目补 `execution`（Reasoning Graph）/ `budget` / `progress` 三组字段与消费方；`ExecutionPlan` 条目标注"降为图的链式退化形态、语义字节不变" | W2/W3 |
| §3「编排链」 | 最右段改为 `compileGraph → GraphScheduler → node dispatch`；显式记三处扇出收编（`executor.ts` 线性 / `multi-route.ts` 多域 / Coordinator 角色） | W2 |
| §4 | `routing.completed` 载荷补 `routeSource`/`skillKey`；`step.*` 伪 step 补 `nodeId/nodeKind/role/phase/budgetLeft`；`task.cancelled` 补 `cancelledNodes[]`。**不新增事件名** | W1/W3 |
| §5 | 新增不变量条目：**预算 reserve-then-run**（并行下 check-then-act 竞态）· **身份由节点自带**（不得靠串行序推导）。若定为一等不变量则编号顺延（本文暂以命名条目引用，避免与在建 WO 抢编号） | W2/W3 |
| §7 | 登记 `graph-runtime:check` 与 `progress-reachability:check`（并入 `pnpm gates` → gates 串计数同步 +2）；`chain:check`/`loop-control:check`/`arg-drop-seam:check`/`deploy-governance:check` 扩项说明 | W2/W3 |
| §8 | **前置**：Track A 须先补登 `G-ROUTE-REGEX-PREEMPTS-RETRIEVAL` / `G-TIMEOUT-AS-VERDICT` / `G-SYNC-SOLVE-TIMEOUT-NO-CANCEL`（今天本体查无此三条）。本文另请登记两条新断点：`G-SERIAL-GRAPH-EXECUTION`（图节点串行·`executor.ts:104`）与 `G-PROGRESS-PATH-UNREACHABLE`（进度在 2/6 路径上结构性为 0），并在闭合时改状态 | Track A / W2 / W3 |
| 金值 | 本文**不新增** solver / 对象类型 / 领域事件 → demo-chain / catalog / ontology-core 金值**不变**；新增两道门 → gates 串计数需同步 | W2/W3 |

---

## 12. 核实 / 未核实清单（诚实边界）

**本会话已核实（读源码 / `git show` / grep，均可复跑）**

| # | 事实 | 取证 |
|---|---|---|
| 1 | 执行器串行、循环体内无 `Promise.all` | `apps/agentcore/src/workflow/executor.ts:104`（逐行读）+ 同文件 grep |
| 2 | `maxBudgetRounds` 生产代码零消费方 | `grep -rn maxBudgetRounds --include=*.ts --include=*.tsx --include=*.mjs`（排除 node_modules/dist）→ 契约 1 + 测试 2 |
| 3 | 出厂 7 Skill 无 `dependsOn`、无 `maxBudgetRounds` | `apps/agentcore/src/mocks/seed.ts:866..1137`；两键 grep 零命中 |
| 4 | 意图/计划各 32、Skill 7 | 静态推算：`seed.ts` 基础 plans 5 + `SCENARIO_CATALOG` 20 张去重 4 = +16 + `ceoCaps` 11 = 32，intents 与 plans 1:1 生成（`seed.ts:515-516` 场景派生段 · `:587/615` CEO 派生段）；skills `grep -c 'id: "skl_seed'` = 7 |
| 5 | 求解器 57 个 | `apps/datacore/src/solvers/service.ts:44 SOLVER_KEYS` 计数 |
| 6 | D1 取消已并线且只覆盖同步求解通道 | `git show 01c05948`；`apps/agentcore/src/server.ts:1746-1789`；`apps/datacore/src/solvers/cancellation.ts` |
| 7 | QOS 通道 solver invoke **不传 signal** | `apps/agentcore/src/tools/executor.ts:401` |
| 8 | 任务取消是轮询标志 | `orchestrator.ts:401`（`Set<string>`）+ `:1752/2090/2299` |
| 9 | Coordinator 旁白已接（`518e46b1`），但角色归属**靠串行序推导** | `orchestrator.ts:2197-2243`（注释与实现） |
| 10 | 角色 agent / 场景 agent 路径**不传** `emitNarration` | `orchestrator.ts:2081-2091` / `:2291-2300`（无该参数） |
| 11 | 前端 reducer 丢弃 `role/roleLabel/agentId` | `apps/frontend-shell/src/sse/taskStreamReducer.ts:139-160` |
| 12 | 多域并行只发 `step.completed` 不发 `step.started` | `apps/agentcore/src/router/multi-route.ts:199/215/232` |
| 13 | 分类器是第 14 个决策点 | `orchestrator.ts:513-727` 逐门枚举（§1.5 表） |
| 14 | 24 字长度门 | `apps/agentcore/src/router/ceo-route.ts:217` |
| 15 | 三条 WO 新断点未回写本体 | `grep` `docs/SYSTEM-ONTOLOGY.md` 三条命中 0 |
| 16 | `checkpoint.ts` 是 Noop | `apps/agentcore/src/workflow/checkpoint.ts:22` |
| 17 | `skill-lint` 只解析 `kind=skill` 引用；注释所称"发布时的跨系统探针"**不存在**（发布端点无 solver/rule/slice/objectType 引用存在性校验）；`/b/v1/skills/lint` 端点不传 ctx（依赖图/环检测空转） | `skill-lint.ts:175`；`server.ts:1230-1268`；`server.ts:1242` vs `:1304` |
| 18 | 无 `routeSource` metrics 计数器 | `apps/agentcore/src/metrics.ts` grep 零命中 |
| 19 | 9 个 `BudgetTracker` 站点 | `grep -n "new BudgetTracker"` |

**未核实（引用他人实测，本文不复跑；施工前如需可复跑）**

| # | 事实 | 来源 |
|---|---|---|
| a | 203 s 拆解 `60059+82842+60025=202,926 ms` 与 `invoke_solver 527ms=0.26%` | WO E5（审核方实测截屏时延） |
| b | Coordinator 往返 6 次旁白 0 条 / path-B 往返 2 次旁白 1 条 | WO E9 对照实验（**注**：其后 `518e46b1` 已接 Coordinator 透传，该结论对应修复前基线） |
| c | 80 条措辞用例 74/80、失败 6 条全 `model=coordinator` | WO E11 |
| d | D1 探针「504 后 700ms 底层 `finished=0`」 | 审核方复验；本会话只核实了实现路径与提交，未复跑探针 |
| e | 真 LLM 分类器对该题 `capacity_feasibility@0.95`、耗时 13.4/14.6/17.5 s | WO E4（真 LLM 探针） |
| f | DRIL 检索的 top-1 准确率 / 误判率 / P95 耗时 | **尚不存在**——Track A Phase 0 的交付物；本文不据此设计任何判据 |

**明确不做的推测**

- 未评估并行化对 LLM provider 侧限流的影响（三路同时打同一 provider 可能触发 429）。立单时须在 W2 补一条实测：并发波宽 3 时的 provider 错误率对照。**本文不预设结论。**
- 未评估图化对 pg 模式下 `query_events` 写入量的影响（进度事件变密）。W3 须实测事件条数/任务，若显著上涨则需采样策略——**不预先设计未验证的采样**。

---

## 13. 一句话收束

Reasoning Graph 不是"再加一层配置"，也不是"把线性步骤画成图"。它是把今天**散在三处的扇出、散在九处的预算、断在半路的取消、漏在两条路径上的进度**，收进**一份可校验、可门控、自带效果层验收**的运行时。判断这件事做没做成，只有一条：**改 Skill 里的那个数，该类题的实际行为要真的变**——读得出来不算。
