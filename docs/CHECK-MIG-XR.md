# 逐条勾选 · `PRD-skill-migration.md`(545 行) + `PRD-skill-crossreview.md`(211 行)

> 2026-08-09 · 复验 agent · 基线 canonical `claude/inspiring-gates-aqczjg` @ `b50f42af`（工作区干净，`git status --porcelain` 为空）
>
> 派单口径：`CHECKLIST-skill-4209.md` 记 MIG **186** 条 / XR **43** 条 = 229 条，**必须逐条不许抽样**。
> **本单自己重做了提取**（未沿用前次条目文本），实得 **MIG 224 条 / XR 46 条 = 270 条**。
> 差异是**粒度差不是漏项**（详见 §4 的差异说明）：§0 的 12 条不变量、§7.1 的 10 个读取点、
> §13 的 13 条诚实边界我都拆成了独立可判真假的句子。**覆盖是全的**——
> 两份文档每一节、每一张表的每一行都进了下表，编号连续无缺号无重号（已用脚本机械校验）。

---

## 0. 判定口径（照派单四档 + ⛔ 三分）

| 档 | 含义 | 判据 |
|---|---|---|
| ✅ | **实体层真满足** | 承载物在**该在的对象上**，且追到了生产调用方与触发条件 |
| 🔗 | **有实现·接线不全** | 代码在、也被调用，但挂错位置 / 只覆盖部分路径 |
| ⚠️ | **只有 test 引用** | 实现有、测试绿，**零生产调用方**（已排练 ≠ 已实现） |
| ❌ | **无承载物** | 契约/代码里根本没有（**报 0 前先跑金丝雀**，证据见 §5） |
| ⛔ | **自标非目标** | 三分：**绝对不做** / **本期不做**（「宣称做了」才是缺口）/ **不改不新造**（做了反而是缺陷） |

**两条本单专用的补充口径（不写清会把判定搅浑）**

1. **MIG 自标「交付形态 = 零代码改动，实施由后续 WO 承接」**（`PRD-skill-migration.md:9`）。
   所以 §5–§8（M0–M3）的**实现类**条目一律是 **⛔ 本期不做**，「没做」不是缺口；
   我在「档」列写 `⛔本期/❌` 双标 —— 前者是 PRD 的自我定位，后者是**今日承载物实测**。
   **只有当别处（XR §9 收口表 / SPEC）宣称它做了，才升级为真缺口**，见 §4 清单。
2. **事实断言类**（§1 AS-IS、§7.1/§7.2 清单、§10 现状、§13）判的是**今天实测是否属实**：
   ✅ = 属实；❌ = **与实测不符**（这是文档的缺陷，不是代码的缺陷，我在证据列写明）。

---

## 1. `PRD-skill-migration.md` 逐条（SK-MIG-1 … 216 + 风险 R-A…R-H，共 224 条）

### 1.0 头表与前言（5）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-1 | 版本 v1.0（2026-08-03） | ✅ | `docs/PRD-skill-migration.md:4` | 文档元数据，无代码面 |
| SK-MIG-2 | 上游 = WO Track E（Skill 吞并 Plan 不并列）+ SPEC 12 层 | ✅ | 同上 :6 | `docs/WO-ROUTING-RETRIEVAL-FIRST.md` 与 `docs/SPEC-industrial-skill.md` 均在仓，SPEC §1 12 层原样在 |
| SK-MIG-3 | 解决问题 = 给出 32 Plan 升格进 Skill 的可执行迁移路线（分期/门/地基） | ✅ | 同上 :7 | 文档确实给了 M0–M3 + 7 门 + G1/G2/G3 |
| SK-MIG-4 | ⛔ 不解决：不定义 12 层形态 / 不做路由改造 / 不改执行语义 | ⛔不改不新造 | 同上 :8 | **反向断言**：查 `resolveSkillForIntent` = 0 命中、`executor.ts:104` 仍为 `for (const step of input.steps)` 串行 ⇒ 执行语义确实没被这批动过 ✅ |
| SK-MIG-5 | ⛔ 交付形态：**零代码改动**，实施由后续 WO 承接 | ⛔本期不做 · ✅属实 | 同上 :9 | `git log --stat` 该 PRD commit 只动 docs；且 M0–M3 承载物今日实测全 0（见下） |

### 1.1 §0 本体引用与影响（38）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-6 | `Intent` 的 `planId`/`planRef` 两个绑定字段在 M2 被 Skill 引用取代 | ⛔本期/❌ | `packages/contracts/src/qos.ts` `IntentDefinitionSchema` | 今日 `IntentDefinitionSchema` 零 skill 字段（实测 `PROBE_INTENT_SKILL_FIELD=0`，32 条意图无 `skillKey`/`skillRef`）；`planId` 仍是唯一绑定 |
| SK-MIG-7 | `ExecutionPlan` 从一等注册对象降为 `Skill.execution.plan` 字段 | ⛔本期/❌ | 同上 | `SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:236-261`）**无 `execution` 字段**；plans 仍是独立 repo（`repos.plans.insert` 4 处生产调用方） |
| SK-MIG-8 | `PlanStep` 判别联合**保留不动**（步骤语义是资产不是负债） | ⛔不改不新造 · ✅ | `packages/contracts/src/qos.ts` `PlanStepSchema` | 反向断言成立：判别联合仍在，`solverKeyForIntent`（`orchestrator.ts:1112-1118`）仍按 `step.type === "invoke_solver"` 判别 |
| SK-MIG-9 | `Skill` 新增 `execution` 字段组 | ⛔本期/❌ | `packages/contracts/src/agentcore.ts:236-261` | 18 个字段逐个列过，无 `execution`。**注意**：`SkillExecutionSchema` **确实存在**（`packages/contracts/src/skill-graph.ts:384`）但只挂在**路由请求体**上（`server.ts:1346`），实体带不走 ⇒ 形态④ |
| SK-MIG-10 | `Skill` 新增 `businessIntent` 字段组 | ⛔本期/❌ | 同上 | `businessIntent` 全仓 src 0 命中（金丝雀见 §5） |
| SK-MIG-11 | 触及 `ScenarioPackage`（Plan 的 packageId 归属）· `Scenario`（intentKey 指向） | ✅（事实属实） | `apps/agentcore/src/server.ts:2402` | `resolvePlanByRef(deps.repos, pkg.id, intent.planRef, …)` —— 解析确实经 package 维；场景卡 20 张实测 |
| SK-MIG-12 | `QueryTask.resolvedRefs` 的 kind 从 `plan` 变 `skill` | ⛔本期/❌ | `packages/contracts/src/refs.ts:9` | `RefKindSchema` 已含 `"skill"` 与 `"plan"` 两者（**契约不必改**，SK-MIG-112 复述这条）；但今天 resolvedRefs 里写的仍是 plan 侧 |
| SK-MIG-13 | `SkillResource`（DRIL 投影）的 `boundPlanRef` 随之改语义 | ⛔本期/❌ | `apps/agentcore/src/dril/resource-projector.ts:135` | `boundPlanRef: i.planRef ? \`${i.planRef.planKey}@${i.planRef.version}\` : i.planId` —— 字段名与语义都还是 plan；`boundSkillRef` 全仓 0 |
| SK-MIG-14 | 链路只改「意图→可执行步骤」这一跳的解析源（`resolvePlanForIntent`→`resolveSkillForIntent`） | ⛔本期/❌ | `apps/agentcore/src/catalog/service.ts:83` | `resolvePlanForIntent` 有 4 个生产调用方（orchestrator:1113/1678 · server:468/2261/2513）；`resolveSkillForIntent` **全仓 0 命中** |
| SK-MIG-15 | `proceedWithIntent`/`fillSlots` 与右侧步骤执行器**一行不动** | ⛔不改不新造 · ✅ | `apps/agentcore/src/workflow/executor.ts:104` | 反向断言成立：执行器仍是串行 for 循环，无改动痕迹 |
| SK-MIG-16 | **不新增事件名**；`routing.completed` 载荷不变；`step.started`/`step.completed` 不变 | ⛔不改不新造 · ✅ | `packages/contracts/src/qos.ts` 事件名表 | 反向断言成立：无 `skill.*` 新事件名（`skill.published` 见下条，是**既有**广播口） |
| SK-MIG-17 | M2 之后 `skill.published` 成为「答法变更」唯一广播口（今天是 plan publish + skill publish 两处） | ⛔本期/❌ | `apps/agentcore/src/server.ts:578` `publishPlan` | 今天仍两处：`deps.catalog.publishPlan(planId)`（:578）与 skill 发布路（:1272 区）各自广播 |
| SK-MIG-18 | R1：`execution`/`businessIntent` 一律在 `@platform/contracts` 定义，不新增跨包依赖 | ⛔本期/❌（字段未生） | `packages/contracts/src/agentcore.ts` | 无字段可判；但已存在的 `SkillExecutionSchema` **确实**落在 contracts（`skill-graph.ts:384`）⇒ 口径本身被遵守 |
| SK-MIG-19 | R2：Skill 是 tenant 级、Intent/Plan 是 package 级，键空间不同 | ✅（事实属实） | `packages/contracts/src/agentcore.ts:237-238` | `SkillDefinitionSchema` 有 `tenantId` 无 `packageId`；`resolvePlanByRef(repos, pkg.id, …)` 走 package 维 —— 两个键空间实测不同 |
| SK-MIG-20 | R3：翻转后必须**一处判定**（entitlement），配 `skill-entitlement-single:check` | ⛔本期/❌ | — | 门不存在（`scripts/` 下 `check-skill*` = 0 个）；今天仍两处判定（SK-MIG-147） |
| SK-MIG-21 | R4：Skill 的 `approvalGate`/`sideEffect` 不得绕过既有 Action 审批链 | ⛔本期（M3 才碰）· 现状 ✅ | `scripts/check-action-wiring.mjs`（在 gates 链） | `action-wiring:check` 仍是唯一判据且在 `pnpm gates` 第 14 位；`provenRed.kind=MUTATION`（四条变异反证已跑）⇒ 这道门有牙 |
| SK-MIG-22 | R6：`provId` 天然不稳定，需 §6.3 规范化器 + 三条自证 | ✅（机制属实）/ ❌（规范化器未建） | `apps/agentcore/src/ids.ts:20-23` | `ulid() = encodeTime(Date.now(),10) + randomPart(16)`，`randomPart` 用 `randomBytes` ⇒ 同 plan 两跑必不等，机制链属实；`canonicalizeAnswer` 全仓 0 命中 |
| SK-MIG-23 | R7：`PLAN_NOT_FOUND` → `SKILL_NOT_FOUND`（码变、信封形状不变） | ⛔本期/❌ | `apps/agentcore/src/router/orchestrator.ts:1681` | `this.failTask(taskId, "PLAN_NOT_FOUND", …)` 仍在；`SKILL_NOT_FOUND` 全仓 0 |
| SK-MIG-24 | R9：`plans` 表退役不可回退 → 翻转与删表**分离**，删表须带 down | ⛔本期 · 口径未被违反 | `apps/agentcore/migrations/` | 无删 plans 表的 migration ⇒ 口径未被违反（也未被执行） |
| SK-MIG-25 | R11：`scenarioClosure` 的「意图未绑定执行计划」判据要改成「未绑定 Skill」 | ⛔本期/❌ | `apps/agentcore/src/server.ts:2402` | 原文仍是 `issues.push(\`意图「…」未绑定执行计划\`)`，判据仍是 `resolvePlanByRef` |
| SK-MIG-26 | R13：provenance 是字节相等的比对对象之一 | ⛔本期/❌ | — | 无 parity 门可判；provenance 结构本身在（`executor.ts` 产 provId） |
| SK-MIG-27 | R15：Plan 的管理面若有 CLI 等价，须随之迁移或登记 GUI 深链，`cli-parity:check` 守 | ⛔本期 · 门在 | `scripts/check-cli-parity.mjs` | 门文件存在；门账 `binding` 非 GATES_CHAIN（`gate-ledger.json`），即**不在 `pnpm gates` 链内**，需手跑 |
| SK-MIG-28 | R16：生长回路 `growth/scaffold.ts` 今天 scaffold 的是 Plan，必须一起翻 | ✅（事实属实）/ ⛔本期未翻 | `apps/agentcore/src/growth/scaffold.ts:21,31` | `scaffoldDraftPlan` → `deps.catalog.createPlan(pkg.id, …)`；再追一层：`scaffoldDraftIntent`（:54）在 :68 调 `scaffoldDraftPlan` ⇒ **写链是活的**，不是死代码 |
| SK-MIG-29 | 新增 **7 道**门全部进 `pnpm gates` → 聚合 **16 → 23**（称当前 16 条，`package.json:29`） | ❌ **基数已过期** | `package.json` `scripts.gates` | **实测今日 `pnpm gates` = 26 道**（`&&` 分段现算），不是 16。7 道新门 0 道存在 ⇒ 目标数 23 亦作废，应重算为 26+7=33 |
| SK-MIG-30 | M0 门 `skill-export:check`：32/32 意图各有 Skill，用例集从注册表派生不手抄 | ⛔本期/❌ | — | `scripts/check-skill-export.mjs` 不存在（金丝雀见 §5） |
| SK-MIG-31 | M0 门 `skill-ref-closure:check`：每个 `references[]` 的 key 真已注册 | ✅ **已落地（改名 `ref-closure:check`）** | `scripts/check-ref-closure.mjs` · `package.json` 2 处（别名 + gates 链第 25 位） | 亲手跑 RC=0，原文「三条发布路均接探针 · 两层 fail-open 均关死 · skill 路拦在落库之前」；再追一层：`probeMissingRefs` 生产调用方 3 处（`server.ts:694` agent / `:1012` workflow / `:1272` skill） |
| SK-MIG-32 | M0 门 `skill-business-intent:check`：Business Intent TODO 数棘轮只降不升 | ⛔本期/❌ | — | 脚本不存在；`businessIntent` 字段本身也不存在 ⇒ 无可棘轮的量 |
| SK-MIG-33 | M1 门 `skill-plan-parity:check`（命门）：两条路真跑 + 执行源可判别 + 规范化后字节相等 | ⛔本期/❌ | — | `skill-plan-parity` 全仓 0；`apps/agentcore/test/` 下 10 个 skill*.test.ts 无 parity 测试 |
| SK-MIG-34 | M2 门 `skill-single-source:check`：无第三处真源、六写入方全收口 | ⛔本期/❌ | — | 脚本不存在；`repos.plans.insert(` 生产侧仍 4 处 |
| SK-MIG-35 | M2 门 `skill-entitlement-single:check`：entitlement 一处判定（含非 demo 租户用例） | ⛔本期/❌ | — | 脚本不存在 |
| SK-MIG-36 | M3 门 `skill-budget-effect:check`：改 `maxBudgetRounds` → 探索轮次**真变** | ⛔本期/❌ | — | 脚本不存在；且 `maxBudgetRounds` 生产消费方 0（SK-MIG-68） |
| SK-MIG-37 | 七道门**必须逐条回写本体 §7**，否则 `ontology-writeback:check` 红 | ⛔本期 · 前提未生 | `scripts/check-ontology-writeback.mjs` | 门文件在，但门账 `binding` 非 GATES_CHAIN；且七道门一道没建 ⇒ 无可回写 |
| SK-MIG-38 | 既有断点 `G-9`/`G-4`/`G-1` 的描述在翻转后**必须回写** | ⛔本期/❌ | `docs/SYSTEM-ONTOLOGY.md` | 未翻转，故未回写（口径未被违反）。`G-4` 在本体命中 2 次（金丝雀） |
| SK-MIG-39 | M0 立项时**新登记** `G-SKILL-PLAN-DUAL-AUTHORITY` 进本体 §8 | ❌ **无承载物** | `docs/SYSTEM-ONTOLOGY.md` | `grep -c` = **0**（金丝雀 `G-4` = 2 ⇒ 工具正常）。**M0 未立项 ⇒ 未登记**，但这条本身是「立项即写」的动作，不依赖代码 |
| SK-MIG-40 | M0 立项时**新登记** `G-SKILL-TENANT-SEED-ASYMMETRY` 进本体 §8 | ❌ **无承载物** | 同上 | `grep -c` = **0**。而它描述的**病本身今天实测仍在**：`seedRegistry(now)`（`apps/agentcore/src/mocks/seed.ts:909`）**无 tenantId 入参**，`main.ts:27` 只为 demo 播种，7 个 skill 实测 `tenantId` 全 = `demo` |
| SK-MIG-41 | CLI（R15）：`OPERATION_CATALOG` **17 条**、全文零处提及 plan ⇒ 不引入 CLI 洼地 | ❌ **两个数都过期** | `packages/contracts/src/operation-intent.ts` | 实测 `OPERATION_CATALOG.length` = **39**（不是 17）；且 `plan` 命中 **1 处**（不是 0）：`op:"build"` 的 description「以自然语言故事倒推全栈 **BuildPlan**」。**但结论不受影响**——那是 databuilder 的 BuildPlan，不是 ExecutionPlan，故「Plan 管理无 CLI 等价」仍成立 |
| SK-MIG-42 | M2 若给 Skill 侧新增管理入口，须同步登记 `cliCommand` 或 `uiDeepLink` | ⛔本期 · 前提未生 | `scripts/check-cli-parity.mjs` | 未新增入口 ⇒ 未触发 |
| SK-MIG-43 | 范畴：把「一个意图怎么答」的权威从 ExecutionPlan 迁到 Skill，零漂移 + 单一真源 | ⛔本期/❌ | — | 权威今天 100% 在 ExecutionPlan（32/32 绑定），Skill 侧 0 意图绑定 |

