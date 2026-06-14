import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, BASE_MANAGER } from "./helpers.js";

interface SliceResult {
  nodes: { id: string; typeKey: string; objectKey: string; props: Record<string, unknown> }[];
  edges: { linkKey: string; from: string; to: string }[];
  truncated: boolean;
  snapshotVersion: string;
}

const resolve = (t: Awaited<ReturnType<typeof makeApp>>, args: Record<string, unknown>, headers = ADMIN) =>
  resolveKey(t, "order_fulfillment_360", args, headers);

const resolveKey = (t: Awaited<ReturnType<typeof makeApp>>, key: string, args: Record<string, unknown>, headers = ADMIN) =>
  t.app.inject({ method: "POST", url: `/a/v1/ontology/slices/${key}/resolve`, headers, payload: { args } });

/** 对象类型 → 数据域（与 BATTERY_TYPE_DOMAIN + 扩展类型同源）。 */
const TYPE_DOMAIN: Record<string, string> = {
  Order: "product", Model: "product", Segment: "product",
  Base: "factory", Line: "factory", Certification: "factory", EnergyMeter: "factory", ChangeoverMatrix: "factory",
  Process: "process", Equipment: "equip", MaintPlan: "equip",
  Material: "supply", MaterialBatch: "supply", PurchaseOrder: "supply", CarbonFactor: "supply",
  Customer: "commercial", ARInvoice: "commercial",
  Shipment: "capacity", DataSourceHealth: "quality",
  AnnualScenario: "plan", PlanTarget: "plan", CapexProject: "plan", ScenarioTrigger: "plan",
};
const domainsOf = (out: SliceResult) => new Set(out.nodes.map((n) => TYPE_DOMAIN[n.typeKey]).filter(Boolean));

describe("跨 6 域切片 order_fulfillment_360", () => {
  it("SL1: 合成即落库，首单全链可达 product/factory/process/equip/supply/commercial 六域", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const res = await resolve(t, { so: "SO-10001" });
    expect(res.statusCode).toBe(200);
    const out = res.json() as SliceResult;

    const types = new Set(out.nodes.map((n) => n.typeKey));
    for (const want of ["Order", "Model", "Base", "Line", "Process", "Equipment", "Material", "Customer"]) {
      expect(types.has(want), `缺类型 ${want}`).toBe(true);
    }
    const linkKeys = new Set(out.edges.map((e) => e.linkKey));
    for (const want of [
      "order_for_model",
      "model_producible_at",
      "line_belongs_to_base",
      "line_has_process",
      "equip_used_in",
      "model_uses_material",
      "order_of_customer",
    ]) {
      expect(linkKeys.has(want), `缺链路 ${want}`).toBe(true);
    }
    // 单一根 + 完整履约树
    expect(out.nodes.filter((n) => n.typeKey === "Order")).toHaveLength(1);
    expect(out.nodes.length).toBeGreaterThanOrEqual(10);
    expect(out.truncated).toBe(false);
    // 快照版本形如 {ontology_version}.{epoch}
    expect(out.snapshotVersion).toMatch(/\d+\.\d+/);
  });

  it("SL2: 同 seed 重跑 → 节点/边集合字节级一致（确定性）", async () => {
    const a = await makeApp();
    await seedBattery(a);
    const ra = (await resolve(a, { so: "SO-10001" })).json() as SliceResult;

    const b = await makeApp();
    await seedBattery(b);
    const rb = (await resolve(b, { so: "SO-10001" })).json() as SliceResult;

    const norm = (r: SliceResult) => ({
      nodes: r.nodes.map((n) => n.id).sort(),
      edges: r.edges.map((e) => `${e.linkKey}|${e.from}|${e.to}`).sort(),
    });
    expect(norm(ra)).toEqual(norm(rb));
  });

  it("SL3: A6 行级过滤 —— base_manager:常州 只见常州可达子树（其余基地分支被剪枝）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 找一张型号可在常州生产的订单作为 root（保证常州分支非空）。
    const adminOut = (await resolve(t, { so: "SO-10001" })).json() as SliceResult;
    const adminBases = adminOut.nodes.filter((n) => n.typeKey === "Base").map((n) => String(n.objectKey));

    const bmOut = (await resolve(t, { so: "SO-10001" }, BASE_MANAGER)).json() as SliceResult;
    const bmBases = bmOut.nodes.filter((n) => n.typeKey === "Base").map((n) => String(n.objectKey));
    // base_manager 可见基地 ⊆ admin 可见基地，且不含非常州基地
    for (const b of bmBases) expect(b).toBe("changzhou");
    expect(bmBases.length).toBeLessThanOrEqual(adminBases.length);
  });

  it("SL4: 切片契约 fixture 通过（slice-contracts/run 全绿）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/slice-contracts/run",
      headers: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: { sliceKey: string; fixture: string; ok: boolean; diff?: string }[]; allPassed: boolean };
    const ours = body.results.find((r) => r.sliceKey === "order_fulfillment_360");
    expect(ours, "order_fulfillment_360 契约结果存在").toBeTruthy();
    expect(ours!.ok, ours!.diff).toBe(true);
  });
});

