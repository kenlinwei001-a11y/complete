# PRD · Skill 契约与 DSL（工业级 Skill 的可校验声明外壳）

| 项 | 值 |
|---|---|
| 版本 | v1.0 |
| 上位输入 | `docs/SPEC-industrial-skill.md`（仓主给定 12 层 + §5/§6/§7 已定案引用模式 + §8 SDK 规格）· `docs/WO-ROUTING-RETRIEVAL-FIRST.md` 四之四 Track E（仓主定案：**Skill 吞并 ExecutionPlan**） |
| 基线契约 | `packages/contracts/src/agentcore.ts` `SkillDefinitionSchema`（今 236–262 行） |
| 解决问题 | 12 层能力今天**零件在仓里、但不归 Skill 管、也没人读**。本文把它们收敛成**一份可校验、可门控、自带验收的声明**，并给出可实现的 zod 形态（字段名/类型/必填/默认值） |
| 明确不做 | 不新造规则语法、不新造约束 DSL、不在 Skill 包内定义对象/工具/求解器（SPEC §5/§6/§7 定案，本文**不推翻**）；不实现 SDK/CLI（另立单）；不写一行代码 |
| 头号纪律 | **字段必须有消费方**。无消费方的字段不入契约——`maxBudgetRounds` 与 `outputSchema` 就是活教训（SPEC §4 D4/D5：填了字段却没有消费方，比不填更危险） |

---

## 0. 本体引用与影响

> 依 `CLAUDE.md` 铁律 0 与 `docs/SYSTEM-ONTOLOGY.md` §0 read-first 协议填写。本节是本 PRD 与本体的接线单。

### 0.1 触及对象类型（本体 §2）

| 域 | 对象类型 | 本 PRD 的影响 |
|---|---|---|
| §2.H 交互/编排域 | **Skill** | 契约扩面（additive）：新增 `identity` / `businessIntent` / `trigger` / `execution` / `requires` / `budget` / `progress` / `acceptance` 八个可选字段组 |
| §2.H | **ExecutionPlan** | **降级为 Skill 的一个字段**（`execution.plan[]`）。迁移窗口内 `ExecutionPlan` 仍是一等对象；收口后不得再有独立注册/播种/查询入口 |
| §2.H | **Intent** | 不改契约。`意图 1:1 Skill` 的边**声明在 Skill 侧**（`businessIntent.intentKey`），意图侧不加字段（意图池按 id 幂等、PUBLISHED 后 PUT 409，加字段成本高） |
| §2.H | **AgentDefinition** | 不改。`agent.skills[]` 挂载语义不变 |
| §2.H | **SkillReference / SkillAttachment** | `SkillReference` 保留（带 role 的运行时引用有真消费方）；`SkillAttachment`（`resources[]`）成为 Skill 包**文档类文件**的承载面 |
| §2.H | **EvalCase(suite=skill_quality)** | 语义变更：从"手写"变为**从 `acceptance.goldenCases[]` 派生**（金标集与目录不再漂移） |
| §2.H | **SceneEntry / Scenario** | 不改。仅在基数关系上被引用（场景入口 → 意图 → Skill） |
| §2.E | **Solver** | 只被引用（key + 本 Skill 专属 objective/weights），**绝不**在 Skill 内定义数学模型 |
| §2.B | **OntologyType / OntologyLink / SliceSpec** | 只被引用（`requires.objectTypes` / `requires.relations` / `requires.slices`），Skill 内**不定义**对象与属性 |
| §2.C | **RuleEntry** | 只被引用（rule key + 所需状态），规则语法权威仍在 `ruledsl`（SPEC §5 消解 C1） |
| §2.G | **FeatureFlag** | 新诉求：`FeatureDef.bindings` 今天只有 `intents/solverKeys/apiTags`（`packages/contracts/src/features.ts:16-22`，**无 skills**）→ Track E 约束 3「entitlement 一处」需补 `skills` 绑定，否则出现「意图开着但 Skill 关着」的半开态 |

### 0.2 触及链路（本体 §3）

- **编排链**：`Query --classify--> Intent --planRef--> ExecutionPlan --step--> {Solver|SliceSpec|Rule|render}`
  → 收口后变为 `Query --…--> Intent --(1:1)--> Skill --execution.plan[]--> {同一批步骤}`。**右侧步骤语义一字不改**。
- **Skill 引用链**（本体 §3「Skill 引用链」块）：`Skill --references|dependsOn--> {rule|constraint|slice|ontologyType|solver|skill|workflow|agent}` → 扩为 `Skill --requires--> {上述 + tool | mcp | dataSource | event}`，并首次**可校验**。
- **DRIL 智能资源路由链**：`Skill --projectedTo--> SkillResource`（`apps/agentcore/src/dril/resource-projector.ts:141`）→ `triggerPatterns` 数据源从 `summary` 扩为 `trigger.examples/antiExamples`。
- **自由问答链**：`skills repo --selectTenantSkills--> buildSkillSection --> path-B system prompt --> load_skill --> engine.resolveSkill`（`apps/agentcore/src/router/orchestrator.ts:232`、`apps/agentcore/src/agent/prompts.ts:69`、`apps/agentcore/src/engine.ts:370`）——本 PRD 的字段消费方大多挂在这条链上。
- **发布链**：`POST /b/v1/skills/:id/publish` → 结构 lint → 评测门禁 → SkillProbeRunner → `skill.published`（`apps/agentcore/src/server.ts:1231-1289`）→ 新增第三道「引用可校验」门。

### 0.3 触及事件（本体 §4）

- `skill.published`（L4，B 栈 outbox → 失效 `agent-editor.skill-bindings`）：**沿用，不改名、不改载荷结构**。
- `step.completed` 伪 step（`agent_narration` / `agent_degraded`）：`progress.emitsNarration` 的效果层观测点，**不新增事件名**（守 QOS-PRD §8.2 一字不差）。
- `requires.events`：Skill 声明"我发哪些 / 消费哪些"事件——**只引用 §4 已登记事件名**，声明本身不制造新事件。新增事件名必须先回写本体 §4 再声明。

### 0.4 不变量核对（本体 §5）

| 不变量 | 本 PRD 影响 | 处置 |
|---|---|---|
| R1 contracts-only-shared | Skill 契约全部落 `@platform/contracts`，两 app 与前端只引类型 | 不变 |
| R2 tenant_id everywhere | `requires` 解析、`selectTenantSkills`、acceptance 派生用例全部按租户 | 校验必须覆盖跨租户不串 |
| R3 entitlement 先于 authz | **需扩**：`FeatureDef.bindings` 加 `skills`，与 `intentAllowed` 同一处判定 | Track E 约束 3；未扩之前不得宣称"entitlement 一处" |
| R4 真值写入经 Action | `sideEffect=WRITE` / `approvalGate≠none` 仍必须产 `action_draft` | 判定单源 `isWriteModeSkill()` 不动 |
| R6 确定性 | `execution.plan[]` 执行、`requires` 归一、acceptance 派生用例全为纯函数；同租户同输入 system prompt 字节一致 | 迁移验收的**零行为漂移**对照即此不变量的体现 |
| R7 错误信封 | 引用校验失败走 `{error:{code,message,requestId}}`（新增 code `SKILL_REF_UNRESOLVED`） | 不新造错误形状 |
| R9 仓储双实现 | 若 acceptance 派生用例落库，`eval_cases` 已有表；`skills` 表新增字段走 JSON 列 | 新表才需四处同改 |
| R11 全链闭包 | Skill 成为「意图怎么答」的唯一声明后，闭包判据从 Intent+Plan+Solver+render 改读 Skill | `chain:check` 判据需同步 |
| R13 结论可溯源 | `provenancePolicy` 语义不变；`outputEnforcement` 新增但**默认 off**（不伪装成已生效） | 诚实边界写进契约注释 |
| R14 应用层无业务常数 | `businessIntent.kpis[].metricKey` **只引用** Metric/`GOAL_REGISTRY` key，禁写阈值数值；`requires` 全是 key | 阈值属 rule params / feature config（Track E「明确不放进 Skill」） |
| R15 CLI 对等 | Skill 的创建/校验/发布须有 CLI 等价（SDK 单交付，本 PRD 只登记诉求） | 不在本 PRD 交付 |
| R16 发育闭环 | scaffold 出的 DRAFT Skill 仍受 R4 墙；`acceptance` 让"谁证明这 skill 能用"从测试作者变成 skill 所有者 | 与 G-9 的诚实边界一致 |

