import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN } from "./helpers.js";

/**
 * WO-CEO-6 · CEO 深问端到端真跑（闭 G-3 深问侧·绿测试≠能用→此为「能用」证据）。
 * 走真 orchestrator.runPipeline：NL 深问 + PageContext →（确定性 CEO 路由·从 focus 派生 args）→
 * 绑定 CEO 意图 → path A invoke_solver(gap_attribution/decision_play/metric_rollup) → render_answer。
 * 不蒙 LLM（deterministic:ceo-route·无需 scripted classification）；mock datacore 回显 solver args → 证 PageContext 真达求解器。
 *
 * C2 真注入：答案受 PageContext 影响（args=focus 派生·非写死）｜C3 同问句不同 PageContext→不同 args/答案
 * ｜C9 G-3 真闭：无 PageContext 时零 CEO 行为（纯 additive·不劫持）｜C10 端到端一次真输出（选根因→怎么补→decision_play）。
 */

const pcEss: PageContext = {
  view: "gap-waterfall",
  focus: { metric: "seg_attain_ess", gap: 27.8, factorId: "cf-cathode-shortage" },
  entities: [{ type: "Metric", id: "seg_attain_ess", label: "储能达成率", value: 72.2, drillRef: "obj_metric_kpi-seg-ess" }],
  selection: ["cf-cathode-shortage"],
  drillPath: ["seg_attain_ess", "base:changzhou", "cf-cathode-shortage"],
  actions: ["decision_play"],
};

describe("WO-CEO-6 · CEO 深问端到端（闭 G-3·真 QOS 跑）", () => {
  it("C10 端到端：差距瀑布页问『为什么没达标』+PageContext → 路由 gap_attribution → 答案+溯源（一次真输出）", async () => {
    const t = await createTestApp();
    const { taskId, statusCode } = await submitQuery(t, ADMIN, "储能为什么没达标", { view: "gap-waterfall", pageContext: pcEss });
    expect(statusCode).toBe(202);
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    // 确定性 CEO 路由（非蒙 LLM）
    expect(task.classification?.model).toBe("deterministic:ceo-route");
    expect(task.classification?.candidates?.[0]?.intentKey).toBe("ceo_root_cause");
    expect(task.matchedIntent?.intentKey).toBe("ceo_root_cause");
    // args 从 PageContext.focus 派生真达 path A（证 presetContext 真注入·非写死）
    expect(task.slots?.metricKey).toBe("seg_attain_ess");
    // 答案组装出（invoke_solver→render_answer solver_summary 投影·带溯源块）
    expect(task.answer).toBeDefined();
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    await t.app.close();
  });

  it("C10 端到端：页面选中根因问『这个根因怎么补』 → 路由 decision_play → 方案答案（metricKey+factorId 双注入）", async () => {
    const t = await createTestApp();
    const { taskId } = await submitQuery(t, ADMIN, "这个根因怎么补", { view: "gap-waterfall", pageContext: pcEss });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.classification?.model).toBe("deterministic:ceo-route");
    expect(task.matchedIntent?.intentKey).toBe("ceo_decision");
    expect(task.slots?.metricKey).toBe("seg_attain_ess");
    expect(task.slots?.factorId).toBe("cf-cathode-shortage"); // 从 selection/focus.factorId 注入
    expect(task.answer?.blocks?.length ?? 0).toBeGreaterThan(0);
    await t.app.close();
  });

  it("C3 上下文真生效：同问句·不同 PageContext（选中根因不同）→ 不同 factorId 达求解器（页面焦点真驱动·非无视）", async () => {
    const t = await createTestApp();
    const r1 = await submitQuery(t, ADMIN, "这个怎么补", { view: "gap-waterfall", pageContext: pcEss });
    const task1 = await waitForTask(t, r1.taskId);
    const pcEquip: PageContext = { ...pcEss, focus: { metric: "seg_attain_ess", factorId: "cf-upstream-cut" }, selection: ["cf-upstream-cut"] };
    const r2 = await submitQuery(t, ADMIN, "这个怎么补", { view: "gap-waterfall", pageContext: pcEquip });
    const task2 = await waitForTask(t, r2.taskId);
    expect(task1.slots?.factorId).toBe("cf-cathode-shortage");
    expect(task2.slots?.factorId).toBe("cf-upstream-cut");
    expect(task1.slots?.factorId).not.toBe(task2.slots?.factorId); // 同问句·PageContext 变→args 变→答案变（有牙）
    await t.app.close();
  });

  it("C9 G-3 真闭·不劫持：同问句无 PageContext → 非 CEO 确定性路由（走 classifier·平台行为与 CEO-6 前一致）", async () => {
    const t = await createTestApp();
    // 无 pageContext：ceo_* 意图不进候选池·CEO 路由不触发 → 走正常 classifier（需 scripted 分类兜底，避免真 LLM）
    t.llm.queueClassification({ candidates: [{ intentKey: "risk_root_cause", confidence: 0.9 }], outOfCatalog: false, extractedSlots: {} });
    const { taskId } = await submitQuery(t, ADMIN, "储能为什么没达标", { view: "risk" });
    const task = await waitForTask(t, taskId);
    expect(task.classification?.model).not.toBe("deterministic:ceo-route"); // 无 PageContext = 零 CEO 行为（纯 additive）
    expect(task.matchedIntent?.intentKey).not.toBe("ceo_root_cause");
    await t.app.close();
  });

  it("C10 达标查询：『储能还差多少达成』+PageContext → 路由 metric_rollup（问句意图→对应求解器）", async () => {
    const t = await createTestApp();
    const { taskId } = await submitQuery(t, ADMIN, "储能还差多少达成", { view: "gap-waterfall", pageContext: pcEss });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.classification?.model).toBe("deterministic:ceo-route");
    expect(task.matchedIntent?.intentKey).toBe("ceo_metric");
    expect(task.slots?.metricKey).toBe("seg_attain_ess");
    await t.app.close();
  });
});
