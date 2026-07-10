# PRD · L1-A 需求图引擎（RequirementGraph Engine）—— 施工级

> 状态：设计稿·**未实现**（诚实标注·非"已完成"）。审核方设计子代理产出，供 dev 建、审核方真跑复验。
> 基线源：`docs/req-inventory/SUPPLEMENT_RG-Engine-fullspec.md`（12 模块→L1 映射）+ `/tmp/rge.txt` / `/tmp/rge_clean.txt`（RG Engine docx V1.0 Ch01-12 满配全文·**已用于本 PRD 的 Question AST 与 Graph Builder 具体算法**）+ `docs/DESIGN-decision-os-complete-upgrade.md` §4（L1-A 在脊柱的位置）+ `docs/DESIGN-refit-rollback-plan.md` §L1-A（回退纪律基线·本 PRD 是其施工级展开·不推翻）。
> 范围纪律：本 PRD 只落 **RG Engine Ch02-04 核心**（Question AST + Requirement Graph IR + Graph Builder），Ch05 Rewrite/隐性需求已由 L0 `expandHiddenRequirements` 在飞（本 PRD 复用不重造），Ch09 Validator/Ch10 Execution Planner 归 L1-B/后续单（本 PRD 只列衔接不展开）。

---

## §0 本体引用与影响（铁律 0·强制）

> 本节先行（产出任何架构/PRD 前必读本体）。检索走克隆索引 `docs/ontology/INDEX.md`，母体 `docs/SYSTEM-ONTOLOGY.md`。

- **对象类型（§2.H 交互编排域 / §2.B 本体对象域）**
  - **复用**：`IntentDefinition`（qos.ts:40）· `ClassificationResult`（qos.ts:224）· `QueryTask`（qos.ts:424）· `SessionContext`（qos.ts:203）· `ExecutionPlan/PlanStep`（qos.ts:105/177）· `PreAnalysisReport`（databuilder.ts:531）· `GapAnalysis`（databuilder.ts）· `ObjectTypeDef`/`ObjectInstance`（datacore domain.ts:290/383）· `SOLVER_REGISTRY`（solver-registry.ts:55）· `SOLVER_DATADEP`（datadep.ts:86）· `DATADEP_ROLE_CANONICAL`（datadep.ts:131）· `SOLVER_COVERAGE`/`INTENT_PROBLEM_CLASS`（solver-coverage.ts:27/后段）。
  - **拟立**（落地回写母体 §2.H）：`RequirementGraph`（一等**咨询性派生对象**·可 drop 重生·非业务真值）· `QuestionAST`（其解析前产物）。二者均 R13 可溯源、R2 带 tenantId。
- **链路（§3 关系图 / §10.3 问句到答案链）**：中枢链 `sys.orch.query_to_answer` = **Client→Query→Intent→Plan→Step\*→{Solver｜Slice｜Rule}→AnswerBlock→SSE**（审核全链·10-self-domains.md:49）。L1-A 在 **classify 与 Plan 之间** additive 插入「问句→需求图」**旁路节点**（观察态·**不改判决**：路由仍归 classify→proceedWithIntent）。需求图的下游投影（solver/slice/data 候选）是 L1-B `synthesizePlan` 的消费底座。**回写**：§3 登记「问句→需求图」旁路、§10.3 中枢链补需求图节点。
- **事件（§4 数据流事件图）**：**复用** `step.started`/`step.completed` 伪步帧（schema `{stepId,type,outcome?,durationMs?}`·QOS-PRD §8.2·orchestrator.ts:625/652 已为 `classify` 步先例）——`stepId="requirement-graph"`，**零新 SSE 事件名**（守 §8.2 一字不差）。可选内部域事件 `requirement_graph.built`（**非 SSE**·审计/失效用·经既有 outbox/B→A 失效钩）。
- **不变量（§5）**：**R6 确定性**（同问句+同上下文+同 classification+同注册表版本 → 字节级同图·热路径**无随机/时钟/LLM**·实体解析走确定性阶梯 slots.ts:52 已钉「no LLM/no network」）· R1 contracts-only（契约进 `@platform/contracts`·前端/跨包不重定义）· R2 tenant everywhere（RG/AST 带 tenantId·跨租户 404）· R9 仓储双实现（RG 落库需 memory+pg 四处同改）· **R11 全链闭包**（RG 每节点 ∈ 真实注册表·**三白名单门** by-construction·零幽灵节点）· R13 溯源（节点带 `source`/`refKey`·可当场亮出）· R14 零业务常数（`roleType` 抽象角色·非「常州」/「NCM4680」）· R16 发育闭环（RG 是倒序发育的**结构化底座**）。发布律**十红线**：RL2 暗发 `defaultOn:false`（关=不存在）· RL9 additive 可回退（契约字段全 optional·migration 带 down·旧路径永不删）· RL10 不与在建分叉。
- **断点（§8 断点登记）**：G-1（预诊断·RG 把预分析散件结构化·强化）· G-3（presetContext / launcher→自由问句接缝·RG 的实体解析复用同一 fillSlots 阶梯）· G-4（入口收口·RG 为统一入口提供结构化中间层）；**衔接** L1-B `synthesizePlan` 影子治母体标注的「④计划综合 = MISSING（现模板）」（DESIGN §3）。**回写**：§8 G-1 标注「需求图结构化升级」。
- **门禁（§7）**：新增 `requirement-graph:check`（三白名单+契约漂移守·并入 `pnpm gates`·登母体 §7）。