### 1.2 §1.1 AS-IS 基数与绑定（8）

> **全部亲手跑过**：在 `apps/agentcore/test/` 临时加一条探针测试跑 `seedIntentsAndPlans("demo")` + `seedRegistry()`，
> 取完数**已删除该文件**（`git status --porcelain` 空）。原始输出见 §6 实测台账。

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-44 | 意图目录 = **32** | ✅ | `apps/agentcore/src/mocks/seed.ts:210` `seedIntentsAndPlans` | 实测 `PROBE_INTENTS=32`（不是读文档）。构成实测：CEO 11 条 + SCENARIO_CATALOG 派生 20 条（含与显式重名者）+ 其余显式 |
| SK-MIG-45 | ExecutionPlan = **32** | ✅ | 同上 | 实测 `PROBE_PLANS=32`，与 intents 一一对应 |
| SK-MIG-46 | Skill = **7**（`capacity_analysis`/`sop_meeting`/`risk_analysis`/`supply_chain_mgmt`/`quality_control`/`mcp_integration`/`capacity_action_draft`） | ✅ | `apps/agentcore/src/mocks/seed.ts:909` `seedRegistry` | 实测 `PROBE_SKILLS=7`，7 个 key **逐字与文档相符** |
| SK-MIG-47 | 场景卡 = **20** | ✅ | `apps/agentcore/src/scenarios-catalog.ts` `SCENARIO_CATALOG` | 实测 `PROBE_SCENARIO_CATALOG=20` |
| SK-MIG-48 | 场景入口 = **9** | ✅ | `apps/agentcore/src/mocks/seed.ts` `seedSceneEntries` | 实测 `PROBE_SCENE_ENTRIES=9` |
| SK-MIG-49 | 场景卡 `intentKey` 缺意图 = **0** | ✅ | 同上 | 实测：20 个 catalog intentKey 全部命中 intents（`PROBE_CATALOG_DERIVED_INTENTS=20`） |
| SK-MIG-50 | 意图无 planId = **0** | ✅ | 同上 | 实测 `PROBE_INTENTS_NO_PLANID=0`（同时查 `planId` 与 `planRef`） |
| SK-MIG-51 | **意图 → Skill 的引用边不存在** | ✅ | `packages/contracts/src/qos.ts` `IntentDefinitionSchema` | 实测 `PROBE_INTENT_SKILL_FIELD=0` 且 `PROBE_SKILLKEY_EQ_INTENTKEY=0` —— 7 个 skill key 与 32 个 intent key **交集为空** |

### 1.3 §1.2 自动导出的机械来源（9）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-52 | `execution.plan[]` ← `ExecutionPlan.steps` 原样搬 · 覆盖 32/32 | ✅（来源属实）/ ⛔本期未导 | `apps/agentcore/src/mocks/seed.ts` plans 数组 | 实测 32 份 plan 全有 steps（69 个 step 实例） |
| SK-MIG-53 | `references[kind=solver]` ← plan 步里的 `invoke_solver.params.solverKey` · 32/32 | ✅（来源属实） | `apps/agentcore/src/router/orchestrator.ts:1115-1117` | 追一层：`solverKeyForIntent` 已经在**生产**里这么取（`if (step.type === "invoke_solver") return step.params.solverKey`）⇒ 这条来源不是纸上推演，已有活的读取方 |
| SK-MIG-54 | `references[kind=rule]` ← `SOLVER_RULE_REFS[solverKey]` ∪ `SCENARIO_CATALOG[].rules`（19 solver 覆盖，CEO 域为空） | ✅ | `packages/contracts/src/datacore.ts:127` | 实测 `Object.keys(SOLVER_RULE_REFS).length = 19`，与文档一致 |
| SK-MIG-55 | `references[kind=slice]` ← plan 步里的 `resolve_slice.params.sliceKey`（仅少数 plan 有） | ✅ | `apps/agentcore/src/mocks/seed.ts` | plan 步类型分布实测：69 步中 `resolve_slice` 为少数 —— 与「仅少数」相符 |
| SK-MIG-56 | `references[kind=ontologyType]` ← `SOLVER_CATALOG[solverKey].reads`（19 条目） | ✅（内容属实）/ ❌（行号过期） | `apps/agentcore/src/agent/navigation-slice.ts:76`（文档写 `:25-34`） | `SOLVER_CATALOG` 实际在 **:76**，`reads` 字段声明在 :31。内容对、坐标漂了 |
| SK-MIG-57 | `inputSchema` ← `Intent.slots[]` 机械转 JSON Schema · **仅 15/32** | ❌ **数字与实测不符** | `packages/contracts/src/qos.ts` `SlotDefSchema` | **实测 `PROBE_INTENTS_WITH_SLOTS=27`**，不是 15。见 SK-MIG-59 |
| SK-MIG-58 | `examples` ← `Intent.examples` + 措辞金标集（20 场景 × 3 变体 = 60 条，题干从 CATALOG 派生不手抄） | ✅ | `apps/agentcore/test/fixtures/scenario-phrasing-goldset.ts` | 文件在；20/32 有金标变体的口径与 `SCENARIO_CATALOG=20` 自洽 |
| SK-MIG-59 | **边界 1**：`inputSchema` 有 **17/32 是空壳**，导出时必须打标 `x-derived: "empty-slots"` | ❌ **17 是错的，实测 5** | `apps/agentcore/src/mocks/seed.ts` | **亲手跑**：空槽意图 = **5 条**，逐个点名 `plan_recommend` / `inventory_opt` / `maint_stagger` / `sop_status` / `ceo_finance_pnl`。文档说「CATALOG 派生的 16 条一律 `slots: []`」**不成立**——实测 20 条 catalog 派生意图里 **16 条有槽**。PRD §13 自标此数为「静态推算未实测」，本单予以订正 |
| SK-MIG-60 | **边界 2**：`navSlice` 不是"每意图的资源声明"（按问句实时投影），`ontologyType` 真来源是 `SOLVER_CATALOG[].reads` | ✅ | `apps/agentcore/src/agent/navigation-slice.ts:283` 区 `projectNavigationSlice(query, pageContext, scope)` | 签名带 `query` 入参 ⇒ 确为按问句投影，不是按意图存的。边界成立 |

### 1.4 §1.3 Business Intent 必须人填（7）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-61 | 用户角色 ≠ `Scenario.targetView`（视图不是角色） | ✅（论证属实） | `packages/contracts/src/agentcore.ts:313` `ScenarioPresetContextSchema.targetView` | `targetView: z.string()` 是视图键，无角色语义字段 |
| SK-MIG-62 | 决策场景 ≠ `VIEW_DOMAIN`（域名是分组标签） | ✅ | `apps/agentcore/src/scenarios-catalog.ts` `VIEW_DOMAIN` | 6 个域名为分组标签，无「在哪个会上/什么节点」语义 |
| SK-MIG-63 | 触发条件 ≠ `Intent.examples` / `ScenarioCard.triggerQuestion`（词法面 ≠ 业务事件面） | ✅ | `apps/agentcore/src/scenarios-catalog.ts` `triggerQuestion` | 字段确为问句字符串 |
| SK-MIG-64 | KPI **无任何来源**；`PLAN_GOAL_TARGETS` 是全公司目标不是 Skill 度量 | ✅ | `packages/contracts/src/base-registry.ts` `PLAN_GOAL_TARGETS` | 实测值 `{revGrowthPct:18, gmFloorPct:15.5, sharePts:12, capexCap:20, cashFloor:50, turns:6}` —— 确为全公司经营目标 |
| SK-MIG-65 | 工作量 = 32 × 4 = 128 个语义判断；`order_deep_360` 应给 `businessIntent.kind:"technical_demo"` 不硬编假场景 | ⛔本期/❌ | `apps/agentcore/src/mocks/seed.ts` | 32 条意图实测在；`order_deep_360` 在册；`businessIntent` 字段不存在 ⇒ 无处可填也无处可假编（**当前无「填了假的」这个缺陷**） |
| SK-MIG-66 | 这是组织协调工作量（8–16 人时业务方时间），无法靠 dev 加班压缩 | ⛔本期 · 不可代码验证 | `docs/PRD-skill-migration.md:135-136` | 估算类断言，无代码面。标为不可验证而非假绿 |
| SK-MIG-67 | 故它**不该挡在权威翻转前面**（§9 的 (a)/(b) 抉择） | ⛔本期 · 论证 | 同上 :137 | 与 SK-MIG-163 同一主张，见 §9 |

### 1.5 §1.4 三个"零消费方"（3）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-68 | `maxBudgetRounds`：**7/7 未填 · 全仓零生产消费方** | ✅ **今日复测仍属实** | `packages/contracts/src/agentcore.ts:260` | 实测 `PROBE_MAXBUDGET_SET=0`（7 个种子全空）；`grep -rn maxBudgetRounds apps/*/src packages/*/src` = **仅契约定义 1 处**，零生产读取方。金丝雀：同命令查 `sideEffect` 得 69 命中 ⇒ 工具正常 |
| SK-MIG-69 | `outputSchema`：有值但**零校验消费方**（两处读均非校验） | ✅ **今日复测仍属实** | `apps/agentcore/src/skill-lint.ts:342` · `apps/agentcore/src/dril/resource-projector.ts:149` | 实测 `PROBE_OUTPUTSCHEMA_SET=7`（7/7 有值）；追一层：lint 那处只跑 `validateJsonSchemaShape`（验"是不是合法 JSON Schema"），projector 那处只投影展示 ⇒ 形态④「消费方量的不是这个字段该管的事」 |
| SK-MIG-70 | `references` 的非-skill 引用**不校验存在性**（`skill-lint.ts:177` 明写 `if (ref.kind !== "skill") continue;`） | 🔗 **已部分闭合（文档过期）** | `apps/agentcore/src/skill-lint.ts:218` | `continue` 那行还在（漂到 :218），**但 2026-08-09 起 skill 发布路已接 `probeMissingRefs`**（`server.ts:1272`），solver/rule/ontologyType 三种 kind 已被跨系统探针校验。**诚实剩余缺口**（源码注释自承）：`constraint`/`slice`/`workflow`/`agent` 四种 kind **今天仍无人校验** |

### 1.6 §1.5 三件地基现状（3）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-71 | **G1** executor 严格串行：`for (const step of input.steps){…await…}`，循环体内无 `Promise.all` | ✅ **今日复测仍属实** | `apps/agentcore/src/workflow/executor.ts:104` | 该行原文逐字相符；全文件 `Promise.all` 命中 **0** |
| SK-MIG-72 | **G2** 规则 DSL：`expression` 不能引用 `params`，且**静默恒假不报错**；活样本 C18 双阈值并存 | ❌ **已被修掉（文档过期）** | `apps/datacore/src/ruledsl.ts:39` · `:491-500` · `apps/datacore/src/synthetic/battery.ts:284` | **`Operand` 联合已加 `{kind:"param"; name:string}`**（:39），求值分支 `case "param"`（:491）**未声明即抛 `DslError`**（"拒绝按缺省值求值"），不再静默恒假；C18 已改写为 `expression: \`AnnualScenario.cashCushion < ${ruleParamRef("cashFloor")}\``（:284）—— 双阈值并存的活样本**已不存在**。归功 `WO-RULE-EXPR-PARAMS` |
| SK-MIG-73 | **G3** 命名未定，且 `requires` 已被 `FeatureDef.requires` 占用 | ✅（占用属实）/ ❌（"未定"已过期，裁决已下但未落地） | `packages/contracts/src/features.ts:15` | 占用属实：`requires: z.array(z.string()).optional()`，追一层消费方 `apps/agentcore/src/features/registry.ts:194` `for (const parent of def.requires ?? [])` ⇒ **活的**。裁决状况见 §3 与 SK-MIG-184 |

### 1.7 §2 目标形态（13）

