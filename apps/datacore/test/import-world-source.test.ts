import { describe, it, expect } from "vitest";
import { makeApp, seedBattery, invokeSolver, b64, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-IMPORT-REPLACE-SYNTHETIC (G4) · 世界态源开关（synthetic|imported·PRD §3.4·配 WO-CAP-01 REALDEMAND）。
 *
 * 复验返工（KILL-MOCK-RED 命门·2026-07-11）：world_source=imported **只在有真导入 provenance 对象**（origin=MATERIALIZED
 * 且源连接 classifySourceOrigin=real-sourced·非 mock/synthetic）时翻开实值杠杆 qos.risk_realdemand——否则拒绝翻，
 * **不让合成物化在 imported 下自报 LIVE 决策红**。⛔ R14 不改求解器内部（只按 provenance 门控既有杠杆）。
 */

const ADMIN_HDR = (tenant: string) => ({ "x-debug-user": `${tenant}:u1:admin|catalog_admin` });

async function enableFeatures(t: TestApp, tenant: string, keys: string[]): Promise<void> {
  const overrides = Object.fromEntries(keys.map((k) => [k, true]));
  const res = await t.app.inject({ method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers: ADMIN_HDR(tenant), payload: { overrides } });
  if (res.statusCode !== 200) throw new Error(`enable failed: ${res.body}`);
}

const putWS = (t: TestApp, worldSource: string, headers = ADMIN) => t.app.inject({ method: "PUT", url: "/a/v1/world-source", headers, payload: { worldSource } });
const getWS = (t: TestApp, headers = ADMIN) => t.app.inject({ method: "GET", url: "/a/v1/world-source", headers });

const FACTORY_CSV = "factory_id,name,capacity_gwh\nF001,常州,51\nF002,厦门,40\nF003,成都,33\n";

/** 真导入正门：新租户 upload 真 CSV（file_upload=real-sourced）→ derive-batch 归域发布物化 → 真导入 provenance 对象。 */
async function seedRealImport(t: TestApp, tenant: string): Promise<void> {
  const H = ADMIN_HDR(tenant);
  await t.repos.tenants.put({ id: tenant, tenantId: tenant, name: tenant });
  await enableFeatures(t, tenant, ["data-import.multitable", "data-import.world-source"]);
  const up = (await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: H, payload: { filename: "factory.csv", contentBase64: b64(FACTORY_CSV) } })).json() as { connId: string };
  const rds = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${up.connId}`, headers: H })).json() as { id: string }[];
  const res = await t.app.inject({ method: "POST", url: "/a/v1/modeling/derive-batch", headers: H, payload: { rawDatasetIds: [rds[0]!.id], domains: { Factory: "factory" }, autoPublish: true, autoMaterialize: true } });
  const d = res.json() as { materialize: { created: number } | null };
  if (!d.materialize || d.materialize.created < 1) throw new Error(`real import materialize failed: ${res.body}`);
}

describe("WO-IMPORT-REPLACE-SYNTHETIC (G4) · 世界态源开关（provenance 命门）", () => {
  it("暗发门（R3）：新租户 feature 关 → GET/PUT /world-source 返回 404", async () => {
    const t = await makeApp();
    expect((await getWS(t, ADMIN_HDR("wsoff"))).statusCode).toBe(404);
    expect((await putWS(t, "imported", ADMIN_HDR("wsoff"))).statusCode).toBe(404);
  });

  it("真导入 provenance：upload 真 CSV→derive-batch 物化 → imported 翻开杠杆且 leverSourcedFromRealImports=true·逐值溯源", async () => {
    const t = await makeApp();
    await seedRealImport(t, "wsreal");
    const H = ADMIN_HDR("wsreal");
    // 物化对象值来自真 CSV（逐值溯源·非 hash）。
    const objs = (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Factory", headers: H })).json() as { items: { props: Record<string, unknown> }[] };
    expect(objs.items).toHaveLength(3);
    expect(String(objs.items.find((o) => o.props.factory_id === "F001")!.props.capacity_gwh)).toBe("51");
    // imported：有真导入 provenance → 杠杆开、且标记真值支撑、无合成冒充 warning。
    const imp = (await putWS(t, "imported", H)).json() as { worldSource: string; realValueLeverEnabled: boolean; leverSourcedFromRealImports: boolean; realImportedObjectCount: number; warnings: string[] };
    expect(imp.worldSource).toBe("imported");
    expect(imp.realImportedObjectCount).toBe(3);
    expect(imp.realValueLeverEnabled).toBe(true);
    expect(imp.leverSourcedFromRealImports).toBe(true);
    expect(imp.warnings).toEqual([]);
  });

  it("KILL-MOCK-RED 命门：全合成租户（0 真导入）→ imported **拒绝翻杠杆** + warning（合成不得自报 LIVE）", async () => {
    const t = await makeApp();
    await seedBattery(t); // demo 全合成世界态（synthetic job·origin=SYNTHETIC / mock_erp+config.synthetic=true）。
    // 全合成（SYNTHETIC 或 synthetic-source MATERIALIZED）→ 真导入 provenance 对象 0（classifySourceOrigin 非 real-sourced）。
    const beforePut = (await getWS(t)).json() as { realImportedObjectCount: number };
    expect(beforePut.realImportedObjectCount).toBe(0);
    const imp = (await putWS(t, "imported")).json() as { worldSource: string; realValueLeverEnabled: boolean; leverSourcedFromRealImports: boolean; warnings: string[] };
    expect(imp.worldSource).toBe("imported");
    expect(imp.realValueLeverEnabled).toBe(false); // 拒绝翻杠杆（合成不得自报 LIVE）
    expect(imp.leverSourcedFromRealImports).toBe(false);
    expect(imp.warnings.some((w) => w.includes("无真导入 provenance"))).toBe(true);
  });

  it("KILL-MOCK-RED 真证据：全合成租户 imported 下 risk_timeline 输出 == synthetic（杠杆未翻·合成未被冒充成 LIVE）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await putWS(t, "imported");
    const impOut = (await invokeSolver(t, "risk_timeline", {})).json();
    await putWS(t, "synthetic");
    const synOut = (await invokeSolver(t, "risk_timeline", {})).json();
    // 命门：合成世界态 imported 不翻杠杆 → 与 synthetic 同输出（不制造 LIVE 决策红假象）。
    expect(JSON.stringify(impOut)).toBe(JSON.stringify(synOut));
  });

  it("标签=行为：world_source=synthetic 但模板默认开杠杆 → 诚实 warning（合成可能自报 LIVE·消除默认态标签≠行为）", async () => {
    const t = await makeApp();
    const s = (await getWS(t)).json() as { worldSource: string; realValueLeverEnabled: boolean; warnings: string[] };
    expect(s.worldSource).toBe("synthetic");
    // demo/battery 模板 features=[...ALL_FEATURE_KEYS] → qos.risk_realdemand 默认开。
    expect(s.realValueLeverEnabled).toBe(true);
    expect(s.warnings.some((w) => w.includes("模板默认"))).toBe(true);
  });

  it("合并不覆盖 + 显式回退：PUT synthetic 显式关杠杆（标签=行为）且保留其它 override（opt.solver-pool）", async () => {
    const t = await makeApp();
    const syn = (await putWS(t, "synthetic")).json() as { realValueLeverEnabled: boolean };
    expect(syn.realValueLeverEnabled).toBe(false); // 显式关（消除默认态标签≠行为）
    const feats = (await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features", headers: ADMIN })).json() as { features: string[] };
    expect(feats.features).toContain("opt.solver-pool"); // seed 的其它 override 不丢
    expect(feats.features).not.toContain("qos.risk_realdemand"); // 已显式关
  });

  it("authz：非 admin PUT → 403", async () => {
    const t = await makeApp();
    expect((await putWS(t, "imported", { "x-debug-user": "demo:u2:planner" })).statusCode).toBe(403);
  });
});
