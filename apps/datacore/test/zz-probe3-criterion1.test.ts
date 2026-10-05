/** 临时探针3（WO-COSTPRESSURE-IDENTITY）：判据 1 的真数 —— tick0 零扰动 ⇒ 投影 == rolling。用完即删。 */
import { beforeAll, describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { deriveSeedBaseSnapshot } from "../src/sim/seed-world.js";
import { STATE_VAR_DOMAINS } from "../src/synthetic/battery.js";
import { FINANCE_WORLD_PRESSURE_DIVISOR } from "@platform/contracts";

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

describe("PROBE3 criterion1", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    const r = await enableSim(t);
    expect(r.statusCode).toBe(200);
  }, 300_000);

  it("★ 判据1：tick0 零扰动（不推任何一拍）⇒ 投影行 projected 必须 == rolling", async () => {
    // 真 HTTP：建会话**不给 baseSnapshot** ⇒ 走真种子世界（deriveSeedBaseSnapshot）
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/sim/sessions",
      headers: ADMIN,
      payload: {},
    });
    expect(res.statusCode, `建会话失败：${res.body}`).toBe(201);
    const sid = (res.json() as { id: string }).id;
    console.log(`session=${sid}（零扰动：⛔ 不 POST /tick）`);

    const out = await invokeSolver(t, "finance_world_projection", { worldId: sid });
    expect(out.statusCode, `求解器失败：${out.body}`).toBe(200);
    const data = (out.json() as { data: any }).data;

    console.log(`worldStateSource=${data.worldStateSource} divisor=${FINANCE_WORLD_PRESSURE_DIVISOR.pp}`);
    console.log("subject | role | rolling | projected | delta");
    for (const l of data.lines as any[]) {
      console.log(`  ${l.subject} | ${l.role} | rolling=${l.rolling} projected=${l.projected} delta=${l.delta}`);
    }
    const margin = (data.lines as any[]).find((l) => l.role === "MARGIN");
    const cost = (data.lines as any[]).find((l) => l.role === "COST");
    console.log(`★ MARGIN: rolling=${margin?.rolling} projected=${margin?.projected} delta=${margin?.delta}`);
    console.log(`★ COST:   rolling=${cost?.rolling} projected=${cost?.projected} delta=${cost?.delta}`);

    const td = data.turnDynamics;
    if (td) {
      for (const k of Object.keys(td.byStateVar)) {
        const s = td.byStateVar[k];
        console.log(`track ${k}: value=${s.value} carriers=${s.carriers} trajectory=${JSON.stringify(s.trajectory?.map((p: any) => p.value))}`);
      }
    }
    const cash = data.cash;
    if (cash) console.log(`cash: arBaseline=${cash.arBaseline} arProjected=${cash.arProjected} arDelta=${cash.arDelta} overdueExposure=${cash.overdueExposure}`);

    console.log(`★ 判据1 的读数：MARGIN.projected − MARGIN.rolling = ${margin ? margin.projected - margin.rolling : "N/A"}`);
    expect(true).toBe(true);
  }, 300_000);

  it("B · 压力族格：改后有多少格 = 0，各键分布", async () => {
    const { state, provenance } = await deriveSeedBaseSnapshot(t.repos, "demo");
    const pressureKeys = Object.entries(STATE_VAR_DOMAINS)
      .filter(([, d]) => d.min === 0 && d.restPoint === 0 && d.max !== null)
      .map(([k]) => k);
    const byKey = new Map<string, { n: number; zero: number; min: number; max: number }>();
    for (const [objId, row] of Object.entries(state)) {
      for (const k of pressureKeys) {
        const v = row[k];
        if (typeof v !== "number") continue;
        const e = byKey.get(k) ?? { n: 0, zero: 0, min: Infinity, max: -Infinity };
        e.n += 1; if (v === 0) e.zero += 1;
        e.min = Math.min(e.min, v); e.max = Math.max(e.max, v);
        byKey.set(k, e);
      }
    }
    let totCells = 0, totZero = 0;
    for (const [k, e] of [...byKey.entries()].sort((a, b) => b[1].n - a[1].n)) {
      totCells += e.n; totZero += e.zero;
      console.log(`${k}: 格=${e.n} 恒零=${e.zero} min=${e.min} max=${e.max}`);
    }
    console.log(`★ 压力族格合计=${totCells} 其中恒零=${totZero}（${((totZero / totCells) * 100).toFixed(1)}%）`);
    const derivedPressure = Object.entries(provenance).flatMap(([id, r]) => Object.entries(r).filter(([k, o]) => o === "derived" && pressureKeys.includes(k)).map(([k]) => `${id}|${k}`));
    console.log(`压力族派生（铸造）格=${derivedPressure.length}`);
    expect(true).toBe(true);
  }, 300_000);
});
