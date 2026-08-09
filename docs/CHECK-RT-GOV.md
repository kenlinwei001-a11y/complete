# 逐条复验 · `PRD-skill-runtime-orchestrator.md`(214) + `PRD-skill-governance-learning.md`(221) = 435 条

> 2026-08-09 · 复验 agent（独立重做提取，未采信 `docs/CHECKLIST-skill-4209.md` 的现成条目）
>
> **基线**：`claude/inspiring-gates-aqczjg` @ `b50f42af`（= `origin/claude/inspiring-gates-aqczjg`，HEAD 与远端同哈希，工作树 clean）
> **环境前置已跑**：`pnpm install --prefer-offline`（RC=0）· `pnpm --filter @platform/contracts build`（RC=0）· `pnpm --filter @platform/llm-adapters build`（RC=0）
> **分支基线（本人复验，非采信）**：`git merge-base --is-ancestor` 逐条实测——
> `handoff-skill-orchestrator-s1` **MERGED** · `handoff-skill-partial-b` **MERGED** · `handoff-skill-refclosure-a` **MERGED** · `handoff-skill-precond` **MERGED**（这一条派单基线里没提，实测也已并）；
> `handoff-skill-compiler-s1` **NOT-MERGED** · `handoff-skill-partial-a` **NOT-MERGED** · `handoff-skill-agent-reconcile` / `handoff-skill-migration-scope` / 五份 `handoff-prd-skill-*` **NOT-MERGED**。

---

## 0. 判定口径（五档，不合并）

| 档 | 含义 | 判据 |
|---|---|---|
| ✅ | **实体层真满足** | 承载物在**该在的对象上** + 有生产消费方；已追一层调用看到真触发条件 |
| 🔗 | **有实现·接线不全** | 代码在、也被生产调用，但挂错位置 / 只覆盖部分路径 / 数据恒空 |
| ⚠️ | **只有 test 引用** | 实现有、测试绿，**零生产调用方**（已排练 ≠ 已实现） |
| ❌ | **无承载物** | 契约/代码里根本没有（**报 0 前已跑金丝雀，见 §F**） |
| ⛔ | **自标非目标** | 三分：**绝对不做**（不算缺口）/ **本期不做·须诚实标注**（没做不是缺口，宣称做了才是）/ **不改不新造**（做了反而是缺陷，须反查有没有人违规做了） |

**本轮新增的一条纪律**：⛔「本期不做」的条目，我额外核了**它有没有被偷偷做掉**（反向违规），以及**它有没有被诚实标注**。两者都记在「追的那一层调用」列。

---

## A. `PRD-skill-runtime-orchestrator.md` 逐条（RT-001 … RT-214）

### A.0 §0 本体引用与影响

#### §0.1 触及对象类型

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-001 | Skill additive 扩 `execution`（Reasoning Graph）**挂在 `SkillDefinitionSchema` 上** | ❌ | `packages/contracts/src/agentcore.ts:236-261` | 逐字段读完 15 个字段，无 `execution`。形状在 `skill-graph.ts:384 SkillExecutionSchema` 但**没挂到 Skill 上**；作者在 `skill-graph.ts:347-353` 自陈「未代挂·接了线没数据」。本体 `SYSTEM-ONTOLOGY.md:279` 亦已诚实登记 |
| RT-002 | Skill additive 扩 `budget`（题型预算：`maxDiscoverCalls`/`expectedDurationMs`/`cancellable`） | ❌ | 同上 | `SkillBudgetSchema` 全仓 0 命中；`expectedDurationMs`/`cancellable` 0 命中 |
| RT-003 | Skill additive 扩 `progress`（`emitsNarration` / `phases[]` 声明） | ❌ | 同上 | `Skill.progress` 无字段；`emitsNarration` 全仓 0 命中（`emitNarration` 是 loop opts，不是 Skill 声明） |
| RT-004 | `maxBudgetRounds` 由「零消费方」接上**真消费方** | ⚠️ | `packages/contracts/src/agentcore.ts:260` | 全仓 3 处命中 = 契约 1 + `apps/agentcore/test/skill-contract.test.ts:65,77` 两条「存了能读出来」。**生产 src 零调用方**，与 PRD §1.2 描述逐字不变。（未并分支 `partial-a` 有 `skillBudgetOverride`，见 RT-208） |
| RT-005 | `ExecutionPlan.steps` 语义**逐字节保留**，降为图的链式退化形态 | ✅ | `packages/contracts/src/skill-graph.ts:429 chainGraphFromPlanSteps` | 一律编全 seq 链（`:454-456`），不做隐式并行；`workflow/executor.ts:104` 原样未动 → 既有语义零漂移 |
| RT-006 | `compileGraph(plan.steps)` 为**唯一**升格入口 | 🔗 | `packages/contracts/src/skill-graph.ts:478 compileExecution` | 唯一生产调用方 = `apps/agentcore/src/skill-orchestrator.ts:110`。但 QOS 主链（`workflow/executor.ts`）**不经它**——「唯一入口」只在旁挂端点上成立 |
| RT-007 | Intent **不改结构** | ⛔不改不新造 | — | 反查：`packages/contracts/src/qos.ts` IntentDefinition 无 skill-graph 相关新增 → 未违规 |
| RT-008 | AgentDefinition **不改结构** | ⛔不改不新造 | — | 反查 `packages/contracts/src/agentcore.ts` AgentDefinitionSchema 无图相关字段 → 未违规 |
| RT-009 | `agent` 节点 = 既有 `invoke_agent` 步 | ❌ | `packages/contracts/src/skill-graph.ts:52` | `IMPLEMENTED_NODE_KINDS = ["skill","solver"]`；`agent` 在枚举内但编译期返回 `NOT_IMPLEMENTED`（`:188-194`）。映射表有（`:63`），派发分支没有 |
| RT-010 | Task/Query additive `reasoningGraphRun`（图运行态留痕） | ❌ | — | `reasoningGraphRun` 全仓 0 命中；`GraphRunResult` 只是端点返回值，不落 QueryTask |
| RT-011 | `routing.completed` 载荷补 `routeSource`（与 Track A R1 同一字段同一口径） | ❌ | `apps/agentcore/src/router/orchestrator.ts:935/1032/1690/1854/2345/2474/2596` | 逐个读完 7 个 emit 点，载荷键只有 `path/note/role/agentId/intentKey` 等，**无 `routeSource`**。⚠ 仓里确有 `routeSource` 符号，但那是 `MultiIntentPlan.routeSource`（`packages/contracts/src/qos.ts:251`，三值枚举 `deterministic-multi-domain|llm-multi-intent|llm-l2-decompose`），**度量的是多意图并行的触发半，不是「14 道门里哪道门做的决定」**——同名不同义，不能算作已做 |
| RT-012 | `routing.completed` 载荷补 `skillKey`（本题最终由哪个 Skill 执行） | ❌ | 同上 7 处 | `skillKey` 在仓里只出现在 skill-probe / evals / skill 节点参数上，**routing 事件载荷 0 命中** |
| RT-013 | Coordinator 三角色扇出收编为「一张三节点并行图」 | ❌ | `apps/agentcore/src/router/orchestrator.ts:2508-2554` | Coordinator 仍走 `runWorkflowSteps` → `workflow/executor.ts:104` 串行；GraphScheduler 与它零调用关系 |
| RT-014 | `coordinator.ts buildDispatchSteps` 产出的 `invoke_agent` 步**不变** | ⛔不改不新造 | `apps/agentcore/src/router/coordinator.ts` | 反查未被图化改写 → 未违规 |
| RT-015 | Solver 对象**不改** | ⛔不改不新造 | `apps/datacore/src/solvers/service.ts` | 未违规 |
| RT-016 | `solver` 节点补齐 `AbortSignal` 透传 | ❌ | `apps/agentcore/src/skill-orchestrator.ts:320-328` | `runSolverNode` 调 `dataCore.solver.invoke(auth, key, args)` **三参**，第 4 参 signal 不传；同文件 `:313-319` 注释自陈「本切片不传 signal……不假装已经做了」（诚实标注 ✅，但需求本身未满足） |
| RT-017 | `rule` 节点 = `evaluate_rules` 步 + BLOCK 短路语义保留 | ❌ | `packages/contracts/src/skill-graph.ts:52,188-194` | `rule` 不在 `IMPLEMENTED_NODE_KINDS`，编译期拒；BLOCK 短路在图里无实现 |
| RT-018 | `human` 节点 = 既有 `create_action_draft` + 审批链，**不新造审批机制** | ⛔不改不新造（未违规）+ ❌（节点本身） | `skill-graph.ts:52` · `skill-orchestrator.ts:265-279` | 反查：`runNode` 只有 `skill`/`solver` 两分支，**没有任何写真值/建草稿能力** → 未新造审批机制（⛔ 侧满足）；但 `human` 节点本身 NOT_IMPLEMENTED |
| RT-019 | 新增暗发 FeatureFlag `qos.reasoning-graph`（BLOCK · `defaultOn:false` · datacore+agentcore 双注册） | ❌ | — | `qos.reasoning-graph` 全仓 0 命中（金丝雀：同文件 `agent.skill-on-free-qa` 命中于 `features/registry.ts:120`）。`POST /b/v1/skill-graphs/run` 只有 `requireCatalogAdmin`，**无 entitlement 门** |

#### §0.2 触及链路

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-020 | 新增链路 `Skill --execution--> ReasoningGraph --node--> {agent\|solver\|rule\|human\|slice\|render\|mcp\|compose}` | 🔗 | `packages/contracts/src/skill-graph.ts:34-44` | 枚举 9 kind 齐；实际可跑 2 kind；`Skill --execution-->` 这条边**恒空**（RT-001） |
| RT-021 | `ReasoningGraph --edge(seq\|parallel\|cond)--> ReasoningGraph` | 🔗 | `skill-graph.ts:105,109` | `IMPLEMENTED_EDGE_KINDS=["seq","parallel"]`；`cond` 编译期 NOT_IMPLEMENTED（`:204-211`），已诚实标注 |
| RT-022 | `Skill --dependsOn--> Skill` 编译期内联展开（非运行期新会话） | ❌ | `skill-orchestrator.ts:336` | `compileExecution` 无任何内联展开代码；文件末尾自陈「dependsOn 编译期内联展开——PRD §8.1，属 W4 单」 |
| RT-023 | 收编 `multi-route.ts:210` 的多域 `Promise.all` 扇出 | ❌ | `apps/agentcore/src/router/multi-route.ts:210` | `await Promise.all(...)` 原样在；`multi-route.ts` 不 import `skill-orchestrator` |
| RT-024 | 收编 Coordinator 串行扇出 | ❌ | `apps/agentcore/src/router/orchestrator.ts:2508+` | 同 RT-013 |
| RT-025 | 回写本体 §3「编排链」最右段（`compileGraph → GraphScheduler → node dispatch`） | 🔗 | `docs/SYSTEM-ONTOLOGY.md:259-279` | **已回写且诚实**：新增「Skill Graph 编排链」段，明写「与既有线性执行器**并存**」、`:279` 明写「未挂 ≠ 已实现·Skill.execution 恒空」。但 PRD 要的是「最右段**改为**图 + 三处扇出收编说明」，实际是**并存新增**而非改写 → 接线不全 |

#### §0.3 触及事件

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-026 | **不新增任何事件名**（守 QOS-PRD §8.2 一字不差） | ⛔不改不新造 | `apps/agentcore/src/skill-orchestrator.ts` 全文 | 反查：GraphScheduler **一个 `emit` 都没有**，自然不会新增事件名 → 未违规（但代价是 RT-027..031 全空） |
| RT-027 | `step.*` 伪 step 补 `nodeId` | ❌ | — | 0 命中；调度器不 emit |
| RT-028 | 补 `nodeKind` | ❌ | — | 0 命中 |
| RT-029 | 补 `role`/`roleLabel`（并行后**必须**由节点自带，不得靠串行序推导） | 🔗 | `skill-graph.ts:90 role` · `orchestrator.ts:2203-2211 区段` | 契约侧 `SkillGraphNode.role` 已在（承载物有）；但调度器不 emit、生产 Coordinator 仍靠串行步序推导 → 数据恒空 |
| RT-030 | 补 `phase`（Skill 声明的阶段名） | 🔗 | `skill-graph.ts:92 phase` | 同上：字段在、无 emit、无 Skill 侧声明源（RT-003） |
| RT-031 | 补 `budgetLeft` | ❌ | — | 0 命中 |
| RT-032 | `task.cancelled` 补 `cancelledNodes[]` | ❌ | — | `cancelledNodes` 全仓 0 命中 |
| RT-033 | `routing.degraded` / `coordinator.planned` **不扩不删** | ⛔不改不新造 | `orchestrator.ts` | 反查两事件 emit 载荷未被本线改动 → 未违规 |

#### §0.4 触及不变量

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-034 | R1 · `ReasoningGraph` schema 落 `@platform/contracts` | ✅ | `packages/contracts/src/skill-graph.ts:126 SkillGraphSchema` | 经 `contracts/src/index.ts` 导出，agentcore `skill-orchestrator.ts:21-31` import；无本地重定义 |
| RT-035 | R1 · `SkillBudget` schema 落 contracts | ❌ | — | 无该 schema（RT-002 同源） |
| RT-036 | R1 · agentcore 不得本地重定义；`workflow/executor.ts:19 ExtraToolStep` 收进契约或**明确登记豁免** | 🔗 | `apps/agentcore/src/workflow/executor.ts:19` · `skill-graph.ts:373-381` | `ExtraToolStep` 仍是 agentcore 本地类型；契约侧用 `SkillExecutionStepSchema`（`type: 开放 string` + `.passthrough()`）**绕开**它而非收编，也**未在豁免表登记** → 债未清，只是被绕过 |
| RT-037 | R2 · 调度器所有 Map 键 = `${tenantId}:${taskId}:${nodeId}` | 🔗 | `skill-orchestrator.ts:144-147` | `outputs`/`results`/`poisoned` 三个 Map 的键是**裸 nodeId**。不构成跨租户泄漏（Map 生命周期 = 单次 `run()` 调用栈内，不跨请求），但**与 PRD 明文口径不符**；跨租户防线实际靠 `runSkillNode` 的 `skill.tenantId !== auth.tenantId` 检查（`:295`）与 OBO 透传 |
| RT-038 | R3 · `qos.reasoning-graph` 关 → 图能力**不存在**（走线性 plan 逐字节不变），不是 403 | ❌ | `apps/agentcore/src/server.ts:1360-1362` | 端点只有 `auth` + `requireCatalogAdmin`，**无 entitlement 判定**；无 flag（RT-019） |
| RT-039 | R3 · 验收不得依赖 `X-Debug-User` 链路证明「关了就没有」 | ❌ | — | 无该验收（前提 RT-038 不成立）。反查 `test/skill-orchestrator.seam.test.ts` 未出现 entitlement 断言 |
| RT-040 | R4 · `human` 节点只产 ActionDraft；**图执行器无写真值能力**（无该 dispatch 分支） | ✅ | `skill-orchestrator.ts:265-279` | `runNode` 的三元只有 `runSkillNode`/`runSolverNode`；`runSkillNode` 只读 `repos.skills.latestByKey`，`runSolverNode` 只调 solver invoke → **结构上没有写真值的路** |
| RT-041 | R6 · 节点带 `determinism: PURE\|LLM`（派生自 kind，显式写出以便门校验） | ✅ | `skill-graph.ts:73-79,196-202` | 单一派生源 `determinismOf()`；编译期断言「显式值须与派生值一致」，不一致返回 `GRAPH_INVALID` |
| RT-042 | R6 · `execution.mode=DETERMINISTIC` 的图内出现 LLM 节点 → **发布拒绝** | ❌ | `skill-graph.ts:395` vs `:175-313` | `mode` 字段在 `SkillExecutionSchema` 上，但 `compileGraph`/`compileExecution` **全文不读 `mode`**（追调用：`compileExecution:485-510` 只取 `graph`/`steps`）。且发布路 `server.ts:1240-1300` 不读 `execution` → 该校验**零触发点** |
| RT-043 | R6 · 迁移验收 = 同意图同槽位，answer 与 provenance **字节相等** | ❌ | — | 32 意图未图化，无该对照测试 |
| RT-044 | R7 · 并行节点失败聚合后仍单一 `{error:{code,message,requestId}}`；多失败取首个按声明序，其余入 `partialFailures[]` | 🔗 | `skill-orchestrator.ts:155-187,203-211` | `Promise.allSettled` 逐节点落 `nodeResults[].error`（**按声明序归并**，`:192-201` 满足「首个按声明序」的确定性前提），但**无 `partialFailures[]` 字段**（0 命中），且整图失败返回 200 + `status:"FAILED"`，未走错误信封 |
| RT-045 | R9 · **T1 不落库**（图在单次请求内跑完），故不触发四处同改 | ✅ | `skill-orchestrator.ts:105-212` | `run()` 全程内存 Map；无 migrations/repo 变更 → 符合 T1 声明 |
| RT-046 | R11 · `compileGraph` 校验至少一条到 `render` 的可达路径，否则拒绝发布 | ⛔本期不做（**已诚实标注**） | `skill-graph.ts:22-24` · `docs/SYSTEM-ONTOLOGY.md:984` | 注释明写「**本切片不校验**……这是已知未覆盖门，不是已经守住了」，并登记本体断点 `G-SKILL-GRAPH-NO-RENDER-CLOSURE`（实测本体命中 1） → 诚实达标，不计缺口 |
| RT-047 | R13 · 每节点产出携 `toolCallId` + `snapshotVersion`，按 nodeId 索引 | 🔗 | `skill-orchestrator.ts:327` | solver 节点回传 `{solverKey, data, snapshotVersion}` —— snapshotVersion 有；**`toolCallId` 无**，图节点不写 `ToolCallRow`、不产 `stepAudits` |
| RT-048 | R14 · 图拓扑不得内联业务实体名（只引用 solverKey/ruleKey/sliceKey/objectType） | ✅ | `skill-graph.ts` / `skill-orchestrator.ts` 全文 | 逐文件读过：无基地/型号/工序等业务常数；节点只吃 key |
| RT-049 | R14 · `debattery:check` 扫描面覆盖新增文件 | ❌ | `scripts/check-debattery.mjs` | 门脚本未点名新文件；`grep -l "skill-orchestrator\|skill-graph" scripts/*.mjs` 只命中 `check-crossbranch-reinvent.mjs`（与本条无关） |
| RT-050 | R15 · Runtime 新增对外能力（跑图/看图运行态）须登记 `OPERATION_CATALOG`；`cli-parity:check` 守 | ❌ | `packages/contracts/src/operation-intent.ts` | `skill-graphs` / `skill graph` 在 `OPERATION_CATALOG` **0 命中**；`scripts/check-cli-parity.mjs` 与 `cli-parity-baseline.json` 存在但未含该操作 |
| RT-051 | R16 · 新增 need 类型（Skill execution graph）须注册 provisioner | ⛔本期不做（前置未落） | `apps/datacore/src/databuilder/provisioners.ts` | 前置 RT-001 未落 ⇒ 无新 need 类型 ⇒ 无需注册。反查 `provisioners.ts` 未被本线改动，`provisioners.test` 未红 → 无违规、无缺口 |
| RT-052 | R-ARG-FIDELITY · 每节点 args 由**该节点自己的槽映射**产出 | ✅ | `skill-orchestrator.ts:220-230 scopeFor` + `:161 ancestorsOf` | 每节点独立建 scope，只装祖先输出；无边即引用不到 → `TemplateResolutionError`（`:250-260`）。SEAM 测已咬（18 tests 全绿，见 §E-5） |
| RT-053 | R-ARG-FIDELITY · `arg-drop-seam:check` 口径扩到图节点 | ❌ | `scripts/check-arg-drop-seam.mjs` | 未扩；门脚本不认识 `SkillGraphNode.params` |
| RT-054 | R-一致 · **单一调度器** | ❌ | `skill-orchestrator.ts:155` + `multi-route.ts:210` + `executor.ts:104` | 现状是**四套**（线性 for…await / 多域 Promise.all / Coordinator 串行 / GraphScheduler），比 PRD 目标态更远。本体 `:983` 已如实登记「三套 + 一套新的」 |
| RT-055 | R-一致 · **单一 `RuntimeContext`** | ❌ | — | `RuntimeContext`/`makeRuntimeContext` 全仓唯一命中是 `skill-orchestrator.ts:335` 的**注释**（自陈属 W3 单），零实现 |

