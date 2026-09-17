import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules, demoPropagationRulesWithDomain } from "../src/seed.js";

const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

describe("SCRATCH DAMPING", () => {
  it("0 · 三条候选链路的互逆性与域归属", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const links = await t.repos.links.list("demo");
    const pairs = (type: string) => new Set(links.filter((l) => l.type === type).map((l) => `${l.fromId}|${l.toId}`));
    const rev = (s: Set<string>) => new Set([...s].map((k) => k.split("|").reverse().join("|")));

    for (const [fwd, back] of [
      ["base_dispatches_transfer", "transfer_from_base"],
      ["model_stocked_as_finished_goods", "fg_of_model"],
      ["order_has_promise", "promise_for_order"],
    ] as const) {
      const a = pairs(fwd), b = pairs(back), ra = rev(a);
      const inter = [...ra].filter((k) => b.has(k)).length;
      console.log(`${fwd}(${a.size}) vs ${back}(${b.size}): 反向交集=${inter}  严格互逆=${inter === a.size && inter === b.size}`);
    }
    // 金丝雀：一对我确定互逆的（order_of_customer / customer_places_order，种子注释写明同一段派生式）
    const a = pairs("order_of_customer"), b = pairs("customer_places_order");
    const inter = [...rev(a)].filter((k) => b.has(k)).length;
    console.log(`CANARY order_of_customer(${a.size}) vs customer_places_order(${b.size}): 反向交集=${inter}`);

    const rules = demoPropagationRulesWithDomain();
    console.log("TOTAL", rules.length, "POS", rules.filter((r) => r.coefficient > 0).length, "NEG", rules.filter((r) => r.coefficient < 0).length);
    for (const k of ["demo_fg_drawdown_relieves_model_demand", "demo_transfer_relieves_base_load", "demo_promise_risk_relieves_order_demand"]) {
      const r = rules.find((x) => x.key === k)!;
      console.log(`  ${k} domain=${r.domainKey}/${r.domainName} c=${r.coefficient}`);
    }
    expect(rules.length).toBe(50);
  }, 300_000);

  it("1 · 回落实验 + 变异反证（96 拍）", async () => {
    // disabledRules 让我在同一棵树上跑「修前 / 修后 / 删一条」三态，不用来回改种子
    const run = async (disabled: string[], magnitude = 10) => {
      const t = await makeApp();
      await seedBattery(t);
      await seedDemoPropagationRules(t.repos);
      await enableSim(t);
      const links = await t.repos.links.list("demo");
      const ofm = links.find((l) => l.type === "order_for_model")!;
      const orderId = ofm.fromId, modelId = ofm.toId;
      const mpa = links.find((l) => l.type === "model_producible_at" && l.fromId === modelId)!;
      const baseId = mpa.toId;

      const sid = (await (await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
        payload: { baseSnapshot: { [orderId]: { demandPressure: 0 } } },
      })).json()).id as string;
      if (disabled.length) {
        const r = await t.app.inject({ method: "PATCH", url: `/a/v1/sim/sessions/${sid}/disabled-rules`, headers: ADMIN, payload: { disabledRuleKeys: disabled } });
        if (r.statusCode >= 400) throw new Error(`disable failed ${r.statusCode} ${r.body}`);
      }
      const pr = await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
        payload: { kind: "demand_shift", targetObjectId: orderId, targetStateVar: "demandPressure", magnitude, mode: "set", label: "x" },
      });
      if (pr.statusCode !== 201) throw new Error(`perturb failed ${pr.statusCode} ${pr.body}`);
      const ser: { mod: number; base: number }[] = [];
      for (let i = 1; i <= 96; i++) {
        const r = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json() as {
          state: Record<string, Record<string, number>>;
        };
        ser.push({ mod: r.state[modelId]?.demandLoad ?? 0, base: r.state[baseId]?.loadIndex ?? 0 });
      }
      return ser;
    };

    const ALL3 = ["demo_fg_drawdown_relieves_model_demand", "demo_transfer_relieves_base_load", "demo_promise_risk_relieves_order_demand"];
    const before = await run(ALL3);           // 修前 = 三条阻尼边全关
    const after = await run([]);              // 修后 = 三条全开
    const mut = await run(["demo_fg_drawdown_relieves_model_demand"]); // 变异反证：只删 ①

    const rep = (name: string, s: { mod: number; base: number }[]) => {
      const pk = Math.max(...s.map((x) => x.mod)), lastV = s[s.length - 1]!.mod;
      const pkI = s.findIndex((x) => x.mod === pk) + 1;
      console.log(`${name}: Model.demandLoad 峰值=${pk.toFixed(6)}(t=${pkI}) 末拍=${lastV.toFixed(6)} 回落=${(pk - lastV).toFixed(6)}  |  Base.loadIndex 峰=${Math.max(...s.map((x) => x.base)).toFixed(4)} 末=${s[s.length - 1]!.base.toFixed(4)}`);
      return { pk, lastV };
    };
    const b = rep("修前(阻尼全关)", before);
    const a = rep("修后(阻尼全开)", after);
    const m = rep("变异(只删①)  ", mut);
    console.log("前10拍 修前:", before.slice(0, 10).map((x) => x.mod.toFixed(3)).join(" "));
    console.log("前10拍 修后:", after.slice(0, 10).map((x) => x.mod.toFixed(3)).join(" "));
    expect(a.lastV).toBeLessThan(b.lastV);
    void m;
  }, 900_000);

  it("2 · 措施有效性：同一扰动，采取措施 vs 不采取", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const links = await t.repos.links.list("demo");
    const ofm = links.find((l) => l.type === "order_for_model")!;
    const orderId = ofm.fromId, modelId = ofm.toId;
    const fg = links.find((l) => l.type === "fg_of_model" && l.toId === modelId);
    console.log("fg_of_model 指向该型号的成品库存条数:", links.filter((l) => l.type === "fg_of_model" && l.toId === modelId).length, "sampleFrom=", fg?.fromId);
    expect(fg).toBeTruthy();

    const run = async (measure: boolean, disabled: string[] = []) => {
      const sid = (await (await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
        payload: { baseSnapshot: { [orderId]: { demandPressure: 0 } } },
      })).json()).id as string;
      if (disabled.length) {
        const dr = await t.app.inject({ method: "PATCH", url: `/a/v1/sim/sessions/${sid}/disabled-rules`, headers: ADMIN, payload: { disabledRuleKeys: disabled } });
        if (dr.statusCode >= 400) throw new Error(`disable failed ${dr.statusCode} ${dr.body}`);
      }
      const pr = await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
        payload: { kind: "demand_shift", targetObjectId: orderId, targetStateVar: "demandPressure", magnitude: 10, mode: "set", label: "扰动" },
      });
      if (pr.statusCode !== 201) throw new Error(`perturb failed ${pr.statusCode} ${pr.body}`);
      if (measure) {
        // 措施 = 加库存：把该型号成品库存的去化压力拉高（模拟"备了货，正在从库存发"）
        const mr = await t.app.inject({
          method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
          payload: { kind: "supply_disruption", targetObjectId: fg!.fromId, targetStateVar: "drawdownPressure", magnitude: 40, mode: "set", label: "加库存" },
        });
        if (mr.statusCode !== 201) throw new Error(`measure failed ${mr.statusCode} ${mr.body}`);
      }
      let out = 0;
      for (let i = 1; i <= 40; i++) {
        const r = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json() as {
          state: Record<string, Record<string, number>>;
        };
        out = r.state[modelId]?.demandLoad ?? 0;
      }
      return out;
    };
    const ALL3 = ["demo_fg_drawdown_relieves_model_demand", "demo_transfer_relieves_base_load", "demo_promise_risk_relieves_order_demand"];
    const beforeNo = await run(false, ALL3), beforeYes = await run(true, ALL3);
    const afterNo = await run(false), afterYes = await run(true);
    console.log(`修前 不采取=${beforeNo.toFixed(6)} 采取=${beforeYes.toFixed(6)} 差=${(beforeYes - beforeNo).toFixed(6)}`);
    console.log(`修后 不采取=${afterNo.toFixed(6)} 采取=${afterYes.toFixed(6)} 差=${(afterYes - afterNo).toFixed(6)}`);
    expect(true).toBe(true);
  }, 900_000);

  it("3 · 不误伤：成本链 Material.priceShock → Model.costPressure", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const links = await t.repos.links.list("demo");
    const mubm = links.find((l) => l.type === "material_used_by_model")!;
    const materialId = mubm.fromId, modelId = mubm.toId;
    const run = async (disabled: string[]) => {
      const sid = (await (await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
        payload: { baseSnapshot: { [materialId]: { priceShock: 0 } } },
      })).json()).id as string;
      if (disabled.length) {
        const dr = await t.app.inject({ method: "PATCH", url: `/a/v1/sim/sessions/${sid}/disabled-rules`, headers: ADMIN, payload: { disabledRuleKeys: disabled } });
        if (dr.statusCode >= 400) throw new Error(`disable failed ${dr.statusCode} ${dr.body}`);
      }
      const pr = await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
        payload: { kind: "cost_shock", targetObjectId: materialId, targetStateVar: "priceShock", magnitude: 15, mode: "set", label: "涨价15" },
      });
      if (pr.statusCode !== 201) throw new Error(`perturb failed ${pr.statusCode} ${pr.body}`);
      let out = 0;
      for (let i = 1; i <= 4; i++) {
        const r = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json() as {
          state: Record<string, Record<string, number>>;
        };
        out = r.state[modelId]?.costPressure ?? 0;
      }
      return out;
    };
    const ALL3 = ["demo_fg_drawdown_relieves_model_demand", "demo_transfer_relieves_base_load", "demo_promise_risk_relieves_order_demand"];
    console.log(`Model.costPressure 修前=${(await run(ALL3)).toFixed(12)} 修后=${(await run([])).toFixed(12)}`);
    expect(true).toBe(true);
  }, 900_000);
});
