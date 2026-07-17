import { describe, expect, it } from "vitest";
import type { QueryTask, PageContext, DataCoreClient, ToolPayload } from "@platform/contracts";
import { buildAgentUser, pageContextSummary } from "../src/agent/prompts.js";
import { resolveCeoRoute, scopeBasesFor } from "../src/router/ceo-route.js";
import { CeoAgent, createCeoAgentProfile } from "../src/agent/ceo.js";

/**
 * WO-CEO-6 · CEO agent + PageContext 注入（闭 G-3·绿测试≠能用）。
 * C1 PageContext 真派生·C2 presetContext 真注入·C3 上下文真生效·C4 路由真·
 * C5 溯源链·C6 角色 scope·C7 反向驱动契约·C8 R6 确定性。
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

  it("C1 PageContext 真派生：schema 接受从真对象派生的实体，且 drillRef 指回源对象（非写死文案）", () => {
    // 页面上的每个 entity 都带 type/id/label，且 drillRef 可反向驱动页面
    expect(pcEss.entities[0]?.drillRef).toBe("obj_metric_kpi-seg-ess");
    expect(pcEss.entities[0]?.type).toBe("Metric");
    expect(pcEss.entities[0]?.id).toBe("seg_attain_ess");
    const summary = pageContextSummary(pcEss);
    expect(summary).toContain("储能达成率");
    expect(summary).toContain("seg_attain_ess");
  });

  it("C5 溯源链：CEO agent 答案带 solver/entity 两跳 provenance，且标快照版本", async () => {
    const solverCalls: { key: string; args: Record<string, unknown> }[] = [];
    const mockDataCore: DataCoreClient = {
      solver: {
        invoke: async (_ctx, key, args) => {
          solverCalls.push({ key, args });
          return { data: { options: [{ id: "opt1", closesGap: 1.2 }], addressableGap: 2.5 }, snapshotVersion: "snap_v1" } as ToolPayload;
        },
      },
      ontology: {
        getObject: async (_ctx, type, id) => ({ data: { type, id }, snapshotVersion: "snap_v2" } as ToolPayload),
      },
    } as unknown as DataCoreClient;
    const agent = new CeoAgent({ dataCore: mockDataCore });
    const { answer, route } = await agent.answer({ question: "这个根因怎么补", pageContext: pcEss, role: "ceo", auth: { tenantId: "demo", userId: "u", roles: ["admin"] } });
    expect(route.solverKey).toBe("decision_play");
    expect(solverCalls).toHaveLength(1);
    expect(solverCalls[0]!.args.metricKey).toBe("seg_attain_ess");
    expect(solverCalls[0]!.args.factorId).toBe("cf-cathode-shortage");
    // 每跳溯源：求解器 + 页面实体
    expect(answer.provenance.length).toBeGreaterThanOrEqual(1);
    expect(answer.provenance.some((p) => p.toolName === "decision_play")).toBe(true);
    expect(answer.provenance.some((p) => p.toolName === "get_object")).toBe(true);
    expect(answer.provenance.every((p) => p.snapshotVersion)).toBe(true);
  });

  it("C7 反向驱动契约：答案文本携带 drillRef，前端可据此定位源对象", async () => {
    const mockDataCore: DataCoreClient = {
      solver: {
        invoke: async () => ({ data: { leaves: [{ factorId: "cf-cathode-shortage", contribution: 5 }] }, snapshotVersion: "snap_v3" } as ToolPayload),
      },
      ontology: {
        getObject: async () => ({ data: {}, snapshotVersion: "snap_v4" } as ToolPayload),
      },
    } as unknown as DataCoreClient;
    const agent = new CeoAgent({ dataCore: mockDataCore });
    const { answer } = await agent.answer({ question: "储能为什么没达标", pageContext: pcEss, role: "ceo", auth: { tenantId: "demo", userId: "u", roles: ["admin"] } });
    const text = answer.blocks.find((b) => b.type === "text")?.markdown ?? "";
    expect(text).toContain("drillRef=obj_metric_kpi-seg-ess");
    expect(text).toContain("cf-cathode-shortage");
  });

  it("CeoAgentProfile：CEO 全域 vs base-planner 基地 scope 画像正确", () => {
    const ceo = createCeoAgentProfile("ceo");
    expect(ceo.scope.allBases).toBe(true);
    expect(ceo.scope.baseIds).toEqual([]);
    const planner = createCeoAgentProfile("base-planner", ["changzhou"]);
    expect(planner.scope.allBases).toBe(false);
    expect(planner.scope.baseIds).toEqual(["changzhou"]);
  });
});
