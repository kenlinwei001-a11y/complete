import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

/**
 * 沙盘消"空世界"（审计 §3.5）：SEED_DEMO 给 demo 租户播 sim PropagationRule 种子。
 * 验：种了规则后 view-config 返 propagationCount≥2 + stateVars 非空；确定性重跑一致；
 * 沿 demo 真链路（Order/Model/Base + order_for_model/model_producible_at）传导真生效。
 *
 * 边界：PropagationRule 是独立 sim 表，正交于电池合成字节一致基线（不碰 battery）。
 */
const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

describe("SEED_DEMO · 沙盘传导规则种子", () => {
  it("种子后 view-config：propagationCount≥2 + stateVars 非空（消空世界）", async () => {
    const t = await makeApp();
    await seedBattery(t); // 本体 + 真对象/链路
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const cfg = (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/view-config", headers: ADMIN })).json()) as {
      nodeTypes: string[]; stateVars: string[]; propagationCount: number;
    };
    expect(cfg.propagationCount).toBeGreaterThanOrEqual(2);
    expect(cfg.stateVars.length).toBeGreaterThan(0);
    // stateVars 派生自规则 source/target stateVar。source 一律取**真对象已物化数值属性名**（CORE-E2-PROPAGATE C3）：
    // Order.demandDelta / Model.totalDemand / Line.utilization（真源）；demandLoad/loadIndex 是传导写出的沙盘态。
    expect(cfg.stateVars).toEqual(["demandDelta", "demandLoad", "loadIndex", "totalDemand", "utilization"]);
    // 节点类型派生自本体（含 demo 真类型）。
    expect(cfg.nodeTypes).toContain("Order");
    expect(cfg.nodeTypes).toContain("Model");
    expect(cfg.nodeTypes).toContain("Base");
  });

  it("种的规则沿真链路（Order/Model/Base）：发布且 viaLinkKey 是 demo 真链路", async () => {
    const t = await makeApp();
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const items = (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN })).json()).items as Array<{
      key: string; status: string; viaLinkKey: string; sourceTypeKey: string; targetTypeKey: string;
    }>;
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.every((r) => r.status === "PUBLISHED")).toBe(true);
    const viaKeys = items.map((r) => r.viaLinkKey).sort();
    expect(viaKeys).toEqual(["line_belongs_to_base", "model_producible_at", "order_for_model"]);
  });

  it("确定性 R6：同 SEED_DEMO 重跑规则字节一致（固定 id/系数）", async () => {
    const snapshot = async () => {
      const t = await makeApp();
      await seedDemoPropagationRules(t.repos);
      const items = await t.repos.sim.listPropagationRules("demo", true);
      return JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id)));
    };
    expect(await snapshot()).toBe(await snapshot());
  });

  it("幂等：重复播种不增项（固定 id 覆盖）", async () => {
    const t = await makeApp();
    await seedDemoPropagationRules(t.repos);
    await seedDemoPropagationRules(t.repos);
    const items = await t.repos.sim.listPropagationRules("demo", true);
    expect(items.length).toBe(3);
  });

  it("live-fire：种子规则 + 真 Order→Model 链路 → tick 真跨对象传导", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    // 取一条真 order_for_model 链路（demo 真对象实例），在其 source 订单上置初始需求偏差（真属性名 demandDelta）。
    const links = await t.repos.links.list("demo", (l) => l.type === "order_for_model");
    expect(links.length).toBeGreaterThan(0);
    const { fromId: orderId, toId: modelId } = links[0]!;
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: { [orderId]: { demandDelta: 10 }, [modelId]: { demandLoad: 0 } } },
    })).json()).id as string;
    const tick = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(tick.statusCode).toBe(200);
    // Order.demandDelta=10 × coeff 0.8 → Model.demandLoad += 8（沿 order_for_model 即时传导）。
    expect((tick.json().state as Record<string, Record<string, number>>)[modelId]!.demandLoad).toBe(8);
  });
});
