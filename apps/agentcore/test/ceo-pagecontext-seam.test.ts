import { describe, expect, it } from "vitest";
import type { ObjectRef, PageContext, PageEntity } from "@platform/contracts";
import { resolveCeoRoute, isCeoQuestion } from "../src/router/ceo-route.js";
import { createTestApp, submitQuery, waitForTask, ADMIN } from "./helpers.js";

/**
 * WO-CEO-6-FE SEAM（闭 G-3·数据形状 × 引擎路由 两半接缝）·**只读验证**（不改后端逻辑）。
 *
 * 病根：前端 buildContext 从不产 pageContext → orchestrator `hasPageContext` 门恒假 → CEO 深问意图从不进候选
 *（唯二设 pageContext 的是后端测试 = 教科书「绿测试≠能用」）。本单让 buildContext 真产 pageContext。
 *
 * 本 seam 证明的**不是**「pageContext 被产出」，而是「buildContext 实际产出的形状能**真打开门并路由到求解器·
 * args 派生自 pageContext**」：因 resolveCeoRoute/orchestrator 在 agentcore，而前端 store 在 frontend-shell
 *（contracts-only-shared·跨 app 不可 import），此处以 `derivePageContextMirror` 逐字段镜像
 * `apps/frontend-shell/src/store/sessionStore.ts` 的 derivePageContext（entities=选中对象映射·selection=选中 id·
 * focus.metric=Metric 对象·focus.factorId=根因对象·drillPath=[]），驱动**真** resolveCeoRoute + **真** orchestrator。
 * 前端侧另有 f56 证 buildContext 派生这一形状（改选中→派生变）——两半合起来即端到端接缝。
 */

/** 镜像 sessionStore.derivePageContext（前端真源·此处因跨 app 不可 import·逐字段对齐）。 */
function derivePageContextMirror(s: { view: string; selectedObjects: ObjectRef[]; filters: Record<string, string | string[]> }): PageContext {
  const entities: PageEntity[] = s.selectedObjects.map((o) => ({ type: o.objectType, id: o.objectId, label: o.label ?? o.objectId, drillRef: o.objectId }));
  const selection = s.selectedObjects.map((o) => o.objectId);
  const scalar = (k: string) => (typeof s.filters[k] === "string" && (s.filters[k] as string).length > 0 ? (s.filters[k] as string) : undefined);
  const byType = (t: string) => s.selectedObjects.find((o) => o.objectType === t)?.objectId;
  const focus: NonNullable<PageContext["focus"]> = {};
  const metric = scalar("metric") ?? byType("Metric");
  const base = scalar("base") ?? byType("Base");
  const factorId = scalar("factorId") ?? byType("RootCause") ?? byType("GapAttribution") ?? byType("Factor");
  if (metric) focus.metric = metric;
  if (base) focus.base = base;
  if (factorId) focus.factorId = factorId;
  const pc: PageContext = { view: s.view, entities, selection, drillPath: [], actions: [] };
  if (Object.keys(focus).length > 0) pc.focus = focus;
  return pc;
}

