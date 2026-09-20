import { describe, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { readWorldLine } from "../src/sim/world-line.js";

const MAT_ID = "obj_material_pos_ncm";

const enableSim = async (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await enableSim(t);
  return t;
}

async function newSession(t: TestApp): Promise<string> {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { scope: { mode: "GLOBAL" } } });
  if (r.statusCode !== 201) throw new Error("session " + r.statusCode + " " + r.body);
  return r.json().id as string;
}

async function perturb(t: TestApp, sid: string, objectId: string, magnitude: number): Promise<void> {
  const r = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
    payload: { kind: "cost_shock", targetObjectId: objectId, targetStateVar: "priceShock", magnitude, mode: "set", startTick: 0, durationTicks: null, label: `x${magnitude}` },
  });
  if (r.statusCode !== 201) throw new Error("perturb " + r.statusCode + " " + r.body);
}

const tick = async (t: TestApp, sid: string): Promise<void> => {
  const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { ticks: 1 } });
  if (r.statusCode !== 200) throw new Error("tick " + r.statusCode + " " + r.body);
};

const project = async (t: TestApp, sid: string): Promise<any> => {
  const r = await t.app.inject({
    method: "POST", url: "/a/v1/solvers/finance_world_projection/invoke", headers: ADMIN,
    payload: { args: { worldId: sid } },
  });
  if (r.statusCode !== 200) throw new Error("project " + r.statusCode + " " + r.body);
  return r.json().data ?? r.json();
};

describe("SCAN", () => {
  it("扫描响应曲线", async () => {
    const t = await seededApp();

    // 先摸清有哪些 Model / Order 承载 costPressure（从一条已推进的世界线上取）。
    const probeSid = await newSession(t);
    await perturb(t, probeSid, MAT_ID, 20);
    for (let i = 0; i < 3; i++) await tick(t, probeSid);
    const wl0 = await readWorldLine(t.repos, "demo", probeSid, 3, 4);
    const last = wl0.frames[wl0.frames.length - 1]!.state;
    const modelIds = Object.keys(last).filter((k) => k.includes("model")).sort();
    const cpCarriers = Object.keys(last).filter((k) => typeof last[k]?.costPressure === "number").sort();
    console.log("### MODEL-LIKE OBJ IDS:", JSON.stringify(modelIds.slice(0, 12)));
    console.log("### costPressure carriers total:", cpCarriers.length);
    console.log("### first 6 carriers:", JSON.stringify(cpCarriers.slice(0, 6)));
    const objs = await t.repos.objects.listByType("demo", "Model");
    console.log("### Model objects:", JSON.stringify(objs.map((o) => o.id).sort()));
    const orders = await t.repos.objects.listByType("demo", "Order");
    console.log("### Order universe:", orders.length);

    // 选定观测点：第一个 Model，以及第一个带 costPressure 的 Order。
    const MODEL = objs.map((o) => o.id).sort()[0]!;
    const ORDER = cpCarriers.filter((id) => id.startsWith("obj_order") || id.includes("order")).sort()[0] ?? cpCarriers[0]!;
    console.log("### OBSERVE MODEL =", MODEL, " ORDER =", ORDER);

    const arms: (number | null)[] = [null, 0, 5, 10, 20, 40, 60, 80, 100];
    const rows: string[] = [];
    for (const m of arms) {
      const sid = await newSession(t);
      if (m !== null) await perturb(t, sid, MAT_ID, m);
      for (let i = 0; i < 3; i++) await tick(t, sid);
      const out = await project(t, sid);
      const cp = out.turnDynamics.byStateVar.costPressure;
      const agg = cp.trajectory.map((p: any) => p.value);
      const wl = await readWorldLine(t.repos, "demo", sid, 3, 4);
      const modelSeries = wl.frames.map((f) => f.state[MODEL]?.costPressure ?? null);
      const orderSeries = wl.frames.map((f) => f.state[ORDER]?.costPressure ?? null);
      const matSeries = wl.frames.map((f) => f.state[MAT_ID]?.priceShock ?? null);
      const carriers = out.pressures.find((p: any) => p.stateVar === "costPressure").carriers;
      const universe = out.pressures.find((p: any) => p.stateVar === "costPressure").universe;
      rows.push(
        `ARM ${m === null ? "NONE" : String(m).padStart(4)} | AGG ${agg.map((v: number) => v.toFixed(6)).join(" ")} | MODEL ${modelSeries.map((v) => (v === null ? "null" : v.toFixed(6))).join(" ")} | ORDER ${orderSeries.map((v) => (v === null ? "null" : v.toFixed(6))).join(" ")} | MAT ${matSeries.map((v) => (v === null ? "null" : String(v))).join(" ")} | carriers ${carriers}/${universe}`,
      );
    }
    console.log("\n#### RESPONSE CURVE ####");
    for (const r of rows) console.log(r);
  }, 300000);
});