---

## §1 目标 / 非目标

### 1.1 目标（G）
- **G1 · Question AST**（Ch02）：把自然语言问句确定性解析为结构化 `QuestionAST`（Intent / Entity / Action / Constraint / Temporal / Objective / Output）。接现有 QOS classify（deterministic+LLM 分类·orchestrator.ts:630/341），是其**结构化升级**（additive·不推翻）。
- **G2 · Requirement Graph IR**（Ch01/04）：`QuestionAST` + 现有推导物（intents/solvers/objectTypes/data-deps/hidden-req）→ `RequirementGraph{nodes,edges}`（语义属性图 IR）。Graph Builder 满配 Ch04 的 node/edge/property/event/constraint 推导算法，**复用** L0 已产散件（不新建引擎骨架，先把现有推导物形式化为图契约）。
- **G3 · I/O 契约 + 下游接口**（Ch01.7-1.8）：`RequirementGraph` → {`sliceTargets`（切片接口）· `solverCandidates`（求解器接口）· `dataRequirements`（数据接口）}——三条纯派生投影，喂给现有 solver registry / slice-planner / L1-B planner。
- **G4 · 确定性 + 可溯源 + 可回退**：R6 双跑字节一致；每节点 R13 可溯源（source/refKey）；全程暗发·关闸=改造前系统。

### 1.2 非目标（NG·守边界·防膨胀）
- **NG1**：不做 Graph Rewrite/隐性需求发现的**新引擎**——复用 L0 在飞 `expandHiddenRequirements`（三白名单·databuilder.ts:733），Ch05 归 L0。
- **NG2**：不做 Execution Planner / Workflow DAG 生成——那是 **L1-B**（`synthesizePlan(reqGraph)→ExecutionPlan`·Ch10）。本 PRD 只**暴露下游 I/O 接口**供 L1-B 消费，不生成计划、不接管路由。
- **NG3**：不做 Graph Validator 的 Solver Feasibility/自动修复——Ch09 归 **L0-SOLVER-COVERAGE**（在飞·solver-coverage.ts）；L1-A 只做**结构层三白名单校验**（节点∈注册表），不做可行性求解。
- **NG4**：不做 Graph Versioning/Cache/Optimization/Learning（Ch06-08/11-12）——基础设施章·多为重选型（DEFER 倾向·DESIGN §2）。
- **NG5**：不引入 Neo4j/向量库/GNN——图落 pg（JSONB·R9）；实体解析**不引入 embedding**（现系统 embedding 仅 KB/rule-docs·不在本体解析热路径·守 R6）。
- **NG6 · additive 铁律**：L1-A **不改变现 QOS 任何路由判决**。RG 为观察态旁路产物；现 classify→proceedWithIntent→runPathA/runPathB 链**逐字节不变**（关闸可证）。

---

## §2 与现系统接缝（file:line·复用/新增/暗发/回退）

### 2.1 中枢链插入点（唯一·additive）
现链（orchestrator.ts）：
```
submitQuery(:431) → runPipelineInner(:525) → classify(:630/:743) → fuseClassification(:341)
   → [τ 决策 :674] → proceedWithIntent(:948) → runPathA(:1058) | runPathB(:1153)
```
**插入点**：`runPipelineInner` 内、classify 完成落库（orchestrator.ts:672 `patch({classification})`）**之后**、τ 决策（:674）**之前**，加一段暗发旁路：
```ts
// orchestrator.ts ~:673（additive·env 暗发·纯观察态·不改后续判决）
if (this.deps.config.QOS_REQUIREMENT_GRAPH === "1") {
  await this.buildRequirementGraph(task, classification, candidates, auth); // try/catch 内吞·失败不阻断主链
}
```
`buildRequirementGraph` 为新私有方法：build QuestionAST → build RequirementGraph → 持久化 → emit `step.completed{stepId:"requirement-graph"}`。**异常一律吞**（`try/catch`·RG 是咨询产物·绝不阻断答题）。关闸（env 未置/≠"1"）→ 该段不执行 → pipeline 与改造前**字节一致**（对齐 QOS_CLASSIFY_FUSE 暗发范式·orchestrator.ts:638-651）。