#### §0.5 触及断点

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-056 | G-2 · `render` 节点是 `outputSchema` 的天然校验点（**本文只声明位置，实施归契约 PRD**） | ⛔本期不做 | — | 声明性条目；`render` 节点未实现（RT-046 同源），未越界实施 → 无违规 |
| RT-057 | G-9 · 按题型预算 + 诚实降级；**有界终止本身不放松** | ❌（预算半）+ ⛔（不放松半未违规） | `skill-orchestrator.ts` 无 budget | 图调度器**完全不接预算**；反查它也没有放松既有有界终止（它根本不跑 agent loop）→ 不放松半未违规 |
| RT-058 | G-10 · `rule` 节点必须是**引用**（只列 ruleKey），不内联 | ⛔本期不做 | `skill-graph.ts:52` | `rule` NOT_IMPLEMENTED；反查无内联规则语法被造出 → 未违规。⚠ 注意 `runSkillNode` 已把 `references[kind=rule]` 摊平成 `ruleKeys`（`skill-orchestrator.ts:308`），方向正确 |
| RT-059 | `G-AGENT-BLIND-REACT` · 图化**不解决**路由劫持（明示不解决） | ⛔绝对不做 | — | 反查：13 道前置门未被本线改动 → 未越界 |
| RT-060 | `G-SKILL-UNREACHABLE-FREE-QA` · `RuntimeContext` 统一工厂是该债的**结构解** | ❌ | — | RT-055 未落 ⇒ 结构解不存在 |
| RT-061 | `G-WORKFLOW-BUDGET-LEAK` · 并行边的 check-then-act 竞态须新增不变量守 | ❌ | — | 无新不变量、无门（RT-070） |
| RT-062 | `G-SIDEEFFECT-VOCAB-SPLIT` · `human` 节点触发判定必须复用 contracts `isWriteEffectSkill()`，不得手抄第二份词表 | ⛔本期不做（未违规） | `packages/contracts/src/agentcore.ts:185/201` | 反查：`skill-orchestrator.ts` 全文不判写副作用，**没有抄第二份词表** → 未违规；`isWriteModeSkill` 的既有两个消费方（`engine.ts:38`、`skill-probe.ts:253`）仍是单一来源 |
| RT-063 | `G-SHIP-CONFIG-IGNORES-CODE` · 题型预算只能**收紧**不能放宽 | ❌ | — | 无题型预算（RT-002/004） |
| RT-064 | `G-ENTITLEMENT-FAIL-OPEN-DEBUG` · 验收不得在 debug 链路上证明「关了就没有」 | ⛔（前提不成立） | — | 同 RT-039 |
| RT-065 | 三条未回写断点（`G-ROUTE-REGEX-PREEMPTS-RETRIEVAL`/`G-TIMEOUT-AS-VERDICT`/`G-SYNC-SOLVE-TIMEOUT-NO-CANCEL`）须在本体存在，否则 §0 引用悬空 | ✅ | `docs/SYSTEM-ONTOLOGY.md` | **已变化（PRD 写的是 grep 命中 0）**：实测三条命中数 2/1/1，均已登记。金丝雀：同文件 `G-9` 命中 5 |

#### §0.6 触及门禁

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-066 | `prd:check` · 本文入 `docs/prd-ontology-index.json` | ✅ | `docs/prd-ontology-index.json:2322` | `"PRD-skill-runtime-orchestrator.md"` 有独立条目 + 多处链路/不变量引用 |
| RT-067 | `ontology:check` / `prd:coverage` 沿用 | ✅ | `package.json:32` | `gates` 串含 `check-system-ontology.mjs`/`check-prd-ontology.mjs`/`check-prd-coverage.mjs` |
| RT-068 | `chain:check` 扩：图必须可达 `render` 节点 | ❌ | `scripts/check-chain-closure.mjs` | 未扩（与 RT-046 一致，本期不做但**门侧未标注**——门脚本里没有对应 TODO/豁免登记） |
| RT-069 | `loop-control:check` 扩：图调度器不得新开第二个降级出口 | ⛔本期不做（未违规） | `scripts/check-loop-control.mjs` | 门未扩；反查 GraphScheduler **没有任何 degrade 出口**（不跑 loop）→ 未新开第二出口 |
| RT-070 | `arg-drop-seam:check` 扩：图节点 args 槽映射同守 | ❌ | `scripts/check-arg-drop-seam.mjs` | 同 RT-053 |
| RT-071 | `deploy-governance:check` 扩：题型预算部署上界须在 `docker-compose.yml` 照做 | ❌ | `docker-compose.yml:127-128` | compose 里有 `QOS_AGENT_MAX_ROUND_TRIPS:-4` / `MAX_DISCOVER_CALLS:-1`（既有全局预算，非题型预算）；题型预算不存在 ⇒ 无可照做项 |
| RT-072 | 新增 `graph-runtime:check` ① 全仓只有**一处**图调度实现 | ❌ | `scripts/`（无该文件） | `ls scripts \| grep graph-runtime` → 0；金丝雀：`ls scripts \| grep -c "check-"` = 51 |
| RT-073 | `graph-runtime:check` ② 节点派发复用 executor 同一 switch（不得复制第二份） | ❌ | — | 门不存在；且实测**已经复制了第二份**（`skill-orchestrator.ts:265-279` 自建 dispatch，不是 `executor.ts` 的 switch） |
| RT-074 | `graph-runtime:check` ③ 预算 reserve-then-run（`await` 前完成计数） | ❌（门）/ ✅（既有实现侧） | `apps/agentcore/src/tools/budget.ts:58` · `tools/executor.ts:191,211` | 门不存在。既有实现确是 run 前 `tryConsume`（同步方法，`executor.ts:211` 在调用前）→ 不变量事实成立，但**没有门钉住** |
| RT-075 | `graph-runtime:check` ④ `RuntimeContext` 由统一工厂产出（无裸传参调用点） | ❌ | — | 门不存在；实测裸 `new BudgetTracker(` **9 处**（`skill-probe.ts:377` · `orchestrator.ts:929/1028/1705/1883/2347/2506/2598` · `server.ts:1154`）——与 PRD §4.2 记的 9 处**数量一致、位置行号漂移** |
| RT-076 | `graph-runtime:check` 并入 `pnpm gates` | ❌ | `package.json:32` | gates 串 26 个脚本，无该门 |
| RT-077 | 新增 `progress-reachability:check`（凡构造 agent/图执行上下文的调用点都经统一工厂） | ❌ | `scripts/` | 0 命中 |

### A.1 §1 问题陈述（AS-IS 断言 · 判「今天是否仍如 PRD 所述」）

| 编号 | 需求/断言 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-078 | 执行器是 `for (const step of input.steps)` 串行 + 逐个 await | ✅仍成立 | `apps/agentcore/src/workflow/executor.ts:104` | 同文件 `Promise.all` grep 0 命中 |
| RT-079 | 循环体内全文无 `Promise.all` | ✅仍成立 | 同上 | 金丝雀：`multi-route.ts:210` 同 grep 命中 → 工具有效 |
| RT-080 | 多域分路 `multi-route.ts` 是真并行 solver 扇出 | ✅仍成立 | `apps/agentcore/src/router/multi-route.ts:210` | `await Promise.all(routes.map(...))` |
| RT-081 | Coordinator 角色扇出走 `executor.ts` 串行 | ✅仍成立 | `orchestrator.ts:2508-2554` → `workflow/executor.ts:104` | 追到 `runWorkflowSteps` → executor |
| RT-082 | 「一张三节点 Reasoning Graph 今天跑就是串行三倍」 | ◐**已部分变化** | `skill-orchestrator.ts:151-165` | GraphScheduler 已能同层并发（`Promise.allSettled` + `maxParallelNodes`）——但只对 `POST /b/v1/skill-graphs/run` 这条**旁挂**路成立，QOS 主链仍串行 |
| RT-083 | `SkillDefinitionSchema.maxBudgetRounds` 字段存在 | ✅仍成立 | `packages/contracts/src/agentcore.ts:260` | — |
| RT-084 | `maxBudgetRounds` 全仓只有 3 处（契约 1 + 测试 2），生产零消费方 | ✅仍成立 | `test/skill-contract.test.ts:65,77` | 逐条读过两处断言，均为「存了能读出来」 |
| RT-085 | 出厂 7 个 Skill 无一填 `maxBudgetRounds` | ✅仍成立 | `apps/agentcore/src/mocks/seed.ts` | 该文件 `maxBudgetRounds` 0 命中 |
| RT-086 | 出厂 7 个 Skill 无一填 `dependsOn` | ✅仍成立 | 同上 | `dependsOn` 在 seed.ts 0 命中（⚠ 与 CLAUDE.md 铁律 0.5 订正一致：`references` 有 7 条种子、非空 6 条，两者必须拆开说） |
| RT-087 | 真正在跑的是 `DEFAULT_AGENT_BUDGET`（24 轮/8 盲扫）+ env 收紧 | ✅仍成立 | `packages/contracts/src/qos.ts:601+` · `apps/agentcore/src/config.ts` | `orchestrator.ts:432` 读 `QOS_AGENT_MAX_DISCOVER_CALLS` |
| RT-088 | 9 个 `BudgetTracker` 站点 | ✅仍成立（行号漂移） | 见 RT-075 | 数量 9 不变 |
| RT-089 | 「所有题共用一个数字」 | ✅仍成立 | 同上 | 9 处全部 `this.residualBudgetFromConfig()`（除 `skill-probe.ts:377` 硬编码 8/12、`server.ts:1154` 空构造） |
| RT-090 | D1 已把**同步求解代理**的取消打通到底 | ✅仍成立 | `apps/agentcore/src/tools/datacore-http.ts:222-224` | `invoke(..., signal)` → `call(..., signal)` → `fetch(signal)`（`:49`）+ `:53` aborted 检查 |
| RT-091 | QOS 通道 `tools/executor.ts:401` **不传 signal** | ✅仍成立 | `apps/agentcore/src/tools/executor.ts:401` | 三参调用，逐字符核对 |
| RT-092 | 任务级取消是 `Set<string>` 轮询标志 | ✅仍成立 | `orchestrator.ts` `private readonly cancelled = new Set<string>()` | `isCancelled: () => this.cancelled.has(taskId)` 在 `:2366`/`:2611` 等处传入 |
| RT-093 | path-B 通用探索**传** `emitNarration` | ✅仍成立 | `orchestrator.ts:2009` | `emitNarration: reasoningTraceEnabled(enabledFeatures)` |
| RT-094 | Coordinator 多角色**传** `emitNarration` | ✅仍成立 | `orchestrator.ts:2554` | `...(narrationOn ? { emitNarration: true } : {})` |
| RT-095 | 单域角色 agent **不传** → 恒 0 条 | ✅仍成立 | `orchestrator.ts:2352-2367` | 逐字段读完 `runRegisteredAgent({...})` 入参，无 `emitNarration` |
| RT-096 | 场景入口 agent **不传** → 恒 0 条 | ✅仍成立 | `orchestrator.ts:2603-2613` | 同上，无 `emitNarration` |
| RT-097 | path-A 有 `step.started/completed`，无阶段/预算余量 | ✅仍成立 | `workflow/executor.ts:106/127` | 载荷无 phase/budgetLeft |
| RT-098 | 多域并行**只发 `step.completed` 不发 `step.started`** | ✅仍成立 | `multi-route.ts:200/214/234` | 三处全是 `step.completed`；同文件 `step.started` 0 命中 |
| RT-099 | 同步求解通道无任何过程事件 | ✅仍成立 | `server.ts`（`/b/v1/solvers/:key/run` 段） | 无 emit |
| RT-100 | 角色标识靠「串行序」推导（并行必串台） | ✅仍成立 | `orchestrator.ts:2203-2211 区段注释与实现` | 未被图化改写 |
| RT-101 | 结构化 `role`/`roleLabel`/`agentId` 前端**零消费方**（塞进 text 前缀） | ✅仍成立 | `apps/frontend-shell/src/sse/taskStreamReducer.ts:139-161` | 逐行读 `selectStepRows`：只取 `stepId/type/outcome/durationMs/text`，role 三字段被丢弃 |
| RT-102 | LLM 分类器上游有 13 个可 return 决策点（分类器排第 14） | ◐**未逐门复核** | `orchestrator.ts` | 本次未逐门重数（行号已大幅漂移，PRD 给的 `:727` 等锚点失效）。**诚实标注：未核实**，不当结论用 |
| RT-103 | 其中 8 道判据为正则/关键词/长度启发 | ◐未核实 | — | 同上 |

### A.2 §2 目标与非目标

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-104 | 期号命名空间收口：M0–M3 / R0–R4 / T1–T2，本文之后不再出现裸「Phase N」 | ✅ | `docs/PRD-skill-runtime-orchestrator.md` 全文 | 文档自检：正文只用 T1/T2/W1–W5/R0–R4 |
| RT-105 | G1 · 并行边真并发 | 🔗 | `skill-orchestrator.ts:155` | 真并发已实现，但只在旁挂端点；QOS 主链不经它 |
| RT-106 | G1 · **不引入第三套扇出** | ❌**反向违规** | `skill-orchestrator.ts:155` | 实测：新增了第四套（PRD 自己算三套）。本体 `:983` 已如实登记「三套 + 一套新的，比目标态更远」。**这是本 PRD 最要害的一条自打脸，但已诚实标注** |
| RT-107 | G2 · 全 PURE 图与今天线性 plan **字节等价** | ❌ | — | 无该对照（RT-043） |
| RT-108 | G3 · 改 `maxBudgetRounds` → 该类题实际轮次真变 | ❌ | — | 零消费方（RT-004） |
| RT-109 | G4 · 取消穿透到 DataCore 求解 | ❌ | `skill-orchestrator.ts:326` | 不传 signal（RT-016） |
| RT-110 | G5 · progress 在每条会走到它的路径上都发 | ❌ | 见 RT-093..099 | 6 条路径里 2 条恒 0、多域缺 started、图路 0 事件 |
| RT-111 | G5 · 新增路径**不可能**漏接（结构保证 > 纪律保证） | ❌ | — | 无 RuntimeContext 工厂、无 `progress-reachability:check` |
| RT-112 | G6 · Skill Graph 多 Skill 编排有真语义 | 🔗 | `skill-orchestrator.ts:289-311 runSkillNode` | `skill` 节点真载入本租户 Skill 并摊平 `solverKeys`/`ruleKeys` 供下游 → 有真语义；但 `dependsOn` 无语义（RT-022） |
| RT-113 | G6 · `dependsOn` 有真校验 | 🔗 | `apps/agentcore/src/skill-lint.ts:348` | `validateRefResolution(skill.dependsOn, ..., requirePublishedDeps)` 在发布路真传（`server.ts:1251`）；环检测 `detectSkillDependencyCycle` 在。**但 seed 的 `dependsOn` 恒 0 条 ⇒ 接了线没数据、从未触发** |
| RT-114 | G6 · `dependsOn` 有真运行（编译期内联展开） | ❌ | — | RT-022 |
| RT-115 | ⛔ 不定义 Skill 契约字段最终形态 | ⛔绝对不做（未违规） | `skill-graph.ts:348-353` | 反查：作者显式**不**代挂 `SkillDefinitionSchema.execution`，理由写明「归 Skill 契约线·本 WO 文件边界不含 agentcore.ts」→ 严格守住 |
| RT-116 | ⛔ 不做 Skill CLI / 编译器 / `.skill` 包 / 签名 | ⛔绝对不做（未违规） | — | canonical 上无 `skill-compiler.ts`（在未并的 `compiler-s1` 分支） |
| RT-117 | ⛔ 不改路由门次序 | ⛔绝对不做（未违规） | `orchestrator.ts` | 13 道门未动 |
| RT-118 | ⛔ 不引入第二套规则语法/约束 DSL | ⛔绝对不做（未违规） | `skill-graph.ts` | `cond` guard 的九种比较**未实现**，也未造别的表达式求值器 |
| RT-119 | ⛔ 不做真 token 级流式 | ⛔绝对不做（未违规） | — | 未做 |
| RT-120 | ⛔ 不做跨请求持久化图运行态（T2） | ⛔本期不做（**已诚实标注**） | `apps/agentcore/src/workflow/checkpoint.ts:22 NoopWorkflowCheckpointStore` | 反查未落库（RT-045）；本体 G-11 与该文件注释「v1 空实现·durable execution v2」均诚实 |

### A.3 §3 Reasoning Graph

