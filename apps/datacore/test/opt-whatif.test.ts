import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { runOptimizeWhatif, type SolveArgsFn } from "../src/solvers/opt-whatif.js";
import type { OptPerturbation } from "@platform/contracts";
import type {
  OptimizerClient, OptimizationRequest, OptimizationResult,
  FacilityLocationRequest, FacilityLocationResult,
} from "../src/solvers/optimizer-client.js";

/**
 * 轨B·增量3 optimize_whatif（扰动重解 → Δ目标值/冲突约束）测试。
 *
 * 两层证明：
 *  ① 纯函数 runOptimizeWhatif（扰动施加 + 对比，确定性，FUS1 概念）—— 用 stub solve 验 Δ目标/接地/克隆不污染基线。
 *  ② 经 service.invoke("optimize_whatif")（真接 5 核心 sidecar）—— mock 引擎按扰动后系数回放，验全链。
 */
const PERT_OVERRIDE: OptPerturbation = { kind: "data_override", target: "facilities.F1.openCost", value: 999 };

describe("轨B·增量3 · optimize_whatif 纯函数（runOptimizeWhatif）", () => {
  const baseArgs = {
    facilities: [{ id: "F1", openCost: 10 }, { id: "F2", openCost: 20 }],
    clients: [{ id: "C1" }],
    assignCosts: [{ client: "C1", facility: "F1", cost: 1 }, { client: "C1", facility: "F2", cost: 1 }],
  };

  it("data_override 改一参 → Δ目标值（基线 vs 扰动），且不污染基线 args", async () => {
    // stub solve：目标 = Σ 选中设施 openCost 最小 + 指派（这里简化：返回 min openCost）。
    const solve: SolveArgsFn = async (_fam, a) => {
      const facs = (a.facilities as { openCost: number }[]);
      const obj = Math.min(...facs.map((f) => f.openCost)) + 1;
      return { status: "OPTIMAL", optimal: true, objective: obj };
    };
    const r = await runOptimizeWhatif(solve, "facility_location", baseArgs, [PERT_OVERRIDE]);
    expect(r.baselineObjective).toBe(11); // min(10,20)+1
    expect(r.perturbedObjective).toBe(21); // F1 openCost→999 ⇒ min(999,20)+1=21
    expect(r.deltaObjective).toBe(10);
    expect(r.feasible).toBe(true);
    // 基线 args 未被污染（R4 克隆）
    expect(baseArgs.facilities[0]!.openCost).toBe(10);
  });

  it("change_objective_weight：全局系数缩放 → 目标按比例变", async () => {
    const solve: SolveArgsFn = async (_fam, a) => {
      const facs = (a.facilities as { openCost: number }[]);
      return { status: "OPTIMAL", optimal: true, objective: Math.min(...facs.map((f) => f.openCost)) };
    };
    const r = await runOptimizeWhatif(solve, "facility_location", baseArgs, [{ kind: "change_objective_weight", target: "objective.weight", value: 2 }]);
    expect(r.baselineObjective).toBe(10);
    expect(r.perturbedObjective).toBe(20); // openCost×2
    expect(r.deltaObjective).toBe(10);
  });

  it("不可行 → conflictConstraints 列受扰动约束族（IIS 式）", async () => {
    const solve: SolveArgsFn = async (_fam, a) => {
      const facs = (a.facilities as { openCost: number }[]);
      // 扰动把 openCost 顶到 999 → 视为不可行（模拟约束冲突）。
      return facs.some((f) => f.openCost >= 999) ? { status: "INFEASIBLE", optimal: false } : { status: "OPTIMAL", optimal: true, objective: 11 };
    };
    const r = await runOptimizeWhatif(solve, "facility_location", baseArgs, [PERT_OVERRIDE]);
    expect(r.feasible).toBe(false);
    expect(r.perturbedObjective).toBeNull();
    expect(r.conflictConstraints).toContain("facilities.F1.openCost");
  });

  it("DF.8 接地：扰动 target 指向 args 外对象 → 报错", async () => {
    const solve: SolveArgsFn = async () => ({ status: "OPTIMAL", optimal: true, objective: 1 });
    await expect(runOptimizeWhatif(solve, "facility_location", baseArgs, [{ kind: "data_override", target: "facilities.GHOST.openCost", value: 5 }])).rejects.toThrow(/接地/);
    await expect(runOptimizeWhatif(solve, "facility_location", baseArgs, [{ kind: "data_override", target: "ghosts.X.v", value: 5 }])).rejects.toThrow(/接地|不在/);
  });

  it("R6 确定性：同基线同扰动两次 → 结果一致", async () => {
    const solve: SolveArgsFn = async (_fam, a) => ({ status: "OPTIMAL", optimal: true, objective: Math.min(...(a.facilities as { openCost: number }[]).map((f) => f.openCost)) });
    const a = await runOptimizeWhatif(solve, "facility_location", baseArgs, [PERT_OVERRIDE]);
    const b = await runOptimizeWhatif(solve, "facility_location", baseArgs, [PERT_OVERRIDE]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

class MockFL implements OptimizerClient {
  async solve(_req: OptimizationRequest): Promise<OptimizationResult> {
    return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
  }
  async solveFacilityLocation(req: FacilityLocationRequest): Promise<FacilityLocationResult> {
    // 真实回放：开 openCost 最小的设施，指派全部，objective = minOpen + Σ(该设施指派成本)。
    const cheapest = [...req.facilities].sort((a, b) => a.openCost - b.openCost)[0]!;
    const ac = req.assignCosts.filter((a) => a.facility === cheapest.id);
    const obj = cheapest.openCost + req.clients.reduce((s, c) => s + (ac.find((a) => a.client === c.id)?.cost ?? 0), 0);
    return { status: "OPTIMAL", optimal: true, openFacilities: [cheapest.id], assignments: req.clients.map((c) => ({ client: c.id, facility: cheapest.id })), objective: obj };
  }
}

describe("轨B·增量3 · optimize_whatif 经 service.invoke（接 5 核心 sidecar）", () => {
  it("invoke optimize_whatif → 基线/扰动/Δ目标全链", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockFL());
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    const out = await t.services.solvers.invoke(ctx, "optimize_whatif", {
      family: "facility_location",
      perturbations: [{ kind: "data_override", target: "facilities.F1.openCost", value: 999 }],
      args: {
        facilities: [{ id: "F1", openCost: 10 }, { id: "F2", openCost: 20 }],
        clients: [{ id: "C1" }],
        assignCosts: [{ client: "C1", facility: "F1", cost: 1 }, { client: "C1", facility: "F2", cost: 1 }],
      },
    });
    expect(out.baselineObjective).toBe(11); // F1(10)+assign1
    expect(out.perturbedObjective).toBe(21); // F1→999 ⇒ F2(20)+assign1
    expect(out.deltaObjective).toBe(10);
    expect(out.feasible).toBe(true);
    expect(String(out.summary)).toContain("Δ");
  });
});
