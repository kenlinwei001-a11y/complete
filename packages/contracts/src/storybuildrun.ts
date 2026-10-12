import { z } from "zod";
import { IsoTime } from "./common.js";
import {
  BuildModeSchema,
  BuildPlanSchema,
  ClosureReportSchema,
  PlanIntentNeedSchema,
  PlanPlanNeedSchema,
  PlanWorkflowNeedSchema,
  PlanSkillNeedSchema,
  PlanAgentNeedSchema,
  PlanMcpNeedSchema,
  PlanSceneNeedSchema,
  GapAnalysisSchema,
} from "./databuilder.js";
import { GapReportSchema } from "./growth.js";
import { ReconcileActionSchema } from "./prototype-intake.js";
import { ValidationTraceSchema } from "./qos.js";

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

// ---- A7 · ScaffoldManifest 持久记录（DataCore 侧单机可见 + B 上线对账）------------
// g8-P3 的 B 栈产物原本只在 A→B 下发成功时存在于 AgentCore；单机/未配 AGENTCORE_BASE_URL 时「看不见」。
// A7 把倒推的 B 栈需求**无条件**落 DataCore（挂 StoryBuildRun，doc store 无 migration）：每项带定义 + 状态
// PENDING_BSTACK（看得到、待 B 对账生效）→ B 上线幂等对账升 SCAFFOLDED/REUSED。诚实区分「看得到」与「真生效」。

export const SCAFFOLD_ITEM_STATUS = ["PENDING_BSTACK", "SCAFFOLDED", "REUSED", "MISSING"] as const;

export const ScaffoldManifestItemSchema = z.object({
  /** B 栈模块（= ScaffoldKind）。 */
  module: ScaffoldKindSchema,
  key: z.string(),
  status: z.enum(SCAFFOLD_ITEM_STATUS),
  /** 倒推出的制品定义（agent systemPrompt/tools、plan steps/args… 单机可看「这个 agent 是什么」）。 */
  definition: z.record(z.string(), z.unknown()).default({}),
  missingRefs: z.array(z.string()).optional(),
});
export type ScaffoldManifestItem = z.infer<typeof ScaffoldManifestItemSchema>;

/** 持久的 scaffold 清单记录（挂 StoryBuildRun）：单机态全 PENDING_BSTACK；B 对账后升级。 */
export const ScaffoldManifestRecordSchema = z.object({
  runId: z.string(),
  items: z.array(ScaffoldManifestItemSchema),
  /** 全 SCAFFOLDED/REUSED = true（HARD）；含 PENDING_BSTACK/MISSING = false（SOFT，"看得到≠真生效"）。 */
  fullChainOk: z.boolean(),
  /** 含未对账项（单机/未配 B）= true：看得到但待 B 对账。 */
  pendingBstack: z.boolean(),
  /** B 上线对账完成时间（幂等对账后写）。 */
  reconciledAt: z.string().optional(),
  recordedAt: z.string(),
});
export type ScaffoldManifestRecord = z.infer<typeof ScaffoldManifestRecordSchema>;

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

// ---- 区6③ 故事覆盖度（每句故事 → 制品映射；未映射高亮"未理解/未建模"）-----------

export const StoryCoverageSentenceSchema = z.object({
  text: z.string(),
  mapped: z.boolean(),
  refs: z.array(z.string()),
});
export type StoryCoverageSentence = z.infer<typeof StoryCoverageSentenceSchema>;

// ---- StoryBuildRun（故事先行的一次端到端建域记录 = 历史推演记录主键）---------