describe("WO-CEO-6-FE SEAM · buildContext 产出的形状真开 hasPageContext 门（闭 G-3）", () => {
  it("C2 门真开·纯函数：派生形状喂真 resolveCeoRoute → usedPageContext 真 + args 从 focus/selection 派生", () => {
    const pc = derivePageContextMirror({
      view: "gap-waterfall",
      selectedObjects: [
        { objectType: "Metric", objectId: "seg_attain_ess", label: "储能达成率" },
        { objectType: "RootCause", objectId: "cf-cathode-shortage", label: "正极粉短缺" },
      ],
      filters: {},
    });
    expect(isCeoQuestion("储能为什么没达标")).toBe(true);
    const route = resolveCeoRoute("储能为什么没达标", pc, "ceo");
    expect(route.usedPageContext).toBe(true); // 门真开（focus 派生自页面·非空）
    expect(route.route).toBe("gap_attribution"); // 命中根因深问
    expect(route.args.metricKey).toBe("seg_attain_ess"); // args 来自 focus.metric
    expect(route.args.factorId).toBe("cf-cathode-shortage"); // 来自 focus.factorId/selection
  });

  it("② 空 pageContext（无选中·无焦点）→ usedPageContext 假（门确实拦·不冒进 CEO 语义）", () => {
    const empty = derivePageContextMirror({ view: "dashboard", selectedObjects: [], filters: {} });
    expect(empty.focus).toBeUndefined();
    expect(empty.selection).toEqual([]);
    const route = resolveCeoRoute("为什么没达标", empty, "ceo");
    expect(route.usedPageContext).toBe(false); // 无页面焦点 → 未真用上下文
    expect(route.args).toEqual({}); // 无派生 args
  });

  it("C2 端到端：派生形状经**真 orchestrator** → 命中 CEO 意图 → 路由求解器（deterministic:ceo-route·非 classifier 兜底）", async () => {
    const pc = derivePageContextMirror({
      view: "gap-waterfall",
      selectedObjects: [{ objectType: "Metric", objectId: "seg_attain_ess", label: "储能达成率" }, { objectType: "RootCause", objectId: "cf-cathode-shortage", label: "正极粉短缺" }],
      filters: {},
    });
    const t = await createTestApp();
    const { taskId, statusCode } = await submitQuery(t, ADMIN, "储能为什么没达标", { view: "gap-waterfall", pageContext: pc });
    expect(statusCode).toBe(202);
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.classification?.model).toBe("deterministic:ceo-route"); // 门开 → CEO 确定性路由（非 LLM/兜底）
    expect(task.matchedIntent?.intentKey).toBe("ceo_root_cause");
    expect(task.slots?.metricKey).toBe("seg_attain_ess"); // args 真达 path A 求解器
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    await t.app.close();
  });

  it("C3 seam red-bite：改选中根因（派生形状变）→ 真 orchestrator 落到求解器的 factorId 随之变", async () => {
    const t = await createTestApp();
    const pc1 = derivePageContextMirror({ view: "gap-waterfall", selectedObjects: [{ objectType: "Metric", objectId: "seg_attain_ess" }, { objectType: "RootCause", objectId: "cf-cathode-shortage" }], filters: {} });
    const pc2 = derivePageContextMirror({ view: "gap-waterfall", selectedObjects: [{ objectType: "Metric", objectId: "seg_attain_ess" }, { objectType: "RootCause", objectId: "cf-upstream-cut" }], filters: {} });
    const r1 = await submitQuery(t, ADMIN, "这个根因怎么补", { view: "gap-waterfall", pageContext: pc1 });
    const r2 = await submitQuery(t, ADMIN, "这个根因怎么补", { view: "gap-waterfall", pageContext: pc2 });
    const task1 = await waitForTask(t, r1.taskId);
    const task2 = await waitForTask(t, r2.taskId);
    expect(task1.matchedIntent?.intentKey).toBe("ceo_decision");
    expect(task1.slots?.factorId).toBe("cf-cathode-shortage");
    expect(task2.slots?.factorId).toBe("cf-upstream-cut");
    expect(task1.slots?.factorId).not.toBe(task2.slots?.factorId); // 页面选中真驱动求解器 args（非无视）
    await t.app.close();
  });

  it("② 门确实拦（G-3 真闭·不劫持）：完全不注入 pageContext → 同问句不走 CEO 路由（走 classifier）", async () => {
    const t = await createTestApp();
    t.llm.queueClassification({ candidates: [{ intentKey: "risk_root_cause", confidence: 0.9 }], outOfCatalog: false, extractedSlots: {} });
    const { taskId } = await submitQuery(t, ADMIN, "储能为什么没达标", { view: "risk" }); // 无 pageContext
    const task = await waitForTask(t, taskId);
    expect(task.classification?.model).not.toBe("deterministic:ceo-route"); // 门拦：ceo_* 不进候选·不触发 CEO 路由
    expect(task.matchedIntent?.intentKey).not.toBe("ceo_root_cause");
    await t.app.close();
  });
});
