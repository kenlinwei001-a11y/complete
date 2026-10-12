import { z } from "zod";
import { RESOURCE_KINDS } from "./resource-descriptor.js";

/**
 * WO-DRIL-P1 · Decision Resource Intelligence Layer 契约地基（PRD-decision-resource-intelligence-layer §5）。
 *
 * 把 `ResourceDescriptor`（扁平描述）升级为 `IntelligenceResource`（10 类·带业务语义/输入输出规格/
 * 五级标签/质量分/关系/治理），并给出 per-kind 扩展。**派生投影（R13）**：注册表非新真值源，各 kind
 * 元数据投影自各自模块（solver/slice/rule←DataCore·workflow/intent/skill/agent←AgentCore·mcp_tool←MCP）。
 *
 * - R1 契约在 `@platform/contracts`（B 经 REST 读 A·不 import A 源）。
 * - R14 零业务常数：L4 对象标签由已发布 OntologyType 派生（本契约不内联任何业务对象名字面量）。
 * - R6 确定性：质量分公式（computeQualityScore）与 EWMA 更新（ewmaUpdate）为纯函数。
 *
 * 兼容性：基类字段 kind/key/label/description/answersQuestions/tags/argHints/domain/featureKey 与
 * `ResourceDescriptorSchema` 一一对应——任一 ResourceDescriptor 均可无损升格为 IntelligenceResource。
 */

/**
 * 扩展资源类别：发现池（solver/slice/workflow/intent/field/mcp_tool/**object_type**）之上新增 agent/skill/rule → 10 类。
 * WO-RESOURCE-CATALOG-ONTOLOGY：`object_type`（本体对象类型）经 `RESOURCE_KINDS` 并入；`field` 由"已声明未接线"转为已接线
 * （投影自本体真值源 `GET /a/v1/ontology/object-types` / `type-semantics`，非手写清单）。
 */
export const RESOURCE_KINDS_EXTENDED = [...RESOURCE_KINDS, "agent", "skill", "rule"] as const;
export type ResourceKindExtended = (typeof RESOURCE_KINDS_EXTENDED)[number];
export const ResourceKindExtendedSchema = z.enum(RESOURCE_KINDS_EXTENDED);

/** 五级标签体系（§5.2）：L1 业务域 / L2 决策类型 / L3 业务场景 / L4 对象（从本体派生）/ L5 算法。 */
export const TieredTagsSchema = z.object({
  l1_domain: z.array(z.string()).default([]),
  l2_decisionType: z.array(z.string()).default([]),
  l3_scenario: z.array(z.string()).default([]),
  l4_object: z.array(z.string()).default([]),
  l5_algorithm: z.array(z.string()).default([]),
});
export type TieredTags = z.infer<typeof TieredTagsSchema>;

/** 输入/输出规格（§5.3）：读写的本体对象类型/链路/属性口径 + 输出顶层字段。 */
export const ResourceInputOutputSchema = z.object({
  objectTypes: z.array(z.string()).optional(),
  linkKeys: z.array(z.string()).optional(),
  requiredProps: z.record(z.string(), z.string()).optional(),
  shape: z.array(z.string()).optional(),
  example: z.unknown().optional(),
});
export type ResourceInputOutput = z.infer<typeof ResourceInputOutputSchema>;

/** Resource Quality Score（§5.4）：运行时探针自动更新，用于路由排序。 */
export const ResourceQualitySchema = z.object({
  accuracy: z.number().min(0).max(1).optional(),
  successRate: z.number().min(0).max(1).optional(),
  usageCount: z.number().int().min(0).optional(),
  avgLatencyMs: z.number().int().min(0).optional(),
  lastUpdated: z.string().optional(),
  owner: z.string().optional(),
  approval: z.enum(["DRAFT", "REVIEWED", "APPROVED"]).optional(),
  trustLevel: z.enum(["EXPERIMENTAL", "PRODUCTION", "GOVERNED"]).optional(),
});
export type ResourceQuality = z.infer<typeof ResourceQualitySchema>;