### 0.5 触及断点（本体 §8）

| 断点 | 与本 PRD 的关系 |
|---|---|
| **G-3** | 场景/preset 侧：`trigger.slots` 复用 `SlotDefSchema`，槽位口径收敛到一处，减少 preset 键漂移面 |
| **G-8** | 跨系统 scaffold 出的 B 栈 Skill 是 DRAFT；引用可校验门让"scaffold 出来的壳子引用了不存在的 solver"当场可见 |
| **G-9** | `execution.mode` + `budget` 把"探索预算是全局常数"改为按题型声明——G-9 的 path-B 空转半面 |
| **G-10** | 规则**引用**而非写死（SPEC §5 消解 C1），是 G-10「规则被引用但非一等可编辑引用」的 Skill 侧落点 |
| G-SKILL-UNREACHABLE-FREE-QA（#90，已闭·暗发默认关） | 本 PRD 的字段消费方多挂在这条已闭链路上；新字段**不得**依赖该暗发门常开——门关时必须逐字节兼容 |
| G-SIDEEFFECT-VOCAB-SPLIT（已闭） | 直接教训：**新字段一律复用既有词表**（riskLevel 复用 Intent 的 `READ/COMPUTE/ACTION_DRAFT`；域复用 A3 域注册表；数据源复用 `connectorCategories()`），禁自造第二套枚举 |
| G-RESOURCE-CATALOG-NO-DATA（已闭） | `requires.objectTypes/relations` 的校验依赖资源目录已能投影 object_type/field，前置已具备 |
| G-ARG-DROP-SEAM | `trigger.slots` 与 `execution.plan[]` 的 `{{slots.X}}` 必须同源，否则复刻"路由解析出的过滤实体到不了求解器"的静默错答 |
| G-C08-EXPR-PARAM-SPLIT（未修） | 规则引擎实缺，**与本 PRD 无关但不得被本 PRD 掩盖**：Skill 引用规则不会修好"expression 不能引用 params" |
| G-ROUTE-REGEX-PREEMPTS-RETRIEVAL（WO 拟登记·本体 §8 **尚无此行**） | Skill 决定"这一题怎么跑"，路由决定"走哪个 Skill"，互补非重叠 |

### 0.6 本体回写清单（本 PRD 落地时必须同步）

1. §2.H `Skill` 条目：补八个字段组与 `execution` 吞并 `ExecutionPlan` 的语义。
2. §2.H `ExecutionPlan` 条目：标注"降级为 `Skill.execution.plan[]`；迁移窗口/收口判据"。
3. §3「Skill 引用链」块：`references|dependsOn` 扩为 `requires`。
4. §5 R3：`FeatureDef.bindings.skills` 落地后回写检测点。
5. §7：新增 `skill-refs:check` 门（静态半）+ 运行态发布门。
6. §8：本 PRD 若坐实新断点（如"acceptance 声明了但派生未接"）须登记。

---

## 1. 定位与范围

Track E 已定案：**Skill 是「一个意图一份声明」的单一外壳**，`ExecutionPlan` 降为它的字段。本 PRD 只交付**契约与 DSL 形态**：

- **交付**：字段名 / 类型 / 必填 / 默认值；引用模型；内联 vs 引用边界；`execution` 详规；包结构 → `resources[]` 映射；命名红线；门禁与验收判据。
- **不交付**：迁移脚本、Compiler/CLI 实现、路由改造（Track A）、探索成本（Track B）。

**四条设计原则**（每条都对应一个仓内实际发生过的病）：

| # | 原则 | 病根 |
|---|---|---|
| P1 | **既有字段零语义变更**：老字段一个不改名、不改类型、不改缺省；新层一律 optional additive | 老字段有活消费方（见 §2 表），改一个就是全链回归 |
| P2 | **引用一律 key，不内联定义** | SPEC §5 定案；C08 一条红线六个数（G-C08-REDLINE-DRIFT）的同族预防 |
| P3 | **一层一落点**：12 层每层必须能指到一个具体字段，不留"以后再说" | 只存结构不做映射 = 又一份没有消费方的声明 |
| P4 | **字段必须有消费方**：本 PRD 每个新字段都写明"谁读它、效果层怎么验"；写不出消费方的字段**不入契约** | `maxBudgetRounds` 零消费方（本会话 grep 核实）；`outputSchema` 无校验消费方 |

---

## 2. 基线盘点：既有 `SkillDefinitionSchema` 逐字段处置

> 基线 = `packages/contracts/src/agentcore.ts:236-262`。**处置栏是本 PRD 的承诺**。

| 字段 | 今天类型 | 活消费方（本会话核实） | 本 PRD 处置 |
|---|---|---|---|
| `id` `tenantId` `key` `version` `name` | string / int | 全链 | **沿用**·零变更 |
| `summary` | `string.max(400)` | `buildSkillSection`（`apps/agentcore/src/agent/prompts.ts:72` 注入 system）· DRIL `projectSkills` 的 `description`/`triggerPatterns` | **沿用**·语义仍是"触发器"。⚠ 契约上限 400 与 lint 上限 200（`apps/agentcore/src/skill-lint.ts:45`）**不一致**——本 PRD 主张以 lint 为准并把 400 视为历史宽限，但**不改契约数字**（改了即行为漂移） |
| `body` | `string.max(50_000)` | `load_skill` 回执（`apps/agentcore/src/engine.ts:378`） | **沿用**·同样存在契约 50_000 vs lint 3_000（`skill-lint.ts:46`）的双上限。**推荐**长文下沉 `resources[]` 而非扩 body（SPEC §6 同判断） |
| `resources[]` | `SkillAttachment[]` | `load_skill` 回执附资源清单（`engine.ts:379-384`）· `read_skill_resource` 工具（`apps/agentcore/src/tools/registry.ts:258`）· DRIL `attachments` | **沿用 + 大幅启用**：Skill 包文档类文件的承载面（§8）。今 7/7 全空（核实见 §11.1） |
| `status` | `DRAFT｜PUBLISHED｜RETIRED` | `selectTenantSkills` 只收 PUBLISHED（`orchestrator.ts:235`）· 发布门 | **沿用** |
| `capability` | enum? | DRIL 投影 | **沿用**·对应 12 层①的 `category` 语义面 |
| `sideEffect` | `READ｜COMPUTE｜WRITE`? | `isWriteEffectSkill/isWriteModeSkill`（contracts 单源）→ engine 写模式 + 探针工具集 | **沿用**·**禁止**再加同义枚举（G-SIDEEFFECT-VOCAB-SPLIT 原样重演风险） |
| `inputSchema` | JSON Schema? | lint 形状检查（`skill-lint.ts:299`）· DRIL `inputSpec` | **沿用**·与 `trigger.slots` 的分工见 §4.3 |
| `outputSchema` | JSON Schema? | lint 形状检查 + DRIL `outputSpec`——**无任何一处拿它校验实际输出**（核实） | **沿用 + 接消费方**：新增 `outputEnforcement`（§4.6），默认 `off` 字节兼容 |
| `references[]` | `SkillReference[]`? | `skillRuleRefs`（`apps/agentcore/src/engine.ts:41-51`）→ rule 的 precondition/postcheck 真被执行 · DRIL `resource_relations`（`resource-projector.ts:322-334`） | **沿用**·语义收窄为「带 role 的运行时引用」，且**必须是 `requires` 的子集**（§5.3 归一） |
| `dependsOn[]` | `SkillReference[]`? | lint 解析 + 环检测（`skill-lint.ts:212/306/309`）· DRIL 关系投影（`resource-projector.ts:334`） | **沿用**·**核实补正**：并非"零消费方"，是**7/7 全空导致消费方从不触发**（两回事：前者是没接线，后者是没数据） |
| `approvalGate` | `none｜human｜workflow`? | `isWriteModeSkill` | **沿用** |
| `provenancePolicy` | `required｜best_effort｜none`? | `skillProvenancePolicy`（`engine.ts:30-34`）→ 运行时聚合 | **沿用** |
| `maxBudgetRounds` | `int.positive()`? | **零消费方**（核实：全仓仅契约声明一处） | **沿用字段名 + 接消费方**：归一到 `AgentBudget.maxRoundTrips`（§4.6）。这是 Track E 约束 4 的硬验收 |

