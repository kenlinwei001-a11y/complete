# 逐条勾选 · `PRD-skill-contract-dsl.md`(215) + `PRD-skill-compiler-registry.md`(240) = 455 条

> 2026-08-09 · 复验 agent（审核方派出）· **只读取证，未改一行代码**
>
> **基线**：canonical `claude/inspiring-gates-aqczjg` @ `f392ae00`（`git fetch` 后 `git pull` 已是最新）。
> 已收编 Skill 分支 **3/5**：`orchestrator-s1` · `refclosure-a` · `partial-b`；
> **`compiler-s1` / `partial-a` 未并**（`git merge-base --is-ancestor` 实测两支均 `NOT MERGED`）。
> 未并分支的内容在下表标 **[未并]**，并**分开标注**「并入后会满足」与「并了也不满足」。
>
> **环境前置（已跑）**：`pnpm install --prefer-offline` → `pnpm --filter @platform/contracts build`
> → `pnpm --filter @platform/llm-adapters build` → `pnpm --filter agentcore build`（`dist` 曾落后源码 3 天，
> 直接跑旧 `dist` 会得到过期计数——见 §末「金丝雀证据」#4）。

---

## 0. 判定口径（四档 + ⛔ · 不许合并成一个绿勾）

| 档 | 含义 | 判据 |
|---|---|---|
| ✅ | **实体层真满足** | 承载物在**该在的对象上** + 有生产消费方；已追一层调用看到真触发条件 |
| 🔗 | **有实现·接线不全** | 代码在、被调用，但挂错位置 / 只覆盖部分路径 |
| ⚠️ | **只有 test 引用** | 实现有、测试绿，**零生产调用方** = 已排练不是已实现 |
| ❌ | **无承载物** | 契约/代码里根本没有（**报 0 前已跑金丝雀**） |
| ⛔ | **文档自标非目标** | 三分：**绝对不做**（不算缺口）/ **本期不做**（「没做」不是缺口，**「宣称做了」才是**）/ **不改不新造**（反向断言：**做了反而是缺陷**） |

---

## 1. 三处特别风险 · 实测结论（§3 命题，先摆结论）

### 1.1 `execution` 字段三份文档三种形态 —— **按 DSL 判「不过」，按 CMP 判「不过」，两者不过的理由还不同**

**实现现状（canonical）**：`SkillExecutionSchema` 在 `packages/contracts/src/skill-graph.ts:384-397`，形状 =
`{ steps?: SkillExecutionStep[], graph?: SkillGraph, mode?: "DETERMINISTIC"|"AGENTIC" }`，`.strict()`。

**唯一生产消费方**：`apps/agentcore/src/server.ts:1346` —— 它是 `POST /b/v1/skill-graphs/run` 的**请求体字段**
（`SkillGraphRunBody`），调用方必须**把执行图当参数传进来**。

**追一层调用后的定性**：
`SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:236-261`，共 18 个字段）**没有 `execution` 字段**。
实测 `seedRegistry("demo").skills.filter(s => s.execution != null).length === 0`（7 个出厂 skill 全无）。
⇒ **一个存下来的 Skill 带不走自己的执行声明**。这是「**接了线没数据**」，不是「已实现」。
（`packages/contracts/src/skill-graph.ts:348-352` 该文件作者本人已把这条边界写在注释里，措辞与本结论一致。）

| 按谁的验收判 | 逐条比对 | 结论 |
|---|---|---|
| **DSL §4.4** | ① `mode` **必填**（声明 execution 即必填）→ 实现 `mode` 是 `optional()` **✗**；② `mode` 词表 = `DETERMINISTIC｜EXPLORATORY｜HYBRID` → 实现 = `DETERMINISTIC｜AGENTIC`（**少 2 个值、多 1 个值、无一处映射表**）**✗**；③ `plan[]` `min(1).max(12)` → 实现字段名叫 `steps`、上界 `MAX_GRAPH_NODES=64` **✗**；④ `planRef` 迁移窗口字段 → **不存在** **✗**；⑤ `fallback: none｜explore` 默认 `none` → **不存在** **✗**；⑥ 挂在 `SkillDefinition.execution` 上 → **未挂** **✗** | **不过（6/6 条不满足）** |
| **CMP §3.2 术语表 + §9.1** | 术语表要求字段名 `skill.execution.steps` 且「类型复用既有 `PlanStepSchema`」→ 实现字段名 `steps` **✓**，但元素类型是**放宽的** `SkillExecutionStepSchema`（`type: z.string()` 开放）而**不是** `PlanStepSchema` **✗**（作者在 `skill-graph.ts:356-366` 给了理由：闭合联合会挡掉 `ExtraToolStep` 三类——**理由成立，但这是对 CMP 术语表的一处偏离，CMP 未回写**）；`SkillRuntimePackage` 含 `execution?{steps}` → **无 `SkillRuntimePackage`** **✗** | **不过（挂载点缺失 + 元素类型偏离）** |

**两份文档自身的冲突（本轮新发现，两边都没回写）**：
DSL §9.2 裁定「Compiler 编译出的可执行图**必须**叫 `SkillRuntimeGraph`（节点 `SkillRuntimeNode`）」；
CMP §3.2 把同一层东西叫 `SkillReasoningGraph` + `SkillRuntimePackage`。
实测 **`SkillRuntimeGraph` 全仓 0 命中**（含 docs，仅 DSL 自己那两行）；
`compiler-s1` 分支用的是 CMP 的名字（`SkillReasoningGraphSchema`，`packages/contracts/src/skill-compile.ts:321`）。
⇒ **DSL §9.2 的命名裁定在实现里被 CMP 的命名覆盖了，且 DSL 未回写。** 这条按 DSL 判 ❌，按 CMP 判 ✅[未并]。

### 1.2 `maxBudgetRounds` 「只校验不接运行时」—— **CMP 的诚实标注做到了（3 处），DSL 的没做到（漏标 1 处）**

- CMP **诚实标注 ✅ 三处**：§4.2 `GR-BUDGET`「本期只做声明期校验 + 写入 runtime package，运行时消费由 Track E 接」·
  §10.3「**这一点必须在验收里诚实标注为「未接」**」· §14.4-3「**验收文案必须写「已声明·未接运行时」**」。
  ⇒ 按本单口径：「没接」**不是缺口**，且 **CMP 没有「宣称做了」**。
- **DSL 反而没做到**：DSL §2 基线表把 `maxBudgetRounds` 的处置写成「**沿用字段名 + 接消费方**……
  **这是 Track E 约束 4 的硬验收**」，§4.6 又写「判据：**改这个数 → 该类题实际探索轮次真变**」，
  **全文没有任何一处标注它今天未接**。canonical 实测：`grep -rn maxBudgetRounds apps/*/src packages/*/src`
  = **1 条**（`packages/contracts/src/agentcore.ts:260` 契约声明本身），**零生产读点**。
  ⇒ DSL 这两条属「**宣称做了但其实没做**」（见 §4 清单 X-01/X-02）。
- **[未并] `partial-a` 上的实况（并了也只满足一半）**：新增契约纯函数
  `skillBudgetOverride()`（`packages/contracts/src/agentcore.ts:224`），生产调用方**只有一处**：
  `apps/agentcore/src/skill-probe.ts:133`（**探针路**）。
  `apps/agentcore/src/engine.ts` / `agent/loop.ts` 的生产 agent 循环**未接**。
  ⇒ 并入后 DSL §4.6「改这个数 → 该类题实际探索轮次真变」在**探针路成立、自由问答/注册 agent 路不成立** ⇒ **🔗 不是 ✅**。

### 1.3 「意图/计划 32」算式 —— **RT §12 的 `5+16+11` 对；CMP §14.2 的 `4+16+12` 两个加数都错**

**实测（不照文档抄）**：`node -e 'seedIntentsAndPlans("demo")'`（用**重新 build 过**的 `dist`）

```
intents= 32 plans= 32          ← 总数两份文档都对
```

逐段拆（`apps/agentcore/src/mocks/seed.ts`）：

| 段 | 实测条数 | 证据 |
|---|---:|---|
| 手写块（`affected_orders` / `capacity_feasibility` / `risk_root_cause` / `adopt_mitigation` / `order_deep_360`） | **5** | 意图 key 序列前 5 位 |
| `SCENARIO_CATALOG` 补种（20 张卡 − 已有的 4 个跳过，`seed.ts:625`） | **16** | 实测 `SCENARIO_CATALOG` 20 张、与手写块交集 = **4**（`affected_orders`/`capacity_feasibility`/`risk_root_cause`/`adopt_mitigation`）⇒ 补 16 |
| `ceoCaps`（`seed.ts:677`） | **11** | 逐条数：`ceo_root_cause`…`ceo_capacity_threshold` |
| **合计** | **32** | |

⇒ **CMP §2.4 / §14.2 的 `4 + 16 + 12` 错在两处**：那个 `4` 是「**被跳过的卡数**」，被误当成「手写意图数」（真值 5）；
`12` 是 `ceoCaps` 条数的误记（真值 11）。总数 32 碰巧对，**是两个错互相抵消**——正是铁律 0.6 的形态
（「我用一个看起来相关的数字当判据，而它并不度量我要度量的东西」）。

**顺带实测两条 CMP 没说到的**：① 32 个种子意图 **`planRef` 全为 undefined**，绑定走的是旧字段 `planId`
（`seed.ts:661` `planId`，解析走 `catalog/service.ts:90` 的 legacy 分支）——CMP §2.4「每个意图绑一个 ExecutionPlan」
**结论对、机制描述不准**；② `SOLVER_KEYS` 实测 **59** 条，CMP §4.2/§14.3 写的「静态可数 **57** 条」**已过期**。

---

## 2. DSL 逐条表（`PRD-skill-contract-dsl.md` · 215 条）

> 列：`编号 | 需求 | 档 | file:line | 追的那一层调用`

### §0.1 触及对象类型（D001–D008）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D001 | Skill 契约扩面：新增 `identity/businessIntent/trigger/execution/requires/budget/progress/acceptance` 八个字段组 | ❌ | `packages/contracts/src/agentcore.ts:236-261` | 18 字段逐字段读完，八组**一个都不在**；`grep SkillIdentitySchema\|SkillTriggerSchema\|SkillBudgetSchema\|SkillProgressSchema\|SkillAcceptanceSchema\|SkillRequiresSchema` src=0 |
| D002 | `ExecutionPlan` 降级为 `Skill.execution.plan[]`；迁移窗口内仍是一等对象 | ❌ | `packages/contracts/src/qos.ts:181-188` | `ExecutionPlanSchema` 仍一等且是唯一真源；`resolvePlanForIntent`(`catalog/service.ts:81`) 仍从 plans 仓储取 |
| D003 | Intent 契约**不改**（1:1 边声明在 Skill 侧） | ⛔不改·未违规 | `packages/contracts/src/qos.ts:50-70` | 反向查：`IntentDefinition` 无 `skillKey`/`skillId` 字段 ⇒ 没人违规加 |
| D004 | AgentDefinition **不改**，`agent.skills[]` 语义不变 | ⛔不改·未违规 | `apps/agentcore/src/engine.ts:411,483` | `runRegisteredAgent` 仍按 `agent.skills` 取 skill → `buildSkillSection`，无新语义 |
| D005 | `SkillReference` 保留；`SkillAttachment`(`resources[]`) 成为文档类文件承载面 | 🔗 | `packages/contracts/src/agentcore.ts:227-234,256` | `SkillReference` 保留 ✓；`resources[]` 实测 **7/7 全空**（`seedRegistry("demo")` 跑出 0），承载机制在、无数据 |
| D006 | `EvalCase(suite=skill_quality)` 从手写改为 `acceptance.goldenCases[]` 派生 | ❌ | — | `grep deriveSkillEvalCases` 全仓 src=0 test=0；发布门二仍读手写用例（`server.ts:1288`） |
| D007 | SceneEntry / Scenario / Solver / OntologyType / RuleEntry **只被引用不定义** | ⛔不改·未违规 | `packages/contracts/src/agentcore.ts:216` | `SKILL_REFERENCE_KINDS` 八值只是 key 引用；无一处在 Skill 内定义对象/规则/求解器 |
| D008 | `FeatureDef.bindings` 补 `skills` 绑定（否则「意图开着 Skill 关着」半开态） | ❌ | `packages/contracts/src/features.ts:16-22` | `bindings` 仍只有 `intents/solverKeys/apiTags`；金丝雀：同文件 `intents` 命中 ⇒ 工具正常 |

### §0.2 触及链路（D009–D013）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D009 | 编排链收口为 `Intent --(1:1)--> Skill --execution.plan[]--> 步骤` | ❌ | `apps/agentcore/src/router/orchestrator.ts` | 路径 A 仍 `Intent.planId/planRef → ExecutionPlan → workflow executor`；无任何 Intent→Skill 边 |
| D010 | Skill 引用链扩为 `requires`，并**首次可校验** | 🔗 | `apps/agentcore/src/server.ts:1272` | `requires` ❌ 不存在；但「可校验」那一半**已由 `references[]/dependsOn[]` 实现**（`probeMissingRefs` 已接 skill 发布路）⇒ 目标达成一半、载体没换 |
| D011 | DRIL `triggerPatterns` 数据源从 `summary` 扩为 `trigger.examples/antiExamples` | ❌ | `apps/agentcore/src/dril/resource-projector.ts:141-170` | `projectSkills` 仍只读 `summary`；`trigger` 字段不存在 |
| D012 | 自由问答链是新字段消费方的主挂点（`selectTenantSkills→buildSkillSection→load_skill→resolveSkill`） | ✅链路在·⚠️新字段零挂 | `router/orchestrator.ts:257` · `agent/prompts.ts:69` · `engine.ts:411` | 链路四段实测都在且互调；但链上读的仍是 `summary/body/resources`，**没有一个新字段被读** |
| D013 | 发布链新增第三道「引用可校验」门 | ✅ | `apps/agentcore/src/server.ts:1266-1282` | `probeMissingRefs(deps.dataCore, a, {solverKeys, ruleKeys, objectTypes})` → 422 `SKILL_REF_UNRESOLVED`，位置在 `repos.skills.update` **之前**；门 `ref-closure:check` 实跑 RC=0、金丝雀 5/5 被咬 |

### §0.3 触及事件（D014–D016）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D014 | `skill.published` 沿用，不改名、不改载荷结构 | ⛔不改·未违规 | `apps/agentcore/src/server.ts:1301` | `emitDomainEvent(a.tenantId,"skill.published",{id,key})` 载荷仍两字段；`event-subscriptions.ts` 订阅声明未动 |
| D015 | `step.completed` 伪 step（`agent_narration`/`agent_degraded`）**不新增事件名** | ⛔不改·未违规 | `packages/contracts/src/qos.ts`（事件名集） | 无新事件名；`ontology:check` 断言「代码事件集 = 本体 §4」仍绿 |
| D016 | `requires.events` 只引用本体 §4 已登记事件名 | ❌ | — | `requires` 不存在 ⇒ 无承载物；金丝雀：`grep requires.events` 与 `grep events:` 在 contracts 均可命中他处 ⇒ 工具正常 |