/** 资源关系（§6.2 resource_relations）：reads/scopes/invokes/binds/includes/references/dependsOn。
 *  WO-SKILL-REFGRAPH-WIRE：补 references/dependsOn —— Skill 工业级引用（`skill.references/dependsOn`）
 *  经 `extractRelations` 派生落 resource_relations（此前枚举缺这两个值，接线后 resource.relations 回填
 *  会被契约校验判非法）。additive 扩枚举，不改既有五个值的语义。 */
export const RESOURCE_RELATION_TYPES = ["reads", "scopes", "invokes", "binds", "includes", "references", "dependsOn"] as const;
export type ResourceRelationType = (typeof RESOURCE_RELATION_TYPES)[number];
export const ResourceRelationSchema = z.object({
  relType: z.enum(RESOURCE_RELATION_TYPES),
  toKind: ResourceKindExtendedSchema,
  toKey: z.string().min(1),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type ResourceRelation = z.infer<typeof ResourceRelationSchema>;

/** 运行时特征（成本/时延/是否需 sidecar 等，供 cost 打分）。 */
export const ResourceRuntimeSchema = z.object({
  isDeterministic: z.boolean().optional(),
  requiresSidecar: z.boolean().optional(),
  avgLatencyMs: z.number().int().min(0).optional(),
  costHint: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
});
export type ResourceRuntime = z.infer<typeof ResourceRuntimeSchema>;

/** 治理元数据（发布状态/责任人/版本），派生自各模块的 status/version/owner。 */
export const ResourceGovernanceSchema = z.object({
  status: z.string().optional(),
  version: z.number().int().optional(),
  owner: z.string().optional(),
});
export type ResourceGovernance = z.infer<typeof ResourceGovernanceSchema>;

/**
 * 基类字段（§5.1）。以对象字面量形式定义，供通用 schema 与 per-kind 扩展共享（避免重复声明）。
 * per-kind schema 用 `.extend({ kind: z.literal(...) , ...extra })` 覆写 kind 并加专属字段。
 */
const intelligenceResourceBaseShape = {
  kind: ResourceKindExtendedSchema,
  key: z.string().min(1),
  label: z.string().min(1),
  /** LLM 可读描述——**非空是发布/投影硬门**（dril-registry:check 无空描述资源）。 */
  description: z.string().min(1),
  /**
   * WO-RESOURCE-CATALOG-ONTOLOGY §4 兜底标记：description 系 `非空(description, displayName, key)` 合成
   * （真值源缺描述）时置 true——只拼已有 key/displayName，不编业务含义；真描述存在时缺省。
   */
  descriptionSynthesized: z.boolean().optional(),
  answersQuestions: z.array(z.string()).optional(),
  /** 适合的问句（正向）。 */
  suitableQuestions: z.array(z.string()).optional(),
  /** 不适合的问句（负向·防误选）。 */
  notSuitableQuestions: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  argHints: z.record(z.string(), z.string()).optional(),
  domain: z.string().optional(),
  featureKey: z.string().optional(),
  tieredTags: TieredTagsSchema.optional(),
  /** 一句话能力（给 LLM 选型）。 */
  capability: z.string().optional(),
  inputSpec: ResourceInputOutputSchema.optional(),
  outputSpec: ResourceInputOutputSchema.optional(),
  quality: ResourceQualitySchema.optional(),
  relations: z.array(ResourceRelationSchema).optional(),
  runtime: ResourceRuntimeSchema.optional(),
  governance: ResourceGovernanceSchema.optional(),
} as const;

/** 通用基类 schema（kind 为 9 类枚举）——用于泛型持久化/读取。 */
export const IntelligenceResourceSchema = z.object(intelligenceResourceBaseShape);
export type IntelligenceResourceBase = z.infer<typeof IntelligenceResourceSchema>;

// --- per-kind 扩展（§5.5）：discriminated union 成员，validate 时保留 per-kind 字段（非 strip）。 ---

export const SolverResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("solver"),
  algorithm: z.string().optional(),
  complexity: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  constraintSupport: z.array(z.string()).optional(),
  applicableScenarios: z.array(z.string()).optional(),
  isDeterministic: z.boolean().default(true),
  requiresSidecar: z.boolean().default(false),
});
export type SolverResource = z.infer<typeof SolverResourceSchema>;

