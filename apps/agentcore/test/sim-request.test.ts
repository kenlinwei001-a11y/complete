import { describe, expect, it } from "vitest";
import { SimulationRequestSchema } from "@platform/contracts";
import {
  assembleSimulationRequest,
  isSimIntent,
  prototypeForIntent,
  resolveHorizonTicks,
  resolveScope,
} from "../src/router/sim-request.js";

/**
 * WO-SANDBOX-AS-RENDER-TARGET（S1）· SimulationRequest 归一装配器纯核单测（R6·不作假）。
 * MVP 边界：shock 可执行（READY）；hold/trend/policy 诚实 DEFERRED（S6 接地前不上线·KILL-MOCK-RED）。
 */

describe("isSimIntent / prototypeForIntent · 时序意图识别", () => {
  it("4 时序意图键识别 + 原型映射；非时序意图不认", () => {
    expect(isSimIntent("sim.shock_whatif")).toBe(true);
    expect(isSimIntent("sim.hold_whatif")).toBe(true);
    expect(isSimIntent("capacity_feasibility")).toBe(false);
    expect(isSimIntent(undefined)).toBe(false);
    expect(prototypeForIntent("sim.shock_whatif")).toBe("shock");
    expect(prototypeForIntent("sim.hold_whatif")).toBe("hold");
    expect(prototypeForIntent("sim.trend_whatif")).toBe("trend");
    expect(prototypeForIntent("sim.policy_whatif")).toBe("policy");
  });
});

describe("resolveHorizonTicks · 时窗槽→tick（tick=1模拟日·R6）", () => {
  it("60天→60·3周→21·2月→60·缺省14", () => {
    expect(resolveHorizonTicks({ days: 60 })).toBe(60);
    expect(resolveHorizonTicks({ weeks: 3 })).toBe(21);
    expect(resolveHorizonTicks({ months: 2 })).toBe(60);
    expect(resolveHorizonTicks({ horizonTicks: 45 })).toBe(45);
    expect(resolveHorizonTicks({})).toBe(14);
    // 字符串数字也吃（LLM 抽槽常给字符串）
    expect(resolveHorizonTicks({ weeks: "3" })).toBe(21);
  });
});

describe("resolveScope · 对象范围解析（selectedObjects 优先·同类型聚合）", () => {
  it("selectedObjects 同类型聚合；缺则读 slots.objectType/objectIds；无 objectType→undefined", () => {
    expect(
      resolveScope({}, [
        { objectType: "Base", objectId: "b1" },
        { objectType: "Base", objectId: "b2" },
        { objectType: "Model", objectId: "m1" },
      ]),
    ).toEqual({ objectType: "Base", objectIds: ["b1", "b2"] });
    expect(resolveScope({ objectType: "Line", objectIds: ["L1"] }, [])).toEqual({ objectType: "Line", objectIds: ["L1"] });
    expect(resolveScope({ scope: "L2" }, [])).toBeUndefined(); // 无 objectType
  });
});

describe("assembleSimulationRequest · shock READY / 其余 DEFERRED（MVP 边界·诚实）", () => {
  it("shock + scope 齐 → READY：合法 SimulationRequest（zod 过）+ sandbox_render 块 + 横幅", () => {
    const r = assembleSimulationRequest(
      "sim.shock_whatif",
      { stateVar: "load", delta: 20, weeks: 3 },
      [{ objectType: "Base", objectId: "常州二线" }],
    );
    expect(r.status).toBe("READY");
    if (r.status !== "READY") return;
    // request 合法（契约 zod 过·source=dialogue·targetView 恒 sim-sandbox）
    expect(() => SimulationRequestSchema.parse(r.request)).not.toThrow();
    expect(r.request.source).toBe("dialogue");
    expect(r.request.targetView).toBe("sim-sandbox");
    expect(r.request.horizonTicks).toBe(21);
    expect(r.request.compareBaseline).toBe(false); // MVP：不双跑求解器维
    expect(r.request.scenario).toHaveLength(1);
    const act = r.request.scenario[0]!;
    expect(act.kind).toBe("shock");
    if (act.kind === "shock") {
      expect(act.target).toEqual({ objectType: "Base", objectIds: ["常州二线"], stateVar: "load" });
      expect(act.delta).toBe(20);
    }
    // 答案块 headline 逐值（含真 delta·非造数）
    expect(r.block.type).toBe("sandbox_render");
    expect(r.block.headline).toContain("常州二线");
    expect(r.block.headline).toContain("21 tick");
  });

  it("hold/trend/policy → DEFERRED（时序接地建设中·S6 门·绝不假跑）+ horizonTicks 仍解析", () => {
    for (const [key, proto] of [
      ["sim.hold_whatif", "hold"],
      ["sim.trend_whatif", "trend"],
      ["sim.policy_whatif", "policy"],
    ] as const) {
      const r = assembleSimulationRequest(key, { days: 60 }, [{ objectType: "Base", objectId: "b1" }]);
      expect(r.status).toBe("DEFERRED");
      if (r.status !== "DEFERRED") continue;
      expect(r.prototype).toBe(proto);
      expect(r.horizonTicks).toBe(60);
      expect(r.reason).toContain("时序接地");
      expect(r.reason).toMatch(/S6|TEMPORAL-GROUNDING|建设中/);
    }
  });

  it("shock 但 scope 缺（无对象）→ DEFERRED（不造伪 scope·诚实）", () => {
    const r = assembleSimulationRequest("sim.shock_whatif", { delta: 10, weeks: 2 }, []);
    expect(r.status).toBe("DEFERRED");
    if (r.status === "DEFERRED") expect(r.reason).toContain("对象");
  });

  it("非时序意图 → NOT_SIM（装配器不动作·回落正常路径）", () => {
    expect(assembleSimulationRequest("capacity_feasibility", {}, []).status).toBe("NOT_SIM");
  });

  it("R6：同输入双跑 → request 字节一致（无时钟/随机）", () => {
    const inp = () =>
      assembleSimulationRequest("sim.shock_whatif", { stateVar: "backlog", delta: 5, weeks: 4 }, [
        { objectType: "Line", objectId: "L1" },
      ]);
    const a = inp();
    const b = inp();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("shock 缺 delta → delta=0（纯当前态短程演化·诚实非造数）+ headline 走当前态措辞", () => {
    const r = assembleSimulationRequest("sim.shock_whatif", { stateVar: "load", weeks: 1 }, [
      { objectType: "Base", objectId: "b1" },
    ]);
    expect(r.status).toBe("READY");
    if (r.status !== "READY") return;
    const act = r.request.scenario[0]!;
    if (act.kind === "shock") expect(act.delta).toBe(0);
    expect(r.block.headline).toContain("当前态演化");
  });
});
