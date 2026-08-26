import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { resolveFieldRoles, SOLVER_FIELD_ROLES, type RoleResolverType } from "../src/solvers/field-roles.js";
import type { FieldRoleResolution } from "@platform/contracts";

// 客户→订单→物料→供应商 链（供应商被引用最多 = 断供根/汇点）。
const CHAIN: RoleResolverType[] = [
  { typeKey: "Customer", properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", refToTypeKey: "Order" }] },
  { typeKey: "Order", properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "materialRef", dataType: "ref", refToTypeKey: "Material" }] },
  { typeKey: "Material", properties: [{ propKey: "mat", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", refToTypeKey: "Supplier" }] },
  { typeKey: "Supplier", properties: [{ propKey: "sup", dataType: "string", isPrimaryKey: true }] },
];

describe("A13 · 地板语义确定化（resolveFieldRoles 纯函数，去 LLM）", () => {
  it("supplier_disruption_radius：rootType = 被引用最多的汇点（Supplier），无 LLM", () => {
    const r = resolveFieldRoles(CHAIN, "supplier_disruption_radius");
    expect(r.roles.rootType).toBe("Supplier"); // 命名命中 source + fanIn
    expect(r.candidates.rootType![0]!.value).toBe("Supplier");
    expect(r.candidates.rootType![0]!.signals.some((s) => s.startsWith("fanIn"))).toBe(true);
  });

  it("R6 确定性：同 (types, solverKey) 字节一致", () => {
    expect(JSON.stringify(resolveFieldRoles(CHAIN, "supplier_disruption_radius"))).toBe(JSON.stringify(resolveFieldRoles(CHAIN, "supplier_disruption_radius")));
    // 输入顺序打乱不改结果（内部排序）
    expect(JSON.stringify(resolveFieldRoles([...CHAIN].reverse(), "supplier_disruption_radius"))).toBe(JSON.stringify(resolveFieldRoles(CHAIN, "supplier_disruption_radius")));
  });

  it("真歧义返回确定性候选 + ambiguous（两个同分汇点 → 字典序 top1，不调 LLM）", () => {
    // 两个供应商都被一个物料引用一次 → fanIn 同分，命名都命中 → 歧义。
    const tie: RoleResolverType[] = [
      { typeKey: "Part", properties: [{ propKey: "m", dataType: "string", isPrimaryKey: true }, { propKey: "supAref", dataType: "ref", refToTypeKey: "SupplierA" }, { propKey: "supBref", dataType: "ref", refToTypeKey: "SupplierB" }] },
      { typeKey: "SupplierA", properties: [{ propKey: "a", dataType: "string", isPrimaryKey: true }] },
      { typeKey: "SupplierB", properties: [{ propKey: "b", dataType: "string", isPrimaryKey: true }] },
    ];
    const r = resolveFieldRoles(tie, "supplier_disruption_radius");
    expect(r.ambiguous).toBe(true); // top1/top2 同分 → 真歧义
    expect(r.roles.rootType).toBe("SupplierA"); // 字典序 top1 作确定性默认（非随机/LLM）
    expect(r.candidates.rootType!.map((c) => c.value)).toEqual(["SupplierA", "SupplierB"]);
  });

  it("shared_bottleneck：resourceType(有产能字段+被引用) + sharedByType(有需求字段+ref) + priorityField", () => {
    const types: RoleResolverType[] = [
      { typeKey: "Process", properties: [{ propKey: "pid", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number" }] },
      { typeKey: "Order", properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "procRef", dataType: "ref", refToTypeKey: "Process" }, { propKey: "qty", dataType: "number" }, { propKey: "priority", dataType: "number" }] },
    ];
    const r = resolveFieldRoles(types, "shared_bottleneck");
    expect(r.roles.resourceType).toBe("Process");
    expect(r.roles.sharedByType).toBe("Order");
    expect(r.roles.priorityField).toBe("priority"); // 地板字段命名命中
  });

  it("SOLVER_FIELD_ROLES 覆盖 4 个通用图求解器", () => {
    expect(Object.keys(SOLVER_FIELD_ROLES).sort()).toEqual(["concentration_risk", "margin_attribution", "shared_bottleneck", "supplier_disruption_radius"]);
  });
});

describe("A13 · 端点（真服务 · 本租户本体图）", () => {
  it("GET /a/v1/solvers/:key/field-roles 返回确定性解析 + 候选/置信度", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = (await t.app.inject({ method: "GET", url: "/a/v1/solvers/supplier_disruption_radius/field-roles", headers: ADMIN })).json() as FieldRoleResolution;
    expect(r.solverKey).toBe("supplier_disruption_radius");
    expect(typeof r.confidence).toBe("number");
    expect(typeof r.ambiguous).toBe("boolean");
    expect(r.candidates.rootType).toBeDefined();
  });
});