### 2.2 复用清单（不重造·file:line）
| 能力 | 复用的现有制品 | 锚点 |
|---|---|---|
| 意图/关键词确定性打分 | `deterministicMatchScore` · `normalizeQuery` · `charBigrams` | orchestrator.ts:291 / :269 / :283 |
| 问题类目归口 | `problemClassForIntent` · `INTENT_PROBLEM_CLASS` · `SOLVER_COVERAGE` · `isProblemClassCovered` | solver-coverage.ts:155 / 后段 / :27 / :161 |
| 实体→本体对象解析（三阶梯） | `fillSlots` · `validateSlotValue`(objectRef 分支 ~:384) · `resolveUniqueByName` · `entitySimilarity`(exported) · `nearestEntities` | slots.ts:467 / :353 / :145 / :180 / :207 |
| 本体对象读取（OBO REST） | `dataCore.ontology` 客户端（`OntologyClient` / `HttpOntologyClient`）：`getObject`·`queryObjects`·`listObjectTypeKeys` | clients.ts:15 / datacore-http.ts:82；调用 GET `/a/v1/objects/:type/:id`(app.ts:2292)、POST `/a/v1/objects/query`(app.ts:2200)、GET `/a/v1/ontology/object-types`(app.ts:1750) |
| 数据需求（Data 节点源） | `SOLVER_DATADEP`（求解器→角色依赖清单） · `DATADEP_ROLE_CANONICAL`（角色→canonical 本体类型） | datadep.ts:86 / :131 |
| 求解器候选（Solver 节点源） | `SOLVER_COVERAGE`（problemClass→solverKey[]） · `SOLVER_REGISTRY`（key/route/outputShape） | solver-coverage.ts:27 / solver-registry.ts:55 |
| 隐性需求扩展（Ch05·复用不重造） | `expandHiddenRequirements`（三白名单·零幽灵） · `preAnalyzeQuery`（同 diffGap 纯核） | databuilder.ts:733 / pre-analyze.ts:289 |
| 切片目标派生（Slice 接口） | `deriveSliceTargetCandidates` · `lookupReusableByQuestion` · `buildSliceIndex` | datadep.ts:164 / slice-index.ts:99 / :38 |
| 持久化仓储（双实现） | `preAnalyses` repo（RG 作 optional 字段搭车·或平行新表） | repos.ts:310-315 / memory.ts:67 / pg.ts:528 |
| 目标-指标脊柱（Goal/Metric 节点关联） | `spine.ts`（KSF/Metric/Principal） | spine.ts:12/37/23 |

### 2.3 新增清单
- **契约**（`@platform/contracts`·R1）：新文件 `packages/contracts/src/requirement-graph.ts`（`QuestionAstSchema` + `RequirementGraphSchema` 及子 schema），index.ts 追加 `export * from "./requirement-graph.js"`（index.ts:50 后）。
- **PreAnalysisReport 扩字段**（additive·optional）：databuilder.ts:531 `PreAnalysisReportSchema` 追加 `requirementGraph: RequirementGraphSchema.optional()`（zod 非 strict·旧消费方零感知·refit L1-A 钉死此法）。
- **引擎码**（agentcore）：新文件 `apps/agentcore/src/growth/requirement-graph.ts`（纯函数 Graph Builder + QuestionAST 解析器·R6 无 IO 除本体读）；`orchestrator.ts` 加 `buildRequirementGraph` 私有方法（编排接线）。
- **端点**（agentcore·暗发）：`GET /b/v1/queries/:taskId/requirement-graph`（读 RG·entitlement 门）。
- **门**：`scripts/check-requirement-graph.mjs` → `requirement-graph:check`（三白名单+漂移守·并入 `pnpm gates`）。
- **配置**：agentcore `config.ts` 加 `QOS_REQUIREMENT_GRAPH: z.string().optional()`（暗发·config.ts:22 QOS_CLASSIFY_FUSE 同范式）。

### 2.4 暗发 feature key（双闸·对齐两系统暗发范式）
- **内部算法闸（env·进程级·deploy 控制）**：`QOS_REQUIREMENT_GRAPH`（`z.string().optional()`·`=== "1"` 开）——控**是否在热路径构图**。关=该段不跑=pipeline 字节一致（内部行为切换·非用户面·对齐 `QOS_CLASSIFY_FUSE` orchestrator.ts:638）。
- **用户面 entitlement 闸（per-tenant·dotted key）**：`growth.requirement_graph`（`defaultOn:false`）——控**读端点是否存在**（关=404 `FEATURE_NOT_FOUND`·不泄漏存在性）。**必须双注册**：agentcore `features/registry.ts`（FEATURE_REGISTRY·registry.ts:9-96·防「未注册键恒真」陷阱 registry.ts:151）+ datacore `features.ts`（权威集·同 key 同 `defaultOn:false`）。范式对齐 `growth.pre_analysis`(registry.ts:91) / `growth.hidden_req`(registry.ts:95)。
- **回退杠杆**：关 `QOS_REQUIREMENT_GRAPH` → 连图都不构（热路径零变化）；关 `growth.requirement_graph` → 读端点 404；migration down 只 drop RG 咨询表（零业务损失）。**旧 QOS 路径永不删**——RG 全程只读+旁写，classify/proceedWithIntent/runPathA/runPathB 判决地位不换手。

---

## §3 统一数据模型（zod 契约草案·`packages/contracts/src/requirement-graph.ts`）

> 设计：AST 与 Graph 两级（对应 Ch02 与 Ch01/04）。全部 R14 抽象（roleType/ontologyType 是本体键·非业务字面量）；R6（generatedAt 由调用方注入·内部不取时钟）；R13（节点带 source/refKey）。

