import { z } from "zod";
import { IsoTime } from "./common.js";

/**
 * 需求拉动的自成长发动机（PRD-demand-pulled-growth-engine）· P1 契约。
 * GapReport = QOS 缺口探针把"客户问句真跑一遍 orchestrator"后捕获的结构化缺口（§5 分类法）。
 */

/** §5 缺口分类法（法定枚举，与 PRD 一一对应）。 */
export const GapCodeSchema = z.enum([
  "ANSWERABLE", // 无缺口：全链实跑通、VERIFIED 答案
  "NO_INTENT", // 分类无候选命中（无意图覆盖该问句）
  "NO_PLAN", // 命中意图但无执行计划（PLAN_NOT_FOUND）
  "NO_SLICE", // resolve_slice 未注册/解析失败
  "EMPTY_DATA", // 切片/查询返回空集（对象类型在、数据无）
  "NO_RULE", // evaluate_rules 引用规则不存在
  "SOLVER_NOT_FOUND", // invoke_solver 求解器未注册
  "SHAPE_MISMATCH", // 渲染绑定字段不在求解器输出形状（G-2）
  "NO_CAPABILITY", // 需要本体/求解器根本没有的领域能力 → 需开发
  "OTHER", // 未归类的内部错误
]);
export type GapCode = z.infer<typeof GapCodeSchema>;

export const GapFindingSchema = z.object({
  gapCode: GapCodeSchema,
  /** 断在哪一步（stepId / classify / render …）。 */
  atStep: z.string().optional(),
  /** 实跑证据（错误码/消息/分类摘要）。 */
  evidence: z.string(),
  /** 建议补法（数据合成 / 建切片 / generic-inference 兜底 / 需开发工单 …）。 */
  suggestedFill: z.string(),
  /** 是否阻塞答案（true=问句答不出）。 */
  blocking: z.boolean(),
});
export type GapFinding = z.infer<typeof GapFindingSchema>;

export const GapReportSchema = z.object({
  question: z.string(),
  taskId: z.string(),
  /** 终态：可答 / 边界收敛(仅剩缺功能) / 答不出。 */
  verdict: z.enum(["ANSWERABLE", "BLOCKED", "BOUNDARY"]),
  /** QOS 实跑路径（WORKFLOW=本体内验证 / AGENT=本体外探索 / NONE=未路由）。 */
  path: z.enum(["WORKFLOW", "AGENT", "NONE"]),
  findings: z.array(GapFindingSchema),
  generatedAt: IsoTime,
});
export type GapReport = z.infer<typeof GapReportSchema>;

/**
 * 自成长发动机 P3 · LOOP：探针→补齐→重跑→收敛（K 有界）。
 * 收敛终态（PRD §8）：CONVERGED（出可验证答案）/ BOUNDARY（仅剩缺功能工单）/ MAX_ROUNDS（未收敛）。
 */
/** scaffold 出的 DRAFT 制品（A3 真补：自动建骨架但不发布 R4）。 */
export const ScaffoldDraftSchema = z.object({ kind: z.string(), key: z.string() });
export type ScaffoldDraft = z.infer<typeof ScaffoldDraftSchema>;

export const GrowthFillResultSchema = z.object({
  gapCode: GapCodeSchema,
  /** 补法（fill-data 真人正门 / scaffold 切片·规则·意图 / generic-inference 兜底 / ticket 需开发）。 */
  action: z.string(),
  /** 本轮补齐是否推进了链路（用于归因；同类一次补、跨类逐轮）。 */
  advanced: z.boolean(),
  /** 缺功能 → 需开发工单（带 I/O 契约线索）。 */
  ticket: z.object({ gapCode: GapCodeSchema, detail: z.string() }).optional(),
  /** A3 真补：本轮自动 scaffold 出的 DRAFT 制品（如绑 generic_inference 的执行计划骨架）。 */
  scaffolded: z.array(ScaffoldDraftSchema).optional(),
  /** DF.9 真人正门 HARD/SOFT 分流：HARD 缺数据（涉真实业务实体，合成会造业务事实）→ 不静默合成、出精确 DataRequest 经真人正门补。 */
  fillMode: z.enum(["HARD", "SOFT"]).optional(),
  dataRequest: z
    .object({
      typeKey: z.string(),
      columns: z.array(z.string()),
      entities: z.array(z.string()),
      reason: z.string(),
    })
    .optional(),
});
export type GrowthFillResult = z.infer<typeof GrowthFillResultSchema>;
export type DataRequest = NonNullable<GrowthFillResult["dataRequest"]>;

export const GrowthRoundSchema = z.object({
  round: z.number().int(),
  gapReport: GapReportSchema,
  fillApplied: GrowthFillResultSchema.optional(),
});
export type GrowthRound = z.infer<typeof GrowthRoundSchema>;

export const GrowthRunReportSchema = z.object({
  question: z.string(),
  maxRounds: z.number().int(),
  rounds: z.array(GrowthRoundSchema),
  terminalState: z.enum(["CONVERGED", "BOUNDARY", "MAX_ROUNDS"]),
  openTickets: z.array(z.object({ gapCode: GapCodeSchema, detail: z.string() })),
  generatedAt: IsoTime,
});
export type GrowthRunReport = z.infer<typeof GrowthRunReportSchema>;

/**
 * P4 · 成长账本条目（demand-indexed）：每个客户问题一条——问题→缺口→补法→终态→工单。
 * 用于发现盲区(高频缺口=优先建)、量化覆盖度演进、待开发 backlog 100% 需求拉动。
 */
export const GrowthLedgerEntrySchema = z.object({
  id: z.string(), // glr_
  tenantId: z.string(),
  report: GrowthRunReportSchema,
  createdAt: IsoTime,
});
export type GrowthLedgerEntry = z.infer<typeof GrowthLedgerEntrySchema>;

/**
 * P4 · 成长工单（厂商中立施工契约，PRD §7.1）：缺功能→带 I/O 契约的需开发工单，
 * 经 MCP/CLI 交任意 code agent 施工。状态机 OPEN→IN_PROGRESS→IN_REVIEW→MERGED→VERIFIED。
 */
export const GrowthTicketStatusSchema = z.enum(["OPEN", "IN_PROGRESS", "IN_REVIEW", "MERGED", "VERIFIED"]);
export type GrowthTicketStatus = z.infer<typeof GrowthTicketStatusSchema>;

export const GrowthTicketSchema = z.object({
  id: z.string(), // gtk_
  tenantId: z.string(),
  fromQuestion: z.string(),
  gapCode: GapCodeSchema,
  /** I/O 契约线索：需要的输入字段 + 渲染要的输出键（求解器骨架的签名来源）。 */
  ioContract: z.object({ inputs: z.array(z.string()), outputShape: z.array(z.string()) }),
  /** 本体引用（施工 agent 读本体定位）。 */
  ontologyRefs: z.object({ objectTypes: z.array(z.string()), slices: z.array(z.string()), rules: z.array(z.string()) }),
  /** 验收线索（问句应能答 + 应过门禁）。 */
  acceptance: z.string(),
  status: GrowthTicketStatusSchema,
  /** 认领者（任意 code agent，厂商中立）。 */
  assignee: z.string().optional(),
  /** A3 真补：开工单前已自动 scaffold 的 DRAFT 制品 → 施工从"零开发"降为"审批发布/补全参数"。 */
  scaffoldedDrafts: z.array(ScaffoldDraftSchema).optional(),
  createdAt: IsoTime,
});
export type GrowthTicket = z.infer<typeof GrowthTicketSchema>;