export const StoryBuildRunStatusSchema = z.enum([
  "PENDING_INPUT", // 有 ASK_USER 项待补录（P2）
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);
export type StoryBuildRunStatus = z.infer<typeof StoryBuildRunStatusSchema>;

// ---- A5 · FDE 编排工作流节点状态图（建域过程的可观测语义投影）---------------------
// 既有 7 步持久化执行（BuildWorkflowRun）是「执行真相」；A5 把它语义投影成 8 个 FDE 节点
// （意图→倒推→查能力→比差→各模块生成→闭包→publish→进启动器），每节点带状态/IO/下钻/缺口码，
// 让「建域走到哪、断在哪」一眼可见。节点为派生读模型（projectFdeNodes，确定性 R6），非另一套执行。

/** FDE 8 节点固定序（与 fde-graph.ts FDE_NODES 对齐）。 */
export const FDE_NODE_KEYS = [
  "story",       // ① 意图/故事（输入燃料）
  "comprehend",  // ② comprehend 倒推（产 BuildPlan）
  "capability",  // ③ 查能力（capability-inventory，A3 切片/求解器覆盖）
  "gap",         // ④ 比差（GapAnalysis，缺口高亮）
  "generate",    // ⑤ 各模块生成（对象/规则/求解器/切片/B 栈 scaffold）
  "closure",     // ⑥ 闭包（R11 全链：CHAIN/SHAPE/OBJECT/DATA/FORWARD）
  "publish",     // ⑦ publish（R4 审批落真值）
  "launcher",    // ⑧ 进启动器（出答案，交 A10 验证）
] as const;
export type FdeNodeKey = (typeof FDE_NODE_KEYS)[number];

export const FDE_NODE_STATUS = ["PENDING", "RUNNING", "DONE", "FAILED", "SKIPPED"] as const;
export type FdeNodeStatus = (typeof FDE_NODE_STATUS)[number];

/** FDE 节点状态（投影自 BuildWorkflowRun 步状态 + 产物存在性）。 */
export const FdeNodeSchema = z.object({
  key: z.enum(FDE_NODE_KEYS),
  label: z.string(),
  status: z.enum(FDE_NODE_STATUS),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  durationMs: z.number().optional(),
  /** IO 计数（入/出，best-effort：如产出连接器+数据集数、缺口条数）。 */
  io: z.object({ in: z.number().optional(), out: z.number().optional() }).optional(),
  /** 下钻真实产物引用（buildPlan/capabilityInventory/gapAnalysis/producedArtifacts/closureReport/answer/script）。 */
  drilldownRef: z.string().optional(),
  /** FAILED 节点的缺口码（如闭包断 = 首个失败维 CHAIN/SHAPE；步致命 = 步 error.code）。 */
  gapCode: z.string().optional(),
  detail: z.string().optional(),
});
export type FdeNode = z.infer<typeof FdeNodeSchema>;

// ---- A10 · 终态闭环验证（建域→R4 审批→publish→自动/手动重跑主问句验证"真能答了"）-----
export const BUILD_VERIFICATION_STATUS = ["PENDING", "VERIFIED", "NOT_VERIFIED", "BUILD_STATIC", "PROVISIONAL_ANSWER"] as const;
export type BuildVerificationStatus = (typeof BUILD_VERIFICATION_STATUS)[number];

export const BuildVerificationSchema = z.object({
  /** VERIFIED=QOS 实跑可答（活证据）· NOT_VERIFIED=不可答(+gapCode 回灌节点图/工单) · BUILD_STATIC=QOS 未配,兜底直调求解器(诚实"未过运行时") · PENDING。 */
  status: z.enum(BUILD_VERIFICATION_STATUS),
  /** 被验证的主问句（= BuildPlan.script）。 */
  question: z.string(),
  answer: z.string().optional(),
  /** QOS 实跑是否判定可答（RUNTIME_PROBE 时有值）。 */
  answerable: z.boolean().optional(),
  evidence: z.enum(["RUNTIME_PROBE", "BUILD_STATIC"]).optional(),
  /** NOT_VERIFIED 缺口码（NOT_ANSWERABLE / NO_SOLVER_NEED…）回灌 FDE 节点图末节点红 + 可选工单。 */
  gapCode: z.string().optional(),
  validationTrace: ValidationTraceSchema.optional(),
  verifiedAt: z.string(),
});
export type BuildVerification = z.infer<typeof BuildVerificationSchema>;

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
  /** A7：B 栈 scaffold 持久清单（DataCore 侧单机可见 + B 上线对账状态；不依赖 AGENTCORE_BASE_URL）。 */
  scaffoldManifest: ScaffoldManifestRecordSchema.optional(),
  /** 本次建域产出的连接器 id（源数据在连接器页可见，可下钻）。 */
  producedConnections: z.array(z.string()).default([]),
  /** 本次建域产出的 RawDataset id。 */
  producedDatasets: z.array(z.string()).default([]),
  /** 区5 模块同步矩阵的真值源（每个下游制品的模块/动作/状态；matrix 由此派生投影）。 */
  producedArtifacts: z.array(ProducedArtifactSchema).default([]),
  /** 区6③ 故事覆盖度：故事逐句 → 制品映射（未映射=未理解/未建模，"没遗漏"证据）。 */
  storyCoverage: z.array(StoryCoverageSentenceSchema).default([]),
  /** 功能缺失自检（MISSING 制品映射母体 7 码；P4）。 */
  gapReport: GapReportSchema.optional(),
  /** 比对现状：倒推 BuildPlan vs 系统现状的跨模块统一 diff（需要/复用/新建/缺，ModuleProvisioner 注册表产出）。 */
  gapAnalysis: GapAnalysisSchema.optional(),
  /** A5：FDE 编排工作流 8 节点状态图（建域过程可观测投影；record 步落最终快照，运行中由 workflow-run 实时投影）。 */
  nodes: z.array(FdeNodeSchema).default([]),
  /** A10：终态闭环验证（publish 后/手动 把主问句经 QOS 实跑一遍验证"现在真能答了"；诚实区分 VERIFIED/NOT_VERIFIED/BUILD_STATIC）。 */
  verification: BuildVerificationSchema.optional(),
  /** A18：构建模式（STRICT 写真值 / PROVISIONAL 未审核预览）。 */
  buildMode: BuildModeSchema.default("STRICT"),
  /** A18：整域信任级——PROVISIONAL 建出的域为 UNVERIFIED（强标"未审核·基于临时件"，绝不当真值）。 */
  domainTrustLevel: z.enum(["GOVERNED", "UNVERIFIED"]).optional(),
  /** A18.3：PROVISIONAL 隔离物化命名空间（伪租户 `tenant::prov::runId`；未审核数据落此，governed 查询默认不可见 R2）。 */
  provisionalNamespace: z.string().optional(),
  /** A18.4 整域晋升编排：人工审核通过 → 把隔离域数据迁入真租户 + 逐制品晋升临时求解器 GOVERNED + 翻转域信任级。 */
  domainPromotion: z
    .object({
      promotedAt: IsoTime,
      promotedBy: z.string(),
      fromNamespace: z.string(),
      migratedObjects: z.number().int().default(0),
      migratedDatasets: z.number().int().default(0),
      migratedConnections: z.number().int().default(0),
      migratedTypes: z.number().int().default(0),
      /** 整域内逐制品晋升为 GOVERNED 的临时求解器 key。 */
      promotedSolvers: z.array(z.string()).default([]),
      /**
       * WO-DBUI-FLOW：**同 key 沿用既有、本次没建**的对象类型 key。
       * 病史：这批类型此前既不进 `migratedTypes` 也不出现在任何回执里 ⇒ 人以为建了新类型、
       * 实际用的是库里那个，而屏上数字一点看不出。诚实位补在这里（新增字段，`.optional()` 零回归）。
       */
      reusedTypeKeys: z.array(z.string()).optional(),
      /** 人裁决为「沿用既有、不覆盖」的链路 key（默认行为原本是无条件覆盖）。 */
      keptLinkKeys: z.array(z.string()).optional(),
      /** 人裁决为「覆盖」的链路 key（每一条都是一次经审批的真值写入，R4 留痕）。 */
      overwrittenLinkKeys: z.array(z.string()).optional(),
    })
    .optional(),
  /** （可选）以生成场景跑一遍 QOS 推演的答案（P5；§9 归一：经 AgentCore growth/probe 实跑）。 */
  answer: z.string().optional(),
  /** §9 归一 evidence 标记：RUNTIME_PROBE=答案经 QOS orchestrator 实跑（绿测试≠能用的活证据）；
   *  BUILD_STATIC=未配 AgentCore，兜底直调求解器在建好对象上算（诚实区分，未过 QOS 运行时）。 */
  inferenceEvidence: z.enum(["RUNTIME_PROBE", "BUILD_STATIC"]).optional(),
  /** 区6④ 推演验证痕迹（一致性 + 交叉验证）：建域成功即由 crossValidate 把结论依据对象
   *  反向核对知识图谱 → 前端 ValidationTracePanel 内嵌，让用户信任"完整且有据"（R13）。 */
  validationTrace: ValidationTraceSchema.optional(),
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
  /** A18：构建模式（默认 STRICT；PROVISIONAL=未审核预览，闭包降 ADVISORY 不阻断、不写真值）。 */
  buildMode: BuildModeSchema.optional(),
  /** WO-DB-MODELING-WIRE：数据先行——给已上传 rawDataset id 时 objectTypes/链路从真实列/FK 派生（A3·无 LLM·R6）。 */
  fromDatasetIds: z.array(z.string()).optional(),
});
export type StoryRunRequest = z.infer<typeof StoryRunRequestSchema>;

