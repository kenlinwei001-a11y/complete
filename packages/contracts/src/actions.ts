import { z } from "zod";

// ---------------------------------------------------------------------------
// 求解器增量 PRD §S2：Action 审批流（DataCore 侧）
// ---------------------------------------------------------------------------

export const ActionStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "EXECUTION_FAILED",
  "REJECTED",
  "CANCELLED",
]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const ApprovalStepSchema = z.object({
  seq: z.number().int(),
  role: z.string(),
  approverId: z.string().optional(),
  decision: z.enum(["APPROVE", "REJECT"]).optional(),
  comment: z.string().optional(),
  decidedAt: z.string().optional(),
  /** SA：发起人=审批人的可配置留痕例外（R4 放宽；STRICT 租户恒 undefined）。R13 透明可审计。 */
  selfApproved: z.boolean().optional(),
});
export type ApprovalStep = z.infer<typeof ApprovalStepSchema>;

/** SA：租户级自审策略（粗粒度兜底）。默认 STRICT=现行职责分离；demo 默认 ALLOW_ADMIN。 */
export const SelfApprovePolicySchema = z.enum(["STRICT", "ALLOW_ADMIN", "ALLOW_ALL"]);
export type SelfApprovePolicy = z.infer<typeof SelfApprovePolicySchema>;

