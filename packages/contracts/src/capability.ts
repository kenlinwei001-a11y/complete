import { z } from "zod";
import { JsonSchemaObject } from "./common.js";
import { RefSchema } from "./refs.js";

// ---------------------------------------------------------------------------
// WO-CAP-0 · 统一能力元数据信封 CapabilityMeta
// Skill / SolverDraft / ModelArtifact 的共享字段，避免三处各写一套注册表。
// ---------------------------------------------------------------------------

export const CapabilityKindSchema = z.enum(["SKILL", "SOLVER_DRAFT", "MODEL_ARTIFACT"]);
export type CapabilityKind = z.infer<typeof CapabilityKindSchema>;

export const CapabilitySideEffectSchema = z.enum(["NONE", "READ_ONLY", "WRITE_BACK", "EXTERNAL_ACTION"]);
export type CapabilitySideEffect = z.infer<typeof CapabilitySideEffectSchema>;

export const CapabilityTrustLevelSchema = z.enum([
  "UNVERIFIED",
  "ADVISORY_PASSED",
  "VERIFIED",
  "CALIBRATED",
]);
export type CapabilityTrustLevel = z.infer<typeof CapabilityTrustLevelSchema>;

export const CapabilityMetaSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  /** 稳定 key，注册目录/版本钉用 */
  key: z.string(),
  version: z.number().int().default(1),
  /** 能力种类：Skill / SolverDraft / ModelArtifact */
  capability: CapabilityKindSchema,
  name: z.string(),
  /** 一句话摘要（LLM 选用/目录展示） */
  summary: z.string().max(400).optional(),
  /** 人读详细说明 */
  description: z.string().optional(),
  /** 副作用等级：默认只读 */
  sideEffect: CapabilitySideEffectSchema.default("READ_ONLY"),
  /** 输入 JSON Schema */
  inputSchema: JsonSchemaObject.optional(),
  /** 输出 JSON Schema */
  outputSchema: JsonSchemaObject.optional(),
  /** 出向引用（规则/技能/工作流/计划/Agent/MCP/意图） */
  references: z.array(RefSchema).default([]),
  /** 溯源与治理策略 */
  provenancePolicy: z
    .object({
      trustLevel: CapabilityTrustLevelSchema.default("UNVERIFIED"),
      sourceLabel: z.string().default(""),
      requiresAdvisory: z.boolean().default(false),
    })
    .default({ trustLevel: "UNVERIFIED", sourceLabel: "", requiresAdvisory: false }),
  /** 生命周期状态——具体允许值由 capability 决定 */
  status: z.string(),
  /** 内容指纹（R6 可校验未篡改） */
  hash: z.string().optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export type CapabilityMeta = z.infer<typeof CapabilityMetaSchema>;

// ---------------------------------------------------------------------------
// Skill：复用 CapabilityMeta，保持向后兼容
// ---------------------------------------------------------------------------

export const SkillLifecycleStatusSchema = z.enum(["DRAFT", "PUBLISHED", "RETIRED"]);
export type SkillLifecycleStatus = z.infer<typeof SkillLifecycleStatusSchema>;

export const SkillAttachmentSchema = z.object({
  name: z.string(),
  blobKey: z.string(),
  mime: z.string().optional(),
  description: z.string().optional(),
});
export type SkillAttachment = z.infer<typeof SkillAttachmentSchema>;

// ---------------------------------------------------------------------------
// SolverDraft：Deep Agent 的临时求解器草稿
// ---------------------------------------------------------------------------

export const SolverDraftStatusSchema = z.enum([
  "GENERATED",
  "LINT_PASS",
  "EVAL_PASS",
  "ADVISORY_REVIEW",
  "GOVERNED",
  "PUBLISHED",
  "RETIRED",
]);
export type SolverDraftStatus = z.infer<typeof SolverDraftStatusSchema>;

export const SolverDraftSchema = CapabilityMetaSchema.omit({ status: true, capability: true }).extend({
  id: z.string(), // sdraft_
  capability: z.literal("SOLVER_DRAFT"),
  title: z.string().optional(),
  /** 生成目标（自然语言） */
  goal: z.string(),
  /** 沙箱执行的纯函数源码 */
  computeSource: z.string(),
  /** 评测用例 */
  testCases: z.array(z.record(z.string(), z.unknown())).default([]),
  status: SolverDraftStatusSchema,
  /** 草稿必须带 hash */
  hash: z.string(),
  /** 来源 AgentJob / Goal */
  promotedFrom: z.string().optional(),
});
export type SolverDraft = z.infer<typeof SolverDraftSchema>;

export const DraftRunOutcomeSchema = z.enum(["OK", "ERROR", "TIMEOUT", "MEMORY_EXCEEDED", "LINT_FAILED"]);
export type DraftRunOutcome = z.infer<typeof DraftRunOutcomeSchema>;

export const DraftRunSchema = z.object({
  id: z.string(), // drun_
  draftId: z.string(),
  tenantId: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()).nullable(),
  outcome: DraftRunOutcomeSchema,
  logs: z.array(z.string()).default([]),
  durationMs: z.number().int(),
  createdAt: z.string(),
});
export type DraftRun = z.infer<typeof DraftRunSchema>;

// ---------------------------------------------------------------------------
// ModelArtifact：LLM/平台生成的轻量模型/评分卡/规则补丁
// ---------------------------------------------------------------------------

export const ModelArtifactKindSchema = z.enum([
  "SCORECARD",
  "CLASSIFIER",
  "FORECAST_PATCH",
  "RULE_PATCH",
]);
export type ModelArtifactKind = z.infer<typeof ModelArtifactKindSchema>;

export const ModelArtifactStatusSchema = z.enum([
  "GENERATED",
  "EVALUATING",
  "GOVERNED",
  "PUBLISHED",
  "RETIRED",
]);
export type ModelArtifactStatus = z.infer<typeof ModelArtifactStatusSchema>;

export const ModelArtifactSchema = CapabilityMetaSchema.omit({ status: true, capability: true }).extend({
  id: z.string(), // mart_
  capability: z.literal("MODEL_ARTIFACT"),
  kind: ModelArtifactKindSchema,
  /** 生成来源：draft / AutoML / human */
  source: z.string(),
  status: ModelArtifactStatusSchema,
  /** 模型制品必须带 hash */
  hash: z.string(),
});
export type ModelArtifact = z.infer<typeof ModelArtifactSchema>;