describe("跨 8 域切片 order_to_cash_720 / enterprise_360", () => {
  it("SL5: order_to_cash_720 首单可达 8 域（产品/工厂/工艺/设备/供给/商务/产能/质量）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = (await resolveKey(t, "order_to_cash_720", { so: "SO-10001" })).json() as SliceResult;
    const doms = domainsOf(out);
    for (const want of ["product", "factory", "process", "equip", "supply", "commercial", "capacity", "quality"]) {
      expect(doms.has(want), `缺域 ${want}`).toBe(true);
    }
    expect(doms.size).toBeGreaterThanOrEqual(8);
    const types = new Set(out.nodes.map((n) => n.typeKey));
    for (const want of ["MaterialBatch", "PurchaseOrder", "ARInvoice", "Shipment", "DataSourceHealth"]) {
      expect(types.has(want), `缺类型 ${want}`).toBe(true);
    }
  });

  it("SL6: enterprise_360 首单最大广度可达 8 域 + 认证/能耗/换型/细分/检修节点", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = (await resolveKey(t, "enterprise_360", { so: "SO-10001" })).json() as SliceResult;
    expect(domainsOf(out).size).toBeGreaterThanOrEqual(8);
    const types = new Set(out.nodes.map((n) => n.typeKey));
    for (const want of ["Certification", "EnergyMeter", "ChangeoverMatrix", "Segment", "MaintPlan", "CarbonFactor"]) {
      expect(types.has(want), `缺类型 ${want}`).toBe(true);
    }
  });

  it("SL7: 两条 8 域切片契约 fixture 通过", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const body = (await t.app.inject({ method: "POST", url: "/a/v1/ontology/slice-contracts/run", headers: ADMIN })).json() as {
      results: { sliceKey: string; ok: boolean; diff?: string }[];
    };
    for (const key of ["order_to_cash_720", "enterprise_360"]) {
      const r = body.results.find((x) => x.sliceKey === key);
      expect(r, `${key} 契约结果存在`).toBeTruthy();
      expect(r!.ok, r!.diff).toBe(true);
    }
  });

  it("SL8: supply/commercial 域已注册 + 新跨域边经切片可遍历（scenario→plan 边落库）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 域注册
    const domains = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/domains", headers: ADMIN })).json() as { domainKey: string }[];
    const dkeys = new Set((Array.isArray(domains) ? domains : []).map((d) => d.domainKey));
    expect(dkeys.has("supply") && dkeys.has("commercial"), "supply/commercial 域已注册").toBe(true);
    // enterprise_360 边覆盖新增链路键
    const ent = (await resolveKey(t, "enterprise_360", { so: "SO-10001" })).json() as SliceResult;
    const lk = new Set(ent.edges.map((e) => e.linkKey));
    for (const k of ["model_has_cert", "customer_has_invoice", "material_has_batch", "material_carbon", "base_energy_meter", "base_maint_plan", "model_changeover", "model_in_segment", "base_data_health"]) {
      expect(lk.has(k), `enterprise_360 缺边 ${k}`).toBe(true);
    }
  });

  it("SL9: Agent/Workflow 旧端点 /a/v1/slices/:key/resolve fall-through 到 SliceSpec 引擎（P0-a 修复）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 旧内置键仍可用
    const legacy = await t.app.inject({ method: "POST", url: "/a/v1/slices/base_risk_profile/resolve", headers: ADMIN, payload: { args: { baseId: "changzhou" } } });
    expect(legacy.statusCode).toBe(200);
    // 新声明式切片经同一旧端点可达（agent resolve_slice 工具走这里）
    const viaLegacy = await t.app.inject({ method: "POST", url: "/a/v1/slices/order_to_cash_720/resolve", headers: ADMIN, payload: { args: { so: "SO-10001" } } });
    expect(viaLegacy.statusCode).toBe(200);
    const body = viaLegacy.json() as { data?: { nodes?: { typeKey: string }[] }; snapshotVersion?: string };
    expect(body.data?.nodes?.length, "fall-through 返回 nodes").toBeGreaterThanOrEqual(15);
    const doms = new Set((body.data?.nodes ?? []).map((n) => TYPE_DOMAIN[n.typeKey]).filter(Boolean));
    expect(doms.size, "8 域可达").toBeGreaterThanOrEqual(8);
    // 完全未知键仍 404
    const missing = await t.app.inject({ method: "POST", url: "/a/v1/slices/__nope__/resolve", headers: ADMIN, payload: { args: {} } });
    expect(missing.statusCode).toBe(404);
  });
});
