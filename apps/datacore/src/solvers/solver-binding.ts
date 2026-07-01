/**
 * SolverBinding 解析层（解 B3 命门 · G-17 · 扩已证 opt-binding.ts 范式）。
 *
 * canonical 业务求解器此前硬编码 `listByType(tenant,"Order"/"Base"/…)`——上传/合成的任意类型
 * 喂不进求解器。本层把「求解器 role → 租户真实类型/字段」做成 per-tenant `SolverBinding` 配置：
 *  - `resolveSolverType(bindings, solverKey, role)`：有 ACTIVE 绑定用绑定类型，否则回退默认 canonical key。
 *  - `resolveField(bindings, solverKey, role, canonicalField)`：字段名经 fieldMap 映射，缺省字段名一致。
 *
 * 向后兼容红线（P0）：无绑定必回退 canonical 默认、demo 零绑定零回归。DF.8 接地：落库前校验绑定
 * 引用的类型存在于本租户已发布本体（ACTIVE），否则报错、绝不造实体。R2 仅本租户，R6 确定性。
 */
import type { ObjectTypeDef } from "../domain.js";
import type { SolverBinding, SolverRoleBinding } from "@platform/contracts";
import { validationError } from "../errors.js";

/**
 * canonical 角色 → 默认对象类型 key（无绑定时的回退，= 现状硬编码类型，保证 demo 零回归）。
 * 每求解器声明它读的 role 集；role 名即求解器内部稳定角色键。
 */
export const SOLVER_CANONICAL_TYPES: Record<string, Record<string, string>> = {
  order_fullchain: {
    order: "Order",
    model: "Model",
    demandSegment: "DemandSegment",
    materialBalance: "MaterialBalance",
  },
  cockpit_kpi: {
    sopVersion: "SopVersionRow",
    financePlan: "FinancePlan",
    base: "Base",
    annualScenario: "AnnualScenario",
  },
  finance_pnl: {
    financePlan: "FinancePlan",
    demandSegment: "DemandSegment",
  },
  mrp_netting: {
    materialBalance: "MaterialBalance",
  },
  plan_rootcause: {
    metric: "Metric",
    rootCauseChain: "RootCauseChain",
    ksf: "KSF",
  },
  // loadContext 读出的 canonical 拓扑类型（context 求解器共用）。
  context: {
    base: "Base",
    line: "Line",
    process: "Process",
    equipment: "Equipment",
    maintPlan: "MaintPlan",
    model: "Model",
    order: "Order",
    shipment: "Shipment",
    segment: "Segment",
    demandSegment: "DemandSegment",
    sopVersion: "SopVersionRow",
  },
};

/**
 * 求解器读的 canonical 字段（role → canonicalField 列表），用于自动建议绑定草案 fieldMap 骨架 +
 * 门校验。仅登记跨行业最关键字段（非穷举，缺省字段名一致回退）。
 */
export const SOLVER_CANONICAL_FIELDS: Record<string, Record<string, string[]>> = {
  order_fullchain: {
    order: ["so", "model", "qty", "due", "cust", "creditUsedRatio"],
    model: ["modelId", "bases"],
    demandSegment: ["segment", "marginPct", "floorPct"],
    materialBalance: ["material", "gapTon", "etaDate"],
  },
};

/** 租户绑定索引：solverKey → role → SolverRoleBinding（仅 ACTIVE 生效；DRAFT 不参与解析·RL4）。 */
export type SolverBindingIndex = Map<string, Map<string, SolverRoleBinding>>;

/** 构建租户绑定索引（只纳入 ACTIVE 绑定；DRAFT 草案须人工确认后方生效 · RL4）。 */
export function indexSolverBindings(bindings: SolverBinding[]): SolverBindingIndex {
  const idx: SolverBindingIndex = new Map();
  for (const b of bindings) {
    if (b.status !== "ACTIVE") continue;
    let roleMap = idx.get(b.solverKey);
    if (!roleMap) {
      roleMap = new Map();
      idx.set(b.solverKey, roleMap);
    }
    for (const rb of b.roleBindings) roleMap.set(rb.role, rb);
  }
  return idx;
}

/** canonical 默认类型（无绑定回退）。solverKey/role 未登记则返回 undefined（调用方须显式给回退）。 */
export function canonicalType(solverKey: string, role: string): string | undefined {
  return SOLVER_CANONICAL_TYPES[solverKey]?.[role];
}

/**
 * 解析求解器 role → 租户真实对象类型 key。
 * 有 ACTIVE 绑定用绑定类型；否则回退 fallback（缺省取 canonical 默认表）。向后兼容红线。
 */
export function resolveSolverType(
  idx: SolverBindingIndex,
  solverKey: string,
  role: string,
  fallback?: string,
): string {
  const bound = idx.get(solverKey)?.get(role)?.typeKey;
  if (bound) return bound;
  const canonical = fallback ?? canonicalType(solverKey, role);
  if (!canonical) throw validationError(`求解器 ${solverKey} role '${role}' 无绑定且无 canonical 默认类型`);
  return canonical;
}

