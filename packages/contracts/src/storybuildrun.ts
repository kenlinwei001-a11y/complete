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

// ---- ProducedArtifact + ModuleSyncMatrix（区5 模块同步矩阵 · 统一规格 P2）-----
// 一次建域对每个下游模块的同步快照：让用户看到"为匹配故事新增了哪些本体/workflow/agent…、
// DRAFT 还是已发布、去哪核对"。ModuleSyncMatrix 为 producedArtifacts 的按模块派生投影
// （不是新真值源，R13）；DRAFT/PUBLISHED 区分守 R4（审批前未在该模块生效）。

/** 下游模块枚举（页面同步矩阵的行 = 平台元模型，非租户业务常数 → R14 安全）。 */
export const ProducedModuleSchema = z.enum([
  "ontology", "connector", "rule", "slice", "solver",
  "catalog", "workflow", "skill", "agent", "mcp", "scene",
]);
export type ProducedModule = z.infer<typeof ProducedModuleSchema>;

export const ProducedArtifactSchema = z.object({
  module: ProducedModuleSchema,
  /** objectType | rule | slice | connection | dataset | solver | intent | plan | workflow | skill | agent | mcp | scene */
  kind: z.string(),
  key: z.string(),
  action: z.enum(["CREATED", "UPDATED", "REUSED"]),
  /** R4：scaffold/未发布制品 = DRAFT（未生效）；建域成功落库的 A 栈/真实复用 = PUBLISHED。 */
  status: z.enum(["DRAFT", "PUBLISHED"]),
});
export type ProducedArtifact = z.infer<typeof ProducedArtifactSchema>;

/** 模块 → 标签 + 管理页深链（点击跳去该模块核对；R14：来自共享元模型，前端不重定义 R1）。 */
export const MODULE_REGISTRY: { module: ProducedModule; label: string; deepLink: string }[] = [
  { module: "ontology", label: "本体建模", deepLink: "/admin/modeling" },
  { module: "connector", label: "数据连接器", deepLink: "/admin/connections" },
  { module: "rule", label: "规则库", deepLink: "/admin/rules" },
  { module: "slice", label: "切片", deepLink: "/admin/slices" },
  { module: "solver", label: "求解器", deepLink: "/admin/modeling" },
  { module: "catalog", label: "意图/计划", deepLink: "/admin/catalog" },
  { module: "workflow", label: "工作流", deepLink: "/admin/workflows" },
  { module: "skill", label: "技能", deepLink: "/admin/skills" },
  { module: "agent", label: "Agent", deepLink: "/admin/agents" },
  { module: "mcp", label: "MCP", deepLink: "/admin/mcp" },
  { module: "scene", label: "场景", deepLink: "/admin/scenes" },
];

export const ModuleSyncRowSchema = z.object({
  module: ProducedModuleSchema,
  label: z.string(),
  added: z.number().int(),
  updated: z.number().int(),
  reused: z.number().int(),
  /** 该模块本次制品综合状态：有任一 DRAFT → DRAFT；全 PUBLISHED → PUBLISHED；无制品 → NONE。 */
  status: z.enum(["DRAFT", "PUBLISHED", "NONE"]),
  artifactRefs: z.array(z.string()),
  deepLink: z.string(),
});
export type ModuleSyncRow = z.infer<typeof ModuleSyncRowSchema>;

export const ModuleSyncMatrixSchema = z.array(ModuleSyncRowSchema);
export type ModuleSyncMatrix = z.infer<typeof ModuleSyncMatrixSchema>;

/** 派生投影（纯函数，确定性 R6）：按 MODULE_REGISTRY 把 producedArtifacts 聚合成模块同步矩阵。 */
export function buildModuleSyncMatrix(artifacts: ProducedArtifact[]): ModuleSyncMatrix {
  return MODULE_REGISTRY.map(({ module, label, deepLink }) => {
    const items = artifacts.filter((a) => a.module === module);
    const status: ModuleSyncRow["status"] =
      items.length === 0 ? "NONE" : items.some((a) => a.status === "DRAFT") ? "DRAFT" : "PUBLISHED";
    return {
      module,
      label,
      added: items.filter((a) => a.action === "CREATED").length,
      updated: items.filter((a) => a.action === "UPDATED").length,
      reused: items.filter((a) => a.action === "REUSED").length,
      status,
      artifactRefs: items.map((a) => a.key),
      deepLink,
    };
  });
}

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
  /** 区5 模块同步矩阵的真值源（每个下游制品的模块/动作/状态；matrix 由此派生投影）。 */
  producedArtifacts: z.array(ProducedArtifactSchema).default([]),
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
  /** g8-P5：建域后跑一次推演,answer 回填（可选,默认 false）。 */
  inference: z.boolean().optional(),
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
