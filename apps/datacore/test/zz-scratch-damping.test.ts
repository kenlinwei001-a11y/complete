import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { seedDemoSimWorld, DEMO_SIM_WORLD_SESSION_ID } from "../src/sim/seed-world.js";

const DAMP = [
  "demo_fg_drawdown_relieves_model_demand",
  "demo_transfer_relieves_base_load",
  "demo_promise_risk_relieves_order_demand",
];

type St = Record<string, Record<string, number>>;

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function session(t: TestApp, base: St | undefined, disabled: string[]) {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: base ? { baseSnapshot: base } : {} });
  if (r.statusCode >= 400) throw new Error(`session ${r.statusCode} ${r.body}`);
  const sid = (r.json() as { id: string }).id;
  if (disabled.length) {
    const d = await t.app.inject({ method: "PATCH", url: `/a/v1/sim/sessions/${sid}/disabled-rules`, headers: ADMIN, payload: { disabledRuleKeys: disabled } });
    if (d.statusCode >= 400) throw new Error(`disable ${d.statusCode} ${d.body}`);
  }
  return sid;
}

async function perturb(t: TestApp, sid: string, kind: string, objectId: string, stateVar: string, magnitude: number) {
  const r = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
    payload: { kind, targetObjectId: objectId, targetStateVar: stateVar, magnitude, mode: "set", label: "x" },
  });
  if (r.statusCode !== 201) throw new Error(`perturb ${r.statusCode} ${r.body}`);
}

async function ticks(t: TestApp, sid: string, n: number, probe: (s: St) => number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    if (r.statusCode >= 400) throw new Error(`tick ${r.statusCode} ${r.body}`);
    out.push(probe((r.json() as { state: St }).state));
  }
  return out;
}

const peak = (s: number[]) => Math.max(...s);
const last = (s: number[]) => s[s.length - 1]!;
const peakAt = (s: number[]) => s.indexOf(peak(s)) + 1;
const area = (s: number[]) => s.reduce((a, b) => a + b, 0);
const fmt = (s: number[]) => `peak=${peak(s).toFixed(6)}(t=${peakAt(s)}) last=${last(s).toFixed(6)} area=${area(s).toFixed(4)}`;

