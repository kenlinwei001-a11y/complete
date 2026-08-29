import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

/**
 * fde-delivery SOP「亲手用一遍 through the real endpoint」的耐久形态：4 个通用多跳求解器
 * 不只在 service 层(invoke())能跑,而是经真实 HTTP 路由 POST /a/v1/solvers/{key}/invoke
 * （含 entitlement 闸 + 鉴权 + zod 反序列化 + JSON 序列化）都返回 200 + 正确形状。
 * 这是单测 t.services.solvers.invoke 抓不到的"路由/契约/序列化"那一层。
 */
async function seedGraph(t: TestApp) {
  const ot = (key: string, props: { propKey: string; dataType: string; isPrimaryKey?: boolean; refToTypeKey?: string }[]) =>
    t.repos.ontologyTypes.put({ id: `ot_${key}`, tenantId: "demo", key, displayName: key, domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: props.map((p) => ({ isPrimaryKey: false, ...p })) as never });
  // 共享瓶颈 + 毛利：Proc / Ord
  await ot("Proc", [{ propKey: "procId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number" }]);
  await ot("Ord", [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "procRef", dataType: "ref", refToTypeKey: "Proc" }, { propKey: "qty", dataType: "number" }, { propKey: "prio", dataType: "number" }, { propKey: "revenue", dataType: "number" }, { propKey: "rawCost", dataType: "number" }]);
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_p1", tenantId: "demo", type: "Proc", props: { procId: "化成", capacity: 10 } });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_o1", tenantId: "demo", type: "Ord", props: { so: "星辰", procRef: "化成", qty: 7, prio: 3, revenue: 100, rawCost: 120 } });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_o2", tenantId: "demo", type: "Ord", props: { so: "蓝海", procRef: "化成", qty: 8, prio: 2, revenue: 100, rawCost: 130 } });
  // 集中度 + 断供半径：Supplier / Material / Order / Customer
  await ot("Supplier", [{ propKey: "supId", dataType: "string", isPrimaryKey: true }]);
  await ot("Material", [{ propKey: "matId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", refToTypeKey: "Supplier" }]);
  await ot("Order", [{ propKey: "soId", dataType: "string", isPrimaryKey: true }, { propKey: "materialRef", dataType: "ref", refToTypeKey: "Material" }]);
  await ot("Customer", [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", refToTypeKey: "Order" }]);
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "S1", tenantId: "demo", type: "Supplier", props: { supId: "华东电解液" } });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "M1", tenantId: "demo", type: "Material", props: { matId: "正极A", supplierRef: "华东电解液" } });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "M2", tenantId: "demo", type: "Material", props: { matId: "电解液B", supplierRef: "华东电解液" } });
  const orders: [string, string][] = [["SO1", "正极A"], ["SO2", "电解液B"], ["SO3", "正极A"]];
  for (const [so, mat] of orders) await t.repos.objects.put({ origin: { type: "MANUAL" }, id: so, tenantId: "demo", type: "Order", props: { soId: so, materialRef: mat } });
  const custs: [string, string][] = [["星辰", "SO1"], ["蓝海", "SO2"], ["远景", "SO3"]];
  for (const [c, so] of custs) await t.repos.objects.put({ origin: { type: "MANUAL" }, id: `c_${c}`, tenantId: "demo", type: "Customer", props: { custId: c, orderRef: so } });
}

const invoke = async (t: TestApp, key: string, args: Record<string, unknown>) =>
  t.app.inject({ method: "POST", url: `/a/v1/solvers/${key}/invoke`, headers: ADMIN, payload: { args } });

describe("通用多跳求解器 · 真实 HTTP 端到端（POST /a/v1/solvers/{key}/invoke）", () => {
  it("shared_bottleneck 经 HTTP → 200 + 化成瓶颈", async () => {
    const t = await makeApp();
    await seedGraph(t);
    const res = await invoke(t, "shared_bottleneck", { resourceType: "Proc", sharedByType: "Ord", viaField: "procRef", capacityField: "capacity", demandField: "qty", priorityField: "prio" });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { bottlenecks: { resourceId: string }[] } }).data;
    expect(out.bottlenecks.map((b) => b.resourceId)).toEqual(["化成"]);
  });

  it("concentration_risk 经 HTTP → 200 + 华东电解液敞口 3", async () => {
    const t = await makeApp();
    await seedGraph(t);
    const res = await invoke(t, "concentration_risk", { startType: "Customer", path: [{ viaField: "orderRef", toType: "Order" }, { viaField: "materialRef", toType: "Material" }, { viaField: "supplierRef", toType: "Supplier" }] });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { topExposure: { count: number } | null } }).data;
    expect(out.topExposure?.count).toBe(3);
  });

  it("margin_attribution 经 HTTP → 200 + 2 单倒挂", async () => {
    const t = await makeApp();
    await seedGraph(t);
    const res = await invoke(t, "margin_attribution", { targetType: "Ord", revenueField: "revenue", costFields: [{ field: "rawCost", label: "原料涨价" }] });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { invertedCount: number } }).data.invertedCount).toBe(2);
  });

  it("supplier_disruption_radius 经 HTTP → 200 + 半径 3 层", async () => {
    const t = await makeApp();
    await seedGraph(t);
    const res = await invoke(t, "supplier_disruption_radius", { rootType: "Supplier", rootId: "华东电解液", layers: [{ type: "Material", viaField: "supplierRef" }, { type: "Order", viaField: "materialRef" }, { type: "Customer", viaField: "orderRef" }] });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { radius: number; leafCount: number } }).data;
    expect(out.radius).toBe(3);
    expect(out.leafCount).toBe(3);
  });

  it("缺参经 HTTP → 非 200（错误信封,不静默空结果）", async () => {
    const t = await makeApp();
    await seedGraph(t);
    const res = await invoke(t, "concentration_risk", { startType: "Customer" });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((res.json() as { error?: { code: string } }).error).toBeTruthy();
  });
});
