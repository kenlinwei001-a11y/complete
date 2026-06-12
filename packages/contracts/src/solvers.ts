import { z } from "zod";

// ---------------------------------------------------------------------------
// 求解器增量 PRD §S1：真实算法的 IO 契约（前端逐基地下钻表等直接消费）
// 数值常数一律来自场景包 solverParams 配置，代码不得写死。
// ---------------------------------------------------------------------------

/** S1.2 capacity_forecast 输出 */
export const PerBaseRowSchema = z.object({
  base: z.string(),
  weeklyCap: z.number(),
  certFactor: z.number(), // 认证中 0.6 / 量产 1.0
  maintWeek: z.number().int().nullable(),
  bottleneck: z.string(),
  tightness: z.number(),
  cumTotal: z.number(),
});
export type PerBaseRow = z.infer<typeof PerBaseRowSchema>;

export const CapacityForecastOutputSchema = z
  .object({
    p50: z.number(),
    p90: z.number(),
    healthFactor: z.number(), // 默认 0.93；数据源延迟>2h 降 0.90（C09）
    gap: z.number(),
    ok: z.boolean(),
    perBaseRows: z.array(PerBaseRowSchema),
    batchRows: z
      .array(
        z.object({
          qty: z.number(),
          dueDate: z.string(),
          wkEff: z.number().int(),
          cumDemand: z.number(),
          cumP90: z.number(),
          ok: z.boolean(),
        }),
      )
      .optional(),
    mainBn: z.string(),
    pendingCertList: z.array(z.string()),
    degradeNote: z.string().optional(), // C09 降级说明
  })
  .catchall(z.unknown());
export type CapacityForecastOutput = z.infer<typeof CapacityForecastOutputSchema>;

/** S1.3 bottleneck_matrix 输出 */
export const BottleneckMatrixOutputSchema = z.object({
  dataMode: z.enum(["LIVE", "MOCK"]),
  factors: z.array(z.string()), // 7 因素固定枚举
  rows: z.array(
    z.object({
      base: z.string(),
      tightness: z.record(z.string(), z.number()), // 因素 → 0–100
      primary: z.string(),
    }),
  ),
});
export type BottleneckMatrixOutput = z.infer<typeof BottleneckMatrixOutputSchema>;

/** S1.4 risk_timeline 输出 */
export const RiskEventSchema = z.object({
  type: z.enum(["maint_window", "delivery_peak", "arrival_gap"]),
  day: z.number().int(),
  amp: z.number(),
  factors: z.array(z.string()),
});
export const RiskCardSchema = z.object({
  base: z.string(),
  factor: z.string(),
  peak: z.number(),
  crossDay: z.number().int().nullable(), // 越线日（首个 ≥85）
  series: z.array(z.number()), // 逐日 tension
  events: z.array(RiskEventSchema),
  affectedOrders: z.array(z.record(z.string(), z.unknown())).optional(),
  mitigated: z
    .object({ series: z.array(z.number()), appliedPlan: z.string(), effectiveFrom: z.number() })
    .optional(),
});
export const RiskTimelineOutputSchema = z.object({
  horizon: z.number().int(),
  threshold: z.number(), // 默认 85
  cards: z.array(RiskCardSchema).max(8),
});
export type RiskTimelineOutput = z.infer<typeof RiskTimelineOutputSchema>;

/** S1.6 plan_audit */
export const PlanAuditInputSchema = z.object({
  dem: z.number(),
  seg_pas: z.number(),
  seg_ess: z.number(),
  seg_com: z.number(),
  sup: z.number(),
  ltaCov: z.number(),
  kitGap: z.number(),
  gmTarget: z.number(),
  cashCushion: z.number(),
  capex: z.number(),
});
export type PlanAuditInput = z.infer<typeof PlanAuditInputSchema>;

export const AuditItemSchema = z.object({
  id: z.string(), // X01… / R01…
  title: z.string(),
  ruleRef: z.string().optional(),
  why: z.string(), // 含代入数值的解释文本
  fix: z
    .object({ label: z.string(), patch: z.record(z.string(), z.number()) })
    .optional(),
});
export const PlanAuditOutputSchema = z.object({
  H: z.array(AuditItemSchema),
  M: z.array(AuditItemSchema),
  S: z.array(AuditItemSchema),
  score: z.number(), // clamp(100 − 25|H| − 8|M|, 0, 100)
  verdict: z.enum(["通过", "有条件通过", "不通过"]),
});
export type PlanAuditOutput = z.infer<typeof PlanAuditOutputSchema>;

/** S1.7 plan_generate */
export const GenSchemeSchema = z.object({
  no: z.string(), // 方案编号
  name: z.string(),
  pathKey: z.string(), // A–E
  outcome: z.object({
    rev: z.number(),
    gm: z.number(),
    share: z.number(),
    turns: z.number(),
    cash: z.number(),
    capex: z.number(),
  }),
  scores: z.object({
    profit: z.number(),
    scale: z.number(),
    cash: z.number(),
    growth: z.number(),
    stability: z.number(),
    total: z.number(),
  }),
  hardViol: z.array(z.string()),
  gain: z.array(z.string()),
  give: z.array(z.string()),
  problems: z.array(z.record(z.string(), z.unknown())),
});
export const PlanGenerateOutputSchema = z.object({
  schemes: z.array(GenSchemeSchema).length(3), // 稳健/均衡/进取
  recommend: z.string(), // hardViol 为空者中 total 最高
});
export type PlanGenerateOutput = z.infer<typeof PlanGenerateOutputSchema>;

/** S1.8 sop_balance 版本状态机 */
export const SopVersionStatusSchema = z.enum(["DRAFT", "IN_REVIEW", "EXEC_MEETING", "FINAL"]);
export type SopVersionStatus = z.infer<typeof SopVersionStatusSchema>;

/** 场景包 solverParams（全部常数配置化；battery 默认值见 PRD 增量 §S1） */
export const SolverParamsSchema = z.record(z.string(), z.unknown());
export type SolverParams = z.infer<typeof SolverParamsSchema>;
