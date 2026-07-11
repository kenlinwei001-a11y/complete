import { describe, it, expect } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-IMPORT-REPLACE-SYNTHETIC (G4) · 世界态源开关（synthetic|imported·PRD §3.4·配 WO-CAP-01 REALDEMAND）。
 *
 * imported = 用导入真对象作世界态源 → 翻开既有实值杠杆 `qos.risk_realdemand`（求解器 risk.ts 读 SolverContext.features·
 * 真需求-产能缺口替 mockTightness 哈希）——⛔ 平台不改求解器内部。守 R-NO-ORPHAN-SOURCE：imported 但无导入真数据 → 诚实 warning。
 * demo/battery 模板 features=[...ALL_FEATURE_KEYS] → 暗发门须用**新租户**验。
 */

const ADMIN_HDR = (tenant: string) => ({ "x-debug-user": `${tenant}:u1:admin|catalog_admin` });

async function enableWorldSource(t: TestApp, tenant: string): Promise<void> {
  const res = await t.app.inject({ method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers: ADMIN_HDR(tenant), payload: { overrides: { "data-import.world-source": true } } });
  if (res.statusCode !== 200) throw new Error(`enable failed: ${res.body}`);
}

const putWS = (t: TestApp, worldSource: string, headers = ADMIN) => t.app.inject({ method: "PUT", url: "/a/v1/world-source", headers, payload: { worldSource } });
const getWS = (t: TestApp, headers = ADMIN) => t.app.inject({ method: "GET", url: "/a/v1/world-source", headers });

describe("WO-IMPORT-REPLACE-SYNTHETIC (G4) · 世界态源开关", () => {
  it("暗发门（R3）：新租户 feature 关 → GET/PUT /world-source 返回 404", async () => {
    const t = await makeApp();
    expect((await getWS(t, ADMIN_HDR("wsoff"))).statusCode).toBe(404);
    expect((await putWS(t, "imported", ADMIN_HDR("wsoff"))).statusCode).toBe(404);
  });

  it("demo GET 默认 synthetic；PUT imported↔synthetic 翻转实值杠杆 qos.risk_realdemand", async () => {
    const t = await makeApp();
    const def = (await getWS(t)).json() as { worldSource: string };
    expect(def.worldSource).toBe("synthetic");
    const imp = (await putWS(t, "imported")).json() as { worldSource: string; realValueLeverEnabled: boolean };
    expect(imp.worldSource).toBe("imported");
    expect(imp.realValueLeverEnabled).toBe(true);
    const syn = (await putWS(t, "synthetic")).json() as { worldSource: string; realValueLeverEnabled: boolean };
    expect(syn.worldSource).toBe("synthetic");
    expect(syn.realValueLeverEnabled).toBe(false); // override 关 → 求解器回退合成扁平
  });

  it("求解器读真值换 hash（真证据）：risk_timeline 输出随 world_source 翻转而变（非仅翻标志）", async () => {
    const t = await makeApp();
    await seedBattery(t); // 真电池世界态（真对象·真时序）。
    await putWS(t, "imported");
    const on = (await invokeSolver(t, "risk_timeline", {})).json();
    await putWS(t, "synthetic");
    const off = (await invokeSolver(t, "risk_timeline", {})).json();
    // 翻转世界态源 → 求解器真读到不同世界态（真需求-产能 vs 合成扁平）→ 输出实变。
    expect(JSON.stringify(on)).not.toBe(JSON.stringify(off));
  });

  it("合并不覆盖：翻转 world_source 保留租户其它 feature override（seed 的 opt.solver-pool 不丢）", async () => {
    const t = await makeApp();
    await putWS(t, "imported");
    const feats = (await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features", headers: ADMIN })).json() as { features: string[] };
    // demo seed 开了 opt.solver-pool（override）——翻转 world_source 后仍在（合并非替换）。
    expect(feats.features).toContain("opt.solver-pool");
    expect(feats.features).toContain("qos.risk_realdemand");
  });

  it("R-NO-ORPHAN-SOURCE 诚实边界：imported 但无导入数据（0 RawDataset）→ warning（世界态空·不假装有真值）", async () => {
    const t = await makeApp();
    // 建一个存在但无数据的租户记录 + 开 feature。
    await t.repos.tenants.put({ id: "wsempty", tenantId: "wsempty", name: "wsempty" });
    await enableWorldSource(t, "wsempty");
    const res = (await putWS(t, "imported", ADMIN_HDR("wsempty"))).json() as { worldSource: string; rawDatasetCount: number; warnings: string[] };
    expect(res.worldSource).toBe("imported");
    expect(res.rawDatasetCount).toBe(0);
    expect(res.warnings.some((w) => w.includes("无导入数据表"))).toBe(true);
  });

  it("authz：非 admin PUT → 403", async () => {
    const t = await makeApp();
    const res = await putWS(t, "imported", { "x-debug-user": "demo:u2:planner" });
    expect(res.statusCode).toBe(403);
  });
});
