import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { OntologyBinding } from "@platform/contracts";
import type {
  OptimizerClient,
  OptimizationRequest,
  OptimizationResult,
  FacilityLocationRequest,
  FacilityLocationResult,
} from "../src/solvers/optimizer-client.js";

/**
 * 轨B·增量2 本体绑定层（OntologyBinding · R14/DF.8）测试。
 *
 * 北极星核：**同一 facility_location 模板，绑两个不同行业租户的本体（物流：仓库/门店 ⊕ 医疗：诊所/社区），
 * 各出最优解——代码零改、仅绑定不同**（R14 去行业锁死）。绑定层从本体类型化字段读系数（FUS4），
 * 越界引用本体外类型/属性 → DF.8 接地报错（FUS3 去电池，多行业通用）。CP-SAT 可证最优由 Python 真求解证；
 * 这里 mock 引擎捕获绑定层组出的请求，断言「不同本体 → 不同请求 → 同一引擎」。
 */
class MockFL implements OptimizerClient {
  last?: FacilityLocationRequest;
  async solve(_req: OptimizationRequest): Promise<OptimizationResult> {
    return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
  }
  async solveFacilityLocation(req: FacilityLocationRequest): Promise<FacilityLocationResult> {
    this.last = req;
    // 回放一个确定最优（开第一个设施，指派全部）。
    const f0 = req.facilities[0]!.id;
    return { status: "OPTIMAL", optimal: true, openFacilities: [f0], assignments: req.clients.map((c) => ({ client: c.id, facility: f0 })), objective: 42 };
  }
}

async function seedLogistics(t: Awaited<ReturnType<typeof makeApp>>) {
  // 物流租户：仓库（开设成本）+ 门店。
  await t.repos.ontologyTypes.put({ id: "ot_wh", tenantId: "logi", key: "Warehouse", displayName: "仓库", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "whId", dataType: "string", isPrimaryKey: true }, { propKey: "setupCost", dataType: "number", isPrimaryKey: false }, { propKey: "serveCost", dataType: "number", isPrimaryKey: false }] });
  await t.repos.ontologyTypes.put({ id: "ot_store", tenantId: "logi", key: "Store", displayName: "门店", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "storeId", dataType: "string", isPrimaryKey: true }] });
  await t.repos.objects.put({ id: "w1", tenantId: "logi", type: "Warehouse", props: { whId: "WH_North", setupCost: 100, serveCost: 3 } });
  await t.repos.objects.put({ id: "w2", tenantId: "logi", type: "Warehouse", props: { whId: "WH_South", setupCost: 200, serveCost: 2 } });
  await t.repos.objects.put({ id: "s1", tenantId: "logi", type: "Store", props: { storeId: "ST_A" } });
  await t.repos.objects.put({ id: "s2", tenantId: "logi", type: "Store", props: { storeId: "ST_B" } });
}

async function seedHealth(t: Awaited<ReturnType<typeof makeApp>>) {
  // 医疗租户：诊所（建设成本）+ 社区。**同一模板，完全不同的本体类型/字段名。**
  await t.repos.ontologyTypes.put({ id: "ot_clinic", tenantId: "health", key: "Clinic", displayName: "诊所", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "clinicId", dataType: "string", isPrimaryKey: true }, { propKey: "buildCost", dataType: "number", isPrimaryKey: false }, { propKey: "reachCost", dataType: "number", isPrimaryKey: false }] });
  await t.repos.ontologyTypes.put({ id: "ot_comm", tenantId: "health", key: "Community", displayName: "社区", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "commId", dataType: "string", isPrimaryKey: true }] });
  await t.repos.objects.put({ id: "c1", tenantId: "health", type: "Clinic", props: { clinicId: "CL_East", buildCost: 50, reachCost: 1 } });
  await t.repos.objects.put({ id: "co1", tenantId: "health", type: "Community", props: { commId: "CM_1" } });
  await t.repos.objects.put({ id: "co2", tenantId: "health", type: "Community", props: { commId: "CM_2" } });
}

const logiBinding: OntologyBinding = {
  id: "bnd_logi", tenantId: "logi", templateKey: "facility_location", scope: {},
  roleBindings: [
    { role: "facility", bind: { kind: "objectType", ref: "Warehouse" } },
    { role: "client", bind: { kind: "objectType", ref: "Store" } },
    { role: "open_cost", bind: { kind: "property", ref: "Warehouse.setupCost" } },
    { role: "assign_cost", bind: { kind: "property", ref: "Warehouse.serveCost" } },
  ],
  coeffSource: "property", status: "PUBLISHED",
};

