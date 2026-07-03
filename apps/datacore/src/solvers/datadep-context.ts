import { SOLVER_DATADEP, type DataDependency } from "@platform/contracts";

/**
 * DATADEP-MANIFEST-READINESS 站② 治本 · loadContext 读清单并集（非写死 22 类）.
 *
 * `CONTEXT_ROLES` = SolverContext 可承载的**上下文对象角色**的声明式登记（role→字段/类型/加载策略）。
 * `loadContext` 不再内联硬编码 22 个 `listByType` 调用，而是**迭代本登记 ∩ 各求解器清单并集**决定加载什么：
 *   rolesToLoad = CONTEXT_ROLES ∩ ⋃(SOLVER_DATADEP.*.requires.roleType)  （extended 角色仅 withExtended 时）
 * 因每个上下文角色都被某求解器清单覆盖（门 `datadep-manifest:check` 守），并集 == 全 22 角色 → 字节一致（R6）。
 * 治本点：新增「需已有角色」的求解器只声明清单即可（loadContext 零改）；删掉某角色的唯一清单覆盖 → 门红。
 *
 * 每条策略镜像原 loadContext 语义（不改行为）：
 *  - `ctResolve`：经 SolverBinding「context」域 role→租户真实类型解析（B3·G-17）；否则用 canonical 字面。
 *  - `a6`：读出层套 A6 行级过滤（base_manager 只见本基地）；网络级/健康/扩展对象不套。
 *  - `extended`：E6b 扩展数据（仅 13 新求解器需要），默认不加载（省全表扫描），withExtended 时才载。
 *  - `visibleOrders`：order 角色支持 visibleOrders 覆盖（app.ts 构造后注入）。
 */
export interface ContextRole {
  role: string;
  canonical: string;
  field: string;
  ctResolve: boolean;
  a6: boolean;
  extended: boolean;
  /** order 专属：允许 visibleOrders 覆盖（其余角色恒 false）。 */
  visibleOverride?: boolean;
}

export const CONTEXT_ROLES: readonly ContextRole[] = [
  { role: "base", canonical: "Base", field: "bases", ctResolve: true, a6: true, extended: false },
  { role: "line", canonical: "Line", field: "lines", ctResolve: true, a6: true, extended: false },
  { role: "process", canonical: "Process", field: "processes", ctResolve: true, a6: true, extended: false },
  { role: "equipment", canonical: "Equipment", field: "equipment", ctResolve: true, a6: true, extended: false },
  { role: "maintPlan", canonical: "MaintPlan", field: "maintPlans", ctResolve: true, a6: true, extended: false },
  { role: "model", canonical: "Model", field: "models", ctResolve: true, a6: true, extended: false },
  { role: "order", canonical: "Order", field: "orders", ctResolve: true, a6: true, extended: false, visibleOverride: true },
  { role: "shipment", canonical: "Shipment", field: "shipments", ctResolve: true, a6: true, extended: false },
  { role: "segment", canonical: "Segment", field: "segments", ctResolve: true, a6: true, extended: false },
  { role: "dataHealth", canonical: "DataSourceHealth", field: "dataHealth", ctResolve: false, a6: false, extended: false },
  { role: "demandSegment", canonical: "DemandSegment", field: "demandSegments", ctResolve: true, a6: false, extended: false },
  { role: "sopVersion", canonical: "SopVersionRow", field: "sopVersions", ctResolve: true, a6: false, extended: false },
  { role: "material", canonical: "Material", field: "materials", ctResolve: false, a6: false, extended: true },
  { role: "materialBatch", canonical: "MaterialBatch", field: "materialBatches", ctResolve: false, a6: false, extended: true },
  { role: "customer", canonical: "Customer", field: "customers", ctResolve: false, a6: false, extended: true },
  { role: "arInvoice", canonical: "ARInvoice", field: "arInvoices", ctResolve: false, a6: false, extended: true },
  { role: "certification", canonical: "Certification", field: "certifications", ctResolve: false, a6: false, extended: true },
  { role: "energyMeter", canonical: "EnergyMeter", field: "energyMeters", ctResolve: false, a6: false, extended: true },
  { role: "changeoverMatrix", canonical: "ChangeoverMatrix", field: "changeoverMatrix", ctResolve: false, a6: false, extended: true },
  { role: "capexProject", canonical: "CapexProject", field: "capexProjects", ctResolve: false, a6: false, extended: true },
  { role: "purchaseOrder", canonical: "PurchaseOrder", field: "purchaseOrders", ctResolve: false, a6: false, extended: true },
  { role: "carbonFactor", canonical: "CarbonFactor", field: "carbonFactors", ctResolve: false, a6: false, extended: true },
] as const;

const CONTEXT_ROLE_KEYS: ReadonlySet<string> = new Set(CONTEXT_ROLES.map((c) => c.role));

/** ⋃ 各求解器清单声明的角色（含非上下文角色如 materialBalance）。 */
export function manifestRoleUnion(dep: Readonly<Record<string, DataDependency>> = SOLVER_DATADEP): Set<string> {
  const u = new Set<string>();
  for (const m of Object.values(dep)) for (const req of m.requires) u.add(req.roleType);
  return u;
}

/** 上下文角色 ∩ 清单并集 —— loadContext 据此决定加载哪些角色（治本：读清单·非写死）。 */
export function contextRolesToLoad(withExtended: boolean): ContextRole[] {
  const union = manifestRoleUnion();
  return CONTEXT_ROLES.filter((cr) => union.has(cr.role) && (!cr.extended || withExtended));
}

/** 门/测试用：清单未覆盖的上下文角色（应为空——否则 loadContext 会漏加载该角色→求解器读空）。 */
export function uncoveredContextRoles(): string[] {
  const union = manifestRoleUnion();
  return CONTEXT_ROLES.filter((cr) => !union.has(cr.role)).map((cr) => cr.role);
}

/** role→canonical（就绪探测按角色计数用；含非上下文角色）。 */
export const ROLE_CANONICAL: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(CONTEXT_ROLES.map((c) => [c.role, c.canonical])),
  // 非上下文角色（求解器直接 listByType 读·就绪探测覆盖之）。
  materialBalance: "MaterialBalance",
});

export { CONTEXT_ROLE_KEYS };