```ts
import { z } from "zod";
import { IsoTime } from "./common.js";

// ── Question AST（Ch02·"用户说了什么"）───────────────────────────────
export const AstIntentSchema = z.object({
  /** 一级分析原型（= problemClass·solver-coverage 键，如 forward_projection/bottleneck_detection）。 */
  problemClass: z.string(),
  /** classify 首候选意图键（若命中目录）。 */
  intentKey: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export const AstEntitySchema = z.object({
  text: z.string(),                                   // 原文片段（如 "常州基地"）
  ontologyType: z.string().nullable(),                // 解析到的已发布 ObjectType key（Base/Line/Order/Model…）
  objectId: z.string().nullable(),                    // 解析到的真实实例 id（obj_…）
  resolved: z.boolean(),
  /** 解析来源（R13·诚实位）：exact=id/PK 命中；unique_name=跨类型唯一名；fuzzy=近邻（仅澄清·不自动绑）；unresolved=域外。 */
  source: z.enum(["exact", "unique_name", "fuzzy", "unresolved"]),
  confidence: z.number().min(0).max(1),
});
export const AstActionSchema = z.object({
  type: z.enum(["SHUTDOWN", "DELAY", "INCREASE", "DECREASE", "TRANSFER", "REPLACE", "ALLOCATE", "OTHER"]),
  targetType: z.string().nullable(),                  // 作用对象本体类型（如 Line）
  value: z.string().nullable(),                       // 幅度/量（如 "20%"·保留原文·不臆造数值）
});
export const AstConstraintSchema = z.object({
  kind: z.enum(["HARD", "SOFT", "OBJECTIVE"]),
  metric: z.string().nullable(),                      // 如 DeliveryRate/Cost
  operator: z.enum(["LE", "GE", "EQ", "LT", "GT", "NONE"]).default("NONE"),
  value: z.string().nullable(),
  direction: z.enum(["MAX", "MIN", "NONE"]).default("NONE"),
});
export const AstTimeSchema = z.object({
  kind: z.enum(["ABSOLUTE", "FUTURE_WINDOW", "PERIOD", "DEADLINE"]),
  from: z.string().nullable(),
  to: z.string().nullable(),
  window: z.number().int().nullable(),                // 如 30（配 granularity）
  granularity: z.enum(["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"]).nullable(),
});
export const QuestionAstSchema = z.object({
  astId: z.string(),                                  // ast_
  taskId: z.string(),
  tenantId: z.string(),
  rawText: z.string(),
  intent: AstIntentSchema,
  entities: z.array(AstEntitySchema),
  actions: z.array(AstActionSchema),
  constraints: z.array(AstConstraintSchema),
  timeScope: AstTimeSchema.nullable(),
  objectives: z.array(z.string()),                    // 目标叙述（如 "Minimize Delivery Risk"）
  outputs: z.array(z.string()),                       // 期望产出（如 "Affected Orders"/"Alternative Plans"）
  parserVersion: z.string(),                          // 解析器版本（R6 可重放钉版）
  generatedAt: IsoTime,                               // 调用方注入（内部不取时钟·R6）
});
export type QuestionAst = z.infer<typeof QuestionAstSchema>;

// ── Requirement Graph IR（Ch01/04·"需要什么"）───────────────────────
/** 节点类型（折叠 Ch01.7 12 类到映射真系统的集合）。 */
export const RequirementNodeKindSchema = z.enum([
  "question", "goal", "object", "metric", "constraint",
  "data", "model", "solver", "action", "event", "time",
]);
export const RequirementNodeSchema = z.object({
  nodeId: z.string(),
  kind: RequirementNodeKindSchema,
  name: z.string(),
  /** object/model 节点：绑定已发布 ObjectType key（三白名单校验对象·R11）。 */
  ontologyType: z.string().nullable(),
  /** data 节点：抽象角色键（∈ DATADEP_ROLE_CANONICAL·R14）。 */
  roleType: z.string().nullable(),
  /** solver 节点：求解器键（∈ SOLVER_REGISTRY·R11 三白名单）。 */
  solverKey: z.string().nullable(),
  required: z.boolean(),
  confidence: z.number().min(0).max(1),
  /** R13 溯源：节点从哪推来（如 "ast:entity" / "datadep:capacity_rollup" / "coverage:bottleneck_detection" / "hidden_req"）。 */
  source: z.string(),
  /** R13 溯源引用键（objectId / solverKey / roleType / intentKey…）。 */
  refKey: z.string().nullable(),
  props: z.record(z.string(), z.unknown()).optional(),
});
/** 边关系（Ch01.9：Ontology/Causal/Dependency/Requirement/Execution 五类关系折叠）。 */
export const RequirementEdgeKindSchema = z.enum([
  "requires", "depends_on", "causes", "optimizes", "has", "produces", "fulfills", "affects",
]);
export const RequirementEdgeSchema = z.object({
  edgeId: z.string(),
  from: z.string(),                                   // nodeId
  to: z.string(),                                     // nodeId
  kind: RequirementEdgeKindSchema,
  weight: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),                      // R13：为何连（"停机→产能下降"）
});
export const RequirementGraphSchema = z.object({
  graphId: z.string(),                                // rg_
  taskId: z.string(),
  tenantId: z.string(),
  questionAst: QuestionAstSchema,
  nodes: z.array(RequirementNodeSchema),
  edges: z.array(RequirementEdgeSchema),
  problemClass: z.string(),
  // ── 下游 I/O 投影（Ch01.7-1.8·纯派生·L1-B/slice/solver 消费口）──
  solverCandidates: z.array(z.string()),              // ∈ SOLVER_REGISTRY（SOLVER_COVERAGE 派生）
  dataRequirements: z.array(z.object({ roleType: z.string(), minRows: z.number().int() })), // SOLVER_DATADEP 并集
  sliceTargets: z.object({ rootType: z.string(), targets: z.array(z.string()) }).nullable(),
  /** 结构层覆盖信号（咨询·非判决·永不误红·对齐 §10 PreAnalysis 边界）：节点∈注册表比例。 */
  coverageScore: z.number().min(0).max(1),
  builderVersion: z.string(),
  generatedAt: IsoTime,
});
export type RequirementGraph = z.infer<typeof RequirementGraphSchema>;
```

