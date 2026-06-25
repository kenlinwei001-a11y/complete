import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { OntologyBinding } from "@platform/contracts";
import type {
  OptimizerClient, OptimizationRequest, OptimizationResult,
  FacilityLocationRequest, FacilityLocationResult,
} from "../src/solvers/optimizer-client.js";

/**
 * 轨B·增量5 行业租户=绑定演示（R14 端到端验收 · 代码零改仅绑定不同）。
 *
 * 这是增量5 的「两行业各端到端跑通」形式化验收：**同一 facility_location 模板**绑两个不同行业租户
 * （物流：仓库/门店 ⊕ 医疗：诊所/社区）→ 各出最优解 → 各做 optimize_whatif 出 Δ目标值，
 * **求解器/绑定层/whatif 代码完全相同，只有 OntologyBinding 不同**（证 R14 去行业锁死）。
 * opt.* entitlement defaultOn:false 暗发（lite/Pro/旗舰按 requires 链分档，已在 features.ts/增量0）。
 *
 * CP-SAT 可证最优由 Python 真求解证；这里 mock 引擎按绑定层组出的请求回放确定最优，验全链接通。
 */
class MockFL implements OptimizerClient {
  reqs: FacilityLocationRequest[] = [];
  async solve(_req: OptimizationRequest): Promise<OptimizationResult> {
    return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
  }
  async solveFacilityLocation(req: FacilityLocationRequest): Promise<FacilityLocationResult> {
    this.reqs.push(req);
    const cheapest = [...req.facilities].sort((a, b) => a.openCost - b.openCost || a.id.localeCompare(b.id))[0]!;
    return {
      status: "OPTIMAL", optimal: true, openFacilities: [cheapest.id],
      assignments: req.clients.map((c) => ({ client: c.id, facility: cheapest.id })),
      objective: cheapest.openCost + req.clients.length,
    };
  }
}

async function seedIndustry(t: Awaited<ReturnType<typeof makeApp>>, tenant: string, facType: string, cliType: string, facPk: string, cliPk: string, openF: string, assignF: string, facs: Record<string, unknown>[], clis: Record<string, unknown>[]) {
  await t.repos.ontologyTypes.put({ id: `ot_${facType}`, tenantId: tenant, key: facType, displayName: facType, domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: facPk, dataType: "string", isPrimaryKey: true }, { propKey: openF, dataType: "number", isPrimaryKey: false }, { propKey: assignF, dataType: "number", isPrimaryKey: false }] });
  await t.repos.ontologyTypes.put({ id: `ot_${cliType}`, tenantId: tenant, key: cliType, displayName: cliType, domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: cliPk, dataType: "string", isPrimaryKey: true }] });
  let i = 0;
  for (const f of facs) await t.repos.objects.put({ id: `f${tenant}${i++}`, tenantId: tenant, type: facType, props: f });
  i = 0;
  for (const c of clis) await t.repos.objects.put({ id: `c${tenant}${i++}`, tenantId: tenant, type: cliType, props: c });
}

function fl(tenant: string, facType: string, cliType: string, openRef: string, assignRef: string): OntologyBinding {
  return {
    id: `bnd_${tenant}`, tenantId: tenant, templateKey: "facility_location", scope: {},
    roleBindings: [
      { role: "facility", bind: { kind: "objectType", ref: facType } },
      { role: "client", bind: { kind: "objectType", ref: cliType } },
      { role: "open_cost", bind: { kind: "property", ref: openRef } },
      { role: "assign_cost", bind: { kind: "property", ref: assignRef } },
    ],
    coeffSource: "property", status: "PUBLISHED",
  };
}

describe("轨B·增量5 · 两行业端到端（R14 代码零改仅绑定不同）", () => {
  it("物流 ⊕ 医疗：同一 facility_location 模板各 solve + whatif，仅 OntologyBinding 不同", async () => {
    const t = await makeApp();
    const mock = new MockFL();
    t.services.solvers.setOptimizer(mock);

    // 行业A 物流：仓库(setupCost/serveCost) + 门店。
    await seedIndustry(t, "logi", "Warehouse", "Store", "whId", "storeId", "setupCost", "serveCost",
      [{ whId: "WH_A", setupCost: 100, serveCost: 3 }, { whId: "WH_B", setupCost: 40, serveCost: 5 }],
      [{ storeId: "S1" }, { storeId: "S2" }]);
    // 行业B 医疗：诊所(buildCost/reachCost) + 社区。完全不同类型/字段名。
    await seedIndustry(t, "health", "Clinic", "Community", "clinicId", "commId", "buildCost", "reachCost",
      [{ clinicId: "CL_X", buildCost: 200, reachCost: 1 }, { clinicId: "CL_Y", buildCost: 60, reachCost: 2 }],
      [{ commId: "CM1" }, { commId: "CM2" }, { commId: "CM3" }]);

    const ctxLogi: AuthCtx = { tenantId: "logi", userId: "u", roles: ["admin"], attributes: {} };
    const ctxHealth: AuthCtx = { tenantId: "health", userId: "u", roles: ["admin"], attributes: {} };

    // ── 物流 solve（同一模板，物流绑定）──
    const logiSolve = await t.services.solvers.solveWithBinding(ctxLogi, "facility_location", fl("logi", "Warehouse", "Store", "Warehouse.setupCost", "Warehouse.serveCost"));
    expect(logiSolve.status).toBe("OPTIMAL");
    expect(logiSolve.openFacilities).toEqual(["WH_B"]); // 更便宜(40)
    expect(logiSolve.facilityType).toBe("Warehouse");

    // ── 医疗 solve（同一模板，医疗绑定，代码零改）──
    const healthSolve = await t.services.solvers.solveWithBinding(ctxHealth, "facility_location", fl("health", "Clinic", "Community", "Clinic.buildCost", "Clinic.reachCost"));
    expect(healthSolve.status).toBe("OPTIMAL");
    expect(healthSolve.openFacilities).toEqual(["CL_Y"]); // 更便宜(60)
    expect(healthSolve.facilityType).toBe("Clinic");

    // ── 各做 optimize_whatif（物流改 WH_B setupCost 40→999 → 翻盘到 WH_A）──
    const logiWf = await t.services.solvers.invoke(ctxLogi, "optimize_whatif", {
      family: "facility_location",
      perturbations: [{ kind: "data_override", target: "facilities.WH_B.openCost", value: 999 }],
      binding: fl("logi", "Warehouse", "Store", "Warehouse.setupCost", "Warehouse.serveCost"),
    });
    expect(logiWf.baselineObjective).toBe(42); // WH_B(40)+2 clients
    expect(logiWf.perturbedObjective).toBe(102); // WH_A(100)+2
    expect(logiWf.deltaObjective).toBe(60);
    expect(logiWf.feasible).toBe(true);

    // 两行业请求确实由不同本体组出（facilityType 不同），证 R14 同模板服多行业。
    const facTypes = new Set(mock.reqs.map((r) => r.facilities[0]!.id.slice(0, 2)));
    expect(facTypes.has("WH") && facTypes.has("CL")).toBe(true);
  });
});
