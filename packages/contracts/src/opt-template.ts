import { z } from "zod";

/**
 * 优化求解器融合契约（增量 0 · 行业无关 · 零业务常数 R14）。
 * 本体登记见 SYSTEM-ONTOLOGY.md §2.D4 / §3 / §7 / §8（G-12）；落地规格见
 * docs/SPEC-optimization-template-pool.md（§1 模板池 / §2 绑定层 / §4 what-if）。
 * 许可证红线见 THIRD-PARTY-NOTICES.md（MIT 署名 / CDLA 取派生 Results / 不碰 Gurobi / 不训练）。
 *
 * 关键：模板只认抽象 (role, vtype, constraintFamily, 数值参数)——无任何行业实体名。
 * 供应链/医疗/能源是"绑定进来的内容"（OntologyBinding），不是代码。
 */

// ── 抽象优化模板（SPEC §1 · 零业务常数） ─────────────────────────────────────
export const OptTemplateFamilySchema = z.enum([
  "facility_location",
  "min_cost_flow",
  "set_cover",
  "independent_set",
  "assignment",
  "scheduling",
  "knapsack",
  "packing",
  "combinatorial_auction",
  "custom",
]);
export type OptTemplateFamily = z.infer<typeof OptTemplateFamilySchema>;

export const OptDecisionVarSchema = z.object({
  name: z.string(),
  vtype: z.enum(["B", "I", "C"]), // 布尔 / 整数 / 连续
  indexBy: z.array(z.string()), // 抽象索引维度（如 "facility"·"client"），由绑定层填真对象
});

export const OptConstraintFamilySchema = z.object({
  key: z.string(),
  kind: z.string(),
  expr: z.string(), // 声明式表达，零业务常数
});

export const OptRequiredRoleSchema = z.object({
  role: z.string(), // 模板要求的抽象角色，如 "facility"/"client"/"open_cost"
  of: z.enum(["objectType", "link", "property"]),
});

export const OptModelTemplateSchema = z.object({
  key: z.string(), // 稳定键，进 SOLVER_CATALOG 派生（R15/R16）
  displayName: z.string(),
  family: OptTemplateFamilySchema,
  objectiveSense: z.enum(["minimize", "maximize"]),
  decisionVars: z.array(OptDecisionVarSchema),
  constraintFamilies: z.array(OptConstraintFamilySchema),
  requiredRoles: z.array(OptRequiredRoleSchema),
  params: z.record(z.string(), z.number()), // 可缩放规模参数（R14 config）
  status: z.enum(["DRAFT", "PROVISIONAL", "GOVERNED", "RETIRED"]).default("DRAFT"),
  provenance: z.object({ derivedFrom: z.string(), license: z.string() }), // CDLA Results 派生留痕（许可证门校验）
});
export type OptModelTemplate = z.infer<typeof OptModelTemplateSchema>;

// ── 本体绑定层（SPEC §2 · R14/DF.8 真正落点） ───────────────────────────────
export const OptRoleBindingSchema = z.object({
  role: z.string(), // 模板要求的角色
  bind: z.object({
    kind: z.enum(["objectType", "link", "property"]),
    ref: z.string(), // 该租户本体的真实对象/链路/属性引用
  }),
});

export const OntologyBindingSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // R2 租户隔离
  templateKey: z.string(),
  scope: z.record(z.string(), z.unknown()), // 子图范围（复用 slice-planner）
  roleBindings: z.array(OptRoleBindingSchema),
  // 系数取本体属性 或 rule.params（G-10「改规则即改优化」）；规则是 gate 非系数源
  coeffSource: z.enum(["property", "rule_params"]).default("property"),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
});
export type OntologyBinding = z.infer<typeof OntologyBindingSchema>;

// ── optimize_whatif 结构化扰动（SPEC §4 · 非任意代码，守 A18/R6） ─────────────
export const OptPerturbationSchema = z.object({
  kind: z.enum(["data_override", "add_constraint", "relax_constraint", "change_objective_weight"]),
  target: z.string(), // 受扰动的 role/参数（本体内，DF.8 校验）
  value: z.union([z.number(), z.string()]),
});
export type OptPerturbation = z.infer<typeof OptPerturbationSchema>;

// ── what-if 求解结果（Δ目标 / 可行性 / 冲突约束 · IIS 式） ─────────────────────
export const OptWhatifResultSchema = z.object({
  baselineObjective: z.number().nullable(),
  perturbedObjective: z.number().nullable(),
  deltaObjective: z.number().nullable(),
  feasible: z.boolean(),
  conflictConstraints: z.array(z.string()), // 冲突/不可行约束族 key（IIS 式）
  explanation: z.string().optional(), // R13 解释（新解 vs 原解）
});
export type OptWhatifResult = z.infer<typeof OptWhatifResultSchema>;