**结论**：**无一字段需要语义变更或删除**；缺的全是"新层"与"消费方"。这决定了本 PRD 的形态是 **additive 超集**，不是重写。

---

## 3. 12 层 → 契约落位总表

> SPEC §1 的 12 层，每层必须指到一个具体字段（原则 P3）。"新增"列标 ✚。

| # | 12 层 | 落位字段 | 权威在哪 |
|---|---|---|---|
| 1 | Skill Identity | `id/key/version/name/status/tenantId` + ✚`identity{domain,category,owner,riskLevel,supersedes,runtime}` | Skill 自身 |
| 2 | Business Intent | ✚`businessIntent{intentKey,userRoles[],decisionScene,triggerConditions[],kpis[]}` | Skill 自身（**内联**——SPEC §5 判据：变了只有这一个 Skill 该变） |
| 3 | Ontology Binding | ✚`requires.objectTypes[]` · ✚`requires.relations[]` · ✚`requires.slices[]` | **已发布本体**（Skill 只声明"我需要 X 且 X 须有 Y 属性"） |
| 4 | Input Contract | `inputSchema` + ✚`trigger.slots[]`（复用 `SlotDefSchema`）+ ✚`requires.dataSources[]` | 槽位口径与 Intent 同一 schema；数据源引用 `connectorCategories()` 词表 |
| 5 | Context Manager | ✚`context{retrieval,compression,memory}`（**本期只登记 5.1/5.2 声明位，5.3 不入契约**·理由 §4.9） | 平台（DRIL 组包 / 摘要 / 截断） |
| 6 | Reasoning Logic | ✚`execution.mode` + `execution.plan[]`（今日步骤 DSL）+ `body`（推理说明） | Skill 自身（**内联**：Reasoning 拓扑是本 Skill 独有语义） |
| 7 | Tool / MCP Binding | ✚`requires.tools[]` · ✚`requires.mcp[]` | `apps/agentcore/src/tools/registry.ts` + MCP 配置 |
| 8 | Rule & Constraint | ✚`requires.rules[]`（+ 既有 `references[kind=rule,role]`） | `ruledsl` 规则库（**不引入第二套规则语法**） |
| 9 | Solver Integration | ✚`requires.solvers[]{key, objective?, weights?}` | 求解器注册表；objective/weights 内联（SPEC §7 定案 2）；**禁带 `.lp`/`.mps`** |
| 10 | Workflow Execution | ✚`requires.workflows[]` · ✚`requires.agents[]` · `approvalGate` | `workflow/executor.ts` + Action `approvalChain` |
| 11 | Output Contract | `outputSchema` + ✚`outputEnforcement` | Skill 自身；**首次有校验消费方** |
| 12 | Governance & Learning | `approvalGate`/`provenancePolicy`/`sideEffect` + ✚`acceptance{goldenCases[],mustNotRouteTo[]}`；**Learning 闭环本期不入契约** | 见 §4.9 的诚实边界 |

---

## 4. Skill 契约 schema 形态

> 表述口径：字段名 · 类型 · 必填 · 默认值。所有 ✚ 新字段一律 `optional`（P1），**缺省行为 = 今日行为逐字节不变**。

### 4.0 顶层形状

```ts
export const SkillDefinitionSchema = z.object({
  // ——— 既有字段：一字不改（见 §2）———
  id: z.string(), tenantId: z.string(), key: z.string(), version: z.number().int(),
  name: z.string(), summary: z.string().max(400), body: z.string().max(50_000),
  resources: z.array(SkillAttachmentSchema),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  capability: SkillCapabilitySchema.optional(),
  sideEffect: SkillSideEffectSchema.optional(),
  inputSchema: JsonSchemaObject.optional(),
  outputSchema: JsonSchemaObject.optional(),
  references: z.array(SkillReferenceSchema).optional(),
  dependsOn: z.array(SkillReferenceSchema).optional(),
  approvalGate: z.enum(["none", "human", "workflow"]).optional(),
  provenancePolicy: z.enum(["required", "best_effort", "none"]).optional(),
  maxBudgetRounds: z.number().int().positive().optional(),

  // ——— ✚ 新层（全部 optional·additive）———
  identity:       SkillIdentitySchema.optional(),        // §4.1
  businessIntent: SkillBusinessIntentSchema.optional(),  // §4.2
  trigger:        SkillTriggerSchema.optional(),         // §4.3
  execution:      SkillExecutionSchema.optional(),       // §4.4 · 仓主定案
  requires:       SkillRequiresSchema.optional(),        // §4.5 · SPEC §7 定案 1
  outputEnforcement: z.enum(["off", "warn", "block"]).default("off"), // §4.6
  budget:         SkillBudgetSchema.optional(),          // §4.6
  progress:       SkillProgressSchema.optional(),        // §4.7
  acceptance:     SkillAcceptanceSchema.optional(),      // §4.8
});
```

### 4.1 `identity` — 身份治理（12 层①）

| 字段 | 类型 | 必填 | 默认 | 消费方 / 判据 |
|---|---|---|---|---|
| `domain` | `string` | 否 | — | **引用** A3 业务域注册表 key（14 域），禁自造词表；DRIL/目录按域筛 |
| `category` | `string` | 否 | — | 目录分组；与 `capability`（能力维度）正交 |
| `owner` | `string` | 否 | — | 与 `IntentDefinition.owner` 同口径（用户/角色 key） |
| `riskLevel` | `z.enum(["READ","COMPUTE","ACTION_DRAFT"])` | 否 | — | **复用** `IntentDefinition.riskLevel` 词表（`packages/contracts/src/qos.ts:58`）——**禁**造 `low/medium/high` 第二套 |
| `supersedes` | `{ key: string, version: z.number().int() }` | 否 | — | 演进留痕（SPEC §2-① E8：意图池按 id 幂等、PUBLISHED 后 PUT 409 → "顶替谁"必须一等）。消费方：版本树 UI + 发布门（被顶替者应转 RETIRED） |
| `runtime` | `string`（semver range，如 `">=2.0"`） | 否 | — | SDK 包兼容性声明；装载门读它 |

**约束**：`identity.riskLevel` 与 `sideEffect`/`approvalGate` 三者若相互矛盾（如 `riskLevel=READ` 而 `sideEffect=WRITE`）→ lint 红。判定单源沿用 `isWriteModeSkill()`。

### 4.2 `businessIntent` — 业务意图（12 层②·SPEC §3 语义修正）

> SPEC §3 仓主修正：**「意图」= 一种客户的需求场景**，故"用户角色/决策场景/触发条件/KPI"不是装饰，是意图的定义本身。

