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
// WO-GSIM-5-ACTION · 全局项目推演「采纳→行动写回」payload 契约（G-DECISION 行动半 / G-LOOP-FEEDBACK）
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
// WO-SNAPSHOT-UNIT-LIE · 杠杆采纳留痕快照（`G-LEVER-SNAPSHOT-UNIT-LIE` 收口）
// ---------------------------------------------------------------------------
//
// ══ 病灶（真发生过，不是假想）══════════════════════════════════════════════════
// `DynamicLeverPanel` 的 `snapshot` prop 原本是一个**扁平结构**：
//   `{ mode, qty, capWanP50, capWanP90, mainBn }`
// 两个调用方各喂各的：
//   · `ProjectSimView`  → `capWanP50: out.capWanP50`（**万套/窗口**·真产能，对的）
//   · `RiskBoardView`   → `capWanP50: card.peak`（**张力峰值 0–100 指数**，不是产能）
// 而 `adoptCombo` 把整个 snapshot 打进 ActionDraft 的 payload，`ActionsPage` 又把
// payload 整份 JSON 打给审批人看 ⇒ **审批留痕里写着「当时产能 P50 = 97.8 万套/窗口」，
// 实际那是设备 OEE 的张力指数。审批的人看不出来。**
//
// ══ 为什么三道防线一道都没拦住 ══════════════════════════════════════════════════
//   · `check-quantile-field-naming` 守的是「一个**名字**只对应一个量纲」——
//     `capWanP50` 这个名字量纲唯一、`@unit` 写得好好的，三条判据全过。
//     它守不了「塞进这个名字的**值**是不是那个量纲」。
//   · UI 门看的是屏上的字，而这个数**不上屏**（只进 payload）。
//   · TypeScript 只查类型，两边都是 `number` —— **量纲不在类型系统里**。
// 形态（铁律 0.6 句式）：
//   **「我用『字段名的量纲唯一』当作『这个字段里的值量纲正确』的证据，而前者并不度量后者。」**
//
// ══ 修法：让「借名字」在类型层就不可能 ═══════════════════════════════════════════
// 判别式联合 —— `kind` 决定这份快照携带**哪个量纲**的量，两个量纲**不共用任何字段名**：
//   · `capacity_forecast` → `capWanP50/capWanP90`（万套/窗口）
//   · `risk_tightness`    → `tightnessPeak`（张力指数 0–100·无量纲）
// 张力峰值本身**是有意义的量**，问题只是它借了别人的名字 ⇒ 给它自己的名字，照记不误。
// 两个分支都 `.strict()`：往张力快照里塞 `capWanP50` ⇒ **运行时当场炸**，不是静默通过。
// 这条比类型检查更要紧 —— payload 是 `Record<string, unknown>` 过一手的，类型在那儿断了。
//
// ⛔ **不许在这里为「兼容旧形状」留一个扁平分支** —— 那就是第二真相源，等于把病放回来。
// 历史留痕（已落库的旧 payload）**一律不改写**（R4：ActionDraft 是审批面，改写 = 伪造审批记录）；
// 它们靠「**没有 `kind` 字段**」自证是旧形状 ⇒ 见下方 `isLegacyUnitUnsafeSnapshot`。

/** 产能推演快照：真产能数，量纲 **万套/窗口**（与 `capacity_forecast` 输出同轴）。 */
export const CapacityForecastSnapshotSchema = z
  .object({
    kind: z.literal("capacity_forecast"),
    /** 推演模式（`ProjectSimView` 的 mode 透传·非量纲字段）。 */
    mode: z.string(),
    /** 需求量。@unit 万套 */
    qty: z.number(),
    /** 窗口内产能中位口径。@unit 万套/窗口 */
    capWanP50: z.number(),
    /** 窗口内产能承诺口径。@unit 万套/窗口 */
    capWanP90: z.number(),
    /** 主瓶颈名。 */
    mainBn: z.string(),
    /** 基线缺口（`adoptCombo` 打进 payload 时补）。@unit 万套/窗口 */
    baselineGap: z.number().optional(),
  })
  .strict();