/**
 * 解析 canonical 字段 → 真实字段名（经 fieldMap 映射；缺省字段名一致 = 向后兼容）。
 * 求解器读对象属性时用它，把「qty」映射到上传的「qtyGwh」。
 */
export function resolveField(
  idx: SolverBindingIndex,
  solverKey: string,
  role: string,
  canonicalField: string,
): string {
  return idx.get(solverKey)?.get(role)?.fieldMap?.[canonicalField] ?? canonicalField;
}

/**
 * DF.8 接地校验（落库前）：绑定引用的每个 typeKey 必须存在于本租户**已发布本体**（ACTIVE），
 * fieldMap 的目标字段须在该类型属性内。越界 → 报错，绝不静默造实体。
 */
export function assertSolverBindingGrounded(binding: SolverBinding, publishedTypes: ObjectTypeDef[]): void {
  const byKey = new Map(publishedTypes.filter((t) => t.status === "ACTIVE").map((t) => [t.key, t]));
  const violations: string[] = [];
  for (const rb of binding.roleBindings) {
    const t = byKey.get(rb.typeKey);
    if (!t) {
      violations.push(`类型 '${rb.typeKey}'（role=${rb.role}）不在本租户已发布本体内`);
      continue;
    }
    if (rb.fieldMap) {
      const propKeys = new Set(t.properties.map((p) => p.propKey));
      for (const [canonicalField, realField] of Object.entries(rb.fieldMap)) {
        if (!propKeys.has(realField)) {
          violations.push(`字段 '${realField}'（role=${rb.role} · canonical=${canonicalField}）不在类型 '${rb.typeKey}' 内`);
        }
      }
    }
  }
  if (violations.length > 0) {
    throw validationError(`DF.8 接地失败：SolverBinding 引用了本体外实体 —— ${violations.join("、")}（绑定不得引用本租户已发布本体之外的类型/字段）`);
  }
}

/**
 * 建模发布后自动建议绑定草案（RL4·人工确认·不自动生效）：对每个 canonical 求解器 role，
 * 用确定性词表（typeKey/canonical role/canonical type 名称相似度）在本租户已发布类型里挑最贴切的，
 * 产 DRAFT 绑定草案（status=DRAFT·origin=auto-suggest）。**不覆盖已有 ACTIVE 绑定，不自动生效**。
 * 确定性 R6（无 LLM·稳定排序·稳定 tie-break）。回退不到 canonical 默认类型 → 建议绑到最相似类型。
 */
export function suggestSolverBindings(
  tenantId: string,
  publishedTypes: ObjectTypeDef[],
  existing: SolverBinding[],
  idPrefix: (solverKey: string) => string,
): SolverBinding[] {
  const activeTypes = publishedTypes.filter((t) => t.status === "ACTIVE");
  const typeKeys = activeTypes.map((t) => t.key);
  const has = new Set(typeKeys);
  // 已有绑定（任何状态）的 solverKey 集：不重复建议（避免刷屏，人工已介入）。
  const existingSolvers = new Set(existing.map((b) => b.solverKey));

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // 确定性相似度：完全一致=100，去符号一致=90，前缀/包含=50+命中长度，否则 0。
  const similarity = (a: string, b: string): number => {
    if (a === b) return 100;
    const na = norm(a), nb = norm(b);
    if (na === nb) return 90;
    if (na && nb && (na.includes(nb) || nb.includes(na))) return 50 + Math.min(na.length, nb.length);
    return 0;
  };

  const out: SolverBinding[] = [];
  for (const [solverKey, roleTypes] of Object.entries(SOLVER_CANONICAL_TYPES)) {
    if (solverKey === "context") continue; // context 是内部 loadContext role，不单列草案
    if (existingSolvers.has(solverKey)) continue;
    // 若 canonical 默认类型都在本租户本体内（demo 情形）→ 无需绑定草案（回退即可，零噪声）。
    if (Object.values(roleTypes).every((t) => has.has(t))) continue;
    const roleBindings: SolverRoleBinding[] = [];
    for (const [role, canonical] of Object.entries(roleTypes).sort(([a], [b]) => a.localeCompare(b))) {
      // 该 role canonical 类型已存在 → 无需绑（回退到位）。
      if (has.has(canonical)) continue;
      // 否则挑最相似的本租户类型（确定性排序：相似度降序 → typeKey 字典序）。
      const ranked = [...typeKeys]
        .map((tk) => ({ tk, score: Math.max(similarity(tk, canonical), similarity(tk, role)) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.tk.localeCompare(b.tk));
      const best = ranked[0];
      if (best) roleBindings.push({ role, typeKey: best.tk });
    }
    if (roleBindings.length > 0) {
      out.push({
        id: idPrefix(solverKey),
        tenantId,
        solverKey,
        roleBindings,
        status: "DRAFT",
        origin: "auto-suggest",
      });
    }
  }
  return out.sort((a, b) => a.solverKey.localeCompare(b.solverKey));
}