export const SliceResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("slice"),
  rootType: z.string().default(""),
  includedTypes: z.array(z.string()).default([]),
  includedLinkKeys: z.array(z.string()).default([]),
  requiredAttributes: z.array(z.string()).optional(),
  associatedRules: z.array(z.string()).optional(),
  associatedSolvers: z.array(z.string()).optional(),
  scenario: z.string().optional(),
});
export type SliceResource = z.infer<typeof SliceResourceSchema>;

export const RuleResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("rule"),
  scopeObjectTypes: z.array(z.string()).default([]),
  severity: z.enum(["BLOCK", "WARN", "ADVISORY", "INFO"]).optional(),
  expressionSummary: z.string().optional(),
  boundSolvers: z.array(z.string()).optional(),
});
export type RuleResource = z.infer<typeof RuleResourceSchema>;

export const SkillResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("skill"),
  boundAgents: z.array(z.string()).optional(),
  attachments: z.array(z.string()).optional(),
  triggerPatterns: z.array(z.string()).optional(),
});
export type SkillResource = z.infer<typeof SkillResourceSchema>;

export const WorkflowResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("workflow"),
  steps: z.array(z.object({ kind: z.string(), ref: z.string().optional() })).optional(),
});
export type WorkflowResource = z.infer<typeof WorkflowResourceSchema>;

export const AgentResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("agent"),
  scopeObjectTypes: z.array(z.string()).optional(),
  toolNames: z.array(z.string()).optional(),
  role: z.string().optional(),
  boundSkills: z.array(z.string()).optional(),
});
export type AgentResource = z.infer<typeof AgentResourceSchema>;

export const McpResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("mcp_tool"),
  serverName: z.string().optional(),
  toolName: z.string().optional(),
  transportKind: z.string().optional(),
});
export type McpResource = z.infer<typeof McpResourceSchema>;

export const IntentResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("intent"),
  boundPlanRef: z.string().optional(),
  boundScenarios: z.array(z.string()).optional(),
  exampleQueries: z.array(z.string()).optional(),
  riskLevel: z.string().optional(),
});
export type IntentResource = z.infer<typeof IntentResourceSchema>;

export const FieldResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("field"),
  objectType: z.string().optional(),
  propKey: z.string().optional(),
  /** WO-RESOURCE-CATALOG-ONTOLOGY T2：量纲透出（PropertyDef.unit）——Agent 才知道字段单位。 */
  unit: z.string().optional(),
  dataType: z.string().optional(),
});
export type FieldResource = z.infer<typeof FieldResourceSchema>;

/**
 * WO-RESOURCE-CATALOG-ONTOLOGY T1 · 本体对象类型资源（Agent 搜得到"系统里有什么业务对象"）。
 * `properties`/`linkKeys` 为 per-kind 扩展（沿用既有 IntelligenceResource 结构，不另造形状）：
 * properties 镜像 PropertyDef 只读子集（propKey/description/unit/dataType），供 field 投影与详情查看。
 */
export const ObjectTypeResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("object_type"),
  properties: z
    .array(
      z.object({
        propKey: z.string(),
        description: z.string().optional(),
        unit: z.string().optional(),
        dataType: z.string().optional(),
      }),
    )
    .optional(),
  linkKeys: z.array(z.string()).optional(),
});
export type ObjectTypeResource = z.infer<typeof ObjectTypeResourceSchema>;