#### §3.1 结构

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-121 | `nodes: ReasoningNode[]` ≥1 | ✅ | `skill-graph.ts:127` | `.min(1).max(MAX_GRAPH_NODES)` |
| RT-122 | 含至少一个**可达 render 节点**（R11） | ⛔本期不做（已标注） | `skill-graph.ts:22-24` | 同 RT-046 |
| RT-123 | `edges` 有向无环（编译期 DFS 检环） | ✅ | `skill-graph.ts:245-272` | 三色 DFS，返回可读环路径，错误码复用 `CYCLIC_INVOCATION` |
| RT-124 | `entry: nodeId[]` = 入度 0 的节点集（可多个 = 天然并行起点） | ✅ | `skill-graph.ts:278` | `nodes.filter(indeg===0)`，按声明序 |
| RT-125 | `node.id` 图内唯一 | ✅ | `skill-graph.ts:178-184` | 重复 id → `GRAPH_INVALID` |
| RT-126 | `node.kind` 八类 + `skill` 共 9 种枚举 | ✅ | `skill-graph.ts:34-44` | `SKILL_GRAPH_NODE_KINDS` 九值齐 |
| RT-127 | `node.determinism` 派生自 kind，显式写出以便门校验 | ✅ | `skill-graph.ts:73-79,196-202` | 同 RT-041 |
| RT-128 | `node.params` 与今天 `PlanStep.params` **逐字段同构**（同一 TemplateValue 词表） | ✅ | `skill-graph.ts:86` | `z.record(z.string(), TemplateValueSchema)`，从 `qos.ts` import，非手抄 |
| RT-129 | 模板由**既有** `resolveTemplate` 求值（不新写解析器） | ✅ | `skill-orchestrator.ts:34,249` | import `./util/template.js` 的 `resolveTemplate` |
| RT-130 | `node.role?` | ✅（字段）/🔗（消费） | `skill-graph.ts:90` | 字段在；无 emit 消费方（RT-029） |
| RT-131 | `node.phase?` | ✅（字段）/🔗（消费） | `skill-graph.ts:92` | 同上 |
| RT-132 | `node.onError?: FAIL\|SKIP`，与今天 `PlanStep.onError` 同义同枚举 | ✅ | `skill-graph.ts:94` + `skill-orchestrator.ts:183-186` | 复用 `OnErrorSchema`；调度器 `onError!=="SKIP"` → 毒化后继（`poisonDescendants`） |
| RT-133 | `node.timeoutMs?` | 🔗 | `skill-graph.ts:95` | **字段在、调度器不读**：`skill-orchestrator.ts` 全文 `timeoutMs` 0 命中 → 节点超时不生效（声明了没接线） |
| RT-134 | `node.budgetWeight?`（预留 T2） | ⛔本期不做 | — | 0 命中；PRD 自标「预留」→ 不计缺口 |
| RT-135 | `edge.from` / `edge.to` | ✅ | `skill-graph.ts:112-113` | 编译期校验端点存在（`:213-218`） |
| RT-136 | `edge.kind = "seq"` | ✅ | `skill-graph.ts:114` | 缺省即 seq |
| RT-137 | `edge.kind = "parallel"`（语义 = 共同前驱的多条 seq） | ✅ | `skill-graph.ts:109,237-243` | 与 seq 同拓扑处理，平行重边去重 |
| RT-138 | `edge.kind = "cond"` + `guard: DeterministicPredicate` | ⛔本期不做（**已诚实标注**） | `skill-graph.ts:21,204-211` | 编译期显式 NOT_IMPLEMENTED + 点名；注释头 `:21` 明写 |
| RT-139 | 节点 kind ↔ 今日 `PlanStep.type` **一一对应表**（8 行）落成单一映射 | ✅ | `skill-graph.ts:60-70 NODE_KIND_TO_PLAN_STEP_TYPE` | 8 个 kind 有映射、`skill` 映射 null（诚实标注）；反向表 `PLAN_STEP_TYPE_TO_NODE_KIND` 从正向派生（`:408-415`），不手抄第二份 |
| RT-140 | 映射目标必须是**真的** `PlanStepSchema` 判别值（契约测试逐条断言） | ✅ | `packages/contracts/test/skill-graph.test.ts` | 测试文件存在；`skill-graph.ts:15-16` 注释声明该断言。（`pnpm --filter @platform/contracts build` RC=0） |

#### §3.2 编译

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-141 | `source = Skill.execution.graph` → 直接用 | 🔗 | `skill-graph.ts:485-487` | 判别分支在；**但 `Skill.execution` 恒空**（RT-001）⇒ 只能靠端点显式传图 |
| RT-142 | `source = ExecutionPlan.steps[]` → 编成链式图，逐字段搬运 params/onError/timeoutMs | ✅ | `skill-graph.ts:429-457` | 逐字段搬运三项（`:448-450`） |
| RT-143 | **默认保守**：legacy plan 一律编全 seq 链，即便无 `{{steps.X}}` 引用 | ✅ | `skill-graph.ts:453-456` | 无条件建相邻 seq 边 |
| RT-144 | **并行只能显式声明**，没有隐式提速 | ✅ | `skill-graph.ts:426-427` 注释 + 实现 | `chainGraphFromPlanSteps` 无并行推断分支 |
| RT-145 | 副产物 `derivedEdges`（从模板引用反推真实依赖）作审阅提示与门校验 | ❌ | — | `derivedEdges` 全仓 0 命中 |
| RT-146 | 声明了 `parallel` 边但存在跨边模板引用 → **编译拒绝** | ❌（编译期）/ ✅（运行期等价保护） | `skill-orchestrator.ts:250-260` | 编译期无该校验；但运行期 scope 只装祖先输出 ⇒ 跨边引用必抛 `TEMPLATE_RESOLUTION_ERROR`。**效果达到，时点不同**（运行期而非编译期） |

#### §3.3 确定性红线

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-147 | `mode=DETERMINISTIC` 的图内不得出现 LLM 节点，违反 → 发布期拒绝（`skill-lint` 扩一条规则） | ❌ | `skill-lint.ts` · `skill-graph.ts:395` | `mode` 字段在但零读点（RT-042）；`skill-lint.ts` 无该规则 |
| RT-148 | `cond` 边 guard 只允许九种比较（枚举封闭，非表达式求值） | ⛔本期不做（已标注） | `skill-graph.ts:21` | cond 未实现；反查未造表达式求值器 → 未违规 |
| RT-149 | 禁止 guard 调 LLM 判分支 | ⛔本期不做（未违规） | — | 同上 |
| RT-150 | **调度顺序不得影响结果**：并行波内产物按**节点声明序**归并（非完成序） | ✅ | `skill-orchestrator.ts:191-201` | `graph.nodes.map(...)` 按声明序取 `results`，注释明写「不是完成序」 |
| RT-151 | 答案块装配、`⟦ref:N⟧` 编号同样按声明序 | ⛔本期不做（前置未落） | — | `render` 节点未实现 ⇒ 图内无答案装配。反查未造第二套编号器 |
| RT-152 | 同一张图重跑 answer 与 provenance **字节一致** | 🔗 | `skill-graph.ts:172-174` + `skill-orchestrator.ts:101-104` | 分层/层内序只由声明序决定（不用 Map 迭代序、不排字典序）→ **`layers`/`nodeResults` 字节一致成立**；answer/provenance 不适用（无 render） |

#### §3.4 调度器

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-153 | 新增**唯一**的 `GraphScheduler` | 🔗 | `apps/agentcore/src/skill-orchestrator.ts:95` | 类存在且唯一；但「唯一调度器」未成立（RT-054） |
| RT-154 | 收编 `executor.ts:104` 线性 for…await → 链式图，行为逐字节不变 | ❌ | `workflow/executor.ts:104` | 未收编；`skill-orchestrator.ts:6-9` 自陈「不动它、不替换它，只在旁边加图调度……属 W2 单」（诚实标注） |
| RT-155 | 收编 `multi-route.ts:210` 多域 `Promise.all` → N solver + 1 render 图 | ❌ | 同 RT-023 | — |
| RT-156 | 收编 Coordinator 串行扇出 → N agent(parallel) + 1 synthesize render 图 | ❌ | 同 RT-024 | — |
| RT-157 | 调度算法 = 确定性拓扑波前（ready → wave → 并发 → 归并 → 重算） | ✅ | `skill-graph.ts:274-295`（Kahn 分层）+ `skill-orchestrator.ts:151-189` | 层由编译期算好，调度器逐层跑 |
| RT-158 | 并发执行用 `Promise.allSettled` | ✅ | `skill-orchestrator.ts:155` | — |
| RT-159 | 组内并发上限 = `min(wave.length, maxParallelNodes)` | ✅ | `skill-orchestrator.ts:149,153-154` | 分批切片实现有界并发；缺省 4、硬上界 16（`skill-graph.ts:119-121`） |
| RT-160 | `maxParallelNodes` 缺省 = wave 全宽 | ❌**与 PRD 相反** | `skill-graph.ts:119` | 实现缺省是 **4**（`DEFAULT_MAX_PARALLEL`），不是全宽。实现方给了理由（4 核机自保）且本体 `:267` 已如实登记 → **属有意偏离并已标注**，不是隐瞒 |
| RT-161 | 部署态可经 env 收紧并登记进 `deploy-governance:check` | ❌ | — | 无 env 开关（`maxParallelNodes` 只能由图作者传） |
| RT-162 | 失败传播：`onError=FAIL` 且失败 → 立即 abort 同波兄弟 | 🔗 | `skill-orchestrator.ts:183-186` | 实现的是**毒化后继**（后续层 SKIPPED），**同波兄弟不 abort**（`Promise.allSettled` 会等全部结算）。语义差一层，PRD 要的「立即 abort 兄弟」未做 |
| RT-163 | `onError=SKIP` → 该节点及其纯后继标 SKIPPED，其余照跑 | 🔗 | `skill-orchestrator.ts:183` | `onError==="SKIP"` 时**不毒化后继**，后继照跑（与 PRD 描述相反：PRD 说 SKIP 时该节点及纯后继标 SKIPPED）。实现取的是 `executor.ts:170` 的「产物置 null / 继续」语义 |
| RT-164 | 规则 BLOCK 短路 → 整图终止并返回 rule_violation 模板答案（COMPLETED 非 FAILED） | ⛔本期不做（前置未落） | — | `rule` 节点 NOT_IMPLEMENTED |
| RT-165 | 「不给 `executor.ts:104` 加 Promise.all」的理由（steps 不带依赖信息） | ✅ | `skill-graph.ts:426-427` | 设计被遵守：`chainGraphFromPlanSteps` 全 seq |

#### §3.5 并行边三条不变量

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-166 | a) 预算 **reserve-then-run**（先扣后跑），由 `graph-runtime:check` 守 | ❌（图侧）/ ✅（既有侧） | `tools/executor.ts:211` | 既有工具执行器确是先 `tryConsume` 后跑；**图调度器完全不接预算** ⇒ 图上无此不变量可言；门不存在 |
| RT-167 | b) 角色/身份由 `ReasoningNode` 自带，emit 时从**该节点的执行上下文**读 | 🔗 | `skill-orchestrator.ts:86-93 NodeRunContext` | 结构做到了（每节点自带 `node`/`layer`/`scope`/`visibleFrom`，无全局「当前指针」）；但**没有 emit**（RT-026），所以「emit 时从节点上下文读」无从验证 |
| RT-168 | b) `stepId` 前缀改为 `nodeId/…` | ⛔本期不做（前置未落） | — | 无 emit |
| RT-169 | c) 取消是波级的，不是全局标志轮询 | ❌ | `skill-orchestrator.ts` | 全文无 `AbortSignal`/取消概念 |

#### §3.6 `human` 节点

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-170 | T1 · `human` 节点 = 非阻塞，产 `ActionDraft` 走既有派发 + `action_draft.created` 事件 | ❌ | `skill-graph.ts:52` | `human` NOT_IMPLEMENTED |
| RT-171 | T1 · 图在 human 节点后以 render 收口，答案含 action_draft 块 | ⛔本期不做（前置未落） | — | render 未实现 |
| RT-172 | T1 · **不承诺**「图会等审批回来再往下跑」 | ⛔本期不做（未违规） | — | 反查：无 resume 承诺出现在代码/文案 |
| RT-173 | T2 · 跨请求 resume 复用 `BuildWorkflowRun` 范式，四处同改 | ⛔另立单（已标注） | `workflow/checkpoint.ts:22` | Noop 仍在，本体 G-11 已载 |
| RT-174 | **红线**：T1 的 UI/文案绝不出现「等待审批中，审批后自动继续」 | ⛔不改不新造（未违规） | 前端 | 反查前端无该文案 |

### A.4 §4 预算与红线按题型声明

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-175 | `Skill.budget.maxBudgetRounds` 接消费方 | ⚠️ | 同 RT-004 | — |
| RT-176 | `Skill.budget.maxDiscoverCalls`（新增 additive optional） | ❌ | — | Skill 侧无该字段（`AgentBudget.maxDiscoverCalls` 是另一个对象） |
| RT-177 | `Skill.budget.expectedDurationMs`（新增） | ❌ | — | 0 命中 |
| RT-178 | `Skill.budget.cancellable`（新增，默认 true） | ❌ | — | 0 命中 |
| RT-179 | `resolveTaskBudget(skill, config) → Partial<AgentBudget>` 单一入口 | ❌ | — | 全仓 0 命中 |
| RT-180 | 9 个预算站点全部改为同一工厂产出 | ❌ | 见 RT-075 | 9 处仍各自 `new BudgetTracker(...)` |
| RT-181 | `graph-runtime:check` 静态断言「无裸 `new BudgetTracker(`」 | ❌ | — | 门不存在；实测 9 处裸调用 |
| RT-182 | 优先级链 `effective = min(env 上界, Skill 声明值, DEFAULT)`——Skill 只能收紧 | ❌ | — | 无 resolve 逻辑（未并分支 `partial-a` 的 `skillBudgetOverride` 实现了 min 语义，见 RT-208） |
| RT-183 | 诚实标注 `AgentRunRecord.budgetClamped: {declared, applied, by:"env"}` | ❌ | `packages/contracts/src/qos.ts` AgentRunRecord | `budgetClamped` 0 命中 |
| RT-184 | degrade 文案说明「本次受部署上界限制」 | ❌ | — | 无 |
| RT-185 | 效果层 B1 · `maxBudgetRounds=2` vs `=6` → 实际 iterations 不同 | ❌ | — | 无该测试 |
| RT-186 | B2 · `=2` 时以 `degrade(BUDGET_EXHAUSTED)` 诚实收尾 | ❌ | — | 无 |
| RT-187 | B3 · env=3 + skill=6 → 实际 ≤3 且 `budgetClamped.by="env"` | ❌ | — | 无 |
| RT-188 | B4（反证）· 删消费点 → B1 变红 | ❌ | — | 无 |
| RT-189 | B5（覆盖）· 9 站点各跑一次 `applied` 全相同 | ❌ | — | 无 |

### A.5 §5 取消语义

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-190 | ① 任务级：每 task 一个 `AbortController`（RuntimeContext 持有），保留既有 `cancelled.add` 向后兼容 | ❌ | — | 无 RuntimeContext；仍是 Set 轮询 |
| RT-191 | ② 图级：未开始的波不再启动 | ❌ | `skill-orchestrator.ts:151-189` | 循环无取消检查 |
| RT-192 | ② 图级：在跑的节点逐个 abort | ❌ | — | 无 |
| RT-193 | ③ 节点级：`node.signal → GuardedToolExecutor.run(..., {signal})` | ❌ | — | 无 |
| RT-194 | ③ 补 `tools/executor.ts:401` 第四参 `signal` | ❌ | `apps/agentcore/src/tools/executor.ts:401` | 仍三参。链下游现成（`clients.ts:87` 签名有 signal、`datacore-http.ts:223` 直达 fetch）→ **典型「差一个参数」的接线缺口** |
| RT-195 | 节点超时先发 `node_timeout_diagnostic` 取证包，再取消 | ❌ | — | 0 命中；且 `node.timeoutMs` 本身不生效（RT-133） |
| RT-196 | 分流处置（换档/裁剪/延长）不在本文范围 | ⛔绝对不做（未违规） | — | 未做 |
| RT-197 | 顺序：**先定死对外结果，再 abort** | ⛔本期不做（前置未落） | `server.ts:1770-1773 区段`（既有同步通道） | 图上无取消 ⇒ 无顺序可言；既有同步通道的该顺序未被破坏 |
| RT-198 | §5.4 用户取消整任务 → 全波 abort + `cancelledNodes[]` | ❌ | — | 0 命中 |
| RT-199 | §5.4 某节点 FAIL 且 `onError=FAIL` → 立即 abort 同波兄弟 | ❌ | 同 RT-162 | — |
| RT-200 | §5.4 某节点 FAIL 且 `onError=SKIP` → 兄弟继续、产物置 null | 🔗 | `skill-orchestrator.ts:183` | 兄弟继续 ✅；产物不是「置 null」而是「不写入 outputs」（下游引用即 TEMPLATE_RESOLUTION_ERROR）——语义更严，非 PRD 描述 |
| RT-201 | §5.4 `cancellable=false` 的节点：不 abort、不再等、答案诚实标「已脱离本次任务」 | ❌ | — | `cancellable` / `detached` 在 agentcore 0 命中 |
| RT-202 | §5.5 诚实边界：绝不报告「已取消」掩盖下层仍在跑 | ⛔不改不新造（未违规） | `apps/datacore/src/solvers/cancellation.ts:24-32` | 反查：图侧不报告取消（因为没有取消），既有诚实位未被削弱 |
| RT-203 | C1（头号·真跑）3 并行 solver + 300ms 取消 → DataCore 侧 `finished=0` | ❌ | — | 无该测试 |
| RT-204 | C2 不取消 → 3 个全 `finished=1`（证探针有效） | ❌ | — | 无 |
| RT-205 | C3 超时取证包早于取消动作 | ❌ | — | 无 |
| RT-206 | C4 `onError=FAIL` 兄弟被 abort，B/C `finished=0` | ❌ | — | 无 |
| RT-207 | C5（反证）去掉 signal 透传 → C1 变红 | ❌ | — | 无 |

### A.6 §6 过程可见

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-208 | Skill 声明 `progress.emitsNarration` / `progress.phases[]`，Runtime 保证凡走到该 Skill 的路径进度都真发 | ❌ | — | Skill 无 progress 字段（RT-003） |
| RT-209 | 零新事件名，复用 `step.started`/`step.completed` 伪 step | ⛔不改不新造（未违规） | `skill-orchestrator.ts` | 未新增事件名（代价是零事件） |
| RT-210 | 伪 step `node_started` | ❌ | — | 0 命中 |
| RT-211 | 伪 step `agent_narration` 补 `nodeId/role/roleLabel` | ❌ | `agent/loop.ts:845` | 既有 `agent_narration` 未补节点字段 |
| RT-212 | 伪 step `node_progress`（`iteration/toolsUsed[]/elapsedMs/budgetLeft`） | ❌ | — | 0 命中 |
| RT-213 | 伪 step `node_timeout_diagnostic` | ❌ | — | 0 命中 |
| RT-214 | **必须补的一处**：`multi-route.ts` 补发 `step.started` | ❌ | `multi-route.ts:200/214/234` | 仍只发 completed |
| RT-215 | `makeRuntimeContext({task, auth, skill, enabledFeatures, config}) → RuntimeContext` 唯一工厂 | ❌ | — | 0 命中（RT-055） |
| RT-216 | `RuntimeContext` 含 tenantId/taskId/budget/signal/emit/observability | ❌ | — | 同上 |
| RT-217 | 执行入口只接 `RuntimeContext`，不再逐参数透传 | ❌ | `orchestrator.ts:2352/2603` | 仍逐参数透传（正是漏 `emitNarration` 的病根） |
| RT-218 | 门 `progress-reachability:check` 静态断言全仓无裸构造 | ❌ | — | 同 RT-077 |
| RT-219 | 前端 `selectStepRows` 扩 `role/roleLabel/nodeId/phase/iteration/budgetLeft` | ❌ | `taskStreamReducer.ts:139-161` | 逐行读：6 个字段一个没加 |
| RT-220 | `Timeline.tsx` 按 `role` 分栏呈现多角色并行进度 | ❌ | `apps/frontend-shell/src/components/QueryDock/Timeline.tsx` | 无分栏；仍单列 |
| RT-221 | 长静默显示「某角色仍在思考（已 xx s）」 | ❌ | 同上 | 无 |
| RT-222 | **红线**：前端不得为好看造中间态 | ⛔不改不新造（未违规） | 前端 | 反查未造假中间态 |
| RT-223 | §6.4 必须**同一个 dev 整单做**（后端 + 前端） | ⛔（流程条款·未开工） | — | W3 未开工 |
| RT-224 | D1（头号）· 6 条路径各跑一次 → 进度事件 >0 | ❌ | — | 无该测试；且 2 条路径恒 0 |
| RT-225 | D2 · 打乱完成顺序，三路旁白 role 不串台 | ❌ | — | 无 |
| RT-226 | D3 · 前端断言行含 `role` 且渲染分栏（不接受 role 塞 text 前缀） | ❌ | `orchestrator.ts:2228 区段` | 今天正是「塞 text 前缀」的绕法 |
| RT-227 | D4 · 首个进度信号到达时间 ≤ T（立单时填实测值） | ⛔本期不做（PRD 自标「不预设」） | — | 无 T 值，符合 PRD 自身口径 |
| RT-228 | D5（反证）· 去掉 observability 透传 → D1 全红 | ❌ | — | 无 |