### §0.4 不变量核对（D017–D028）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D017 | R1 contracts-only-shared：Skill 契约全落 `@platform/contracts` | ✅ | `packages/contracts/src/agentcore.ts` · `skill-graph.ts` | 两 app 只 import 类型；但 **`AnyPlanStepSchema` 仍在 app 本地**（见 D122）⇒ R1 有一处未收编 |
| D018 | R2 tenant_id everywhere：`requires` 解析 / `selectTenantSkills` / acceptance 派生均按租户 | 🔗 | `router/orchestrator.ts:257` · `server.ts:1243` | `selectTenantSkills` 按租户 ✓；发布路 `skill.tenantId !== a.tenantId → 404` ✓；`requires`/acceptance 无承载物故未覆盖 |
| D019 | R3 entitlement：`FeatureDef.bindings` 加 `skills`，与 `intentAllowed` 同处判定 | ❌ | `packages/contracts/src/features.ts:16-22` | 同 D008 |
| D020 | R4 真值写入经 Action：判定单源 `isWriteModeSkill()` 不动 | ⛔不改·未违规 | `packages/contracts/src/agentcore.ts:201` | `engine.ts:36 skillWriteMode` 与 `skill-probe.ts` 两侧都调它，无第二处判定 |
| D021 | R6 确定性：`execution.plan[]` 执行 / `requires` 归一 / acceptance 派生全为纯函数 | ⚠️部分 | `packages/contracts/src/skill-graph.ts:400+` | `chainGraphFromPlanSteps`/`compileExecution` 是纯函数 ✓，但只经 HTTP body 驱动；`requires`/acceptance 归一函数不存在 |
| D022 | R7 错误信封：引用校验失败新增 code `SKILL_REF_UNRESOLVED` | 🔗 | `apps/agentcore/src/server.ts:1279` | code **已在行为里生效**（接缝测试 `skill-ref-closure.seam.test.ts:82` 断言），但**未登记进 `ErrorCodes`**（`packages/contracts/src/common.ts` `grep SKILL_` = 0 命中，金丝雀 `DATACORE_UNAVAILABLE` 同文件命中 ⇒ 工具正常） |
| D023 | R9 仓储双实现：`skills` 表新增字段走 JSON 列，不需四处同改 | ✅ | `apps/agentcore/migrations/001_init.sql:118-126` | 表结构 `definition JSONB`，新增可选字段确实零迁移 |
| D024 | R11 全链闭包：闭包判据从 Intent+Plan+Solver+render 改读 Skill | ❌ | `scripts/check-chain-closure.mjs` | 门仍按 Intent/Plan 走；Skill 未进闭包判据 |
| D025 | R13 结论可溯源：`provenancePolicy` 语义不变 | ⛔不改·未违规 | `apps/agentcore/src/engine.ts:30,360` | `skillProvenancePolicy` 仍是唯一读点，语义未变 |
| D026 | R13 附：`outputEnforcement` 新增但默认 off（不伪装已生效） | ❌ | — | 字段不存在（`grep outputEnforcement` src=0 test=0） |
| D027 | R14 应用层无业务常数：`kpis[].metricKey` 只引用 key、禁写阈值 | ❌ | — | `businessIntent` 无承载物 |
| D028 | R15/R16：CLI 对等只登记诉求、不在本 PRD 交付；scaffold 出的 DRAFT 仍受 R4 墙 | ⛔本期不做·标注诚实 | DSL §0.4 R15 行 | 文档自述「不在本 PRD 交付」；实测 `scripts/platform-cli.mjs` **零 `skill` 命中**（金丝雀 `run` 命中 4 次 ⇒ 工具正常），与自述一致 |

### §0.5 触及断点（D029–D038）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D029 | G-3：`trigger.slots` 复用 `SlotDefSchema`，槽位口径收敛一处 | ❌ | `packages/contracts/src/qos.ts:26` | `SlotDefSchema` 在，但 `trigger` 不存在 ⇒ 收敛未发生 |
| D030 | G-8：引用可校验门让 scaffold 空壳的悬空引用当场可见 | 🔗 | `server.ts:1272` | 门已接**发布路**；但出厂/ scaffold 的 skill 是**直接以 PUBLISHED 落库**（`mocks/seed.ts`），不走发布路由 ⇒ 它们的 `references` 从未被门校验（本体 §8 同一记载） |
| D031 | G-9：`execution.mode` + `budget` 把探索预算从全局常数改为按题型声明 | ❌ | `packages/contracts/src/qos.ts:667-668` | `AgentBudget` 默认值仍是全局常数；无 Skill 侧覆盖读点 |
| D032 | G-10：规则**引用**而非写死 | ✅ | `apps/agentcore/src/engine.ts:92,364,505` | `skillRuleRefs(skills,"precondition"/"postcheck")` → 真跑 rule 预检/后检，引用语义成立 |
| D033 | G-SKILL-UNREACHABLE-FREE-QA：新字段不得依赖该暗发门常开，门关时逐字节兼容 | ⛔不改·未违规 | `apps/agentcore/src/features/registry.ts:116` | 暗发门仍默认关；无新字段依赖它（因为没有新字段） |
| D034 | G-SIDEEFFECT-VOCAB-SPLIT：新字段一律复用既有词表，禁自造第二套枚举 | ⛔不改·**有一处偏离** | `packages/contracts/src/skill-graph.ts:394` | `SkillExecutionSchema.mode` 造了 `DETERMINISTIC｜AGENTIC`，与 DSL §4.4 指定的 `DETERMINISTIC｜EXPLORATORY｜HYBRID` **是两套词表且无映射**——正是本条要防的形态（详见 §1.1） |
| D035 | G-RESOURCE-CATALOG-NO-DATA：`requires.objectTypes/relations` 校验的前置（资源目录能投影 object_type/field）已具备 | ✅前置在 | `apps/agentcore/src/resources.ts:83` | `dataCore.ontology.listObjectTypeKeys` 已被 `probeMissingRefs` 真调用 |
| D036 | G-ARG-DROP-SEAM：`trigger.slots` 与 `execution.plan[]` 的 `{{slots.X}}` 必须同源 | ❌ | — | 两者都不存在于 Skill 上 |
| D037 | G-C08-EXPR-PARAM-SPLIT：本 PRD 无关但不得被掩盖 | ⛔绝对不做 | DSL §0.5 | 文档自述不修；无人在 Skill 侧宣称修了它 |
| D038 | G-ROUTE-REGEX-PREEMPTS-RETRIEVAL：本体 §8 尚无此行，Skill 与路由互补非重叠 | ⛔本期不做·标注诚实 | `docs/SYSTEM-ONTOLOGY.md` §8 | `grep G-ROUTE-REGEX-PREEMPTS-RETRIEVAL docs/SYSTEM-ONTOLOGY.md` = 0（金丝雀：同文件 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 命中 ⇒ 工具正常），与文档自述一致 |

