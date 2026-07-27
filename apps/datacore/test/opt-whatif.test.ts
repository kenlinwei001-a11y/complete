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
  last?: FacilityLocationRequest;
  async solve(_req: OptimizationRequest): Promise<OptimizationResult> {
    return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
  }
  async solveFacilityLocation(req: FacilityLocationRequest): Promise<FacilityLocationResult> {
    this.last = req;
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

/**
 * WO-OPTWHATIF-NL-WIRING · **数据装配 × 引擎 真 SEAM**（闭 §8 G-WHATIF-NL-UNREACHABLE·DataCore 半）：
 * selection+autoBind → assembleBaselineFromSelection（A13 词库/结构角色推断·DF.8 接地·**不硬编 Base→facility**）→
 * bindToSolverArgs 从**已发布本体真装配** → 真扰动重解（MockFive 真会重优化：开 openCost 最小的设施）→
 * **头号判据：baselineSolution.openFacilities ≠ perturbedSolution.openFacilities**（决策方案切换·数据×引擎驱动接缝）。
 * KILL-MOCK：MockFive 每次按 openCost argmin 真重解（非返回同一方案的桩）·真 CP-SAT 由 opt-real-sidecar.integration env-gated 坐实。
 */
async function seedSites(t: Awaited<ReturnType<typeof makeApp>>) {
  // **决策承载类型故意命名 "Site"（非 "Base"）**——证 assembleBaselineFromSelection 不硬编 Base→facility（选中什么类型即绑什么）。
  await t.repos.ontologyTypes.put({ id: "ot_site", tenantId: "acme", key: "Site", displayName: "站点", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "siteId", dataType: "string", isPrimaryKey: true }, { propKey: "setupCost", dataType: "number", isPrimaryKey: false }] });
  await t.repos.ontologyTypes.put({ id: "ot_cust", tenantId: "acme", key: "Customer", displayName: "客户", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }] });
  await t.repos.objects.put({ id: "f1", tenantId: "acme", type: "Site", props: { siteId: "f1", setupCost: 10 } });
  await t.repos.objects.put({ id: "f2", tenantId: "acme", type: "Site", props: { siteId: "f2", setupCost: 20 } });
  await t.repos.objects.put({ id: "f3", tenantId: "acme", type: "Site", props: { siteId: "f3", setupCost: 30 } });
  await t.repos.objects.put({ id: "c1", tenantId: "acme", type: "Customer", props: { custId: "c1" } });
}