/** 全 10 kind discriminated union——投影校验目标（保留 per-kind 字段）。 */
export const AnyIntelligenceResourceSchema = z.discriminatedUnion("kind", [
  SolverResourceSchema,
  SliceResourceSchema,
  RuleResourceSchema,
  SkillResourceSchema,
  WorkflowResourceSchema,
  AgentResourceSchema,
  McpResourceSchema,
  IntentResourceSchema,
  FieldResourceSchema,
  ObjectTypeResourceSchema,
]);
export type IntelligenceResource = z.infer<typeof AnyIntelligenceResourceSchema>;

// --- WO-DRIL-P2 · 混合检索请求/响应契约（§6.4·R1 契约在 @platform/contracts）。 ---

/** 信任级序（minTrustLevel 硬过滤用；序越高越可信）。 */
export const TRUST_LEVEL_ORDER = { EXPERIMENTAL: 0, PRODUCTION: 1, GOVERNED: 2 } as const;

/**
 * `POST /b/v1/resources/search` 请求体（§6.4）。query 自然语言；requiredTags 硬过滤（Partial 五级标签）；
 * excludeKeys 排除；minTrustLevel 信任下限；kinds 限类；maxResults/minScore 截断门槛。
 */
export const ResourceSearchRequestSchema = z.object({
  query: z.string().default(""),
  context: z.record(z.string(), z.unknown()).optional(),
  kinds: z.array(ResourceKindExtendedSchema).optional(),
  requiredTags: TieredTagsSchema.partial().optional(),
  excludeKeys: z.array(z.string()).optional(),
  includeRelations: z.boolean().optional(),
  maxResults: z.number().int().positive().max(100).default(20),
  minScore: z.number().min(0).max(1).default(0.3),
  minTrustLevel: z.enum(["EXPERIMENTAL", "PRODUCTION", "GOVERNED"]).optional(),
});
export type ResourceSearchRequest = z.infer<typeof ResourceSearchRequestSchema>;