> 整节是 M0–M3 的目标结构，**⛔ 本期不做**；下表判的是「今日承载物在不在」。

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-74 | Skill = 一意图一份 · 版本化 · entitlement 与意图同处判定 | ⛔本期/❌ | `packages/contracts/src/agentcore.ts:240` | `version: z.number().int()` 版本化 ✅；「一意图一份」实测 0（交集为空）；entitlement 同处判定 ❌ |
| SK-MIG-75 | `key` **必须 === intent.key**（任何映射表都是第三处真源） | ⛔本期/❌ | 同上 :239 | 实测 `PROBE_SKILLKEY_EQ_INTENTKEY=0` |
| SK-MIG-76 | `businessIntent` 人填 · 契约必填 · 允许显式 TODO 哨兵 | ⛔本期/❌ | — | 字段 0 命中 |
| SK-MIG-77 | `execution.mode` = `DETERMINISTIC｜EXPLORATORY｜HYBRID`，显式声明不隐式推断 | ⛔本期/🔗 | `packages/contracts/src/skill-graph.ts:384` | `SkillExecutionSchema` **有** `mode?`，但只挂路由请求体（`server.ts:1346`），**不在 `SkillDefinition` 上** ⇒ 形态④ |
| SK-MIG-78 | `execution.plan[]` = 今日 `ExecutionPlan.steps` 逐字节不变，PlanStep 复用不新造 DSL | ⛔本期/🔗 | 同上 | `SkillExecutionSchema` 用 `steps?`（复用 `PlanStepSchema`，`server.ts:1352` 注释确认语义校验走 `validatePlanSteps`）⇒ 「复用不新造」口径**被遵守**；但实体上不存在 |
| SK-MIG-79 | `execution.body` = 探索/兜底时注入 agent（今日 `Skill.body` 语义不变） | ⛔不改不新造 · ✅ | `packages/contracts/src/agentcore.ts:243` | `body: z.string().max(50_000)` 语义未变 |
| SK-MIG-80 | `references[]` / `dependsOn[]` 引用清单（solver/rule/slice/ontologyType/tool/mcp/skill） | 🔗 **kind 词表缺 tool/mcp** | `packages/contracts/src/agentcore.ts:216` | `SKILL_REFERENCE_KINDS = ["rule","constraint","slice","ontologyType","solver","skill","workflow","agent"]` —— **8 种，不含 `tool`/`mcp`** ⇒ 目标形态里那两种今天**声明不了** |
| SK-MIG-81 | `inputSchema` / `outputSchema` | ✅（字段在）/🔗（无校验消费方） | 同上 :254-255 | 见 SK-MIG-69 |
| SK-MIG-82 | `maxBudgetRounds` / `provenancePolicy` / `sideEffect` / `approvalGate` | 🔗 **四中三有消费方** | 同上 :253/258/259/260 | `sideEffect` 追一层：`isWriteEffectSkill`/`isWriteModeSkill`（:201）有生产调用方；`approvalGate` 同；`provenancePolicy` 有聚合方；**`maxBudgetRounds` 零消费方**（SK-MIG-68） |
| SK-MIG-83 | `status` 降为**生命周期**，不再兼任授权判据 | ⛔本期/❌ | 同上 :247 | `status: z.enum(["DRAFT","PUBLISHED","RETIRED"])` 仍兼任授权（见 SK-MIG-147） |
| SK-MIG-84 | 边界：**引用**类 = 规则/求解器及数学约束/本体类型与切片/工具与 MCP/其他 Skill | 🔗 | 同 SK-MIG-80 | 六类中「工具与 MCP」声明不了 |
| SK-MIG-85 | 边界：**内联**类 = `businessIntent`/`maxBudgetRounds`/`provenancePolicy`/`antiExamples`/本 Skill 专属 objective 权重 | ⛔本期/❌（5 中 2 有字段） | 同上 | `antiExamples` **全仓 0**；objective/weights 全仓 0；`businessIntent` 0 |
| SK-MIG-86 | 明确**不放进** Skill：真值数据(R4)/租户阈值/业务常数(R14)/模型选择 | ⛔不改不新造 · ✅ | `packages/contracts/src/agentcore.ts:236-261` | 反向断言成立：18 个字段里无一是真值数据/阈值/常数/模型选择 |

### 1.8 §3 分期总览（5）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-87 | 期号命名空间 M0–M3 / R0–R4 / T1–T2，**本文之后不再出现裸「Phase N」** | 🔗 **本文已净，上游 SPEC 未净** | `docs/PRD-skill-migration.md:183-185` | 实测：`PRD-skill-migration.md` 裸 `Phase N` = **0** ✅；但 `docs/SPEC-industrial-skill.md:111` 仍有「Track A **Phase 4**」、`:255` 仍有「**Phase 0** 的自动导出」⇒ XR C5 声称「两份 PRD 均已全文替换、残留 = 0」只覆盖了两份 PRD，**SPEC 漏了**（见 SK-XR-38） |
| SK-MIG-88 | M0 出口判据：32/32 生成 + 引用闭包门绿 + Business Intent 全为显式 TODO 哨兵 | ⛔本期/❌ | — | 三项：生成 0/32 · 闭包门**已绿**（SK-MIG-31）· 哨兵字段不存在 |
| SK-MIG-89 | M1 出口判据：32/32 逐意图过 + 门自带三条自证 + 两条变异反证按预期红 | ⛔本期/❌ | — | 门不存在 |
| SK-MIG-90 | M2 出口判据：双源红门绿 + entitlement 一处判定门绿 + **非 demo 租户**用例绿 | ⛔本期/❌ | — | 两门均不存在；非 demo 租户播种缺口仍在（SK-MIG-40） |
| SK-MIG-91 | M3 出口判据：每项「改声明 → 行为**真变**」（不是只读出来） | ⛔本期/❌ | — | 6 项全未开工（SK-MIG-157..162） |

### 1.9 §4 硬约束 → 可验收判据（8）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-92 | ① 零行为漂移：迁移前后 answer 与 provenance **字节相等**，落 `skill-plan-parity:check` | ⛔本期/❌ | — | 门不存在 |
| SK-MIG-93 | ① **假过形态**：只比对「Skill 里的 plan 字段 === Plan 的 steps」——恒真 | ⛔不改不新造（反向断言） | — | 今天无 parity 门 ⇒ 尚未出现该假过。这条要在建门时验 |
| SK-MIG-94 | ② 单一真源硬门 + **6 个写入方全部收口**，落 `skill-single-source:check` | ⛔本期/❌ | `apps/agentcore/src/catalog/service.ts:239` 等 | 实测 `repos.plans.insert(` **生产侧 4 处**（catalog:239 / ops-fallback:129 / smoke-llm:38 / seed:797）+ 测试 7 处；一个都没收口 |
| SK-MIG-95 | ② **假过形态**：只删 REST 端点、留播种/scaffold/fallback 继续写 plan | ⛔不改不新造（反向断言） | `apps/agentcore/src/server.ts:552/558` | REST 端点仍在（未删）⇒ 尚未出现该假过 |
| SK-MIG-96 | ③ entitlement 一处判定：32 意图 × {开,关} 四象限 | ⛔本期/❌ | — | 门不存在 |
| SK-MIG-97 | ③ **假过形态**：只在 demo 租户测（多租户维必然半开） | ⚠️ **风险今日实测仍在** | `apps/agentcore/src/mocks/seed.ts:909` | `seedRegistry(now)` 无 tenantId；7 skill 实测 tenantId 全 `demo` ⇒ 非 demo 租户翻转后必然"有意图·无 Skill" |
| SK-MIG-98 | ④ 探索 Skill 的 `maxBudgetRounds` 必须有真消费方（2 vs 6 → LLM 往返次数真的不同 + 落 `degrade`） | ⛔本期/❌ | `apps/agentcore/src/tools/budget.ts:31` | 接线点在（`{...DEFAULT_AGENT_BUDGET, ...overrides}`，`maxRoundTrips` 默认 24 见 `packages/contracts/src/qos.ts:668`），**但 skill 侧无人传 override**：`new BudgetTracker(this.residualBudgetFromConfig())` 3 处（orchestrator:929/1028/1705）全部只读 env 配置，不读 skill |
| SK-MIG-99 | ④ **假过形态**：断言"字段被读出来 / 被传给 BudgetTracker"（运输层断言） | ⛔不改不新造（反向断言） | — | 今天连运输层都没接 ⇒ 尚未出现该假过 |

### 1.10 §5 M0 影子声明（8）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-100 | 写确定性导出器（建议 `apps/agentcore/src/mocks/skill-export.ts` · 纯函数 · R6 同输入字节一致） | ⛔本期/❌ | — | 文件不存在（`ls apps/agentcore/src/mocks/` 只有 seed.ts 等，无 skill-export.ts）；`skill-export` 全仓 0 命中 |
| SK-MIG-101 | 输出 32 份 `SkillDefinition`（`status:"DRAFT"`，key === intentKey） | ⛔本期/❌ | — | 实测今天 7 份，全 PUBLISHED 语义，key 与 intentKey 交集 0 |
| SK-MIG-102 | M0 结束时：Skill 表多 32 份 DRAFT 影子 · **无任何执行路径读** · 线上行为逐字节不变 | ⛔本期/❌ | — | 0 份影子 |
| SK-MIG-103 | M0 门 1 **导出完备**：`intents.map(i=>i.key)` 逐条必须有对应 Skill，用例集从注册表派生不手抄 | ⛔本期/❌ | — | 门不存在。**注**：「从注册表派生不手抄」这条纪律**在别处已有先例**——`scenario-phrasing-goldset.ts` 与 `apps/agentcore/test/scenarios-wiring.test.ts` 都从 `SCENARIO_CATALOG` 派生 |
| SK-MIG-104 | M0 门 2 **引用闭包**：本期工作是「接一条已有的线 + 关掉 fail-open」，**不是从零造门** | ✅ **已落地且口径被证实** | `apps/agentcore/src/resources.ts:64` `probeMissingRefs` · `apps/agentcore/src/server.ts:1272` | 亲手跑 `node scripts/check-ref-closure.mjs` RC=0。追一层：`server.ts:1272` 在 `POST /b/v1/skills/:id/publish` handler 内、且门判据⑤要求它出现在 `repos.skills.update` **之前**；fail-open 两层已关死（`resources.ts:22-31` `probeUnavailable` → 503 `REF_PROBE_UNAVAILABLE`，注册表抛错**与空集**都拒） |
| SK-MIG-105 | M0 门 3 **Business Intent 棘轮**：契约必填 + 显式哨兵 + 基线 32 只降不升（同 `debattery-baseline.json` 模式） | ⛔本期/❌ | `scripts/debattery-baseline.json` | 参照模式**确实存在**（且 `check-debattery.mjs` 在 gates 链第 4 位）；但 skill 侧字段、脚本、基线文件三者全无 |
| SK-MIG-106 | M0 边界：17/32 `inputSchema` 空壳已打标 `x-derived:"empty-slots"`（写进导出器注释） | ❌ **数字错（实测 5）** + ⛔本期 | 同 SK-MIG-59 | 见 SK-MIG-59 实测 |
| SK-MIG-107 | M0 边界：12/32 无金标变体；CEO 域 solver 未登记 `SOLVER_RULE_REFS` 故 rule 引用为空——**空是事实不是遗漏，但要标出来** | ✅（事实属实）/ ⛔本期未标 | `packages/contracts/src/datacore.ts:127` | 实测 `SOLVER_RULE_REFS` = 19 条，CEO 域 solver 确不在册；32−20=12 与「12/32 无金标变体」自洽 |

### 1.11 §6 M1 一致性门（命门）（16）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-108 | §6.1 「Skill 里有 plan 字段且内容相同」是**恒真断言**（比的是复制成功不是执行等价） | ⛔本期 · 论证 | `docs/PRD-skill-migration.md:252-256` | 论证正确且与本仓已登记的假绿形态同族；无代码面 |
| SK-MIG-109 | 判据 1：同一 `createTestApp` 进程、同 query/presetSlots/mock DataCore，跑 run-OLD 与 run-NEW 两次 | ⛔本期/❌ | `apps/agentcore/test/helpers.ts:43` | `createTestApp({features})` **确实支持**注入 features（门要的机制在），但 parity 测试文件不存在 |
| SK-MIG-110 | 判据 1：两次都必须 `task.status==="COMPLETED"` 且 `task.path==="WORKFLOW"`，任一 FAILED/AWAITING → 红 | ⛔本期/❌ | — | 同上 |
| SK-MIG-111 | 判据 2：**执行源可判别** —— run-NEW 的 `resolvedRefs` 含 `{kind:"skill"}` 且不含 `{kind:"plan"}`，run-OLD 反之 | ⛔本期/❌ | — | 同上。这是「两条路真走了不同解析源」的唯一证据 |
| SK-MIG-112 | 判据 2：`RefKindSchema` 已含 `"skill"`，**无需改契约** | ✅ **今日复测属实** | `packages/contracts/src/refs.ts:9` | 原文 `z.enum(["rule","skill","workflow","plan","agent","mcp","intent"])` —— `skill` 与 `plan` 并存 |
| SK-MIG-113 | 判据 3：`canonicalizeAnswer(OLD) === canonicalizeAnswer(NEW)` **字符串全等**（非 deep-equal） | ⛔本期/❌ | — | `canonicalizeAnswer` 全仓 0 命中 |
| SK-MIG-114 | 判据 4：覆盖 32/32，用例集从注册表派生（20 条取 `slotPresets` + 12 条 CEO fixture） | ⛔本期/❌ | `packages/contracts/src/agentcore.ts:315` `slotPresets` | 承载字段在（`ScenarioPresetContextSchema.slotPresets`），用例集不存在 |
| SK-MIG-115 | §6.3 `canonicalizeAnswer` 必须是 ≤40 行纯函数 | ⛔本期/❌ | — | 不存在 |
| SK-MIG-116 | 规范化只做 1：`provId` 按首现顺序重编号为 `p0/p1/…`，同时改写 `blocks[].provId` 与 `provenance[].id` | ⛔本期/❌ | `apps/agentcore/src/workflow/executor.ts` `newId("prov")` | 不稳定源属实（`ids.ts:20-23`），规范化器不存在 |
| SK-MIG-117 | 规范化只做 2：`validationTrace.generatedAt` 置空 | ⛔本期/❌ | — | 同上 |
| SK-MIG-118 | 规范化只做 3：`action_draft` 块的 `draftId` 按首现顺序重编号 | ⛔本期/❌ | — | 同上 |
| SK-MIG-119 | 自证① **自反**：run-OLD 连跑两次 → canonical 相等 | ⛔本期/❌ | — | 不存在 |
| SK-MIG-120 | 自证② **敏感**：改 skill `execution.plan` 里任一 solverArg（`weeks: 6→7`）→ canonical 必须不等 | ⛔本期/❌ | — | 不存在 |
| SK-MIG-121 | 自证③ **结构**：canonical 输出中不得出现 `/^prov_[0-9A-Z]{26}$/` 形态 | ⛔本期/❌ | — | 不存在 |
| SK-MIG-122 | §6.4 变异反证两条（M1 打掉执行源分支 → 判据 2 必红判据 3 反而绿；M2 改 solverArg → 判据 3 必红） | ⛔本期/❌ | — | 不存在。**同型先例已在仓**：`scripts/check-ref-closure.mjs` 的 5/5 金丝雀变异全部被咬 ⇒ 这套方法论在本仓**可行且已被验证** |
| SK-MIG-123 | §6.5 门证不了什么（真 DataCore 字节相等 / 未覆盖槽位组合 / 探索 path-B），须补 `xservice-smoke.test.ts` 两条用例 | ⛔本期 · 载体在 | `apps/datacore/test/xservice-smoke.test.ts` | 文件**存在**（可挂载点在）；`capacity_feasibility`/`affected_orders` 两条 parity 用例未加 |

### 1.12 §7 M2 权威翻转（33）