/** PATCH /a/v1/databuilder/runs/:id/inputs 请求体：补录 ASK_USER 字段 → 续跑建域。 */
export const StoryInputsBodySchema = z.object({
  inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type StoryInputsBody = z.infer<typeof StoryInputsBodySchema>;

// ---- WO-DBUI-FLOW · 入库前冲突预检（第 ⑥ 步「人工确定入库」的输入，只读）------------
//
// 仓主原话：「模拟的数据是否可以入库，**需要系统再次复验自检，因为人不清楚系统里面的数据现状，
// 是否有冲突等等**」。落点在 `promoteDomain`（`datacore/databuilder/service.ts`）真写之前：
// 缺口分析是**建域时（T1）**算的，人点「入库」时（T2）世界可能已变（别人建了同名类型、改了策略）。
//
// ⚠ **预检不是审批的替代，是审批的输入**（R4）：晋升仍是人工审批动作（端点 requireAdmin）。
//    预检**一个字节都不写**——它只把「真写会发生什么」提前算出来给人看。

/**
 * 三类冲突**分开**登记，绝不合成一个「N 条冲突」——
 * 「会改掉既有定义」与「写了个一样的」危险度差一个量级，合成即让人无法裁决。
 */
export const PROMOTE_CONFLICT_KINDS = [
  /** 真租户已有同 `key` 的 ObjectType：今天**静默跳过**（沿用既有），且不计入 migratedTypes ⇒ 屏上看不出。 */
  "TYPE_SAME_KEY",
  /** 同 `key` 的 LinkType 但 from/to/cardinality 任一不同：今天**无条件覆盖** = 一次静默的本体真值写入。 */
  "LINK_SAME_KEY_DIFF_DEF",
  /** 同 `key` 的 LinkType 且定义全同：覆盖但无语义变化（仅 version+1 churn）。 */
  "LINK_SAME_KEY_SAME_DEF",
] as const;
export const PromoteConflictKindSchema = z.enum(PROMOTE_CONFLICT_KINDS);
export type PromoteConflictKind = z.infer<typeof PromoteConflictKindSchema>;

/**
 * 冲突类目录（屏上文案 + 危险度 + 今天的默认行为）——**契约单源**，前端不重定义（R1 / R14）。
 * `severity` 是给人排序用的，不是给机器阻断用的：阻断判据在 `requiresDecision`（见下）。
 */
export const PROMOTE_CONFLICT_REGISTRY: {
  kind: PromoteConflictKind;
  label: string;
  /** 无裁决时 `promoteDomain` 今天会做什么（诚实位：屏上直说「你不选也会发生这个」）。 */
  defaultBehavior: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}[] = [
  { kind: "TYPE_SAME_KEY", label: "对象类型同名（库里已有）", defaultBehavior: "沿用库里既有的那个，本次不新建（字段可能与故事要的不一致）", severity: "MEDIUM" },
  { kind: "LINK_SAME_KEY_DIFF_DEF", label: "链路同名但定义不同", defaultBehavior: "覆盖既有定义（端点/基数被改写）——这是一次真值写入，必须人裁决", severity: "HIGH" },
  { kind: "LINK_SAME_KEY_SAME_DEF", label: "链路同名且定义相同", defaultBehavior: "覆盖（版本号 +1，语义无变化）", severity: "LOW" },
];

/**
 * 一条冲突：`既有值` · `将写值` · `建议动作`（工单 §3.3.2 的三样）。
 * 动作词表**复用** `SchemaReconcileCandidate` 已立的 `ReconcileAction`（USE/RENAME/NEW/MERGE/DISCARD），
 * 不另发明一套：`USE`=沿用既有 · `MERGE`=覆盖 · `RENAME`=改名新建。
 */
export const PromoteConflictSchema = z.object({
  kind: PromoteConflictKindSchema,
  target: z.enum(["objectType", "linkType"]),
  key: z.string(),
  /** 真租户当下的定义（逐字段字符串化，屏上直接可读；类型同 key 时给 displayName/domain/属性数）。 */
  existingValue: z.record(z.string(), z.string()).default({}),
  /** 隔离命名空间里待迁入的定义（同一字段集，可与 existingValue 逐字段对照）。 */
  incomingValue: z.record(z.string(), z.string()).default({}),
  /** 逐字段差异的字段名（仅 LINK_SAME_KEY_DIFF_DEF 非空）。 */
  changedFields: z.array(z.string()).default([]),
  /** 系统建议动作（人可改；`USE`=不动既有真值 = 最安全的默认）。 */
  suggestedAction: ReconcileActionSchema,
  /** `promoteDomain` **今天真能执行**的动作集合。RENAME/NEW/DISCARD 尚未实现 ⇒ 不列出（不给假按钮）。 */
  availableActions: z.array(ReconcileActionSchema).default([]),
  /**
   * 是否**必须**有人的裁决才允许写。true 仅用于「默认行为会改写既有真值」的那一类
   * （LINK_SAME_KEY_DIFF_DEF）——不搞「必须先调预检」的隐式耦合，只堵真正危险的那一步。
   */
  requiresDecision: z.boolean().default(false),
});
export type PromoteConflict = z.infer<typeof PromoteConflictSchema>;

/** 闭包判定的可比摘要（T1/T2 并列显示用）。 */
export const ClosureSnapshotSchema = z.object({
  gatePassed: z.boolean(),
  objectsBound: z.number().int(),
  dataOrphans: z.number().int(),
  forwardMissing: z.number().int(),
  chainBroken: z.number().int(),
  shapeBroken: z.number().int(),
});
export type ClosureSnapshot = z.infer<typeof ClosureSnapshotSchema>;

/** 比对现状的可比摘要（T1/T2 并列显示用）。 */
export const GapTotalsSnapshotSchema = z.object({
  needed: z.number().int(),
  existing: z.number().int(),
  toCreate: z.number().int(),
  missing: z.number().int(),
});
export type GapTotalsSnapshot = z.infer<typeof GapTotalsSnapshotSchema>;

/**
 * 「建域后世界变了没有」——把 T1（建域时封存）与 T2（预检时现算）并列。
 *
 * ⚠ **诚实边界（两维的世界依赖不同，不许当成一回事）**：
 *   · `closure*` 由 `validateClosure(plan, policy, buildMode)` 得出，是**纯函数** ——
 *     plan 已冻结 ⇒ 它唯一可能漂移的输入是**闭包策略**（builder preset 被人改过）。
 *   · `gap*` 由 `analyzeGap(deps, ctx, plan)` 得出，**真的读当前真租户**（已有类型/规则/切片/数据集）——
 *     这才是「别人在你建完域之后动了库」的检出维。
 *   两维都报，但别拿闭包那维冒充世界漂移。
 */
export const PromoteWorldDriftSchema = z.object({
  closureAtBuild: ClosureSnapshotSchema.optional(),
  closureAtPrecheck: ClosureSnapshotSchema.optional(),
  gapAtBuild: GapTotalsSnapshotSchema.optional(),
  gapAtPrecheck: GapTotalsSnapshotSchema.optional(),
  /** 逐字段差异（`dim` = closure|gap，屏上直接列「变在哪」）。 */
  diffs: z.array(z.object({ dim: z.enum(["closure", "gap"]), field: z.string(), atBuild: z.string(), atPrecheck: z.string() })).default([]),
  /** 任一维不一致 ⇒ true：**建域后世界变了**。 */
  changed: z.boolean().default(false),
});
export type PromoteWorldDrift = z.infer<typeof PromoteWorldDriftSchema>;

/** `POST /a/v1/databuilder/runs/:id/promote-precheck` 响应（**只读**：调它不改变任何世界态）。 */
export const PromotePrecheckSchema = z.object({
  runId: z.string(),
  /** 三类各自计数（**分开**，绝不给一个合计数——合计等于让人无法裁决）。 */
  counts: z.object({
    typeSameKey: z.number().int(),
    linkSameKeyDiffDef: z.number().int(),
    linkSameKeySameDef: z.number().int(),
  }),
  conflicts: z.array(PromoteConflictSchema).default([]),
  /** 无冲突、可直接迁入的制品数（让人知道「其余的都干净」）。 */
  clean: z.object({ objectTypes: z.number().int(), linkTypes: z.number().int() }),
  drift: PromoteWorldDriftSchema,
  /** 还差几条人的裁决才允许入库（= requiresDecision 且未裁决的条数）。 */
  pendingDecisions: z.number().int().default(0),
  checkedAt: IsoTime,
});
export type PromotePrecheck = z.infer<typeof PromotePrecheckSchema>;

/** 人对一条冲突的裁决（`resolvedAction` 的等价物，沿用同一词表）。 */
export const PromoteDecisionSchema = z.object({
  target: z.enum(["objectType", "linkType"]),
  key: z.string(),
  action: ReconcileActionSchema,
});
export type PromoteDecision = z.infer<typeof PromoteDecisionSchema>;

/** `POST /a/v1/databuilder/runs/:id/promote` 请求体（缺省 = 空裁决；有必裁冲突时后端显式报错，绝不静默按默认写）。 */
export const PromoteBodySchema = z.object({
  decisions: z.array(PromoteDecisionSchema).default([]),
});
export type PromoteBody = z.infer<typeof PromoteBodySchema>;

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
