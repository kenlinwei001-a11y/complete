import { z } from "zod";

/**
 * 方法库·随机模拟族契约（METHOD-MC-STOCHASTIC · 行业无关 · 零业务常数 R14）。
 * 与 §J 优化融合域（opt-template.ts）同居「方法库」——规则库=闸门（判定），方法库=引擎（计算）。
 * 本体登记见 SYSTEM-ONTOLOGY.md §J / §3 随机模拟链路 / §7 method-determinism:check / §8（G-12）。
 * 落地规格见 docs/PRD-method-library-stochastic-mc.md（契约/SolverParam/MC 算法/分布族/方向约定）。
 *
 * 关键（R14）：模板只认抽象 (role, distribution, dispersionParamKey)——无任何行业实体名。
 * yield/oee 是**角色**，绑定进来（MethodBinding）才成为某行业的 `Process.yield`。离散度不内联，
 * 落 SolverParam（可被 CALIBRATION_SWEEP 校准——越用越准也调方差模型，非仅点估计）。
 */

// 分布族（PRD 附录 A · 各配单测）
export const DistributionFamilySchema = z.enum(["normal", "lognormal", "triangular", "beta", "uniform"]);
export type DistributionFamily = z.infer<typeof DistributionFamilySchema>;

/** 不确定因子（抽象角色 · 离散度键名指向 SolverParam · 值不内联） */
export const UncertainFactorSchema = z.object({
  role: z.string(), // 抽象角色："yield"|"oee"|"availability"|"attendance"|"utilization"…（非电池实体名）
  distribution: DistributionFamilySchema,
  dispersionParamKey: z.string(), // 离散度的 SolverParam 键名（如 "mc.dispersion.yield"）
  clamp: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
});
export type UncertainFactor = z.infer<typeof UncertainFactorSchema>;

/** 随机模拟族模板（抽象 · 全代码库零行业实体名） */
export const StochasticMethodTemplateSchema = z.object({
  key: z.string(), // 如 "capacity_mc"
  family: z.literal("stochastic"), // 方法库家族判别
  method: z.literal("monte_carlo"),
  uncertainFactors: z.array(UncertainFactorSchema).min(1),
  aggregate: z.enum(["sum", "min", "product"]), // 单元样本→场景总量的聚合口径
  percentiles: z.array(z.number().min(0).max(100)).min(1), // 要出哪些分位·如 [10,50,90]
  iterations: z.number().int().positive(), // 默认迭代数 N（精确·如 2000）
  provenance: z.object({ derivedFrom: z.string(), license: z.string() }),
  status: z.enum(["ACTIVE", "PROVISIONAL"]),
});
export type StochasticMethodTemplate = z.infer<typeof StochasticMethodTemplateSchema>;

/** 绑定（复用 OntologyBinding 形态）：role→本体类型.属性 + DF.8 接地 */
export const MethodBindingSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  methodKey: z.string(), // → StochasticMethodTemplate.key
  roleBindings: z.array(
    z.object({
      role: z.string(),
      bind: z.object({ kind: z.enum(["objectProp"]), ref: z.string() }), // 如 "Process.yield"
    }),
  ),
  status: z.enum(["DRAFT", "ACTIVE"]),
});
export type MethodBinding = z.infer<typeof MethodBindingSchema>;

/** MC 预测结果（R13：method/iterations/seed/dispersionSource 全带·前端悬浮出「真实分位」） */
export const McForecastResultSchema = z.object({
  p10: z.number(),
  p50: z.number(),
  p90: z.number(),
  method: z.enum(["monte_carlo", "point_estimate"]),
  iterations: z.number().int(),
  seed: z.number().int(),
  dispersionSource: z.string(), // R13：如 "SolverParam(mc.dispersion.*) v7"
  percentiles: z.record(z.string(), z.number()), // {"p10":…,"p50":…,"p90":…}
});
export type McForecastResult = z.infer<typeof McForecastResultSchema>;