**§7.1 十个必须改的读取点**（判的是「今天这个读取点还在不在、坐标准不准」）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-124 | 读点 1 `runPathA` 用 `resolvePlanForIntent`（文档写 `orchestrator.ts:1412`） | ✅存在/❌坐标漂 | `apps/agentcore/src/router/orchestrator.ts:1678` | 实际在 :1678（`runPathA` 体内），文档的 :1412 已漂。下一行 :1681 即 `failTask(…, "PLAN_NOT_FOUND", …)` |
| SK-MIG-125 | 读点 2 `solverKeyForIntent` 从 plan 首个 `invoke_solver` 步取 solver 真名（**结构依赖非简单读取**） | ✅存在/❌坐标漂 | 同上 `:1112-1118`（文档写 :1061） | 追一层：调用方 `:1093` `const solverKey = await this.solverKeyForIntent(intent)`，用于⑤多意图候选 ⇒ **确实是结构依赖**，文档判断正确 |
| SK-MIG-126 | 读点 3 trace 端点 `resolvePlanForIntent(…)?.plan` 喂 `projectTrace` | ✅存在/❌坐标漂 | `apps/agentcore/src/server.ts:468`（文档写 :460） | `if (intent) plan = (await resolvePlanForIntent(deps.repos, intent))?.plan;` |
| SK-MIG-127 | 读点 4 `scenarioClosure` 的「意图未绑定执行计划」判据 | ✅存在/❌坐标漂 | `apps/agentcore/src/server.ts:2248`（定义）· `:2402`（判据）（文档写 :1995） | :2402 原文 `issues.push(\`意图「…」未绑定执行计划\`)` |
| SK-MIG-128 | 读点 5 scaffold 闭包判定 `resolvePlanByRef(… forValidation)` | ✅存在/❌坐标漂 | `apps/agentcore/src/server.ts:2402`（文档写 :2136） | 同上行内 `resolvePlanByRef(deps.repos, pkg.id, intent.planRef, { forValidation: true })` |
| SK-MIG-129 | 读点 6 `verifyScenario.capabilityOk` 用 `resolvePlanForIntent` | ✅存在/❌坐标漂 | `apps/agentcore/src/server.ts:2513`（文档写 :2247） | `const capabilityOk = !!intent && intent.status === "PUBLISHED" && !!(await resolvePlanForIntent(deps.repos, intent));` |
| SK-MIG-130 | 读点 7 `ontologyOk` **直接读 `intent.planId`** | ✅存在/❌坐标漂 | `apps/agentcore/src/server.ts:2514`（文档写 :2248） | `const ontologyOk = !!intent && !!(intent.planId);` —— 文档「直接读 planId」的判断**逐字属实** |
| SK-MIG-131 | 读点 8 场景发布链 `resolvePlanByRef` + `publishPlan` | ✅存在/❌坐标漂 | `apps/agentcore/src/server.ts:578` `publishPlan`（文档写 :2520） | `return deps.catalog.publishPlan(planId);` |
| SK-MIG-132 | 读点 9 `projectIntents` 的 `boundPlanRef: i.planRef ? … : i.planId` | ✅存在（坐标准） | `apps/agentcore/src/dril/resource-projector.ts:135` | 逐字相符 |
| SK-MIG-133 | 读点 10 `catalog/service.ts:83/190` `resolvePlanForIntent` / publish 校验 | ✅存在（:83 准） | `apps/agentcore/src/catalog/service.ts:83` · `:179` `publishIntent` | :83 逐字相符；:190 漂到 :179 附近 |

**§7.2 六个 ExecutionPlan 写入方 + 前端三处**

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-134 | 写入方 1 出厂播种 `seedIntentsAndPlans` 的 plans 分支 + `ensureScenarioPackageSeed` 的 `plans.insert` 循环 | ✅存在 | `apps/agentcore/src/mocks/seed.ts:210` · `:797` | :797 `for (const p of plans) if (!(await repos.plans.get(p.id))) await repos.plans.insert(p);` |
| SK-MIG-135 | 写入方 2 目录 REST（list/create/update/publish plans） | ✅存在/❌坐标漂 | `apps/agentcore/src/server.ts:552`（GET）· `:558`（POST）· `:578`（publish）（文档写 544/550/558/566） | 路由前缀实际是 `/api/v1/catalog/packages/:packageId/plans`（`/b/v1` 是重写别名） |
| SK-MIG-136 | 写入方 3 跨系统 scaffold `POST /b/v1/internal/scaffold` 内 `deps.catalog.createPlan` | ✅存在 | `apps/agentcore/src/catalog/service.ts:239` `this.repos.plans.insert(plan)` | 追一层：`createPlan` 的调用方含 internal/scaffold 路与 `growth/scaffold.ts:31` |
| SK-MIG-137 | 写入方 4 生长回路 `growth/scaffold.ts` `scaffoldDraftPlan` | ✅存在 | `apps/agentcore/src/growth/scaffold.ts:21,31` | 追一层：`scaffoldDraftIntent:68` → `scaffoldDraftPlan` → `catalog.createPlan` → `plans.insert` ⇒ **活链**（照铁律 0.5，不止 grep 直接命中） |
| SK-MIG-138 | 写入方 5 孵化闭环 `ops/fallback.ts` `repos.plans.insert(promoted_*)` | ✅存在（坐标准） | `apps/agentcore/src/ops/fallback.ts:129` | `key: \`promoted_${keySuffix}\``（:124）→ `:129 await repos.plans.insert(plan)` |
| SK-MIG-139 | 写入方 6 冒烟脚本 `scripts/smoke-llm.ts:38` | ✅存在（坐标准） | `apps/agentcore/src/scripts/smoke-llm.ts:38` | `for (const p of plans) await repos.plans.insert(p);` |
| SK-MIG-140 | 前端删除面 A：`endpoints.ts:767-770` `fetchPlans`/`createPlan` | ✅存在/❌坐标漂 | `apps/frontend-shell/src/api/endpoints.ts:811,814` | 均在（未删） |
| SK-MIG-141 | 前端删除面 B：`CatalogPage.tsx:126/285` `createPlanMut` + `plan-create` 按钮 | ✅存在（坐标准） | `apps/frontend-shell/src/pages/admin/CatalogPage.tsx:126,285` | `data-testid="plan-create"` 逐字在 |
| SK-MIG-142 | 前端删除面 C：`mocks/handlers.ts:3044/3046` mock handler | ✅存在/❌坐标漂 | `apps/frontend-shell/src/mocks/handlers.ts:3088` | `http.get("*/b/v1/catalog/packages/:packageId/plans", …)` |
| SK-MIG-143 | ⚠ 删 `plan-create` 按钮**必须同时**给 Skill 侧等价入口，否则重新挖开 G-4 | ⛔本期 · 约束未被违反 | `apps/frontend-shell/src/api/endpoints.ts:813` | 该行注释原文即「G-4：消裁决#27 死路 —— 前端自助创建可绑定的执行计划」⇒ 文档对 G-4 来历的描述**属实**；按钮未删，约束未被违反 |

**§7.3–§7.6**

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-144 | §7.3 `SkillDefinition` tenant 级（有 tenantId 无 packageId）· Plan/Intent package 级 | ✅ | `packages/contracts/src/agentcore.ts:237-238` | 逐字相符 |
| SK-MIG-145 | §7.3 既有隐含假设 `packages.listByTenant(tenantId)[0]`（一租户一包） | ✅存在/❌坐标漂 | `apps/agentcore/src/server.ts` 三处（文档写 2021/2245/2516） | 模式仍在（`listByTenant(…)[0]`），行号随分支漂移 |
| SK-MIG-146 | §7.3 M2 加启动期断言：每租户 package ≤1 或 intentKey 租户内唯一，不满足**拒绝启用翻转 flag** | ⛔本期/❌ | — | flag `qos.skill-execution-authority` **全仓 0 命中** ⇒ 断言无处可挂 |
| SK-MIG-147 | §7.4 今天 entitlement 两处判定：`intentAllowed` + Skill 的 `status`/`agent.skill-on-free-qa` 暗发门 | ✅ **今日复测属实** | `apps/agentcore/src/features/registry.ts:201` `intentAllowed` · `:118` 区 | 两处都在 |
| SK-MIG-148 | §7.4 翻转后 `intentAllowed` 仍是**唯一** entitlement 判据 | ⛔本期/❌ | 同上 | 未翻转 |
| SK-MIG-149 | §7.4 `resolveSkillForIntent` 内**先** `intentAllowed`、后取 skill；skill 不参与授权 | ⛔本期/❌ | — | `resolveSkillForIntent` 0 命中 |
| SK-MIG-150 | §7.4 门注入真 `FeatureGate`（`createTestApp({features})` 已支持），跑 32×{开,关} 四象限 + **必须含非 demo 租户用例** | ⛔本期/❌（机制在） | `apps/agentcore/test/helpers.ts:43` 区 · `apps/agentcore/test/scenario-seed-multitenant.test.ts` | 两个"先例载体"都在仓 ⇒ 文档说的机制可用；门本身不存在 |
| SK-MIG-151 | §7.5 双源门判据 1（运行期）：每个 PUBLISHED intent，`resolveSkillForIntent` 命中且 `resolvePlanForIntent` 未命中 | ⛔本期/❌ | — | 门不存在 |
| SK-MIG-152 | §7.5 判据 2（静态）：除 migrations/persistence 外全仓不得再出现 `repos.plans.insert(` | ⛔本期/❌ | — | 门不存在；今天生产侧 4 处 |
| SK-MIG-153 | §7.5 判据 3（静态）：`ExecutionPlanSchema` 只允许被 `SkillDefinitionSchema.execution` 引用；`PlanStepSchema` 保留 | ⛔本期/❌ | `packages/contracts/src/execution-plan.ts:6-7` | 该文件确因导出撞车改叫 ComposePlan（XR C1 引以为据的先例，属实）；门不存在 |
| SK-MIG-154 | §7.6 翻转由暗发 flag `qos.skill-execution-authority` 控制（BLOCK 级·defaultOn:false·双注册） | ⛔本期/❌ | — | flag 全仓 0 命中 |
| SK-MIG-155 | §7.6 **M2 不删表**（回退可行的前提是 plans 表还在） | ⛔本期 · 约束未被违反 | `apps/agentcore/migrations/` | 无删表 migration |
| SK-MIG-156 | §7.6 表级退役排到连续两个发布周期无回滚，migration 须带 `down`，memory/pg 双实现 + repo 接口四处同改 | ⛔本期 · 未触发 | `apps/agentcore/src/persistence/{pg,memory,repos}.ts` | 三处双实现结构在，未触发 |

### 1.13 §8 M3 Skill 独有能力（6）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-157 | M3-1 `maxBudgetRounds` 接消费方；优先级 **env 硬预算 > skill 声明 > DEFAULT** | ⛔本期/❌ | `apps/agentcore/src/tools/budget.ts:30-31` · `apps/agentcore/src/router/orchestrator.ts:929/1028/1705` | 追一层：三处 `new BudgetTracker(this.residualBudgetFromConfig())` 的入参函数 `residualBudgetFromConfig()`（:468）**只读 env**，不读 skill ⇒ 「skill 声明」这一档在优先级链上**根本不存在**。**注**：实现据 `CHECKLIST-skill-4209.md:65` 躺在未并的 `handoff-skill-partial-a` 分支上；canonical 上为 0 |
| SK-MIG-158 | M3-2 `antiExamples[]` + `exclusivity`（S12/S13 措辞接缝 6 条失败用例转绿即效果） | ⛔本期/❌ | — | `antiExamples` / `exclusivity` **全仓 src 0 命中**（金丝雀：同命令 `sideEffect` 69 命中） |
| SK-MIG-159 | M3-3 `acceptance.goldenCases[]` 自带验收，门从注册表生成 | ⛔本期/❌ | — | `goldenCases` 全仓 0。（`acceptance` 有命中，但那是 `packages/contracts/src/growth.ts:127` 的场景发育字段，**不是 Skill 的**——不许当成命中） |
| SK-MIG-160 | M3-4 `outputSchema` 接消费方**或删**（做不到就删字段） | 🔗 **仍是有形无约束** | `apps/agentcore/src/skill-lint.ts:342` · `dril/resource-projector.ts:149` | 见 SK-MIG-69：两处消费方量的都不是"实际输出对不对" |
| SK-MIG-161 | M3-5 `progress.emitsNarration` / `phases[]`（多角色 Coordinator 路径旁白真到达） | ⛔本期/❌ | — | `emitsNarration` 全仓 0 命中 |
| SK-MIG-162 | M3-6 Reasoning Graph（条件分支/汇流） | 🔗 **调度器已进主线·实体带不走** | `packages/contracts/src/skill-graph.ts:384` `SkillExecutionSchema` · `apps/agentcore/src/skill-orchestrator.ts:95` `GraphScheduler` · `apps/agentcore/src/server.ts:1346/1368` | 追一层：`POST` handler 在 :1368 `new GraphScheduler({repos, dataCore})`，图从**请求体** `execution: SkillExecutionSchema.optional()`（:1346）来 ⇒ **一个存下来的 Skill 带不走自己的图**（形态④） |

### 1.14 §9 开放问题 (a)/(b)（9）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-163 | 推荐 **(b) 加固版**：骨架先翻转，Business Intent 后补但用「必填+哨兵+棘轮」锁死 | ⛔本期 · 建议 | `docs/PRD-skill-migration.md:398` | 决策建议，仓主已在 SPEC §9.2「定案 4」采纳为**内部元数据（加固版）** ⇒ 建议**已被裁决采纳**，但三件加固全未落地（见下） |
| SK-MIG-164 | 理由 1：Business Intent 与命门**正交**（不参与执行） | ⛔本期 · 论证 | 同上 :402-404 | 论证成立：`businessIntent` 若存在也不进 `execution.plan` 执行链 |
| SK-MIG-165 | 理由 2：(a) 的真实成本是双写期变长，双写期是漂移温床 | ⛔本期 · 论证 | 同上 :405-408 | 无代码面 |
| SK-MIG-166 | 理由 3：(a) 把技术迁移挂在组织流程上；dev 硬编 = SPEC §4-D5「填了字段却没消费方比不填更危险」 | ⛔本期 · 论证 | `docs/SPEC-industrial-skill.md` §4-D5 | SPEC 原文在 |
| SK-MIG-167 | 证据：7 个既有 Skill 的 `dependsOn` **7/7 空**、`maxBudgetRounds` **7/7 空**、`resources` **7/7 空** | ✅ **三项今日全部复测属实** | `apps/agentcore/src/mocks/seed.ts:909` 区 | 实测 `PROBE_DEPENDSON_NONEMPTY=0` · `PROBE_MAXBUDGET_SET=0` · `PROBE_RESOURCES_NONEMPTY=0`。**同时订正一处相邻事实**：`references` **非空 6/7**（`PROBE_REFERENCES_NONEMPTY=6`）—— `dependsOn` 与 `references` 不是一回事，不许合成一句 |
| SK-MIG-168 | 加固 1：`businessIntent` zod 上**必填**，允许 `{status:"TODO", owner:"<待指派>"}` | ⛔本期/❌ | `packages/contracts/src/agentcore.ts:236-261` | 字段不存在 |
| SK-MIG-169 | 加固 2：棘轮门 `skill-business-intent:check`，基线=32，只降不升 | ⛔本期/❌ | — | 脚本不存在 |
| SK-MIG-170 | 加固 3：**需求拉动不行政摊派**（M3 每项先填它依赖的那几份） | ⛔本期/未触发 | — | M3 未开工 |
| SK-MIG-171 | 诚实处置：`businessIntent.status==="TODO"` 的 Skill 在资源目录/DRIL **降权但不隐藏**；§9.4 改推荐的条件（对外交付物口径） | ⛔本期/❌ · 口径已裁 | `apps/agentcore/src/dril/resource-projector.ts` | DRIL 投影里无 businessIntent 维；口径已由 SPEC §9.2 定为「内部元数据」⇒ §9.4 的改推荐条件**不触发** |

