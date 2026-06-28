import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { bindToSolverArgs, type BindingOntologyView } from "../src/solvers/opt-binding.js";
import type { OntologyBinding } from "@platform/contracts";

/**
 * G-12 收口（增量B·U2）· 内置非电池行业模板「物流仓配」真立世界（确定性 R6·无 LLM·非 mock）。
 *
 * 验收：① synthetic.runJob(logistics-warehouse) 经 instantiateGeneric 真物化 Warehouse/Store（已发布对象类型 + FK 一致对象）
 *      ② R6 同 (seed,scale) 重跑字节一致 ③ bindToSolverArgs(facility_location) 从该世界组出正确 facilities/clients/assignCosts
 *      （= 与电池租户同一模板/绑定层代码，仅本体不同 → R14 去行业锁死）。
 * 真 CP-SAT 求最优由 `opt-real-sidecar.integration.test.ts`（env-gated 真 sidecar）证；此处证「世界 + 绑定 args」确定性接通。
 */
const ctxFor = (tenantId: string): AuthCtx => ({ tenantId, userId: "u", roles: ["admin"], attributes: {} });

async function worldOf(tenantId: string) {
  const t = await makeApp({ seed: false });
  const ctx = ctxFor(tenantId);
  await t.services.synthetic.runJob(ctx, { industry: "logistics-warehouse", scale: "S", seed: 42 });
  const warehouses = (await t.repos.objects.listByType(tenantId, "Warehouse")).sort((a, b) => a.id.localeCompare(b.id));
  const stores = (await t.repos.objects.listByType(tenantId, "Store")).sort((a, b) => a.id.localeCompare(b.id));
  const types = await t.repos.ontologyTypes.list(tenantId);
  return { t, ctx, warehouses, stores, types };
}

describe("G-12 收口·增量B · 内置物流行业模板真立世界（R6/R14·非电池·非 LLM）", () => {
  it("① synthetic.runJob 真物化 Warehouse/Store（S 档 6 仓 + 10 店）+ 类型已发布 ACTIVE", async () => {
    const { warehouses, stores, types } = await worldOf("logi1");
    expect(warehouses.length).toBe(6);
    expect(stores.length).toBe(10);
    // 类型已发布（绑定层 DF.8 接地要求 ACTIVE）。
    const wh = types.find((t) => t.key === "Warehouse");
    const st = types.find((t) => t.key === "Store");
    expect(wh?.status).toBe("ACTIVE");
    expect(st?.status).toBe("ACTIVE");
    // 仓库带抽象 role 字段（零业务常数 R14）。
    const p0 = warehouses[0]!.props as Record<string, unknown>;
    expect(typeof p0.openCost).toBe("number");
    expect(typeof p0.serveCost).toBe("number");
    expect(typeof p0.whId).toBe("string");
  });

  it("② R6：同 (seed=42, scale=S) 两次 runJob 字节一致（whId/openCost/serveCost 全等）", async () => {
    const a = await worldOf("logiA");
    const b = await worldOf("logiB");
    const proj = (objs: typeof a.warehouses) =>
      objs.map((o) => {
        const p = o.props as Record<string, unknown>;
        return `${p.whId}|${p.openCost}|${p.serveCost}|${p.region}`;
      });
    expect(proj(a.warehouses)).toEqual(proj(b.warehouses));
    const projS = (objs: typeof a.stores) => objs.map((o) => { const p = o.props as Record<string, unknown>; return `${p.storeId}|${p.demand}`; });
    expect(projS(a.stores)).toEqual(projS(b.stores));
  });

  it("③ bindToSolverArgs(facility_location) 从物流世界组出正确 args（同电池绑定层代码·R14）", async () => {
    const { t } = await worldOf("logi3");
    const view: BindingOntologyView = {
      listTypes: (tid) => t.repos.ontologyTypes.list(tid),
      listByType: (tid, key) => t.repos.objects.listByType(tid, key),
    };
    const binding: OntologyBinding = {
      id: "b", tenantId: "logi3", templateKey: "facility_location", scope: {},
      roleBindings: [
        { role: "facility", bind: { kind: "objectType", ref: "Warehouse" } },
        { role: "client", bind: { kind: "objectType", ref: "Store" } },
        { role: "open_cost", bind: { kind: "property", ref: "Warehouse.openCost" } },
        { role: "assign_cost", bind: { kind: "property", ref: "Warehouse.serveCost" } },
      ],
      coeffSource: "property", status: "PUBLISHED",
    };
    const args = await bindToSolverArgs(view, "facility_location", binding, { seed: 42 });
    const facilities = args.facilities as { id: string; openCost: number }[];
    const clients = args.clients as { id: string }[];
    const assignCosts = args.assignCosts as { client: string; facility: string; cost: number }[];
    expect(facilities.length).toBe(6);
    expect(clients.length).toBe(10);
    expect(assignCosts.length).toBe(60); // 完全图 6×10
    expect(facilities.every((f) => Number.isFinite(f.openCost))).toBe(true);
    expect(args.facilityType).toBe("Warehouse");
    expect(args.clientType).toBe("Store");
  });
});