export const ActionDraftSchema = z.object({
  id: z.string(), // act_
  tenantId: z.string(),
  actionTypeKey: z.string(),
  /**
   * ActionType 演进（additive·optional）：提交时快照「本 payload 是按哪一版 ActionType 的
   * `paramsSchema` 校验通过的」。历史草稿没有此字段 → 按 `ACTION_TYPE_DEFAULT_VERSION` 解释
   * （见 `actionTypeVersionOf`），因为本字段出现之前全平台只存在过一版形状。
   * 有了它，改 `paramsSchema` 不再是破坏性变更：旧记录仍能被解释成"当时那版"。
   */
  actionTypeVersion: z.number().int().optional(),
  payload: z.record(z.string(), z.unknown()), // 提交后不可变
  origin: z.object({
    taskId: z.string().optional(),
    agentId: z.string().optional(),
    userId: z.string(),
  }),
  status: ActionStatusSchema,
  approvalSteps: z.array(ApprovalStepSchema),
  executionResult: z
    .object({
      ok: z.boolean(),
      targetRef: z.string().optional(),
      error: z.string().optional(),
      attempts: z.number().int(),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ActionDraft = z.infer<typeof ActionDraftSchema>;

// ---------------------------------------------------------------------------
// ActionType 七要素补全 ①：副作用/回写声明（effects）
//
// 病根：`checkRules` 只表达「执行前要满足什么」（前置条件），**没有任何字段表达「执行后会改哪个
// 对象类型的哪些属性」**——回写逻辑散落在各执行器代码里（`apps/datacore/src/app.ts domainExecutor`
// 分支 + `actions.ts GlobalSimPlanExecutor`），不是类型上的声明。后果：Agent / 影响分析无法回答
// 「批准这个 Action 会动到什么」，只能靠人读执行器源码（违反 R13 结论可溯源的行动侧对称面）。
//
// 形状纪律：
//  · `objectType` = 已发布 OntologyType 的 typeKey（如 "WorkOrder"/"Order"/"InterBaseTransfer"），
//    `properties[]` = 该类型 PropertyDef 的 propKey（如 "qtyPlanned"/"status"）——直接复用本体既有
//    命名，**不自造第二套命名空间**。
//  · 全部机器可读（枚举 + 键名），`note` 只作人读补注，语义判据一律取结构化字段。
// ---------------------------------------------------------------------------

/** 回写操作类别（影响分析据此判断"新增/改写/删除"）。 */
export const ActionEffectOpSchema = z.enum(["CREATE", "UPDATE", "UPSERT", "DELETE"]);
export type ActionEffectOp = z.infer<typeof ActionEffectOpSchema>;

/** 目标对象如何被定位：STATIC=类型内固定/全量；BY_PAYLOAD=由 payload 的某字段指定（payloadPath）。 */
export const ActionEffectSelectorSchema = z.object({
  kind: z.enum(["STATIC", "BY_PAYLOAD"]),
  /** BY_PAYLOAD 时的 payload 字段路径（如 "objectId" / "served[].orderId"）。 */
  payloadPath: z.string().optional(),
});
export type ActionEffectSelector = z.infer<typeof ActionEffectSelectorSchema>;

/** 单条回写声明：本 Action 执行后会写哪个对象类型的哪些属性。 */
export const ActionEffectSchema = z.object({
  /** 目标对象类型 key（= OntologyType.typeKey）。 */
  objectType: z.string().min(1),
  op: ActionEffectOpSchema,
  /**
   * 会被写入的属性 key 列表（= PropertyDef.propKey）。空数组 = 整对象级写入
   * （CREATE 全字段 / DELETE 整行），不代表"不知道写什么"——不知道时用 `undeclared` 交底。
   */
  properties: z.array(z.string()).default([]),
  selector: ActionEffectSelectorSchema.optional(),
  /** 一次执行影响 1 个还是 N 个对象（影响分析的爆炸半径）。 */
  cardinality: z.enum(["ONE", "MANY"]).optional(),
  /**
   * 条件写：仅当 payload 某字段等于某值时才发生（如 `plan_change` 只有 source==="global-sim"
   * 才回灌真对象）。机器可判，不是自由文本。
   */
  condition: z.object({ payloadPath: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
  /** 人读补注（不承担语义判据）。 */
  note: z.string().optional(),
});
export type ActionEffect = z.infer<typeof ActionEffectSchema>;

/**
 * 回写规格集合。`coverage` 是**诚实自陈**：声明覆盖不全时必须写 PARTIAL + 在 `undeclared` 列出
 * 表达不了的回写——宁可覆盖不全，也不许以 COMPLETE 假装完整（本仓刚因"文档里写了不存在的门"退过单）。
 */
export const ActionEffectSpecSchema = z.object({
  writes: z.array(ActionEffectSchema).default([]),
  coverage: z.enum(["COMPLETE", "PARTIAL", "NONE"]).default("NONE"),
  /** coverage=PARTIAL 时逐条列出"尚未/无法用声明表达"的回写（人读交底）。 */
  undeclared: z.array(z.string()).default([]),
});
export type ActionEffectSpec = z.infer<typeof ActionEffectSpecSchema>;

/** Action 类型（本体注册）：参数 schema / 预检规则 / 审批链 / 版本 / 回写声明定义在类型上 */
export const ActionTypeSchema = z.object({
  key: z.string(),
  name: z.string(),
  /**
   * ActionType 七要素补全 ②：可演进（对齐 `SkillDefinitionSchema` / `WorkflowDefinitionSchema`
   * 的 `version: z.number().int()` 单调整数版本语义）。**此处取 `.optional()` 而非它们的必填**，
   * 唯一原因是向后兼容硬约束：既有 12 个内置 ActionType 与库里已落的 `action_types` 行都没有
   * 此字段，收紧成必填会让现存数据 parse 失败。
   * 缺省语义：`undefined` ≡ 第 1 版（`ACTION_TYPE_DEFAULT_VERSION`）——本字段出现之前全平台
   * 只存在过一版形状，因此把历史一律归入 v1 是唯一无歧义的解释；若改判为"未知版本"，所有历史
   * `ActionDraft` 都将无法与任何一版 `paramsSchema` 对应，等于放弃可解释性。
   */
  version: z.number().int().optional(),
  paramsSchema: z.record(z.string(), z.unknown()), // JSONSchema
  checkRules: z.array(z.string()), // 提交时规则引擎预检 = 前置条件
  approvalChain: z.array(z.object({ role: z.string() })).min(1).max(3),
  /** SA：本类型显式允许发起人自审（细粒度，覆盖租户策略）。默认 undefined=随租户策略。 */
  selfApproveAllowed: z.boolean().optional(),
  /** 副作用/回写声明（additive·optional）。缺省 = 本类型尚未声明（≠ 声明为"无副作用"）。 */
  effects: ActionEffectSpecSchema.optional(),
});
export type ActionType = z.infer<typeof ActionTypeSchema>;

/**
 * ActionType 缺省版本。历史 ActionType / ActionDraft 未带版本一律视为第 1 版——
 * 见 `ActionTypeSchema.version` 注释。
 */
export const ACTION_TYPE_DEFAULT_VERSION = 1;

/** 解析有效版本（缺省 → `ACTION_TYPE_DEFAULT_VERSION`）。供类型侧与 record 侧共用一条规则。 */
export function actionTypeVersionOf(t: { version?: number } | undefined | null): number {
  return t?.version ?? ACTION_TYPE_DEFAULT_VERSION;
}

/** 单条回写目标的扁平投影（影响分析消费形态）。 */
export interface ActionWriteTarget {
  objectType: string;
  op: ActionEffectOp;
  properties: string[];
  conditional: boolean;
}

/**
 * 影响分析入口：回答「批准执行这个 Action 会写哪些对象类型的哪些属性」。
 * 纯函数、确定性（按 objectType→op 稳定排序，R6），未声明 effects → 空数组（诚实：不知道 ≠ 无副作用，
 * 由 `actionEffectCoverage` 另行区分）。
 */
export function actionWriteTargets(type: { effects?: ActionEffectSpec } | undefined | null): ActionWriteTarget[] {
  const writes = type?.effects?.writes ?? [];
  return writes
    .map((w) => ({
      objectType: w.objectType,
      op: w.op,
      properties: [...w.properties].sort(),
      conditional: w.condition !== undefined,
    }))
    .sort((a, b) => (a.objectType === b.objectType ? a.op.localeCompare(b.op) : a.objectType.localeCompare(b.objectType)));
}

/** 声明完整性（NONE = 根本没声明；PARTIAL = 声明了但自陈不全）。 */
export function actionEffectCoverage(type: { effects?: ActionEffectSpec } | undefined | null): "COMPLETE" | "PARTIAL" | "NONE" {
  return type?.effects?.coverage ?? "NONE";
}

export const ActionErrorCodes = {
  NO_ELIGIBLE_APPROVER: "NO_ELIGIBLE_APPROVER",
  INVALID_STEP: "INVALID_STEP",
  PLAN_LOCKED: "PLAN_LOCKED",
} as const;

// ---------------------------------------------------------------------------
// WO-GSIM-5-ACTION · 全局联合推演「采纳→行动写回」payload 契约（G-DECISION 行动半 / G-LOOP-FEEDBACK）
// 采纳 GlobalSim 方案 → `plan_change` Action（source:"global-sim"）→ S2 审批 → 执行回灌基线。
// additive：既有 `plan_change` payload（OrderChainView 的 {so,verdict,reason}）与其它 action 类型不受影响；
// 仅 source==="global-sim" 走真实执行器 + 回灌（物化在产 WorkOrder / 跨基地调剂 InterBaseTransfer）。
// ---------------------------------------------------------------------------

/** 采纳方案里的单个订单分配项（回灌基线的数据源·R13 provenance 溯回方案）。 */
export const GlobalSimServedItemSchema = z.object({
  orderId: z.string(),
  base: z.string(),
  baseName: z.string().optional(),
  window: z.number().int().nonnegative(),
  windowStartDay: z.number().int().nonnegative().optional(),
  qty: z.number().nonnegative(),
  model: z.string(),
});
export type GlobalSimServedItem = z.infer<typeof GlobalSimServedItemSchema>;

/** 采纳 GlobalSim 方案的 Action payload（`plan_change` · source:"global-sim"）。 */
export const GlobalSimPlanPayloadSchema = z.object({
  source: z.literal("global-sim"),
  objective: z.string(),
  servedQty: z.number().nonnegative().default(0),
  displaced: z.array(z.string()).default([]),
  summary: z.string().default(""),
  /** 采纳方案的订单分配（additive）。缺省 → 只记草稿不物化真对象（诚实降级·不臆造回灌）。 */
  served: z.array(GlobalSimServedItemSchema).optional(),
});
export type GlobalSimPlanPayload = z.infer<typeof GlobalSimPlanPayloadSchema>;

// ---------------------------------------------------------------------------
// §S3 调度器
// ---------------------------------------------------------------------------

export const ScheduledJobKindSchema = z.enum([
  "CONNECTOR_SYNC",
  "DERIVATION_FULL",
  "RULE_SCAN",
  "WORKFLOW_RUN",
  "TS_AGGREGATE",
  // M11 §3 兜底定时：每周全量校准
  "CALIBRATION_RUN",
  // 回放编排器 §6.1 A 类：真实租户定期产能预测（ServiceAccount 身份，M11 校准配对正式来源）
  "SCHEDULED_FORECAST",
  // 回放编排器 §6.1 B 类：S&OP 月度自动开启 + ①–④ 计算 + 议程（⑤ 仍人做）
  "SOP_AUTO_OPEN",
  // 回放编排器 §6.1 B 类：审批催办 → 超时升级
  "APPROVAL_REMINDER",
]);
export type ScheduledJobKind = z.infer<typeof ScheduledJobKindSchema>;

export const ScheduledJobSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  kind: ScheduledJobKindSchema,
  refId: z.string(),
  cron: z.string(),
  timezone: z.string().default("UTC"),
  nextRunAt: z.string(),
  lastRunAt: z.string().optional(),
  status: z.enum(["ACTIVE", "PAUSED"]),
  lastError: z.string().optional(),
});
export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;