### 1.15 §10 三件地基的排期与前置（16）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-172 | G1 必须排在 **M2 之后、M3 之前** | ⛔本期 · 排期 | `docs/PRD-skill-migration.md:438` | M0–M3 全未开工 ⇒ 排期未被违反 |
| SK-MIG-173 | G1 与 M0/M1/M2 完全不依赖（迁移不改执行语义，串行照旧） | ✅（事实属实） | `apps/agentcore/src/workflow/executor.ts:104` | 串行循环今日仍在 |
| SK-MIG-174 | ⛔ G1 **必须不与 M1 同期**（两个变量同动 = 自毁对照组） | ⛔不改不新造（反向断言） | 同上 | 两者都没开工 ⇒ 未被违反 |
| SK-MIG-175 | G1 是 M3 序 6（Reasoning Graph 条件分支/汇流）的地基 | 🔗 **此前提今日部分失效** | `apps/agentcore/src/skill-orchestrator.ts:95` `GraphScheduler` | **`GraphScheduler` 已进主线**（`orchestrator-s1` 已收编）⇒「没有并行/汇流能力 Reasoning Graph 只能线性」这个前提要重估：图调度已有实现，真缺口移到「实体带不走图」（SK-MIG-162） |
| SK-MIG-176 | ⚠ G1 与 Track B1（Coordinator 并行扇出）**真互斥**，落同一文件同一段，须串行化或一 dev 整单 | ⛔本期 · 未触发 | `apps/agentcore/src/workflow/executor.ts:104` | 该段未被任一方改动 |
| SK-MIG-177 | G2 对 M0 无影响（`references[kind=rule]` 导出的是 rule key 不是 expression） | ✅ | `packages/contracts/src/datacore.ts:127` | `SOLVER_RULE_REFS` 值确为 rule key 数组 |
| SK-MIG-178 | G2 对 M1/M2 无影响（`evaluate_rules` 步语义原样搬运） | ✅ | `packages/contracts/src/qos.ts` `PlanStepSchema` | 步类型未变 |
| SK-MIG-179 | G2 对 M3：Skill 声明 rule params 会**静默恒假**且比今天更糟（两处诱饵+假绿） | ❌ **前提已消失** | `apps/datacore/src/ruledsl.ts:491-500` | **`case "param"` 未声明即 `throw new DslError("…拒绝按缺省值求值")`** ⇒ 「静默恒假」这条病**已被 WO-RULE-EXPR-PARAMS 治掉**；M3 规则维的这条风险应下调 |
| SK-MIG-180 | G2 判据 1：**DSL 留，不引第二套语法**（Skill 只列 rule key，`ruledsl.ts` 唯一权威） | ⛔不改不新造 · ✅ | `apps/datacore/src/ruledsl.ts` | 反向断言成立：全仓无第二套规则语法；`scripts/check-rule-closure.mjs` 守「有引用无定义即红」 |
| SK-MIG-181 | G2 判据 2：补 `params.<name>` 为一等 operand kind（`Operand` 联合加 `{kind:"param"}`） | ✅ **已落地** | `apps/datacore/src/ruledsl.ts:39` | `\| { kind: "param"; name: string }` 在册；追一层：解析在 `:324` `return { kind:"param", name: path[1] }`，求值在 `:491`，收集在 `:419` `if (o.kind === "param") acc.add(o.name)` ⇒ **三层全接** |
| SK-MIG-182 | G2 判据 3（**真交付物**）：加**解析期门** —— expression 里的标识符既非已发布对象类型属性路径、也非已声明 param → **解析期报错** | 🔗 **只做了 param 一半** | `apps/datacore/src/ruledsl.ts:491-500` | 追一层实测：`kind:"param"` 未声明**会抛**（这一半成立）；但 `kind:"field"`（`:450 resolveField`）**仍带"前缀可省"回退**、解不出返 `undefined` → `compare` 早退 false ⇒ **拼错对象属性名仍静默恒假**。文档说的「这道门才是 G2 的真交付物」**尚未落地** |
| SK-MIG-183 | G3 必须先于 **M0 开工**（名字定错 = 32 份全返工） | ⛔本期 · 排期 | — | M0 未开工 ⇒ 排期未被违反；但 G3 本身**已裁未落**（下条） |
| SK-MIG-184 | G3 定名：引用清单字段名 ✅ 仓主已裁决（2026-08-03）**采纳 `requires`**，`references[]`/`dependsOn[]` 降为解析期输入别名 | ❌ **已裁决未落地 —— 本单头号缺口** | `packages/contracts/src/agentcore.ts:236-261` | **实测 18 个字段无 `requires`**；全仓 skill 语境 `requires` 命中 0（金丝雀见 §5）；**且无任何"解析期归一"层**——消费方 `skill-lint.ts:343/347` 与 `resource-projector.ts:333-334` 直接读 `s.references`/`s.dependsOn`。详见 §3.1 |
| SK-MIG-185 | G3 定名：`execution`/`execution.mode`/`execution.plan`/`execution.body`、`businessIntent` 采用 | 🔗 部分（execution 词已用，未挂实体） | `packages/contracts/src/skill-graph.ts:384` | `SkillExecutionSchema` 用了 `mode`/`steps`/`graph`（**不是 `plan`**）⇒ 措辞与 §2 目标形态的 `execution.plan[]` **不一致**（这正是 `CHECKLIST-skill-4209.md` §2.5 抓的那条冲突） |
| SK-MIG-186 | G3 定名：`skill.key === intent.key` · 探索 Skill key 前缀 `explore.` · 基数目标 `\|Skill\| ≥ \|意图\|` | ⛔本期/❌ | `apps/agentcore/src/mocks/seed.ts:909` | 实测：交集 0；无 `explore.` 前缀 skill；\|Skill\|=7 < \|意图\|=32 |
| SK-MIG-187 | G3 定名：暗发 flag `qos.skill-execution-authority`（BLOCK 级·defaultOn:false·datacore+agentcore 双注册） | ⛔本期/❌ | `apps/datacore/src/features.ts` · `apps/agentcore/src/features/registry.ts` | 两处注册表**均无**该 key（全仓 0 命中） |

> §10.4 排期结论四句（G3 先于 M0 / G1+G2 先于 M3 / G1 不与 M1 同期 / G2 与 M0-2 可并行）
> 已分摊进 SK-MIG-172/174/183 与本节各条，不另编号。

### 1.16 §11 风险登记（8）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-R-A | 规范化器是 M1 单点故障（过松恒绿/过紧恒红），止损=三条自证+两条变异反证 | ⛔本期/❌ | `apps/agentcore/src/ids.ts:20-23` | 风险成立（provId 机制链属实）；止损物未建 |
| SK-MIG-R-B | **多租户 Skill 播种缺口**：`seedRegistry()` 无 tenantId、7 skill 硬编码 demo；意图/计划有懒播种 | ✅ **风险今日实测仍在（🔴）** | `apps/agentcore/src/mocks/seed.ts:909` · `apps/agentcore/src/main.ts:27` · `apps/agentcore/src/server.ts` `ensureScenarios` | 实测 `seedRegistry(now = …)` 签名**确无 tenantId**；`main.ts:27` `const { agents, workflows, skills } = seedRegistry();` 只在 boot 为 demo 播；7 skill `tenantId` 实测全 `demo` ⇒ **三处对照全部坐实** |
| SK-MIG-R-C | 六个 Plan 写入方（原骨架只点了两个），止损 = `skill-single-source:check` 静态断言 | ✅（六个今日全在）/❌（止损未建） | 见 SK-MIG-134..139 | 六个逐条追到 |
| SK-MIG-R-D | 键空间收窄：翻转把"取第一个包"升级成键唯一性要求 | ✅（假设今日仍在） | `apps/agentcore/src/server.ts` `listByTenant(…)[0]` | 模式仍在 |
| SK-MIG-R-E | `requires` 词表冲突 | ✅（冲突属实）/ 已被裁决**推翻为不成立** | `packages/contracts/src/features.ts:15` | 占用属实但裁决判定"不构成理由"（SPEC §9.1）⇒ 本条风险**已被裁决关闭**，剩下的是落地债（SK-MIG-184） |
| SK-MIG-R-F | 17/32 `inputSchema` 空壳不标注会被当成"不需要输入" | ❌ **基数错（实测 5/32）** | 见 SK-MIG-59 | 风险方向对，量级错 3 倍 |
| SK-MIG-R-G | G1 与 Track B1 撞同一段 `executor.ts:104` | ⛔未触发 | `apps/agentcore/src/workflow/executor.ts:104` | 两方都未动该段 |
| SK-MIG-R-H | 删 `plan-create` 按钮 = 重新挖开 G-4 | ⛔未触发 | `apps/frontend-shell/src/api/endpoints.ts:813` | 按钮与端点均在 |

### 1.17 §12 交付物 / WO 拆分 / 金值（14）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-188 | WO-SKILL-MIG-G3（命名定案回写契约 + 本体 §2.H） | ❌ **未开工（裁决已下 6 天）** | — | 无 `claude/handoff-*mig-g3` 分支（`git ls-remote` 13 条 skill 分支逐条看过，无此单）；契约未改 |
| SK-MIG-189 | WO-SKILL-MIG-P0（导出器 + 三道 M0 门） | ⛔本期/❌ | — | 三个脚本 `check-skill-export/ref-closure/business-intent.mjs` 中**只有 ref-closure 那道以别名 `check-ref-closure.mjs` 落地** |
| SK-MIG-190 | WO-SKILL-MIG-P1（一致性门 · 数据侧+引擎侧**同一 dev 整单**） | ⛔本期/❌ | — | 未开工 |
| SK-MIG-191 | WO-SKILL-MIG-P2（权威翻转 + 六写入方收口 + 双源门 + entitlement + 多租户播种，**一 dev 整单**） | ⛔本期/❌ | — | 未开工 |
| SK-MIG-192 | WO-SKILL-MIG-P3-x（M3 逐项，一项一个效果层门） | ⛔本期/❌ | — | 未开工 |
| SK-MIG-193 | 金值：`pnpm gates` 聚合 **16 → 23** | ❌ **两个数都作废** | `package.json` `scripts.gates` | 实测今日 **26** 道（现算 `&&` 分段）。金值应重列 |
| SK-MIG-194 | 金值：本体回写 §2.H / §3 / §7 / §8 | ⛔本期/❌ | `docs/SYSTEM-ONTOLOGY.md` | 两条新断点 0 命中（SK-MIG-39/40） |
| SK-MIG-195 | 金值：M2 后 `plans` 32→0（播种侧）、`skills` 7→39+ | ⛔本期/❌ | — | 实测今天仍是 32 / 7 |
| SK-MIG-196 | 金值：`SPEC-industrial-skill.md` §4 的「7 个 Skill 实测表」必须同步更新 | ⛔本期 · 未触发 | `docs/SPEC-industrial-skill.md` §4 | 7 个仍是 7 个，表未过期 |
| SK-MIG-197 | 金值：场景相关金值 20 **不变**（`SCENARIO_CATALOG.length` 派生断言不受影响） | ✅ | `apps/agentcore/test/scenarios-wiring.test.ts:25` | 断言原文 `expect(intents.length).toBeGreaterThanOrEqual(SCENARIO_CATALOG.length)` —— **确从 length 派生不手抄**；实测 `SCENARIO_CATALOG=20` |
| SK-MIG-198 | 复验判据 1：SEAM-GATE —— 判据 2 与判据 3 **必须在同一条测试里** | ⛔本期/❌ | — | 无 parity 测试 |
| SK-MIG-199 | 复验判据 2：变异反证必须当场跑，且先证 `tsc --noEmit` RC=0 | ⛔本期/❌ | — | 无门可变异。**本单已按此纪律办**：先 `pnpm --filter @platform/contracts build` + `llm-adapters build` 再取证 |
| SK-MIG-200 | 复验判据 3：四包全绿 `pnpm -r build && pnpm -r --workspace-concurrency=1 test` | ⛔本单不跑（派单：只取证不改码） | — | 本单**未跑四包 gate**（诚实边界，见 §7） |
| SK-MIG-201 | 复验判据 4：门显式捕获退出码，一律走 `bash scripts/gate.sh`，禁 `cmd \| tail -n` | ✅ **本单遵守** | `scripts/gate.sh` | 本单跑门用 `node scripts/check-*.mjs` 直跑并读 RC，未用管道吞码 |
| SK-MIG-202 | 复验判据 5：亲手真跑 3 条场景卡（S01/S02/S06）确认肉眼一致 | ⛔本期 · 未触发 | — | 未翻转，无对照对象 |

### 1.18 §13 诚实边界（13）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-MIG-203 | 自称已核实：§1.1 全部基数与绑定 | ✅ **复测全中（8/8）** | 见 SK-MIG-44..51 | 亲手跑 seed，8 条全对 |
| SK-MIG-204 | 自称已核实：§1.2 自动导出来源表 | 🔗 **7 行中 6 行对，1 行错** | 见 SK-MIG-52..58 | `inputSchema 15/32` 错（实测 27 有槽） |
| SK-MIG-205 | 自称已核实：§1.4 三个零消费方 | ✅ **三条全中** | 见 SK-MIG-68..70 | 第三条已部分闭合（探针接线），但"当时属实"成立 |
| SK-MIG-206 | 自称已核实：§1.5 三件地基现状 | 🔗 **3 中 2 对，G2 已过期** | 见 SK-MIG-71..73 | G2 的「静默恒假」已被修 |
| SK-MIG-207 | 自称已核实：§7.1 十个读取点 | ✅ **十个全在**（行号漂） | 见 SK-MIG-124..133 | 逐条追到函数体 |
| SK-MIG-208 | 自称已核实：§7.2 六个写入方 | ✅ **六个全在** | 见 SK-MIG-134..139 | 逐条追到 `plans.insert` |
| SK-MIG-209 | 自称已核实：`pnpm gates` 当前聚合 **16 条**（`package.json:29`） | ❌ **今日 26 条** | `package.json` `scripts.gates` | 现算 `&&` 分段 = 26 |
| SK-MIG-210 | 自称已核实：`provId` 不可字节稳定的机制链 | ✅ | `apps/agentcore/src/ids.ts:20-23` | `encodeTime(Date.now(),10)+randomPart(16)`，`randomPart` 用 `randomBytes` |
| SK-MIG-211 | 自称已核实：`ruledsl.ts` params 静默恒假机制链 | ❌ **已过期（已修）** | `apps/datacore/src/ruledsl.ts:39/324/419/491` | 见 SK-MIG-181 |
| SK-MIG-212 | 自称已核实：R-B 多租户播种缺口（三处对照） | ✅ **三处全中** | 见 SK-MIG-R-B | 逐处追到 |
| SK-MIG-213 | 自称**未核实**：本文一个测试一个 gate 都没跑，所有"今天是 X"均为静态读码 | ✅ **诚实标注成立** | `docs/PRD-skill-migration.md:540` | 本单补跑了：**这正是本单存在的理由**，实测推翻了其中 3 条 |
| SK-MIG-214 | 自称**未核实**：17/32 是静态推算（5 显式 + 11 CEO 中 10 有槽 → 15 有槽；32−15=17） | ✅ **诚实标注成立** / 推算**结论错** | 见 SK-MIG-59 | 实测 CEO 11 条中 **10 条有槽**（推算这半对），但 catalog 派生 20 条中 **16 条有槽**（推算说"一律 slots:[]"，错）⇒ 27 有槽 / 5 空 |
| SK-MIG-215 | 自称**未核实**：本体 §7 声称已并入 gates 的 6 道门在 `package.json` 无对应 script（sim/propagation/sim-readiness/solver-license/opt-template/opt-determinism） | ✅ **今日复测仍属实，且已被机制接管** | `scripts/gate-ledger.json` | 六道**脚本文件都在**但 `binding` 均非 `GATES_CHAIN`；这正是 `check-gate-ledger.mjs` 治的病（`disposition=WIRE`，`pendingWireCount=12` 棘轮）⇒ 文档说的漂移**属实且已有门在守** |
| SK-MIG-216 | 自称**未核实**：部署库真实数据分布 / 真 DataCore 下 32 条 plan 能否跑通 / Track A-D 落地状态 | ⛔ 本单同样未核 | — | 三项本单也无法核（无部署库访问）；**照实登记，不冒充** |

