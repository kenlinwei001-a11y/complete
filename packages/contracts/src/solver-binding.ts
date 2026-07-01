import { z } from "zod";

/**
 * SolverBinding — canonical 业务求解器的本体绑定层（解 B3 命门 · G-17）。
 *
 * 背景（B3 / G-17）：canonical 业务求解器（order_fullchain / cockpit_kpi / finance_pnl /
 * mrp_netting / plan_rootcause / loadContext 拓扑读出…）此前把对象类型 **硬编码** 成
 * `listByType(tenant, "Order")` / `"Base"` / `"SopVersionRow"`…。上传/合成的**任意类型**
 * （如 realco 上传的 `Orders`/`Bases`、物流域自定义类型）即便真物化，也喂不进求解器 →
 * 拒「需先合成 Order」。真物化 ≠ 真答案。
 *
 * 修法（扩已证 opt-binding.ts 范式）：求解器按 **role**（如 "order"/"base"/"model"）经
 * per-tenant `SolverBinding` 取**租户真实类型 + 字段映射**，而非硬编码 type key。
 *  - 有绑定：role → 绑定的真实 typeKey（+ fieldMap: canonicalField → 上传 field）。
 *  - 无绑定：回退默认 canonical key（**向后兼容**·demo 零绑定零回归·这是 P0 红线）。
 *
 * DF.8 接地：绑定引用的 typeKey 必须存在于本租户**已发布本体**（ACTIVE），否则报错、绝不静默
 * 造实体。R2：仅本租户。R6：绑定是确定性配置，同绑定同输入同输出。RL4：建模发布后自动建议
 * 绑定**草案**（DRAFT），人工确认后方生效（不自动发布）。
 *
 * 与 OntologyBinding（opt-template.ts）的关系：OntologyBinding 绑抽象 CP-SAT 模板的 role→本体，
 * 系数从对象图读；SolverBinding 绑 canonical 业务求解器的 role→本体类型/字段，让既有确定性
 * 业务求解器（读对象图）跨行业零改。二者同源同范式（role→租户真实类型/字段·DF.8 接地）。
 */

/** 单条角色绑定：canonical role → 租户真实对象类型 + 可选字段映射。 */
export const SolverRoleBindingSchema = z.object({
  /** canonical 角色键（求解器内部稳定角色，如 "order"/"base"/"model"/"material"）。 */
  role: z.string().min(1),
  /** 本租户已发布本体的真实对象类型 key（DF.8 接地校验须存在）。 */
  typeKey: z.string().min(1),
  /**
   * 字段映射：canonicalField → 真实上传字段。求解器读字段时经此映射
   * （如 canonical "qty" → 上传 "qtyGwh"）。缺省 = 字段名一致（向后兼容）。
   */
  fieldMap: z.record(z.string(), z.string()).optional(),
});
export type SolverRoleBinding = z.infer<typeof SolverRoleBindingSchema>;

/** SolverBinding：某租户对某求解器的一组 role→真实类型/字段绑定。 */
export const SolverBindingSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // R2 租户隔离
  /** 目标求解器 key（SOLVER_KEYS 之一）。 */
  solverKey: z.string().min(1),
  roleBindings: z.array(SolverRoleBindingSchema),
  /**
   * DRAFT = 建模发布后自动建议的草案（RL4 未生效，不参与 resolveSolverType）；
   * ACTIVE = 人工确认后生效（参与解析）。向后兼容：缺省 DRAFT（须显式确认才生效）。
   */
  status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
  /** 建议来源（自动草案标 "auto-suggest"；人工建标 "manual"）。 */
  origin: z.enum(["manual", "auto-suggest"]).default("manual"),
});
export type SolverBinding = z.infer<typeof SolverBindingSchema>;
