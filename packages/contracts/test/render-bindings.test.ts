import { describe, expect, it } from "vitest";
import {
  DATADEP_ROLE_CANONICAL,
  RenderBindingSchema,
  SOLVER_DATADEP,
  SOLVER_RENDER_BINDINGS,
  deriveSliceTargetCandidates,
} from "../src/index.js";

/**
 * WO ONTO-SCEN-RENDER-PROJ 契约齿：
 *  ① SOLVER_RENDER_BINDINGS（genome.renderBindings 出厂单源）逐条形状合法 + 16 卡求解器全覆盖；
 *  ③ deriveSliceTargetCandidates 确定性派生（R6）+ 角色映射完备（datacore 侧另有 ROLE_CANONICAL 对账齿）。
 */
describe("SOLVER_RENDER_BINDINGS（渲染投影绑定单源）", () => {
  it("每条绑定过 RenderBindingSchema；每个登记求解器至少 1 条 kpi/table 承载数据绑定", () => {
    const keys = Object.keys(SOLVER_RENDER_BINDINGS);
    expect(keys.length).toBeGreaterThanOrEqual(16);
    for (const [solverKey, bindings] of Object.entries(SOLVER_RENDER_BINDINGS)) {
      expect(bindings.length, `${solverKey} 绑定为空（=回退泛化投影）`).toBeGreaterThan(0);
      for (const b of bindings) expect(() => RenderBindingSchema.parse(b)).not.toThrow();
      expect(
        bindings.some((b) => b.block === "kpi" || b.block === "table"),
        `${solverKey} 无 kpi/table 承载数据绑定（诚实门 dataBearing 无据）`,
      ).toBe(true);
      // 同一 (block, field) 不重复
      const sigs = bindings.map((b) => `${b.block}:${b.fromSolverField}`);
      expect(new Set(sigs).size).toBe(sigs.length);
    }
  });

  it("16 张派生场景卡的求解器（含 sop_balance→mrp_netting 映射）全部有绑定登记", () => {
    const derivedSolvers = [
      "plan_audit", "plan_generate", "cert_schedule", "kit_readiness", "lta_gap", "inventory_optimize",
      "changeover_sequence", "yield_diagnosis", "maintenance_stagger", "outsourcing_split", "quote_margin",
      "credit_exposure", "capex_scenario", "mrp_netting", "quarterly_gap", "carbon_footprint",
    ];
    for (const s of derivedSolvers) expect(SOLVER_RENDER_BINDINGS[s], `派生卡求解器 ${s} 无渲染绑定登记`).toBeDefined();
  });
});

describe("deriveSliceTargetCandidates（切片目标自动派生·非手焙）", () => {
  it("确定性（R6）：同 solverKey 同 primaryType 恒同输出；targets 排序去重且不含 root", () => {
    const a = deriveSliceTargetCandidates("capacity_forecast", "Model");
    const b = deriveSliceTargetCandidates("capacity_forecast", "Model");
    expect(a).toEqual(b);
    expect(a!.rootType).toBe("Model"); // primaryType ∈ 清单类型 → 作 root
    expect(a!.targets).toEqual([...a!.targets].sort());
    expect(a!.targets).not.toContain("Model");
    // primaryType 不在清单 → 回落清单首角色
    expect(deriveSliceTargetCandidates("quote_margin", "Base")!.rootType).toBe("Order");
    expect(deriveSliceTargetCandidates("quote_margin")!).toEqual({ rootType: "Order", targets: ["Customer"] });
    // 未知求解器 → null（非电池 pack 卡诚实跳过）
    expect(deriveSliceTargetCandidates("no_such_solver")).toBeNull();
    // 单角色清单 → targets 空（无需规划）
    expect(deriveSliceTargetCandidates("mrp_netting")).toEqual({ rootType: "MaterialBalance", targets: [] });
  });

  it("角色映射完备：SOLVER_DATADEP 每个 roleType 都有 DATADEP_ROLE_CANONICAL 映射", () => {
    for (const [solverKey, dep] of Object.entries(SOLVER_DATADEP)) {
      for (const req of dep.requires) {
        expect(DATADEP_ROLE_CANONICAL[req.roleType], `${solverKey} 角色 ${req.roleType} 无 canonical 映射`).toBeDefined();
      }
    }
  });
});
