// TEMPORARY PROBE (WO-SALES-RING) — delete before handoff.
import { describe, it, expect } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { demoPropagationRulesWithDomain, seedDemoPropagationRules } from "../src/seed.js";

const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

describe("probe · backlog pass-through ratio (A/B arm)", () => {
  it("Model.backlogQtyTop / max(Order.qty) must be 1.000000", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    const links = await t.repos.links.list("demo");
    const orders = await t.repos.objects.listByType("demo", "Order");
    const qtyOf = new Map(orders.map((o) => [o.id, num(o.props.qty)]));
    const maxQtyByModel = new Map<string, number>();
    for (const l of links) {
      if (l.type !== "order_for_model") continue;
      const q = qtyOf.get(l.fromId);
      if (q === undefined) continue;
      maxQtyByModel.set(l.toId, Math.max(maxQtyByModel.get(l.toId) ?? 0, q));
    }
    expect(maxQtyByModel.size, "没有任何 order_for_model 落点 ⇒ 探针坏了").toBeGreaterThan(0);

    const base: Record<string, Record<string, number>> = {};
    for (const o of orders) base[o.id] = { qty: num(o.props.qty) };
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: base },
    })).json()).id as string;
    const tick1 = (await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?explain=1`, headers: ADMIN, payload: { n: 1 },
    })).json();
    const state = (tick1 as { state: Record<string, Record<string, number>> }).state;

    console.log("BACKLOG_START");
    for (const [modelObjId, maxQty] of [...maxQtyByModel.entries()].sort()) {
      const got = state[modelObjId]?.backlogQtyTop;
      console.log(`${modelObjId}|maxOrderQty=${maxQty}|backlogQtyTop=${got}|ratio=${got === undefined ? "n/a" : (got / maxQty).toFixed(6)}`);
    }
    console.log("BACKLOG_END");
  }, 180000);

  it("fan-in per target instance for all 50 rules", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const links = await t.repos.links.list("demo");
    const objs = await t.repos.objects.list("demo");
    const typeOf = new Map(objs.map((o) => [o.id, o.type]));
    const rules = demoPropagationRulesWithDomain();
    const ofm = links.filter((l) => l.type === "order_for_model");
    console.log(`CANARY_order_for_model_links=${ofm.length}`);
    expect(ofm.length, "order_for_model 0 条 ⇒ 取边坏了").toBeGreaterThan(0);
    console.log("FANIN_START");
    for (const r of rules) {
      const es = links.filter(
        (l) => l.type === r.viaLinkKey && typeOf.get(l.fromId) === r.sourceTypeKey && typeOf.get(l.toId) === r.targetTypeKey,
      );
      const perTarget = new Map<string, number>();
      for (const l of es) perTarget.set(l.toId, (perTarget.get(l.toId) ?? 0) + 1);
      const ns = [...perTarget.values()];
      const maxN = ns.length ? Math.max(...ns) : 0;
      const avgN = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
      const basis = r.weightRef ? String((r.weightRef as { basis?: string }).basis) : "null";
      console.log(
        `${r.key}|edges=${es.length}|targets=${perTarget.size}|avgFanIn=${avgN.toFixed(3)}|maxFanIn=${maxN}|basis=${basis}|combine=${r.combine}|coef=${r.coefficient}`,
      );
    }
    console.log("FANIN_END");
  }, 180000);
});