---

## 2. `PRD-skill-crossreview.md` 逐条（SK-XR-1 … 46，共 46 条）

### 2.1 前言与 §0 并线机械风险（4）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-XR-1 | 本文只记**跨文档冲突/重复/传播性错误/口径分歧**，不复述任一单份 PRD 内容 | ⛔不改不新造 · ✅ | `docs/PRD-skill-crossreview.md:3-5` | 通读全文，确无单份 PRD 内容复述 |
| SK-XR-2 | 纪律：每条结论的 `file:line` 都是**亲手核过的**，核不动的明写"未核" | 🔗 **大体成立，1 处基数已过期** | 同上 :6-8 · :191-194 | 逐条复核见下；§8 结论表的「现有 16 道门」今日 = 26（SK-XR-19） |
| SK-XR-3 | 被审五份 PRD 及其分支/行数登记（contract 643 / compiler 741 / governance 722 / runtime 720 / migration 534） | 🔗 **行数已漂** | 同上 :12-18 | 亲手 `wc -l` 实测：migration **545**（文档写 534）· runtime **725**（写 720）· contract **643** ✅ · compiler **741** ✅ · governance **722** ✅；五条 handoff 分支 `git ls-remote` **全部存在** |
| SK-XR-4 | §0 并线**必须 cherry-pick 单个 PRD commit，不能 merge 分支**（否则删掉 `TEST-PLAYBOOK.md` 205 行） | ✅ **风险已避开** | `docs/TEST-PLAYBOOK.md` | 实测文件在，**205 行**逐字相符 ⇒ 并线时确实没被 merge 删掉 |

### 2.2 C1 · `requires` vs `references[]`/`dependsOn[]`（11）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-XR-5 | contract PRD 主张 `skill.requires.{objectTypes,relations,slices,rules,solvers,tools,mcp,workflows,agents,dependsOn}`，每条带 `required`/`minStatus`/`properties[]` | ⛔本期/❌ | `packages/contracts/src/agentcore.ts:219-225` | 今日只有扁平 `SkillReferenceSchema{kind,key,version,required,role}` —— **有 `required`，无 `minStatus`、无 `properties[]`** |
| SK-XR-6 | migration PRD 主张保留 `references[]`/`dependsOn[]`（自标"这是偏离，请裁决"） | ✅（历史记录属实） | `docs/PRD-skill-migration.md:470` | 该行已改成「裁决结果 + 原提案存档（`<s>` 删除线）」⇒ 收口动作**已做** |
| SK-XR-7 | 核验：`requires` 被 `FeatureDef.requires` 占用属实 | ✅ | `packages/contracts/src/features.ts:15` | `requires: z.array(z.string()).optional()`；追一层消费方 `apps/agentcore/src/features/registry.ts:194` `for (const parent of def.requires ?? [])` ⇒ 活的，不是死字段 |
| SK-XR-8 | 核验：与 `G-SIDEEFFECT-VOCAB-SPLIT` 的类比**不成立**（两个不同对象各有同名字段是常态） | ✅（论证成立） | `packages/contracts/src/features.ts:15` vs `agentcore.ts:236` | 两个 schema 是不同对象，无判定分支交叉 |
| SK-XR-9 | 核验：不构成导出冲突；`ExecutionPlanSchema` 那次是真·同命名空间撞车故改 ComposePlan，先例不适用 | ✅ | `packages/contracts/src/execution-plan.ts:6-7` | 该文件确以 ComposePlan 命名 |
| SK-XR-10 | 核验：扁平 `references[]` **表达不了**「Factory 必须有 capacity 属性」这类契约式需求 | ✅ **今日实测成立** | `packages/contracts/src/agentcore.ts:219-225` | `SkillReferenceSchema` 五个字段里无 `properties[]`/`minStatus` ⇒ 断言属实 |
| SK-XR-11 | 建议：采纳 `requires` 结构 + 旧名降为**解析期归一的输入别名**（读入即折进 requires，运行时一处真源） | ❌ **已裁决未落地** | 见 §3.1 | 无 `requires` 字段、**无归一层**；消费方直读 `s.references`/`s.dependsOn` |
| SK-XR-12 | 建议成立的前提：这样 7 个存量 Skill 与 `skill-lint.ts:212/302`、`resource-projector.ts:334` 无需大爆炸迁移 | ✅（坐标今日仍准） | `apps/agentcore/src/skill-lint.ts:212` 区 · `apps/agentcore/src/dril/resource-projector.ts:333-334` | :333/:334 原文 `for (const ref of s.references ?? []) pushRef(ref,"references")` / `for (const dep of s.dependsOn ?? []) pushRef(dep,"dependsOn")` ⇒ **两个读取点确实并列**，别名方案可行性论证成立 |
| SK-XR-13 | 若仓主选 migration 方案，则 contract §4.5 与 SPEC §7 定案 1 都要改，且必须回答「`properties[]`/`minStatus` 放哪」 | ⛔ 未触发（仓主选了另一支） | `docs/SPEC-industrial-skill.md:415` | 裁决采纳 `requires` ⇒ 本条不触发 |
| SK-XR-14 | §9 收口：**C1 已裁决（仓主 2026-08-03「ok」= 采纳）**，写入 SPEC §9.1 + migration §10.3 改写 | ✅ **文档侧全做了** | `docs/SPEC-industrial-skill.md:415-433` · `docs/PRD-skill-migration.md:470` | 两处逐字核过 |
| SK-XR-15 | §9 收口表把 C1 标 **✅**（隐含"本条已全闭"） | ❌ **宣称做了但其实没做** | `docs/PRD-skill-crossreview.md:202` | **代码零落地**（SK-MIG-184）。这是本单抓到的**头号 ⛔ 违规**：「我用『裁决已写进文档』当作『裁决已落地』的证据，而前者不度量后者」 |

### 2.3 C2 · 引用闭包门两个名字（4）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-XR-16 | contract §0.6-5 提 `skill-refs:check`（`requires` 引用静态可校验 + 运行态发布门） | ⛔ 名未采用 | `scripts/check-ref-closure.mjs` | 落地名是 `ref-closure:check`（**第三个名字**）；`skill-refs:check` 全仓 0 |
| SK-XR-17 | migration §5.2-2 提 `skill-ref-closure:check`（每个 `references[]` 的 key 真已注册） | 🔗 **语义落地，名不同** | 同上 | `pnpm ref-closure:check`（`package.json:35`）+ gates 链第 25 位 |
| SK-XR-18 | 「同一件事两个名字，C1 一裁决这两道门合并成一道」 | ✅ **确实只落地一道** | `scripts/check-ref-closure.mjs` | 全仓只有一道引用闭包门，不存在两道功能重叠的门 ⇒ 预警的第 5 形态假绿**未发生** |
| SK-XR-19 | 不裁决就并线 → 仓里同时出现两道功能重叠的门（假绿温床） | ⛔不改不新造 · ✅ 未发生 | 同上 | 反向断言成立 |

### 2.4 C3 · 门总数 16 → 33 · 合并门账（8）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-XR-20 | 五份 PRD 新提的门去重后 **17 道**（清单逐名列出） | ✅（清单属实）/ ❌（今日 0 道落地） | `docs/PRD-skill-crossreview.md:92-98` | 17 个门名逐个查：**只有 `skill-ref-closure`（改名 `ref-closure`）1 道落地**，其余 16 道全仓 0 |
| SK-XR-21 | 叠加现有 **16 道** = **33 道** | ❌ **基数过期** | `package.json` `scripts.gates` | 实测今日 gates 链 **26 道**；`scripts/check-*.mjs` 文件 **51 个**；`check-skill*` **0 个**。故 33 这个数今天应重算 |
| SK-XR-22 | `ontology-writeback:check` 强制每道门都要登记进本体 §7 | 🔗 **单向，已被上位门补齐** | `scripts/check-ontology-writeback.mjs` · `scripts/check-gate-ledger.mjs:6-9` | 追一层：gate-ledger 门的头注释原文即指出 `check-ontology-writeback.mjs` **只查单向**（进链的门→§7 有登记），**不查反向**（§7 登记了却没接线的门一个都抓不到）⇒ 该缺陷已被 `gate-ledger:check` 接管 |
| SK-XR-23 | 风险：门多不等于治理强；已登记的第 5 形态假绿就是「被制度指定的死门」（红+零接线） | ✅ **风险实测存在且已被量化** | `scripts/gate-ledger-baseline.json` | 实测 `pendingWireCount: 12` —— **12 道"已建未接线"的门**在册（disposition=WIRE）⇒ 预警属实 |
| SK-XR-24 | 建议：任一 PRD 落地前先出**一张合并门账**（谁跑 / 何时跑 / 红了谁修） | ✅ **已落地** | `scripts/gate-ledger.json`（51 条） | 字段逐个核：`binding`（谁跑/何时跑：GATES_CHAIN 26 · GATE_SH 6 · MANUAL 7 · NONE 12）· `escalation`（红了谁修：审核方/仓主）· `guardedPaths`（责任边界）· `ontologyRef` |
| SK-XR-25 | 建议：账里必须有**每道门"曾经真红过"的证据**——没红过的门不算门 | ✅ **已落地（且上了棘轮）** | `scripts/gate-ledger.json` `provenRed` · `scripts/gate-ledger-baseline.json` | 实测 `provenRed.kind` 分布 **MUTATION 16 / NEVER 35**；基线 `neverCount: 35` **只降不升** ⇒ 「没红过的门不算门，但藏起来更糟」这条处置被逐字实现 |
| SK-XR-26 | **这张账目前无人认领** | ❌ **已过期（有人认领并做完了）** | `scripts/check-gate-ledger.mjs` | 亲手跑 RC=0，输出「门脚本普查（现算）：GATES_CHAIN 26 · GATE_SH 6 · CI_ONLY 0 · MANUAL 7 · NONE 12 · 合计 51 / 门账条目 51 / provenRed 从未红过 35（基线 35）」。门在 `pnpm gates` 链**第 26 位**（末位） |
| SK-XR-27 | §9 收口：C3 标 **🟡 仍无人认领**，且「**任一份 PRD 落地前必须先有这张账**」 | ❌ **收口表过期** | `docs/PRD-skill-crossreview.md:204` | 见 SK-XR-24..26。**这条阻塞已解除**——它不再是"五份 PRD 任一落地"的前置。**真实剩余缺口另有三条**：① `provenRed=NEVER` 35/51（68% 的门从未红过）② `pendingWireCount=12` 已建未接线 ③ **账里 skill 门 0 条**（17 道新门一道没建） |

### 2.5 C4 · 传播性错误「引用可校验门今天做不了」（5）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-XR-28 | 核验：`skill-lint` 只校验 `kind=skill` 的引用 —— **属实** | ✅ **今日仍属实** | `apps/agentcore/src/skill-lint.ts:218` | `if (ref.kind !== "skill") continue;` 逐字在（文档写 :165/:177，已漂到 :218） |
| SK-XR-29 | 核验：「所以这道门今天做不了」**不成立** —— `probeMissingRefs` 已能校验非 skill 引用且已接线两处 | ✅ **判断正确** | `apps/agentcore/src/resources.ts:64` · `server.ts:694`（agent）· `:1012`（workflow） | 两处调用今日仍在，逐条追到 handler 内 |
| SK-XR-30 | 核验：真实缺口只有两条 —— ① skill 发布路没接 ② `probeMissingRefs` 自身 fail-open | ✅ **两条都已关闭** | `apps/agentcore/src/server.ts:1272` · `apps/agentcore/src/resources.ts:22-31,36-45` | ①：`probeMissingRefs(deps.dataCore, a, {solverKeys, ruleKeys, objectTypes})` 已接进 skill 发布路；②：`probeUnavailable()` 把「注册表抛错」**与**「注册表返空集」双双改成 503 fail-closed |
| SK-XR-31 | 「它把工作量从『接一条已有的线 + 关掉 fail-open』错报成『从零造一道门』，会让排期与风险判断整体偏移」 | ✅ **口径被后续实施证实** | `apps/agentcore/src/skill-lint.ts:203-217` | 源码注释自承：该处旧注释「由发布时探针保证」在 2026-08-09 前是**谎报**，WO-SKILL-REFCLOSURE-A 接线后**这句话才成立** ⇒ 工作量确实是"接线"级 |
| SK-XR-32 | §9 收口：C4 三处已掐掉（SPEC 两处 + migration §5.2 改为「接线不是造门」） | ✅ **三处逐字核过** | `docs/SPEC-industrial-skill.md` §2-⑫/§4 · `docs/PRD-skill-migration.md:230-236` | migration :230 原文「⚠️ 原稿写「这道门今天做不了」，经审核方逐条核对后更正」 |

### 2.6 C5 · 「Phase 2」三义（6）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-XR-33 | migration §3 的 Phase 2 = 权威翻转 | ✅（历史记录属实） | `docs/PRD-skill-migration.md:197` | 现已改称 M2 |
| SK-XR-34 | runtime §7.1 的 Phase 2 = 正则门降白名单 | ✅ | `docs/PRD-skill-runtime-orchestrator.md` | 现已改称 R2 |
| SK-XR-35 | runtime §3.6/§2 的 Phase 2 = 图运行态跨请求持久化 + `human` 节点 resume | ✅ | 同上 | 现已改称 T2 |
| SK-XR-36 | 「这不是文风问题」——两半各自用一套词没人对接是本仓所有反复炸的坑的共同形状 | ⛔ 论证 | `docs/PRD-skill-crossreview.md:143-144` | 与本体已登记的 `G-SIDEEFFECT-VOCAB-SPLIT` 同族，论证成立 |
| SK-XR-37 | 建议：三条线各加前缀全文替换（M0–M3 / R0–R4 / T1–T2） | ✅ **已执行** | `docs/PRD-skill-migration.md:183-185` | 命名空间图例逐字在；migration 全文 M0–M3 命中 67 处、runtime R/T 前缀均在 |
| SK-XR-38 | §9 收口：C5 标 ✅「两份 PRD 均已全文替换，**残留裸「Phase N」= 0**（机械核过）」 | 🔗 **两份 PRD 属实，但断言范围外仍有残留** | `docs/PRD-skill-migration.md`（0 处）· `docs/SPEC-industrial-skill.md:111,255` | 实测：两份 PRD 确为 0 ✅；但**同批一起改的 `SPEC-industrial-skill.md` 仍有 2 处裸 Phase**（`:111`「Track A Phase 4」·`:255`「Phase 0 的自动导出」）。收口表的 ✅ 只在它自己划定的范围内成立 —— 读者极易读成"全仓已净" |

