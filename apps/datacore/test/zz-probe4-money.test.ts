/** 临时探针4（WO-COSTPRESSURE-IDENTITY）：金额精度两处读数 + 零扰动漂移。用完即删。 */
import { beforeAll, describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function newWorld(t: TestApp): Promise<string> {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: {} });
  expect(r.statusCode, `建会话失败：${r.body}`).toBe(201);
  return (r.json() as { id: string }).id;
}
const tick = async (t: TestApp, sid: string, n: number) => {
  const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n } });
  expect([200, 201], `tick 失败 code=${r.statusCode} ${r.body}`).toContain(r.statusCode);
};
const project = async (t: TestApp, sid: string) => {
  const r = await invokeSolver(t, "finance_world_projection", { worldId: sid });
  expect(r.statusCode, `求解器失败：${r.body}`).toBe(200);
  return (r.json() as { data: any }).data;
};

describe("PROBE4 money", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    const r = await enableSim(t);
    expect(r.statusCode).toBe(200);
  }, 300_000);

  it("A · 零扰动臂逐拍：三格 + 聚合 + MARGIN.projected（量自由漂与成本桥）", async () => {
    const sid = await newWorld(t);
    for (let k = 0; k <= 3; k++) {
      if (k > 0) await tick(t, sid, 1);
      const d = await project(t, sid);
      const g = (r: string) => (d.lines as any[]).find((l) => l.role === r);
      const td = d.turnDynamics?.byStateVar ?? {};
      const last = (s: any) => (s?.trajectory ?? []).slice(-1)[0]?.value;
      console.log(
        `zero t${k}: MARGIN.projected=${g("MARGIN")?.projected} COST.projected=${g("COST")?.projected} ` +
          `costAgg=${last(td.costPressure)} arAgg=${last(td.receivablePressure)} odAgg=${last(td.overduePressure)} ` +
          `arProjected=${d.cash?.arProjected} overdueExposure=${d.cash?.overdueExposure}`,
      );
    }
    expect(true).toBe(true);
  }, 300_000);

  it("B · A 臂（SO-3391 leadDays Δ=−3）vs 零扰动：回包字段逐位比对 + 差值", async () => {
    const z = await newWorld(t);
    await tick(t, z, 3);
    const zd = await project(t, z);

    const a = await newWorld(t);
    // 找 SO-3391 的 leadDays 真值（不拍脑袋写 17）
    const objs = await t.repos.objects.listByType("demo", "Order");
    const so = objs.find((o) => (o.props.so as string) === "SO-3391") ?? objs.find((o) => o.id.includes("SO-3391"));
    expect(so, "SO-3391 不在 Order 台账里").toBeTruthy();
    const cur = so!.props.leadDays as number;
    const pr = await t.app.inject({
      method: "POST",
      url: `/a/v1/sim/sessions/${a}/perturbations`,
      headers: ADMIN,
      payload: {
        kind: "cost_shock", targetObjectId: so!.id, targetStateVar: "leadDays",
        magnitude: -3, mode: "delta", startTick: 0, durationTicks: null, label: `${so!.id} leadDays −3`,
      },
    });
    expect([200, 201], `扰动写入必须 2xx：code=${pr.statusCode} ${pr.body}`).toContain(pr.statusCode);
    await tick(t, a, 3);
    const ad = await project(t, a);

    const g = (d: any, r: string) => (d.lines as any[]).find((l) => l.role === r);
    for (const role of ["MARGIN", "COST", "REVENUE"]) {
      const zl = g(zd, role), al = g(ad, role);
      console.log(`${role}: zero.projected=${zl.projected} A.projected=${al.projected} Δ=${al.projected - zl.projected}`);
    }
    const zt = zd.turnDynamics?.byStateVar ?? {}, at = ad.turnDynamics?.byStateVar ?? {};
    const last = (s: any) => (s?.trajectory ?? []).slice(-1)[0]?.value;
    for (const k of ["costPressure", "receivablePressure", "overduePressure"]) {
      console.log(`${k}: zero=${last(zt[k])} A=${last(at[k])} Δ=${(last(at[k]) ?? 0) - (last(zt[k]) ?? 0)}`);
    }
    console.log(`cash: zero.arProjected=${zd.cash?.arProjected} A.arProjected=${ad.cash?.arProjected}`);
    // ★ (a) 回包原始值是否逐位相同
    const zm = g(zd, "MARGIN")?.projected, am = g(ad, "MARGIN")?.projected;
    console.log(`★(a) MARGIN.projected 回包原始值：zero=${JSON.stringify(zm)} A=${JSON.stringify(am)} Object.is=${Object.is(zm, am)}`);
    expect(true).toBe(true);
  }, 300_000);

  it("C · 金额精度：同一 ΔMARGIN 在 2 位与 6 位下的显示文本", async () => {
    // 直接量 round 行为（money() 的实现体 = round(v, n)）
    const { round } = await import("../src/prng.js");
    for (const delta of [0.00275, 0.00827, 0.0213, 0.0]) {
      console.log(`Δ=${delta} ⇒ 旧(2位)=${round(delta, 2)} 新(6位)=${round(delta, 6)} 屏上可分辨(旧)=${round(delta, 2) !== 0}`);
    }
    expect(true).toBe(true);
  }, 120_000);
});
