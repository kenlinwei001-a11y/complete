import type { GapCode } from "@platform/contracts";

/**
 * 能力清单(schema 级) + 比对差异（PRD-fde §3.5，P1 读模型）。
 * 知现状：本租户现有 对象类型/规则/求解器/切片。算缺口：把 comprehend 倒推的"需求清单"diff 现状
 * → 建之前就知道缺什么（缺类型/规则/求解器/切片）。确定性纯函数（R6）。
 * 注：求解器缺 → SOLVER_NOT_FOUND,后续按 §3.7 三级升级(组合/generic_inference/工单)处置,此处只诊断。
 */
export interface CapabilityInventory {
  objectTypes: string[];
  rules: string[];
  solvers: string[];
  slices: string[];
}

export interface CapabilityNeeds {
  objectTypes?: string[];
  rules?: string[];
  solvers?: string[];
  slices?: string[];
}

export interface CapabilityGap {
  kind: "objectType" | "rule" | "solver" | "slice";
  key: string;
  gapCode: GapCode;
}

export interface CapabilityGapReport {
  verdict: "READY" | "GAPS";
  gaps: CapabilityGap[];
}

/** 把需求 diff 现有能力 → 缺口清单（确定性,按 kind+key 稳定排序）。 */
export function diffNeeds(needs: CapabilityNeeds, inv: CapabilityInventory): CapabilityGapReport {
  const has = {
    objectType: new Set(inv.objectTypes),
    rule: new Set(inv.rules),
    solver: new Set(inv.solvers),
    slice: new Set(inv.slices),
  };
  const gaps: CapabilityGap[] = [];
  for (const k of needs.objectTypes ?? []) if (!has.objectType.has(k)) gaps.push({ kind: "objectType", key: k, gapCode: "NO_SLICE" });
  for (const k of needs.rules ?? []) if (!has.rule.has(k)) gaps.push({ kind: "rule", key: k, gapCode: "NO_RULE" });
  for (const k of needs.solvers ?? []) if (!has.solver.has(k)) gaps.push({ kind: "solver", key: k, gapCode: "SOLVER_NOT_FOUND" });
  for (const k of needs.slices ?? []) if (!has.slice.has(k)) gaps.push({ kind: "slice", key: k, gapCode: "NO_SLICE" });
  gaps.sort((a, b) => `${a.kind}${a.key}`.localeCompare(`${b.kind}${b.key}`));
  return { verdict: gaps.length === 0 ? "READY" : "GAPS", gaps };
}
