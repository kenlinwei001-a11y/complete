import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import type { Decision } from "@platform/contracts";

/**
 * WO-SANDBOX-ACTION-PROPAGATION · SEAM 组合测试（接缝门：数据半=ActionPropagationRule 种子 × 引擎半=propagateTick action 注入 × 端点半=apply-action）。
 *
 * 头号判据（SEAM-GATE·绿测试≠能用）：已提交动作 → 沙盘状态变量**真传导**（改系数则果变·非写死）：
 *  ① apply-action(reprioritize_order) → Order.demandPressure 真变（幅度×系数·KILL-MOCK-RED）。
 *  ② 随后 tick → 沿真链路（order_for_model→model_producible_at）扩散到下游 Base.loadIndex（跨对象·真图）。
 *  ③ 改 ActionPropagationRule.coefficient → 注入幅度成比例变（证系数驱动·非硬编码）。
 *  ④ delayTicks：adopt_mitigation 延迟 2 tick 才生效（Temporal Trust·当 tick 不显现）。
 *  ⑤ R4 模拟态不落真值：apply-action 只写 sim_tick_state，对象库真值不变。
 *  ⑥ R3 entitlement：sim.propagation 关 → 404 FEATURE_NOT_FOUND。
 *  ⑦ R6 确定性：同 apply-action 重跑 trace/state 字节一致。
 *  ⑧ 决策→沙盘只读桥：commit 决策 → GET sandbox-triggers 返 adopt_mitigation 预览（携真 closesGap）。
 */
const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

type State = Record<string, Record<string, number>>;

/** 发现一条真 order→model→base 链路（demo 真对象实例），供跨对象扩散断言。 */
async function findChain(t: TestApp): Promise<{ orderId: string; modelId: string; baseId: string } | null> {
  const ofm = await t.repos.links.list("demo", (l) => l.type === "order_for_model");
  const mpa = await t.repos.links.list("demo", (l) => l.type === "model_producible_at");
  for (const o of ofm) {
    const mp = mpa.find((m) => m.fromId === o.toId);
    if (mp) return { orderId: o.fromId, modelId: o.toId, baseId: mp.toId };
  }
  return null;
}