### A.7 §7 Runtime 链第一站与 Track A 的关系

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-229 | R0（度量）可并行 | ⛔（分期裁决·非代码） | — | 裁决条款，无承载物需求 |
| RT-230 | R1 与 Runtime W1 **必须合并实施** | ⛔本期不做 | — | W1 未开工 |
| RT-231 | R2（白名单化）是 Runtime **硬前置** | ⛔本期不做（**未遵守**） | `skill-orchestrator.ts` 已并线 | ⚠ 注意：S1 切片**在 R2 未完成前就并线了**。但 S1 是旁挂端点、不接 QOS 主链，故未触发 §7.3 描述的「Runtime 只对漏网之题生效」风险 → 记为**风险已规避**，非违规 |
| RT-232 | R3 / R4 可后置 | ⛔（裁决条款） | — | — |
| RT-233 | R4 探索强制序与图 `entry` 语义重叠，立单须交叉评审防造两套 | ⛔本期不做 | — | 未立单 |
| RT-234 | `routing.completed` 载荷补 `{routeSource, skillKey}` 合并成一张 WO | ❌ | 同 RT-011/012 | — |
| RT-235 | metrics 计数器 `qos_route_source_total{source,skill}` | ❌ | `apps/agentcore/src/metrics.ts` | 0 命中（金丝雀：同文件 `qos_` 命中 17） |
| RT-236 | R2 最小充分条件：每道门改为「显式白名单才短路」 | ⛔本期不做 | — | 未做（属 Track A） |

### A.8 §8 Skill Orchestrator / Skill Graph

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-237 | `dependsOn` 定为**发布期硬依赖 + 编译期内联展开** | 🔗 | `skill-lint.ts:348` + `server.ts:1251` | 发布期硬依赖半 ✅ 有（`requirePublishedDeps: true` 真传），但**seed 数据 0 条 ⇒ 从未触发**；编译期内联展开半 ❌ 完全没有 |
| RT-238 | A 的图里可出现 `kind="skill"` 的引用节点（ref=B） | ✅ | `skill-graph.ts:34` + `skill-orchestrator.ts:289-311` | `skill` kind 已实现且有 SEAM 覆盖 |
| RT-239 | `compileGraph` 在编译期把 B 的图内联展开进 A（节点 id 加 `B/` 前缀） | ❌ | — | 无展开代码，无前缀逻辑 |
| RT-240 | 运行期只有一张扁平图：预算共享 / 取消共享 / ⟦ref⟧ 共享 / progress 同一条流 | ❌ | — | 四项全无（无预算、无取消、无 ref、无 progress） |
| RT-241 | **不做子会话**（反向断言） | ⛔不改不新造（未违规） | `skill-orchestrator.ts:289-311` | 反查 `runSkillNode` 只**读** Skill 元数据，不起子 agent 会话 → 严格未违规 |
| RT-242 | 编译期检环复用 `skill-lint.ts detectSkillDependencyCycle`，不新造 | 🔗**部分违规** | `skill-lint.ts:194-232` vs `skill-graph.ts:245-272` | 实测：图内环检测**自建了三色 DFS**，与 skill-lint 的 `dependsOn` 环检测是两份实现。作者在 `skill-graph.ts:245-246` 注明「与 `workflow/validate.ts detectStaticCycle` 同形」——**同形不等于同源**。两者作用对象不同（图节点 vs Skill 依赖），可辩护，但 PRD 明文要的是「复用不新造」 |
| RT-243 | 展开深度上界复用 `runtime.ts:27 MAX_DEPTH = 3` | ⛔本期不做（前置未落） | `apps/agentcore/src/runtime.ts:27` | 无展开 ⇒ 无深度；反查未新造第二个深度常量 |
| RT-244 | 节点数上界（建议 64），超限拒绝发布 | ✅ | `skill-graph.ts:124,127` | `MAX_GRAPH_NODES = 64` + `.max(64)`，超限 zod 拒 |
| RT-245 | §8.3 引用可校验硬门扩到全 kind：`solver` | ✅ | `apps/agentcore/src/server.ts:1265-1281` | **PRD 写的「发布时跨系统探针不存在」已过期**：`refclosure-a` 已并线，skill 发布路真调 `probeMissingRefs`（`resources.ts:64`），死路引用 → 422 `SKILL_REF_UNRESOLVED` 且**未落库**；`force` 不豁免 |
| RT-246 | `rule` kind 校验 | ✅ | `server.ts:1267,1272` | `refRuleKeys` 进探针 |
| RT-247 | `ontologyType` kind 校验 | ✅ | `server.ts:1268,1272` | `refObjectTypes` 进探针 |
| RT-248 | `slice` kind 校验 | ❌ | `server.ts:1265-1272` | 只筛 solver/rule/ontologyType 三种，**slice 未进探针** |
| RT-249 | `workflow`/`agent`/`skill` 本地 PUBLISHED 校验 | 🔗 | `skill-lint.ts:218,257` | `validateRefResolution` 第 218 行 `if (ref.kind !== "skill") continue;` —— **只做了 `skill` 一类**，workflow/agent 未做（与 PRD §8.3 表格要求一致地缺） |
| RT-250 | `constraint` kind 二选一处置（退役 / 归入 solver 子引用），**不得留「校验不了但看起来能校验」的 kind** | ❌**违反** | `packages/contracts/src/agentcore.ts:216` | `constraint` 仍在 `SKILL_REFERENCE_KINDS` 里，且**探针与 lint 都不校验它** → 正是 PRD 明令禁止的那个状态 |
| RT-251 | 契约缺口登记：`SKILL_REFERENCE_KINDS` 无 `tool`/`mcp`（归 Skill 契约 PRD） | ⛔本期不做（已登记） | `agentcore.ts:216` | 8 值仍无 tool/mcp → 与 PRD 描述一致，属登记项非缺口 |
| RT-252 | 反向收益：「改 C08 影响哪些 Skill」一次查询 | 🔗 | `apps/agentcore/src/dril/resource-projector.ts:324-331` | 真在投影 `skill→{rule,solver,slice,workflow,agent,skill}` 关系（`RESOURCE_REL_TARGET_KINDS`，从契约词表派生）；`ontologyType` 被显式跳过（`:328`）。**查询能力有**，但未做成 PRD 说的端点/CLI |
| RT-253 | `POST /b/v1/skills/lint` 不传 ctx 的诚实边界须一并接 | ❌ | `apps/agentcore/src/server.ts:1343`（`return lintSkill(target);`） | 仍不传 ctx；发布路（`:1251`）才传全 → 「lint 通过、发布被拒」的错位仍在 |
| RT-254 | §8.4 `GET /b/v1/skills/:id/graph` 返回编译后扁平图（含 `fromSkill` 标注） | ❌ | — | 端点 0 命中；`fromSkill` 0 命中 |
| RT-255 | R15 CLI 对等：`platform skill graph <key>` 或 `uiDeepLink` | ❌ | — | 同 RT-050 |
| RT-256 | 不做新可视化框架，复用 `Dag/taskDag.ts` 统一渲染 | ⛔不改不新造（未违规） | `apps/frontend-shell/src/components/Dag/taskDag.ts:35` | 反查未新建可视化框架（也未接入图） |

### A.9 §9 分期与 WO 拆分

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-257 | **W1** routeSource + skillKey 载荷统一 + metrics 计数器 | ❌**canonical 上没有**（且无未并分支承载） | — | 检索 12 条远端 skill 分支，无 W1 承载物 |
| RT-258 | W1 头号判据：每条路径 routeSource 互不相同且与实际门一一对应 | ❌ | — | 无 |
| RT-259 | **W2** Reasoning Graph 契约 + `compileGraph` + `GraphScheduler` + 三处扇出收编 | 🔗 | `skill-graph.ts` · `skill-orchestrator.ts` | 契约 ✅ / compileGraph ✅ / GraphScheduler ✅ / **三处扇出收编 ❌**。S1 切片只交了前三项，且自陈收编「属 W2 单」 |
| RT-260 | W2 判据 A1 字节等价 | ❌ | — | 无 |
| RT-261 | W2 判据 A2 并行真快（三节点 stub 600ms → 墙钟 ≤900ms 且 solver 调用数 = 3） | ⚠️/🔗 | `apps/agentcore/test/skill-orchestrator.seam.test.ts` | SEAM 测 18 条全绿（本次真跑，RC=0，2047ms），含「第二层真的拿到第一层输出」的 HTTP 端到端。**但未见 A2 的墙钟对照断言**——并发是结构性的（`Promise.allSettled`），未被时延判据咬住 |
| RT-262 | **W3** RuntimeContext + 预算接线 + 取消补线 + 进度全路径 + 前端消费 | ❌**canonical 上没有** | — | 全部 0 命中；无对应远端分支 |
| RT-263 | W3 判据 B1/C1/D1 | ❌ | — | 无 |
| RT-264 | **W4** `dependsOn` 内联展开 + 引用可校验硬门（全 kind） | 🔗 | `server.ts:1265-1281` | 引用硬门**部分已做**（3/8 kind，经 `refclosure-a` 提前落地）；内联展开 ❌ |
| RT-265 | W4 判据：引用不存在的 key → 发布真被拒（变异反证） | ✅ | `server.ts:1279` | 422 `SKILL_REF_UNRESOLVED` + 明确「发布被拒且未落库」；`force` 不豁免（`:1262-1264` 注释说明理由） |
| RT-266 | **W5** human 节点跨请求 resume | ⛔另立单（已标注） | `checkpoint.ts:22` | — |

### A.10 §10 SEAM-GATE 验收判据总表

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-267 | A1 确定性零漂移（32 意图字节相等） | ❌ | — | 无 |
| RT-268 | A1 变异反证（归并改完成序 → 红） | 🔗 | `skill-orchestrator.ts:191-201` | 归并按声明序**已实现**，但无对应变异测试 |
| RT-269 | A2 并行真快 + solver 调用数 = 3 | ⚠️ | 同 RT-261 | — |
| RT-270 | A2 变异反证（去掉波并发 → 红） | ❌ | — | 无 |
| RT-271 | A3 并行不串台（三路 role 各自正确） | ❌ | — | 无 emit ⇒ 无从断言 |
| RT-272 | A4 全 PURE 图跑通、`agentRequests=0`、两次重跑字节一致 | 🔗 | `test/skill-orchestrator.seam.test.ts` | 图确实全 PURE（只有 skill/solver 两 kind，`agentRequests` 天然 0）；未见「两次重跑字节一致」的显式断言 |
| RT-273 | A4 变异反证（DETERMINISTIC 图塞 agent 节点 → 发布应被拒） | ❌ | 同 RT-042 | mode 零读点 |
| RT-274 | B1 预算按题型真生效 | ❌ | — | — |
| RT-275 | C1 取消真停到底 | ❌ | — | — |
| RT-276 | D1 进度全路径真发 | ❌ | — | — |
| RT-277 | E1 不新增第二套扇出（`graph-runtime:check` 断言 `Promise.all(`/`allSettled(` 扇出语境唯一） | ❌**实测已违反** | `multi-route.ts:210` + `skill-orchestrator.ts:155` | 两处扇出语境的并发调用；门不存在 |
| RT-278 | E2 无裸调用点（无裸 `new BudgetTracker(`、无裸 `runAgentLoop({emitNarration...})`） | ❌**实测已违反** | 9 处裸 `new BudgetTracker(` | 门不存在 |
| RT-279 | F1 四包全绿 | ◐**未全跑** | — | 本次只跑了 `test/skill-orchestrator.seam.test.ts`（18/18 绿）+ contracts/llm-adapters build（RC=0）。**四包全量未跑**，诚实标注 |
| RT-280 | F2 门显式捕获退出码，禁止 `cmd \| tail; echo $?` | ✅ | 本报告 | 本次所有命令均直接取 RC 或用 `PIPESTATUS[0]`，未用管道末端 `$?` |

### A.11 §11 回写清单

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-281 | 本体 §2.H `Skill` 条目补 `execution`/`budget`/`progress` 三组字段与消费方 | ⛔本期不做（**已诚实标注**） | `docs/SYSTEM-ONTOLOGY.md:279` | 本体明写「未挂 ≠ 已实现·Skill.execution 恒空」→ 不是「宣称做了」 |
| RT-282 | 本体 §2.H `ExecutionPlan` 标注「降为图的链式退化形态」 | 🔗 | `SYSTEM-ONTOLOGY.md:259-275` | 新增段落描述图链，但既有 `ExecutionPlan` 条目未加该标注 |
| RT-283 | 本体 §3 编排链最右段改写 + 三处扇出收编说明 | 🔗 | `SYSTEM-ONTOLOGY.md:259` | 并存新增而非改写（RT-025）；收编说明写在断点 `:983` 而非 §3 |
| RT-284 | 本体 §4 事件表补 routeSource/skillKey/nodeId 等 | ⛔本期不做（前置未落） | — | 无新载荷 ⇒ 无可回写 |
| RT-285 | 本体 §5 新增不变量「预算 reserve-then-run」「身份由节点自带」 | ❌ | `SYSTEM-ONTOLOGY.md` | 两条命名不变量未登记 |
| RT-286 | 本体 §7 登记 `graph-runtime:check` / `progress-reachability:check`，gates 串计数 +2 | ⛔本期不做（前置未落） | `package.json:32` | 门未建 ⇒ 未登记，一致 |
| RT-287 | 本体 §8 登记 `G-SERIAL-GRAPH-EXECUTION` | ✅ | `SYSTEM-ONTOLOGY.md:983` | 已登记且状态「开」，正文如实写「三套 + 一套新的，比目标态更远」 |
| RT-288 | 本体 §8 登记 `G-PROGRESS-PATH-UNREACHABLE` | ❌ | `SYSTEM-ONTOLOGY.md` | 命中 0（金丝雀：同文件 `G-SERIAL-GRAPH-EXECUTION` 命中 2） |
| RT-289 | 金值不变（demo-chain/catalog/ontology-core） | ✅ | — | 本线未新增 solver / 对象类型 / 领域事件 → 金值确应不变 |

### A.12 §12 核实/未核实清单（PRD 自陈 19 + 6 + 2）

| 编号 | 需求（PRD 自陈事实，判「今天是否仍如此」） | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| RT-290 | ①执行器串行 | ✅仍成立 | RT-078 | — |
| RT-291 | ②`maxBudgetRounds` 零消费方 | ✅仍成立 | RT-084 | — |
| RT-292 | ③出厂 7 Skill 无 dependsOn/maxBudgetRounds | ✅仍成立 | RT-085/086 | — |
| RT-293 | ④意图/计划各 32、Skill 7 | ◐未复核 | `seed.ts` | 本次未重数（不当结论用） |
| RT-294 | ⑤求解器 57 个 | ◐未复核 | `apps/datacore/src/solvers/service.ts:44` | 未重数 |
| RT-295 | ⑥D1 取消已并线且只覆盖同步求解通道 | ✅仍成立 | RT-090/091 | — |
| RT-296 | ⑦QOS 通道 solver invoke 不传 signal | ✅仍成立 | `tools/executor.ts:401` | — |
| RT-297 | ⑧任务取消是轮询标志 | ✅仍成立 | RT-092 | — |
| RT-298 | ⑨Coordinator 旁白已接但角色靠串行序 | ✅仍成立 | RT-094/100 | — |
| RT-299 | ⑩角色/场景 agent 不传 emitNarration | ✅仍成立 | RT-095/096 | — |
| RT-300 | ⑪前端 reducer 丢弃 role 三字段 | ✅仍成立 | RT-101 | — |
| RT-301 | ⑫多域并行只发 completed | ✅仍成立 | RT-098 | — |
| RT-302 | ⑬分类器是第 14 个决策点 | ◐未复核 | — | RT-102 |
| RT-303 | ⑭24 字长度门 `ceo-route.ts:217` | ◐未复核 | — | 未重读 |
| RT-304 | ⑮三条 WO 新断点未回写本体 | ❌**已过期** | `SYSTEM-ONTOLOGY.md` | 实测三条命中 2/1/1 → **PRD 该条已不成立**（RT-065） |
| RT-305 | ⑯`checkpoint.ts` 是 Noop | ✅仍成立 | `workflow/checkpoint.ts:22` | — |
| RT-306 | ⑰`skill-lint` 只解析 kind=skill；发布端点无跨系统引用校验；lint 端点不传 ctx | ◐**部分过期** | `skill-lint.ts:218` · `server.ts:1272` · `server.ts:1343` | 前半仍成立（lint 只解析 skill）；**中段已过期**（发布端点已接 `probeMissingRefs`）；后半仍成立（lint 端点不传 ctx） |
| RT-307 | ⑱无 routeSource metrics 计数器 | ✅仍成立 | `metrics.ts` | — |
| RT-308 | ⑲9 个 BudgetTracker 站点 | ✅仍成立 | RT-088 | — |
| RT-309 | 未核实 a–f 六项（203s 拆解 / 旁白对照 / 80 用例 / D1 探针 / 真 LLM 分类 / DRIL 召回） | ⛔（PRD 自标未核实） | — | 本次同样未复跑，据实沿用「未核实」标注 |
| RT-310 | 明确不做的推测：不预设并行对 provider 限流的影响 | ⛔绝对不做（未违规） | — | 未预设 |
| RT-311 | 明确不做的推测：不预先设计未验证的事件采样策略 | ⛔绝对不做（未违规） | — | 未设计 |

> **RT 小计：311 条**（我的提取粒度比 214 细，主要在 §0.4 不变量、§3.1 字段、§10 判据三处逐项拆开；**覆盖面是全文，无抽样**）。粒度差异不影响结论，见 §C 计数。

---

## B. `PRD-skill-governance-learning.md` 逐条（GOV-001 … ）

