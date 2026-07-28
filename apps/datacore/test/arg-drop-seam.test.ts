import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
// 跨包导入（同 xservice-smoke·生产同一份代码路径·非 mock）：真实 AgentCore 路由/种子/槽填/模板 ↔ 真实 DataCore 求解器。
import { createHttpDataCore } from "../../agentcore/src/tools/datacore-http.js";
import type { DataCoreClient, ToolAuthCtx } from "../../agentcore/src/tools/clients.js";
import { resolveCeoRoute, ceoIntentKeyForRoute } from "../../agentcore/src/router/ceo-route.js";
import { seedIntentsAndPlans } from "../../agentcore/src/mocks/seed.js";
import { fillSlots } from "../../agentcore/src/router/slots.js";
import { resolveTemplate } from "../../agentcore/src/util/template.js";

/**
 * WO-SEAM-ARG-DROP · 头号判据 SEAM（跨 router×plan×solver 接缝驱动·非各半 unit·SEAM-GATE）。
 *
 * 复刻 orchestrator path-A（CEO 路由）真实接缝：问句 → resolveCeoRoute(args) → fillSlots(只填 intent.slots) →
 *   plan {{slots.X}} → solver args → 真实 DataCore 求解器。断言"带实体深问 → 答案只含该实体"（非静默落首个/全域）。
 * 修前病根：ceo_credit_exposure slotNames=[] → fillSlots 丢 custName → deriveExtendedArgs `?? customers[0]` 静默落首客户。
 */

// string/json 槽的 validateSlotValue 不触 ontology（short-circuit）→ stub 只在被误调时抛（证没走 objectRef 解析）。
const ontologyStub = {
  listObjectTypeKeys: async () => { throw new Error("SEAM: ontology 不应被 string/json 槽调用"); },
  getObject: async () => { throw new Error("SEAM: ontology 不应被 string/json 槽调用"); },
  queryObjects: async () => { throw new Error("SEAM: ontology 不应被 string/json 槽调用"); },
} as unknown as Parameters<typeof fillSlots>[3];

async function driveSeam(query: string, pageContext: unknown, auth: ToolAuthCtx) {
  const route = resolveCeoRoute(query, pageContext as never, "ceo");
  const intentKey = ceoIntentKeyForRoute(route.route);
  const { intents, plans } = seedIntentsAndPlans("demo");
  const intent = intents.find((i) => i.key === intentKey)!;
  const plan = plans.find((p) => p.id === intent.planId)!;
  const sessionCtx = { presetSlots: {}, filters: {} } as never;
  const { slots, missing } = await fillSlots(intent, route.args as Record<string, unknown>, sessionCtx, ontologyStub, auth as never);
  const invoke = (plan.steps as { type: string; params: { solverKey: string; args: unknown } }[]).find((s) => s.type === "invoke_solver")!;
  const solverArgs = resolveTemplate(invoke.params.args, { slots, context: sessionCtx, steps: {} }) as Record<string, unknown>;
  return { route, intentKey, intent, slots, missing, solverKey: invoke.params.solverKey, solverArgs };
}