### 2.7 C6 · 已声明的口径差异（3）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-XR-39 | 决策点计数两口径（runtime 13+1 vs WO 10 道正则门）不矛盾，但**本体里只写了「10 道」** | ✅ **今日实测仍如此** | `docs/SYSTEM-ONTOLOGY.md:1066` `G-ROUTE-REGEX-PREEMPTS-RETRIEVAL` | 原文「全链上共有 **10 道这类正则门**排在第 11 站分类器之前」；全文搜「13 个可返回决策点 / 14」= **0 命中**（唯一「决策点」命中在 `:1074` 是 τ 决策点，另一回事） |
| SK-XR-40 | 建议：本体里把两个口径**一并写明**，否则迟早冒出第三个数 | ❌ **未做** | 同上 | 见上，仍是单口径 |
| SK-XR-41 | E9「旁白一条不发」是 `518e46b1` 之前的基线；现存缺口收窄为角色/场景 agent 无旁白 + 无结构化进度 + 前端 reducer 丢 `role/roleLabel` | ⛔ 本单未核（跨 Track C） | — | 本单范围外，**照实登记不冒充**（`emitsNarration` 字段侧为 0 已在 SK-MIG-161 记） |

### 2.8 §7 一致性检查（五份**没有**冲突的地方）（5）

> 这五条是**反向断言**：「记录下来免得下轮重查」。做了反而是缺陷 —— 判据是「今天是否仍无冲突」。

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-XR-42 | 「Skill 吞并 ExecutionPlan」五份口径一致 | ⛔不改不新造 · 🔗 **今日出现新分歧** | `packages/contracts/src/skill-graph.ts:384` | 吞并方向仍一致；但**吞进来的字段形态三份三说**（`plan[]` / `graph` / `steps`），已实现的 `SkillExecutionSchema{steps?,graph?,mode?}` 是三者并集 ⇒ 这是 `CHECKLIST-skill-4209.md` §2.5 抓到的、**XR 的 C1–C6 漏掉的第七条冲突** |
| SK-XR-43 | 命名禁外部产品名：compiler §3.1 已把 SDK 规格里的 `dos skill …` 改为 `platform skill …`，复用既有 `scripts/platform-cli.mjs` 不新起二进制 | ✅ | `scripts/platform-cli.mjs` | 脚本存在；`docs/prd-ontology-index.json` 里 crossreview 条目的 `artifacts` 也列了它（`brokenArtifacts: []` ⇒ 三个引用路径全部真实存在） |
| SK-XR-44 | 禁止手抄枚举：compiler 红线 3 与 governance「不许出现第二个判定出口」、runtime「Skill 只能收紧不能放宽」同向无冲突 | ⛔不改不新造 · ✅ | `packages/contracts/src/agentcore.ts:208-217` | 反向断言成立且**已被机制固化**：`SKILL_REFERENCE_KINDS`/`SKILL_REFERENCE_ROLES` 导出成具名数组供消费方 import，注释原文即讲了 skill-lint 手抄一份 `VALID_REF_KINDS` 的旧病 |
| SK-XR-45 | Skill 预算只能收紧（runtime §4.3）与 governance 权限三面「一处判定」互补不重叠；`execution.steps` 复用既有 `PlanStepSchema` 是单一来源不是重名 | ⛔不改不新造 · 🔗 | `apps/agentcore/src/server.ts:1352` | 「复用 PlanStepSchema」口径**已被实现遵守**（注释原文「语义校验由 `GraphScheduler` 调 `validatePlanSteps` 完成（裁决 v3 约束①：单一来源在函数不在类型）」）；但「预算只能收紧」今天**无处生效**——`maxBudgetRounds` 零消费方 |

### 2.9 §9 末尾自记的一条（1）

| 编号 | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| SK-XR-46 | 本文自身被 `check-prd-ontology.mjs` 索引为 `hasOntologyRef:false`；门不红但 `docs/prd-ontology-index.json` 每次 gate 重写，需随提交同步否则工作区永远脏 | ✅ **两半都今日实测属实** | `docs/prd-ontology-index.json` | 实测索引里 `docs/PRD-skill-crossreview.md` 条目 = `{hasOntologyRef:false, invariants:[], breakpoints:[], artifacts:[3 条], brokenArtifacts:[]}`；索引共 **129** 份 PRD。且 `git status --porcelain` 今日为空 ⇒ 索引**已随提交同步**，"工作区永远脏"这条**已被处置** |

---

## 3. 🔴 派单点名要核的三处 —— 实测结论

### 3.1 C1：**「已裁决未落地」—— 审核方没有判错，不需要撤回结论**

> 派单原话：「请复核：是我漏看了（比如它叫别的名字 / 在别的文件），还是确实只改了文档没改代码？」
> **答：不是漏看。确实只改了文档没改代码。而且比"没改代码"更精确的定性是：连别名归一层都没有。**

**证据一 · 字段级逐个点名**（`packages/contracts/src/agentcore.ts:236-261`，18 个字段）

```
id · tenantId · key · version · name · summary · body · resources · status
capability · sideEffect · inputSchema · outputSchema · references · dependsOn
approvalGate · provenancePolicy · maxBudgetRounds
```
**无 `requires`。** 也无 `requires` 的任何变体（`requirements` / `needs` / `contract` 均 0 命中）。

**证据二 · 排除「它叫别的名字 / 在别的文件」**（派单专门提醒别只 grep `requires`，会撞 `FeatureDef`）

全仓 `apps/*/src packages/*/src` 的 `requires` 命中**逐条分类**，无一在 skill 语境：

| 命中处 | 属于谁 | 判定 |
|---|---|---|
| `packages/contracts/src/features.ts:15` | `FeatureDef.requires`（entitlement 依赖级联） | 撞名，非 skill |
| `apps/agentcore/src/features/registry.ts:60-83, 194` | 同上（`for (const parent of def.requires ?? [])`） | 撞名，非 skill |
| `apps/datacore/src/features.ts:30-75` | 同上 | 撞名，非 skill |
| `apps/datacore/src/synthetic/view-manifest.ts:43-125` | 同上（视图 featureKey 级联） | 撞名，非 skill |
| `packages/contracts/src/intelligence-resource.ts:75/137` | `requiresSidecar`（**另一个词**） | 不是 `requires` |

**证据三 · 再追一层：连"解析期归一别名"都不存在**（这是 SPEC §9.1 落地口径的核心）

裁决的落地形状是「`references[]`/`dependsOn[]` **读入即归一折进 `requires`**，不作为运行时字段存在」。
实测：**没有任何归一函数**。两个消费方**直接读原字段**：

```
apps/agentcore/src/skill-lint.ts:343   v.push(...validateReferenceList(skill.references, "references"));
apps/agentcore/src/skill-lint.ts:347   v.push(...validateRefResolution(skill.references, "references", ctx.allSkills, false));
apps/agentcore/src/dril/resource-projector.ts:333  for (const ref of s.references ?? []) pushRef(ref, "references");
apps/agentcore/src/dril/resource-projector.ts:334  for (const dep of s.dependsOn ?? []) pushRef(dep, "dependsOn");
```

⇒ 三分法定性：**不是「接了线没数据」，也不是「接了线接错地方」，而是「这条线根本没画」** ——
`requires` 这个运行时真源**不存在**，别名层也**不存在**，`references`/`dependsOn` 今天**就是真源本身**。

**证据四 · 承接单不存在**

`git ls-remote --heads origin` 有 13 条 skill 相关 handoff 分支，**无一条是 `WO-SKILL-MIG-G3`**
（命名定案回写）。裁决 2026-08-03 下达，至今 **6 天零派单**。

**⇒ 对审核方那条结论的处置建议**

| 该改的 | 不该改的 |
|---|---|
| `PRD-skill-crossreview.md:202`（§9 收口表 C1 行）的 **✅ 应改为 🟡「文档已收口 · 代码未落地（WO-SKILL-MIG-G3 未派）」** | 审核方"实测 18 个字段没有 `requires`"这条**判断本身正确**，无需撤回 |
| `docs/SPEC-industrial-skill.md:415` §9.1 建议加一行「落地状态：未落地（截至 2026-08-09）」 | — |

**这条的形态**（照铁律 0.6 句式）：
> **「我用『裁决已写进 SPEC §9.1』当作『裁决已落地』的证据，而前者并不度量后者。」**

---

### 3.2 迁移进度：**M0 影子声明零开工**（实测，非照文档抄）

**亲手跑法**：在 `apps/agentcore/test/` 临时写一条探针测试，`npx vitest run` 真跑
`seedIntentsAndPlans("demo")` 与 `seedRegistry()`，取完数**已删该文件**（`git status --porcelain` 空）。

| 量 | 实测值 | PRD 说的 | 判 |
|---|---:|---:|---|
| 意图 | **32** | 32 | ✅ |
| ExecutionPlan | **32** | 32 | ✅ |
| Skill | **7** | 7 | ✅ |
| **skill.key ∈ intent.key 的条数** | **0** | 目标 32 | ⇒ **M0 一份影子都没生成** |
| skill 带 `execution` 字段 | **0/7** | — | ⇒ 目标形态未落 |
| skill 带 `businessIntent` | **0/7** | — | ⇒ 目标形态未落 |
| skill 带 `requires` | **0/7** | 裁决要求 | ⇒ §3.1 |
| `dependsOn` 非空 | **0/7** | PRD 说 7/7 空 | ✅ 复测属实 |
| `references` 非空 | **6/7** | （PRD 未提） | ⚠️ **与 `dependsOn` 不是一回事，不许合成一句** |
| `maxBudgetRounds` 已填 | **0/7** | PRD 说 7/7 空 | ✅ 复测属实 |
| `resources` 非空 | **0/7** | PRD 说 7/7 空 | ✅ 复测属实 |
| `outputSchema` 已填 | **7/7** | PRD 说「有值但零校验消费方」 | ✅ 复测属实 |
| 场景卡 / 场景入口 | **20 / 9** | 20 / 9 | ✅ |

**顺手推翻 PRD 一处未核实的推算**（PRD §13 自标该数为"静态推算，未跑 `seedIntentsAndPlans()` 实测"）：

> §1.2 边界 1 说「**17/32** `inputSchema` 是空壳；`SCENARIO_CATALOG` 派生的 16 条意图**一律 `slots: []`**」

**实测：空槽意图只有 5 条** —— `plan_recommend` · `inventory_opt` · `maint_stagger` · `sop_status` · `ceo_finance_pnl`。
`SCENARIO_CATALOG` 派生的 20 条里 **16 条有槽**（不是"一律为空"）；CEO 11 条里 10 条有槽（这半推算对）。
⇒ **27/32 有槽 · 5/32 空槽**。R-F 的风险方向对，量级错 3 倍以上；M0 导出器的 `x-derived:"empty-slots"` 打标面积应按 5 而非 17 排。

**M1/M2/M3 同样零开工**（逐个符号追过）：`resolveSkillForIntent` 0 · `canonicalizeAnswer` 0 ·
`skill-plan-parity` 0 · flag `qos.skill-execution-authority` 0 · `repos.plans.insert(` 生产侧仍 **4 处**未收口 ·
六个 Plan 写入方**全在** · 前端三处 plan 面**全在**。

---

### 3.3 C3「33 道门合并门账·无人认领·阻塞五份 PRD」：**账已立、门已接、阻塞已解除**

**实测三个数**

| 问的 | 实测 | 命令 |
|---|---:|---|
| `pnpm gates` 今天几道门 | **26** | 现算 `package.json` `scripts.gates` 的 `&&` 分段 |
| `scripts/` 下几个 `check-*.mjs` | **51** | `ls scripts/check-*.mjs \| wc -l` |
| 有没有 `check-skill*` | **0 个** | `ls scripts/ \| grep -i skill` → 空 |

⇒ XR 里「现有 16 道」「叠加 = 33 道」**两个数今天都作废**：底数已从 16 涨到 26，而 17 道新门**一道都没建**。

**但 C3 要的那张账已经存在，且比 XR 要求的更完整**

| C3 要的 | 落地物 | 实测 |
|---|---|---|
| 谁跑 / 何时跑 | `scripts/gate-ledger.json` 的 `binding` | GATES_CHAIN **26** · GATE_SH **6** · MANUAL **7** · NONE **12** · CI_ONLY 0 · 合计 **51** |
| 红了谁修 | 同文件 `escalation` | 枚举限定 `{审核方, 仓主}`，门判据④强制非空 |
| **每道门"曾真红过"的证据** | 同文件 `provenRed{kind, evidence, note}` | **MUTATION 16 / NEVER 35** |
| 「没红过的门不算门」的处置 | `scripts/gate-ledger-baseline.json` | `neverCount: 35` **棘轮只降不升**；`pendingWireCount: 12`（已建未接线）同样棘轮 |
| 账本身不许脱节 | `scripts/check-gate-ledger.mjs`（**在 gates 链第 26 位**） | 四条判据：无遗漏 / 无幽灵 / **binding 与现算普查一致（现算，不许固化自证）** / 责任边界可解析 |

**亲手跑**（`node scripts/check-gate-ledger.mjs`，RC=0）原文：
```
· 门脚本普查（现算）：GATES_CHAIN 26 · GATE_SH 6 · CI_ONLY 0 · MANUAL 7 · NONE 12 · 合计 51
· 门账条目：51 · provenRed 从未红过：35（基线 35）
✓ gate-ledger:check 通过（账无遗漏/无幽灵 · binding 与现算一致 · 责任边界均可解析）
```

**⇒ 结论：XR §9 收口表 C3 的「🟡 仍无人认领 / 任一份 PRD 落地前必须先有这张账」已过期，阻塞解除。**
但**别把这条读成"C3 全好了"** —— 实测剩下三个真缺口：

1. **35/51（68%）的门 `provenRed = NEVER`** —— 按 XR 自己的判据「没红过的门不算门」，
   今天**三分之二的门不算门**。棘轮只保证不再新增，不负责烧掉存量。
2. **12 道 `disposition = WIRE`** —— 已建、本体 §7 宣称受治理、**现算零调用**（第 5 形态假绿的存量）。
3. **账里 skill 门 0 条** —— 17 道新门一道没建，所以"33 道门的合并账"这件事**本身没发生过**；
   现有的账管的是**既有 51 道**。C3 真正被解决的是"账的机制"，不是"33 道门这张具体的账"。

---

## 4. 五档计数