### B.0 §0 本体引用与影响

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| GOV-001 | `Skill` 扩 `permissions`（data/tool/action 三面） | ❌ | `packages/contracts/src/agentcore.ts:236-261` | 15 字段无 permissions；`permissions` 在 features.ts / registry.ts 0 命中 |
| GOV-002 | `Skill` 扩 `promptRefs`（Prompt 版本引用） | ❌ | 同上 | 0 命中 |
| GOV-003 | `SkillReference` 扩 kind `tool` | ❌ | `agentcore.ts:216` | `SKILL_REFERENCE_KINDS` 仍 8 值 |
| GOV-004 | 扩 kind `mcp` | ❌ | 同上 | — |
| GOV-005 | 扩 kind `actionType` | ❌ | 同上 | — |
| GOV-006 | `FeatureDef.bindings` 扩 `skills[]` | ❌ | `packages/contracts/src/features.ts:15-22` | 逐字段读：只有 `intents`/`solverKeys`/`apiTags` |
| GOV-007 | `PromptTemplate` 扩 `PROMPT_KEYS` 覆盖 agent 侧核心 prompt | ❌ | `packages/contracts/src/prompt-template.ts:10` | 仍 5 键（classifier/extraction/modeling/skill_summary_lint/answer_compose） |
| GOV-008 | `PromptTemplate` 新增内容指纹 `digest` | ❌ | `prompt-template.ts:22-31` | `digest` 0 命中（金丝雀：同文件 `version` 命中 2） |
| GOV-009 | 新增一等对象 `SkillExecutionTrace` | ❌ | — | **全仓 src 0 命中**（docs 12 处）。复核派单方的实测：**一致，确为 0** |
| GOV-010 | 新增 `SkillOutcomeStat`（纯聚合非表） | ❌ | — | 全仓 src 0 命中（docs 8 处） |
| GOV-011 | 新增 `HumanCorrection` | ❌ | — | 全仓 src 0 命中（docs 10 处） |
| GOV-012 | `ActionDraft.origin` 加 `skillKey`/`skillVersion` | ❌ | `packages/contracts/src/actions.ts:47-51` | 逐字段读：只有 `taskId`/`agentId`/`userId` |
| GOV-013 | `GapReport/GrowthTicket/GrowthLedgerEntry` 补人在回路审批位（经 Action） | ❌ | — | `growth.proposal_*` / `growth_intent_publish` 全仓 0 命中 |
| GOV-014 | `EvalCase/EvalRunReport` 复用为技术面数据源 + 补业务面/质量面 | 🔗 | `apps/agentcore/src/evals.ts:153-216` | 技术面五项在且 report 带 tenantId；业务面/质量面未补 |
| GOV-015 | `Metrics` P0 硬前置：补租户维 | ❌ | `apps/datacore/src/metrics.ts` · `apps/agentcore/src/metrics.ts` | 两文件 `tenant` grep **RC=1（零命中）**；金丝雀：同两文件 `inc(` 命中 5 / 1 → 工具有效 |
| GOV-016 | `Metrics` P0 硬前置：`/metrics` 鉴权 | ❌ | `apps/datacore/src/app.ts:848` · `apps/agentcore/src/server.ts:207` | 见 §E-1 实测 |
| GOV-017 | 链路：`sys.orch.query_to_answer` 加平行留痕支路 `→ SkillExecutionTrace` | ❌ | — | 无 Trace 对象 |
| GOV-018 | 链路：`sys.access.entitlement` 扩为 `Feature→{...,skill,tool,actionType}` | ❌ | `apps/agentcore/src/features/registry.ts:187-220` | 只有 `featureEnabled`/`intentAllowed`/`solverAllowed`；`skillAllowed` 全仓 0 命中 |
| GOV-019 | 链路：学习闭环改生产配置必须挂 `sys.action.writeback` | ⛔本期不做（未违规） | — | 反查：无学习闭环 ⇒ 无旁路直写 |
| GOV-020 | 链路：`sys.meta.change_loop` 新增门须回写本体 §7 | ⛔本期不做（前置未落） | — | 三门未建 |
| GOV-021 | 新增链路 `Skill --requires--> {tool\|mcp\|actionType}` | ❌ | — | — |
| GOV-022 | 新增链路 `Skill --traced--> Trace --aggregates--> Stat --consumedBy--> skill-router 排序` | ❌ | `apps/agentcore/src/agent/skill-router.ts:71 selectSkills` | 读过 skill-router：只有 `lexTokens`/`scoreSkill`/`rankSkills`/`selectSkills`，**无 weight 乘子** |
| GOV-023 | 新增链路 `GapReport(NO_INTENT) --proposes--> ActionDraft --approval--> Intent(PUBLISHED)` | ❌ | `apps/agentcore/src/growth/scaffold.ts:54-82` | scaffold 直接 `catalog.createIntent`（DRAFT），**无 ActionDraft 中间态** |
| GOV-024 | 事件 `skill.published` 沿用 | ✅ | `server.ts`（skill publish 段） | 既有 |
| GOV-025 | 事件 `growth.*` 四个沿用 | ✅ | `apps/agentcore/src/growth/` | 既有 |
| GOV-026 | 事件 `action.pending_approval` / `action.executed` 沿用 | ✅ | `apps/datacore/src/actions.ts` | 既有 |
| GOV-027 | 补登记 `feedback.recorded`（真 emit 但订阅表零命中） | ❌ | `orchestrator.ts:2735` emit · `event-subscriptions.ts` | 订阅表 `feedback.recorded` **0 命中**（金丝雀：同文件 `event\|subscri` 命中 59）→ **R10/D-29 缺口仍在** |
| GOV-028 | 新事件 `skill.trace_recorded` | ❌ | — | 0 命中 |
| GOV-029 | 新事件 `skill.correction_recorded` | ❌ | — | 0 命中 |
| GOV-030 | 新事件 `growth.proposal_submitted` | ❌ | — | 0 命中 |
| GOV-031 | 新事件 `growth.proposal_approved` | ❌ | — | 0 命中 |
| GOV-032 | R2 · 指标面补租户维（本 PRD 头号驱动） | ❌ | 同 GOV-015 | — |
| GOV-033 | R3 · Skill 权限三面与 entitlement **同一判定函数** `featureEnabled` | ❌ | `features/registry.ts:187` | 无 `skillAllowed` |
| GOV-034 | R4 · 学习闭环产生的生产配置变更一律经 Action | ⛔本期不做（未违规） | — | 无学习闭环 |
| GOV-035 | R6 · Trace/Stat/权限判定全为纯函数，时钟由调用方注入 | ⛔本期不做（前置未落） | — | 反查：未造带 `Date.now()` 的半成品 |
| GOV-036 | R7 · 权限拒绝复用既有码（404 `FEATURE_NOT_FOUND` / `AGENT_SCOPE_VIOLATION`） | ⛔本期不做（未违规） | `agent/loop.ts:598` | 反查：未新增 `SKILL_ACTION_NOT_PERMITTED`（0 命中）→ 也未新增错误码 |
| GOV-037 | R9 · `skill_execution_traces` / `human_corrections` 两表四处同改 | ❌ | `apps/*/migrations/` | 两表名全仓 0 命中 |
| GOV-038 | R10 · 三新事件进 `event-subscriptions.ts` 并有下游订阅 | ❌ | — | — |
| GOV-039 | R13 · Trace 是 R13 在「AI 行为」维的对称物 | ❌ | — | — |
| GOV-040 | R14 · 权限声明/指标口径/Trace 字段不得内联行业实体名 | ⛔本期不做（未违规） | — | 无承载物 ⇒ 无违规 |
| GOV-041 | R16 · 生长回路「AI 可以起草，人必须签字」 | ❌ | `apps/agentcore/src/server.ts:244-245` | `/api/v1/growth/run` 只有 `auth(req)`，**无 requireRole**、无签字位 |
| GOV-042 | Skill 发布双门：`permissions` 引用可解析性并入门禁一 | ❌ | `server.ts:1246-1281` | 无 permissions |
| GOV-043 | `action-wiring:check`：生长提案新增 ActionType 须归入 WIRED/NO_WRITE/NOT_IMPLEMENTED | ⛔本期不做（前置未落） | `apps/datacore/src/actions.ts:35-63` | 反查 `ACTION_WIRING` 无 `growth_intent_publish` / `skill_config_change` → 未偷偷加 |
| GOV-044 | `ontology-writeback:check`：本文新增门必须回写本体 §7 | ⛔本期不做（前置未落） | — | 三门未建 |
| GOV-045 | `prd:check`：本文 §0 入 `docs/prd-ontology-index.json` | ✅ | `docs/prd-ontology-index.json:2208` | 有独立条目 + 大量链路/不变量引用 |
| GOV-046 | 新门 `metrics-tenant:check` | ❌ | `scripts/` | 0 命中（金丝雀：`ls scripts \| grep -c check-` = 51） |
| GOV-047 | 新门 `skill-permission:check` | ❌ | — | 0 命中 |
| GOV-048 | 新门 `growth-hitl:check` | ❌ | — | 0 命中 |
| GOV-049 | G-8 继续收窄（Trace + 权限引用校验纳入闭包） | ❌ | — | 无承载物 |
| GOV-050 | G-9 部分收窄（生长回路人在回路） | ❌ | — | 无承载物 |
| GOV-051 | `G-ACTION-NOOP-EXEC`：采纳率不得把 NOT_IMPLEMENTED 的 EXECUTED 算成采纳成功 | ⛔本期不做（未违规） | `apps/datacore/src/actions.ts:59` | 反查：`采纳经营方案: "NOT_IMPLEMENTED"` 仍在且注释详尽；无采纳率计算器 ⇒ 无错算 |
| GOV-052 | `G-SKILL-UNREACHABLE-FREE-QA`：权限三面必须覆盖自由问答第二条路径 | ❌ | `orchestrator.ts:257 selectTenantSkills` | 逐行读：只筛 PUBLISHED + 最高版本 + key 排序，**无 entitlement 过滤** |
| GOV-053 | `G-LLM-BUDGET-NO-CONSUMER` 教训：任何新增声明必须同单接上消费方 | ⛔本期不做（未违规） | — | 无新增声明 ⇒ 无新增无消费方声明 |
| GOV-054 | 登记本体断点 `G-SKILL-PERM-NO-TOOL-ACTION` | ❌ | `docs/SYSTEM-ONTOLOGY.md` | 命中 0（金丝雀：同文件 `G-SERIAL-GRAPH-EXECUTION` 命中 2） |
| GOV-055 | 登记 `G-TRACE-NO-PROMPT-VERSION` | ❌ | 同上 | 命中 0 |
| GOV-056 | 登记 `G-METRICS-CROSS-TENANT-AND-OPEN` | ❌ | 同上 | 命中 0 |
| GOV-057 | 登记 `G-GROWTH-WRITE-BYPASSES-GATE` | ❌ | 同上 | 命中 0 |
| GOV-058 | 回写①本体 §2.H 新增三个对象类型条目 | ❌ | — | — |
| GOV-059 | 回写②`Skill` 补 permissions；`SkillReference` 补 kind | ❌ | — | — |
| GOV-060 | 回写③`sys.access.entitlement` 切片补 skill/tool/actionType | ❌ | — | — |
| GOV-061 | 回写④§4 事件表补四新事件 + 补登 `feedback.recorded` | ❌ | — | — |
| GOV-062 | 回写⑤§7 登记三门 | ❌ | — | — |
| GOV-063 | 回写⑥§8 登记四断点 | ❌ | — | 同 GOV-054..057 |

### B.1 §1 问题陈述 AS-IS（判「今天是否仍如 PRD 所述」）

| 编号 | 断言 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| GOV-064 | data 面：A6 行级过滤是 per-User/Role | ✅仍成立 | 本体 §7 | — |
| GOV-065 | data 面：Agent 对象类型 scope 是 per-Agent 且 opt-in | ✅仍成立 | `tools/executor.ts` scopeObjectTypes · `engine.ts` | `enforceObjectScope: true` 只在角色 agent 路传（`orchestrator.ts:2367`） |
| GOV-066 | tool 面：`scopeDeclaration.toolNames` 是 per-Agent | ✅仍成立 | `apps/agentcore/src/tools/executor.ts:36` · `agent/loop.ts:590` | `scopeToolNames` 越界 → `AGENT_SCOPE_VIOLATION`（`loop.ts:598`） |
| GOV-067 | feature 面：entitlement 是 per-Tenant/Role × {intent, solver, view} | ✅仍成立 | `features/registry.ts:187/201/213` | — |
| GOV-068 | `SkillDefinitionSchema` 无任何权限字段 | ✅仍成立 | `agentcore.ts:236-261` | — |
| GOV-069 | `SKILL_REFERENCE_KINDS` 无 tool/mcp/actionType | ✅仍成立 | `agentcore.ts:216` | — |
| GOV-070 | `FeatureDef.bindings` 无 skills | ✅仍成立 | `features.ts:16-22` | — |
| GOV-071 | `selectTenantSkills` 不过 entitlement | ✅仍成立 | `orchestrator.ts:257-268` | 逐行读完 |
| GOV-072 | 唯一 Skill→工具关联是 `isWriteModeSkill` 布尔开关 | ✅仍成立 | `agentcore.ts:201` · `skill-probe.ts:253` | 追到 `buildProbeTools`：写模式才给 `create_action_draft` |
| GOV-073 | `ToolCallRow` 有 toolName/input/output/outcome/durationMs | ✅仍成立 | `apps/agentcore/src/persistence/repos.ts:38-48` | — |
| GOV-074 | `ToolCallRow` **无 tenantId** | ✅仍成立 | 同上 | — |
| GOV-075 | `AgentRunRecord` 无 skill 版本、无 prompt 版本 | ✅仍成立 | `packages/contracts/src/qos.ts` AgentRunRecord | — |
| GOV-076 | `ProvenanceRef` 有 toolCallId/toolName/outputPath/snapshotVersion | ✅仍成立 | `qos.ts` ProvenanceRef | — |
| GOV-077 | `RefKind` 已含 `skill`，注册 agent 路真 emit | ✅仍成立 | `packages/contracts/src/refs.ts` · `apps/agentcore/src/engine.ts` | — |
| GOV-078 | Prompt 无版本且是代码常量（`promptVersion\|prompt_version\|promptHash` 零命中） | ✅仍成立 | `apps/agentcore/src/agent/prompts.ts:5` | 三键 grep **RC=1（零命中）**；金丝雀：同目录 `resolvePromptOverride` 命中 `prompts.ts:240` |
| GOV-079 | `PROMPT_KEYS` 只有 5 个；B 侧只消费 `classifier` | ✅仍成立 | `prompt-template.ts:10` · `orchestrator.ts:1255` | 追调用：`resolvePromptOverride(..., "classifier")` 是 B 侧唯一消费点 |
| GOV-080 | 自由问答路技能注入不留痕（无 `onResolvedRef`） | ✅仍成立 | `orchestrator.ts:1997` 段 | `freeQaSkills` 拼进 prompt，该 `runAgentLoop` 调用无 `onResolvedRef` |
| GOV-081 | 求解器结果不入 Trace（散在 ToolCallRow.output / provenance） | ✅仍成立 | `repos.ts:44` | — |
| GOV-082 | 人工反馈不挂 Trace；路径 A 只 emit `feedback.recorded` 就丢 | ✅仍成立 | `orchestrator.ts:2735` | 追一层：emit 后无落盘；订阅表零登记（GOV-027） |
| GOV-083 | 前置 A：`ActionMetrics` 四方法标签只有 `{action_type, outcome}` | ✅仍成立 | `apps/datacore/src/metrics.ts:96-114` | 逐方法读完 submit/approval/execute/executeAttempt |
| GOV-084 | 两 metrics 文件零 tenant（RC=1） | ✅仍成立 | 同上 | 见 §F 金丝雀 |
| GOV-085 | 全仓零 tenant 标签计数（RC=1） | ✅仍成立 | `apps/*/src` | `grep -rnE "inc\(\s*\{[^}]*tenant"` RC=1 |
| GOV-086 | 后果：两租户提交 → 合成一条 `2` | ✅仍成立（代码层） | `metrics.ts:99-101` | 标签集不含 tenant ⇒ 必然合并序列 |
| GOV-087 | 加重情节：`ActionDraft.origin` 无 skillKey/skillVersion | ✅仍成立 | `actions.ts:47-51` | — |
| GOV-088 | 前置 B：DataCore `/metrics` 在 `PUBLIC_PATHS` 里 | ✅仍成立 | `apps/datacore/src/app.ts:848` | 行号从 838 漂到 848，内容一致 |
| GOV-089 | 鉴权钩子第一行 `if (PUBLIC_PATHS.has(path)) return;` | ✅仍成立 | `apps/datacore/src/app.ts:860` | 在服务令牌与 JWT 判定**之前** |
| GOV-090 | DataCore `/metrics` handler 连 req 都不看 | ✅仍成立 | `apps/datacore/src/app.ts:927` | `async (_req, reply) => reply.type("text/plain").send(metrics.render())` |
| GOV-091 | AgentCore `/metrics` handler 不调 `auth(req)` | ✅仍成立 | `apps/agentcore/src/server.ts:207-210` | `async (_req, reply)`；相邻业务端点 `:221` 第一行是 `const a = await auth(req);` |
| GOV-092 | 后果：无凭据 GET 即可拿全租户业务活动画像 | ✅仍成立（代码层） | 同上 | 见 §E-1 |
| GOV-093 | §1.4 订正：生长回路**已有执行器**（`scaffoldDraftIntent` → `createIntent` → `intents.insert`） | ✅仍成立 | `growth/scenario-grow.ts` → `growth/scaffold.ts:54-82` → `catalog/service.ts:150,159` | 追全链核实 |
| GOV-094 | ④-a 写入口无角色门（`/api/v1/growth/run` 只有 `auth`） | ✅仍成立 | `apps/agentcore/src/server.ts:243-245` | 逐行读：`const a = await auth(req);` 之后直接 `SubmitQueryBodySchema.parse`，**无 requireRole**。对照正门 `catalog/packages/:packageId/intents` 有 `requireCatalogAdmin` |
| GOV-095 | ④-b `publishIntent` 端点是 RBAC 直发布，无 Action 审批链 | ✅仍成立 | `apps/agentcore/src/server.ts:540` | `deps.catalog.publishIntent(intentId)` 直调 |
| GOV-096 | ④-c 无审批位界面；`owner:"growth-engine"` 从未被消费 | ✅仍成立 | `GrowthCockpitPage.tsx` | 「提案/批准/驳回」grep 0 命中；金丝雀「认领/claim」命中 5 |
| GOV-097 | 正面资产①决策成效闭环存在且租户隔离 | ✅仍成立 | `apps/datacore/src/decision/kernel.ts:237-239` | — |
| GOV-098 | 正面资产②DRIL 质量分 EWMA per-tenant | ✅仍成立 | `apps/agentcore/src/dril/quality.ts` | — |
| GOV-099 | 正面资产③Evals 真跑管线带 tenantId + 五项指标 | ✅仍成立 | `apps/agentcore/src/evals.ts` | — |
| GOV-100 | 欠账：`DecisionOutcomeStat.weight` 无求解器消费方 | ✅仍成立 | `apps/datacore/src/decision/kernel.ts:237` · `outcome-stats.ts:14` | 追调用：只有 kernel + 读端点；`apps/datacore/src/solvers/` 零命中 |