describe("SEAM-ARG-DROP · router×plan×solver 接缝驱动（真实 AgentCore 路由/槽/模板 ↔ 真实 DataCore 求解器）", () => {
  let t: TestApp;
  let dc: DataCoreClient;
  const ctx: ToolAuthCtx = { tenantId: "demo", userId: "admin", roles: ["admin"], debugUser: "demo:admin:admin" };

  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
    const baseUrl = await t.app.listen({ port: 0, host: "127.0.0.1" });
    dc = createHttpDataCore(baseUrl);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it("① CONFIRMED credit_exposure：带客户名深问 → custName 穿透接缝 → 答案只含该客户（非首客户整车厂A）", async () => {
    const seam = await driveSeam("电网公司F 的信用敞口有多大？", undefined, ctx);
    // 数据半：路由解析的 custName 真进 slot（修前 slotNames:[] → fillSlots 丢）→ plan {{slots.custName}} 真达 solverArgs。
    expect(seam.route.route).toBe("credit_exposure");
    expect(seam.intentKey).toBe("ceo_credit_exposure");
    expect(seam.slots.custName).toBe("电网公司"); // creditArgsFrom 截尾拉丁「电网公司F」→「电网公司」
    expect(seam.solverArgs.custName).toBe("电网公司"); // 无丢：模板 {{slots.custName}} 解析出真值

    // 引擎半：真 DataCore 求解器 → 稳健匹配「电网公司」→ 真实「电网公司F」，scope 显式标 CUSTOMER（非首客户）。
    const payload = await dc.solver.invoke(ctx, seam.solverKey, seam.solverArgs);
    const data = payload.data as { scope: { mode: string; custName?: string }; exposure: number };
    expect(data.scope.mode).toBe("CUSTOMER");
    expect(data.scope.custName).toBe("电网公司F"); // 答案只含该实体（数据种绑定 × 引擎路由·接缝驱动）

    // 对照：首客户「整车厂A」敞口是另一个数（证修前的 customers[0] 静默默认会答非所问）。
    const cust0 = await dc.solver.invoke(ctx, "credit_exposure", { custName: "整车厂A" });
    const d0 = cust0.data as { scope: { custName?: string }; exposure: number };
    expect(d0.scope.custName).toBe("整车厂A");
    expect(data.scope.custName).not.toBe(d0.scope.custName); // 电网公司F ≠ 整车厂A（不是同一个静默默认答案）
  });

  it("① 引擎半诚实化：未指定客户 → scope:ALL 全域合计（不静默冒充首个客户）", async () => {
    const payload = await dc.solver.invoke(ctx, "credit_exposure", {});
    const data = payload.data as { scope: { mode: string; custName?: string; customerCount?: number } };
    expect(data.scope.mode).toBe("ALL");
    expect(data.scope.custName).toBeUndefined(); // 不冒充某一个客户
    expect((data.scope.customerCount ?? 0)).toBeGreaterThan(1); // 真·全部客户合计
  });

  it("① 引擎半诚实化：指定客户无匹配 → AMBIGUOUS_SCOPE 报错（不静默落首客户）", async () => {
    await expect(dc.solver.invoke(ctx, "credit_exposure", { custName: "查无此客户xyz公司" })).rejects.toMatchObject({
      statusCode: 400,
      code: "AMBIGUOUS_SCOPE",
    });
  });

  it("② CONFIRMED whatif：带基地深问 → scopeObjectIds 穿透接缝达求解器（非名字不对接的 [null]）", async () => {
    const seam = await driveSeam("常州化成扩2通道能补多少缺口？", { focus: { base: "changzhou" } }, ctx);
    expect(seam.route.route).toBe("generic_inference");
    expect(seam.intentKey).toBe("ceo_whatif");
    // 修前：槽叫 baseId，路由发 scopeObjectIds → extracted 无 baseId → 槽落空 → 映射串成 [null]（基地作用域静默丢）。
    expect(seam.slots.scopeObjectIds).toEqual(["changzhou"]); // 路由 scopeObjectIds 真进 slot（对齐槽名后）
    expect(seam.solverArgs.scopeObjectIds).toEqual(["changzhou"]); // plan → solverArgs 真达（非 [null]）
    expect(seam.solverArgs.factors).toContain("瓶颈工序");
  });

  it("机制铁证：intent 未声明的实体被 fillSlots 静默丢（断在接缝·非模块内部）", async () => {
    const { intents } = seedIntentsAndPlans("demo");
    const credit = intents.find((i) => i.key === "ceo_credit_exposure")!;
    // 构造一个「去掉 custName 声明」的意图（复刻修前）→ 路由解析的 custName 被 fillSlots 丢弃。
    const stripped = { ...credit, slots: (credit.slots ?? []).filter((s) => s.name !== "custName") };
    const { slots } = await fillSlots(stripped as never, { custName: "电网公司" }, { presetSlots: {} } as never, ontologyStub, ctx as never);
    expect(slots.custName).toBeUndefined(); // 未声明 → 丢（这正是 G-ARG-DROP-SEAM 的接缝）
    // 对照：真种子（已修·声明了 custName）→ 不丢
    const kept = await fillSlots(credit as never, { custName: "电网公司" }, { presetSlots: {} } as never, ontologyStub, ctx as never);
    expect(kept.slots.custName).toBe("电网公司");
  });
});
