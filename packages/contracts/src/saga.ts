import { z } from "zod";
import { IsoTime } from "./common.js";

// ═══════════════════════════════════════════════════════════════════════════
// WO-L1B-SAGA · 跨系统 Saga 一致性契约（外部幂等键 + 对账补偿 + 部分失败重放）
// PRD: docs/PRD-L1B-execution-planner-workflow-runtime.md §8 WO-L1B-SAGA · NG2 · R4
//
// 边界（NG2/R4·钉死）：本期补偿只保**本系统内可逆步 + 跨系统已确证落地步**一致；出站真实
// 效果的反向动作**必经 S2 Action 审批**（`domainExecutor`·EXECUTED 才落·绝不静默反转真实世界）；
// 不可逆 / 对账不确定步**诚实记录 `compensated=false` / RECONCILIATION_PENDING**（不伪装"已补偿"·
// KILL-MOCK-RED）。外部系统契约（MES/ERP/WMS）为**真实有状态沙盘**驱动（非 mock 冒充·真去重真对账）。
//
// R1 contracts-only-shared · R2 tenant everywhere · R6 确定性（幂等键纯派生·无 Date.now/随机/LLM）。
// ═══════════════════════════════════════════════════════════════════════════

/** 出站目标外部系统（真实契约依赖·簇① V2-7-142）。 */
export const ExternalSystemSchema = z.enum(["MES", "ERP", "WMS"]);
export type ExternalSystem = z.infer<typeof ExternalSystemSchema>;

// ── 出站 Saga 步（一条跨系统事务链中的一个出站步·内嵌节点溯源）──────────────
export const OutboundSagaStepSchema = z.object({
  /** 对应 DAG 节点 id（R13 溯源·补偿反向序基线）。 */
  nodeId: z.string(),
  externalSystem: ExternalSystemSchema,
  /** 外部系统操作名（如 "create_work_order" / "post_goods_movement"）。 */
  operation: z.string(),
  /** 出站净荷（对账与幂等键派生的确定性输入·净荷哈希入键·R6）。 */
  payload: z.record(z.string(), z.unknown()).default({}),
  /**
   * 确定性外部幂等键（tenantId+taskId+nodeId+payload 哈希·R6）——同键重放绝不二次出站。
   * 缺省由 `deriveIdempotencyKey` 派生；显式给定用于跨进程续跑对齐。
   */
  idempotencyKey: z.string().optional(),
});
export type OutboundSagaStep = z.infer<typeof OutboundSagaStepSchema>;

// ── 幂等落库记录（saga 侧对"已提交何键"的 durable 记录·续跑跳过基线·审计）─────
export const IdempotencyRecordSchema = z.object({
  key: z.string(), // 外部幂等键
  tenantId: z.string(), // R2 谓词随身
  taskId: z.string(),
  nodeId: z.string(),
  externalSystem: ExternalSystemSchema,
  operation: z.string(),
  /** APPLIED=外部确证落地；FAILED=出站失败（未落地·可安全重放）。 */
  status: z.enum(["APPLIED", "FAILED"]),
  /** 外部系统回执引用（no-secrets·仅 ref·不回显净荷明文）。 */
  externalRef: z.string().nullable().default(null),
  submittedAt: IsoTime,
});
export type IdempotencyRecord = z.infer<typeof IdempotencyRecordSchema>;

// ── 对账结果（查询外部系统按幂等键的真实落地态·补偿据此·绝不盲反转）────────────
export const ReconciliationStatusSchema = z.enum([
  "APPLIED", // 外部账本确有该键（真落地）→ 可补偿
  "NOT_FOUND", // 外部账本无该键（未落地）→ 无需补偿（never blind-reverse）
  "REVERSED", // 已反转（补偿已提交并被外部确认）
  "UNCERTAIN", // 对账查询本身不可达/歧义 → 诚实挂起（RECONCILIATION_PENDING）
]);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;
export const ReconciliationOutcomeSchema = z.object({
  key: z.string(),
  /** true=外部确证落地（存在于外部账本·可补偿）。 */
  landed: z.boolean(),
  status: ReconciliationStatusSchema,
  externalRef: z.string().nullable().default(null),
  detail: z.string().optional(),
});
export type ReconciliationOutcome = z.infer<typeof ReconciliationOutcomeSchema>;

// ── 单出站步执行结果 ──────────────────────────────────────────────────────
export const SagaStepOutcomeSchema = z.object({
  nodeId: z.string(),
  key: z.string(),
  externalSystem: ExternalSystemSchema,
  operation: z.string(),
  /** SUBMITTED=本次真出站落地；SKIPPED_ALREADY_APPLIED=对账证已落地→跳过不二次出站（重放）；
   *  FAILED=真出站失败（部分失败点·未落地）。 */
  action: z.enum(["SUBMITTED", "SKIPPED_ALREADY_APPLIED", "FAILED"]),
  externalRef: z.string().nullable().default(null),
  detail: z.string().optional(),
});
export type SagaStepOutcome = z.infer<typeof SagaStepOutcomeSchema>;

// ── 单出站步补偿结果（反向序·经 S2·对账驱动·诚实不伪装）────────────────────
export const SagaCompensationOutcomeSchema = z.object({
  nodeId: z.string(),
  key: z.string(),
  /** true=反向动作经 S2 提交并外部确认（EXECUTED 才落·非静默）；false=不可逆/无钩子/对账未确证（诚实）。 */
  compensated: z.boolean(),
  reconciliation: ReconciliationOutcomeSchema,
  reason: z.string().optional(),
});
export type SagaCompensationOutcome = z.infer<typeof SagaCompensationOutcomeSchema>;

// ── Saga 运行态（durable·部分失败重放基线·R2 tenant）──────────────────────
export const SagaRunStatusSchema = z.enum([
  "RUNNING",
  "COMPLETED", // 全部出站步落地
  "PARTIAL_FAILURE", // 中途失败（已落地步 + 未落地步并存·可重放/可补偿）
  "COMPENSATING",
  "COMPENSATED", // 已落地步经对账 + S2 全部反转（可逆步）
  "RECONCILIATION_PENDING", // 存在不可逆/对账不确定步 → 诚实挂起（不伪装已补偿）
]);
export type SagaRunStatus = z.infer<typeof SagaRunStatusSchema>;
export const SagaRunStateSchema = z.object({
  sagaId: z.string(),
  tenantId: z.string(),
  taskId: z.string(),
  status: SagaRunStatusSchema,
  steps: z.array(SagaStepOutcomeSchema).default([]),
  compensations: z.array(SagaCompensationOutcomeSchema).default([]),
  /** 部分失败点节点 id（重放从此后续步续跑·已落地步跳过·R6）。 */
  failedAtNode: z.string().nullable().default(null),
  resumedCount: z.number().int().default(0),
  startedAt: IsoTime,
  updatedAt: IsoTime,
});
export type SagaRunState = z.infer<typeof SagaRunStateSchema>;