### §0.6 本体回写清单（D039–D044）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D039 | §2.H `Skill` 条目补八字段组与 `execution` 吞并语义 | ❌ | `docs/SYSTEM-ONTOLOGY.md:262` | §2.H 只回写了 `execution.graph/steps/legacy` 判别序（orchestrator 线），**无八字段组、无吞并语义** |
| D040 | §2.H `ExecutionPlan` 标注「降级为 `Skill.execution.plan[]`」 | ❌ | `docs/SYSTEM-ONTOLOGY.md` | grep 无此标注 |
| D041 | §3「Skill 引用链」`references\|dependsOn` 扩为 `requires` | ❌ | `docs/SYSTEM-ONTOLOGY.md:1073` | §3/§8 仍写 `references\|dependsOn` |
| D042 | §5 R3：`FeatureDef.bindings.skills` 落地后回写检测点 | ⛔本期不做（前置未落地） | — | 前置 D008 未做，回写自然未做——**未宣称做了** |
| D043 | §7 新增 `skill-refs:check` 门（静态半） | 🔗 | `package.json:35` | **名字不同、覆盖不同**：落地的是 `ref-closure:check`（运行态发布路的**防退化**门），DSL 要的静态半（工具名/求解器 key/事件名/步骤类型四类静态池）**一条都没有** |
| D044 | §8 若坐实新断点须登记 | ✅ | `docs/SYSTEM-ONTOLOGY.md:1073` | `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 已在册且已分三处定性（① 死抽取器未修 · ② dependsOn 无数据未修 · ③ 发布路探针已修） |

### §1 定位与范围（D045–D059）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D045 | 交付：字段名/类型/必填/默认值 | ✅文档层 | DSL §4 | 本 PRD 是文档单，§4 逐字段给全 |
| D046 | 交付：引用模型 | ✅文档层 | DSL §5 | — |
| D047 | 交付：内联 vs 引用边界 | ✅文档层 | DSL §6 | — |
| D048 | 交付：`execution` 详规 | ✅文档层 | DSL §4.4/§7 | — |
| D049 | 交付：包结构 → `resources[]` 映射 | ✅文档层 | DSL §8 | — |
| D050 | 交付：命名红线 | ✅文档层·**实现未遵守** | DSL §9.2 | `SkillRuntimeGraph` 全仓 0 命中，实现用了 CMP 的名字（详见 §1.1） |
| D051 | 交付：门禁与验收判据 | ✅文档层 | DSL §10 | — |
| D052 | 不交付：迁移脚本 | ⛔另立单 | DSL §1 | 未宣称做了 |
| D053 | 不交付：Compiler/CLI 实现 | ⛔另立单 | DSL §1 | 未宣称做了 |
| D054 | 不交付：路由改造（Track A） | ⛔另立单 | DSL §1 | 未宣称做了 |
| D055 | 不交付：探索成本（Track B） | ⛔另立单 | DSL §1 | 未宣称做了 |
| D056 | P1 既有字段零语义变更：老字段不改名/不改类型/不改缺省，新层一律 optional additive | ✅ | `packages/contracts/src/agentcore.ts:236-261` | 18 字段与 PRD §2 基线表逐字段比对，**一处未变**（含 `summary.max(400)` / `body.max(50_000)` 两个被 PRD 点名"想改但不改"的数字） |
| D057 | P2 引用一律 key，不内联定义 | ✅ | `packages/contracts/src/agentcore.ts:219-225` | `SkillReferenceSchema` 只有 `{kind,key,version,required,role}`，无内联定义面 |
| D058 | P3 一层一落点：12 层每层能指到具体字段 | 🔗文档层满足·实现层 4/12 | DSL §3 | 文档表 12 行齐全；实现侧只有 ①(部分)/⑥(部分)/⑧/⑪(声明) 有承载物 |
| D059 | P4 每个新字段写明消费方，写不出的不入契约 | ✅文档层 | DSL §4 各表「消费方/判据」列 | 每行都有；§4.9 明写砍掉三项的理由 |

### §2 基线盘点逐字段处置（D060–D076）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D060 | `id/tenantId/key/version/name` 沿用零变更 | ✅ | `agentcore.ts:237-241` | 全链在用 |
| D061 | `summary` 沿用·语义仍是触发器·**不改契约数字 400** | ✅ | `agentcore.ts:242` | `buildSkillSection`(`prompts.ts:72`) 注入 system prompt；`max(400)` 未动 |
| D062 | `summary` 契约 400 与 lint 200 不一致，本 PRD 主张以 lint 为准但不改契约 | ✅（不一致确实仍在） | `skill-lint.ts:46` vs `agentcore.ts:242` | `SUMMARY_MAX = 200` vs `max(400)`——两值都未动，**不一致原样保留**（符合本 PRD 承诺，但**是一条活着的坑**） |
| D063 | `body` 沿用；契约 50_000 vs lint 3_000 双上限 | ✅（不一致仍在） | `skill-lint.ts:47` vs `agentcore.ts:243` | `BODY_MAX = 3000`；`load_skill` 回执读 `body`（`engine.ts` 回执段） |
| D064 | `body` 长文下沉 `resources[]` 而非扩 body（推荐） | ⚠️无数据 | `mocks/seed.ts` | 实测 7 个 skill `body` 均值 **442 字**、`resources` **7/7 空** ⇒ 推荐未被采纳过一次 |
| D065 | `resources[]` 沿用 + **大幅启用**为文档承载面 | ❌数据层 | `mocks/seed.ts` 七处 `resources: []` | 承载机制三段齐全（`engine.ts` 回执 + `tools/registry.ts:258 read_skill_resource` + `tools/executor.ts:467` 真读文件），**零数据** ⇒ 接了线没数据 |
| D066 | `status` 沿用（DRAFT/PUBLISHED/RETIRED） | ✅ | `agentcore.ts:247` | `selectTenantSkills` 只收 PUBLISHED（`orchestrator.ts:260`） |
| D067 | `capability` 沿用·对应 12 层① category 语义面 | ✅ | `agentcore.ts:250` | DRIL `projectSkills` 投影 |
| D068 | `sideEffect` 沿用·**禁止再加同义枚举** | ⛔不改·未违规 | `agentcore.ts:251` | `isWriteEffectSkill`/`isWriteModeSkill` 仍是唯一判定；无第二套 |
| D069 | `inputSchema` 沿用 | ✅ | `agentcore.ts:254` · `skill-lint.ts:329` | lint 形状检查 + DRIL `inputSpec` |
| D070 | `outputSchema` 沿用 + **接消费方**（新增 `outputEnforcement`） | ❌ | `agentcore.ts:255` | `grep outputEnforcement` src=0；`outputSchema` 的消费方仍只有 `skill-lint.ts`（形状）与 `resource-projector.ts:149`（投影）⇒ 「无任何一处拿它校验实际输出」**原样成立** |
| D071 | `references[]` 沿用·语义收窄为「带 role 的运行时引用」 | ✅ | `engine.ts:92` | `skillRuleRefs` 按 `role` 分 precondition/postcheck 真跑 |
| D072 | `references[]` 必须是 `requires` 的子集（§5.3 归一） | ❌ | — | `requires` 与归一函数都不存在 |
| D073 | `dependsOn[]` 沿用；**核实补正**：不是零消费方，是 7/7 全空导致从不触发 | ✅补正成立 | `skill-lint.ts:238`(环检测) · `skill-lint.ts:348`(可解析) · `resource-projector.ts:334`(关系投影) | 三处消费方逐一点开确认；实测 `seedRegistry("demo")` **dependsOn 非空 = 0 个**、`references` 非空 = **6 个**（两字段定性不同，本表分开记，符合 CLAUDE.md 铁律 0.5 的更正） |
| D074 | `approvalGate` 沿用 | ✅ | `agentcore.ts:258` | `isWriteModeSkill` 读它 |
| D075 | `provenancePolicy` 沿用 | ✅ | `agentcore.ts:259` · `engine.ts:30,360` | `skillProvenancePolicy` → 运行时聚合 |
| D076 | **结论**：无一字段需语义变更或删除；本 PRD 形态是 additive 超集 | ✅ | 同上 16 行 | 逐字段比对无变更 ⇒ 结论成立 |

### §3 12 层 → 契约落位（D077–D088）

| # | 层 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D077 | ① Identity：`id/key/version/name/status/tenantId` + ✚`identity{...}` | 🔗 | `agentcore.ts:237-247` | 既有 6 项在；✚`identity` 六子字段 **0/6**（`domain/category/owner/riskLevel/supersedes/runtime` 全 grep 0） |
| D078 | ② Business Intent：✚`businessIntent{...}` | ❌ | — | 整层无承载物（src=0；test=2 处仅在别处文案里出现，非 Skill 字段） |
| D079 | ③ Ontology Binding：✚`requires.objectTypes/relations/slices` | ❌ | — | `SkillRequiresSchema` src=0 |
| D080 | ④ Input Contract：`inputSchema` + ✚`trigger.slots` + ✚`requires.dataSources` | 🔗 | `agentcore.ts:254` | 只有 `inputSchema`；✚两项 0 |
| D081 | ⑤ Context Manager：✚`context{retrieval,compression}` 声明位 | ❌ | — | `grep "context: z.object"` 在 Skill 契约 0 命中 |
| D082 | ⑥ Reasoning Logic：✚`execution.mode` + `execution.plan[]` + `body` | 🔗 | `skill-graph.ts:384` | 形状在契约层、**未挂 SkillDefinition**（详 §1.1）；`body` 在 |
| D083 | ⑦ Tool/MCP Binding：✚`requires.tools/mcp` | ❌ | `agentcore.ts:216` | `SKILL_REFERENCE_KINDS` 八值**不含 tool/mcp**；`requires` 不存在 ⇒ 「Skill 声明用哪些工具」今天无处声明 |
| D084 | ⑧ Rule & Constraint：✚`requires.rules` + 既有 `references[kind=rule,role]` | 🔗 | `engine.ts:92` | 既有半 ✅真跑；✚`requires.rules` ❌ |
| D085 | ⑨ Solver Integration：✚`requires.solvers{key,objective,weights}` | 🔗 | `server.ts:1274` | 只有 `references[kind=solver].key` 且已被探针校验；`objective/weights` 内联面 ❌ |
| D086 | ⑩ Workflow Execution：✚`requires.workflows/agents` + `approvalGate` | 🔗 | `agentcore.ts:258` | `approvalGate` 在；✚两项 ❌ |
| D087 | ⑪ Output Contract：`outputSchema` + ✚`outputEnforcement`（首次有校验消费方） | ❌ | `agentcore.ts:255` | 同 D070：仍无校验消费方 |
| D088 | ⑫ Governance & Learning：既有三字段 + ✚`acceptance`；Learning 本期不入契约 | 🔗+⛔ | `agentcore.ts:251,258,259` | 三字段 ✅；`acceptance` ❌；Learning ⛔本期不做且**标注诚实**（§4.9） |

### §4.0 顶层形状（D089–D093）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D089 | 既有 18 字段一字不改 | ✅ | `agentcore.ts:236-261` | 逐字段比对 |
| D090 | 九个 ✚ 新字段全部 `optional`（additive） | ❌ | — | 九个字段一个都不存在，谈不上 optional |
| D091 | `outputEnforcement` 有 `.default("off")` | ❌ | — | 同上 |
| D092 | 缺省行为 = 今日行为**逐字节不变** | ✅（因为没加字段） | — | 空集合上恒成立；不构成实现证据 |
| D093 | 每个 ✚ 字段挂在 `SkillDefinitionSchema` 顶层 | ❌ | `agentcore.ts:236-261` | 顶层 18 键，无一是 ✚ |

### §4.1 `identity`（D094–D100）

| # | 字段/约束 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D094 | `identity.domain` 引用 A3 业务域注册表 key | ❌ | — | grep 0 |
| D095 | `identity.category`（与 `capability` 正交） | ❌ | — | grep 0 |
| D096 | `identity.owner` 与 `IntentDefinition.owner` 同口径 | ❌ | — | Skill 侧 0；Intent 侧 `owner` 在（`seed.ts:668`） |
| D097 | `identity.riskLevel` **复用** Intent 三值词表 | ❌ | `packages/contracts/src/qos.ts:59` | 词表在 Intent 侧；Skill 侧无字段 ⇒ 也就没机会造第二套（**反向：没有违规**） |
| D098 | `identity.supersedes{key,version}` 一等留痕 | ❌ | — | `grep supersedes` 全仓 src=0 test=0 scripts=0 |
| D099 | `identity.runtime`（semver range），装载门读它 | ❌ | — | grep 0 |
| D100 | 约束：`riskLevel`/`sideEffect`/`approvalGate` 互相矛盾 → lint 红；判定单源 `isWriteModeSkill()` | ❌门·⛔单源未破 | `skill-lint.ts` | lint 里无该规则；`isWriteModeSkill` 单源未被破坏 |

### §4.2 `businessIntent`（D101–D107）

| # | 字段/约束 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| D101 | `businessIntent.intentKey`（意图 1:1 Skill 的唯一落点） | ❌ | grep src=0 | 「这条边今天根本不存在」原样成立 |
| D102 | `userRoles[]` 引用角色 key | ❌ | grep 0 | — |
| D103 | `decisionScene` | ❌ | grep 0 | — |
| D104 | `triggerConditions[]`（非问句模式） | ❌ | grep 0 | — |
| D105 | `kpis[]{metricKey,direction,note}`，禁写阈值 | ❌ | grep 0 | — |
| D106 | 门：同一 `intentKey` 至多一个 PUBLISHED Skill | ❌ | `server.ts:1239-1322` | 发布门四段（lint/探针/评测数/覆盖/passRate）无此判 |
| D107 | `Intent → Skill` 正向索引由反查派生（纯函数，不落第二份真源） | ❌ | `apps/agentcore/src/resources.ts:176` | `computeReferences(kind="skill")` 只返回**挂载该 skill 的 agent**，不返回意图 |

### §4.3 `trigger`（D108–D114）

| # | 字段/约束 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| D108 | `trigger.answers` → DRIL `ResourceDescriptor.description` 的 Skill 侧来源 | ❌ | grep 0 | `projectSkills` 仍用 `summary` 做 description |
| D109 | `trigger.examples[]`（检索层与门的共同真源，声明时 `.min(1)`） | ❌ | grep 0 | — |
| D110 | `trigger.antiExamples[]`（"不归我"） | ❌ | grep 0 | — |
| D111 | `trigger.exclusivity` `SOLE\|COUNCIL\|OPEN` 默认 OPEN | ❌ | grep 0 | — |
| D112 | `trigger.slots[]` **复用** `SlotDefSchema` | ❌ | `qos.ts:26` | 词表在，Skill 侧无字段 |
| D113 | lint：`inputSchema.required ⊆ slots.name` | ❌ | `skill-lint.ts` | 无此规则 |
| D114 | `slots` 与 `execution.plan[]` 的 `{{slots.X}}` 同源（守 G-ARG-DROP-SEAM 同族） | ❌ | — | 两端都缺 |

### §4.4 `execution`（D115–D123）

| # | 字段/红线 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D115 | `mode` **必填**、词表 `DETERMINISTIC\|EXPLORATORY\|HYBRID` | ❌ | `skill-graph.ts:394` | 实现是 `optional()` 且词表 `DETERMINISTIC\|AGENTIC` ⇒ 两处都不符（详 §1.1） |
| D116 | `plan[]`（`AnySkillPlanStep`，`min(1).max(12)`） | 🔗 | `skill-graph.ts:388` | 字段名叫 `steps`、上界 64；元素是**结构地板**非 `AnyPlanStepSchema` |
| D117 | `planRef`（迁移窗口）；`plan` 与 `planRef` 同时存在即 lint 红 | ❌ | — | 字段与规则均不存在 |
| D118 | `fallback: none\|explore` 默认 `none` | ❌ | — | grep 0 |
| D119 | 红线①：步骤词表必须用 `AnyPlanStepSchema` 口径，且**把这个 contract gap 收进 contracts** | ❌ | `apps/agentcore/src/catalog/service.ts:28,36` | `ExtraToolStepSchema`/`AnyPlanStepSchema` **仍在 app 本地**，contracts 里 0 命中（金丝雀：contracts 里 `query_timeseries_agg` 在 `timeseries.ts:28` 有命中 ⇒ 工具正常）⇒ **R1 缺口原样** |
| D120 | 红线②：`min(1).max(12)` 与 `ExecutionPlanSchema.steps` 一致 | ❌ | `qos.ts:187` vs `skill-graph.ts:388` | 前者 `min(1).max(12)`，后者 `min(1).max(64)` ⇒ **不一致** |
| D121 | 红线③：`params`/`onError`/`timeoutMs`/模板语义一字不改 | ✅ | `skill-graph.ts:82-95` | `SkillGraphNodeSchema` 复用同一 `TemplateValueSchema`/`OnErrorSchema` |
| D122 | 红线④：`render_answer` 必须末步等既有校验原样迁移不重写 | ✅ | `apps/agentcore/src/workflow/validate.ts:71` | `GraphScheduler` 走 `validatePlanSteps` 而非重写（`skill-graph.ts:362` 注释点名此约束） |
| D123 | `mode` 三行运行时含义（执行路径/预算来源/信任标） | ❌ | — | `EXPLORATORY`/`HYBRID` 两个 mode 不存在；信任标映射无实现 |

### §4.5 `requires`（D124–D135）

> `SkillRequiresSchema` 全仓 **src=0 test=0 scripts=0**（金丝雀：同目录 `SkillReferenceSchema` 命中 ⇒ 工具正常）。
> 下列 12 条**均为 ❌ 无承载物**，但其中 3 条的**目标**已由既有 `references[]` 部分达成，单列。

| # | 子项 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| D124 | `requires.objectTypes[]{key,properties[],required}`（含 RG-TYPE-PROP 契约式属性） | ❌ | grep 0 | 目标的一半由 `references[kind=ontologyType]` + `probeMissingRefs` 达成（`server.ts:1274`），但**属性级契约（"Factory 须有 capacity"）无处声明** |
| D125 | `requires.relations[]{linkKey,from,to,required}` | ❌ | grep 0 | `SKILL_REFERENCE_KINDS` 无 link/relation kind |
| D126 | `requires.slices[]{key,required}` | ❌ | grep 0 | `references[kind=slice]` 可写，但**探针不覆盖 slice**（`probeMissingRefs` 只查 solver/rule/objectType，`resources.ts:76-86`）⇒ 悬空 slice 引用今天无人校验 |
| D127 | `requires.rules[]{key,minStatus,role,required}` | ❌ | grep 0 | `references[kind=rule]` 已被探针校验 ✅；`minStatus`（PUBLISHED 与否）**无处声明也无人校验**——CMP §14.2 同点未核实 |
| D128 | `requires.solvers[]{key,objective,weights,required}` | ❌ | grep 0 | `key` 半已达（探针）；`objective/weights` 内联面 0 |
| D129 | `requires.tools[]{name,required}` | ❌ | grep 0 | 工具名今天只在 `body` 文本里被 lint 拼写反查（`skill-lint.ts:329`），**不是结构化声明** |
| D130 | `requires.mcp[]{server,tool,required}` | ❌ | grep 0 | kind 不存在 |
| D131 | `requires.workflows[]{key,version,required}` / `requires.agents[]{key,required}` | ❌ | grep 0 | `references[kind=workflow/agent]` 可写，**探针不覆盖** ⇒ 无人校验 |
| D132 | `requires.dependsOn[]{key,version,required}` | ❌ | grep 0 | 顶层 `dependsOn` 在且有三个消费方，但**语义是 `SkillReference` 不是本条形状** |
| D133 | `requires.dataSources[]{category,required}` 引用 `connectorCategories()` | ❌ | grep 0 | — |
| D134 | `requires.events{emits[],consumes[]}` | ❌ | grep 0 | 「谁发谁收」今天完全没有的一层，原样成立 |
| D135 | 归一：`normalizeSkillRequires()` 纯函数唯一读点，所有消费方只读归一结果 | ❌ | grep 0 | 今天四个消费方（lint / 发布门 / DRIL 投影 / engine 规则预检）**各读各的**（`skill-lint.ts:347` / `server.ts:1272` / `resource-projector.ts:334` / `engine.ts:92`）⇒ 四份口径 |

### §4.6 IO 契约 · 预算与红线（D136–D143）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D136 | `outputEnforcement` `off\|warn\|block`，默认 off | ❌ | grep 0 | — |
| D137 | 效果层判据：`block` 下缺必填字段的答案**真被拦** | ❌ | — | 无任何输出校验点 |
| D138 | `budget.rounds` → `AgentBudget.maxRoundTrips` | ❌ canonical / 🔗[未并] | `agentcore.ts:224`(partial-a) | canonical 0；partial-a 有 `skillBudgetOverride()`，但生产调用方**只有 `skill-probe.ts:133`**，`engine.ts`/`agent/loop.ts` 未接 ⇒ 并入后仍是 🔗 |
| D139 | `budget.discoverCalls` → `maxDiscoverCalls` | ❌ | `qos.ts:667` | 平台默认 8 仍是全局常数；无 Skill 覆盖 |
| D140 | `budget.toolCalls` → `maxToolCalls` | ❌ | `qos.ts:659` | 同上 |
| D141 | `expectedDurationMs`（**不得**直接当 abort 阈值） | ❌ | grep 0 | — |
| D142 | `cancellable` 默认 true（诚实边界：只是声明） | ❌ | grep 0 | — |
| D143 | 红线：`budget.*` 只收紧不放宽，取 `min(声明值, 平台硬上界)` | ❌ canonical / ✅[未并] | `agentcore.ts:224-236`(partial-a) | partial-a 实现 `Math.min(...declared, ceiling.maxRoundTrips)` ⇒ 红线本身写对了 |

### §4.7 `progress`（D144–D146）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| D144 | `progress.emitsNarration`（走的路径上必须真发旁白，不新增事件名） | ❌ | grep 0 | — |
| D145 | `progress.phases[]{key,label}`（只用于 UI 分组，不参与路由） | ❌ Skill 侧 / 🔗 图侧 | `skill-graph.ts:91` | `SkillGraphNodeSchema.phase` 注释写「对应 `Skill.progress.phases[]`」——**它指向一个不存在的字段**，典型接了线没数据 |
| D146 | 诚实边界写进契约注释：旁白只接主 path-B，子 agent 未接；门不得"跳过即通过" | ⛔本期边界·文档层已写 | DSL §4.7 | 文档写了；无门可查（字段不存在） |

### §4.8 `acceptance`（D147–D154）

| # | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| D147 | `acceptance.goldenCases[]{query, expect{...}}` | ❌ | grep 0 | — |
| D148 | `expect.intent`（意图 key 或 OPEN） | ❌ | grep 0 | — |
| D149 | `expect.mustCall[] / mustNotCall[]` | ❌ | grep 0 | — |
| D150 | `expect.answerMust[] / answerMustNot[]` | ❌ | grep 0 | — |
| D151 | `expect.behaviorGain`（挂载 vs 不挂载对照） | 🔗概念已在·字段❌ | `apps/agentcore/src/skill-lint.ts:83` | `classifySkillEvalCases` 已分「行为增益」三类，但输入是**手写 EvalCase**不是 Skill 上的声明 |
| D152 | `acceptance.mustNotRouteTo[]` | ❌ | grep 0 | — |
| D153 | `deriveSkillEvalCases(skill) → EvalCase[]` 纯函数；发布门二**改读派生结果** | ❌ | `server.ts:1284-1302` | 发布门仍 `repos.evalCases.listByTenant(...,"skill_quality").filter(c=>c.skillKey===skill.key)` ⇒ 仍读手写 |
| D154 | 分类映射对齐 `classifySkillEvalCases`（应触发含 `load_skill` / 不应触发由 `mustNotRouteTo` 派生 / 行为增益 `behaviorGain=true`） | ⚠️只有一半 | `skill-lint.ts:83-101` | 分类器在且被发布门真调用（`server.ts:1295`）；**派生侧完全没有** |

### §4.9 未入契约的层（D155–D157）

| # | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| D155 | `context.memory`（5.3）不入契约——无回写通道 | ⛔本期不做·**标注诚实** | DSL §4.9 | 反向查：`grep "memory"` 在 Skill 契约 0 命中 ⇒ **没有人违规做了** |
| D156 | `learning.*`（⑫）不入契约——前置（跨租户混算指标 + `/metrics` 无鉴权）未修 | ⛔本期不做·**标注诚实** | DSL §4.9 | 反向查：Skill 契约无 learning 字段 ⇒ 未违规 |
| D157 | `context.retrieval/compression`（5.1/5.2）只登记声明位，找不到消费方就一并砍 | ⛔本期不做·**标注诚实** | DSL §4.9 | 反向查：Skill 契约无 `context` 字段 ⇒ 未违规（且**也没留下一个没消费方的空声明**，符合 P4） |

### §5 引用模型（D158–D165）

| # | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| D158 | §5.1 判据（"所有用它的都该变 → 引用；只有这一个该变 → 内联"） | ✅文档层 | DSL §5.1 | — |
| D159 | 包内 `ontology/requires.yaml` → `requires.objectTypes/relations` | ❌ | — | 无 YAML 解析器（`grep yaml apps/*/package.json packages/*/package.json package.json` = **0**）+ 无 `requires` |
| D160 | 包内 `rules/requires.yaml` → `requires.rules` | ❌ | — | 同上 |
| D161 | 包内 `tools/requires.yaml` → `requires.tools/mcp` | ❌ | — | 同上 |
| D162 | 包内 `solver/requires.yaml` → `requires.solvers`（含内联 objective/weights） | ❌ | — | 同上 |
| D163 | **`requires` 是契约不是副本**：装载/发布校验宿主，不满足**拒绝安装** | 🔗目标半达 | `server.ts:1266-1282` | 「不满足拒绝」的**发布**语义已成立（422 且未落库，接缝测试 13 例真跑）；「**安装**」形态无（无包机制） |
| D164 | 归一后四个消费方一律只读归一结果，禁止各读各的 | ❌ | 见 D135 | 四个消费方各读各的（逐个点开确认） |
| D165 | 反向收益：「改 C08 影响哪些 Skill」变成一次查询，不再 grep | ❌ | `apps/agentcore/src/dril/relations.ts:44-95` | 生产投影用 `extractResourceRelations`，它**只抽** workflow→solver/slice/rule 与 agent→skill 四类边，**不读 `skill.references/dependsOn`**；能抽 skill 引用边的 `extractRelations`（`resource-projector.ts:296`）**src 调用方 = 0，仅 3 处 test**（`test/dril-registry.test.ts:11,177,204`）⇒ **`G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ① 未闭，反查今天仍只能 grep** |

### §6 内联 vs 引用逐字段归类（D166–D174）

| # | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| D166 | `requires.rules/solvers/objectTypes/relations/slices/tools/mcp/workflows/agents/dependsOn/dataSources/events` 一律**引用** | ❌载体缺 | — | 判据本身正确但无承载物 |
| D167 | `requires.solvers[].objective/weights` **内联** | ❌ | — | — |
| D168 | `businessIntent.*` **内联**（`kpis[].metricKey` 仍是引用） | ❌ | — | — |
| D169 | `trigger.examples/antiExamples/exclusivity` **内联** | ❌ | — | — |
| D170 | `execution.mode`/`execution.plan[]` **内联** | 🔗 | `skill-graph.ts:384` | 形状是内联的 ✓，但没挂在 Skill 上 |
| D171 | `budget.*`/`maxBudgetRounds`、`provenancePolicy`/`sideEffect`/`approvalGate`、`acceptance.*`、`outputSchema`/`outputEnforcement` **内联** | 🔗 | `agentcore.ts:251,258,259,260` | 四个既有字段确实内联在 Skill 上 ✓；`budget`/`acceptance`/`outputEnforcement` ❌ |
| D172 | ❌ 真值数据**不放进 Skill** | ⛔不新造·未违规 | `agentcore.ts:236-261` | 反向查：18 字段无一承载业务真值 |
| D173 | ❌ 租户阈值 / ❌ 业务常数**不放进 Skill** | ⛔不新造·未违规 | `mocks/seed.ts` 七个 skill | 反向查 7 个种子 skill：阈值/常数都在 `body` 文本里（人读），**不在结构化字段**——未造违规字段 |
| D174 | ❌ 模型选择**不放进 Skill**（换模型不该改 Skill） | ⛔不新造·未违规 | `agentcore.ts:236-261` | 反向查：无 model/provider 字段 |

### §7 迁移语义（D175–D181）

| # | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| D175 | `DETERMINISTIC` ← 今日 `Intent→planRef→ExecutionPlan.steps→workflow executor`，`steps` 原样搬入 | ❌ | `catalog/service.ts:81` | 32 个 Plan 一条未搬；`resolvePlanForIntent` 仍是唯一路径 |
| D176 | `EXPLORATORY` ← 今日未命中意图落 path-B | ❌ | — | 无「探索 Skill」这一形态 |
| D177 | `HYBRID` ← 把隐式回落写成 `fallback:"explore"` | ❌ | — | 回落仍是隐式（orchestrator 内） |
| D178 | 约束 1 **零行为漂移**：迁移前后 answer 与 provenance **字节相等** | ❌未开工 | — | 无迁移动作 ⇒ 无对照 |
| D179 | 约束 2 **单一真源硬门**：`plan` 与 `planRef` 互斥；任一意图同时解析出 Plan 与 Skill → 红 | ❌ | — | 无该门 |
| D180 | 约束 3 **entitlement 一处**：扩 `FeatureDef.bindings.skills` | ❌ | `features.ts:16-22` | 同 D008 |
| D181 | 约束 4 **探索 Skill 必须有真消费方**：`skillBudgetOverride()` 唯一读点 → `AgentBudget`；改数 → 轮次真变 | ❌ canonical / 🔗[未并] | `skill-probe.ts:133`(partial-a) | 见 §1.2：并入后只在**探针路**成立 |

### §8 包结构 → `resources[]` 映射（D182–D189）

| # | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| D182 | 分流判据：机器要据它校验/路由 → 结构化字段；人或模型要读 → `resources[]` | ✅文档层 | DSL §8.1 | — |
| D183 | 权威永远是结构化字段（同内容可两边都有） | ❌无从执行 | — | 结构化字段不存在 |
| D184 | `skill.yaml` → Skill 本体；`metadata.yaml` → `identity`+`businessIntent` | ❌ | — | 无 YAML 依赖、无目标字段 |
| D185 | `ontology/events.yaml` → `requires.events`（今天完全没有的一层） | ❌ | — | 原样成立 |
| D186 | `reasoning/graph.yaml` → `execution.plan[]`；`reasoning/strategies.yaml` → `fallback`+`budget` | ❌ | — | — |
| D187 | `reasoning/prompts/*.md` → `resources[]`，body 用 `{{resource:name}}` 引用（lint 已校验可解析） | 🔗 | `apps/agentcore/src/skill-lint.ts:318-324` | lint 的 `{{resource:...}}` 可解析规则**确实在且被发布门真调用**；但 `resources` 7/7 空 ⇒ 从未触发过 |
| D188 | `evaluation/testcases.yaml` → `acceptance.goldenCases[]`（派生 EvalCase，不进 resources） | ❌ | — | — |
| D189 | 三级渐进披露（`summary`→system / `body`→`load_skill` 回执 / `resources[]`→回执清单 + `read_skill_resource`） | ✅机制·⚠️第三级无数据 | `agent/prompts.ts:72` · `engine.ts:483` · `tools/registry.ts:258` · `tools/executor.ts:467-540` | 三段逐个点开：一二级真跑；第三级代码全通（含 64KB 截断），**但 7/7 skill 无附件** ⇒ 从未走过 |

### §9 命名红线（D190–D194）

| # | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| D190 | 证据①：`ExecutionPlanSchema`/`PlanStepSchema` 已被 QOS 占用 | ✅事实成立 | `packages/contracts/src/qos.ts:181,108` | 被 `catalog/service.ts:57` 消费 |
| D191 | 证据②：仓里已为同一撞名付过一次代价并改名 `ComposePlan` | ✅事实成立 | `packages/contracts/src/execution-plan.ts` 文件头 | 注释原文核对无误 |
| D192 | 裁定：编译产物**必须**叫 `SkillRuntimeGraph`（节点 `SkillRuntimeNode`） | ❌**且已被覆盖** | 全仓 grep（不加 `--include` 过滤）= 仅 DSL 自己两行 | 实现用了 CMP 的 `SkillReasoningGraph`（compiler-s1）/ `SkillGraph`（canonical）⇒ **两份 PRD 命名裁定打架，DSL 这条实际作废且未回写** |
| D193 | `execution.plan[]` 元素仍叫 `PlanStep`，不改名 | ❌ | `skill-graph.ts:377` | 实际叫 `SkillExecutionStep`（结构地板），非 `PlanStep` |
| D194 | 禁用外部产品名；新枚举一律先查既有词表 | ⛔不改·**有一处偏离** | `skill-graph.ts:394` | 无外部产品名 ✓；但 `mode` 造了第二套词表（见 D034/§1.1） |

### §10 门禁与验收（D195–D208）

| # | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| D195 | 静态门：`requires.tools[].name` ∈ 工具注册表 | ❌ | `package.json:11-48` | 门列表 26 个，无此门；`registeredToolNames()`(`skill-lint.ts:54`) 只校验 **body 文本里的工具名拼写**，不是 requires |
| D196 | 静态门：`requires.solvers[].key` ∈ 求解器注册表（经已 build 的 dist 读） | 🔗 | `server.ts:1274` | 由**运行态发布门**覆盖（探针查 DataCore），**静态门没有** |
| D197 | 静态门：`requires.events.emits/consumes` ∈ 本体 §4 事件表 | ❌ | — | 无 |
| D198 | 静态门：`execution.plan[]` 步骤类型 ∈ `AnyPlanStepSchema` 词表 | ❌ | — | 无静态门；运行期由 `GraphScheduler` 报 NOT_IMPLEMENTED |
| D199 | 运行态半：`requires.objectTypes/relations/slices/rules/workflows/agents/dependsOn` 在 publish 校验，不满足 422 `SKILL_REF_UNRESOLVED` | 🔗 **3/7 覆盖** | `apps/agentcore/src/resources.ts:76-86` | 探针只查 **solver / rule / objectType** 三类；`slice`/`constraint`/`workflow`/`agent` 四类**今天仍无人校验**（本体 §8 同一记载） |
| D200 | 诚实边界必须写进门的输出：哪一半由端点守、哪一半没人守 | ✅ | `scripts/check-ref-closure.mjs` 结尾 + `docs/SYSTEM-ONTOLOGY.md:936` | 门 RC=0 输出「三条发布路均接探针·两层 fail-open 均关死·skill 路拦在落库之前」，本体条目显式列出未覆盖的四种 kind |
| D201 | S1 迁移零漂移（answer 与 provenance 字节相等 + 变异反证） | ❌ | — | 无迁移 ⇒ 无此测试 |
| D202 | S2 预算效果层（改 `budget.rounds` → 实际探索轮次真变） | ❌ canonical / 🔗[未并] | `test/skill-partial-a-seam.test.ts:101,115` | partial-a 有一对正反测（声明 1 → 第二轮 LLM 不发生；不声明 → 第二轮照跑），**但驱动的是探针不是生产 loop** |
| D203 | S3 引用可校验 green→red→green（改成不存在的 key → 发布 422） | ✅ | `apps/agentcore/test/skill-ref-closure.seam.test.ts:74-129`（13 例） | 从 HTTP 发布端点驱动，断言 422 `SKILL_REF_UNRESOLVED` **且未落库**；门 `ref-closure:check` 实跑变异反证 5/5 被咬 |
| D204 | S4 输出契约生效（`block` 下缺字段真被拦；`off` 下逐字节等同今日） | ❌ | — | 无 `outputEnforcement` |
| D205 | S5 1:1 边成立（同一 `intentKey` 两个 PUBLISHED Skill → 红） | ❌ | — | 无 `intentKey` |
| D206 | S6 步骤词表不丢（`query_timeseries_agg`/`search_knowledge`/`plan_slice` 迁移后仍可执行） | 🔗 | `skill-graph.ts:421-445` · `workflow/executor.ts` | 图编译器**显式点名拒绝**覆盖不到的 type（不静默丢），且注释保留三类可执行性；但**没有一条测试驱动这三类走完 Skill→执行**（因为 Skill 无 execution 字段） |
| D207 | S7 acceptance 派生（派生 EvalCase 满足门二三类覆盖；删一类 → 发布红） | ⚠️只有后半 | `server.ts:1293-1302` · `skill-lint.ts:83` | 「删一类 → 发布红」**已成立**（`SKILL_EVAL_COVERAGE` 422）；「从 `acceptance` 派生」❌ |
| D208 | S8 entitlement 一处（关 feature → Skill 与其意图同时不可达） | ❌ | `features.ts:16-22` | `bindings` 无 `skills` ⇒ 半开态仍可能 |

### §11 诚实边界 · 事实核实清单（D209–D215）

| # | PRD 的事实断言 | 档 | 我的复验 | 追的那一层调用 |
|---|---|---|---|---|
| D209 | `SkillDefinitionSchema` 18 字段、其中工业级字段 9 个全 optional | ✅断言正确 | `agentcore.ts:236-261` | 逐字段数：`id/tenantId/key/version/name/summary/body/resources/status` 9 必填 + 9 optional = 18 |
| D210 | `maxBudgetRounds` **零消费方** | ✅断言正确 | `grep -rn maxBudgetRounds apps/*/src packages/*/src` = 1（契约声明） | 金丝雀：同命令 grep `provenancePolicy` = 多处命中 ⇒ 工具正常 |
| D211 | `outputSchema` 无校验消费方；`dependsOn` 有代码消费方但 7/7 全空；`references[]` 有真运行时消费方 | ✅三条全部正确 | `skill-lint.ts:300` · `resource-projector.ts:149` · `skill-lint.ts:238,348` · `engine.ts:92` | 实测种子：`dependsOn` 非空 **0/7**、`references` 非空 **6/7** ⇒ 两字段定性不同，PRD 分开叙述正确 |
| D212 | 7 个种子 Skill `resources` 全空 · 5 PUBLISHED / 2 DRAFT · body 均值 441 字 | ✅前两条正确·第三条 442 | `seedRegistry("demo")` 实跑 | `resources` 非空 0；PUBLISHED 5 / DRAFT 2；body 均值 **442**（PRD 写 441，差 1 字，无实质影响） |
| D213 | lint 上限（200/3000）与契约上限（400/50_000）不一致 | ✅断言正确 | `skill-lint.ts:46-47` vs `agentcore.ts:242-243` | 两值都未动 |
| D214 | 计划步骤真实词表比 contracts 宽 3 种；工具 28+2=30；`FeatureDef.bindings` 无 skills；发布路径无跨注册表引用校验；`validateRefResolution` 只校验 `kind==="skill"` | 🔗 4 条正确 · **1 条已过期** | `catalog/service.ts:28-36` ✓ · 工具实测 30 ✓ · `features.ts:16-22` ✓ · `skill-lint.ts:192-236` ✓ | **「发布路径无跨注册表引用校验」已被 `refclosure-a` 修掉**（`server.ts:1272`）⇒ PRD §11.1 该行**今日已过期，须回写** |
| D215 | §11.2 未核实清单 8 条 + §11.3 三件未做的事（`AnyPlanStepSchema` 收编 / `bindings.skills` 扩面 / 32 份 Plan 迁移） | ⛔诚实分栏正确·**三件未做全部仍未做** | `catalog/service.ts:36` · `features.ts:16-22` · `seed.ts:210` | 三件逐条复验：① 仍在 app 本地 ② 仍无 skills ③ 32 Plan 一条未迁 ⇒ PRD 自述「三者任一缺席，本契约都只是声明了没接线」**当前三者全缺席** |

---

## 3. CMP 逐条表（`PRD-skill-compiler-registry.md` · 240 条）

> **重要前置**：CMP 的实现主体在**未并**分支 `claude/handoff-skill-compiler-s1`。
> 该分支共 7 个文件 / +1513 行：`packages/contracts/src/skill-compile.ts`(654) ·
> `apps/agentcore/src/skill-compiler.ts`(253) · `server.ts` +25（`POST /b/v1/skills/:id/compile`）+ 两份测试。
> 下表 **[未并]** = 该分支上有；**[未并·仍❌]** = 并了也不满足。

