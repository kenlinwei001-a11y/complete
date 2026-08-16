import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, type TestApp } from "./helpers.js";
import { buildComposeNarrative, classifyCapacityQuestion } from "../src/router/live-endpoints.js";

/**
 * WO-LIVE-ENDPOINTS · 活①② 全局推演/产能页「人机对话」端点 SEAM（agentcore 半·A+B 接缝驱动）。
 *
 * 活① compose：POST /b/v1/sim/compose 调真 portfolio（twoStage·三方案）→ 叙述含真 portfolio 数字·
 *   ranAgentLoop 恒 false（compose 单原语·非 path-B agent）；改 portfolio 真解 → 叙述变（KILL-MOCK）。
 * 活② capacity-live：POST /b/v1/capacity-live/ask 识别 what-if → generic_inference(levers)；levers 空 → 诚实
 *   转 gap_attribution 真根因（不返空壳）；root-cause 问句 → gap_attribution。
 */

const H = { "x-debug-user": encodeURIComponent(ADMIN), "content-type": "application/json" };

describe("WO-LIVE-ENDPOINTS · 活① compose 纯映射（R6·数字取 portfolio 真值）", () => {
  it("buildComposeNarrative：objectiveValues/served/displaced → 读数 + 叙述含真数字", () => {
    const out = buildComposeNarrative("排产", [
      { key: "max_ontime", objectiveValues: { ontime: 11, cost: 2447944.8 }, servedCount: 11, displacedCount: 8 },
      { key: "min_cost", objectiveValues: { ontime: 9, cost: 2010968.3 }, servedCount: 9, displacedCount: 8 },
    ]);
    expect(out.path).toBe("compose");
    expect(out.ranAgentLoop).toBe(false);
    // ontimeRate = round(11/(11+8)*100) = 58
    expect(out.scenarios[0]).toEqual({ key: "max_ontime", ontime: 11, displaced: 8, ontimeRate: 58, cost: 2447944.8 });
    expect(out.narrative).toContain("58%");
    expect(out.narrative).toContain("2447944.8");
    expect(out.provenance[0]!.drillValue!).toBe(11);
  });

  it("改 portfolio 真解 → 叙述/读数变（KILL-MOCK·输出随输入）", () => {
    const a = buildComposeNarrative("q", [{ key: "max_ontime", objectiveValues: { ontime: 11, cost: 100 }, servedCount: 11, displacedCount: 8 }]);
    const b = buildComposeNarrative("q", [{ key: "max_ontime", objectiveValues: { ontime: 5, cost: 999 }, servedCount: 5, displacedCount: 14 }]);
    expect(a.narrative).not.toBe(b.narrative);
    expect(a.scenarios[0]!.ontimeRate!).not.toBe(b.scenarios[0]!.ontimeRate!);
  });
});