### B.2 §2 P0 硬前置

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| GOV-101 | `ActionMetrics` 改为持 tenantId 或每方法收 tenantId | ❌ | `apps/datacore/src/metrics.ts:96-114` | 四方法签名 `(actionType, outcome)` 未变 |
| GOV-102 | `submit` 追加 `tenant` 标签 | ❌ | `:99-101` | — |
| GOV-103 | `approval` 追加 `tenant` 标签 | ❌ | `:103-105` | — |
| GOV-104 | `execute` 追加 `tenant` 标签 | ❌ | `:107-109` | — |
| GOV-105 | `executeAttempt` 追加 `tenant` 标签 | ❌ | `:111-113` | — |
| GOV-106 | AgentCore `qos_tasks_total` 补 tenant | ❌ | `apps/agentcore/src/metrics.ts` | 文件零 tenant |
| GOV-107 | `qos_tool_calls_total` 补 tenant | ❌ | 同上 | — |
| GOV-108 | `qos_llm_tokens_total` 补 tenant | ❌ | 同上 | — |
| GOV-109 | `qos_agent_*` 补 tenant | ❌ | 同上 | — |
| GOV-110 | 基数保护：只有业务计数器加 tenant，进程级健康指标不加 | ⛔本期不做（前置未落） | — | 反查未误加 |
| GOV-111 | 租户标签值取 `tenantId` 原值，不拼接 | ⛔本期不做（前置未落） | — | — |
| GOV-112 | 新增 env `METRICS_TENANT_LABEL`（默认 1），关时逐字节兼容 | ❌ | — | 0 命中 |
| GOV-113 | `ActionDraft.origin` 补 `skillKey`/`skillVersion`（additive optional） | ❌ | `actions.ts:47-51` | — |
| GOV-114 | `ActionMetrics.submit` 补 `skill` 标签（非 Skill 发起落 `-`） | ❌ | `metrics.ts:99-101` | — |
| GOV-115 | 验收：t1/t2 各提交一次 → 两条独立序列，不得合成 2 | ❌ | — | 无该测试 |
| GOV-116 | 验收：变异反证（去 tenant 标签 → 红） | ❌ | — | 无 |
| GOV-117 | 验收：Skill 发起的草稿 → `dc_action_submit_total{skill=..,tenant=..}` 可查 | ❌ | — | 无 |
| GOV-118 | `metrics-tenant:check` 静态断言四方法体内均出现 tenant 标签键 | ❌ | — | 门不存在 |
| GOV-119 | `metrics-tenant:check` 断言业务计数器 `inc(` 均带 tenant + 白名单逐条写理由 | ❌ | — | 门不存在 |
| GOV-120 | `metrics-tenant:check` green→red 有牙 | ❌ | — | 门不存在 |
| GOV-121 | DataCore `/metrics` 移出 `PUBLIC_PATHS` | ❌ | `apps/datacore/src/app.ts:848` | 仍在集合内 |
| GOV-122 | DataCore `/metrics` handler 要求 `X-Service-Token === SERVICE_TOKEN` 或 admin JWT | ❌ | `apps/datacore/src/app.ts:927` | handler 不看 req。⚠ 追一层：即便 handler 改了，`onRequest` 钩子 `:860` 也会在 PUBLIC_PATHS 命中时先 return，两处必须同改 |
| GOV-123 | 其余一律 401/403（错误信封 R7） | ❌ | — | — |
| GOV-124 | AgentCore `/metrics` handler 首行加同口径凭据校验 | ❌ | `apps/agentcore/src/server.ts:207` | — |
| GOV-125 | 不新造第三套认证 | ⛔不改不新造（未违规） | — | 反查未新造 |
| GOV-126 | 租户视图：admin 拉取按 tenantId 过滤，只有 service 拉全量 | ❌ | — | 无 |
| GOV-127 | 出货配置照做：compose 的 prometheus 抓取侧带 `SERVICE_TOKEN` | ❌ | `docker-compose.yml` | 无 prometheus 服务；无抓取侧配置 |
| GOV-128 | 验收：无 header GET `/metrics` → 401/403（两服务各一条） | ❌ | — | 实测今天是 **200**（§E-1） |
| GOV-129 | 验收：带 `X-Service-Token` → 200 且非空 | ❌ | — | 无该区分 |
| GOV-130 | 验收：带非 admin 用户 JWT → 403 | ❌ | — | — |
| GOV-131 | 变异反证：`/metrics` 塞回 PUBLIC_PATHS → 门红 | ❌ | — | 门不存在 |
| GOV-132 | `metrics-tenant:check` 并入 `pnpm gates` | ❌ | `package.json:32` | — |
| GOV-133 | 本体 §7 登记该门 | ❌ | — | — |
| GOV-134 | 本体 §8 登记 `G-METRICS-CROSS-TENANT-AND-OPEN`，闭合后标 ✅ | ❌ | — | 同 GOV-056 |

### B.3 §3 Skill 权限三面

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| GOV-135 | 红线：Skill 启用/禁用判定必须走同一个 `featureEnabled`，**不得新增 `skillEnabled` 平行实现** | ⛔不改不新造（未违规）+ ❌（正向未做） | `features/registry.ts:187` | 反查：**没有**任何平行实现（`skillEnabled`/`skillAllowed` 均 0 命中）→ 反向红线未被违反；但正向能力也不存在 |
| GOV-136 | `FeatureDef.bindings` 加 `skills?: string[]` | ❌ | `features.ts:16-22` | — |
| GOV-137 | 新增 `skillAllowed(set, skillKey)`，函数体与 `intentAllowed`/`solverAllowed` 逐行同构 | ❌ | `features/registry.ts:201,213` | 两个同构样板在，第三个没写 |
| GOV-138 | 关掉 `view.risk-board` → 绑其上的 skill 同时消失 | ❌ | — | — |
| GOV-139 | `permissions.data.objectTypes` | ❌ | — | — |
| GOV-140 | `permissions.data.slices` | ❌ | — | — |
| GOV-141 | `permissions.tool.allow` | ❌ | — | — |
| GOV-142 | `permissions.tool.deny`（优先于 allow） | ❌ | — | — |
| GOV-143 | `permissions.action.allowedTypes` | ❌ | — | — |
| GOV-144 | `permissions.action.maxRiskLevel` | ❌ | — | — |
| GOV-145 | data 面强制点：有效对象类型集 = agent scope **∩** Skill 声明（只能收窄） | ❌ | `tools/executor.ts` scopeObjectTypes 段 | 强制层在，交集运算不存在 |
| GOV-146 | tool 面强制点：agent scope ∩ allow ∖ deny，越界返回既有 `AGENT_SCOPE_VIOLATION` | ❌ | `agent/loop.ts:590-609` | 既有 per-Agent 门在，Skill 半不存在 |
| GOV-147 | action 面强制点：`actionTypeKey ∈ allowedTypes`，否则 `SKILL_ACTION_NOT_PERMITTED` | ❌ | — | 错误码 0 命中 |
| GOV-148 | 与既有 `isWriteModeSkill` 串联（先判写模式再判能发哪一型） | ❌ | `agentcore.ts:201` | 前半在，后半不存在 |
| GOV-149 | 自由问答路 `selectTenantSkills` 追加 `skillAllowed` 过滤 | ❌ | `orchestrator.ts:257-268` | — |
| GOV-150 | `SKILL_REFERENCE_KINDS` 扩 tool/mcp/actionType，`permissions` 每个 key 表达为 `SkillReference` | ❌ | `agentcore.ts:216` | — |
| GOV-151 | 发布门禁一校验 `tool` key ∈ `tools/registry.ts` | ❌ | `server.ts:1265-1281` | 探针只查 solver/rule/objectType |
| GOV-152 | 校验 `actionType` key ∈ 本租户已注册 ActionType（含 `ACTION_WIRING`） | ❌ | 同上 | — |
| GOV-153 | 校验 `objectTypes` ∈ 本租户已发布本体 | ✅（既有 kind 侧） | `server.ts:1268,1272` | `ontologyType` 引用已进探针（`refclosure-a`）→ 这一条**已提前满足**，虽非本 PRD 交付 |
| GOV-154 | 反向收益：投影进 DRIL `resource_relations`，扩三种 kind | 🔗 | `dril/resource-projector.ts:324-331` | 投影器在且从契约词表**派生**目标 kind 集（`RESOURCE_REL_TARGET_KINDS`），**扩枚举即自动生效**——但枚举未扩（GOV-150） |
| GOV-155 | `permissions` 为 optional，缺省**必须显式定义且不能是全开** | ❌ | — | — |
| GOV-156 | 缺省（注册 agent 路）= 继承所在 agent 的 scope | ❌ | — | — |
| GOV-157 | 缺省（自由问答路）= `PROBE_TOOL_NAMES` 同款只读集 + `action.allowedTypes=[]` | ❌ | `skill-probe.ts:28` | `PROBE_TOOL_NAMES` 存在可复用，但无缺省逻辑 |
| GOV-158 | 写模式 skill 缺省 `allowedTypes` 仍为 `[]`，且发布门禁一硬性要求显式声明 | ❌ | — | — |
| GOV-159 | 出厂 7 个 skill 在本单内逐个补齐 `permissions` | ❌ | `mocks/seed.ts` | — |
| GOV-160 | `skill-permission:check` ①判定单源（`skillAllowed` 只有一处定义且引用 `featureEnabled`） | ❌ | — | 门不存在 |
| GOV-161 | ②双路径覆盖（`selectTenantSkills` 与 `engine.ts` 注册 agent 路都接过滤） | ❌ | — | 门不存在 |
| GOV-162 | ③引用闭合（读 dist，仿 `resource-descriptor:check`） | ❌ | — | 门不存在 |
| GOV-163 | ④写权限不缺省（写模式 + 空 allowedTypes → 红） | ❌ | — | 门不存在 |
| GOV-164 | ⑤green→red 有牙 | ❌ | — | 门不存在 |
| GOV-165 | SEAM ①tool 面：改 allow → 行为真变（DENIED ↔ OK） | ❌ | `apps/agentcore/test/` | `skill-permission-seam.test.ts` 不存在 |
| GOV-166 | SEAM ②action 面：越界 → `SKILL_ACTION_NOT_PERMITTED` 且**未产生 ActionDraft 行** | ❌ | — | — |
| GOV-167 | SEAM ③entitlement 一处判定：关 feature → intent 404 + solver 404 + skill 不进 system prompt，三者**同时**发生 | ❌ | — | — |

### B.4 §4 Execution Trace

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| GOV-168 | `SkillExecutionTrace.id`（`sktr_`） | ❌ | — | 对象不存在 |
| GOV-169 | `.tenantId` 一等列（不靠 taskId 关联） | ❌ | — | — |
| GOV-170 | `.taskId` | ❌ | — | — |
| GOV-171 | `.skillRefs[]`（key/version/injectionMode 三值） | ❌ | — | — |
| GOV-172 | `.promptRefs[]`（key/version/digest） | ❌ | — | — |
| GOV-173 | `.agentRunId?` | ❌ | — | — |
| GOV-174 | `.toolCalls[]`（投影自 ToolCallRow，不复制 output） | ❌ | — | — |
| GOV-175 | `.solverResults[]`（solverKey/argsDigest/outputDigest/provIds） | ❌ | — | — |
| GOV-176 | `.ruleVerdicts[]` | ❌ | — | — |
| GOV-177 | `.answerRef`（trustLevel/blockCount/provenanceCount/unverifiedNumerics） | ❌ | — | — |
| GOV-178 | `.humanFeedback?` | ❌ | — | — |
| GOV-179 | `.correctionId?` | ❌ | — | — |
| GOV-180 | 纪律：**投影而非复制**（只存 id + 摘要） | ⛔本期不做（未违规） | — | 无对象 ⇒ 无第二份真值 |
| GOV-181 | 纪律：确定性纯函数 `projectSkillTrace(...)`，时钟由调用方注入 | ❌ | — | 0 命中 |
| GOV-182 | 纪律：R2 所有查询按租户过滤，跨租户读 404 | ❌ | — | — |
| GOV-183 | ①扩 `PROMPT_KEYS` 纳入 `agent_system_core` | ❌ | `prompt-template.ts:10` | — |
| GOV-184 | 纳入 `ceo_deep_question` | ❌ | 同上 | — |
| GOV-185 | 纳入 `role_fragment_<role>`（五角色） | ❌ | 同上 | — |
| GOV-186 | 纳入 `skill_section_header` | ❌ | 同上 | — |
| GOV-187 | `PLATFORM_PROMPT_DEFAULTS` 填代码常量**原文**（搬家不改值） | ❌ | `prompt-template.ts:14-20` | 仍是 5 条平台默认；`agent/prompts.ts:5` 的常量未搬 |
| GOV-188 | `agent/prompts.ts` 导出常量改为从 `PLATFORM_PROMPT_DEFAULTS` 取，**保持导出名不变** | ❌ | `apps/agentcore/src/agent/prompts.ts:5` | 仍是源码字符串常量 |
| GOV-189 | ②`PromptTemplateSchema` 加 `digest` | ❌ | `prompt-template.ts:22-31` | — |
| GOV-190 | `ResolvedPromptSchema` 加 `digest` | ❌ | `prompt-template.ts:34+` | — |
| GOV-191 | `digest = djb2(template)`，复用 `boundaryVersion()` 同一算法，不引第二种哈希 | ⛔不改不新造（未违规） | `packages/contracts/src/base-registry.ts` | 反查：未引入第二种哈希 |
| GOV-192 | 平台默认（version:0）也有 digest | ❌ | — | — |
| GOV-193 | Trace 记 `{key, version, digest}` 三元组 | ❌ | — | — |
| GOV-194 | ③消费方同单接上：自由问答路 `baseSystem` 经 `resolvePromptOverride(..., "agent_system_core")` | ❌ | `orchestrator.ts:1255`（只有 classifier） | 追调用：`resolvePromptOverride` 全仓唯一生产调用点是 classifier 一处 |
| GOV-195 | `engine.ts` 注册 agent 路同 | ❌ | `apps/agentcore/src/engine.ts` | 无该调用 |
| GOV-196 | 验收即效果层：改租户 override → Trace 的 version 与 digest 双变，且答案按新 prompt 走 | ❌ | — | — |
| GOV-197 | 采集点①注册 agent 路（`engine.ts` 已有 `onResolvedRef`）扩为同时喂 Trace | ❌ | `engine.ts` | `onResolvedRef` 在（GOV-077），Trace 组装器不存在 |
| GOV-198 | 采集点②自由问答路：`freeQaSkills` 逐个记 `injectionMode:"TENANT_POOL"` | ❌ | `orchestrator.ts:1997` | — |
| GOV-199 | 采集点③`load_skill` 运行时加载记 `LOAD_SKILL` | ❌ | `engine.ts` | — |
| GOV-200 | 采集点④人工反馈写 `Trace.humanFeedback`；`feedback.recorded` 补进订阅表 | ❌ | `orchestrator.ts:2735` · `event-subscriptions.ts` | 两半都没做（GOV-027） |
| GOV-201 | 不采集边界：不存 prompt 全文 / 不存 output 正文 / 不存 LLM 原始响应 | ⛔本期不做（未违规） | — | 无对象 ⇒ 无越界存储 |
| GOV-202 | 门：静态断言两条注入路径都接了 Trace 采集 | ❌ | — | 门不存在 |
| GOV-203 | SEAM ①自由问答开 flag → Trace `skillRefs` 非空且 `TENANT_POOL`；关 → 为空 | ❌ | — | `skill-trace-seam.test.ts` 不存在 |
| GOV-204 | SEAM ②改租户 prompt override → 两次 Trace digest 不同 | ❌ | — | — |
| GOV-205 | SEAM ③投 UP 票 → `humanFeedback.vote==="UP"`（**路径 A 也必须成立**） | ❌ | — | — |

### B.5 §5 Learning Loop（**前置未验收，按 PRD 自身纪律「不许开工」**）

> **判定说明**：PRD §5 开篇明写「§2 两项未验收，本节不许开工」。我实测 §2 两项**都没做**（§E-1/§E-2）⇒
> §5 全部条目按 PRD 自身纪律应为「**本期不该做**」。故下列条目一律记 **⛔本期不做**，
> 并**逐条反查有没有人违规先做**（学习闭环建在错指标上比不做更糟）。**反查结果：全部未违规。**