/** 分项得分（§4 设计原则⑤可解释性·§7.2）：五项加权来源逐项回报。 */
export const ScoreBreakdownSchema = z.object({
  semantic: z.number(),
  domain: z.number(),
  ontology: z.number(),
  history: z.number(),
  cost: z.number(),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

/** 单条检索结果（§6.4 响应 results[] 元素）。 */
export interface ResourceSearchResultItem {
  resource: IntelligenceResource;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  related?: IntelligenceResource[];
  explanation: string;
}

/** `POST /b/v1/resources/search` 响应（§6.4）。 */
export interface ResourceSearchResponse {
  results: ResourceSearchResultItem[];
  explanation: string;
}

/**
 * 混合检索排序权重（§7.1 顶层加权·R6 常量）。Score = Σ weight[k]·subScore[k]。
 * **精确对齐 PRD §7.1**：不得私改（审核头号判据之一）。
 */
export const DRIL_RANK_WEIGHTS = {
  semantic: 0.35,
  domain: 0.25,
  ontology: 0.2,
  history: 0.1,
  cost: 0.1,
} as const;

/** 业务域匹配的层级权重（§7.2 domain = Σ layerWeight[l]·hitRatio[l]）。 */
export const DRIL_DOMAIN_LAYER_WEIGHTS = {
  l1_domain: 0.3,
  l2_decisionType: 0.25,
  l3_scenario: 0.2,
  l4_object: 0.15,
  l5_algorithm: 0.1,
} as const;

/** 投影校验失败信息（结构同 resource-descriptor DescriptorViolation）。 */
export interface ResourceViolation {
  index: number;
  kind?: string;
  key?: string;
  reason: string;
}

/**
 * dril-registry:check 核心校验（纯函数·R6）：对一组投影候选逐条跑 AnyIntelligenceResourceSchema。
 * 任一条不合法（尤以 description 空）→ 记一条 violation。空数组 = 全池达标（门绿）。
 */
export function findInvalidResources(candidates: unknown[]): ResourceViolation[] {
  const out: ResourceViolation[] = [];
  candidates.forEach((c, index) => {
    const parsed = AnyIntelligenceResourceSchema.safeParse(c);
    if (!parsed.success) {
      const rec = (c ?? {}) as Record<string, unknown>;
      const reason = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      out.push({
        index,
        ...(typeof rec.kind === "string" ? { kind: rec.kind } : {}),
        ...(typeof rec.key === "string" ? { key: rec.key } : {}),
        reason,
      });
    }
  });
  return out;
}

/**
 * Resource Quality Score 复合公式（§5.4·纯函数·R6）：同输入同输出。
 * Q = 0.30·successRate + 0.25·accuracy + 0.20·exp(-lat/60000) + 0.15·log10(usage+1)/5(封顶1) + 0.10·approvalWeight。
 */
export function computeQualityScore(q: ResourceQuality): number {
  const successRate = q.successRate ?? 0;
  const accuracy = q.accuracy ?? 0;
  const lat = q.avgLatencyMs ?? 0;
  const usage = q.usageCount ?? 0;
  const approvalWeight = q.approval === "APPROVED" ? 1.0 : q.approval === "REVIEWED" ? 0.8 : 0.5;
  const usageTerm = Math.min(1, Math.log10(usage + 1) / 5);
  return (
    0.3 * successRate +
    0.25 * accuracy +
    0.2 * Math.exp(-lat / 60000) +
    0.15 * usageTerm +
    0.1 * approvalWeight
  );
}

/** 运行时质量分确定性 EWMA 更新（§5.4·纯函数·R6·alpha 默认 0.1）。 */
export function ewmaUpdate(
  prev: { successRate?: number; usageCount?: number; avgLatencyMs?: number },
  observed: { success: boolean; latencyMs: number },
  alpha = 0.1,
): { successRate: number; usageCount: number; avgLatencyMs: number } {
  const prevSuccess = prev.successRate ?? (observed.success ? 1 : 0);
  const prevLatency = prev.avgLatencyMs ?? observed.latencyMs;
  return {
    successRate: alpha * (observed.success ? 1 : 0) + (1 - alpha) * prevSuccess,
    usageCount: (prev.usageCount ?? 0) + 1,
    avgLatencyMs: alpha * observed.latencyMs + (1 - alpha) * prevLatency,
  };
}

/**
 * WO-DRIL-P3 · graphDistance 子分（§7.2 ontology 第二项·纯函数·R6）。
 * 焦点类型到 resource 可达类型的**最近跳数** → `1/(1+minHops)`，多类型取最大。焦点类型自身 hops=0 → 1.0；
 * 无图/无可达 → 0（fail-open 中性·不崩）。`hopsFromFocus` 由 DataCore `planSlice` BFS 最短路派生（复用非重写）。
 */
export function graphDistanceScore(
  hopsFromFocus: Map<string, number> | undefined,
  resourceTypes: string[],
): number {
  if (!hopsFromFocus || hopsFromFocus.size === 0) return 0;
  let best = 0;
  for (const t of resourceTypes) {
    const h = hopsFromFocus.get(t);
    if (h === undefined) continue;
    best = Math.max(best, 1 / (1 + h));
  }
  return best;
}

/**
 * WO-DRIL-P3 · relationStrength 子分（§7.2 ontology 第三项·纯函数·R6）。
 * resource 的关系里指向「已选中资源」（`${toKind}|${toKey}` ∈ selectedKeys）的占比；
 * 无关系 / 无选中 → 0（普通检索无"已选中"时该项中性，仅在 buildResourcePackage 组包时生效）。
 */
export function relationStrengthScore(
  relations: { toKind: string; toKey: string }[] | undefined,
  selectedKeys: Set<string> | undefined,
): number {
  if (!relations || relations.length === 0 || !selectedKeys || selectedKeys.size === 0) return 0;
  let hit = 0;
  for (const rel of relations) if (selectedKeys.has(`${rel.toKind}|${rel.toKey}`)) hit++;
  return hit / relations.length;
}
