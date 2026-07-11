import { z } from "zod";
import { IsoTime } from "./common.js";

// ═══════════════════════════════════════════════════════════════════════════
// L1-A · RequirementGraph Engine 契约（PRD-L1A-requirement-graph-engine.md §3）
// ───────────────────────────────────────────────────────────────────────────
// 设计律：
//   R6  确定性——generatedAt 由调用方注入（内部不取时钟）；解析器无随机/LLM。
//   R13 溯源——每节点带 source/refKey；实体带 source 诚实位（exact/unique_name/fuzzy/unresolved）。
//   R14 零业务常数——roleType/ontologyType 是本体键（非「常州」/「NCM4680」字面量）。
//   RL9 additive 可回退——全部字段显式声明；契约进 @platform/contracts（R1 跨包共享）。
// 咨询性派生对象：RequirementGraph 可 drop 重生·非业务真值（不覆盖 classify/proceedWithIntent 判决）。
// ═══════════════════════════════════════════════════════════════════════════

// ── Question AST（Ch02·「用户说了什么」）─────────────────────────────────────
export const AstIntentSchema = z.object({
  /** 一级分析原型（= problemClass·solver-coverage 键，如 forward_projection/bottleneck_detection）。 */
  problemClass: z.string(),
  /** classify 首候选意图键（若命中目录）。 */
  intentKey: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type AstIntent = z.infer<typeof AstIntentSchema>;

/** 实体解析来源（R13·诚实位）：exact=id/PK 命中；unique_name=跨类型唯一名；fuzzy=近邻（仅澄清·不自动绑）；unresolved=域外。 */
export const AstEntitySourceSchema = z.enum(["exact", "unique_name", "fuzzy", "unresolved"]);
export type AstEntitySource = z.infer<typeof AstEntitySourceSchema>;

export const AstEntitySchema = z.object({
  text: z.string(), // 原文片段（如 "常州基地"）
  ontologyType: z.string().nullable(), // 解析到的已发布 ObjectType key（Base/Line/Order/Model…）
  objectId: z.string().nullable(), // 解析到的真实实例 id（obj_…）；类型级提及为 null
  resolved: z.boolean(),
  source: AstEntitySourceSchema,
  confidence: z.number().min(0).max(1),
});
export type AstEntity = z.infer<typeof AstEntitySchema>;

export const AstActionTypeSchema = z.enum([
  "SHUTDOWN",
  "DELAY",
  "INCREASE",
  "DECREASE",
  "TRANSFER",
  "REPLACE",
  "ALLOCATE",
  "OTHER",
]);
export type AstActionType = z.infer<typeof AstActionTypeSchema>;

export const AstActionSchema = z.object({
  type: AstActionTypeSchema,
  targetType: z.string().nullable(), // 作用对象本体类型（如 Line）
  value: z.string().nullable(), // 幅度/量（如 "20%"·保留原文·不臆造数值）
});
export type AstAction = z.infer<typeof AstActionSchema>;

export const AstConstraintKindSchema = z.enum(["HARD", "SOFT", "OBJECTIVE"]);
export const AstConstraintOperatorSchema = z.enum(["LE", "GE", "EQ", "LT", "GT", "NONE"]);
export const AstConstraintDirectionSchema = z.enum(["MAX", "MIN", "NONE"]);
export const AstConstraintSchema = z.object({
  kind: AstConstraintKindSchema,
  metric: z.string().nullable(), // 如 DeliveryRate/Cost
  operator: AstConstraintOperatorSchema.default("NONE"),
  value: z.string().nullable(),
  direction: AstConstraintDirectionSchema.default("NONE"),
});
export type AstConstraint = z.infer<typeof AstConstraintSchema>;

export const AstTimeKindSchema = z.enum(["ABSOLUTE", "FUTURE_WINDOW", "PERIOD", "DEADLINE"]);
export const AstTimeGranularitySchema = z.enum(["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"]);
export type AstTimeGranularity = z.infer<typeof AstTimeGranularitySchema>;
export const AstTimeSchema = z.object({
  kind: AstTimeKindSchema,
  from: z.string().nullable(),
  to: z.string().nullable(),
  window: z.number().int().nullable(), // 如 30（配 granularity）
  granularity: AstTimeGranularitySchema.nullable(),
});
export type AstTime = z.infer<typeof AstTimeSchema>;

export const QuestionAstSchema = z.object({
  astId: z.string(), // ast_
  taskId: z.string(),
  tenantId: z.string(),
  rawText: z.string(),
  intent: AstIntentSchema,
  entities: z.array(AstEntitySchema),
  actions: z.array(AstActionSchema),
  constraints: z.array(AstConstraintSchema),
  timeScope: AstTimeSchema.nullable(),
  objectives: z.array(z.string()), // 目标叙述（如 "MIN:成本"）
  outputs: z.array(z.string()), // 期望产出（如 "订单"/"备选方案"）
  parserVersion: z.string(), // 解析器版本（R6 可重放钉版）
  generatedAt: IsoTime, // 调用方注入（内部不取时钟·R6）
});
export type QuestionAst = z.infer<typeof QuestionAstSchema>;

// ── Requirement Graph IR（Ch01/04·「需要什么」）─────────────────────────────
/** 节点类型（折叠 Ch01.7 12 类到映射真系统的集合）。 */
export const RequirementNodeKindSchema = z.enum([
  "question",
  "goal",
  "object",
  "metric",
  "constraint",
  "data",
  "model",
  "solver",
  "action",
  "event",
  "time",
]);
export type RequirementNodeKind = z.infer<typeof RequirementNodeKindSchema>;

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
export type RequirementNode = z.infer<typeof RequirementNodeSchema>;

/** 边关系（Ch01.9：Ontology/Causal/Dependency/Requirement/Execution 五类关系折叠）。 */
export const RequirementEdgeKindSchema = z.enum([
  "requires",
  "depends_on",
  "causes",
  "optimizes",
  "has",
  "produces",
  "fulfills",
  "affects",
]);
export type RequirementEdgeKind = z.infer<typeof RequirementEdgeKindSchema>;

export const RequirementEdgeSchema = z.object({
  edgeId: z.string(),
  from: z.string(), // nodeId
  to: z.string(), // nodeId
  kind: RequirementEdgeKindSchema,
  weight: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(), // R13：为何连（"停机→产能下降"）
});
export type RequirementEdge = z.infer<typeof RequirementEdgeSchema>;

export const RequirementDataReqSchema = z.object({
  roleType: z.string(),
  minRows: z.number().int(),
});
export type RequirementDataReq = z.infer<typeof RequirementDataReqSchema>;

export const RequirementSliceTargetsSchema = z.object({
  rootType: z.string(),
  targets: z.array(z.string()),
});
export type RequirementSliceTargets = z.infer<typeof RequirementSliceTargetsSchema>;

export const RequirementGraphSchema = z.object({
  graphId: z.string(), // rg_
  taskId: z.string(),
  tenantId: z.string(),
  questionAst: QuestionAstSchema,
  nodes: z.array(RequirementNodeSchema),
  edges: z.array(RequirementEdgeSchema),
  problemClass: z.string(),
  // ── 下游 I/O 投影（Ch01.7-1.8·纯派生·L1-B/slice/solver 消费口）──
  solverCandidates: z.array(z.string()), // ∈ SOLVER_REGISTRY（SOLVER_COVERAGE 派生）
  dataRequirements: z.array(RequirementDataReqSchema), // SOLVER_DATADEP 并集
  sliceTargets: RequirementSliceTargetsSchema.nullable(),
  /** 结构层覆盖信号（咨询·非判决·永不误红·对齐 PreAnalysis 边界）：节点∈注册表比例。 */
  coverageScore: z.number().min(0).max(1),
  builderVersion: z.string(),
  generatedAt: IsoTime,
});
export type RequirementGraph = z.infer<typeof RequirementGraphSchema>;