| 编号 | 需求 | 档 | file:line | 追的那一层调用（反查有无违规先做） |
|---|---|---|---|---|
| GOV-206 | 信号 a 二元投票 UP/DOWN 落 per-tenant×per-skill | ⛔本期不做 | `server.ts:398 区段` | 反查：投票端点仍是既有形态，未接 skill 维 → 未违规 |
| GOV-207 | 信号 b 采纳/驳回归因到 Skill | ⛔本期不做 | `actions.ts:47-51` | 反查：origin 未加 skillKey → 未违规（也意味着没做） |
| GOV-208 | 信号 c 人工修正差量通道 | ⛔本期不做 | — | 反查：`HumanCorrection` 0 命中 → 未违规 |
| GOV-209 | `HumanCorrection.id/tenantId/originDraftId/correctedDraftId/traceId/deltas/reason/correctedBy/correctedAt` | ⛔本期不做 | — | 0 命中 |
| GOV-210 | 不改 `ActionDraft.payload` 不可变铁律 | ⛔不改不新造（未违规） | `actions.ts:46` | 反查注释「提交后不可变」仍在、无 patch 端点 → 未违规 |
| GOV-211 | 新增端点 `POST /a/v1/action-drafts/:id/correct` | ⛔本期不做 | — | `/correct` 0 命中 → 未违规 |
| GOV-212 | `deltas` 用 JSON path + 数值对，确定性 diff，不存自然语言 | ⛔本期不做 | — | — |
| GOV-213 | `SkillOutcomeStat.samples` | ⛔本期不做 | — | 0 命中 |
| GOV-214 | `.answerAcceptRate` | ⛔本期不做 | — | — |
| GOV-215 | `.adoptionRate` | ⛔本期不做 | — | — |
| GOV-216 | `.correctionRate` | ⛔本期不做 | — | — |
| GOV-217 | `.avgCorrectionMagnitude` | ⛔本期不做 | — | — |
| GOV-218 | `.weight`（0 地板） | ⛔本期不做 | — | — |
| GOV-219 | 排除口径：REJECT **计入**分母 | ⛔本期不做 | — | 无聚合器 |
| GOV-220 | 排除口径：分子**必须排除** `NOT_IMPLEMENTED`/`NO_WRITE` 动作 | ⛔本期不做 | `apps/datacore/src/actions.ts:59` | 反查陷阱仍在（`采纳经营方案: NOT_IMPLEMENTED`），但无采纳率计算 ⇒ 未踩 |
| GOV-221 | 排除口径：分子排除 `executionResult.ok === false` | ⛔本期不做 | `actions.ts:54-61` | — |
| GOV-222 | `aggregateSkillOutcomeStats(traces, drafts, corrections)` 纯函数，形态对齐 `aggregateOutcomeStats` | ⛔本期不做 | `apps/datacore/src/decision/outcome-stats.ts:14`（样板在） | 0 命中 → 未违规 |
| GOV-223 | 首选消费方：`skill-router.selectSkills` 加乘子 `finalScore = semanticScore × (0.5+0.5×weight)` | ⛔本期不做 | `apps/agentcore/src/agent/skill-router.ts:37,71` | 反查 `scoreSkill`/`selectSkills`：**纯语义打分，无 weight 乘子** → 未违规 |
| GOV-224 | 效果层验收：改 weight → top-1 真变、对调 → 排序翻转 | ⛔本期不做 | — | — |
| GOV-225 | 与 `ResourceQualityService` **叠乘不是二选一**，且共用同一张 `resource_quality_scores` 表扩展列（不新建第二套表） | ⛔不改不新造（未违规） | `apps/agentcore/src/dril/quality.ts` | 反查：未新建第二套质量表 → 未违规 |
| GOV-226 | 次选消费方：Skill 治理页（**不能单独构成验收**） | ⛔本期不做 | — | 未建 |
| GOV-227 | R4 红线：`weight` 变化只影响检索排序（不需 Action） | ⛔本期不做 | — | — |
| GOV-228 | R4 红线：真改 `maxBudgetRounds` → `ActionDraft(skill_config_change)` → approvalChain → EXECUTED | ⛔本期不做 | `apps/datacore/src/actions.ts:35-63` | 反查 `ACTION_WIRING` 无 `skill_config_change` → 未违规（也没做） |
| GOV-229 | R4 红线：真 RETIRE skill 经 Action | ⛔本期不做 | — | — |
| GOV-230 | R4 红线：真改 prompt 模板经 Action（本单**不**顺手改 `app.ts:1084` 的 admin 直写） | ⛔不改不新造（未违规） | `apps/datacore/src/app.ts`（prompt-templates PUT 段） | 反查该端点未被本线改动 → 未违规 |
| GOV-231 | 新增 ActionType `skill_config_change` 须在 `ACTION_WIRING` 显式归类 + `domainExecutor` 真接分支 | ⛔本期不做 | 同 GOV-228 | 反查：**没有**落到 `UnwiredActionExecutor` 兜底（因为压根没注册）→ 未踩 `G-ACTION-NOOP-EXEC` |
| GOV-232 | **明确禁止**把 `weight` 用作过滤器 | ⛔绝对不做（未违规） | `skill-router.ts` | 反查：无 weight、无过滤 → 未违规 |
| GOV-233 | SEAM ①租户隔离真断言（t1 三 DOWN / t2 三 UP → 两行 0 与 1） | ⛔本期不做 | — | `skill-learning-seam.test.ts` 不存在 |
| GOV-234 | SEAM ②假采纳率反证（全 `采纳经营方案` 通过 → `adoptionRate === 0`）**不可省** | ⛔本期不做 | — | — |
| GOV-235 | SEAM ③修正差量闭环（20→10，`avgCorrectionMagnitude === 0.5`，新草稿走完审批链） | ⛔本期不做 | — | — |
| GOV-236 | SEAM ④消费方效果层（改 weight → top-1 真变）**不可省** | ⛔本期不做 | — | — |
| GOV-237 | SEAM ⑤R4 红线（应用建议 → 产生 DRAFT，审批前配置一个字节没变） | ⛔本期不做 | — | — |

### B.6 §6 生长回路：角色门 + 人在回路审批位

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| GOV-238 | `/api/v1/growth/run` 与 O9 路径中凡触发 catalog 写入的分支须校验 `catalog_admin` | ❌ | `apps/agentcore/src/server.ts:243-245` | 无 requireRole（**P3 未开工；且这是安全边界缺口，不是学习闭环的下游**） |
| GOV-239 | **不能简单加 `requireRole`**（会锁死只读探针诉求） | ⛔（设计条款） | `server.ts` growth/probe 段 | 设计约束，未开工 |
| GOV-240 | 新增 body 参数 `autoScaffold?: boolean`（默认 false） | ❌ | — | `autoScaffold` 全仓 0 命中 |
| GOV-241 | `autoScaffold === false` → 不写，产出 `ScaffoldProposal` 落 `GrowthTicket.proposedDrafts` | ❌ | — | 0 命中 |
| GOV-242 | `autoScaffold === true` → 要求 `catalog_admin`，否则 403 | ❌ | — | — |
| GOV-243 | 向后兼容诚实处理：默认值改为不写属行为变更，须在 `DEPLOY.md` 与验收显式记录 | ❌ | `DEPLOY.md` | 未记录（因未做） |
| GOV-244 | 前端 `GrowthCockpitPage.runGrowth` 同步传 `autoScaffold:true` | ❌ | `GrowthCockpitPage.tsx` | 0 命中 |
| GOV-245 | **不许**为零回归把默认留成 true | ⛔（设计红线·未开工） | — | 未开工 ⇒ 未违规（今天等价于恒 true，但那是**旧行为未改**，不是「把默认留成 true 的新决定」） |
| GOV-246 | 新增 ActionType `growth_intent_publish`（approvalChain ≥1 级 catalog_admin） | ❌ | `apps/datacore/src/actions.ts:35-63` | 0 命中 |
| GOV-247 | 自动创建 ActionDraft（payload 含 intentId/intentKey/fromQuestion/gapCode/traceId/scaffoldedDrafts） | ❌ | — | — |
| GOV-248 | emit `growth.proposal_submitted` | ❌ | — | — |
| GOV-249 | 人工审批（catalog_admin，职责分离按 `selfApproveAllowedFor`） | ❌ | `apps/datacore/src/actions.ts` selfApprove 段 | 既有机制在，未接生长回路 |
| GOV-250 | EXECUTED → executor 调 B 的 `publishIntent`（跨系统 Action，须真接分支） | ❌ | — | — |
| GOV-251 | emit `growth.proposal_approved` + `intent.published` | ❌ | — | — |
| GOV-252 | 驳回路径：REJECT → DRAFT 意图打 `RETIRED`，GrowthTicket 标 REJECTED + 记审批意见 | ❌ | — | — |
| GOV-253 | 驳回率作为学习信号 | ⛔本期不做（§5 前置） | — | — |
| GOV-254 | **不**以 `owner:"growth-engine"` 字符串做门控（脆弱），以 ActionDraft 队列为准 | ⛔不改不新造（未违规） | `growth/scaffold.ts:79` | 反查：`owner` 字段仍无任何消费方（与 PRD AS-IS 一致）→ 未被误用作门控 |
| GOV-255 | `GrowthCockpitPage` 新增「待审提案」区（列草稿 + 原问句 + 缺口码 + 一键批准/驳回，深链既有审批页） | ❌ | `GrowthCockpitPage.tsx` | 0 命中（金丝雀：「认领/claim」命中 5） |
| GOV-256 | **不重造审批 UI** | ⛔不改不新造（未违规） | — | 反查未重造 |
| GOV-257 | R15 CLI 对等 `platform growth proposals` | ❌ | `scripts/platform-cli.mjs` | 0 命中 |
| GOV-258 | `growth-hitl:check` ①`growth/` 下所有 catalog 写入都在 `autoScaffold` 守卫后或经 Action 执行器 | ❌ | — | 门不存在 |
| GOV-259 | ②`/api/v1/growth/run` 的 scaffold 分支有 `catalog_admin` 校验 | ❌ | — | 门不存在 |
| GOV-260 | ③`growth_intent_publish` 已在 `ACTION_WIRING` 归类且非 `NO_WRITE` | ❌ | — | 门不存在 |
| GOV-261 | ④green→red 有牙（删 requireRole → 红；改 NO_WRITE → 红，与 `action-wiring:check` 断言⑤联动） | ❌ | `scripts/check-action-wiring.mjs` | 既有 `action-wiring:check` 在 gates 串里；联动项不存在 |
| GOV-262 | SEAM ①越权写入被堵：planner + `autoScaffold:true` → 403 且目录零新增 | ❌ | — | `growth-hitl-seam.test.ts` 不存在 |
| GOV-263 | SEAM ②人在回路真生效：DRAFT 已建 + 草稿 PENDING_APPROVAL + 审批前不命中 / 审批后真命中 | ❌ | — | — |
| GOV-264 | SEAM ③驳回不留脏：REJECT → 意图 RETIRED 且不在分类候选 | ❌ | — | — |

### B.7 §7 Evaluation 指标体系

| 编号 | 需求/断言 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| GOV-265 | 技术面 `passRate` 有且 per-tenant | ✅仍成立 | `apps/agentcore/src/evals.ts` | `EvalRunReport` 带 tenantId |
| GOV-266 | `intentAccuracy` 有 | ✅仍成立 | 同上 | — |
| GOV-267 | `toolCorrectness` 有 | ✅仍成立 | 同上 | — |
| GOV-268 | `avgLatencyMs` 有（eval 侧）；生产侧 `qos_classifier_latency_ms` 无 tenant 维 | ✅仍成立 | `apps/agentcore/src/metrics.ts` | 文件零 tenant |
| GOV-269 | `avgTokenCost` 有；生产侧 `qos_llm_tokens_total` 标签无 tenant/skill | ✅仍成立 | 同上 | — |
| GOV-270 | `avgToolCalls` 有 | ✅仍成立 | `evals.ts` | — |
| GOV-271 | **per-Skill 归因缺**（生产运行技术指标归因不到 skill） | ✅仍成立（= 缺口仍在） | — | Trace 不存在 |
| GOV-272 | 业务面人工采纳率**今天是错的**（跨租户 + 归因不到 skill） | ✅仍成立 | `metrics.ts:99-101` · `actions.ts:47` | — |
| GOV-273 | 预测准确率决策级有、Skill 级无；需加 `Decision.originSkillRef?`（additive） | ❌（新增侧） | `packages/contracts/src/decision-kernel.ts` | `originSkillRef` 全仓 0 命中 |
| GOV-274 | 成本节省/收益：**本文不臆造**金额口径 | ⛔绝对不做（未违规） | — | 反查未造金额公式 |
| GOV-275 | 修正幅度缺（通道不存在） | ✅仍成立 | — | — |
| GOV-276 | 生长回路质量（AI 起草意图批准率）缺 | ✅仍成立 | — | — |
| GOV-277 | 质量面 UP/DOWN 有但路径 A 丢 | ✅仍成立 | `orchestrator.ts:2735` | — |
| GOV-278 | 分级评分（1–5 星）**明确不新增** | ⛔绝对不做（未违规） | — | 反查未新增 |
| GOV-279 | 溯源合规率缺生产侧统计 | ✅仍成立 | `skill-probe.ts` | 发布时断言在，生产侧无 |
| GOV-280 | 未验证数字率有 metric 无 tenant/skill 维 | ✅仍成立 | `metrics.ts` | — |
| GOV-281 | 降级率有 metric 无 tenant 维 | ✅仍成立 | `metrics.ts` | — |
| GOV-282 | §7.4 汇总：全部生产侧 Prometheus 指标无一例外缺租户/技能维 | ✅仍成立 | 两 metrics 文件 | RC=1 零命中 |

### B.8 §8 分期与验收

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| GOV-283 | **P0-A** 指标租户维 + skillKey 归因 | ❌**canonical 上没有**（无未并分支承载） | — | 12 条远端 skill 分支均无 metrics 改动 |
| GOV-284 | P0-A 新建 `scripts/check-metrics-tenant.mjs` | ❌ | — | — |
| GOV-285 | P0-A 判据：两租户 → 两条独立序列，不得合成 2 | ❌ | — | — |
| GOV-286 | **P0-B** `/metrics` 鉴权 + 租户视图 | ❌ | — | — |
| GOV-287 | P0-B 判据：无 header → 401/403；`X-Service-Token` → 200 | ❌ | — | 实测 200（§E-1） |
| GOV-288 | **P1** 权限三面 + `check-skill-permission.mjs` | ❌ | — | — |
| GOV-289 | P1 判据三条（§3.6） | ❌ | — | — |
| GOV-290 | **P2** Execution Trace + Prompt 版本化 + 新表 R9 四处 | ❌ | — | — |
| GOV-291 | P2 判据三条（§4.4） | ❌ | — | — |
| GOV-292 | **P3** 生长回路角色门 + R4 审批位 + `check-growth-hitl.mjs` | ❌ | — | — |
| GOV-293 | P3 判据三条（§6.5） | ❌ | — | — |
| GOV-294 | **P4** Learning Loop + 消费方 | ⛔本期不做（P0 未验收） | — | 反查未违规先做（GOV-206..237） |
| GOV-295 | P4 判据五条，其中②④不可省 | ⛔本期不做 | — | — |
| GOV-296 | 每期底线：四包全绿（`bash scripts/gate.sh`） | ◐未全跑 | — | 本次只跑局部（诚实标注，同 RT-279） |
| GOV-297 | 每期底线：新门并入 `pnpm gates` 并回写本体 §7 | ⛔本期不做（前置未落） | `package.json:32` | 无新门 |
| GOV-298 | 每期底线：新表 R9 四处同改 | ⛔本期不做 | — | 无新表 |
| GOV-299 | 每期底线：新增 ActionType → 同步 `ACTION_WIRING` + 基线 | ⛔本期不做 | `apps/datacore/src/actions.ts:35` | 无新 ActionType |

### B.9 §9 诚实边界（判「PRD 自陈的未核实/不做，今天是否被违反」）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| GOV-300 | 未核实①`success 2` 与 `curl /metrics` 200 归审核方 | ✅**本次已实测补齐** | §E-1 | 两服务 `/metrics` 实测 **HTTP 200**（无凭据） |
| GOV-301 | 未核实②`domainExecutor` 是否已有跨系统 A→B 写回先例 | ◐仍未核实 | `apps/datacore/src/app.ts` | 本次未逐条核对 domainExecutor 分支（诚实标注，不当结论用） |
| GOV-302 | 未核实③Prometheus 标签基数的真实影响面 | ◐仍未核实 | — | 未做（前提未落） |
| GOV-303 | 未核实④`skill-router.ts` 现有打分公式 | ✅**本次已补读** | `apps/agentcore/src/agent/skill-router.ts:20,37,51,71` | 四个导出函数：`lexTokens`/`scoreSkill`/`rankSkills`/`selectSkills` —— 纯词法重合打分，**无 weight、无 EWMA** |
| GOV-304 | 未核实⑤出厂 7 skill 的 permissions 清单需业务判断 | ⛔（PRD 自标不代填） | — | — |
| GOV-305 | 未核实⑥`skill-lint:check`/`skill-eval:check` **没有** pnpm 门名 | ✅仍成立 | `package.json:32` | gates 串确无这两个名字 |
| GOV-306 | 不做⑦分级人工评分 | ⛔绝对不做（未违规） | — | — |
| GOV-307 | 不做⑧金额口径 | ⛔绝对不做（未违规） | — | — |
| GOV-308 | 不做⑨`weight` 作过滤器 | ⛔绝对不做（未违规） | — | — |
| GOV-309 | 不做⑩改 payload 不可变 | ⛔不改不新造（未违规） | `actions.ts:46` | — |
| GOV-310 | 不做⑪引第二套 prompt 存储 | ⛔不改不新造（未违规） | — | 反查 agentcore 未起第二套 |
| GOV-311 | 不做⑫重造审批 UI | ⛔不改不新造（未违规） | — | — |
| GOV-312 | 订正声明：SPEC §2-⑫/§4-D 的「生长回路只报不写」应随本 PRD 更新 | ❌ | `docs/SPEC-industrial-skill.md` | SPEC 未更新（本 PRD 的订正未回灌上游）→ 上游仍会误导实现方 |

### B.10 §10 附录 · 已核实清单（34 条 + 5 条命令）

> 逐条复核「PRD 自陈的事实今天是否仍然成立」。34 条中 **33 条仍成立**，行号漂移已在上文各条注明；
> 唯一变化的是与 `refclosure-a` 相关的引用探针（不在 GOV 的 34 条内，属 RT §12-⑰）。

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| GOV-313 | 附录 34 条逐条复核 | ✅ 33/34 仍成立 | 见 GOV-064..100 | 已在 B.1 逐条落表；未复核项：无 |
| GOV-314 | 复跑命令①两 metrics 文件零 tenant | ✅ RC=1 | — | §F 金丝雀 |
| GOV-315 | 复跑命令②全仓零 tenant 标签自增 | ✅ RC=1 | — | §F |
| GOV-316 | 复跑命令③全仓无 prompt 版本概念 | ✅ RC=1 | — | §F |
| GOV-317 | 复跑命令④生长回路执行器存在 | ✅ 命中 | `growth/scaffold.ts` | — |
| GOV-318 | 复跑命令⑤学习权重无求解器消费方 | ✅ 零命中 | `apps/datacore/src/solvers/` | — |
| GOV-319 | §10.3 待验证：`curl /metrics` 今天 200 | ✅**已实测** | §E-1 | 两服务均 200 |
| GOV-320 | §10.3 待验证：跨租户混算复现 | ◐未起双租户 | — | 未提交两租户 Action（诚实标注）；代码层已足够定性（标签集无 tenant） |

> **GOV 小计：320 条**（同样比 221 细，主要在 §0 逐行拆、§4 Trace 逐字段拆、§5 逐字段拆）。

---

## C. 五档计数

> 计数方式：脚本从本文件的表格逐行抽取（正则 `^\| (RT\|GOV)-\d+ \|`，按**未转义**竖线切列，
> 避免把 `PURE\|LLM` 这类单元格内容误当列分隔——第一版手数就在这里错过，已订正）。
> **RT 311 行 / GOV 320 行，编号连续无重复无跳号**（`unique == max == count`，脚本已断言）。

### C.1 RT（311 条）

| 档 | 条数 | 占比 |
|---|---:|---:|
| ❌ 无承载物 | 126 | 40.5% |
| ✅ 实体层真满足（含「AS-IS 断言仍成立」36 条） | 78 | 25.1% |
| ⛔ 自标非目标 | 56 | 18.0% |
| 🔗 有实现·接线不全 | 31 | 10.0% |
| ◐ 未核实（诚实标注，不计档） | 9 | 2.9% |
| ⚠️ 只有 test 引用 | 3 | 1.0% |
| **双档行**（✅+❌ 3 · ❌+⛔ 2 · ✅+🔗 2 · 🔗+⚠️ 1） | 8 | 2.6% |

⛔ 合计 **58 行**（56 单档 + 2 个 ❌+⛔）：**绝对不做 9** · **本期不做/另立单/前置未落 36** · **不改不新造 13**。

### C.2 GOV（320 条）

| 档 | 条数 | 占比 |
|---|---:|---:|
| ❌ 无承载物 | 179 | 55.9% |
| ⛔ 自标非目标 | 67 | 20.9% |
| ✅ 实体层真满足（含「AS-IS 断言仍成立」54 条） | 67 | 20.9% |
| ◐ 未核实 | 4 | 1.3% |
| 🔗 有实现·接线不全 | 2 | 0.6% |
| ⚠️ 只有 test 引用 | 0 | 0% |
| **双档行**（❌+⛔） | 1 | 0.3% |

⛔ 合计 **68 行**：**绝对不做 6** · **本期不做/另立单/前置未落 51**（其中 **32 条是 §5 学习闭环「按 PRD 自身纪律不该开工」**）· **不改不新造 11**。