describe("WO-SANDBOX-ACTION-PROPAGATION · 沙盘 action→stateVar 传导闭环", () => {
  it("① action→stateVar 即时注入：apply-action(reprioritize_order) → Order.demandPressure 真变（幅度×系数）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const chain = await findChain(t);
    expect(chain).not.toBeNull();
    const { orderId, modelId, baseId } = chain!;
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: { [orderId]: { demandPressure: 0 }, [modelId]: { demandLoad: 0 }, [baseId]: { loadIndex: 0 } } },
    })).json()).id as string;

    const res = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/apply-action`, headers: ADMIN,
      payload: { actionTypeKey: "reprioritize_order", payload: { orderId, deltaPressure: 10 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { curTick: number; state: State; trace: Array<{ sourceKind: string; toObjectId: string; amount: number }>; injected: number };
    // 系数 1.0 × 幅度 10 = 10（真算·非写死）。
    expect(body.state[orderId]!.demandPressure).toBe(10);
    expect(body.injected).toBe(1);
    // trace 标记扰动源为 action。
    const actionTrace = body.trace.find((x) => x.sourceKind === "action");
    expect(actionTrace).toBeDefined();
    expect(actionTrace!.toObjectId).toBe(orderId);
    expect(actionTrace!.amount).toBe(10);
  });

  it("② SEAM 跨对象扩散：apply-action 注入后 tick → 沿真链路传到下游 Model→Base", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { orderId, modelId, baseId } = (await findChain(t))!;
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: { [orderId]: { demandPressure: 0 }, [modelId]: { demandLoad: 0 }, [baseId]: { loadIndex: 0 } } },
    })).json()).id as string;
    // apply-action：Order.demandPressure=10（当 tick 注入·下游规则读旧态 0·本 tick 不扩散）。
    await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/apply-action`, headers: ADMIN,
      payload: { actionTypeKey: "reprioritize_order", payload: { orderId, deltaPressure: 10 } },
    });
    // tick1：Order.demandPressure=10 × 0.8 → Model.demandLoad=8（order_for_model 即时）。
    const t1 = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json() as { state: State };
    expect(t1.state[modelId]!.demandLoad).toBe(8);
    // tick2：Model.demandLoad=8 × 0.6 → Base.loadIndex=4.8（model_producible_at 即时·跨对象真传导）。
    const t2 = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json() as { state: State };
    expect(t2.state[baseId]!.loadIndex).toBeGreaterThan(0);
    expect(t2.state[baseId]!.loadIndex).toBe(4.8);
  });

  it("③ 改系数果变（KILL-MOCK-RED·非写死）：ActionPropagationRule.coefficient 翻倍 → 注入幅度翻倍", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { orderId } = (await findChain(t))!;
    const mkSession = async () =>
      (await (await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
        payload: { baseSnapshot: { [orderId]: { demandPressure: 0 } } },
      })).json()).id as string;
    const apply = async (sid: string) =>
      ((await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/apply-action`, headers: ADMIN,
        payload: { actionTypeKey: "reprioritize_order", payload: { orderId, deltaPressure: 10 } },
      })).json() as { state: State }).state[orderId]!.demandPressure;

    const before = await apply(await mkSession());
    expect(before).toBe(10); // coeff 1.0
    // 把 action 规则系数改为 2.0（同 key 覆盖）→ 应得 20（引擎读规则系数·非硬编码）。
    const rules = await t.repos.sim.listActionPropagationRules("demo", true);
    const rule = rules.find((r) => r.key === "demo_action_order_reprioritize")!;
    await t.repos.sim.putActionPropagationRule({ ...rule, coefficient: 2.0 });
    const after = await apply(await mkSession());
    expect(after).toBe(20);
  });

  it("④ delayTicks（Temporal Trust）：adopt_mitigation(capacity_add) 延迟 2 tick 才生效", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    // 取一个真 Base 对象 id。
    const bases = await t.repos.objects.listByType("demo", "Base");
    expect(bases.length).toBeGreaterThan(0);
    const baseId = bases[0]!.id;
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: { [baseId]: { loadIndex: 100 } } },
    })).json()).id as string;
    // apply-action：命中 matchPredicate kind==capacity_add·delayTicks=2 → 当 tick 不改，排 pending。
    const applied = (await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/apply-action`, headers: ADMIN,
      payload: { actionTypeKey: "adopt_mitigation", payload: { baseId, kind: "capacity_add", deltaGwh: 5 } },
    })).json() as { curTick: number; state: State };
    expect(applied.state[baseId]!.loadIndex).toBe(100); // 延迟·当 tick 不显现（Temporal）·arriveTick=0+2=2·此时 curTick=1
    // tick 1 次：beforeTick=1<arriveTick → 仍不生效（100·证延迟真守）。
    const mid = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json() as { state: State };
    expect(mid.state[baseId]!.loadIndex).toBe(100);
    // 再 tick 1 次：beforeTick=2===arriveTick → -0.4 × 5 = -2 生效 → 98。
    const after = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json() as { state: State };
    expect(after.state[baseId]!.loadIndex).toBe(98);
  });

  it("⑤ R4 模拟态不落真值：apply-action 只写 sim_tick_state，对象库真值不变", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const { orderId } = (await findChain(t))!;
    const before = JSON.stringify(await t.repos.objects.get("demo", orderId));
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: { [orderId]: { demandPressure: 0 } } },
    })).json()).id as string;
    await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/apply-action`, headers: ADMIN,
      payload: { actionTypeKey: "reprioritize_order", payload: { orderId, deltaPressure: 10 } },
    });
    // 对象库真值未被沙盘写（R4）。
    expect(JSON.stringify(await t.repos.objects.get("demo", orderId))).toBe(before);
  });

  it("⑥ R3 entitlement：sim.propagation 关 → apply-action 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    // 只开 sandbox，不开 propagation。
    await t.app.inject({
      method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
      payload: { overrides: { "sim.sandbox": true, "sim.propagation": false } },
    });
    const { orderId } = (await findChain(t))!;
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: { [orderId]: { demandPressure: 0 } } },
    })).json()).id as string;
    const res = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/apply-action`, headers: ADMIN,
      payload: { actionTypeKey: "reprioritize_order", payload: { orderId, deltaPressure: 10 } },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("FEATURE_NOT_FOUND");
  });

  it("⑦ R6 确定性：同 apply-action 重跑 state/trace 字节一致", async () => {
    const run = async () => {
      const t = await makeApp();
      await seedBattery(t);
      await seedDemoPropagationRules(t.repos);
      await enableSim(t);
      const { orderId } = (await findChain(t))!;
      const sid = (await (await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: { [orderId]: { demandPressure: 3 } } },
      })).json()).id as string;
      const r = (await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/apply-action`, headers: ADMIN,
        payload: { actionTypeKey: "reprioritize_order", payload: { orderId, deltaPressure: 7 } },
      })).json() as { state: State; trace: unknown };
      return JSON.stringify({ state: r.state, trace: r.trace });
    };
    expect(await run()).toBe(await run());
  });

  it("⑧ 决策→沙盘只读桥：commit 决策 → GET sandbox-triggers 返 adopt_mitigation 预览（携真 closesGap）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const M = "seg_attain_ess";
    const dp = (await t.services.solvers.invoke(
      { tenantId: "demo", userId: "u-admin", roles: ["admin"], attributes: {} }, "decision_play", { metricKey: M },
    )) as unknown as { options: { optionId: string }[] };
    const chosen = dp.options.slice(0, 2).map((o) => o.optionId);
    const dec = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } })).json() as Decision;
    await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN });
    const res = await t.app.inject({ method: "GET", url: `/a/v1/decisions/${dec.id}/sandbox-triggers`, headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const triggers = res.json().triggers as Array<{ actionTypeKey: string; payload: Record<string, unknown> }>;
    expect(triggers.length).toBe(chosen.length);
    expect(triggers.every((x) => x.actionTypeKey === "adopt_mitigation")).toBe(true);
    // 携真派生量（closesGap·option 上真算·非写死），且是数值。
    expect(triggers.every((x) => typeof x.payload.closesGap === "number")).toBe(true);
    expect(triggers.every((x) => x.payload.planKey && chosen.includes(x.payload.planKey as string))).toBe(true);
  });
});