---

## §4 关键算法（据 rge.txt 满配·Ch02 AST Parser + Ch04 Graph Builder）

### 4.1 QuestionAST Parser（Ch02·确定性·纯函数除本体读）
Pipeline（Ch02.6 顺序·全确定性）：`Raw → Normalize → Intent → Entity → Action → Temporal → Constraint → Objective → Output → AST`。

1. **Normalize**（Ch02.7）：复用 `normalizeQuery`（orchestrator.ts:269·小写+数字归一+去标点）。
2. **Intent**（Ch02.9）：**不重造分类**——直接取入参 `classification`（已由 classify+fuse 产出·orchestrator.ts:341/630）：`problemClass = problemClassForIntent(classification.candidates[0]?.intentKey)`（solver-coverage.ts:155）；`intentKey`/`confidence` 取首候选。（docx 的"三级 Rule+Embedding+LLM"已由现 classify 覆盖·L1-A 是其结构化承接·NG6 additive。）
3. **Entity**（Ch02.8·Ch04.5.2 Hybrid Resolution）：对问句中的候选实体片段，走**现成三阶梯确定性解析**（slots.ts·R6 无 LLM/网络）：
   - ① exact id/PK：`dataCore.ontology.getObject(type, key)`（clients.ts:27·GET /a/v1/objects/:type/:id）→ `source:"exact"`；
   - ② 跨类型唯一名：`resolveUniqueByName`（slots.ts:145·`queryObjects({name})` 服务端精确名过滤·**仅全局唯一才自动绑**）→ `source:"unique_name"`；
   - ③ 近邻（仅澄清·**绝不自动绑歧义**）：`entitySimilarity`（slots.ts:180·Levenshtein+子串·已 export）/`nearestEntities`（slots.ts:207）→ `source:"fuzzy"`，`resolved:false`；
   - 全落空 → `source:"unresolved"`（域外·诚实·不臆造）。
   - **候选片段抽取**：确定性——已发布类型别名/PK 词典命中 + CJK 名 bigram 窗（对齐 slots.ts CJK 处理），无 NER 模型（docx 的 NER 是可选增强·L1-A 不引入·守 R6/NG5）。
4. **Action**（Ch02.10·Ch04.8）：确定性动词词典（停机/延期/增加/调拨…→ SHUTDOWN/DELAY/…枚举）+ 量（`\d+%`/`\d+天`）保留**原文**（不臆造数值·KILL-MOCK）。
5. **Temporal**（Ch02.11）：确定性相对时间解析（复用 slots.ts 相对日期解析·fillSlots ①.5）——"未来30天"→`{kind:FUTURE_WINDOW,window:30,granularity:DAY}`；绝对/周期/截止同理。
6. **Constraint/Objective**（Ch02.12）：确定性表达式抽取（"不能延期"→HARD·"成本最低"→OBJECTIVE MIN）。
7. **AST 验证**（Ch02.14）：无 intent→降级（不构图）；有 action 无 targetType→标 unresolved（不补问·L1-A 观察态）。

**R6 保证**：无 LLM、无时钟（generatedAt 注入）、无随机；本体读经 OBO REST（可缓存·同快照版本同结果）。同（query, context, classification, 快照版本）→ 同 AST。

### 4.2 Graph Builder（Ch04·8 段 Pipeline·纯函数）
Ch04.4 Pipeline：`Context Load → Object Resolution → Node Gen → Relation Expansion → Property Completion → Constraint Injection → Solver Mapping → Validation`。L1-A 满配前 7 段，第 8 段做**结构层三白名单**（非可行性·NG3）。

