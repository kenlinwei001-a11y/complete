import { describe, expect, it } from "vitest";
import type { QueryTask, PageContext } from "@platform/contracts";
import { buildAgentUser, pageContextSummary } from "../src/agent/prompts.js";
import { resolveCeoRoute, scopeBasesFor } from "../src/router/ceo-route.js";

/**
 * WO-CEO-6 · CEO agent + PageContext 注入（闭 G-3·绿测试≠能用）。
 * C2 presetContext 真注入（PageContext 进 agent 上下文·非丢弃）·C3 上下文真生效（同问句不同 PageContext→不同 args）·
 * C4 路由真（问句意图→对应求解器）·C6 角色 scope（base-planner 剪枝）·C8 R6 确定性。
 */
const pcEss: PageContext = {
  view: "gap-waterfall",
  focus: { metric: "seg_attain_ess", gap: 27.8, factorId: "cf-cathode-shortage" },
  entities: [{ type: "Metric", id: "seg_attain_ess", label: "储能达成率", value: 72.2, drillRef: "obj_metric_kpi-seg-ess" }],
  selection: ["cf-cathode-shortage"],
  drillPath: ["seg_attain_ess", "base:changzhou", "cf-cathode-shortage"],
  actions: ["decision_play"],
};
const task = (query: string, pageContext?: PageContext): QueryTask => ({
  id: "task_t", tenantId: "demo", userId: "u", packageId: "pkg", conversationId: "c",
  query, context: { view: "gap-waterfall", selectedObjects: [], filters: {}, ...(pageContext ? { pageContext } : {}) },
  status: "RUNNING", clarificationRounds: 0, createdAt: "2026-07-17T00:00:00.000Z",
});

describe("WO-CEO-6 · CEO agent + PageContext 注入（闭 G-3）", () => {
  it("C2 真注入：PageContext focus/selection/entities/drillPath 进 agent 上下文（buildAgentUser·非丢弃）", () => {
    const withPc = buildAgentUser(task("这个根因怎么补", pcEss));
    const withoutPc = buildAgentUser(task("这个根因怎么补"));
    expect(withPc).toContain("seg_attain_ess"); // focus.metric 注入
    expect(withPc).toContain("cf-cathode-shortage"); // selection/焦点根因注入
    expect(withPc).toContain("储能达成率"); // 页面实体注入
    expect(withPc).toContain("下钻路径"); // drillPath 注入
    expect(withPc.length).toBeGreaterThan(withoutPc.length); // 带 PageContext 上下文更丰富（对比不带·G-3 真注入）
    expect(pageContextSummary(undefined)).toBe(""); // 无则不注入噪声（诚实空）
  });

  it("C4 路由真：问句意图→对应求解器（怎么补=decision_play·为什么=gap_attribution·差多少=metric_rollup）", () => {
    expect(resolveCeoRoute("这个根因怎么补", pcEss, "ceo").route).toBe("decision_play");
    expect(resolveCeoRoute("储能为什么没达标", pcEss, "ceo").route).toBe("gap_attribution");
    expect(resolveCeoRoute("储能还差多少达成", pcEss, "ceo").route).toBe("metric_rollup");
    expect(resolveCeoRoute("锂价信号触发了什么", pcEss, "ceo").route).toBe("signal");
    // args 从 PageContext 派生（注入真值·非写死）
    const r = resolveCeoRoute("这个根因怎么补", pcEss, "ceo");
    expect(r.args.metricKey).toBe("seg_attain_ess");
    expect(r.args.factorId).toBe("cf-cathode-shortage");
    expect(r.usedPageContext).toBe(true);
    expect(r.solverKey).toBe("decision_play");
  });

  it("C3 上下文真生效：同问句·不同 PageContext（selection 不同）→ 不同 args（agent 真用了页面焦点·非无视）", () => {
    const q = "这个怎么补";
    const rCathode = resolveCeoRoute(q, pcEss, "ceo");
    const pcEquip: PageContext = { ...pcEss, focus: { metric: "seg_attain_ess", factorId: "equip:changzhou" }, selection: ["equip:changzhou"] };
    const rEquip = resolveCeoRoute(q, pcEquip, "ceo");
    expect(rCathode.args.factorId).not.toBe(rEquip.args.factorId); // 选中根因不同→args 不同→答案不同
    // 无 PageContext 时同问句 args 空（证 args 真来自 PageContext）
    const rNone = resolveCeoRoute(q, undefined, "ceo");
    expect(rNone.usedPageContext).toBe(false);
    expect(rNone.args.factorId).toBeUndefined();
  });

  it("C6 角色 scope：CEO 全域 vs base-planner:常州 基地剪枝（A6 声明·datacore OBO 真过滤）", () => {
    expect(scopeBasesFor("ceo", [])).toEqual({ allBases: true, baseIds: [] });
    expect(scopeBasesFor("base-planner", ["changzhou"])).toEqual({ allBases: false, baseIds: ["changzhou"] });
    const ceo = resolveCeoRoute("洛阳产能怎么补", pcEss, "ceo");
    const cz = resolveCeoRoute("洛阳产能怎么补", pcEss, "base-planner", ["changzhou"]);
    expect(ceo.scopedBaseIds).toEqual([]); // 全域不剪
    expect(cz.scopedBaseIds).toEqual(["changzhou"]); // 基地限常州（跨基地由 datacore OBO 剪枝/403）
  });

  it("C8 R6 确定性：同问句+同 PageContext+同角色 两跑路由 deep-equal", () => {
    const a = resolveCeoRoute("这个根因怎么补", pcEss, "base-planner", ["changzhou"]);
    const b = resolveCeoRoute("这个根因怎么补", pcEss, "base-planner", ["changzhou"]);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
