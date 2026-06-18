import { z } from "zod";
import { IsoTime } from "./common.js";
import {
  BuildPlanSchema,
  ClosureReportSchema,
  PlanIntentNeedSchema,
  PlanPlanNeedSchema,
  PlanWorkflowNeedSchema,
  PlanSkillNeedSchema,
  PlanAgentNeedSchema,
  PlanMcpNeedSchema,
  PlanSceneNeedSchema,
} from "./databuilder.js";
import { GapReportSchema } from "./growth.js";

/**
 * 故事驱动全栈倒推与跨系统闭包（PRD-fullstack-story-build-g8，v0.2）· P1 契约。
 *
 * 与自成长发动机（demand-pulled）归一为同一发动机的两个燃料口：
 *   - 母体 GrowthLedgerEntry = 运行期/问句驱动的历史记录；
 *   - StoryBuildRun         = 构建期/故事驱动的历史记录；
 * 二者经 runId 关联，前端合并为单一"历史推演记录"时间线（g8 §9 归一三点）。
 *
 * P1 仅落 StoryBuildRun 持久 + 历史时间线；InputManifest（P2）/ B 栈 scaffold（P3）
 * 的字段在此先以 forward-compatible 形态声明（可选），落地分期对齐 g8 §8。
 */

// ---- InputManifest（倒推页面录入项 · g8 §3.2，P2 渲染补录表单）---------------

export const InputFieldSourceSchema = z.enum(["STORY", "ASK_USER", "REUSE_EXISTING"]);
export type InputFieldSource = z.infer<typeof InputFieldSourceSchema>;

export const InputFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  dataType: z.enum(["string", "number", "boolean", "date", "enum"]),
  required: z.boolean().default(false),
  /** 缺省值（发动机据行业模板推断；ASK_USER 项可留空待补）。 */
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  /** STORY=脚本已给 / ASK_USER=须在数据发动机页补录 / REUSE_EXISTING=复用既有连接器·本体。 */
  source: InputFieldSourceSchema,
  /** enum / REUSE_EXISTING 的候选项。 */
  options: z.array(z.string()).optional(),
});
export type InputField = z.infer<typeof InputFieldSchema>;

export const InputManifestSchema = z.object({
  runId: z.string(),
  fields: z.array(InputFieldSchema),
});
export type InputManifest = z.infer<typeof InputManifestSchema>;

// ---- ScaffoldReceipt（A→B 推送回执 · g8 §3.4，P3 跨系统闭包）-----------------

export const ScaffoldKindSchema = z.enum(["intent", "plan", "workflow", "skill", "agent", "mcp", "scene"]);
export type ScaffoldKind = z.infer<typeof ScaffoldKindSchema>;

export const ScaffoldItemSchema = z.object({
  kind: ScaffoldKindSchema,
  key: z.string(),
  /** REUSED=既有复用 / SCAFFOLDED=新建 DRAFT / MISSING=断链（落母体 GrowthTicket）。 */
  status: z.enum(["REUSED", "SCAFFOLDED", "MISSING"]),
  /** MISSING 时的断链引用（喂母体缺口/工单）。 */
  missingRefs: z.array(z.string()).optional(),
});
export type ScaffoldItem = z.infer<typeof ScaffoldItemSchema>;

export const ScaffoldReceiptSchema = z.object({
  items: z.array(ScaffoldItemSchema),
  /** 全链 CHAIN/SHAPE 任一断即 false → ClosureReport HARD FAIL（R11 跨系统）。 */
  fullChainOk: z.boolean(),
});
export type ScaffoldReceipt = z.infer<typeof ScaffoldReceiptSchema>;

/** A→B 推送的 B 栈制品清单（g8 §3.4）：DataCore closure 阶段经 SERVICE_TOKEN 下发 AgentCore。 */
export const ScaffoldManifestSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  intentNeeds: z.array(PlanIntentNeedSchema).default([]),
  planNeeds: z.array(PlanPlanNeedSchema).default([]),
  workflowNeeds: z.array(PlanWorkflowNeedSchema).default([]),
  skillNeeds: z.array(PlanSkillNeedSchema).default([]),
  agentNeeds: z.array(PlanAgentNeedSchema).default([]),
  mcpNeeds: z.array(PlanMcpNeedSchema).default([]),
  sceneNeeds: z.array(PlanSceneNeedSchema).default([]),
});
export type ScaffoldManifest = z.infer<typeof ScaffoldManifestSchema>;