| 字段 | 类型 | 必填 | 默认 | 消费方 / 判据 |
|---|---|---|---|---|
| `intentKey` | `string` | 否（收口后**是**） | — | **`意图 1:1 Skill` 这条边的唯一落点**（SPEC §4 D1：今天这条边根本不存在）。门：同一 `intentKey` 至多一个 PUBLISHED Skill；收口后每个 PUBLISHED 意图恰好一个 |
| `userRoles` | `string[]` | 否 | `[]` | **引用**角色 key（`AgentRole` 五角色 / RBAC 角色），禁写自然语言职位 |
| `decisionScene` | `string` | 否 | — | 决策场景（"月度 S&OP 会议"） |
| `triggerConditions` | `string[]` | 否 | `[]` | 业务触发条件（**非**问句模式——问句在 `trigger.examples`） |
| `kpis` | `{ metricKey: string, direction: z.enum(["up","down"]), note?: string }[]` | 否 | `[]` | `metricKey` **只引用** Metric/`GOAL_REGISTRY` key；**禁写阈值数值**（R14；阈值属 rule params / feature config） |

**为什么 `intentKey` 声明在 Skill 侧而非 Intent 侧**：意图目录是"死目录"（PUBLISHED 后 PUT 409），加字段需要意图版本演进；Skill 是新外壳，加字段成本为零。`Intent → Skill` 的正向索引由**反查派生**（纯函数，R6），不落第二份真源。

### 4.3 `trigger` — 触发面与选型（Track E ②·今天**全缺**）

| 字段 | 类型 | 必填 | 默认 | 消费方 / 判据 |
|---|---|---|---|---|
| `answers` | `string` | 否 | — | 一句话"我回答哪类问题"；DRIL `ResourceDescriptor.description` 的 Skill 侧来源 |
| `examples` | `string[]` | 否（声明 `trigger` 时 `.min(1)`） | — | 检索层与门的**共同真源**——金标集不再手写 80 条并"从 catalog 派生防漂移" |
| `antiExamples` | `string[]` | 否（声明 `trigger` 时 `.min(1)`） | — | "不归我"（本单病根：没有任何一处声明"这题归我且只归我"） |
| `exclusivity` | `z.enum(["SOLE","COUNCIL","OPEN"])` | 否 | `"OPEN"` | SOLE=单一对口求解器 / COUNCIL=需多角色会诊 / OPEN=开放探索。消费方：路由让位判据（与 Coordinator 降级同族） |
| `slots` | `SlotDefSchema[]`（**复用** `packages/contracts/src/qos.ts:25`） | 否 | `[]` | 解 SPEC §2-④「两处未统一」：Skill 与 Intent **同一 schema**。与 `execution.plan[]` 的 `{{slots.X}}` 必须同源（守 G-ARG-DROP-SEAM 同族） |

**与 `inputSchema` 的分工**（不重复定义）：`trigger.slots` 是**自然语言侧**的槽位（可被 `fillSlots` 从问句抽取、可被场景 `slotPresets` 预置）；`inputSchema` 是**程序侧**入参形状（agent 挂载时 `arguments` 预填的校验面）。二者若同时声明，lint 断言 `inputSchema.required ⊆ slots.name`，防两份真源打架。

### 4.4 `execution` — 执行（仓主定案：Skill 吞并 ExecutionPlan）

```ts
export const SkillExecutionSchema = z.object({
  mode: z.enum(["DETERMINISTIC", "EXPLORATORY", "HYBRID"]),      // 必填
  plan: z.array(AnySkillPlanStepSchema).min(1).max(12).optional(),
  planRef: PlanRefSchema.optional(),                              // 迁移窗口专用
  fallback: z.enum(["none", "explore"]).default("none"),          // HYBRID 语义显式化
});
```

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `mode` | `DETERMINISTIC｜EXPLORATORY｜HYBRID` | **是**（声明 `execution` 即必填） | — | **显式声明而非隐式推断**——"有没有 plan"式推断正是那 10 道门的病 |
| `plan` | `AnySkillPlanStep[]`，`min(1).max(12)` | `mode≠EXPLORATORY` 时**是** | — | **今日 `ExecutionPlan.steps` 语义逐字节不变**（见下方红线） |
| `planRef` | `PlanRef` | 否 | — | 迁移窗口内指向既有 `ExecutionPlan`；`plan` 与 `planRef` **同时存在即 lint 红**（防第三份真源）；收口后禁用 |
| `fallback` | `none｜explore` | 否 | `"none"` | `HYBRID` = `plan` 先跑，未闭合转 agent。把今天"path-A 失败回落 path-B"的隐式行为写成声明 |

#### ⛔ `execution.plan[]` 的字节红线（本 PRD 最硬的一条）

1. **步骤词表必须用 `AnyPlanStepSchema` 口径，不是 contracts 的 `PlanStepSchema`。**
   核实：`apps/agentcore/src/catalog/service.ts:28-36` 定义 `ExtraToolStepSchema`（`query_timeseries_agg` / `search_knowledge` / `plan_slice`），`AnyPlanStepSchema = PlanStepSchema ∪ ExtraToolStepSchema`；执行器侧对应 `ExtendedPlanStep`（`apps/agentcore/src/workflow/executor.ts:27`）。
   **若 `execution.plan[]` 只收 contracts `PlanStepSchema`，会静默丢掉 3 个已在用的步骤类型**——这正是"迁移自己变成新的假绿"的标准形状。
   处置：`AnySkillPlanStepSchema` ≡ 今日 `AnyPlanStepSchema`；**并顺手把这个 contract gap 收进 contracts**（否则 Skill 契约仍依赖 app 本地放宽，违 R1）。
2. **`min(1).max(12)` 与 `ExecutionPlanSchema.steps` 完全一致**（`packages/contracts/src/qos.ts:186`）。
3. **`params` 形状、`onError`、`timeoutMs`、`{{slots.X}}` / `{{steps.sN.output}}` 模板解析语义一字不改。**
4. **`render_answer` 必须是末步**等既有校验规则原样迁移，不重写。

#### `mode` 的运行时含义

| mode | 执行路径 | 预算来源 | 信任标 |
|---|---|---|---|
| `DETERMINISTIC` | 走 workflow executor（今日 path-A） | 不适用（无 agent 轮次） | `VERIFIED_WORKFLOW` |
| `EXPLORATORY` | 走 `runAgentLoop`（今日 path-B） | `budget`（§4.6）→ `AgentBudget` | `AGENT_EXPLORATORY` |
| `HYBRID` | `plan` 先跑 → `fallback=explore` 时转 agent | 同上（转入后生效） | 按实际产出路径标，**不得**用 plan 的信任标给 agent 产物背书 |

### 4.5 `requires` — 引用层（SPEC §7 定案 1：`requires` 是契约，不是副本）

```ts
export const SkillRequiresSchema = z.object({
  objectTypes: z.array(z.object({
    key: z.string(),                                  // 引用已发布 OntologyType key
    properties: z.array(z.string()).default([]),      // 契约式：Factory 须有 capacity
    required: z.boolean().default(true),
  })).default([]),
  relations: z.array(z.object({
    linkKey: z.string(), from: z.string(), to: z.string(),
    required: z.boolean().default(true),
  })).default([]),
  slices: z.array(z.object({ key: z.string(), required: z.boolean().default(true) })).default([]),
  rules: z.array(z.object({
    key: z.string(),                                  // C03 / C09 …
    minStatus: z.enum(["ANY", "PUBLISHED"]).default("PUBLISHED"),
    role: z.enum(SKILL_REFERENCE_ROLES).optional(),   // 复用契约词表·不手抄
    required: z.boolean().default(true),
  })).default([]),
  solvers: z.array(z.object({
    key: z.string(),                                  // 引用注册求解器
    objective: z.object({                             // ← 本 Skill 专属·内联（SPEC §7 定案 2）
      maximize: z.array(z.string()).default([]),
      minimize: z.array(z.string()).default([]),
    }).optional(),
    weights: z.record(z.string(), z.number()).optional(),
    required: z.boolean().default(true),
  })).default([]),
  tools: z.array(z.object({ name: z.string(), required: z.boolean().default(true) })).default([]),
  mcp: z.array(z.object({ server: z.string(), tool: z.string(), required: z.boolean().default(true) })).default([]),
  workflows: z.array(z.object({ key: z.string(), version: z.union([z.number().int(), z.literal("latest")]).default("latest"), required: z.boolean().default(true) })).default([]),
  agents: z.array(z.object({ key: z.string(), required: z.boolean().default(true) })).default([]),
  dependsOn: z.array(z.object({ key: z.string(), version: z.number().int().optional(), required: z.boolean().default(true) })).default([]),
  dataSources: z.array(z.object({ category: z.string(), required: z.boolean().default(false) })).default([]),
  events: z.object({
    emits: z.array(z.string()).default([]),
    consumes: z.array(z.string()).default([]),
  }).optional(),
});
```