**总计 270 条**（MIG **224** · XR **46**）。

> ⚠️ **与派单口径 229（186+43）的差异说明（不掩饰）**：本单按派单要求**自己重做提取**，
> 得 224/46 而非 186/43。差异是**粒度差不是漏项** —— 我把 §0 的 12 条不变量、§7.1 的 10 个读取点、
> §12.2 的 5 条金值、§13 的 13 条诚实边界都拆成了独立可判真假的句子；前次提取多半合并了其中一些。
> **覆盖是全的**：两份文档的每一节、每张表的每一行都进了上表，编号 `SK-MIG-1…216`（连续无缺号无重号）
> + 8 条风险（`R-A…R-H`）、`SK-XR-1…46`（连续无缺号无重号）——**已用脚本机械校验**。

| 档 | MIG | XR | 合计 | 说明 |
|---|---:|---:|---:|---|
| ✅ **实体层真满足** | 77 | 25 | **102** | 大头是 §1 AS-IS 与 §7.1/§7.2 清单的**事实断言复测属实** |
| 🔗 **有实现·接线不全** | 12 | 5 | **17** | 形态④：承载物在、消费方在，但挂错位置或只覆盖一半 |
| ⚠️ **只有 test 引用** | 1 | 0 | **1** | SK-MIG-97（多租户维风险：单租户测试测不出来） |
| ❌ **无承载物 / 与实测不符** | 15 | 6 | **21** | 见 §5 清单 |
| ⛔ **自标非目标** | 119 | 10 | **129** | 三分见下 |

**⛔ 129 条的三分**

| 分档 | 条数 | 判据 | 处置 |
|---|---:|---|---|
| **本期不做**（PRD 自标"零代码改动，实施由后续 WO 承接"） | **108** | M0–M3 的实现类条目 | 「没做」**不是缺口**；只有别处宣称做了才是（见 §5） |
| **不改不新造**（反向断言：做了反而是缺陷） | **16** | 如「PlanStep 判别联合保留不动」「不新增事件名」「执行器一行不动」 | **今日全部未被违反** ✅ |
| **绝对不做 / 未触发 / 本单未核** | **5** | 如 §9.4 改推荐条件（口径已裁定为内部元数据）、E9 旁白（跨 Track C 本单未核） | 照实登记 |

> **⛔ 里另有 95 条带 `/❌` 副标** —— 意思是「PRD 自己说本期不做」**且**「今天承载物确实为 0」。
> 这两件事必须分开记：前者是**定位**，后者是**实测**。合成一个绿勾就是本仓治了一整天的那个病。

---

## 5. ⛔ 里「宣称做了但其实没做」清单（本单头号交付）

> 判据：**PRD 自标本期不做 → 没做不是缺口。但如果别的文档/收口表宣称它做了，那就是真缺口。**
> 逐条给了「谁宣称的 file:line」与「实测反证」。

| # | 宣称做了的地方 | 宣称内容 | 实测反证 | 严重度 |
|---|---|---|---|---|
| **1** | `docs/PRD-skill-crossreview.md:202` §9 收口表 **C1 行标 ✅** | 「已裁决 · 采纳 `requires` 结构 · 旧名降为解析期输入别名 · 写入 SPEC §9.1」——收口表的 ✅ 在同表语境里读作「本条已全闭」 | `SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:236-261`）18 字段**无 `requires`**；**无归一层**；消费方 `skill-lint.ts:343/347` + `resource-projector.ts:333/334` 直读原字段；**WO-SKILL-MIG-G3 未派单** | 🔴 **最高** |
| **2** | `docs/PRD-skill-crossreview.md:206` §9 收口表 **C5 行标 ✅** | 「两份 PRD 均已全文替换且插入命名空间图例，**残留裸「Phase N」= 0**（机械核过）」 | 两份 PRD 确为 0 ✅，**但同批一起改的 `docs/SPEC-industrial-skill.md` 仍有 2 处**：`:111`「Track A **Phase 4**」· `:255`「**Phase 0** 的自动导出」。「机械核过」的扫描范围**小于**读者会理解的范围 | 🟠 中 |
| **3** | `docs/SYSTEM-ONTOLOGY.md` §7 | 声称 `sim:check`/`propagation:check`/`sim-readiness:check`/`solver-license:check`/`opt-template:check`/`opt-determinism:check` **"已并入 `pnpm gates`"** | 六道**脚本文件都在**，但 `gate-ledger.json` 里 `binding` 均**非 GATES_CHAIN** ⇒ 不在链内。MIG §13 早已把这条标为「未核实的漂移」，本单**确认漂移属实**；已被 `gate-ledger:check` 的 `pendingWireCount:12` 棘轮接管 | 🟠 中（**已有门在守**） |
| **4** | `docs/PRD-skill-migration.md:145` §1.4 | 「`references` 的非-skill 引用**不校验存在性**」——今天读会被理解成"这块还没人管" | **已部分闭合**：`server.ts:1272` skill 发布路已接 `probeMissingRefs`，solver/rule/ontologyType 三种 kind 已守。**但反向也有一条**：`skill-lint.ts:203-217` 的注释自承 `constraint`/`slice`/`workflow`/`agent` **四种 kind 今天仍无人校验** ⇒ 谁也别把这段读成"所有非 skill 引用都有人管" | 🟡 低（文档滞后） |
| **5** | `docs/PRD-skill-migration.md:152` §1.5 G2 | 「`expression` **不能引用 `params`**，且**静默恒假不报错**」；§10.2 据此把「补 operand kind」列为待办 | **已被 `WO-RULE-EXPR-PARAMS` 修掉**：`ruledsl.ts:39` 已有 `{kind:"param"}`，`:324` 解析 / `:419` 收集 / `:491` 求值三层全接，未声明即 **`throw DslError`**；C18 活样本已改用 `ruleParamRef("cashFloor")`。**但 §10.2 的"真交付物"（解析期门）只做了一半** —— `kind:"field"` 拼错仍静默恒假（`resolveField:450` 带前缀回退） | 🟡 低（**方向反了：是文档低估了进展**） |
| **6** | `docs/PRD-skill-crossreview.md:204` §9 收口表 **C3 行标 🟡「仍无人认领」** | 「合并门账尚未立单。**任一份 PRD 落地前必须先有这张账**」 | **账已立、门已接、棘轮已上**（`scripts/gate-ledger.json` 51 条 + `check-gate-ledger.mjs` 在 gates 链末位 + `gate-ledger-baseline.json`）。亲手跑 RC=0。**这是反向的"宣称"** —— 宣称没做，实际做了，同样会误导排期 | 🟡 低（**方向反了**） |

**另附：不是"宣称做了"但同样会误导排期的 6 处基数漂移**（全部实测订正）

| # | 出处 | 文档说 | 实测 |
|---|---|---|---|
| a | MIG §0 / §12.2 / §13 · XR §3 | `pnpm gates` = **16** 道 | **26** 道 |
| b | MIG §0 / §12.2 | 迁移后聚合 16 → **23** | 应为 26 → 33 |
| c | XR §3 | 现有 16 + 新 17 = **33** | 现有 26 + 新 **0** = 26 |
| d | MIG §1.2 / §5.3 / R-F | `inputSchema` 空壳 **17/32** | **5/32** |
| e | MIG §0 CLI 段 | `OPERATION_CATALOG` **17 条**、`plan` 命中 **0** | **39 条**、`plan` 命中 **1**（`op:"build"` 的 BuildPlan，非 ExecutionPlan ⇒ **结论仍成立**） |
| f | XR §表 | migration PRD **534** 行 · runtime **720** 行 | `wc -l` 实测 migration **545** · runtime **725**（其余三份 643/741/722 全对） |

---

## 6. 金丝雀证据（报否定结论前的工具自证）

> 铁律 0.6 机制：**任何 `grep`/解析器/计数在报"0 命中 / 不存在 / 零调用方"之前，必须先跑一个已知必中的样例。**
> 金丝雀不中 ⇒ 报「工具坏了」，**不许**报「代码干净」。本单所有 ❌ 都配了下表某一条。

| # | 我要报的否定结论 | 用的命令形状 | 金丝雀（已知必中） | 金丝雀结果 | 故否定结论可信 |
|---|---|---|---|---|---|
| K1 | `SkillDefinitionSchema` **无 `requires`** | `grep -rn "requires" packages/contracts/src/*.ts` | 同命令找 `SkillDefinitionSchema` | **3 命中**（`agentcore.ts:183/236/262`） | ✅ 工具正常 ⇒ `requires` 只在 `features.ts:15` 与 `requiresSidecar`，skill 语境 0 |
| K2 | `antiExamples`/`exclusivity`/`emitsNarration`/`goldenCases`/`canonicalizeAnswer`/`resolveSkillForIntent`/`skill-export`/`qos.skill-execution-authority`/`boundSkillRef`/`SKILL_NOT_FOUND` **全仓 0** | `grep -rn <sym> apps/*/src packages/*/src` | 同命令形状找 `sideEffect` | **69 命中** | ✅ 该 glob **跨得了 `/`**（对照 CLAUDE.md 记的 `git grep -- "apps/*/src"` 恒 0 那个坑：本单用的是 **shell glob 传给 `grep -r`**，不是 git pathspec，行为不同且已自证） |
| K3 | 本体里 `G-SKILL-PLAN-DUAL-AUTHORITY` / `G-SKILL-TENANT-SEED-ASYMMETRY` **各 0 条** | `grep -c <ID> docs/SYSTEM-ONTOLOGY.md` | 同命令找 `G-4` | **2 命中** | ✅ 工具正常 ⇒ 两条新断点确未登记 |
| K4 | `scripts/` 下 **无 `check-skill*`** | `ls scripts/ \| grep -i skill` | `ls scripts/check-ref-closure.mjs` | **文件存在** | ✅ 目录可读 ⇒ 0 个 skill 门是真的 |
| K5 | `maxBudgetRounds` **零生产消费方** | `grep -rn maxBudgetRounds apps/*/src packages/*/src` | 同上 K2 的 `sideEffect` 69 命中 | ✅ | ⇒ 仅 1 处契约定义，零读取方。**并已再追一层**：`new BudgetTracker(...)` 3 处入参全走 `residualBudgetFromConfig()`（只读 env），skill 声明**不在优先级链上** |
| K6 | 门/账类数字（26 / 51 / 12 / 35） | **不用 grep，直接跑** | `node scripts/check-gate-ledger.mjs` 自带**现算普查**（判据③明令不许固化自证） | RC=0，输出即普查数 | ✅ 数字来自门自己现算，非我数的 |
| K7 | seed 基数（32/32/7/20/9/5 空槽） | **不用 grep，真跑** | `npx vitest run` 一条临时探针测试，真调 `seedIntentsAndPlans("demo")` | 1 passed | ✅ 运行时实测，非静态推算（**这正是推翻 17/32 那条的手段**） |

**一处金丝雀救了我的实例**：中途我曾用「`grep sideEffect apps/agentcore/src/skill-lint.ts` 应有命中」当金丝雀，
结果 **0 命中** —— 差点据此报「工具坏了」。回查发现是**我选的金丝雀本身错了**（`skill-lint.ts` 里确实没有
`sideEffect` 这个词），换成 `grep -rl sideEffect apps/agentcore/src` 得 8 个文件、`apps/*/src packages/*/src` 得 69 命中，
工具正常。**记账**：金丝雀必须选**已证实存在**的样例，不能选"我以为存在"的 —— 否则金丝雀自己会制造假警报。

---

## 7. 本单的诚实边界

1. **没跑四包 gate**（`pnpm -r build && pnpm -r test`）。派单是「只做复验取证，不要修代码」，
   且四包 vitest 属重画像（CLAUDE.md 铁律 2 表）。只跑了：`@platform/contracts` build ·
   `@platform/llm-adapters` build · `node scripts/check-ref-closure.mjs`（RC=0）·
   `node scripts/check-gate-ledger.mjs`（RC=0）· 一条临时 vitest 探针（已删）。
   ⇒ **本文没有断言"仓库是绿的"**。
2. **没跑部署态 / 真 DataCore**。所有"今天是 X"是 **canonical 分支上的源码 + 内存态 seed 实测**，
   不是部署库实测。MIG §13 未核实的三条（部署库数据分布 / 真 DataCore 下 32 条 plan 能否跑通 /
   Track A–D 落地状态）**本单同样未核**（SK-MIG-216 已登记）。
3. **未并分支上的东西一律记作未落地**。`compiler-s1` / `partial-a` 等未并分支上可能已有实现
   （如 `maxBudgetRounds`，见 `CHECKLIST-skill-4209.md:65`），本表按 canonical 判 —— 因为用户用的是 canonical。
4. **行号漂移我只标不改**。12 条「✅存在/❌坐标漂」意思是**承载物在、file:line 已过期**；
   我给了今日坐标，但**没有回写两份 PRD**（派单：不要修代码，我理解为也不擅自改 PRD 正文）。
5. **XR §6-2（E9 旁白现存缺口）本单未核**（跨 Track C，`SK-XR-41` 已标）。**「我没核」不是「它不存在」。**
6. **本文只判 MIG + XR 两份 229/270 条**。`CHECKLIST-skill-4209.md` 记的另外 6 份文档
   （SPEC 183 / AUT 63 / DSL 215 / CMP 240 / RT 214 / GOV 221 ≈ 1136 条）**不在本单范围**。

---

## 8. 建议的下一步（按性价比）

| 序 | 动作 | 覆盖条数 | 依据 |
|---|---|---|---|
| 1 | **派 WO-SKILL-MIG-G3 落地 `requires` 裁决** —— 契约加字段 + 写解析期归一别名层 + 两处消费方改读归一后的真源 | SK-MIG-184 · SK-XR-5/10/11/15 · SPEC §7 定案 1 的 `properties[]` 语义 | 裁决 2026-08-03 已下，**6 天零派单**；且它是 M0 的硬前置（名字定错 = 32 份返工） |
| 2 | **改 XR §9 收口表三行**：C1 ✅→🟡（文档已收口/代码未落地）· C3 🟡→✅（账已立，另记三条剩余缺口）· C5 ✅ 加脚注（SPEC 仍有 2 处裸 Phase） | SK-XR-15/27/38 | 收口表今天在**两个方向上**都在误导排期 |
| 3 | **订正 MIG 六处基数**（gates 16→26 · 23→33 · inputSchema 17→5 · OPERATION_CATALOG 17→39 · G2 已修 · 行数） | SK-MIG-29/41/57/59/72/179/193/209/211 + R-F | 这些数今天全部进不了任何门，靠人读，读一次错一次 |
| 4 | **burn down `provenRed=NEVER` 35 道 与 `disposition=WIRE` 12 道** | SK-XR-23/25/27 | 按 XR 自己的判据，今天 **68% 的门不算门**；棘轮只防新增不烧存量 |
| 5 | 把 C6 的两种决策点口径（13+1 vs 10）一并写进本体 §8 | SK-XR-39/40 | XR 自己预言的"迟早冒出第三个数" |
| 6 | 补 `SKILL_REFERENCE_KINDS` 的 `tool`/`mcp`（今天是**声明不了**不是不声明） | SK-MIG-80/84 · SPEC 第⑦层 | 目标形态 §2 明确要这两类引用 |
