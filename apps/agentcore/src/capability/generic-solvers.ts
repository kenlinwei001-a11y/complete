import {
  CapabilitySliceSchema,
  type CapabilitySlice,
  type CapabilitySliceRow,
  type CapabilitySpec,
} from "@platform/contracts";
import type { RequestAuth } from "../auth.js";
import { SCENARIO_CATALOG } from "../scenarios-catalog.js";
import { verifyCapability, type CapabilityVerifyDeps } from "./verify.js";

/**
 * CORE-NL-SOLVER-ROUTING · C3（WO-2 Capability harness 接线）：把本 WO 新接的 **5 个通用多跳求解器**
 * 收编为一等 Capability，经 `verifyCapability`（NL 真路径 `orchestrator.submitQuery`）逐个真跑答出 →
 * `verifiedStatus` 由 `deriveVerifiedStatus` 派生（VERIFIED 必挂 `RUNTIME_PROBE` 活证据）。
 *
 * 反"借名/魔数/直调冒充"核心齿：representativeQuery = 该场景卡的 triggerQuestion，经 QOS 分类→路径A
 * 工作流→求解器→答案 真跑（**绝不**直调 `/a/v1/solvers/{key}/invoke`）。制品存在检查（artifactExists）=
 * 该 solver 在出厂场景卡目录有卡（意图/计划已由 seed 派生循环生成·能力环制品在）。
 */

/** 本 WO 新接的通用多跳求解器场景卡 intentKey 集合（单一来源=SCENARIO_CATALOG 过滤）。 */
export const GENERIC_SOLVER_INTENT_KEYS = [
  "shared_bottleneck_q",
  "concentration_risk_q",
  "margin_attribution_q",
  "supplier_disruption_q",
  "multisource_fusion_q",
] as const;

/** 从场景卡目录派生 5 项 CapabilitySpec（key=solver·representativeQuery=triggerQuestion·确定性 R6）。 */
export function genericSolverCapabilitySpecs(): CapabilitySpec[] {
  const keys = new Set<string>(GENERIC_SOLVER_INTENT_KEYS);
  return SCENARIO_CATALOG.filter((c) => keys.has(c.intentKey)).map((c) => ({
    key: c.solver,
    kind: "solver" as const,
    claim: c.summary,
    representativeQuery: c.triggerQuestion,
    acceptance: `代表问「${c.triggerQuestion}」经 QOS NL 路由（submitQuery·path=WORKFLOW）答出 dataBearing（非直调 /solvers/invoke）`,
  }));
}

/**
 * 逐能力经 `verifyCapability`（NL 真路径）真跑 → 投影为统一 `CapabilitySlice`（surface=solvers）。
 * 每行 = 一项 Capability（verifiedStatus 派生·禁手打）+ 关联 actionable Gap 列（代表问答不出时的诚实缺口）。
 */
export async function buildGenericSolverCapabilitySlice(
  deps: CapabilityVerifyDeps,
  auth: RequestAuth,
  opts?: { context?: Record<string, unknown>; at?: string },
): Promise<CapabilitySlice> {
  const now = opts?.at ?? new Date().toISOString();
  const rows: CapabilitySliceRow[] = [];
  for (const spec of genericSolverCapabilitySpecs()) {
    const { capability, probe } = await verifyCapability(deps, auth, spec, {
      artifactExists: true, // solver 有出厂场景卡 → 意图/计划已派生（能力环制品在场）
      ...(opts?.context ? { context: opts.context } : {}),
    });
    const gaps = probe.gap.findings.map((f) => ({
      what: f.what ?? "",
      where: f.where ?? "",
      acceptance: f.acceptance ?? "",
      gapCode: f.gapCode,
      blocking: f.blocking,
    }));
    rows.push({ capability, gaps });
  }
  rows.sort((a, b) => a.capability.key.localeCompare(b.capability.key));
  return CapabilitySliceSchema.parse({
    surface: "solvers",
    wired: true,
    generatedAt: now,
    rows,
    note: rows.every((r) => r.capability.verifiedStatus === "VERIFIED")
      ? ""
      : "部分能力代表问经 NL 路由未答出（无 LLM / 缺能力）——诚实 UNVERIFIED，见各行 evidence（绝不假 VERIFIED）。",
  });
}