**逐类权威归属**（SPEC §6 表的契约化，**不推翻**）：

| `requires` 子项 | 引用的 key 空间 | 权威真源 | ❌ 绝不 |
|---|---|---|---|
| `objectTypes` / `relations` | 已发布 OntologyType / OntologyLink key | DataCore 本体 | 在包内定义对象与属性 |
| `slices` | SliceSpec key | DataCore 切片库 | 包内定义切片 |
| `rules` | 规则码（C01–C33…） | `ruledsl` 规则库 | 包内定义规则语法/条件式 |
| `solvers` | 求解器注册表 key | 求解器实现 | 包内带 `.lp`/`.mps` 模型文件 |
| `tools` | `BUILTIN_TOOLS`（核实 28 条）+ `FINAL_ANSWER_TOOL` + `LOAD_SKILL_TOOL` | `apps/agentcore/src/tools/registry.ts` | 包内定义工具 schema |
| `mcp` | MCP server/tool 全名 | MCP 配置（B3） | 包内定义 MCP 工具 |
| `workflows` / `agents` | WorkflowDefinition / AgentDefinition key | AgentCore 本地注册表 | 包内定义工作流引擎语义 / agent |
| `dependsOn` | 其他 Skill key | skills 仓储 | — |
| `dataSources` | `Connection.category` 词表（`connectorCategories()`，允许自定义值 R14） | A11 连接器 | 自造 ERP/MES 第二套枚举 |
| `events` | 本体 §4 已登记事件名 | `event-subscriptions.ts` + 本体 §4 | 声明未登记事件名（先回写本体再声明） |

**`requires` 与既有 `references[]`/`dependsOn[]` 的关系（防第三份真源）**：

- `requires` = **装载/发布期契约**（宿主须满足什么），是**权威声明面**。
- `references[]` = **运行期带 `role` 的引用**（precondition/postcheck 有真消费方：`apps/agentcore/src/engine.ts:41-51`），保留。
- 顶层 `dependsOn[]`（`SkillReference[]`）与 `requires.dependsOn[]` **不并存**：新写只填 `requires.dependsOn`，老字段经归一函数读入。
- 归一单源：纯函数 `normalizeSkillRequires(skill) → NormalizedRequires`（R6），把 `requires` ∪ `references` ∪ `dependsOn` 折成**一张表**。**所有消费方（lint / 发布门 / DRIL 关系投影 / 运行时规则预检）一律只读归一结果**，禁止各读各的。
- lint 规则：`references[].{kind,key}` 必须能在 `requires` 中找到对应项；找不到 → 归一时**自动补入** `requires`（宽松模式）或报红（发布严格模式）。绝不静默丢。

**必配硬门（SPEC §5「引用可校验」）见 §10.1。**

### 4.6 IO 契约 · 预算与红线

```ts
export const SkillBudgetSchema = z.object({
  rounds: z.number().int().positive().optional(),          // → AgentBudget.maxRoundTrips
  discoverCalls: z.number().int().positive().optional(),   // → AgentBudget.maxDiscoverCalls
  toolCalls: z.number().int().positive().optional(),       // → AgentBudget.maxToolCalls
  expectedDurationMs: z.number().int().positive().optional(),
  cancellable: z.boolean().default(true),
});
```

| 字段 | 必填 | 默认 | 消费方 / 效果层判据 |
|---|---|---|---|
| `outputEnforcement` | 否 | `"off"` | **给 `outputSchema` 接上消费方**（SPEC D5：要么接消费方要么删）。`off`=今日行为逐字节不变；`warn`=不符只标注；`block`=不符拒绝作为最终答案。判据：**改 `outputSchema` 必填字段 → 缺该字段的答案在 `block` 下真被拦**（效果层，非"读出来了"） |
| `budget.rounds` | 否 | — | 归一 `skillBudgetOverride(skill) = budget.rounds ?? maxBudgetRounds`（**唯一读点**），注入 `AgentBudget.maxRoundTrips`（`packages/contracts/src/qos.ts:612`）。判据（Track E 约束 4）：**改这个数 → 该类题实际探索轮次真变** |
| `budget.discoverCalls` | 否 | — | → `AgentBudget.maxDiscoverCalls`（qos.ts:611）。治"探索预算是全局常数不分题型" |
| `budget.toolCalls` | 否 | — | → `AgentBudget.maxToolCalls` |
| `expectedDurationMs` | 否 | — | 前端进度预期 + 超时"是信号不是判决"的基线；**不得**直接当 abort 阈值 |
| `cancellable` | 否 | `true` | 声明本 Skill 是否可中途取消（诚实边界：底层求解取消能力另属 Track D，此处只是声明） |

**红线**：`budget.*` 一律**只收紧不放宽**——取 `min(声明值, 平台硬上界)`。否则一个 Skill 就能把全局预算护栏顶开（G-9/G-WORKFLOW-BUDGET-LEAK 同族）。

### 4.7 `progress` — 可观测声明（Track E ⑦）

| 字段 | 类型 | 必填 | 默认 | 消费方 / 判据 |
|---|---|---|---|---|
| `emitsNarration` | `boolean` | 否 | `false` | 声明本 Skill 会走的路径上必须真发推理旁白（`step.completed` 伪 step `type=agent_narration`，**不新增事件名**） |
| `phases` | `{ key: string, label: string }[]` | 否 | `[]` | 前端阶段条；`key` 只用于 UI 分组，**不参与路由** |

**诚实边界（必须写进契约注释，不许假绿）**：本体 §2.H 记载旁白目前**只接主 path-B**，`engine.ts` 子 agent（Coordinator 扇出/角色/场景 agent）**未接**。故 `emitsNarration=true` 的门只能覆盖主 path-B；覆盖面必须在门里显式声明，**不得**让门在未接线路径上"跳过即通过"。

### 4.8 `acceptance` — 自带验收（Track E ⑧）

```ts
export const SkillAcceptanceSchema = z.object({
  goldenCases: z.array(z.object({
    query: z.string().min(1),
    expect: z.object({
      intent: z.union([z.string(), z.literal("OPEN")]),   // 期望意图 key 或 OPEN
      mustCall: z.array(z.string()).default([]),          // 必须出现的工具/求解器
      mustNotCall: z.array(z.string()).default([]),
      answerMust: z.array(z.string()).default([]),
      answerMustNot: z.array(z.string()).default([]),
      behaviorGain: z.boolean().default(false),           // 挂载 vs 不挂载对照
    }),
  })).default([]),
  mustNotRouteTo: z.array(z.string()).default([]),         // 这些问句绝不该落到本 Skill
});
```

**与既有 `EvalCase(suite=skill_quality)` 的关系（关键·防两处手写）**：
`acceptance` 是**声明源**，`EvalCase` 是**派生物**——纯函数 `deriveSkillEvalCases(skill) → EvalCase[]`（R6）。既有发布门二（≥3 用例 · 三类各 ≥1 · `passRate=1`，`apps/agentcore/src/server.ts:1246-1269`）改为**读派生结果**，不改门的判据本身。收益：新增 Skill 自动被测、漏配即红，「金标集与目录漂移」这个问题从结构上不存在。

**分类映射**（对齐 `classifySkillEvalCases`，`apps/agentcore/src/skill-lint.ts:82-101`）：
- 应触发 → `expect.mustCall` 含 `load_skill`；
- 不应触发 → 由 `mustNotRouteTo[]` 派生（`toolSequence` 已声明且不含 `load_skill`）；
- 行为增益 → `expect.behaviorGain = true`。

