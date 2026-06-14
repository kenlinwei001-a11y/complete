import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

const query = (t: TestApp, objectType: string) =>
  t.app
    .inject({ method: "POST", url: "/a/v1/objects/query", headers: ADMIN, payload: { objectType, filter: {}, limit: 500 } })
    .then((r) => (r.json() as { data: { props: Record<string, unknown> }[] }).data);

describe("E6b · GenSpec 扩展：13 求解器所需对象数据（确定性 + 戏剧点植入）", () => {
  it("合成作业生成扩展对象类型（§7 计数）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect((await query(t, "Material")).length).toBe(8);
    expect((await query(t, "Certification")).length).toBe(18);
    expect((await query(t, "Customer")).length).toBe(6);
    expect((await query(t, "CapexProject")).length).toBe(3);
    expect((await query(t, "PurchaseOrder")).length).toBe(30);
    expect((await query(t, "MaterialBatch")).length).toBe(24);
  });

  it("戏剧点植入：商用车集团G 逾期 38 天 / ≥6 批呆滞>90日 / 2 单 PO 延迟", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = (await query(t, "Customer")).find((c) => c.props.custName === "商用车集团G");
    expect(g!.props.maxOverdueDays).toBe(38);
    const dormant = (await query(t, "MaterialBatch")).filter((b) => Number(b.props.idleDays) > 90);
    expect(dormant.length).toBeGreaterThanOrEqual(6);
    const delayed = (await query(t, "PurchaseOrder")).filter((po) => po.props.delayed === true);
    expect(delayed.length).toBe(2);
  });

  it("确定性：同 seed 重跑，扩展数据字节级一致", async () => {
    const a = await makeApp();
    await seedBattery(a, 42);
    const b = await makeApp();
    await seedBattery(b, 42);
    const matsA = (await query(a, "Material")).map((m) => m.props).sort((x, y) => (String(x.matId) < String(y.matId) ? -1 : 1));
    const matsB = (await query(b, "Material")).map((m) => m.props).sort((x, y) => (String(x.matId) < String(y.matId) ? -1 : 1));
    expect(matsB).toEqual(matsA);
  });
});

describe("E6b · 求解器从对象数据自动出结果（presetContext 槽位即可，无需手传 args）", () => {
  it("credit_exposure {custName:商用车集团G} → 从 Customer/ARInvoice 推导 → 逾期冻结", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = (await invokeSolver(t, "credit_exposure", { custName: "商用车集团G" })).json().data as { newOrderVerdict: string; exposure: number };
    expect(r.newOrderVerdict).toContain("冻结"); // C32 逾期>30 优先
    expect(typeof r.exposure).toBe("number");
  });

  it("inventory_optimize {} → 从 Material/MaterialBatch 推导 → 呆滞清单非空", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = (await invokeSolver(t, "inventory_optimize", {})).json().data as { idle: unknown[]; releasableCash: number };
    expect(r.idle.length).toBeGreaterThanOrEqual(6); // 6 呆滞批次
    expect(typeof r.releasableCash).toBe("number");
  });

  it("cert_schedule {} → 从 Certification 推导 → 排期非空且受 C26 约束", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = (await invokeSolver(t, "cert_schedule", {})).json().data as { schedule: unknown[]; engineerGroups: number };
    expect(r.schedule.length).toBeGreaterThan(0); // 认证中4+待认证2 = 6 项待排
    expect(r.engineerGroups).toBe(3);
  });

  it("carbon_footprint {modelId,baseName} → 从 Material/EnergyMeter 推导 → 出总值与判定", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = (await invokeSolver(t, "carbon_footprint", { modelId: "4680-NCM", baseName: "成都" })).json().data as { total: number; verdict: string; breakdown: { materialCarbon: number } };
    expect(r.total).toBeGreaterThan(0);
    expect(["达标", "超标"]).toContain(r.verdict);
    expect(r.breakdown.materialCarbon).toBeGreaterThan(0);
  });

  it("kit_readiness {} → 从 Order/Material 推导 → 逐单齐套率出结果", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = (await invokeSolver(t, "kit_readiness", {})).json().data as { rows: { kitRatio: number }[] };
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
