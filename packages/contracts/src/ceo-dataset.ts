import { z } from "zod";

/**
 * WO-CEO-DATA-2 · CEO 驾驶舱原子颗粒数据集生成契约。
 *
 * 核心纪律：
 * - 只产原子颗粒（order_line / competitor_share / ar_invoice / demand_base_period / segment_period …），
 *   绝不输出预聚合 KPI（如单一「营收 700 亿」记录）。驾驶舱数字必须能通过对原子颗粒求和/加权平均
 *   精确复现（back-derivation）。
 * - 每颗颗粒携带完整维度（tenant_id / base / product / segment / period / scenario），
 *   使任何 rollup 都可从颗粒重新算回。
 * - 所有数值由确定性种子派生（R6），同 (tenant, seed, scenario) 重跑字节一致。
 * - 合成数据诚实标 provenanceSynthetic=true，不冒充实测（KILL-MOCK-RED）。
 */

export const CEO_DATASET_METRICS = [
  "market_share",
  "revenue",
  "cash",
  "demand_attain",
  "seg_attain",
  "gross_profit",
] as const;
export type CeoDatasetMetricKey = (typeof CEO_DATASET_METRICS)[number];

export const CeoDatasetGenerateRequestSchema = z.object({
  tenantId: z.string().min(1),
  /** 确定性种子（R6）。缺省 42。 */
  seed: z.number().int().optional(),
  /** 情景键（如 baseline / conservative / aggressive）。缺省 actual。 */
  scenario: z.string().optional(),
  /** 期间（如 2026-Q2 / 2026-06）。缺省由生成器根据种子决定。 */
  period: z.string().optional(),
  /** 规模影响颗粒数（S=少量演示 / XL=工业级）。缺省 S。 */
  scale: z.enum(["S", "M", "L", "XL"]).optional(),
});
export type CeoDatasetGenerateRequest = z.infer<typeof CeoDatasetGenerateRequestSchema>;

/** 单颗原子颗粒：CEO 驾驶舱某指标的最细可 roll-up 记录。 */
export const CeoAtomicGrainSchema = z.object({
  tenantId: z.string(),
  metricKey: z.enum(CEO_DATASET_METRICS),
  /** 颗粒类型（语义说明这不是聚合值）。 */
  grainType: z.string(),
  /** 颗粒业务主键。 */
  grainId: z.string(),
  /** 期间维度。 */
  period: z.string(),
  /** 情景维度。 */
  scenario: z.string(),
  /** 基地维度（可选，因有些颗粒无基地）。 */
  base: z.string().optional(),
  /** 产品维度（可选）。 */
  product: z.string().optional(),
  /** 应用细分维度（可选）。 */
  segment: z.string().optional(),
  /** 颗粒数值（可直接参与 rollup）。 */
  value: z.number(),
  /** 数值单位。 */
  valueUnit: z.string(),
  /** 比例型指标（达成率/份额）的分子，用于加权平均复现。 */
  numerator: z.number().optional(),
  /** 比例型指标的分母，用于加权平均复现。 */
  denominator: z.number().optional(),
  /** 扩展维度包（保留其他切片/下钻维度）。 */
  dimensions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  /** 合成来源诚实标记。 */
  provenanceSynthetic: z.boolean(),
});
export type CeoAtomicGrain = z.infer<typeof CeoAtomicGrainSchema>;

export const CeoMetricSummarySchema = z.object({
  count: z.number().int(),
  sum: z.number(),
  avg: z.number(),
  unit: z.string(),
  /** 从原子颗粒复现出的 KPI 值（= sum(value*weight)/sum(weight) 或 sum(value)）。 */
  kpiValue: z.number(),
  /** 比例型指标复现时分母之和。 */
  denominatorSum: z.number().optional(),
});
export type CeoMetricSummary = z.infer<typeof CeoMetricSummarySchema>;

export const CeoDatasetSchema = z.object({
  tenantId: z.string(),
  seed: z.number().int(),
  scenario: z.string(),
  period: z.string(),
  generatedAt: z.string(),
  metrics: z.array(z.enum(CEO_DATASET_METRICS)),
  grains: z.array(CeoAtomicGrainSchema),
  /** 由 grains 实时派生，非预聚合存储。 */
  byMetric: z.record(z.string(), CeoMetricSummarySchema),
});
export type CeoDataset = z.infer<typeof CeoDatasetSchema>;

/** 生成报告（可用于端点返回或持久化元数据）。 */
export const CeoDatasetReportSchema = z.object({
  tenantId: z.string(),
  seed: z.number().int(),
  scenario: z.string(),
  period: z.string(),
  totalGrains: z.number().int(),
  metricKeys: z.array(z.enum(CEO_DATASET_METRICS)),
});
export type CeoDatasetReport = z.infer<typeof CeoDatasetReportSchema>;