describe("WO-OPTWHATIF-NL-WIRING · 装配器 SEAM（selection+autoBind·数据装配×引擎·真重解）", () => {
  it("头号：selection+autoBind → 真装配 + 真扰动重解 → 决策方案切换（openFacilities 从 f1→f2·Δ≠0）", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockFL()); // MockFive：开 openCost 最小设施（真 argmin 重解·决策切换非桩）
    const ctx: AuthCtx = { tenantId: "acme", userId: "u", roles: ["admin"], attributes: {} };
    await seedSites(t);
    const out = await t.services.solvers.invoke(ctx, "optimize_whatif", {
      family: "facility_location",
      autoBind: true,
      selection: [
        { objectType: "Site", objectId: "f1" },
        { objectType: "Site", objectId: "f2" },
        { objectType: "Site", objectId: "f3" },
      ],
      perturbations: [{ kind: "data_override", target: "facilities.f1.openCost", value: 150 }],
    });
    expect((out as { applicable?: boolean }).applicable).not.toBe(false); // 真装配成功
    const base = out.baselineSolution as { openFacilities: string[] };
    const pert = out.perturbedSolution as { openFacilities: string[] };
    expect(base.openFacilities).toEqual(["f1"]); // 基线：最便宜 f1(10)
    expect(pert.openFacilities).toEqual(["f2"]); // f1→150 ⇒ 最便宜切到 f2(20)
    expect(base.openFacilities).not.toEqual(pert.openFacilities); // **头号：决策方案切换**
    expect(out.deltaObjective).not.toBe(0);
    expect(out.deltaObjective).not.toBeNull();
    expect(out.feasible).toBe(true);
  });

  it("R6：同 selection 同扰动两跑字节一致", async () => {
    const run = async () => {
      const t = await makeApp();
      t.services.solvers.setOptimizer(new MockFL());
      const ctx: AuthCtx = { tenantId: "acme", userId: "u", roles: ["admin"], attributes: {} };
      await seedSites(t);
      return t.services.solvers.invoke(ctx, "optimize_whatif", { family: "facility_location", autoBind: true, selection: [{ objectType: "Site", objectId: "f1" }, { objectType: "Site", objectId: "f2" }, { objectType: "Site", objectId: "f3" }], perturbations: [{ kind: "data_override", target: "facilities.f1.openCost", value: 150 }] });
    };
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });

  it("选中范围收窄：只选 f1/f2 → facilities 只含选中（f3 不入·真收窄非全量）", async () => {
    const t = await makeApp();
    const mock = new MockFL();
    t.services.solvers.setOptimizer(mock);
    const ctx: AuthCtx = { tenantId: "acme", userId: "u", roles: ["admin"], attributes: {} };
    await seedSites(t);
    await t.services.solvers.invoke(ctx, "optimize_whatif", { family: "facility_location", autoBind: true, selection: [{ objectType: "Site", objectId: "f1" }, { objectType: "Site", objectId: "f2" }], perturbations: [{ kind: "data_override", target: "facilities.f1.openCost", value: 150 }] });
    // MockFive.last 捕获最后一次 solveFacilityLocation 请求（基线/扰动同一 facility 集）。
    expect(mock.last!.facilities.map((f) => f.id).sort()).toEqual(["f1", "f2"]); // f3 被收窄掉
  });

  it("DF.8 诚实报缺（不造实体）：无客户/订单类型 → applicable:false·missingRoles 含 client（绝不伪造系数）", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockFL());
    const ctx: AuthCtx = { tenantId: "acme2", userId: "u", roles: ["admin"], attributes: {} };
    // 只种 Site（有成本字段）·**不种任何客户/订单类型** → client role 无从接地。
    await t.repos.ontologyTypes.put({ id: "ot_site2", tenantId: "acme2", key: "Site", displayName: "站点", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "siteId", dataType: "string", isPrimaryKey: true }, { propKey: "setupCost", dataType: "number", isPrimaryKey: false }] });
    await t.repos.objects.put({ id: "f1", tenantId: "acme2", type: "Site", props: { siteId: "f1", setupCost: 10 } });
    const out = await t.services.solvers.invoke(ctx, "optimize_whatif", { family: "facility_location", autoBind: true, selection: [{ objectType: "Site", objectId: "f1" }], perturbations: [{ kind: "data_override", target: "facilities.f1.openCost", value: 150 }] });
    expect((out as { applicable?: boolean }).applicable).toBe(false);
    expect(String((out as { missingRoles?: string[] }).missingRoles?.join(""))).toContain("client");
  });

  it("DF.8 诚实报缺：决策类型无成本字段 → applicable:false·missingRoles 含 open_cost（不硬编 openCost·不伪造）", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockFL());
    const ctx: AuthCtx = { tenantId: "acme3", userId: "u", roles: ["admin"], attributes: {} };
    await t.repos.ontologyTypes.put({ id: "ot_site3", tenantId: "acme3", key: "Site", displayName: "站点", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "siteId", dataType: "string", isPrimaryKey: true }, { propKey: "area", dataType: "number", isPrimaryKey: false }] });
    await t.repos.ontologyTypes.put({ id: "ot_cust3", tenantId: "acme3", key: "Customer", displayName: "客户", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }] });
    await t.repos.objects.put({ id: "f1", tenantId: "acme3", type: "Site", props: { siteId: "f1", area: 10 } });
    const out = await t.services.solvers.invoke(ctx, "optimize_whatif", { family: "facility_location", autoBind: true, selection: [{ objectType: "Site", objectId: "f1" }], perturbations: [{ kind: "data_override", target: "facilities.f1.openCost", value: 150 }] });
    expect((out as { applicable?: boolean }).applicable).toBe(false);
    expect(String((out as { missingRoles?: string[] }).missingRoles?.join(""))).toContain("open_cost");
  });
});