// ---- StoryBuildRun（故事先行的一次端到端建域记录 = 历史推演记录主键）---------

export const StoryBuildRunStatusSchema = z.enum([
  "PENDING_INPUT", // 有 ASK_USER 项待补录（P2）
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);
export type StoryBuildRunStatus = z.infer<typeof StoryBuildRunStatusSchema>;

export const StoryBuildRunSchema = z.object({
  id: z.string(), // sbr_（= InputManifest.runId 指向的运行主键）
  tenantId: z.string(),
  /** 故事脚本（人输入或自动生成 = 燃料）。 */
  script: z.string(),
  /** comprehend 倒推的补录表单（P2；P1 可空）。 */
  inputManifest: InputManifestSchema.optional(),
  /** 封存可重放的全栈 BuildPlan（R6 确定性，frozen 快照供历史回放）。 */
  buildPlan: BuildPlanSchema.optional(),
  /** A 栈三向闭包（+ P3 起并入 B 栈 scaffold 的全链判定）。 */
  closureReport: ClosureReportSchema.optional(),
  /** B 栈 scaffold 回执（P3）。 */
  scaffoldReceipt: ScaffoldReceiptSchema.optional(),
  /** 本次建域产出的连接器 id（源数据在连接器页可见，可下钻）。 */
  producedConnections: z.array(z.string()).default([]),
  /** 本次建域产出的 RawDataset id。 */
  producedDatasets: z.array(z.string()).default([]),
  /** 功能缺失自检（MISSING 制品映射母体 7 码；P4）。 */
  gapReport: GapReportSchema.optional(),
  /** （可选）以生成场景跑一遍 QOS 推演的答案（P5；内层调母体 growth/run）。 */
  answer: z.string().optional(),
  status: StoryBuildRunStatusSchema,
  createdAt: IsoTime,
});
export type StoryBuildRun = z.infer<typeof StoryBuildRunSchema>;

// ---- P2 请求体：两阶段（manifest 倒推补录 / build 直接建域）------------------

/** POST /a/v1/databuilder/runs 请求体。stage 缺省=直接建域（P1 兼容）；"manifest"=先倒推补录表单。 */
export const StoryRunRequestSchema = z.object({
  script: z.string().min(1),
  builderKey: z.string().default("foundry-grade-data-builder"),
  seed: z.number().int().optional(),
  stage: z.enum(["manifest", "build"]).optional(),
});
export type StoryRunRequest = z.infer<typeof StoryRunRequestSchema>;

/** PATCH /a/v1/databuilder/runs/:id/inputs 请求体：补录 ASK_USER 字段 → 续跑建域。 */
export const StoryInputsBodySchema = z.object({
  inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type StoryInputsBody = z.infer<typeof StoryInputsBodySchema>;

/** g8-P4 压测请求体：跑一组故事脚本，统计覆盖率/失败率（= 自动生成管线压测）。 */
export const StressBodySchema = z.object({
  scripts: z.array(z.string().min(1)).min(1).max(50),
  seed: z.number().int().optional(),
});
export type StressBody = z.infer<typeof StressBodySchema>;

/** g8-P6 存量回填批量报告（= 首次全量压测：覆盖率/失败率 + 逐条 StoryBuildRun 引用）。 */
export const BackfillReportSchema = z.object({
  total: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  /** 逐个存量推演场景的回填结果（key=求解器/能力，runId 指向其 StoryBuildRun 血缘）。 */
  runs: z.array(z.object({
    key: z.string(),
    runId: z.string(),
    status: StoryBuildRunStatusSchema,
    fullChainOk: z.boolean().optional(),
  })),
});
export type BackfillReport = z.infer<typeof BackfillReportSchema>;