### 4.9 未入契约的层：`context` 5.3 与 `learning`（12 层⑤⑫）

**这是本 PRD 唯一"少写"的地方，理由必须写明白**（原则 P4）：

| 项 | 为什么不入契约 |
|---|---|
| `context.memory`（5.3 决策历史/人工修正回写） | SPEC §2-⑤ 判定"只读不写——决策历史/人工修正没有回写通道"。**没有回写通道时给它一个声明字段 = 第二个 `maxBudgetRounds`** |
| `learning.*`（12 层⑫ 人工采纳率 → 学习） | SPEC §8 前置 1：采纳率埋点**跨租户混算**、`/metrics` 无鉴权。**在错的指标上建学习闭环，学到的也是错的**；先修前置，再入契约 |
| `context.retrieval` / `context.compression`（5.1/5.2） | 本期只登记**声明位**（`context?: { retrieval?: {...}, compression?: {...} }`），且**默认全空 = 今日平台行为**。仅当 Skill 需要按题型覆盖时才填；若落地时找不到真消费方，**这两项也应当一并砍掉**而不是留着 |

> 判据统一：**"能指出谁在什么时候读它、并写出效果层验收"才入契约。写不出来就先不写。**

---

## 5. 引用模型（SPEC §5/§6/§7 已定案·本 PRD 不推翻）

### 5.1 一条判据（SPEC §5 原文）

> **这个东西变了，是所有用它的 Skill 都该跟着变（→ 引用），还是只有这一个 Skill 该变（→ 内联）？**

### 5.2 包内四类文件一律 `requires`（SPEC §7 定案 1）

`ontology|rules|tools|solver` 四类文件是**需求声明/契约**，不是定义：

```
skill_package/
├── ontology/requires.yaml   → requires.objectTypes[] / requires.relations[]
├── rules/requires.yaml      → requires.rules[]
├── tools/requires.yaml      → requires.tools[] / requires.mcp[]
└── solver/requires.yaml     → requires.solvers[]（含内联 objective/weights）
```

**`requires` 是契约，不是副本**：装载/发布时校验宿主是否满足；**不满足则拒绝安装**，而不是带着自己那份定义偷偷跑。由此同时成立：**包自足可分发**（完整声明依赖）+ **定义单一真源**（规则/本体/工具/求解器各只有一处）。

### 5.3 归一与解析（一份声明、一处读）

```
requires（权威） ∪ references[]（带 role） ∪ dependsOn[]（历史字段）
        └── normalizeSkillRequires()（纯函数·R6·唯一读点）
                ├── 发布门：逐 key 校验存在性/状态（§10.1）
                ├── 运行时：rule precondition/postcheck（沿用 engine.ts 现语义）
                ├── DRIL：resource_relations 投影（沿用 resource-projector 现语义）
                └── 影响分析：「改 C08 影响哪些 Skill」= 一次反查（不再 grep）
```

**反向收益**（SPEC §5：比正向更值钱）：有了引用清单，「改 C08 会影响哪些 Skill」变成一次查询——今天回答这个问题只能 grep，而 grep 会骗人。

---

## 6. 内联 vs 引用 · 逐字段归类

> 按 SPEC §5 判据逐字段归。**"内联"那一列是 Skill 的本体**——没有它，Skill 会变成空壳（防另一个极端）。

| 字段 | 归类 | 判据应用 |
|---|---|---|
| `requires.rules[].key` | **引用** | 规则改了，所有引用它的 Skill 都该跟着变 |
| `requires.solvers[].key` | **引用** | 求解器引擎/结构性约束是共享资源 |
| `requires.solvers[].objective/weights` | **内联** | 同一求解器不同 Skill 可有不同目标函数（SPEC §7 定案 2） |
| `requires.objectTypes/relations/slices` | **引用** | 本体变更应全局生效 |
| `requires.tools/mcp/workflows/agents` | **引用** | 工具/流程是平台资源 |
| `requires.dependsOn` | **引用** | Skill 间复用（`|Skill| > |意图|` 的正当来源） |
| `requires.dataSources[].category` | **引用** | 连接器分类是平台词表 |
| `requires.events.emits/consumes` | **引用** | 事件名是本体 §4 的单一来源 |
| `businessIntent.*`（角色/场景/触发条件/KPI 口径） | **内联** | 换一个 Skill 就换一套；`kpis[].metricKey` 本身仍是**引用** |
| `trigger.examples/antiExamples/exclusivity` | **内联** | "这题归不归我"只有这一个 Skill 该管 |
| `execution.mode` / `execution.plan[]` | **内联** | Reasoning 拓扑是本 Skill 独有语义 |
| `budget.*` / `maxBudgetRounds` | **内联** | "这类题给几轮" |
| `provenancePolicy` / `sideEffect` / `approvalGate` | **内联** | "这类题要不要强制出处 / 会不会写真值" |
| `acceptance.*` | **内联** | 本 Skill 的验收标准 |
| `outputSchema` / `outputEnforcement` | **内联** | 本 Skill 的输出形状 |
| ❌ 真值数据 | **不放进 Skill** | 归本体/对象层（R4） |
| ❌ 租户阈值 | **不放进 Skill** | 归 rule params / feature config（一个 Skill 多租户复用） |
| ❌ 业务常数 | **不放进 Skill** | 归行业模板（R14） |
| ❌ 模型选择 | **不放进 Skill** | 归 LLM 用途绑定（换模型不该改 Skill） |

---

## 7. `execution` 详规补充：迁移语义

### 7.1 三种模式对应今天的三条路

| mode | 今天对应 | 迁移动作 |
|---|---|---|
| `DETERMINISTIC` | 意图 → `planRef` → `ExecutionPlan.steps` → workflow executor | `steps` **原样搬入** `execution.plan[]`（字节相等） |
| `EXPLORATORY` | 未命中意图 → path-B `runAgentLoop`（"探索 Skill"） | 新建；`plan` 空、`budget` 按题型声明 |
| `HYBRID` | path-A 跑不出 → 回落 path-B | 把隐式回落写成 `fallback: "explore"` |

### 7.2 迁移四条硬约束（Track E 原文，逐条落到本契约）

| # | 约束 | 本契约的对应 |
|---|---|---|
| 1 | **零行为漂移** | `execution.plan[]` ≡ `AnyPlanStepSchema`；验收 = 同意图同槽位，迁移前后 **answer 与 provenance 字节相等**（非"Skill 里有 plan 字段"这种运输层断言） |
| 2 | **单一真源硬门** | `plan` 与 `planRef` 互斥；收口后 `ExecutionPlan` 无独立注册/播种/查询入口；任一意图同时解析出 Plan 与 Skill 两份 → 红 |
| 3 | **entitlement 一处** | 需扩 `FeatureDef.bindings.skills`（`packages/contracts/src/features.ts:16-22` 今天没有），与 `intentAllowed` 同一处判定 |
| 4 | **探索 Skill 必须有真消费方** | `skillBudgetOverride()` 唯一读点 → `AgentBudget`；效果层验收：改数 → 轮次真变 |

---

## 8. 包结构 → `resources[]` 映射

### 8.1 分流判据（对 SPEC §6 接线点的落地细化·不推翻定案）

SPEC §6 指出包的多文件结构**天然映射到既有 `resources[]`**（`SkillAttachment`，带 mime/description，agent 经 `read_skill_resource` 渐进披露），且该字段今天 **7/7 全空**（本会话核实，逐行位置见 §11.1）——**故不需要新造承载机制**。

本 PRD 补一条落地判据，因为二者用途不同：

> **机器要据它做校验/路由 → 进结构化字段；人或模型要读它 → 进 `resources[]`。**

理由：`requires` 若只作为附件进 `resources[]`，就退化成不可校验的 blob，SPEC §5「必配硬门：引用可校验」当场落空。同一份内容**可以两边都有**（结构化字段 + 渲染成 markdown 的附件），但**权威永远是结构化字段**。

