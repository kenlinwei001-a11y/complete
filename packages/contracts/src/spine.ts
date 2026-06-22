import { z } from "zod";

/**
 * 经营目标-指标-责任闭环骨架（Goal–Metric–Owner Spine，PRD-goal-metric-owner-spine）。
 * 把"目标→KSF→子目标→指标(目标vs实际)→数据源&责任人"串成一等对象绑定脊柱，作为各视图 KPI 的
 * 单一出处（R-一致），是 cockpit `PlanKpi` / audit·generate `KsfGraph` / 各处 owner 的归一载体。
 * 落库走 ObjectInstance（synthetic 绿地类型，R9 免新表，与 cockpit 对象一致）；Metric 是派生投影非新真值（R13）。
 */

/** KSF 关键成功要素（决策域，HTML 五要素口径）。 */
export const KSF_KEYS = ["k_dem", "k_bal", "k_kit", "k_cash", "k_cost"] as const;
export const KsfSchema = z.object({
  ksfId: z.string(),
  key: z.enum(KSF_KEYS),
  name: z.string(), // 需求结构 / 产销爬坡 / 物料齐套 / 信用现金 / 成本外协
  sub: z.string().default(""),
  tenantId: z.string().optional(),
});
export type Ksf = z.infer<typeof KsfSchema>;

/** 责任人/责任主体（收编 owner 字符串 + 域签 ownerUserId）。 */
export const PRINCIPAL_KINDS = ["org", "role", "person"] as const;
export const PrincipalSchema = z.object({
  principalId: z.string(),
  name: z.string(),
  kind: z.enum(PRINCIPAL_KINDS),
  parentRef: z.string().nullable().default(null),
  tenantId: z.string().optional(),
});
export type Principal = z.infer<typeof PrincipalSchema>;

/**
 * 指标库一等对象（目标 vs 实际达成的单一出处）。target 取自目标树(PlanTarget)、actual 算自数据源派生，
 * delta/miss 纯函数派生——任一视图引用同一 Metric 即同值（R-一致）；cockpit PlanKpi = Metric 的 plan 域投影。
 */
export const METRIC_LEVELS = ["op", "month", "quarter", "year"] as const;
export const MetricSchema = z.object({
  metricId: z.string(),
  key: z.string(),
  name: z.string(),
  unit: z.string().default(""),
  level: z.enum(METRIC_LEVELS),
  category: z.string().default(""), // profit/scale/material/cash… (= cockpit PlanKpi.category)
  target: z.number(),
  actual: z.number(),
  delta: z.number().optional(), // 派生：actual − target
  miss: z.boolean().optional(), // 派生：是否越线（actual < floorVal 或 < target，按方向）
  floorVal: z.number().optional(),
  weight: z.number().optional(),
  dataSourceRef: z.string().nullable().default(null), // → Connection
  ksfRef: z.string().nullable().default(null), // → KSF
  ownerRef: z.string().nullable().default(null), // → Principal
  chainKey: z.string().optional(), // → RootCauseChain（越线根因装配）
  asOf: z.string().optional(),
  ruleRefs: z.array(z.string()).default([]),
  tenantId: z.string().optional(),
});
export type Metric = z.infer<typeof MetricSchema>;

/** metric_rollup 求解器输出：对象库聚合 actual + 对齐 PlanTarget target → 算 delta/miss（确定性 R6）。 */
export const MetricRollupOutputSchema = z.object({
  metrics: z.array(MetricSchema),
  missCount: z.number().int(),
  byLevel: z.record(z.string(), z.number()),
  summary: z.string(),
});
export type MetricRollupOutput = z.infer<typeof MetricRollupOutputSchema>;