describe("WO-LIVE-ENDPOINTS · 活① compose 端点 SEAM（真 portfolio → 叙述·A+B 接缝）", () => {
  it("POST /b/v1/sim/compose：portfolio 收 twoStage+三方案 → 叙述含真数字·ranAgentLoop=false·改解→变", async () => {
    const t = await createTestApp();
    let scen: Record<string, unknown>[] = [
      { key: "max_ontime", objectiveValues: { ontime: 11, cost: 2447944.8 }, servedCount: 11, displacedCount: 8 },
      { key: "min_cost", objectiveValues: { ontime: 9, cost: 2010968.3 }, servedCount: 9, displacedCount: 8 },
      { key: "min_changeover", objectiveValues: { ontime: 9, cost: 2010968.3 }, servedCount: 9, displacedCount: 8 },
    ];
    let seenArgs: Record<string, unknown> | undefined;
    t.dataCore.solver.invoke = async (_ctx, key, args) => {
      if (key === "portfolio") { seenArgs = args; return { data: { scenarios: scen }, snapshotVersion: "v" }; }
      return { data: {}, snapshotVersion: "v" };
    };
    const res = await t.app.inject({ method: "POST", url: "/b/v1/sim/compose", headers: H, payload: { query: "排产", page: "global-sim" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.path).toBe("compose");
    expect(body.ranAgentLoop).toBe(false);
    // A+B 接缝：真 datacore-http 调 portfolio 的参数（twoStage + 三方案集）。
    expect(seenArgs?.twoStage).toBe(true);
    expect(seenArgs?.scenarios).toEqual(["max_ontime", "min_cost", "min_changeover"]);
    // 叙述含真 portfolio 数字。
    expect(body.narrative).toContain("2447944.8");
    expect(body.scenarios[0].ontime).toBe(11);
    expect(body.provenance[0].drillId).toBe("portfolio");

    // 改 portfolio 真解 → 叙述变（KILL-MOCK）。
    const before = body.narrative;
    scen = [{ key: "max_ontime", objectiveValues: { ontime: 3, cost: 500 }, servedCount: 3, displacedCount: 20 }];
    const res2 = await t.app.inject({ method: "POST", url: "/b/v1/sim/compose", headers: H, payload: { query: "排产" } });
    expect(res2.json().narrative).not.toBe(before);
    await t.app.close();
  });
});

describe("WO-LIVE-ENDPOINTS · 活② capacity-live 端点 SEAM（what-if 意图 → 真 solver 路由）", () => {
  it("classifyCapacityQuestion：识别 what-if + 因子（root-cause 不误判）", () => {
    const wi = classifyCapacityQuestion("化成良率降到92%产能少多少");
    expect(wi.isWhatIf).toBe(true);
    expect(wi.factors).toContain("良率波动");
    expect(classifyCapacityQuestion("为什么越线").isWhatIf).toBe(false);
    expect(classifyCapacityQuestion("涂布机 OEE 提到85%还够不够").isWhatIf).toBe(true);
  });

  it("what-if · levers 非空 → generic_inference 敏感度叙述带溯源", async () => {
    const t = await createTestApp();
    const calls: string[] = [];
    t.dataCore.solver.invoke = async (_ctx, key) => {
      calls.push(key);
      if (key === "generic_inference") {
        return { data: { levers: [{ objectType: "Line", objectId: "line-1", prop: "capacityDaily", currentValue: 30000, sensitivity: 1.5, provenance: { src: "generic_inference · recompute(dryRun,+ε)", formula: "∂/∂", inputs: ["x"] } }] } };
      }
      return { data: {} };
    };
    const res = await t.app.inject({ method: "POST", url: "/b/v1/capacity-live/ask", headers: H, payload: { baseId: "changzhou", question: "化成良率降到92%产能少多少" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(calls).toContain("generic_inference");
    expect(body.solver).toBe("generic_inference");
    expect(body.answer).toContain("敏感度");
    expect(body.provenance.src).toContain("generic_inference");
    expect(body.dataMode).toBe("LIVE");
    await t.app.close();
  });

  it("what-if · levers 空 → 诚实转 gap_attribution 真根因（KILL-MOCK-RED·不返空壳）", async () => {
    const t = await createTestApp();
    const calls: string[] = [];
    let gaScope: unknown;
    t.dataCore.solver.invoke = async (_ctx, key, args) => {
      calls.push(key);
      if (key === "generic_inference") return { data: { levers: [] } };
      if (key === "gap_attribution") { gaScope = (args as { scope?: unknown }).scope; return { data: { rootMetric: { name: "储能达成率", gap: 8.9, unit: "%" }, totalGap: 8.9, summary: "常州对储能达成率缺口贡献 8.9%" } }; }
      return { data: {} };
    };
    const res = await t.app.inject({ method: "POST", url: "/b/v1/capacity-live/ask", headers: H, payload: { baseId: "changzhou", question: "化成良率降到92%产能少多少", factor: "cf-coating-yield" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(calls).toEqual(["generic_inference", "gap_attribution"]);
    expect(body.solver).toBe("gap_attribution");
    expect(body.answer).toContain("常州对储能达成率缺口贡献 8.9%");
    expect(gaScope).toEqual({ baseId: "changzhou", factorId: "cf-coating-yield" });
    expect(body.provenance.inputs).toContain("scope.baseId=changzhou");
    expect(body.provenance.inputs).toContain("scope.factorId=cf-coating-yield");
    await t.app.close();
  });

  it("root-cause 问句 → 直接 gap_attribution（不走 generic_inference）", async () => {
    const t = await createTestApp();
    const calls: string[] = [];
    t.dataCore.solver.invoke = async (_ctx, key) => { calls.push(key); return { data: { summary: "根因摘要" } }; };
    const res = await t.app.inject({ method: "POST", url: "/b/v1/capacity-live/ask", headers: H, payload: { baseId: "hefei", question: "为什么越线" } });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(["gap_attribution"]);
    expect(res.json().solver).toBe("gap_attribution");
    await t.app.close();
  });
});