### 8.2 逐文件映射表

| 包文件 | 去向 | 说明 |
|---|---|---|
| `skill.yaml` | **Skill 本体**（非 resource） | 编译成 `SkillDefinition` 各字段 |
| `metadata.yaml` | `identity` + `businessIntent` | business_owner→`identity.owner`；target_users→`businessIntent.userRoles`；business_value/frequency→`businessIntent.decisionScene`/`triggerConditions` |
| `ontology/requires.yaml` | `requires.objectTypes` / `requires.relations` | 需求声明·可校验 |
| `ontology/events.yaml` | `requires.events` | **今天完全没有的一层**：谁发谁收 |
| `rules/requires.yaml` | `requires.rules` | 只列 key + 所需状态 |
| `tools/requires.yaml` | `requires.tools` / `requires.mcp` | 只列 key |
| `solver/requires.yaml` | `requires.solvers`（含内联 objective/weights） | **禁** `.lp`/`.mps`（SPEC §7 定案 2） |
| `agents/agents.yaml` `agents/roles.yaml` | `requires.agents` | 列 agentId/key + 所需 scope |
| `workflow/workflow.yaml` | `requires.workflows` + `approvalGate` | 列 step 引用（skill/solver/agent/approval） |
| `reasoning/graph.yaml` | `execution.plan[]`（+ `execution.mode`） | 推理拓扑=内联 |
| `reasoning/strategies.yaml` | `execution.fallback` + `budget.*` | 策略=预算与回落声明 |
| `reasoning/prompts/*.md` | **`resources[]`**（mime `text/markdown`） | SPEC §6：拆文件才写得下 Reasoning 说明；body 用 `{{resource:name}}` 引用（lint 已校验可解析，`apps/agentcore/src/skill-lint.ts:279-284`） |
| `context/context.yaml` | `context.retrieval/compression`（声明位·§4.9） | 无消费方则不落 |
| `context/memory.yaml` | **本期不落**（§4.9） | 无回写通道 |
| `evaluation/testcases.yaml` | `acceptance.goldenCases[]` | 派生 `EvalCase`，不进 resources |
| `evaluation/metrics.yaml` | **本期不落**（§4.9 learning 前置未修） | — |
| `output/schema.yaml` | `outputSchema` + `outputEnforcement` | — |
| `README.md` · 长参考表/清单 | **`resources[]`** | body 中超过 10 行的静态数据必须下沉（既有编写规范原则） |

### 8.3 三级渐进披露（已核实的既有机制，直接复用）

| 级 | 载体 | 注入点（核实） |
|---|---|---|
| 一 | `summary` | `buildSkillSection` 写进 system prompt（`apps/agentcore/src/agent/prompts.ts:72`） |
| 二 | `body` | `load_skill(skillId)` 回执（`apps/agentcore/src/engine.ts:378`） |
| 三 | `resources[]` | 同回执附清单（name/url/mime/description，`engine.ts:379-384`）→ `read_skill_resource` 按需读 |

**故 Skill 包的"变大"不会撑爆上下文**——这是 `resources[]` 该被用起来的根本理由，不是整洁问题。

---

## 9. 命名红线

### 9.1 Compiler 产物 **不得**叫 `Execution Plan`

**证据（本会话核实）**：

1. `ExecutionPlanSchema` / `PlanStepSchema` 已被 QOS workflow 概念占用：`packages/contracts/src/qos.ts:180` / `:108`，并被 `apps/agentcore/src/catalog/service.ts` 消费（`CreatePlanBodySchema` 由它派生）。
2. **仓里已经为同一个撞名付过一次代价**：`packages/contracts/src/execution-plan.ts` 的文件头注释原文——「契约 §1 称之为 ExecutionPlan；因 `qos.js` 已占用 `ExecutionPlanSchema`/`PlanStepSchema`（workflow 概念），本组合路径契约改用 **ComposePlan** 族命名…避导出冲突」。
3. Track E 定案后 `ExecutionPlan` 这个名字还会被**继续占用**（`execution.plan[]` 就是它的语义延续），撞名会让"哪个 Plan"永久失去单一指代。

### 9.2 命名裁定

| 概念 | **采用名** | 禁用名 |
|---|---|---|
| Compiler 从 Skill 声明编译出的可执行图 | **`SkillRuntimeGraph`**（节点 `SkillRuntimeNode`） | `ExecutionPlan` / `Execution Graph` / `ComposePlan`（已占用） |
| Skill 内的确定性步骤序列 | `execution.plan[]`，元素仍叫 `PlanStep` | 改名（改名即行为漂移风险，且今日语义就是它） |
| Skill 包的分发件 | `.skill` 包 + `manifest.json` | `plan package` |

**编译产物与 `execution.plan[]` 的关系**：`SkillRuntimeGraph` 是**编译期产物**（含引用解析结果、拓扑校验、预算合成）；`execution.plan[]` 是**声明源**。二者不是同一层，绝不能共用一个名字——共用即回到"两份声明互不知情"。

### 9.3 其他命名纪律

- 禁用外部产品名（CLAUDE.md 铁律）。
- 新枚举一律先查既有词表：`riskLevel` 复用 Intent 的三值、引用 role 复用 `SKILL_REFERENCE_ROLES`、副作用复用 `SkillSideEffectSchema` —— G-SIDEEFFECT-VOCAB-SPLIT 的直接教训（同一概念三套词表，其中一套所在文件根本不在仓里，判定分支永远不触发而测试照样绿）。

---

## 10. 门禁与验收

### 10.1 新门 · 引用可校验（SPEC §5「必配硬门」）

**静态半**（可进 `pnpm gates`）：只能守**平台静态注册池**——

| 校验 | 真源 |
|---|---|
| `requires.tools[].name` ∈ 工具注册表 | `apps/agentcore/src/tools/registry.ts` |
| `requires.solvers[].key` ∈ 求解器注册表 | DataCore 求解器注册表（经已 build 的 dist 读，同 `resource-descriptor:check` 模式） |
| `requires.events.emits/consumes` ∈ 本体 §4 事件表 | `docs/SYSTEM-ONTOLOGY.md` §4 + `event-subscriptions.ts` |
| `execution.plan[]` 步骤类型 ∈ `AnyPlanStepSchema` 词表 | `apps/agentcore/src/catalog/service.ts:36` |

**运行态半**（发布端点，非静态门）：`requires.objectTypes/relations/slices/rules/workflows/agents/dependsOn` 是**租户运行态**，静态扫描看不见 → 在 `POST /b/v1/skills/:id/publish` 校验，不满足即 `422 SKILL_REF_UNRESOLVED`。

> **诚实边界必须写进门的输出**：门只守静态池那一半；哪一半由端点守、哪一半没人守，必须在门的通过/失败信息里显式声明。今天 `skill-lint.ts:176` 的现状是——`validateRefResolution` **只校验 `kind==="skill"`**，注释写"非 skill 引用由发布时的跨系统探针或各自注册表保证"，而**该探针本会话未在 publish 路径中找到**（`apps/agentcore/src/server.ts:1231-1289` 只有 lint + eval + probe 三段）。这正是 SPEC §5 说"这道门今天做不了"的实证。

### 10.2 SEAM 验收（头号复验判据，不接受各半 unit 绿）