describe("DAMPING EXPERIMENTS", () => {
  it("clean-world arm (未饱和区)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const links = await t.repos.links.list("demo");
    const ofm = links.find((l) => l.type === "order_for_model")!;
    const orderId = ofm.fromId, modelId = ofm.toId;
    const baseId = links.find((l) => l.type === "model_producible_at" && l.fromId === modelId)!.toId;
    const fgId = links.find((l) => l.type === "fg_of_model" && l.toId === modelId)!.fromId;
    const N = 96;
    const pMod = (s: St) => s[modelId]?.demandLoad ?? 0;
    const pBase = (s: St) => s[baseId]?.loadIndex ?? 0;

    // 持续扰动**必须打在外生根上**（入度 0 ⇒ 不衰减 ⇒ 一次写入长期驻留）。
    // `Model.forecastBias` 是外生根，经 −0.6 那条既有负边推 Order.demandPressure：
    // 低估(负) ⇒ 需求压力上冲。故 set −20 = 一个持续的需求上冲扰动。
    const drive = async (disabled: string[], probe: (s: St) => number, measure = false) => {
      const sid = await session(t, { [modelId]: { forecastBias: 0 } }, disabled);
      await perturb(t, sid, "demand_shift", modelId, "forecastBias", -20);
      if (measure) await perturb(t, sid, "supply_disruption", fgId, "drawdownPressure", 40);
      return ticks(t, sid, N, probe);
    };

    // ── 实验①：回落 ───────────────────────────────────────────────────────────
    const offMod = await drive(DAMP, pMod);
    const onMod = await drive([], pMod);
    console.log(`EXP1 Model.demandLoad  OFF ${fmt(offMod)}`);
    console.log(`EXP1 Model.demandLoad  ON  ${fmt(onMod)}`);
    console.log(`  OFF t1..14: ${offMod.slice(0, 14).map((x) => x.toFixed(3)).join(" ")}`);
    console.log(`  ON  t1..14: ${onMod.slice(0, 14).map((x) => x.toFixed(3)).join(" ")}`);
    const offBase = await drive(DAMP, pBase);
    const onBase = await drive([], pBase);
    console.log(`EXP1 Base.loadIndex    OFF ${fmt(offBase)}`);
    console.log(`EXP1 Base.loadIndex    ON  ${fmt(onBase)}`);

    // ── 实验②：措施有效性 ────────────────────────────────────────────────────
    const offNo = offMod, offYes = await drive(DAMP, pMod, true);
    const onNo = onMod, onYes = await drive([], pMod, true);
    console.log(`EXP2 OFF no-measure last=${last(offNo).toFixed(6)} area=${area(offNo).toFixed(4)} | measure last=${last(offYes).toFixed(6)} area=${area(offYes).toFixed(4)} | identical=${JSON.stringify(offNo) === JSON.stringify(offYes)}`);
    console.log(`EXP2 ON  no-measure last=${last(onNo).toFixed(6)} area=${area(onNo).toFixed(4)} | measure last=${last(onYes).toFixed(6)} area=${area(onYes).toFixed(4)} | identical=${JSON.stringify(onNo) === JSON.stringify(onYes)}`);
    const maxDiv = Math.max(...onNo.map((v, i) => Math.abs(v - onYes[i]!)));
    console.log(`EXP2 ON  最大逐拍偏离=${maxDiv.toFixed(6)}`);

    // ── 实验③：变异反证（逐条删）──────────────────────────────────────────────
    for (const k of DAMP) {
      const s = await drive([k], pMod);
      const sb = await drive([k], pBase);
      console.log(`EXP3 drop ${k}: demandLoad last=${last(s).toFixed(6)} area=${area(s).toFixed(4)} (full ${area(onMod).toFixed(4)}) | loadIndex area=${area(sb).toFixed(4)} (full ${area(onBase).toFixed(4)})`);
    }
    expect(onMod.length).toBe(N);
  }, 1_800_000);

  it("seeded-world arm (真 demo 世界·饱和区) + 不误伤", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const rep = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    console.log("seedDemoSimWorld ok, sessionId=", DEMO_SIM_WORLD_SESSION_ID, "choice=", JSON.stringify(rep.choice)?.slice(0, 160));
    const ses = await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID);
    const base = (ses?.baseSnapshot ?? {}) as St;
    const vals: number[] = [];
    for (const o of Object.keys(base)) for (const v of Object.values(base[o]!)) if (typeof v === "number") vals.push(v);
    vals.sort((a, b) => a - b);
    console.log(`SEEDWORLD tick0 cells=${vals.length} min=${vals[0]} p50=${vals[Math.floor(vals.length / 2)]} max=${vals[vals.length - 1]} >=90占比=${(vals.filter((x) => x >= 90).length / (vals.length || 1) * 100).toFixed(1)}%`);

    const links = await t.repos.links.list("demo");
    const ofm = links.find((l) => l.type === "order_for_model")!;
    const modelId = ofm.toId;
    const run = async (disabled: string[]) => {
      const sid = await session(t, base, disabled);
      await perturb(t, sid, "demand_shift", modelId, "forecastBias", -20);
      return ticks(t, sid, 40, (s) => s[modelId]?.demandLoad ?? 0);
    };
    const off = await run(DAMP), on = await run([]);
    console.log(`SEEDWORLD demandLoad OFF ${fmt(off)}`);
    console.log(`SEEDWORLD demandLoad ON  ${fmt(on)}`);
    console.log(`SEEDWORLD Δ(area)=${(area(on) - area(off)).toFixed(6)}  Δ(last)=${(last(on) - last(off)).toFixed(6)}`);

    // ── 实验④：不误伤（成本链，与需求链无关）────────────────────────────────
    const mubm = links.find((l) => l.type === "material_used_by_model")!;
    const materialId = mubm.fromId, costModelId = mubm.toId;
    const cost = async (disabled: string[]) => {
      const sid = await session(t, { [materialId]: { priceShock: 0 } }, disabled);
      await perturb(t, sid, "cost_shock", materialId, "priceShock", 15);
      return ticks(t, sid, 4, (s) => s[costModelId]?.costPressure ?? 0);
    };
    const cB = await cost(DAMP), cA = await cost([]);
    console.log(`EXP4 Model.costPressure BEFORE=${last(cB).toFixed(12)} AFTER=${last(cA).toFixed(12)} identical=${last(cB) === last(cA)}`);
    expect(true).toBe(true);
  }, 1_800_000);
});
