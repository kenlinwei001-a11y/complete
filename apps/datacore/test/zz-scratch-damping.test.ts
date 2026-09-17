import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { seedDemoSimWorld, DEMO_SIM_WORLD_SESSION_ID } from "../src/sim/seed-world.js";

const E1 = "demo_fg_drawdown_relieves_model_demand";
const E2 = "demo_transfer_relieves_base_load";
const DAMP = [E1, E2];
type St = Record<string, Record<string, number>>;

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const f = (a: number[]) => `peak=${Math.max(...a).toFixed(4)}(t=${a.indexOf(Math.max(...a)) + 1}) last=${a[a.length - 1]!.toFixed(4)} area=${sum(a).toFixed(2)}`;

describe("DAMPING", () => {
  it("clean-world + seeded-world + 变异反证 + 不误伤", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const links = await t.repos.links.list("demo");
    const ofm = links.find((l) => l.type === "order_for_model")!;
    const orderId = ofm.fromId, modelId = ofm.toId;
    const baseId = links.find((l) => l.type === "model_producible_at" && l.fromId === modelId)!.toId;
    const fgId = links.find((l) => l.type === "fg_of_model" && l.toId === modelId)!.fromId;
    const xferId = links.find((l) => l.type === "base_dispatches_transfer" && l.fromId === baseId)?.toId ?? null;
    console.log(`IDS order=${orderId} model=${modelId} base=${baseId} fg=${fgId} xfer=${xferId}`);
    const N = 60;

    const arm = async (disabled: string[], measure: boolean, base?: St) => {
      const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: base ?? { [orderId]: { orderChurn: 0 } } } });
      const sid = (r.json() as { id: string }).id;
      if (disabled.length) {
        const d = await t.app.inject({ method: "PATCH", url: `/a/v1/sim/sessions/${sid}/disabled-rules`, headers: ADMIN, payload: { disabledRuleKeys: disabled } });
        if (d.statusCode >= 400) throw new Error(`disable ${d.statusCode} ${d.body}`);
      }
      const p = await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
        payload: { kind: "demand_shift", targetObjectId: orderId, targetStateVar: "orderChurn", magnitude: 20, mode: "set", label: "插单频繁" },
      });
      if (p.statusCode !== 201) throw new Error(`perturb ${p.statusCode} ${p.body}`);
      if (measure) {
        const m = await t.app.inject({
          method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
          payload: { kind: "supply_disruption", targetObjectId: fgId, targetStateVar: "drawdownPressure", magnitude: 60, mode: "set", label: "加库存" },
        });
        if (m.statusCode !== 201) throw new Error(`measure ${m.statusCode} ${m.body}`);
      }
      const churn: number[] = [], dl: number[] = [], li: number[] = [], dd: number[] = [], tp: number[] = [];
      for (let i = 0; i < N; i++) {
        const tr = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
        if (tr.statusCode >= 400) throw new Error(`tick ${tr.statusCode} ${tr.body}`);
        const s = (tr.json() as { state: St }).state;
        churn.push(s[orderId]?.orderChurn ?? 0);
        dl.push(s[modelId]?.demandLoad ?? 0);
        li.push(s[baseId]?.loadIndex ?? 0);
        dd.push(s[fgId]?.drawdownPressure ?? 0);
        tp.push(xferId ? s[xferId]?.transferPressure ?? 0 : 0);
      }
      return { churn, dl, li, dd, tp };
    };

    // ── 驱动自证：orderChurn 必须真的持续（外生根 ⇒ 不衰减）────────────────────
    const off = await arm(DAMP, false);
    console.log(`DRIVER orderChurn ${f(off.churn)}  (持续判据：末拍应 == 20)`);
    const on = await arm([], false);

    console.log(`EXP1 Model.demandLoad  OFF ${f(off.dl)}`);
    console.log(`EXP1 Model.demandLoad  ON  ${f(on.dl)}`);
    console.log(`EXP1 Base.loadIndex    OFF ${f(off.li)}`);
    console.log(`EXP1 Base.loadIndex    ON  ${f(on.li)}`);
    console.log(`  demandLoad OFF t1..12: ${off.dl.slice(0, 12).map((x) => x.toFixed(3)).join(" ")}`);
    console.log(`  demandLoad ON  t1..12: ${on.dl.slice(0, 12).map((x) => x.toFixed(3)).join(" ")}`);
    console.log(`  阻尼源 drawdownPressure ON ${f(on.dd)} | transferPressure ON ${f(on.tp)}`);

    // ── 实验②：措施有效性 ────────────────────────────────────────────────────
    const offM = await arm(DAMP, true), onM = await arm([], true);
    console.log(`EXP2 OFF 不采取 last=${off.dl[N - 1]!.toFixed(6)} area=${sum(off.dl).toFixed(4)} | 采取 last=${offM.dl[N - 1]!.toFixed(6)} area=${sum(offM.dl).toFixed(4)} | 逐拍全等=${JSON.stringify(off.dl) === JSON.stringify(offM.dl)}`);
    console.log(`EXP2 ON  不采取 last=${on.dl[N - 1]!.toFixed(6)} area=${sum(on.dl).toFixed(4)} | 采取 last=${onM.dl[N - 1]!.toFixed(6)} area=${sum(onM.dl).toFixed(4)} | 逐拍全等=${JSON.stringify(on.dl) === JSON.stringify(onM.dl)}`);
    console.log(`EXP2 ON 最大逐拍偏离=${Math.max(...on.dl.map((v, i) => Math.abs(v - onM.dl[i]!))).toFixed(6)}`);

    // ── 实验③：变异反证 ──────────────────────────────────────────────────────
    const m1 = await arm([E1], false), m2 = await arm([E2], false);
    console.log(`EXP3 删①(fg→demandLoad): demandLoad area=${sum(m1.dl).toFixed(4)} (全开 ${sum(on.dl).toFixed(4)} / 全关 ${sum(off.dl).toFixed(4)})`);
    console.log(`EXP3 删②(xfer→loadIndex): loadIndex area=${sum(m2.li).toFixed(4)} (全开 ${sum(on.li).toFixed(4)} / 全关 ${sum(off.li).toFixed(4)})`);

    // ── seeded-world 臂（真 demo 世界·饱和区）──────────────────────────────────
    await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    const ses = await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID);
    const sbase = (ses?.baseSnapshot ?? {}) as St;
    const vals: number[] = [];
    for (const o of Object.keys(sbase)) for (const v of Object.values(sbase[o]!)) if (typeof v === "number") vals.push(v);
    vals.sort((a, b) => a - b);
    console.log(`SEEDWORLD cells=${vals.length} min=${vals[0]} p50=${vals[Math.floor(vals.length / 2)]} max=${vals[vals.length - 1]} >=90占比=${(vals.filter((x) => x >= 90).length / (vals.length || 1) * 100).toFixed(1)}%`);
    const sOff = await arm(DAMP, false, sbase), sOn = await arm([], false, sbase);
    console.log(`SEEDWORLD demandLoad OFF ${f(sOff.dl)}`);
    console.log(`SEEDWORLD demandLoad ON  ${f(sOn.dl)}`);
    console.log(`SEEDWORLD Δarea=${(sum(sOn.dl) - sum(sOff.dl)).toFixed(6)} Δlast=${(sOn.dl[N - 1]! - sOff.dl[N - 1]!).toFixed(6)}`);
    console.log(`SEEDWORLD loadIndex OFF last=${sOff.li[N - 1]!.toFixed(6)} ON last=${sOn.li[N - 1]!.toFixed(6)} Δ=${(sOn.li[N - 1]! - sOff.li[N - 1]!).toFixed(6)}`);

    // ── 实验④：不误伤（成本链）──────────────────────────────────────────────
    const mubm = links.find((l) => l.type === "material_used_by_model")!;
    const materialId = mubm.fromId, costModelId = mubm.toId;
    const cost = async (disabled: string[]) => {
      const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: { [materialId]: { priceShock: 0 } } } });
      const sid = (r.json() as { id: string }).id;
      if (disabled.length) await t.app.inject({ method: "PATCH", url: `/a/v1/sim/sessions/${sid}/disabled-rules`, headers: ADMIN, payload: { disabledRuleKeys: disabled } });
      await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
        payload: { kind: "cost_shock", targetObjectId: materialId, targetStateVar: "priceShock", magnitude: 15, mode: "set", label: "涨价15" },
      });
      let out = 0;
      for (let i = 0; i < 4; i++) {
        const tr = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
        out = ((tr.json() as { state: St }).state)[costModelId]?.costPressure ?? 0;
      }
      return out;
    };
    const cB = await cost(DAMP), cA = await cost([]);
    console.log(`EXP4 Model.costPressure 修前=${cB.toFixed(12)} 修后=${cA.toFixed(12)} 逐字节相同=${cB === cA}`);
    expect(on.dl.length).toBe(N);
  }, 2_400_000);
});