| # | SEAM | 断言 |
|---|---|---|
| S1 | **迁移零漂移** | 同一意图、同一槽位：迁移前（`Intent.planRef→ExecutionPlan`）与迁移后（`Skill.execution.plan[]`）产出的 **answer 与 provenance 字节相等**。变异反证：改 `execution.plan[]` 一步 → 必须变红 |
| S2 | **预算效果层** | 改某 Skill 的 `budget.rounds` → 该类题的**实际探索轮次真变**（观测 SSE iteration / `AgentRunRecord`），非"字段被读出来" |
| S3 | **引用可校验** | `requires.solvers[].key` 改成不存在的 key → 发布 422；改回 → 通过（green→red→green） |
| S4 | **输出契约生效** | `outputEnforcement=block` + `outputSchema.required` 加一个字段 → 缺该字段的答案真被拦；`off` 下逐字节等同今日 |
| S5 | **1:1 边成立** | 同一 `intentKey` 出现两个 PUBLISHED Skill → 红 |
| S6 | **步骤词表不丢** | 含 `query_timeseries_agg` / `search_knowledge` / `plan_slice` 的既有计划迁移后仍可执行（防 §4.4 红线 1 的静默丢步） |
| S7 | **acceptance 派生** | 从 `acceptance.goldenCases[]` 派生的 `EvalCase` 满足既有发布门二的三类覆盖；删一类 → 发布红 |
| S8 | **entitlement 一处** | 关闭绑定该 Skill 的 feature → Skill 与其意图**同时**不可达（无半开态） |

### 10.3 与既有门的关系

- 既有 Skill 发布双门禁（结构 lint + 评测门禁 + SkillProbeRunner）**不动判据、只换数据来源**（评测用例改为派生）。
- 本体 §7 已注明：这两道门**没有 `pnpm` 门名**，是运行态端点门，不是 CI 静态门——本 PRD 新增的静态半才进 `pnpm gates`，且落地时必须同步回写本体 §7（否则 `ontology-writeback:check` 红）。

---

## 11. 诚实边界 · 事实核实清单

### 11.1 本会话亲手核实（给出 `file:line` 或可复跑命令）

| 事实 | 证据 |
|---|---|
| `SkillDefinitionSchema` 现有 18 个字段，其中工业级契约字段（`capability`…`maxBudgetRounds`）9 个全为 optional | `packages/contracts/src/agentcore.ts:236-262` |
| `maxBudgetRounds` **零消费方** | `grep -rn "maxBudgetRounds" --include=*.ts apps packages \| grep -v "\.test\."` → 仅 `packages/contracts/src/agentcore.ts:260` 一条 |
| `outputSchema` **无校验消费方**（只有 lint 形状检查 + DRIL 投影） | `apps/agentcore/src/skill-lint.ts:300` · `apps/agentcore/src/dril/resource-projector.ts:149` |
| `dependsOn` **有代码消费方**（补正给定口径） | `apps/agentcore/src/skill-lint.ts:212/306/309`（解析 + 环检测）· `apps/agentcore/src/dril/resource-projector.ts:334`（关系投影）。**是 7/7 全空导致消费方从不触发**，不是没接线 |
| `references[]` 有真运行时消费方 | `apps/agentcore/src/engine.ts:41-51` `skillRuleRefs` → precondition 预检 / postcheck |
| 7 个种子 Skill 的 `resources` 全空 | `apps/agentcore/src/mocks/seed.ts` 七处 `resources: []`（894 / 941 / 985 / 1029 / 1072 / 1116 / 1163 行） |
| 7 个种子 Skill 中 **5 个 PUBLISHED / 2 个 DRAFT** | 同上；因 `selectTenantSkills` 只收 PUBLISHED（`apps/agentcore/src/router/orchestrator.ts:235`），自由问答池实为 5 |
| `skill-lint` 上限（summary 200 / body 3000）与契约上限（400 / 50_000）**不一致** | `apps/agentcore/src/skill-lint.ts:45-46` vs `packages/contracts/src/agentcore.ts:242-243` |
| 计划步骤真实词表比 contracts 宽 3 种 | `apps/agentcore/src/catalog/service.ts:28-36`（`query_timeseries_agg`/`search_knowledge`/`plan_slice`）· `apps/agentcore/src/workflow/executor.ts:27` |
| `ExecutionPlanSchema` 被 3 个文件引用（5 处） | `grep -rn "ExecutionPlanSchema" --include=*.ts apps packages` → `qos.ts` / `execution-plan.ts` / `catalog/service.ts` |
| 仓内已有一次同名冲突并改名 `ComposePlan` 的先例 | `packages/contracts/src/execution-plan.ts` 文件头注释 |
| 工具注册表：`BUILTIN_TOOLS` 28 条 + `FINAL_ANSWER_TOOL` + `LOAD_SKILL_TOOL` | `awk '/export const BUILTIN_TOOLS/,/^\];/' apps/agentcore/src/tools/registry.ts \| grep -c 'name: "'` → 28；`apps/agentcore/src/tools/registry.ts:480` |
| `FeatureDef.bindings` **无 `skills`** | `packages/contracts/src/features.ts:16-22`（只有 `intents`/`solverKeys`/`apiTags`） |
| 发布路径只有 lint + eval 计数/分类 + probe 三段，**无跨注册表引用校验** | `apps/agentcore/src/server.ts:1231-1289` |
| `validateRefResolution` 只校验 `kind==="skill"` | `apps/agentcore/src/skill-lint.ts:176` |
| 三级渐进披露的三个注入点 | `apps/agentcore/src/agent/prompts.ts:72` · `apps/agentcore/src/engine.ts:378` · `:379-384` |
| `selectTenantSkills` 语义（PUBLISHED / 同 key 取最高版本 / key 字典序） | `apps/agentcore/src/router/orchestrator.ts:232-240` |
| `AgentBudget` 的 `maxRoundTrips`/`maxDiscoverCalls` 字段与默认值 | `packages/contracts/src/qos.ts:611-612` |
| 本体可解析的不变量/断点编号集 = `R1–R18` / `G-1…G-12`（另有命名断点不入编号集） | `grep -oE "^\\| \\*{0,2}(R[0-9]+\|G-[0-9]+)\\*{0,2} \\|" docs/SYSTEM-ONTOLOGY.md \| sort -u` |

### 11.2 **未核实**（引用他人实测或上位文档，本会话未复跑）

| 断言 | 出处 | 状态 |
|---|---|---|
| 意图 32 / 执行计划 32 / Skill 7 / 场景卡 20 / 场景入口 9 | 审核方本会话实测 | **未复跑**（本单禁跑测试） |
| 7 个 Skill 的 `body` 平均 441 字 | 审核方实测 / SPEC §4 | **未复跑** |
| 求解器 57 个 · 对象类型 91 个 ACTIVE / 771 属性 / 11,087 对象 | SPEC §2 | **未核实**；本体 §3 另有"全集 32"的旧记，两处不一致，本 PRD 一律不复述计数 |
| `G-C08-EXPR-PARAM-SPLIT`（规则 expression 不能引用 params，静默恒假） | 本体 §8 + SPEC §2-⑧ | **未核实**（未读 `ruledsl` 求证）；本 PRD 只声明"引用规则不修好它" |
| 采纳率埋点跨租户混算 · `/metrics` 两服务 200 无鉴权 | SPEC §8 前置 1 | **未核实**；但它是 §4.9 砍掉 learning 层的**唯一理由**，若该前提为假，learning 层应重新评估 |
| `G-ROUTE-REGEX-PREEMPTS-RETRIEVAL` 等三条 WO 拟登记断点 | `docs/WO-ROUTING-RETRIEVAL-FIRST.md` 二 | **已核实其"尚未在本体 §8 登记"**（`grep -c` = 0）；断点内容本身未复核 |
| Skill 包各文件在真实分发场景下的可用性（签名/marketplace） | SPEC §8 | **未核实**·不在本 PRD 范围 |

### 11.3 本 PRD 自身的边界

- 本 PRD **只定义契约与 DSL**。契约落地需要三件本 PRD 未做的事：① `AnyPlanStepSchema` 的 contract gap 收编进 contracts（否则违 R1）；② `FeatureDef.bindings.skills` 扩面（否则 Track E 约束 3 不成立）；③ 32 份既有 Plan 的迁移执行（须带 S1 零漂移对照）。**三者任一缺席，本契约都只是"声明了没接线"——即本 PRD 自己反复引以为戒的那一族。**
- 本 PRD 未跑任何测试、未改任何代码（本单纪律）。所有"今天是 X"的断言均已在 §11.1/§11.2 分栏，**没有第三栏**。
