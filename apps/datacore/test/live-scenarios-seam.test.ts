import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-LIVE-ENDPOINTS · 活③④ 方案存/分支/横比 SEAM（datacore 半·SimSession 复用·R9 双实现·往返一致）。
 *
 * 活③ 全局推演方案：POST 存 → GET 列 → POST /:id/branch 分支 → GET /compare 横比，KPI 七维往返字节一致，
 *   分支 parentId 链正确；方案快照不污染沙盘 session 列表（scope.snapshotKind 判别滤除）。
 * 活④ 产能页方案：capGain/cost 随 apply 真算（generic_inference 同款前向重算公式·改 apply→矩阵变·KILL-MOCK），
 *   门禁 view.global-sim.live（R3 先于 authz·关=404 FEATURE_NOT_FOUND）。
 */

const H = { ...ADMIN, "content-type": "application/json" };
const post = (t: TestApp, url: string, payload: unknown) =>
  t.app.inject({ method: "POST", url, headers: H, payload });
const get = (t: TestApp, url: string) => t.app.inject({ method: "GET", url, headers: ADMIN });

const KPI_A = { ontime: 11, cost: 2447944.8, changeoverHours: 3, freight: 10, fgInv: 5, transitInv: 2, margin: 100 };
const KPI_B = { ontime: 9, cost: 2010968.3, changeoverHours: 1, freight: 8, fgInv: 4, transitInv: 1, margin: 80 };
const KPI_BR = { ontime: 13, cost: 2500000, changeoverHours: 3, freight: 10, fgInv: 5, transitInv: 2, margin: 120 };

describe("WO-LIVE-ENDPOINTS · 活③ 全局推演方案 存/列/分支/横比（往返一致）", () => {
  it("存→列→分支→横比 KPI 七维往返一致 + 分支 parentId 链", async () => {
    const t = await makeApp();
    const a = await post(t, "/a/v1/sim/scenarios", { page: "global-sim", label: "最多按期", primary: "max_ontime", request: {}, kpi: KPI_A, servedCount: 11, displacedCount: 8, ontimeRate: 41 });
    expect(a.statusCode).toBe(201);
    const aid = a.json().id as string;
    expect(a.json().kpi).toEqual(KPI_A);
    expect(a.json().ontimeRate).toBe(41);

    const b = await post(t, "/a/v1/sim/scenarios", { page: "global-sim", label: "最低代价", primary: "min_cost", kpi: KPI_B, servedCount: 9, displacedCount: 8, ontimeRate: 33 });
    const bid = b.json().id as string;

    // GET 列（两方案都在）。
    const list = await get(t, "/a/v1/sim/scenarios?page=global-sim");
    expect(list.statusCode).toBe(200);
    expect((list.json().scenarios as { id: string }[]).map((s) => s.id).sort()).toEqual([aid, bid].sort());

    // 分支（parentId 链 + 新 KPI）。
    const br = await post(t, `/a/v1/sim/scenarios/${aid}/branch`, { label: "最多按期·扩通道", kpi: KPI_BR });
    expect(br.statusCode).toBe(201);
    expect(br.json().parentId).toBe(aid);
    expect(br.json().kpi).toEqual(KPI_BR);
    const brid = br.json().id as string;

    // 横比往返一致（三方案·kpi/served/displaced/ontimeRate）。
    const cmp = await get(t, `/a/v1/sim/scenarios/compare?ids=${aid},${bid},${brid}`);
    const cells = cmp.json().scenarios as { id: string; kpi: typeof KPI_A; servedCount: number; ontimeRate: number }[];
    expect(cells.length).toBe(3);
    expect(cells.find((c) => c.id === aid)!.kpi).toEqual(KPI_A);
    expect(cells.find((c) => c.id === brid)!.kpi).toEqual(KPI_BR);
    expect(cells.find((c) => c.id === bid)!.servedCount).toBe(9);
    await t.app.close();
  });

  it("方案快照不污染沙盘 session 列表（GET /a/v1/sim/sessions 按 snapshotKind 滤除）", async () => {
    const t = await makeApp();
    const a = await post(t, "/a/v1/sim/scenarios", { page: "global-sim", label: "x", kpi: KPI_A });
    const sessions = await get(t, "/a/v1/sim/sessions");
    expect(sessions.statusCode).toBe(200);
    expect((sessions.json().items as { id: string }[]).map((s) => s.id)).not.toContain(a.json().id);
    await t.app.close();
  });
});

describe("WO-LIVE-ENDPOINTS · 活④ 产能页方案 存/列/横比（改 apply → 矩阵变·KILL-MOCK）", () => {
  it("capGain 随 apply 真算 + outsource 触发 cost/ruleFlag", async () => {
    const t = await makeApp();
    const a = await post(t, "/a/v1/sim/live-scenarios", { baseId: "changzhou", name: "化成扩通道", apply: [{ objectType: "Process", objectId: "proc-coating", prop: "yield_baseline", value: 1.2 }] });
    expect(a.statusCode).toBe(201);
    expect(a.json().kpis.capGain).toBeCloseTo(0.2, 6); // 0.8*0.5 + 1.2*0.5 − 0.8 = 0.2
    expect(a.json().kpis.affected).toBe(1);

    const b = await post(t, "/a/v1/sim/live-scenarios", { baseId: "changzhou", name: "外协30%", apply: [{ objectType: "Line", objectId: "line-1", prop: "outsourceRatio", value: 0.3 }] });
    const bid = b.json().id as string;
    const aid = a.json().id as string;

    const list = await get(t, "/a/v1/sim/live-scenarios?baseId=changzhou");
    expect((list.json().scenarios as unknown[]).length).toBe(2);

    const cmp = await post(t, "/a/v1/sim/live-scenarios/compare", { ids: [aid, bid] });
    const rows = cmp.json().rows as { scenarioId: string; cells: { capGain: number; cost: number }; ruleFlag: boolean }[];
    const ra = rows.find((r) => r.scenarioId === aid)!;
    const rb = rows.find((r) => r.scenarioId === bid)!;
    expect(ra.cells.capGain).toBeCloseTo(0.2, 6);
    expect(ra.cells.cost).toBe(0);
    expect(ra.ruleFlag).toBe(false);
    expect(rb.cells.cost).toBe(15); // 0.3 * 50
    expect(rb.ruleFlag).toBe(true); // 0.3 ≥ 0.2 触发外协红线

    // 改 apply → capGain 变（KILL-MOCK·非写死示意）。
    const c = await post(t, "/a/v1/sim/live-scenarios", { baseId: "changzhou", name: "更大扩", apply: [{ objectType: "Process", objectId: "p", prop: "yield_baseline", value: 1.6 }] });
    expect(c.json().kpis.capGain).toBeCloseTo(0.4, 6);
    expect(c.json().kpis.capGain).not.toBe(a.json().kpis.capGain);
    await t.app.close();
  });

  it("view.global-sim.live 关 → 404 FEATURE_NOT_FOUND（R3 entitlement 先于 authz）", async () => {
    const t = await makeApp();
    const off = await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: H, payload: { overrides: { "view.global-sim.live": false } } });
    expect(off.statusCode).toBe(200);
    const res = await post(t, "/a/v1/sim/scenarios", { page: "global-sim", label: "x", kpi: KPI_A });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("FEATURE_NOT_FOUND");
    await t.app.close();
  });
});