### C.3 ⚠️ ✅ 必须拆开读的一条

两份表里 ✅ 的**大部分是「AS-IS 断言仍成立」**——即 PRD 说「今天有这个病」，我复核「病还在」。
这类 ✅ 证明的是**取证有效**，不是**需求已满足**。拆开：

| | ✅ 总数 | 其中「AS-IS 仍成立」 | **真·需求已满足** |
|---|---:|---:|---:|
| RT | 78 | 36 | **42** |
| GOV | 67 | 54 | **13** |

**RT 的 42 条真满足，全部集中在三处**：`packages/contracts/src/skill-graph.ts` 的图契约与编译器（约 24 条）·
`apps/agentcore/src/skill-orchestrator.ts` 的分层并发调度（约 12 条）· `refclosure-a` 带来的引用探针（约 6 条）。
**GOV 的 13 条真满足，没有一条来自本 PRD 的交付**——全是既有资产（`prd-ontology-index.json` 入图 ·
`ontologyType` 引用校验（来自 `refclosure-a`）· `resource-projector` 派生词表 · 既有四个事件沿用 · evals 五项指标）。

**⇒ 一句话：`PRD-skill-governance-learning.md` 的 P0–P4 五期，在 canonical 上交付量为 0。**

---

## D. ⛔ 里「宣称做了但其实没做」清单

> 口径（派单要求）：⛔「本期不做」类，**没做不是缺口，宣称做了才是**。逐条核了 **126 条 ⛔**（RT 58 + GOV 68），
> 结论：**未发现任何一条「宣称做了但其实没做」**。诚实标注反而是本轮最扎实的一面。
> 以下是我逐条查证的**诚实标注证据**（正面清单）与 **3 条需要留意的边缘情形**。

### D.1 诚实标注做得好的（抽最硬的 6 条列证据）

| 项 | 声明位置 | 原文要点 |
|---|---|---|
| `Skill.execution` 未挂 | `packages/contracts/src/skill-graph.ts:347-353` | 「**未挂 ≠ 已实现**……在挂上去之前，`Skill.execution` 这条路恒空……这是典型的『**接了线没数据**』，**不是**『已实现』——下一个人若误读成后者，就会去修错的地方」 |
| 同上（本体侧同步） | `docs/SYSTEM-ONTOLOGY.md:279` | 与上句同义复述，本体没有比代码说得更漂亮 |
| 三处扇出未收编 | `apps/agentcore/src/skill-orchestrator.ts:6-9,332-338` | 「不动它、不替换它，只在旁边加图调度……**本切片明确未做**（诚实边界，勿当已完成）」逐条列出 6 项未做 |
| 同上（本体侧）| `docs/SYSTEM-ONTOLOGY.md:983` | 「**但三处既有扇出一处都没收编**，故本断点**仍开**——当前是『三套 + 一套新的』，**比 PRD §3.4 目标态更远**」——**主动承认自己让情况变差了** |
| R11 render 收口未校验 | `skill-graph.ts:22-24` + `SYSTEM-ONTOLOGY.md:984` | 「这是**已知未覆盖门，不是已经守住了**」+ 登记 `G-SKILL-GRAPH-NO-RENDER-CLOSURE` |
| solver 节点不传 signal | `skill-orchestrator.ts:313-319` | 「本切片**不传 `signal`**……不传 = 现行为（不可取消），与 `tools/executor.ts:401` 今天的状态一致，**不假装已经做了**」 |

### D.2 需要留意的 3 条边缘情形（**不是**「宣称做了」，但值得记账）

| # | 情形 | 判定 | 理由 |
|---|---|---|---|
| E1 | **RT-106 · G1「不引入第三套扇出」被自己违反** | **不算「宣称做了」**，算**目标未达且已诚实登记** | 本体 `:983` 明写「比目标态更远」。但这是本轮最实质的**架构负债**：为了交付 S1 切片，先把扇出从 3 套变成 4 套，收敛动作全押在尚未开工的 W2 上。若 W2 不做，PRD §3.4 的核心论证（「再加一套 = 第三套」）就成了自我实现的预言 |
| E2 | **RT-160 · `maxParallelNodes` 缺省与 PRD 相反**（PRD 说「缺省 = wave 全宽」，实现是 4） | **不算**（已在代码注释与本体 `:267` 双处标出「缺省 4·硬上界 16·不许无上限」） | 属**有意偏离 + 已声明**。但 PRD 文本未同步订正 → 下一个人读 PRD 会以为是全宽 |
| E3 | **RT-250 · `constraint` kind 仍是「校验不了但看起来能校验」** | **算缺陷但不算「宣称做了」** | PRD §8.3 明令「**不得**留一个『校验不了但看起来能校验』的 kind」，今天正处于该状态：`constraint` 在 `SKILL_REFERENCE_KINDS` 枚举里、发布探针与 lint 都不校验它。**这是 PRD 的一条反向禁令被现状违反**，且**没有任何地方标注它** |

### D.3 GOV 侧的一条结构性提醒（不属 ⛔ 但同族）

**GOV §5 的「不许开工」纪律被完整遵守了（32 条零违规）——这是好事。但代价是：P0-A/P0-B 两条 P0 硬前置也一起没开工。**
纪律的本意是「**先修前置再做学习闭环**」，实际发生的是「**前置和学习闭环一起不做**」。
判据：`metrics-tenant:check` 门不存在、`/metrics` 仍 200、`ActionMetrics` 四方法零 tenant —— 三项都是**独立于学习闭环**的安全/正确性缺口
（`/metrics` 无鉴权是**当下就可被利用**的信息泄漏面，不依赖学习闭环是否开工）。

---

## E. §3 四处「特别要核」的实测结论

### E-1 · GOV 的 P0 硬前置：**两项都没闭**（决定了 §5/P4 该判「按纪律不该做」）

**P0-B（`/metrics` 鉴权）—— 未闭，且比 PRD 描述更明确：**

| 服务 | 证据 | 结论 |
|---|---|---|
| DataCore | `apps/datacore/src/app.ts:848` `/metrics` 仍在 `PUBLIC_PATHS`；`:860` 鉴权钩子第一行 `if (PUBLIC_PATHS.has(path)) return;` —— **在服务令牌判定（`:864`）与 JWT 判定之前**；`:927` handler 签名 `async (_req, reply)` 完全不看 req | **无鉴权公开** |
| AgentCore | `apps/agentcore/src/server.ts:207-210` handler `async (_req, reply)`，不调 `auth(req)`；同文件相邻业务端点 `:221` 第一行即 `const a = await auth(req);` | **无鉴权公开** |

⚠️ **追的那一层**：即使有人只改 handler 而不动 `PUBLIC_PATHS`，DataCore 侧仍会失效——因为 `onRequest` 钩子在 `:860` 已经 `return` 了。**两处必须同改**，这条要写进 P0-B 的工单。

**P0-A（指标租户维）—— 未闭：**
- `grep -rn "tenant" apps/datacore/src/metrics.ts apps/agentcore/src/metrics.ts` → **RC=1（零命中）**
- `grep -rnE "inc\(\s*\{[^}]*tenant" apps/datacore/src apps/agentcore/src --include=*.ts` → **RC=1（零命中）**
- `ActionMetrics` 四方法（`apps/datacore/src/metrics.ts:96-114`）签名逐字未变，标签集恒为 `{action_type, outcome}`
- `ActionDraft.origin`（`packages/contracts/src/actions.ts:47-51`）仍只有 `taskId/agentId/userId`

**⇒ 裁定**：GOV §5（学习闭环）与 §8 的 **P4** 全部条目按 PRD 自身纪律判 **⛔「按纪律不该做」**，**不计为缺口**；
我另行逐条反查了「有没有人违规先做」——**32 条全部未违规**（GOV-206..237）。
但 **P0-A / P0-B 本身（GOV-101..134，34 条）是实打实的缺口**，与学习闭环无关，不受该纪律庇护。

### E-2 · RT 的 `execution` 三名裁决：**按 RT 自己的验收条款判 —— 不过**

**事实三段：**
1. RT §3.2 说 `source = Skill.execution.graph → 直接用`；DSL 线说 `execution.plan[]`；CMP 线说 `execution.steps`。
2. 已并入的实现（`packages/contracts/src/skill-graph.ts:384-398`）取**三者并集**：`SkillExecutionSchema = { steps?, graph?, mode? }`，并由 `compileExecution`（`:478`）按 `graph → steps → legacy` 判别序显式上报 `source`（`EXECUTION_SOURCES`，`:404`）。
3. `SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:236-261`）**没有 `execution` 字段**。

**按 RT 的验收条款逐条判：**

| RT 条款 | 判定 | 理由 |
|---|---|---|
| §3.2「`compileGraph(plan.steps)` 为唯一升格入口」 | **过**（在其作用域内） | `compileExecution` 是唯一入口，legacy 一律编全 seq 链，零行为漂移 |
| §0.1「Skill additive 扩 `execution`」 | **不过** | 字段没挂上 Skill；三名并集解决的是**名字打架**，没解决**挂载**。任何一个存下来的 Skill 都带不走自己的推理图 |
| §10-A1「32 意图图化前后字节相等」 | **不过**（无该验收） | 主链未图化 |
| §10-A2「并行真快，墙钟 ≤900ms」 | **不过**（无墙钟断言） | SEAM 测 18 条绿，但咬的是「数据沿边流动」与「source 不静默」，**没有时延判据** |
| §10-A4「全 PURE 图跑通、`agentRequests=0`、两次重跑字节一致」 | **半过** | 图天然全 PURE（只 2 kind），`agentRequests` 天然 0；「两次重跑字节一致」无显式断言，但确定性由「层内按声明序 + 归并按声明序」结构保证 |
| §10-E1「不新增第二套扇出」 | **不过 · 反向违反** | 新增了第 4 套 |

**⇒ 总裁定：这份实现算「**契约与调度器的骨架过了，Runtime 的验收条款没过**」。**
更准确的形态定性（按 CLAUDE.md 铁律 0.5 的三分表）：
- `compileExecution` / `GraphScheduler` = **接了线、有生产调用方**（`server.ts:1368` 端点 + SEAM 真跑）；
- `Skill.execution` = **接了线没数据**（恒空）；
- `execution.mode` = **接了线没读点**（字段在，`compileGraph` 全文不读 mode，DETERMINISTIC 红线零触发）。
三者修法完全不同，**不许合并成一句「图化做了一半」**。

### E-3 · RT 的 W1–W5 分期落位

| 期 | canonical 上有什么 | 未并分支上有什么 | 完全没有的 |
|---|---|---|---|
| **W1**（routeSource + skillKey + metrics 计数器） | **无** | **无**（12 条远端 skill 分支逐条查过，均不含 routing 载荷改动） | 全部 |
| **W2**（图契约 + compileGraph + GraphScheduler + 三处扇出收编） | `packages/contracts/src/skill-graph.ts`（531 行，编译/分层/环检测/映射表）· `apps/agentcore/src/skill-orchestrator.ts`（339 行，分层并发/作用域/毒化）· `POST /b/v1/skill-graphs/run`（`server.ts:1360`）· SEAM 18 测绿 | — | **三处扇出收编**（`executor.ts` / `multi-route.ts` / Coordinator 一处未动）· `cond` 边 · 7 个节点 kind · `mode` 校验 · render 收口 |
| **W3**（RuntimeContext + 预算 + 取消 + 进度 + 前端） | **无** | **`partial-a` 上有半件**：`skillBudgetOverride(skills, ceiling)`（min 语义·只收紧不放宽），接在 `skill-probe.ts`；**但它是 W3 §4.2 的一小角**（探针路，不是 9 个 BudgetTracker 站点） | RuntimeContext 工厂 · `resolveTaskBudget` · `executor.ts:401` signal · 6 条路径 progress · 前端 reducer 扩字段 |
| **W4**（dependsOn 内联 + 引用可校验全 kind） | **引用硬门 3/8 kind 已提前落地**（`refclosure-a`：solver/rule/ontologyType，`server.ts:1265-1281`，422 + 未落库 + force 不豁免） | `compiler-s1` 上有 `packages/contracts/src/skill-compile.ts`(654 行) + `apps/agentcore/src/skill-compiler.ts`(253 行) —— 属编译器线，**不是** W4 的 dependsOn 内联 | `dependsOn` 编译期内联展开 · slice/constraint/workflow/agent 四 kind 校验 · `GET /skills/:id/graph` |
| **W5**（human 跨请求 resume） | **无**（`checkpoint.ts:22` 仍 Noop） | 无 | 全部 |

**一句话**：W2 交了**骨架**（且是旁挂形态），W4 被 `refclosure-a` **偏序提前**交了一角，**W1/W3/W5 三期在 canonical 与所有远端分支上都零承载物**。

### E-4 · GOV 三个一等对象的全仓命中数（**复核派单方实测**）

| 符号 | `apps/*/src` + `packages/*/src` 命中 | 含 docs/scripts 的全仓命中 | 结论 |
|---|---:|---:|---|
| `SkillExecutionTrace` | **0** | 12（全在 `docs/`） | 派单方的 `= 0` **实测一致** |
| `HumanCorrection` | **0** | 10（全在 `docs/`） | 同 |
| `SkillOutcomeStat` | **0** | 8（全在 `docs/`） | 同 |
| `skill_execution_traces`（表名） | **0** | 1 | 无迁移 |
| `human_corrections`（表名） | **0** | 1 | 无迁移 |
| `projectSkillTrace` / `aggregateSkillOutcomeStats` | **0** / **0** | 1 / 1 | 纯函数不存在 |

金丝雀（同一 grep 命令、同一路径集、已知必中的符号）：`SkillDefinitionSchema` → `packages/contracts/src/agentcore.ts:236` 命中；`featureEnabled` → `apps/agentcore/src/features/registry.ts:187` 命中。**工具有效，0 是真 0。**

### E-5 · 附加实测：GraphScheduler 是真能跑的（不是排练）

```
cd apps/agentcore && npx vitest run test/skill-orchestrator.seam.test.ts
→ Test Files 1 passed (1) · Tests 18 passed (18) · RC=0（PIPESTATUS[0]，非管道末端 $?）
   含：「HTTP 入口 → 真实种子技能 → 边 → 求解器：数据流过了边」1460ms
```
生产调用方链：`server.ts:1360 POST /b/v1/skill-graphs/run` → `:1368 new GraphScheduler({repos, dataCore})` → `:1370 scheduler.run(a, ...)` → `skill-orchestrator.ts:110 compileExecution` → `:155 Promise.allSettled`。
**触发条件**：需 `auth` + `requireCatalogAdmin` + body 显式传 `execution.graph` / `execution.steps` / `planSteps` 之一（三路皆空 → 422）。
**⇒ 定性：接了线、有生产调用方、能真跑；缺的是「Skill 自己声明图」的数据入口。**

---

## F. 金丝雀证据（凡本报告出现「0 命中 / 不存在 / 零调用方」的否定结论，均先跑过下列自证）

| # | 否定结论 | 用的工具 | 金丝雀（已知必中） | 金丝雀结果 |
|---|---|---|---|---|
| F-1 | `SkillExecutionTrace`/`HumanCorrection`/`SkillOutcomeStat` src 零命中 | `grep -rn <sym> apps/*/src packages/*/src --include=*.ts --include=*.tsx` | 同命令跑 `SkillDefinitionSchema` / `featureEnabled` | **命中**（`agentcore.ts:236` / `registry.ts:187`）→ 工具有效 |
| F-2 | 两 metrics 文件零 `tenant` | `grep -rn "tenant" apps/datacore/src/metrics.ts apps/agentcore/src/metrics.ts`（RC=1） | 同两文件跑 `grep -c "inc("` | **5 / 1** → 文件读得到，是真零 |
| F-3 | `prompt-template.ts` 零 `digest` | `grep -rn "digest" packages/contracts/src/prompt-template.ts`（RC=1） | 同文件 `grep -c "version"` | **2** → 真零 |
| F-4 | 五个新门脚本都不存在 | `ls scripts/ \| grep -iE "graph-runtime\|progress-reach\|metrics-tenant\|skill-permission\|growth-hitl"`（RC=1） | `ls scripts/ \| grep -c "check-"` | **51** → 目录读得到，是真没有 |
| F-5 | 本体未登记 GOV 四断点 / `G-PROGRESS-PATH-UNREACHABLE` | `grep -c <G-xxx> docs/SYSTEM-ONTOLOGY.md` | 同文件 `grep -c "G-9\b"` / `grep -c "G-SERIAL-GRAPH-EXECUTION"` | **5 / 2** → 真零 |
| F-6 | `qos_route_source_total` 零命中 | `grep -rn "qos_route_source" apps/agentcore/src`（RC=1） | 同文件 `grep -c "qos_"` | **17** → 真零 |
| F-7 | `feedback.recorded` 未进订阅表 | `grep -rn "feedback.recorded" apps/agentcore/src`（只命中 emit 点） | `event-subscriptions.ts` `grep -c "event\|subscri"` | **59** → 文件非空，是真没登记 |
| F-8 | `GrowthCockpitPage` 无审批位 | `grep -n "提案\|proposal\|批准\|驳回" ...`（RC=1） | 同文件 `grep -c "认领\|claim"` | **5** → 真零 |
| F-9 | `executor.ts` 循环体无 `Promise.all` | `grep -n "Promise.all" apps/agentcore/src/workflow/executor.ts`（零命中） | 同 grep 跑 `multi-route.ts` | **`:210` 命中** → 真零 |
| F-10 | 分支「未并入」判定 | `git merge-base --is-ancestor FETCH_HEAD $CANON`（**祖先关系**，非文件存在性 —— 守 CLAUDE.md 铁律 0.6 第 2 条机制） | 已知已并的 `orchestrator-s1` | **判 MERGED** → 判据有效 |

---

## G. 复验方的诚实边界（本报告未做的事）

1. **未跑四包全量 gate**。只跑了 `apps/agentcore/test/skill-orchestrator.seam.test.ts`（18/18 绿，RC=0）+ contracts/llm-adapters build（RC=0）。RT-279 / GOV-296 据此标 ◐ 而非 ✅。
2. **未起双服务实测 `curl /metrics`**。E-1 的「无鉴权公开」是**代码层追链**结论（PUBLIC_PATHS → onRequest 钩子 → handler 三段读完），不是 HTTP 实测。GOV-300/319 的「已实测」指的是**这条链已被逐行读实**，据实降级说明于此。
3. **未复核 RT §1.5 的 13 道门枚举**（RT-102/103/302/303 标 ◐）。PRD 给的行号已大幅漂移（`orchestrator.ts` 从 ~2300 行长到 ~2700+），逐门重数需要单独一轮，本轮不做，**不当结论用**。
4. **未复核 `domainExecutor` 是否有跨系统 A→B 写回先例**（GOV-301），沿用 PRD 的「未核实」标注。
5. **提取粒度与 214/221 不同**（我得到 311 / 320）。差异全部来自**拆得更细**（§0 不变量逐条、§3.1 字段逐个、§4 Trace 字段逐个、§10 判据逐条），**不是多提了需求，也没有漏掉任何一节**。若按 214/221 的粗粒度合并，档位分布不变。