export type CapacityForecastSnapshot = z.infer<typeof CapacityForecastSnapshotSchema>;

/**
 * 风险张力快照：**张力峰值**，量纲 **张力指数（0–100·无量纲）**，不是产能。
 *
 * ⚠️ 这里**刻意没有** `capWanP50/capWanP90` —— 产能页在拨杠杆那一刻手上只有张力曲线
 * （`card.peak`），**拿不到真产能数**。红线：宁可少记，不许记假的。
 * 想在留痕里同时看到真产能 ⇒ 得先把 `capacity_forecast` 真调一次，那是另一件事，
 * **不许**拿手边这个 0–100 的数去顶替。
 */
export const RiskTightnessSnapshotSchema = z
  .object({
    kind: z.literal("risk_tightness"),
    /** 推演模式（产能页固定 "capacity"·非量纲字段）。 */
    mode: z.string(),
    /** 窗口内张力峰值。@unit 张力指数(0-100·无量纲) */
    tightnessPeak: z.number(),
    /** 主瓶颈/首要因子名。 */
    mainBn: z.string(),
    /** 基线缺口（`adoptCombo` 打进 payload 时补）。@unit 张力指数(0-100·无量纲) */
    baselineGap: z.number().optional(),
  })
  .strict();
export type RiskTightnessSnapshot = z.infer<typeof RiskTightnessSnapshotSchema>;

/** 杠杆采纳留痕快照（判别式联合·`kind` 决定量纲）。 */
export const LeverAdoptSnapshotSchema = z.discriminatedUnion("kind", [
  CapacityForecastSnapshotSchema,
  RiskTightnessSnapshotSchema,
]);
export type LeverAdoptSnapshot = z.infer<typeof LeverAdoptSnapshotSchema>;

/**
 * **写进审批留痕之前**的运行时量纲断言 —— 这是本次收口的「机器先说话」那一层。
 *
 * 为什么运行时这一道不能省（类型检查顶不上）：`ActionDraft.payload` 的类型是
 * `Record<string, unknown>`，值一旦进去，TS 就什么都不知道了；而 payload 是**审批面**，
 * 写错的代价是「审批的人照着一个假数签了字」。所以判据必须落在**运行期**，
 * 且必须在**写 payload 那一刻**（不是读的时候——读的时候已经签完字了）。
 *
 * 抛错而非静默降级：塞错量纲 ⇒ 采纳按钮当场失败，用户看得见。
 * **静默吞掉才是这个病的原样复发**（原病灶正是「没人报错、一路绿到审批页」）。
 */
export function assertLeverAdoptSnapshot(snapshot: unknown): LeverAdoptSnapshot {
  const r = LeverAdoptSnapshotSchema.safeParse(snapshot);
  if (!r.success) {
    throw new Error(
      `杠杆采纳留痕快照量纲校验不通过（拒绝把量纲存疑的数写进审批留痕）：${r.error.issues
        .map((i) => `${i.path.join(".") || "<root>"} ${i.message}`)
        .join(" · ")}`,
    );
  }
  return r.data;
}

/**
 * 旧形状识别（**只读不改**）：`G-LEVER-SNAPSHOT-UNIT-LIE` 收口**之前**落库的留痕
 * 没有 `kind` 判别字段，其 `capWanP50/capWanP90` 的量纲**无凭**——
 * 产能页来的那批装的其实是张力指数（0–100），项目推演页来的那批才是真产能。
 *
 * 用途只有一个：**把「不知道」显式说出来**，而不是让读者默认它是万套/窗口。
 * ⛔ 绝不据此改写历史 payload（R4：ActionDraft 是审批面，改写 = 伪造审批记录）。
 */
export function isLegacyUnitUnsafeSnapshot(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const s = snapshot as Record<string, unknown>;
  if (typeof s.kind === "string") return false; // 新形状：量纲由 kind 自证
  return "capWanP50" in s || "capWanP90" in s;
}

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