- **① Object Node 生成**（Ch04.5）：AST `entities[resolved]` → `object` 节点（`ontologyType` = 解析类型·`refKey` = objectId·`source:"ast:entity"`）。confidence 融合沿用 slots 解析 source（exact=1.0 / unique_name=0.9 / fuzzy 不入图仅澄清）。
- **② Relation Edge 生成**（Ch04.6·Ontology Path Search）：对象间边不硬连——经**已发布 LinkType 图**（datacore GET `/a/v1/ontology/graph` app.ts:2332 / `buildSliceIndex` link 图 slice-index.ts:38）做最短语义路径（Ch04.6.3）：`Base -HAS→ Line -PRODUCES→ Model -FULFILLS→ Order`。边 `kind` 取 LinkType 语义。**断链止步**（resolveSpannedTypes slice-index.ts:23 已有此纪律）。
- **③ Data Node 推导**（Ch04·Data Expansion）：由 `problemClass → SOLVER_COVERAGE → solverKey[]`（solver-coverage.ts:27）→ 各 solverKey 的 `SOLVER_DATADEP.requires`（datadep.ts:86）并集 → `data` 节点（`roleType` 抽象角色·`DATADEP_ROLE_CANONICAL` 映 canonical 类型·datadep.ts:131）。边 `object -requires→ data`。
- **④ Solver Node 推导**（Ch04.10·Feature→Solver Matching）：`solver` 节点 = `SOLVER_COVERAGE[problemClass]`（∈ SOLVER_REGISTRY）。边 `question -requires→ solver`、`solver -depends_on→ data`。
- **⑤ Property 完成**（Ch04.7·Property Selection）：`data` 节点补 `props.requiredFields`（取 `SOLVER_DATADEP[k].props` 若声明·datadep.ts:31）。docx 的 Property Score 阈值（Ch04.7.2）**降级为**：只取清单声明字段（确定性·零业务权重魔数·守 R14）。
- **⑥ Event Node 推导**（Ch04.8）：AST `actions` → `event` 节点（如 SHUTDOWN→`event:LINE_STOP`·`props.severity` 保留原文值）。边 `event -causes→ metric/object`（因果·reason 存"停机→产能下降"）。
- **⑦ Constraint Node 注入**（Ch04.9·三来源）：AST 约束（用户表达）+ scenario/行业规则（复用 scenario-rules.ts injectScenarioRuleStep 语义）→ `constraint` 节点。
- **⑧ 隐性需求（Ch05·复用不重造）**：调 `expandHiddenRequirements`（databuilder.ts:733·三白名单 by-construction·零幽灵）扩 data/solver 闭包·回并入图（source:"hidden_req"）。
- **⑨ Graph Merge/Conflict**（Ch04.11-12）：同 (kind, ontologyType/roleType/solverKey) 节点去重（首现序·R6）；边冲突记 `props.alternatives`（保留·不丢·Ch04.12）。
- **⑩ 结构层校验 + coverageScore**：三白名单——`object.ontologyType ∈ listObjectTypeKeys`（clients.ts:39）· `solver.solverKey ∈ SOLVER_REGISTRY`（solver-registry.ts:116）· `data.roleType ∈ DATADEP_ROLE_CANONICAL`。任一越界=丢弃该节点+记 gap（诚实·不入图）。`coverageScore` = 命中注册表节点/总节点（咨询·永不误红）。

### 4.3 下游 I/O 投影（Ch01.7-1.8·纯派生·G3）
- `solverCandidates` = 图内 `solver` 节点 solverKey 集。
- `dataRequirements` = 图内 `data` 节点 {roleType,minRows} 集。
- `sliceTargets` = `deriveSliceTargetCandidates(primarySolverKey, primaryObjectType)`（datadep.ts:164）；近似问句复用 `lookupReusableByQuestion`（slice-index.ts:99）。
- 这三条即 **L1-B `synthesizePlan(reqGraph)→ExecutionPlan` 的输入底座**（衔接·不展开）。

---

## §5 端点 / 模块落点