const healthBinding: OntologyBinding = {
  id: "bnd_health", tenantId: "health", templateKey: "facility_location", scope: {},
  roleBindings: [
    { role: "facility", bind: { kind: "objectType", ref: "Clinic" } },
    { role: "client", bind: { kind: "objectType", ref: "Community" } },
    { role: "open_cost", bind: { kind: "property", ref: "Clinic.buildCost" } },
    { role: "assign_cost", bind: { kind: "property", ref: "Clinic.reachCost" } },
  ],
  coeffSource: "property", status: "PUBLISHED",
};

describe("轨B·增量2 · 本体绑定层（R14 同模板绑两行业，代码零改）", () => {
  it("物流租户：facility_location 绑 仓库/门店 → 从 setupCost/serveCost 读系数组请求", async () => {
    const t = await makeApp();
    const mock = new MockFL();
    t.services.solvers.setOptimizer(mock);
    const ctx: AuthCtx = { tenantId: "logi", userId: "u", roles: ["admin"], attributes: {} };
    await seedLogistics(t);
    const out = await t.services.solvers.solveWithBinding(ctx, "facility_location", logiBinding);
    // 绑定层从本体类型化字段填出请求（系数=setupCost/serveCost，FUS4）。
    expect(mock.last!.facilities).toEqual([
      { id: "WH_North", openCost: 100 },
      { id: "WH_South", openCost: 200 },
    ]);
    expect(mock.last!.clients.map((c) => c.id)).toEqual(["ST_A", "ST_B"]);
    expect(mock.last!.assignCosts.find((a) => a.facility === "WH_North")!.cost).toBe(3);
    expect(out.status).toBe("OPTIMAL");
    expect((out.binding as { templateKey: string }).templateKey).toBe("facility_location");
  });

  it("医疗租户：同一 facility_location 模板绑 诊所/社区 → 不同本体不同请求（R14 零代码改）", async () => {
    const t = await makeApp();
    const mock = new MockFL();
    t.services.solvers.setOptimizer(mock);
    const ctx: AuthCtx = { tenantId: "health", userId: "u", roles: ["admin"], attributes: {} };
    await seedHealth(t);
    const out = await t.services.solvers.solveWithBinding(ctx, "facility_location", healthBinding);
    // 完全不同的类型/字段名，仍由同一模板+绑定层组出请求。
    expect(mock.last!.facilities).toEqual([{ id: "CL_East", openCost: 50 }]);
    expect(mock.last!.clients.map((c) => c.id)).toEqual(["CM_1", "CM_2"]);
    expect(mock.last!.assignCosts[0]!.cost).toBe(1);
    expect(out.status).toBe("OPTIMAL");
  });

  it("DF.8 接地（FUS3 去电池·多行业通用）：绑定引用本体外类型 → 报错", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockFL());
    const ctx: AuthCtx = { tenantId: "logi", userId: "u", roles: ["admin"], attributes: {} };
    await seedLogistics(t);
    const bad: OntologyBinding = { ...logiBinding, roleBindings: [{ role: "facility", bind: { kind: "objectType", ref: "Nonexistent" } }, { role: "client", bind: { kind: "objectType", ref: "Store" } }, { role: "open_cost", bind: { kind: "property", ref: "Warehouse.setupCost" } }] };
    await expect(t.services.solvers.solveWithBinding(ctx, "facility_location", bad)).rejects.toThrow(/接地失败|本体外/);
  });

  it("DF.8：绑定引用不存在的属性 → 报错（不静默造字段）", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockFL());
    const ctx: AuthCtx = { tenantId: "logi", userId: "u", roles: ["admin"], attributes: {} };
    await seedLogistics(t);
    const bad: OntologyBinding = { ...logiBinding, roleBindings: [...logiBinding.roleBindings.filter((r) => r.role !== "open_cost"), { role: "open_cost", bind: { kind: "property", ref: "Warehouse.ghostField" } }] };
    await expect(t.services.solvers.solveWithBinding(ctx, "facility_location", bad)).rejects.toThrow(/接地失败|ghostField/);
  });

  it("R2：绑定租户≠调用方 → 报错", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockFL());
    const ctx: AuthCtx = { tenantId: "other", userId: "u", roles: ["admin"], attributes: {} };
    await expect(t.services.solvers.solveWithBinding(ctx, "facility_location", logiBinding)).rejects.toThrow(/租户/);
  });
});