### §0 本体引用与影响（C001–C040）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| C001 | 触及 H 域既有对象类型（Skill/Intent/ExecutionPlan/Agent/Eval*/ResourceDescriptor/Scenario） | ✅文档层 | CMP §0 | 全部为只读消费方，未改其契约 |
| C002 | 被引用校验目标：C 域 Rule · E 域 Solver/SolverArtifact · B 域 ObjectType/SliceSpec · H 域 MCP tool | 🔗 **3/5** | `apps/agentcore/src/resources.ts:76-86` | 探针实际只查 Rule / Solver / ObjectType；**SliceSpec 与 MCP tool 无校验** |
| C003 | 新增对象类型 `SkillRuntimePackage`（编译产物） | ❌ canonical / **[未并·仍❌]** | `grep SkillRuntimePackage` canonical src=0 | compiler-s1 上 3 处命中**全是注释/NOT_IMPLEMENTED 文案**（`skill-compiler.ts:222-226` 明写「本切片全未做」）⇒ 并了也没有 |
| C004 | 新增 `SkillPackageManifest`（分发清单） | ❌ / **[未并·仍❌]** | compiler-s1 grep = 0 | — |
| C005 | 新增 `SkillCompileReport`（诊断报告） | 🔗[未并] | `packages/contracts/src/skill-compile.ts:333`(compiler-s1) | 名字是 `SkillCompileResultSchema`（含 `diagnostics[]`+`stages[]`），**不叫 `SkillCompileReport`**；语义覆盖但命名与 CMP §3.2 术语表不符 |
| C006 | 链路：Skill 引用链从「声明」升级为「发布期硬校验 + 可反查」 | 🔗 **前半✅ 后半❌** | `server.ts:1272`（硬校验）· `dril/relations.ts:44`（反查） | 硬校验已成立；反查**未成立**（`extractRelations` 零 src 调用方，见 D165） |
| C007 | 链路：编排链运行语义**不改**，编译产物迁移前**不接入运行时** | ⛔不改·未违规 | `apps/agentcore/src/server.ts:1333`(compiler-s1) | compile 端点是纯只读：不落库、不改状态、不发事件（注释与代码一致，逐行确认） |
| C008 | 链路：`Skill --evaluatedBy--> EvalCase(suite=skill_quality)` 复用不新建 | ✅ | `server.ts:1288` | 发布门读既有 `skill_quality` 套件 |
| C009 | 链路：`Skill --projectedTo--> SkillResource` 是反向影响面承载面（§2.3 发现今天断了） | ❌未修 | `dril/relations.ts:69-74` | 生产投影只有 agent→skill 一条边，**无 skill→refs** |
| C010 | 切片 `sys.orch.query_to_answer`(D7) / `sys.meta.change_loop`(D11) | ✅文档层 | CMP §0 | — |
| C011 | 事件：复用 `skill.published`，**事件名不变**，`ontology:check` 事件集不动 | ✅ | `server.ts:1301` · `event-subscriptions.ts:41` | `pnpm prd:check` RC=0；事件名未增 |
| C012 | 事件：新增 **1 个** `skill.compiled`（+ 回写本体 §4 + `event-subscriptions.ts`） | ❌ / **[未并·仍❌]** | `grep -rn "skill.compiled" apps packages scripts docs` = **0** | 金丝雀：同命令 grep `skill.published` 多处命中 ⇒ 工具正常。compiler-s1 也没发它（compile 端点明写「不发领域事件」） |
| C013 | **不新增**注册/退役事件 | ⛔不新造·未违规 | `server.ts:1412-1424` | retire 路径仍无 `emitDomainEvent` |
| C014 | `retire` 今天不发事件 = 既有 D-29 缺口，**本期不修**、只记录 | ⛔本期不做·**标注诚实** | `server.ts:1412-1424` | 反向查：确实没人偷偷修了它 |
| C015 | R1：三个新契约落 `packages/contracts`；编译器实现只在 AgentCore、不跨包共享实现 | ✅[未并] | `packages/contracts/src/skill-compile.ts` + `apps/agentcore/src/skill-compiler.ts` | 分层正确：契约层纯函数、app 层只做 IO 与 lint 桥接 |
| C016 | R2：编译/注册/包/验签/反查全带 tenantId，跨租户 404 | 🔗[未并] | `server.ts:1330`(compiler-s1) | compile 端点 `skill.tenantId !== a.tenantId → 404 SKILL_NOT_FOUND` ✅；包/验签不存在故未覆盖 |
| C017 | R3：新模块暗发 `skill.compiler`（`defaultOn:false`），**双注册** DataCore + AgentCore，关闭 = 404 | ❌ / **[未并·仍❌]** | `grep "skill.compiler" apps/*/src` = 0（两分支均 0） | compile 端点**无 entitlement 门**——这是 compiler-s1 的一处真缺口（R3 违反） |
| C018 | R4：编译不写业务真值；`isWriteModeSkill` 单源不放宽 | ✅[未并] | `apps/agentcore/src/skill-compiler.ts:141` | `GR-APPROVAL` 诊断调 `isWriteModeSkill`，未造第二处判定 |
| C019 | R6：编译是纯函数，同输入 → `SkillRuntimePackage` 字节一致；`digest` = 规范化 SHA-256；禁 `Date.now`/随机 | 🔗[未并] | `skill-compiler.ts:238` | 纯函数 ✅（无 `Date.now`/`Math.random`，逐行确认）；**`digest` 与 `SkillRuntimePackage` 不存在** ⇒ 判据的后半无从验 |
| C020 | R7：`SKILL_COMPILE_FAILED` / `SKILL_REF_UNRESOLVED` / `SKILL_SIGNATURE_INVALID` 沿用既有信封 | 🔗 **1/3 且未登记** | `server.ts:1279` · `packages/contracts/src/common.ts` | 只有 `SKILL_REF_UNRESOLVED` 在**行为里**生效；三个 code **均未进 `ErrorCodes`**（`grep SKILL_ common.ts` = 0，金丝雀 `DATACORE_UNAVAILABLE` 命中） |
| C021 | R9：新表 `skill_runtime_packages` 须四处同改；或走方案 A 不新建表 | ⛔本期取 A·未违规 | `apps/agentcore/migrations/` | 反向查：**无 `011_skill_packages.sql`**、无新表 ⇒ 没有人违规建了半套 |
| C022 | R10：`skill.compiled` 须有生产者 emit + 订阅声明 + 下游失效 | ❌ | 见 C012 | — |
| C023 | R11：引用清单闭合才允许 PUBLISHED | 🔗 **3/8 kind** | `resources.ts:76-86` + `skill-lint.ts:192` | `skill` kind 由 lint 闭合 ✅ + solver/rule/objectType 由探针闭合 ✅；`constraint/slice/workflow/agent` **无人校验** |
| C024 | R13：诊断必带 `{code, severity, path(JSON Pointer), evidence}` | ✅[未并] | `packages/contracts/src/skill-compile.ts:72-82` | `SkillCompileDiagnosticSchema` 四字段齐全；`skill-compiler.ts` 每条诊断都填了 `evidence` |
| C025 | R14：编译器零业务常数，规则码/求解器键/对象类型名一律从注册表查 | 🔗[未并] | `skill-compiler.ts:114` | `RG-TOOL` 从 `registeredToolNames()` 查 ✅；但**规则码/求解器键根本没查**（`RG-NOT-WIRED` 自述），故"不内联白名单"是**因为没做而成立**，不是因为做对了 |
| C026 | R15：新增对外能力必须有 CLI 命令或 GUI 深链 | ❌ | `scripts/platform-cli.mjs`（`grep -i skill` = **0**） | 金丝雀：同文件 `grep -c run` = 4 ⇒ 工具正常。compile 端点**无 CLI、无前端入口** |
| C027 | R16：编译/发布产物计入 `producedArtifacts`；引用缺失自动开 `GrowthTicket` | ❌ | `grep producedArtifacts` 与 compile 路径无交集 | compile 端点不写任何产物 |
| C028 | R18 尺度自洽：不触及 | ⛔绝对不做·未违规 | — | — |
| C029 | CLI：沿用 `OPERATION_CATALOG` 的 `op:"skill"` 条目，不新增第二条 | ✅ | `packages/contracts/src/operation-intent.ts:67` | 条目在且未被复制 |
| C030 | CLI：**必须**在 `run{}` 落 `skill` 子命令实现 `create\|validate\|compile\|package\|publish\|inspect` | ❌ | `scripts/platform-cli.mjs` grep 0 | 六个动作一个都没有 |
| C031 | CLI：`dos skill …` 一律映射到 `platform skill …`，**不另起第二个 CLI 二进制** | ⛔不新造·未违规 | `scripts/` | 反向查：无第二个 CLI 入口 |
| C032 | G-1：引用可校验门从 workflow/agent 扩到 skill | ✅ | `server.ts:1272` | 已扩 |
| C033 | G-4：Skill 编译/包管理需要前端入口 `/admin/skills` | 🔗 | `apps/frontend-shell/src/App.tsx:160` · `pages/admin/SkillsPage.tsx`(93 行) | 页面在且已注册路由 ✅；但 grep `compile\|supersede\|rollback\|deprecat\|TESTING\|lint` 在该页 = **0** ⇒ 新能力无入口 |
| C034 | G-8：`SkillRuntimePackage` 引用闭合结果并入 `chain:check` | ❌ | `scripts/check-chain-closure.mjs` | 无 skill 维 |
| C035 | G-10：Skill 侧 rule 引用清单让「改 C08 影响哪些 Skill」可查 | ❌ | 见 C009/D165 | 反查未通 |
| C036 | `G-SIDEEFFECT-VOCAB-SPLIT`：所有词表一律从契约单一来源派生，禁在编译器里手抄枚举 | ✅[未并] | `apps/agentcore/src/skill-compiler.ts` import 段 | 逐个 import 核对：`isWriteModeSkill`/`SKILL_COMPILE_STAGES` 等全从 `@platform/contracts` 取，无手抄 |
| C037 | `G-SKILL-UNREACHABLE-FREE-QA`：编译产物**不得**新开第二条注入路径 | ⛔不新造·未违规 | `server.ts:1333`(compiler-s1) | compile 端点只读，不注入 prompt |
| C038 | 新登记 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` | ✅ | `docs/SYSTEM-ONTOLOGY.md:1073` | 已在册且三处分别定性 |
| C039 | 需走 8 道既有门 + 新增 `skill-compiler:check` | 🔗 **既有门在·新门❌** | `package.json:11-48` | 26 个门里**无 `skill-compiler:check`**（金丝雀：同串 `ref-closure:check` 命中 ⇒ 工具正常） |
| C040 | 回写承诺：本体 §2H/§3/§4/§7/§8 五处 | 🔗 **1/5** | `docs/SYSTEM-ONTOLOGY.md:936,1073` | §7（`ref-closure:check`）+ §8（断点）已回写；§2H 三对象类型 / §3 两条边 / §4 `skill.compiled` **均未回写**（对应能力也未落地，故非"回写欠账"而是"能力欠账"） |

### §1 目标 / 非目标（C041–C053）

| # | 需求 | 档 | file:line | 追的那一层调用 |
|---|---|---|---|---|
| C041 | O1 引用可校验门成为**必配硬门**：引用不存在的 rule/solver/objectType/tool/skill → publish **被拒**（非告警），错误点名 key + 注册表 + 端点 | 🔗 **rule/solver/objectType/skill 达成；tool 未达** | `server.ts:1272-1281` · `resources.ts:9-13` | 拒绝理由含「求解器「X」在 DataCore 未注册」并点名注册表来源（`PROBE_SOURCE`），**但未点名"查询用的哪个端点"**（只到注册表方法名）；`tool` kind 不存在故无从校验 |
| C042 | O2 推理图静态可校验（有环/异常路径未定义/终止节点缺失 → 编译期红） | 🔗[未并] | `apps/agentcore/src/skill-compiler.ts:129`(GR-REACH) | 有 `GR-REACH`（可达性）；**环检测**由 `detectSkillDependencyCycle` 走 skill 依赖图，不是推理图；**`GR-EXCEPTION`（onError 必填）未实现** |
| C043 | O3 命名红线不被突破，静态门守 | ❌门 | `package.json` | 无 `skill-compiler:check`；人工核：compiler-s1 产物名无 `ExecutionPlan`/`ExecutionGraph` ✅（但无门锁住） |
| C044 | O4 生命周期完整 DRAFT→TESTING→PUBLISHED→DEPRECATED(+RETIRED)，非法跃迁 409 | ❌ | `packages/contracts/src/agentcore.ts:247` | `status` 仍三值；`grep TESTING\|DEPRECATED` 在 Skill 契约 = 0 |
| C045 | O5 `supersedes` 一等、可查询、回滚可执行 | ❌ | `grep supersedes` 全仓 = 0 | 金丝雀：同 grep 对 `dependsOn` 命中 23 处 ⇒ 工具正常 |
| C046 | O6 `.skill` 包自足可分发且可验签；宿主不满足**拒绝安装** | ❌ | 无包机制（`grep manifest\|signature` 见 §14.3 复跑） | — |
| C047 | O7 API 面零重复：八组能力一律代理既有端点，新增实现为零；静态门守禁止清单 | ✅行为·❌门 | `server.ts`(compiler-s1 diff 仅 +25 行、只加一个端点) | 逐行核 diff：**未新增任何 ontology/rule/solver/workflow 路由**，未 import DataCore 源码 ⇒ 行为达标；但**无静态门锁**（C039） |
| C048 | 不做 Track E 迁移本身 | ⛔另立单·未违规 | — | 反向查：无 Plan→Skill 迁移代码 |
| C049 | 不做 Skill Orchestrator | ⛔绝对不做·**已被别人做了一半** | `packages/contracts/src/skill-graph.ts` · `server.ts:1360` | ⚠️ 注意：`orchestrator-s1` 分支**已并入** `GraphScheduler` + `POST /b/v1/skill-graphs/run` ⇒ CMP 声明的"非目标"由**另一张单**落地，非 CMP 违规，但 CMP §1.2 该行**已过期** |
| C050 | 不做 Learning Loop（前置未解） | ⛔本期不做·**标注诚实** | CMP §1.2/§14.2 | 反向查：无采纳率回流代码 |
| C051 | **不改**规则 DSL / 求解器 / 本体 / MCP 的语义与实现 | ⛔不改·未违规 | compiler-s1 diff 7 文件 | 逐文件核：无一触及 ruledsl/solvers/ontology/mcp |
| C052 | **不引入**第二套规则语法 / 第二套约束语法 / 第二个 CLI 二进制 / 第二条 Skill 注入路径 | ⛔不新造·未违规 | 同上 | 四项逐条反向查，均未违规 |
| C053 | **不夹带模型文件**（`.lp`/`.mps`），编译器遇到直接拒绝 | ⛔绝对不做·**拒绝逻辑❌** | `skill-compiler.ts` grep `.lp\|.mps` = 0 | 未违规夹带 ✅，但 `GV-NO-MODEL-FILE` 检查**未实现**（无包故也无从触发） |

### §2 现状与缺口（C054–C086）

**§2.1 今天真有的（14 条 · CMP 自称"可复用不重造"）**

| # | 断言 | 我的复验 | file:line |
|---|---|---|---|
| C054 | Skill 契约 18 字段 + 9 个 WO-SKILL-1 治理字段 | ✅正确 | `agentcore.ts:236-261` |
| C055 | 引用词表单一来源 `SKILL_REFERENCE_KINDS`(8, **无 tool/mcp**) / `SKILL_REFERENCE_ROLES`(4) | ✅正确 | `agentcore.ts:216-217` |
| C056 | 结构 lint（summary/body/正反例/resource 可解析/工具名反查/JSON Schema 形状/引用合法性/dependsOn 可解析+需 PUBLISHED+无环） | ✅正确 | `skill-lint.ts:250-356` |
| C057 | lint 干跑端点 `POST /b/v1/skills/lint`（不改状态） | ✅正确 | `server.ts:1328` |
| C058 | 发布门四关（lint / 用例≥3 / 三类覆盖 / 探针 passRate=1） | ✅正确·**且已加第五关** | `server.ts:1249,1286,1293,1305` + **`:1272` 引用探针**（CMP 写作时还没有） |
| C059 | 探针 `runSkillProbe`（挂载/不挂载孪生对照，走真实 `runRegisteredAgent`） | ✅正确 | `apps/agentcore/src/skill-probe.ts` |
| C060 | `probeMissingRefs` 已建但没给 skill 用 | ✅ 断言**已过期**（今天已接） | `server.ts:1272` —— 2026-08-09 已接（`refclosure-a`） |
| C061 | `validatePlanSteps`（id 重复/前向引用/render_answer 末步/越级/超时≤5min） | ✅正确 | `workflow/validate.ts:71` |
| C062 | `detectStaticCycle`（agent↔workflow 可达环） | ✅正确 | `workflow/validate.ts:117`（`export async function`——用 `^export function` 会漏，已改用全词 grep 复核） |
| C063 | `deriveRenderBindings` | ✅正确 | `workflow/validate.ts:42` |
| C064 | 版本派生 `POST /b/v1/skills/:id/new-version` | ✅正确 | `server.ts:1391` |
| C065 | 反查（部分）`computeReferences(kind="skill")` **只**返回挂载该 skill 的 agent | ✅正确 | `resources.ts:176` |
| C066 | 资源投影 `projectSkills` → `SkillResource`（`ioSpecFromJsonSchema` 派生 inputSpec/outputSpec） | ✅正确 | `dril/resource-projector.ts:141-170` |
| C067 | 密码学原语已在（AES-256-GCM / RS256 / JWKS），签名无需新依赖 | ✅正确 | `apps/agentcore/src/crypto.ts` · `apps/datacore/src/auth.ts:71-84` · `app.ts:943` |

**§2.2 今天确实没有的（12 条 · 复验是否仍然没有）**

| # | 断言 | 今天 | file:line |
|---|---|---|---|
| C068 | Skill Compiler / AST / Optimizer / Runtime Package | ❌仍无（canonical）· 🔗[未并] Parser+Validator+图派生有，Optimizer/Package 明标 NOT_IMPLEMENTED | `skill-compiler.ts:203-227`(compiler-s1) |
| C069 | `.skill` 包 / `manifest.json` / `signature/` | ❌仍无 | `grep manifest` 只命中 `scaffold.manifest_recorded` 与 StoryBuildRun |
| C070 | 任何包签名机制 | ❌仍无 | 复跑 §14.3 命令：全仓命中 **2** 处，均为 JWT（`agentcore/auth.ts` 报错文案 · `datacore/auth.ts` 签发） |
| C071 | YAML 解析器 / zip·tar 库 | ❌仍无 | 复跑：`grep yaml\|adm-zip\|jszip\|"tar"` 三处 package.json = **0** |
| C072 | Skill 侧 `supersedes/owner/domain/category/riskLevel` | ❌五项仍全无 | `agentcore.ts:236-261` 逐字段核 |
| C073 | manifest `runtime` 版本约束 / `dependencies` | ❌仍无 | — |
| C074 | `SkillReference.kind` 覆盖 tool/mcp | ❌仍无 ⇒「Skill 声明用哪些工具」今天无处声明 | `agentcore.ts:216` |
| C075 | `outputSchema` 的校验消费方 | ❌仍无（3 处命中仍只是形状 lint + 投影） | `skill-lint.ts:300` · `resource-projector.ts:149` |
| C076 | Skill 发布的引用存在性探针 | ✅ 断言**已过期·今天已有** | `server.ts:1272` |
| C077 | Skill 相关的任何 `*:check` 门 | 🔗 断言**已过期·已有一道**（非 CMP 要的那道） | `package.json:35` `ref-closure:check`（但**不是** CMP 要的 `skill-compiler:check`） |
| C078 | skill retire 的领域事件 | ❌仍无 | `server.ts:1412-1424` 无 `emitDomainEvent` |
| C079 | （§2.2 表整体口径）12 条中 **2 条已过期**（C076/C077）、**10 条仍成立** | 🔗 | — |

**§2.3 三处「声明了没接线」+ §2.4 命名占用（C080–C086）**

| # | 断言 | 今天 | 追的那一层调用 |
|---|---|---|---|
| C080 | (a) `probeMissingRefs` 已证可用但 skill 发布路没接 | ✅ **已修** | `server.ts:1272`；CMP 开的处方（"把已有探针接上去 + fail-open 改 fail-closed"）**被逐字执行** |
| C081 | (a·续) SPEC §5「这道门今天做不了」需修正为「声明有一半、缺的是接线」 | ✅CMP 判断正确 | 事后验证：修法确实是接线（+25 行）而非造门 |
| C082 | (b) `probeMissingRefs` 是 fail-open 的，直接当硬门会造出「DataCore 挂了就全部放行」 | ✅ **已修** | `resources.ts:15-46`：`catch → throw 503 REF_PROBE_UNAVAILABLE`，`known.size === 0` 也 throw ⇒ 两层 fail-open 关死 |
| C083 | (c) Skill 引用边抽取函数 `extractRelations` 有测试有实现**零生产调用方** | ❌ **仍成立·未修** | `resource-projector.ts:296` 定义 + `test/dril-registry.test.ts:11,177,204` 三处 test；`apps/*/src`+`packages/*/src` = **0**。生产路 `resource-registry.ts:220` 调的是 `relations.ts:44 extractResourceRelations`，该函数 `:69-74` 唯一 skill 分支只做 agent→skill |
| C084 | (c·续) 额外注意：`present` 过滤会让悬挂边**静默消失**，故关系图不能当校验器 | ✅判断成立·**未落地对策** | `resource-registry.ts:224-226` 过滤仍在；**无 `danglingRelations[]`** |
| C085 | §2.4 `ExecutionPlanSchema` 定义在 `qos.ts:180`，`type` 在 :188 | ✅（今日 :181/:188，位移 1 行） | `qos.ts:181,188` |
| C086 | §2.4 种子 = 手写 **4** + catalog **16** + ceoCaps **12** = 32 意图/32 计划 | 🔗 **总数对·算式错** | 实测 **5 + 16 + 11 = 32**（详见 §1.3）——两个加数都错，错误互相抵消 |

### §3 命名红线与术语表（C087–C096）

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C087 | 红线 1：产物不得叫 `ExecutionPlan`/`ExecutionGraph`/「执行计划」/「执行图」 | ✅未违规·❌无门 | compiler-s1 产物名逐个核；`package.json` 无守门脚本 |
| C088 | 红线 2：禁用外部产品名；`dos skill` 改 `platform skill` | ⛔不改·**未落地** | `platform-cli.mjs` 无 skill 子命令（C030） |
| C089 | 红线 3：禁止手抄枚举，一律 import 自 `@platform/contracts` | ✅[未并] | `skill-compiler.ts` import 段逐条核 |
| C090 | 术语 `SkillSource` | ❌[未并·仍❌] | compiler-s1 grep = 0（Parser 直接吃 `SkillDefinition`，跳过了 SkillSource 这一层） |
| C091 | 术语 `SkillAst` | ✅[未并] | `packages/contracts/src/skill-compile.ts:186,241` |
| C092 | 术语 `SkillReasoningGraph` | ✅[未并] | `skill-compile.ts:321,327` |
| C093 | 术语 `SkillRuntimePackage` | ❌[未并·仍❌] | 仅出现在 NOT_IMPLEMENTED 文案 |
| C094 | 术语 `SkillPackageManifest` | ❌[未并·仍❌] | grep 0 |
| C095 | 术语 `SkillCompileReport` | 🔗[未并] | 实现叫 `SkillCompileResult`（`skill-compile.ts:333`）——语义在、名字不符 |
| C096 | 术语 `skill.execution.steps`「类型复用既有 `PlanStepSchema`」 | 🔗**有意偏离** | `skill-graph.ts:377-397`：元素是放宽的 `SkillExecutionStepSchema`（理由写在 :356-366：闭合联合会挡掉 ExtraToolStep 三类）⇒ 理由成立但**CMP 术语表未回写** |

### §4 Skill Compiler（C097–C146）

**§4.1 管线（C097–C101）**

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C097 | ① Parser 纯函数·无 IO·无网络 | ✅[未并] | `skill-compile.ts:417 parseSkillToAst`，无 IO |
| C098 | SkillAst 带位置信息（JSON Pointer，供诊断定位） | ✅[未并] | `SkillCompileDiagnosticSchema.path`，每条诊断都填（如 `/references`） |
| C099 | ② Validator 是唯一需要 IO 的一段，IO 集中在可注入的 `RefResolver` 接口 | ❌[未并·仍❌] | `skill-compiler.ts:84 validateSkillAst` **完全无 IO**（因为跨系统校验没做，见 `RG-NOT-WIRED`）⇒ `RefResolver` 接口不存在 |
| C100 | ③ Optimizer 纯函数 | ❌[未并·仍❌] | `stageReports` 明标 `optimize: NOT_IMPLEMENTED` |
| C101 | 产物：`SkillRuntimePackage` + `SkillCompileReport`（含通过项） | 🔗[未并] | 只产 `SkillCompileResult{ast,graph,diagnostics,stages}`；**无 RuntimePackage**；诊断只收违规项，不含"通过项" |

**§4.2 RG 组 · 引用可校验门（C102–C114）**

| # | 码 | 断言 | 档 | 证据 |
|---|---|---|---|---|
| C102 | RG-RULE | rule/constraint key ∈ 本租户规则库且 **PUBLISHED** | 🔗 | 存在性由 `probeMissingRefs`(`resources.ts:80`) 校验 ✅；**"且 PUBLISHED"未校验**——`listRuleKeys` 的过滤语义 CMP §14.2 自标未核实，我实测调用点只取 key 不看状态 ⇒ 引用 DRAFT 规则今天会判通过 |
| C103 | RG-SOLVER | solver key ∈ 求解器目录 | ✅ | `resources.ts:77` `catalog.discover(ctx,"solvers")` |
| C104 | RG-SOLVER-TRUST | 引用 provisional 求解器须显式声明容忍 | ❌ | `apps/datacore/src/solvers/service.ts:538-551` 有 `trustLevel:"UNVERIFIED"`/`PROVISIONAL` 概念，**Skill 侧无声明面、无判定** |
| C105 | RG-TYPE | ontologyType key ∈ 已发布 ACTIVE 类型 | ✅ | `resources.ts:83` |
| C106 | RG-TYPE-PROP | `requires` 声明的必需属性在类型属性表里存在 | ❌ | 契约无处声明（`requires` 不存在） |
| C107 | RG-SLICE | slice key ∈ 切片库 | ❌ | 探针不查 slice（`resources.ts:76-86` 三段） |
| C108 | RG-TOOL | tool key ∈ 工具注册表 | 🔗[未并] | compiler-s1 `skill-compiler.ts:114` 实现了 `RG-TOOL`，但输入是 **body 文本里提到的工具名**（复用 `registeredToolNames()`），不是 `references[kind=tool]`（该 kind 不存在） |
| C109 | RG-MCP | mcp key（`server.tool`）∈ 本租户已发布 MCP 工具清单 | ❌ | kind 不存在 |
| C110 | RG-SKILL | `dependsOn` 的 skill 在本租户存在且发布期须 PUBLISHED | ✅ | `skill-lint.ts:192 validateRefResolution` + `server.ts:1249` 传 `requirePublishedDeps:true` |
| C111 | RG-WF/AGENT | workflow/agent key ∈ 本租户注册表且非 RETIRED | ❌ | 无校验 |
| C112 | RG-DUP | 同 `{kind,key}` 不重复 | ✅ | `skill-lint.ts:146-151` 区段 |
| C113 | RG-VOCAB | kind/role ∈ 契约词表 | ✅ | `skill-lint.ts:134-142`，词表从 `SKILL_REFERENCE_KINDS/ROLES` 派生 |
| C114 | RG-OPTIONAL | `required:false` 解析失败 → warning 不阻断，但必须进报告与 manifest | 🔗 | `skill-lint.ts` 有 `required !== false` 语义 ✅；发布探针也按 `r.required !== false` 过滤（`server.ts:1268`）✅；**manifest 不存在** ⇒ "安装方一眼看见缺什么"未达成 |

**§4.2 GR 组 · 推理图与执行图形（C115–C121）**

| # | 码 | 断言 | 档 | 证据 |
|---|---|---|---|---|
| C115 | GR-ACYCLIC | 推理图无环 | 🔗 | skill **依赖图**无环已有（`skill-lint.ts:238`）；**推理图**环检测在 canonical 由 `SkillGraphCompileError` 覆盖（`server.ts:1379`），但那是 HTTP body 驱动、不是 Skill 声明驱动 |
| C116 | GR-REACH | 每节点从入口可达；每路径终止于已定义终止节点 | 🔗[未并] | `skill-compiler.ts:129` 有 `GR-REACH`；"终止于已定义终止节点"由 `deriveSkillReasoningGraph` 的固定 exit 节点保证（`skill-compile.ts:512-514`） |
| C117 | GR-EXCEPTION | 每个可失败节点必须声明 `onError`，否则拒绝 | ❌ | `skill-compiler.ts` grep `onError` = 0；`OnErrorSchema` 在契约里但无此判据 |
| C118 | GR-APPROVAL | WRITE/approvalGate≠none 的 Skill 图里必须有审批或 `action_draft` 终止节点；判定**只用** `isWriteModeSkill` | ✅[未并] | `skill-compiler.ts:141` + `skill-compile.ts:373 WRITE_MODE_REQUIRED_TOOL="create_action_draft"` |
| C119 | GR-STEPS | 若含 `execution.steps` 逐条跑 `validatePlanSteps`，**一行不重写** | 🔗[未并] | `skill-compiler.ts:175` 有 `GR-STEPS`，但**同时有 `GR-STEPS-NO-DATA`**（:165）——因为 `SkillDefinition` 上没有 `execution` 字段，`readSkillExecutionSteps`(`skill-compile.ts:386`) 恒返回 `declared:false` ⇒ **这条判据今天恒不触发**（接了线没数据） |
| C120 | GR-SHAPE | render 节点引用的求解器输出字段 ⊆ 该求解器输出形状 | ❌ | `deriveRenderBindings`+`SOLVER_OUTPUT_SHAPES`(`solvers/service.ts:260`) 两半都在，**没有一处把它们对上** |
| C121 | GR-BUDGET | `maxBudgetRounds` 须正整数且 ≤ 平台上界，**且必须能被运行时读到**；本期只做声明期校验 + 写入 runtime package | ❌[未并·仍❌]·**⛔本期不做部分标注诚实** | compiler-s1 无 `GR-BUDGET` 诊断（grep `maxBudgetRounds` 在 skill-compiler.ts = 0）；runtime package 也不存在 ⇒ **连"本期该做的那一半"也没做**（区别于 §10.3 的"运行时未接"——那部分标注是诚实的） |

**§4.2 IO 组（C122–C125）**

| # | 码 | 断言 | 档 | 证据 |
|---|---|---|---|---|
| C122 | IO-SHAPE | `inputSchema`/`outputSchema` 是合法 JSON Schema（复用 `validateJsonSchemaShape`） | ✅ | `skill-lint.ts:104-115` 区段 + `:329` 调用；compiler-s1 经 `GV-LINT` 全量复用 |
| C123 | IO-SLOT-ALIGN | Skill 绑定意图时 `inputSchema.required ⊆ 意图 slots[]`，编译期对账 | ❌ | 无 Skill→Intent 绑定字段，无从对账 |
| C124 | IO-ARG-FIDELITY | `inputSchema` 的过滤维必须出现在 `execution.steps` 的求解器入参里，或列显式豁免 | ❌ | `execution.steps` 恒空（C119）⇒ 无从校验；同族门 `arg-drop-seam:check` 存在但守的是别的路径 |
| C125 | IO-OUTPUT-CONSUMER | `outputSchema` 声明后必须记录谁校验它，无消费方 → warning 并点名 | ✅[未并] | `skill-compiler.ts:152` 有 `IO-OUTPUT-CONSUMER` 诊断，措辞即"此声明目前无人消费" ⇒ **CMP 唯一被逐字实现的诚实诊断** |

**§4.2 GV 组（C126–C131）**

| # | 码 | 断言 | 档 | 证据 |
|---|---|---|---|---|
| C126 | GV-LINT | 全量复用 `lintSkill`，**不重写** | ✅[未并] | `skill-compiler.ts:99` 把 `lintSkill` 结果整体转成 `GV-LINT` 诊断；且**传了 `ctx.allSkills`**（`server.ts:1349` 注释点名不传等于接了线没通） |
| C127 | GV-NO-MODEL-FILE | 包内出现 `.lp/.mps/.nl` → 拒绝 | ❌ | 无包机制 |
| C128 | GV-NO-INLINE-DEF | 包内 requires 文件只允许引用形态，出现 `condition:/formula:/properties:` → 拒绝 | ❌ | 同上 |
| C129 | GV-NO-BIZ-CONST | Skill 声明不得内联业务常数，棘轮白名单 | ❌ | `debattery:check` 在但不扫 Skill |
| C130 | GV-NAMING | 编译产物/AST/契约导出名不得含 `ExecutionPlan`/「执行计划」，由 `skill-compiler:check` 静态扫 | ❌门 | 门不存在（C039） |
| C131 | GV-TENANT | 引用解析在 tenantId 内完成，跨租户 key 判 not found（非 403 泄漏） | ✅[未并] | `server.ts:1330`(compiler-s1) 跨租户 → 404 `SKILL_NOT_FOUND` |

**§4.2 DT 组（C132–C134）**

| # | 码 | 断言 | 档 | 证据 |
|---|---|---|---|---|
| C132 | DT-PURE | Parser/Optimizer 源码不含 `Date.now(`/`Math.random(`/`new Date(` | ✅行为[未并]·❌门 | `skill-compile.ts` + `skill-compiler.ts` grep 三者 = 0；**无 `skill-compiler:check` 锁住** |
| C133 | DT-DIGEST | 同输入两次编译 digest 相同、序列化字节相同（§4.5 `sha256(canonicalJson(...))`） | 🔗[未并] | `test/skill-compile.test.ts` 有字节一致断言；**`digest` 字段本身不存在**（`SkillCompileResultSchema` 无 digest） |
| C134 | DT-STABLE-ORDER | 引用表/图节点/诊断按稳定键字典序 | ✅[未并] | `skill-compiler.ts:199` `diagnostics.sort(sortDiagnostics)`；`evidence` 内部也 `.sort()` |

**§4.3 四条硬语义（C135–C138）**

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C135 | 发布期 fail-closed / 草稿期 fail-open；注册表空集**也**视为不可达；**必须有变异反证测试** | ✅ | `resources.ts:15-46`(fail-closed) · `server.ts:1272`(发布期) · `skill-compiler.ts:189 RG-NOT-WIRED`(草稿期显式标"未能校验") · 变异反证：`scripts/check-ref-closure.mjs` 金丝雀 5/5 实跑被咬 |
| C136 | 版本钉在编译产物里（latest → resolvedVersion，同时保留 requestedVersion） | ❌ | 无 `resolvedRefs[]`、无编译产物 |
| C137 | 必配硬门 ≠ 一刀切：`required:false` 降 warning 但必须落 manifest `unresolvedOptional[]` | 🔗 | 降级已有（C114）；manifest ❌ |
| C138 | RG 组**不接受 `force=true` 豁免** | ✅ | `server.ts:1266-1282`：探针段**在 `force` 守卫之外**（三个质量门都写了 `force !== "true"`，探针段没写）⇒ 逐行确认；门 `ref-closure:check` 判据⑤ 另锁位置 |

**§4.4 Optimizer 做 / 不做（C139–C146）**

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C139 | 做：图拓扑排序 + 无依赖节点标同一 `parallelGroup` | 🔗别处已有 | Optimizer ❌；但 `compileSkillGraph`(`skill-graph.ts`) 已做拓扑分层，`GraphScheduler` 按层并发 |
| C140 | 做：引用去重与合并（同 rule 双 role → 合并一条带两 role） | ❌ | 无 |
| C141 | 做：死节点剪除（剪并记 `info`，不静默丢） | ❌ | 无 |
| C142 | 做：常量折叠（版本号内联 / blobKey 归一） | ❌ | 无 |
| C143 | 做：预算下推（`maxBudgetRounds`/`maxDiscoverCalls` 写入图根节点预算槽） | ❌ | 无 |
| C144 | 不做：不改写求解器入参、不选型、不做 LLM 调用 | ⛔不新造·未违规 | `skill-compiler.ts` 无 LLM 调用、无入参改写 |
| C145 | 不做：不跨 Skill 内联/展开（`dependsOn` 保持引用语义） | ⛔不新造·未违规 | 反向查：无展开逻辑 |
| C146 | 不做：不做性能启发式重排 | ⛔不新造·未违规 | 反向查：`sortDiagnostics` 是字典序不是启发式 |

### §5 Skill Registry（C147–C171）

**§5.1 生命周期状态机（C147–C153）**

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C147 | 今天三态 DRAFT/PUBLISHED/RETIRED + 三个跃迁点 | ✅断言正确 | `agentcore.ts:247` · `server.ts:1239,1412,1226` |
| C148 | 新增 `TESTING` 状态（编译已过、跑评测；仅探针可绑；不进生产池） | ❌ | grep 0 |
| C149 | 新增 `DEPRECATED` 状态（可运行、禁新绑定、发现层降权） | ❌ | grep 0 |
| C150 | 状态是 `z.enum`，扩枚举 additive；存量无新态 | ⛔前置未做 | — |
| C151 | **同一 PR 必须**把所有 `status === "PUBLISHED"` 判定点收敛为契约谓词 `isRunnableSkill()`/`isDiscoverableSkill()` | ❌ | `grep isRunnableSkill\|isDiscoverableSkill` = 0；`grep 'status !== "PUBLISHED"' apps/agentcore/src` 仍散落（如 `orchestrator.ts:260`） |
| C152 | 降级读兼容：只认三态的消费方遇 TESTING 按非 PUBLISHED、遇 DEPRECATED 按"PUBLISHED 但不推荐" | ⛔前置未做 | — |
| C153 | 消费方清单须用 `grep -rn 'status === "PUBLISHED"'` 穷举后逐个改 | ⛔前置未做 | — |

**§5.2 发布门装配（C154–C164）**

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C154 | 结论：另起 Skill 自己的发布门，强制复用 `publishIntent` 已证校验器，不复制代码，不把 Skill 挂到意图发布路径 | ✅ | `server.ts:1239` 是独立 handler；未挂 `publishIntent` |
| C155 | 装配 0：auth + `requireCatalogAdmin` | ✅既有 | `server.ts:1240-1241` |
| C156 | 装配 1：存在性 + 租户隔离（R2） | ✅既有 | `server.ts:1242-1244` |
| C157 | 装配 2 ✚：状态机「仅 TESTING 可 → PUBLISHED」 | ❌ | 无状态机 |
| C158 | 装配 3：GV 组 `lintSkill(allSkills + requirePublishedDeps)`，force 可豁免 | ✅既有 | `server.ts:1249-1252` |
| C159 | 装配 4 ✚：**RG 组 fail-closed 且不接受 force** | ✅**已落地** | `server.ts:1266-1282` |
| C160 | 装配 5 ✚：GR/IO/DT 组编译必过，产 `SkillRuntimePackage` | ❌ / [未并·仍❌] | compile 端点与 publish **完全不相干**（compiler-s1 未把 compile 接进 publish） |
| C161 | 装配 6：评测门 ≥3 + 三类各 ≥1 | ✅既有 | `server.ts:1286-1302` |
| C162 | 装配 7：探针实跑 passRate=1 | ✅既有 | `server.ts:1304-1309` |
| C163 | 装配 8 ✚：supersedes 处理，被顶替版 → DEPRECATED | ❌ | 无 |
| C164 | 装配 10 ✚：emit `skill.compiled` + 触发 DRIL 重投影 | ❌ | 无 |

**§5.3 注册与查询 / §5.4 反向影响面（C165–C171）**

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C165 | 注册 = 创建 DRAFT（既有 POST），SDK `/skills/register` 映射到它，不新增第二入口 | ⛔不新造·未违规 | `server.ts:1210` 唯一创建入口 |
| C166 | 查询：新增维度（`status=TESTING\|DEPRECATED`、supersedes 链、digest）走**同一端点过滤参数** | ⛔前置未做·未违规 | `server.ts:1190` `applyListQuery` 未新增端点 |
| C167 | 发现层走既有 `GET /b/v1/resources?kind=skill` 与 `POST /b/v1/resources/search`，新字段须进投影且 description 非空 | ✅既有·⛔新字段无 | `server.ts` 资源路由 + `resource-descriptor:check` 在 gates 串 |
| C168 | §5.4-1 修好投影：把 `extractRelations` 的 skill 抽取**合并进** `extractResourceRelations`（合并，不是两份都留） | ❌未做 | 两个函数**今天仍并存**：`resource-projector.ts:296`（死）+ `relations.ts:44`（活） |
| C169 | §5.4-2 悬挂边不许静默消失：产出 `danglingRelations[]` | ❌ | `grep danglingRelations` = 0 |
| C170 | §5.4-3 反查端点复用 `GET /b/v1/resources/rule/C08/relations` 的 `inbound`，**不新建反查端点** | ⛔不新造·未违规·**但 inbound 里没有 skill** | 端点在（`server.ts` resources relations 路由）；`inbound` 不含引用该 rule 的 skill（因 C168 未做） |
| C171 | §5.4-4 牙测：种引用 C08 的 skill → `inbound` 必含它；删抽取分支 → 必须变红 | ⚠️反向断言存在 | `[未并] test/skill-partial-a-seam.test.ts:178` 有一条**诚实边界测试**：断言 `rels.filter(skill→references/dependsOn)` **等于空数组**——即它把"今天不成立"钉住了，而不是把目标钉住 |

### §6 包与签名（C172–C187）

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C172 | 包结构 13 个文件/目录（manifest/skill/metadata/ontology/rules/tools/solver/reasoning/evaluation/output/signature） | ❌ | 无包机制 |
| C173 | 接线点已在：包内文件天然映射既有 `resources[]`，经 `read_skill_resource` 渐进披露 | ✅机制在·⚠️无数据 | `agentcore.ts:227-234` · `tools/skill-resources.ts` · 7/7 空 |
| C174 | 诚实边界：仓里今天没有任何制品签名机制，本节是**设计**不是现状 | ⛔本期不做·**标注诚实** | 复跑 §14.3 签名命令：2 命中皆 JWT ⇒ 断言正确 |
| C175 | 约束：全仓无 YAML 解析器、无 zip/tar 库 | ✅断言正确 | 复跑 = 0 |
| C176 | 选方案 B（单文件规范化 JSON bundle，零新依赖，键字典序） | ❌未落地 | 无实现 |
| C177 | 方案 C（YAML 作者态）二期可选 | ⛔二期·未违规 | 无 YAML 依赖被偷偷引入 |
| C178 | AgentCore 今天不能收文件上传（multipart 只在 DataCore）；`.skill` 以 JSON body 提交或走 blob 通道，**两条路二选一不要都建** | ✅断言正确·⛔未落地 | `apps/datacore/src/app.ts:7,814` 有 multipart；agentcore 无 |
| C179 | 签名被签内容 = manifest 规范化序列化（含 `contentDigest` Merkle 摘要） | ❌ | — |
| C180 | 算法 RS256/Ed25519，`node:crypto` 零新依赖 | ❌ | — |
| C181 | 信任根复用 JWKS（平台自签 / 租户 `signer.json` 登记公钥） | ❌ | `apps/agentcore/src/auth.ts:28-36` JWKS 拉取在，未被签名复用 |
| C182 | **不复用 JWT 签发密钥本体**（职责分离），新增独立签名密钥对 | ⛔不新造·未违规 | 反向查：无人拿 JWT 私钥去签制品 |
| C183 | 验签时机：install 必验；publish 复验 digest；失败 → `SKILL_SIGNATURE_INVALID` 拒绝安装 | ❌ | — |
| C184 | 未签名包默认拒绝；租户可开 `skill.package.allow-unsigned`（`defaultOn:false`）且必须标「未签名」 | ❌ | `grep skill.package` = 0 |
| C185 | 诚实边界：密钥轮换/CRL/离线验签/供应链来源证明本 PRD **不设计**，标二期 | ⛔二期·**标注诚实** | 反向查：无半成品 |
| C186 | manifest `runtime.compiler/platform` 范围表达式；不在范围 → `SKILL_RUNTIME_INCOMPATIBLE` | ❌ | — |
| C187 | 版本范围求解器自己写（只支持 `>=`/`<`/`=`/`^`）；**Skill `version` 是整数不是 semver**，须写死在契约注释里 | ❌ | 无求解器、无该注释；`agentcore.ts:240` 仍是 `z.number().int()`（事实断言正确） |

### §7 版本演进（C188–C195）

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C188 | 今天：意图池/Skill/计划**仅 DRAFT 可改**；演进靠 new-version | ✅断言正确 | `catalog/service.ts:166-168` · `server.ts:1226` · `catalog/service.ts:246` |
| C189 | 今天：顶替是隐式的——意图侧同 key 旧 PUBLISHED 直接 RETIRED；**Skill 侧连这一步都没有**（同 key 多 PUBLISHED 可并存） | ✅断言正确 | `catalog/service.ts:206-212`（意图侧有）· `server.ts:1311-1312`（skill 侧只置自己） |
| C190 | 消费侧靠「同 key 取最高版本」兜底 | ✅断言正确 | `orchestrator.ts:257-265` |
| C191 | `supersedes?: number` 一等字段 | ❌ | grep 0 |
| C192 | 规则 1-2：只能指向同 key 已 PUBLISHED/DEPRECATED 版；`supersedes < self.version` | ❌ | — |
| C193 | 规则 3：发布副作用 被顶替版 PUBLISHED → **DEPRECATED**（不是 RETIRED） | ❌ | — |
| C194 | 规则 4-5：保留期 N 天（缺省 30）可回滚，**不做自动 retire 定时任务**；`versions[]` 补 `supersedes`/`supersededBy` | ❌·⛔"不做定时任务"未违规 | `server.ts:1198-1208` versions 无这两字段；反向查：无定时 retire 任务 |
| C195 | §7.3 回滚：只能回退一格；不重跑发布门但**必须重跑 RG 组**；不删版本；复用 `skill.published` 事件**不新增 `skill.rolledback`** | ❌·⛔"不新增事件"未违规 | 无 rollback 端点；反向查：无 `skill.rolledback` |

### §8 API 面（C196–C209）

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C196 | 硬约束：**只有** Registry/Compiler/Package 三块是真新增；八组能力一律代理，新增实现为零 | ✅[未并] | compiler-s1 diff 逐行核：`server.ts` 仅 +25 行、只注册 1 个端点 |
| C197 | `/b/v1/skills` GET/POST 既有 | ✅ | `server.ts:1190,1210` |
| C198 | `/b/v1/skills/:id` GET/PUT/DELETE 既有 | ✅ | `server.ts:1198,1226,1425` |
| C199 | ✚ `POST /b/v1/skills/:id/compile`（含 `?dryRun`） | 🔗[未并] | `server.ts:1333`(compiler-s1) 端点在；**`?dryRun` 参数未实现**（注释写"dryRun 语义即默认且唯一行为"——语义等价但**参数不接受**，SDK 按文档传会被忽略） |
| C200 | ✚ `POST /b/v1/skills/compile`（无 id 临时体编译） | ❌[未并·仍❌] | 只有带 `:id` 的那个 |
| C201 | ✚ `GET /b/v1/skills/:id/package` | ❌ | — |
| C202 | ✚ `POST /b/v1/skills/install` | ❌ | — |
| C203 | ✚ `POST /b/v1/skills/:id/promote`（DRAFT→TESTING） | ❌ | — |
| C204 | ✚ `POST /b/v1/skills/:id/deprecate` | ❌ | — |
| C205 | ✚ `POST /b/v1/skills/:id/rollback` | ❌ | — |
| C206 | `/publish` `/retire` `/new-version` `/references` `/resources/:name` 全部既有 | ✅ | `server.ts:1239,1412,1391,1403,1438` |
| C207 | 别名：新端点沿用 `/api/v1` 原生 + `/b/v1` 别名双前缀，不新造第三前缀 | ✅[未并] | compile 端点用同一注册方式 |
| C208 | §8.2 八组能力必须代理到指定既有端点（ontology/mcp/rule/solver/workflow/context/agent/evaluation） | ⛔不新造·未违规 | 反向查 compiler-s1 diff：八组一个都没重造 |
| C209 | §8.3 禁止清单静态断言（重复路由 / import DataCore 源码 / 自建 HTTP 客户端 / 手抄枚举 / `ExecutionPlan` 标识符） | ✅行为·❌门 | 五项人工核均未违规；**`skill-compiler:check` 门不存在** ⇒ 无机械保障 |

### §9 契约 / 数据模型（C210–C218）

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C210 | `SKILL_REFERENCE_KINDS` 加 `"tool"`/`"mcp"`（additive，lint 自动跟随） | ❌ | `agentcore.ts:216` 仍八值 |
| C211 | `SkillDefinitionSchema` 扩 `supersedes/owner/domain/category/riskLevel` | ❌ | 五项全无 |
| C212 | `status` 扩 `TESTING`/`DEPRECATED` | ❌ | `agentcore.ts:247` 三值 |
| C213 | `SkillRequiresSchema` | ❌ | grep 0（两分支均 0） |
| C214 | `SkillReasoningGraphSchema{nodes,edges,entry,exits}` | 🔗[未并] | `skill-compile.ts:321` 有；字段名/形状与 CMP 描述基本吻合 |
| C215 | `SkillRuntimePackageSchema` | ❌[未并·仍❌] | — |
| C216 | `SkillPackageManifestSchema` | ❌ | — |
| C217 | `SkillCompileReportSchema{ok,diagnostics,resolvedRefs,digest?}` | 🔗[未并] | 实现是 `SkillCompileResultSchema`：有 `ok`/`diagnostics` ✅，**无 `resolvedRefs`、无 `digest`** ❌ |
| C218 | `isRunnableSkill()`/`isDiscoverableSkill()` 谓词单源 + `ErrorCodes` 扩 5 个 code | ❌ | 谓词 grep 0；`ErrorCodes` `grep SKILL_` = 0 |

### §12 门禁与 SEAM 验收（C219–C231）

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C219 | 新增门 `skill-compiler:check` 进 `pnpm gates` | ❌ | `package.json:32` gates 串 26 门，无它 |
| C220 | 门判据 1 命名红线 | ❌ | — |
| C221 | 门判据 2 词表单源（不出现字面量重复定义） | ❌ | — |
| C222 | 门判据 3 fail-closed 在（publish/install 路径无裸 `catch {}`） | 🔗**等价能力已由别的门守** | `scripts/check-ref-closure.mjs` 判据②③④ 恰好覆盖此项（且带金丝雀，实跑 5/5 被咬） |
| C223 | 门判据 4 RG 不可 force（publish 处理器中 RG 段不得在 `force !== "true"` 守卫内） | 🔗**等价能力部分覆盖** | `check-ref-closure.mjs` 判据⑤ 守"落库之前"，**不守"不在 force 守卫内"**——今天代码是对的（C138），但**无门锁**，改回 force 可豁免不会红 |
| C224 | 门判据 5 DT 纯函数静态扫 | ❌ | — |
| C225 | 门判据 6 API 禁止清单 | ❌ | — |
| C226 | 门判据 7 **单一抽取器**：全仓 skill→refs 抽取函数恰好一个且有生产调用方 | ❌**且今天就会红** | 今天有**两个**（`resource-projector.ts:296` 死 + `relations.ts:44` 活且不抽 skill 引用）⇒ 该门若真存在，今天会红 |
| C227 | S1：种引用不存在 solver 的 skill → publish 返 4xx `SKILL_REF_UNRESOLVED`、message 含 key 与查询端点、状态未变；变异反证去掉 RG 段 → 变绿即测试失效 | ✅**已落地** | `test/skill-ref-closure.seam.test.ts:74-82`（13 例全绿）；message 含 key + 注册表名（**"查询端点"只到方法名**，见 C041）；变异反证由 `check-ref-closure.mjs` 金丝雀提供 |
| C228 | S2：DataCore 不可达 → publish 返 503 `DATACORE_UNAVAILABLE` 不放行；同场景草稿 compile 返 200 且标"未能校验" | 🔗**错误码不同** | 实现返 **503 `REF_PROBE_UNAVAILABLE`**（`resources.ts:24`）而非 CMP 指定的 `DATACORE_UNAVAILABLE`；行为（不放行）✅、码不符 ❌。草稿侧由 compiler-s1 `RG-NOT-WIRED` 覆盖 |
| C229 | S3：种引用 C08 的 skill → 重投影 → `GET /b/v1/resources/rule/C08/relations` 的 `inbound` 含它；删抽取分支 → 红 | ❌ | 见 C168/C171——今天的测试断言的是**相反命题**（inbound 为空） |
| C230 | S4：顶替与回滚（v2 带 supersedes 发布 → v1=DEPRECATED；回滚互换；引用已退役则拒绝回滚） | ❌ | 无 supersedes/rollback |
| C231 | S5 包往返验签 · S6 确定性 R6（两次 compile 字节相等） | 🔗 S5 ❌ · S6 部分[未并] | S6 有字节一致测试（`test/skill-compile.test.ts`），但断言对象是 `SkillCompileResult` 不是 `SkillRuntimePackage`；digest 不存在 |

### §13 分期（C232–C236）

| # | 期 | 出口判据 | 档 | 证据 |
|---|---|---|---|---|
| C232 | **P0 止血**：① 探针接进 skill publish ② 改 fail-closed ③ RG 不可 force ④ 修抽取器合并 | 🔗 **3/4** | ①②③ 全部由 `refclosure-a` 落地并有门锁；**④ 抽取器合并未做**（C168） |
| C233 | P0 出口：S1+S2+S3 三条 SEAM 绿 | 🔗 **2/3** | S1 ✅（13 例）· S2 ✅行为（码不符）· **S3 ❌** |
| C234 | **P1 契约与编译器骨架** + `skill-compiler:check` 门 + kinds 扩 tool/mcp；出口 S6 绿、门 1-7 green→red 自证 | 🔗[未并] **约 40%** | Parser+Validator（部分组）+ 图派生 + compile 端点有；`SkillRequires`/`SkillRuntimePackage`/`SkillCompileReport` 契约 ❌；门 ❌；kinds 扩展 ❌ |
| C235 | **P2 生命周期与版本**；出口 S4 绿、`grep 'status === "PUBLISHED"'` 清零 | ❌ | 未开工 |
| C236 | **P3 包与签名**（出口 S5）· **P4 CLI 与前端**（出口 `cli-parity:check` 绿、`/admin/skills` 可点到诊断与回滚） | ❌ | 未开工；`/admin/skills` 页在但无编译/版本 UI（C033） |

### §14 诚实边界（C237–C240）

| # | 需求 | 档 | 证据 |
|---|---|---|---|
| C237 | §14.1 本次只读代码只写文档、未跑任何测试/门/seed；计数均静态得出 | ✅自述属实 | 与 §14.3 命令一致；**但正因未跑 seed，§2.4 的 `4+16+12` 才错**（见 §1.3）——这正是"静态读源码"这一方法的代价，CMP 自己标了边界，故**不算"宣称做了"**，算**方法边界导致的事实错误**，须订正 |
| C238 | §14.2 「未核实」8 条明确不装懂（含 `listRuleKeys` 过滤语义、MCP key 形态等） | ✅诚实分栏正确 | 我实测其中 1 条：`listRuleKeys` 调用点确实不看状态 ⇒ CMP 的担心（"引用了 DRAFT 规则却判通过"）**成立**（见 C102） |
| C239 | §14.3 十条可复跑命令 | 🔗 **9/10 复现·1 条数字已变** | 逐条复跑：求解器 **59**（文档写 57，已过期）· 工具 30 ✅ · 规则 28 ✅ · Skill 7 ✅ · 卡 20 ✅ · 无签名 ✅ · 无 YAML/zip ✅ · `probeMissingRefs` **现 3 路**（文档写 2 路，已过期）· `extractRelations` 零生产调用方 ✅ · `outputSchema` 3 处非校验 ✅ |
| C240 | §14.4 五条已知风险（RG 硬门会挡存量 / 状态枚举扩展打崩下游 / `maxBudgetRounds` 无运行时消费方**验收须写"已声明·未接运行时"** / 签名信任根是新攻击面 / lint 与 compile 边界须一次划清） | ✅五条全部诚实·**第 1 条已被现实验证** | 风险 1 实测坐实：出厂 7 个 skill 是**直接以 PUBLISHED 落库**、不走发布路由（`mocks/seed.ts`），故 RG 硬门**看不见它们**——存量没被挡住是因为门够不着，不是因为数据干净（本体 §8 同一记载）；风险 3 的诚实标注是本单 §1.2 判 CMP ✅ 的依据；风险 5 的边界口径（lint 是 compile 的诊断源子集）在 compiler-s1 `skill-compiler.ts:99` 被逐字执行 |

---

## 4. 五档计数

### DSL（215 条）

| 档 | 条数 | 占比 |
|---|---:|---:|
| ✅ 实体层真满足 | 31 | 14.4% |
| 🔗 有实现·接线不全 | 31 | 14.4% |
| ⚠️ 只有 test 引用 / 已排练 | 6 | 2.8% |
| ❌ 无承载物 | 121 | 56.3% |
| ⛔ 文档自标非目标 | 26 | 12.1% |
| **合计** | **215** | |

⛔ 26 条三分：**绝对不做** 2 · **本期不做/另立单** 11 · **不改不新造（反向断言）** 13。
反向断言 13 条**逐条查完：无一条被违规做了**（唯二偏离是 D034/D194 的 `mode` 词表，已按 🔗/⛔偏离单列）。

### CMP（240 条）

| 档 | 条数 | 占比 |
|---|---:|---:|
| ✅ 实体层真满足 | 46 | 19.2% |
| 🔗 有实现·接线不全 | 41 | 17.1% |
| ⚠️ 只有 test 引用 / 已排练 | 2 | 0.8% |
| ❌ 无承载物 | 128 | 53.3% |
| ⛔ 文档自标非目标 | 23 | 9.6% |
| **合计** | **240** | |

其中 **[未并] `compiler-s1` 贡献**：✅ 14 条 · 🔗 12 条 · **[未并·仍❌] 9 条**（并了也不满足：
`SkillRuntimePackage` / `SkillPackageManifest` / `SkillSource` / `RefResolver` / Optimizer /
`/b/v1/skills/compile`（无 id）/ `skill.compiled` 事件 / `skill.compiler` entitlement / `SkillRequiresSchema`）。

**两份合计 455 条**：✅ 77 · 🔗 72 · ⚠️ 8 · ❌ 249 · ⛔ 49。

---

## 5. ⛔ 里「宣称做了但其实没做」清单（本单最重要的产出）

> 判据：文档**自标本期不做**的，「没做」不是缺口；**「宣称做了」才是**。
> 下列每条都是**文档里写成已完成/已生效/必然如此，而实测不成立**的断言。

| # | 位置 | 宣称 | 实测 | 危害 |
|---|---|---|---|---|
| **X-01** | DSL §2 基线表 `maxBudgetRounds` 行 | 「沿用字段名 **+ 接消费方**：归一到 `AgentBudget.maxRoundTrips`（§4.6）。**这是 Track E 约束 4 的硬验收**」——写成已定的处置 | canonical `grep maxBudgetRounds apps/*/src packages/*/src` = **1**（契约声明本身），**零生产读点**；DSL 全文**无一处标注它未接** | 与 CMP §14.4-3 的诚实标注**直接矛盾**。读 DSL 的人会以为预算已生效，读 CMP 的人知道没有。**同一件事两份文档两个口径** |
| **X-02** | DSL §4.6 表 `budget.rounds` 行 | 「判据（Track E 约束 4）：**改这个数 → 该类题实际探索轮次真变**」——以效果层判据的语气陈述 | 无任何生产读点；即便并入 `partial-a`，读点也只在**探针**（`skill-probe.ts:133`），生产 agent loop 未接 | 同上；且"效果层判据"被当成了"效果层事实" |
| **X-03** | DSL §11.1 事实核实表 | 「发布路径只有 lint + eval 计数/分类 + probe 三段，**无跨注册表引用校验**」 | **已过期**：`server.ts:1272` 已接 `probeMissingRefs`，且 fail-closed、不可 force、拦在落库之前 | 反向危害：会让下一个 dev 去"补一道已经存在的门"，重复劳动（正是铁律 0.5 例③ 的形态） |
| **X-04** | DSL §10.1 诚实边界段 | 「注释里承诺的那个探针，在 skill 这条路上**没人调**」 | 已过期，同 X-03 | 同上 |
| **X-05** | DSL §9.2 命名裁定 | 「Compiler 编译出的可执行图 **采用名 `SkillRuntimeGraph`**」——写成已裁定生效 | 全仓 0 命中；实现用 `SkillReasoningGraph`(compiler-s1) / `SkillGraph`(canonical)。**DSL 的裁定被 CMP 的术语表实际覆盖，且 DSL 未回写** | 「哪个 Plan / 哪个 Graph」重新失去单一指代——正是 §9.1 举证要防的那件事 |
| **X-06** | CMP §2.4 + §14.2 | 「手写 **4** 条 + catalog 16 条 + ceoCaps **12** 条 = 32 意图/32 计划，与 WO 实测数一致」 | 实测 **5 + 16 + 11 = 32**：那个 `4` 是**被跳过的卡数**不是手写数；`12` 是 ceoCaps 误记（真值 11） | 总数碰巧对 ⇒ **两个错互相抵消**，任何按分段口径做的迁移排期都会错。铁律 0.6 形态 |
| **X-07** | CMP §4.2 RG-SOLVER + §14.3 | 「内置集 `SOLVER_KEYS`……静态可数 **57** 条」 | 实测 **59** | 计数已漂；CMP 自己要求"所有计数给可复跑命令"，命令还在、数字已变 |
| **X-08** | CMP §1.2 非目标 | 「**不做** Skill Orchestrator（多 Skill 编排/Skill Graph 运行时）」 | `orchestrator-s1` **已并入** `GraphScheduler` + `POST /b/v1/skill-graphs/run`（`server.ts:1360`） | 非 CMP 违规（是另一张单做的），但该行**已过期**；若不回写，下一个人会以为 Skill Graph 运行时不存在 |
| **X-09** | CMP §0 R3 | 「新模块暗发 `skill.compiler`（`defaultOn:false`），**双注册** DataCore + AgentCore，关闭 = 404」 | compiler-s1 的 `POST /b/v1/skills/:id/compile` **无任何 entitlement 门**（两分支 `grep "skill.compiler"` 均 = 0） | **R3 实打实被违反**（不是"没做"是"做了但漏了门"）；该端点今天对任何 catalog_admin 恒开 |
| **X-10** | CMP §8.1 | 「✚ `POST /b/v1/skills/:id/compile`；**`?dryRun=true` 不落库**」 | 端点在，但**不接受 `dryRun` 查询参数**（注释写"dryRun 语义即默认且唯一行为"） | 语义等价但**契约不符**：SDK/CLI 按文档传 `?dryRun=true` 会被静默忽略；若将来加了落库分支，老调用方会突然落库 |
| **X-11** | CMP §12.2 S2 | 「返 **503 `DATACORE_UNAVAILABLE`**」 | 实现返 503 **`REF_PROBE_UNAVAILABLE`**（`resources.ts:24`） | 行为对、码不对。前端/SDK 若按 CMP 写错误分支处理，会落进 default 分支 |
| **X-12** | CMP §14.4-1 | 「RG 组硬门会挡住存量……实施 P0 时必须先跑一次全量存量 dry-run 编译列出违规清单」 | 门已上线，**存量根本没被挡**——出厂 7 个 skill 是直接以 PUBLISHED 落库、不走发布路由（`mocks/seed.ts`），门够不着 | 「没有存量被挡」会被误读成「存量干净」。真相是**门看不见它们**（本体 §8 已记载同一事实）。若种子里有死路引用，今天没有任何信号 |

**另记两条"文档之间打架"（不是单方宣称，但同样有害）**：
- **Y-01** `execution` 字段：DSL 要 `plan[]`+`mode(3值,必填)`+`planRef`+`fallback`；CMP 要 `execution.steps` 且元素复用 `PlanStepSchema`；实现是 `{steps?,graph?,mode?(2值,可选)}` —— **三方两两不一致，且三份文档都没回写**。
- **Y-02** 编译图命名：DSL §9.2 `SkillRuntimeGraph` vs CMP §3.2 `SkillReasoningGraph`+`SkillRuntimePackage` vs 实现 `SkillGraph`/`SkillReasoningGraph` —— 同一层三个名字。

---

## 6. 金丝雀证据（铁律 0.6：报否定结论前先自证工具）

> 本文所有「0 命中 / 不存在 / 零调用方」的结论，都附了下面对应的金丝雀。

| # | 场景 | 金丝雀（已知必中） | 结果 | 若不中我会报什么 |
|---|---|---|---|---|
| 1 | 符号普查 `grep -rn <sym> apps/*/src packages/*/src` | `SkillDefinitionSchema` | **7 命中** ✅ | 「工具坏了」，而不是「全是死代码」 |
| 2 | `ErrorCodes` 里 `grep SKILL_` = 0 | 同文件 `DATACORE_UNAVAILABLE` | **命中 `common.ts:51`** ✅ | 「grep 坏了」 |
| 3 | `scripts/platform-cli.mjs` `grep -i skill` = 0 | 同文件 `grep -c run` | **4 命中** ✅ | 「CLI 文件读不到」 |
| 4 | **实测计数用的 `dist` 是不是新的** | `stat -c %Y` 对比 `src/mocks/seed.ts` 与 `dist/mocks/seed.js` | **dist 比 src 旧 3 天 ⇒ 先 `pnpm --filter agentcore build` 再测** | 会拿旧 dist 得出过期计数（本单差点犯 —— 这正是「工具本身会骗你」） |
| 5 | `grep "SkillRuntimeGraph" ... docs` = 0 | 加了 `--include=*.ts` 时对 docs **恒 0** | **去掉 filter 后 DSL 自己两行命中** ✅ | 首次差点报「连文档里都没有」。**`--include` 过滤会让 docs 恒不命中**，与 pathspec `*` 不跨 `/` 同族 |
| 6 | `detectStaticCycle` 在 `validate.ts` 找不到 | 用 `^export function` 只捞到 3 个；改全词 grep | **`validate.ts:117` 是 `export async function`** ✅ | 会误报「CMP §2.1 该行是错的」 |
| 7 | 门 `ref-closure:check` 是否真在守 | 门自带金丝雀（与主逻辑共用 `scan()`） | 实跑 **5/5 变异全部被咬**，RC=0 | 门若自证失败，我不会用它的绿当证据 |
| 8 | 分支是否落后 canonical | `git merge-base --is-ancestor`（**不用文件存在性**） | `compiler-s1`/`partial-a` 均 **NOT MERGED** ✅ | 用"某文件在不在"判断会误判（CLAUDE.md 铁律 0.6 第 2 条） |
| 9 | 种子实测 | `seedRegistry("demo")` 真跑 | skills 7 / PUBLISHED 5 / DRAFT 2 / resources 非空 **0** / dependsOn 非空 **0** / references 非空 **6** / execution 非空 **0** / body 均值 **442** | 静态 grep 会把 `dependsOn` 与 `references` 混成一句（CLAUDE.md 铁律 0.5 已记过这个病） |

---

## 7. 复验方法边界（本单没做什么）

- **未跑四包 gate**（`bash scripts/gate.sh`）：本单是取证单，不是并线单；跑了也不改变逐条判定。
  已跑的门：`ref-closure:check`（RC=0）· `prd:check`（RC=0）。
- **未起服务**：所有"运行态"结论均由**真跑纯函数/种子**（`seedRegistry`/`seedIntentsAndPlans`，
  用重新 build 的 `dist`）+ 读调用点条件得出，不是 HTTP 实拍。
- **未改一行代码**，未动 `docs/SYSTEM-ONTOLOGY.md`。本文列出的**本体/PRD 待回写项**（X-03/X-04/X-06/X-07/X-08 等）
  留给审核方裁决后统一回写——**回写本身是另一张单**。
- **[未并] 分支的判定**基于 worktree 静态读源码 + 读其自带测试的断言，**未在该分支上跑四包**。