- **主引擎落 AgentCore**（与 orchestrator 同栈·热路径构图）：`apps/agentcore/src/growth/requirement-graph.ts`（纯函数 Builder+Parser）+ `orchestrator.ts` `buildRequirementGraph`（接线）。**理由**：RG 消费 classify 产物 + 经 OBO REST 读 DataCore 本体（松耦合·不跨 app import 源码·R1）；DataCore 只经公开 REST 被读（现 `dataCore.ontology` 客户端 clients.ts:15）。
- **契约落 `@platform/contracts`**（R1 跨包共享）：`requirement-graph.ts` + `PreAnalysisReport` 扩字段。
- **读端点**（暗发·entitlement 门）：`GET /b/v1/queries/:taskId/requirement-graph` → `{requirementGraph}`（404 若 `growth.requirement_graph` 关 / 跨租户 / 未构）。经 nginx `/b/v1`→agentcore（deploy/nginx.conf）。
- **持久化**（R9 双实现）：优先**搭车** `PreAnalysisReport.requirementGraph`（复用 preAnalyses repo·repos.ts:310·零新迁移·refit L1-A 钉法）；若图体量需独立表 → 新表 `requirement_graphs`（migrations/*.sql + pg.ts + memory.ts + repo.ts 接口**四处同改**·R9）。
- **门**：`scripts/check-requirement-graph.mjs`（三白名单：图节点引用的 solverKey∈SOLVER_REGISTRY、roleType∈DATADEP_ROLE_CANONICAL；契约漂移守）→ `pnpm gates`。

---

## §6 《本体引用与影响》回写清单（落地即回写母体）

> 母体 `docs/SYSTEM-ONTOLOGY.md` 是唯一真相源·改接线改母体·再 `pnpm ontology:slices` 同步切片（门 `ontology-slices:check` 守漂移）。

- **§2.H 交互编排域**：登记 `RequirementGraph`（一等咨询性派生对象）+ `QuestionAST`（其前产物）。
- **§3 关系图 / §10.3 问句到答案链**：中枢链 `sys.orch.query_to_answer` 补「Query→classify→**（需求图旁路·观察态）**→Plan」节点；标注 L1-A 不改判决、下游投影喂 L1-B。
- **§4 数据流事件图**：注记复用 `step.*` 伪步帧（stepId=requirement-graph·零新 SSE 事件）；可选内部 `requirement_graph.built` 域事件登记。
- **§5 不变量**：无新不变量（R6/R11/R13/R14/R16 均守）；发布律 RL2/RL9/RL10 适用登记。
- **§7 门禁**：登记 `requirement-graph:check`。
- **§8 断点**：G-1 标注「需求图结构化升级（预分析散件→图契约）」。

---

## §7 验收齿（真跑·铁律 0.4·KILL-MOCK-RED）

> 一切以真实测试为原则：真起服务、真跑、真数据、真看结果；LLM mock（R6）；绝不合成/兜底冒充真值。

- **V1 · Question AST 真解析**：真起双服务（datacore `SEED_DEMO=1` + agentcore），真提问「未来30天常州基地PACK02产线停机20%，影响哪些订单？」→ 断言 AST：intent.problemClass 命中、entities 含 `常州基地→Base(exact/unique_name·带真 objectId)`+`PACK02→Line`+`订单→Order`、action=SHUTDOWN(value="20%")、time=FUTURE_WINDOW(30,DAY)。**逐值对照** DataCore 真实例（GET /a/v1/objects/Base/常州 返回的真 id）——实体 objectId **必等**后端真值（非合成）。
- **V2 · Requirement Graph 真构图**：同问句 → RG：object 节点 ontologyType 全 ∈ 已发布类型（GET /a/v1/ontology/object-types 对照）；solver 节点全 ∈ SOLVER_REGISTRY；data 节点 roleType 全 ∈ DATADEP_ROLE_CANONICAL；边经真 LinkType 图（断链止步·无幻连）。coverageScore 合理。
- **V3 · 三白名单测谎（green→red 自证）**：构造故意注入幽灵 solverKey/幽灵 ontologyType 的图 → `requirement-graph:check` **必红**；修正后绿。证「幽灵节点进不了图」。
- **V4 · R6 字节一致**：同 (query, context, classification, 本体快照版本) **双跑** → `RequirementGraph` JSON **字节一致**（generatedAt 注入固定值·LLM mock·无随机/时钟）。改一处随机源即红。
- **V5 · 喂真求解器闭环**：取 RG `solverCandidates[0]` + `dataRequirements` → 真调 `/a/v1/solvers/{key}/invoke`（SERVICE_TOKEN）→ 出**真求解器真答案**（非造假）。证「问句→AST→需求图→喂 solver」全链真通（中枢链 R11 闭包意义）。
- **V6 · 回退演练（被证明·非声称·P5）**：① 关 `QOS_REQUIREMENT_GRAPH` → 真跑同问句 → pipeline 行为与改造前**逐值一致**（answer 相同·无 RG 步帧）+ 既有 QOS 回归测全绿（agentcore 66 全绿）；② 关 `growth.requirement_graph` → `GET …/requirement-graph` **curl 404**；③ migration down→up 幂等重跑（若立新表）。
- **V7 · R2 租户隔离**：tenantB 取 tenantA 的 taskId → RG 端点 404。
- **V8 · gates 全绿**：`pnpm -r build && pnpm -r test`（datacore 69 / agentcore 66 / frontend 25+）+ `pnpm gates`（含新 `requirement-graph:check` + `ontology-slices:check`）全绿。

---

## §8 WO 拆分（3 张可派发施工单·带 acceptance·守 KILL-MOCK-RED）

> 铁则（DESIGN §7）：一期一单 → dev BUILT → 审核方真跑复验（含回退演练）→ DONE → 派下一期。严格依赖序。

### WO-L1A-1 · RequirementGraph 契约 + QuestionAST 确定性解析器
- **改**：`packages/contracts/src/requirement-graph.ts`（新·§3 全部 schema）+ index.ts 导出；`apps/agentcore/src/config.ts` 加 `QOS_REQUIREMENT_GRAPH`（暗发）；`apps/agentcore/src/growth/requirement-graph.ts` 的 **parser 段**（§4.1·复用 normalizeQuery/problemClassForIntent/slots 三阶梯实体解析·经 dataCore.ontology 客户端）。**不接线编排**（纯函数+单测）。
- **依赖**：无（可即启）。
- **acceptance**：① 契约 zod 编译过·`pnpm -r typecheck` 绿；② 单测：喂真意图+真上下文 → AST（V1 断言·实体 objectId 对照 mock 本体真值·**不造假**）；③ **R6 双跑字节一致**（V4·parser 级）；④ 无 LLM/时钟/随机（静态扫 + 单测）；⑤ 契约字段全 optional/additive（旧消费方零感知·`pnpm -r test` 现有全绿）。
- **中止/回退（P7 前置）**：契约破坏现有测 → 回退（optional 字段·不动旧 schema）。

### WO-L1A-2 · Graph Builder（node/edge/property/event 推导）+ 三白名单门
- **改**：`apps/agentcore/src/growth/requirement-graph.ts` 的 **builder 段**（§4.2 八段 Pipeline·复用 SOLVER_DATADEP/DATADEP_ROLE_CANONICAL/SOLVER_COVERAGE/expandHiddenRequirements/deriveSliceTargetCandidates/LinkType 图）；`scripts/check-requirement-graph.mjs` + 并入 `pnpm gates`。**仍不接线编排**（纯函数+单测）。
- **依赖**：WO-L1A-1 DONE。
- **acceptance**：① 单测：AST→RG（V2 断言·节点全∈注册表·边经真 LinkType 断链止步）；② **三白名单测谎 green→red**（V3·注入幽灵 key→门红·修正→绿）；③ 下游投影 solverCandidates/dataRequirements/sliceTargets 与 SOLVER_COVERAGE/SOLVER_DATADEP/deriveSliceTargetCandidates **逐值对账**；④ R6 双跑字节一致（V4·builder 级）；⑤ 隐性需求经 expandHiddenRequirements（**不新造**·复用 L0·节点∈三白名单）。
- **中止/回退**：门误红/漂移 → 修；builder 越界产幽灵 → 视为红（KILL-MOCK-RED）。

### WO-L1A-3 · 编排接线（暗发·观察态）+ 持久化 + 读端点 + 下游 I/O
- **改**：`orchestrator.ts` 加 `buildRequirementGraph`（§2.1 插入点 :673·`try/catch` 吞·emit step.completed{stepId:"requirement-graph"}）；`PreAnalysisReport` 扩 `requirementGraph` optional（databuilder.ts:531）+ repo 搭车（repos.ts:310·若立新表则 R9 四处同改）；`GET /b/v1/queries/:taskId/requirement-graph`（entitlement `growth.requirement_graph` 门·**双注册** agentcore registry.ts + datacore features.ts·defaultOn:false）。
- **依赖**：WO-L1A-2 DONE + L0（pre-analysis/hidden-req）运行绿。
- **acceptance（真跑·铁律 0.4）**：① **真起双服务真浏览器/真 curl**：真问句 → 落 RG（V1/V2 真值对照）→ 取 solverCandidates **真调求解器出真答案**（V5 闭环）；② **回退演练（V6·被证明）**：关 `QOS_REQUIREMENT_GRAPH`→pipeline 逐值同改造前+QOS 回归全绿；关 `growth.requirement_graph`→端点 curl 404；③ R2 跨租户 404（V7）；④ 观察态零回归——RG 开关**不改 answer**（同问句 answer 字节一致·证 NG6 additive）；⑤ `pnpm -r test` + `pnpm gates` 全绿（V8）；⑥ 母体回写（§6）+ `pnpm ontology:slices`。
- **中止/回退（P7）**：RG 构图影响了 answer/路由（NG6 违例）→ 立即关 `QOS_REQUIREMENT_GRAPH` 回退；首包延迟回归 → 关闸。

---

## §9 分期 / 回退纪律（沿 DESIGN-refit 七原则·收编）

- **排程（严格依赖序·DESIGN §7）**：`L0 全绿 → L1-A（WO-1→WO-2→WO-3·本 PRD）→ L1-W Workflow DAG → L1-B Execution Planner（影子→翻闸·消费本 PRD 的 RG 下游投影）→ L1-C`。L1-A 是脊柱首件（DESIGN §4）。
- **七原则逐条兑现**：P1 暗发（双闸·§2.4）· P2 只加不改（契约全 optional·旧路径永不删·migration 带 down）· P3 旁路优先权威不换手（classify/proceedWithIntent 判决地位不变）· P4 影子先行（L1-A 为观察态·真正翻闸在 L1-B planner·先例 a14-parity.test）· P5 回退演练入齿（每 WO acceptance 含真跑回退·V6）· P6 单期单单复验绿再下期· P7 失败判据前置（每 WO 写死中止/回退）。
- **总不变式**：关掉 `QOS_REQUIREMENT_GRAPH` + `growth.requirement_graph` = 改造前系统 + 休眠代码 + 空表（回退演练真跑证明）。RG/AST 均**咨询性派生**·可 drop 重生·业务真值表零动（DESIGN §6）。
- **失败判据（中止即回退）**：R6 双跑不一致 / 图含三白名单外 key / RG 开关改变 answer 或路由（NG6 违例）/ 首包延迟回归 / QOS 回归测红 —— 任一命中 → 关闸完整回退。

---

## §10 诚实边界（铁律 0.4）

- RG docx（`/tmp/rge.txt`）是**设计规格（散文+伪流程）非代码**——Property Graph→现 ObjectType、DSL→现 SOLVER_DATADEP/规则、Solver Matching→现 SOLVER_COVERAGE 的**桥接施工**已在本 PRD 逐一手写落到 file:line，但仍需 dev 逐单实现+审核方真跑复验，不能直接落地。
- docx Ch03 Requirement DSL 的**独立 YAML DSL + Compiler**在 L1-A **降级为**：不引入新 DSL 语言，直接以 `RequirementGraph` 契约为 IR（现系统已有 A5 规则 DSL / SOLVER_DATADEP 声明式清单承担 DSL 职责·避免双轨·守 RL10 不分叉）。若后续确需人可编辑 DSL 层 → 另立单（本 PRD 不含）。
- docx 的 Embedding 实体识别 / NER / GNN 学习均**未采纳进热路径**（守 R6 确定性 + NG5）——实体解析走现成确定性三阶梯（exact/unique-name/fuzzy-澄清）。
- `coverageScore` 是**咨询进度信号非判决**（对齐 §10 PreAnalysis 边界·永不误红）；权威可行性判决仍归 reactive classifyGap / L0-SOLVER-COVERAGE。
- 命名禁用外部产品名（用平台自有术语：需求图/求解器/切片/意图·非某参考产品名）。
