import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN } from "./helpers.js";

/**
 * WO-DECISION-KERNEL-WIRE · CEO 决策类深问出方案后「成决策」接缝（闭"深问止步方案·不成决策"脑裂·绿测试≠能用）。
 *
 * 走真 orchestrator.runPipeline（deterministic:ceo-route·不蒙 LLM）：深问命中 RE_OPTION → 路由 decision_play →
 * path A invoke_solver(decision_play·出真推荐组合 recommendedPlan.optionIds) → **决策钩子**据采纳/落地意图经 L2 内核
 * 落一等 Decision。断言：
 *  - 采纳意图（成决策）→ create(PROPOSED)·chosenOptionIds=真推演推荐组合·发 decision.created·答案追加决策台账块·**不** commit；
 *  - 立即落地意图 → 再 commit(COMMITTED)·派 ActionDraft·发 decision.committed；
 *  - 无采纳/落地意图（纯"怎么补"）→ **不成决策**（纯 additive·不劫持既有路径 A）；
 *  - 上下文真达：Decision.metricKey/factorId 从 PageContext.focus 派生（同问句不同上下文→不同 Decision）。
 *
 * 真 HTTP·非 mock 的 POST /a/v1/decisions 由 datacore 侧 decision-wire-seam 证（本测试固化 agentcore 侧钩子逻辑·mock 内核）。
 */
const pcDecision: PageContext = {
  view: "gap-waterfall",
  focus: { metric: "seg_attain_ess", gap: 27.8, factorId: "cf-cathode-shortage" },
  entities: [{ type: "Metric", id: "seg_attain_ess", label: "储能达成率", value: 72.2, drillRef: "obj_metric_kpi-seg-ess" }],
  selection: ["cf-cathode-shortage"],
  drillPath: ["seg_attain_ess", "base:changzhou", "cf-cathode-shortage"],
  actions: ["decision_play"],
};

describe("WO-DECISION-KERNEL-WIRE · 深问出方案→成决策（L2 内核接缝）", () => {
  it("成决策：『怎么补…就采纳这个方案』→ create Decision(PROPOSED)·chosenOptionIds=真推荐组合·发 decision.created·答案落决策台账块", async () => {
    const t = await createTestApp();
    const { taskId } = await submitQuery(t, ADMIN, "这个根因怎么补？就采纳这个方案", { view: "gap-waterfall", pageContext: pcDecision });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.matchedIntent?.intentKey).toBe("ceo_decision"); // decision_play 路由

    // 成决策：内核 create 被调，入参取真推演推荐组合（非写死）+ 上下文派生 metricKey/factorId。
    const created = t.dataCore.decision.created;
    expect(created.length).toBe(1);
    expect(created[0]!.input.metricKey).toBe("seg_attain_ess");
    expect(created[0]!.input.factorId).toBe("cf-cathode-shortage");
    // chosenOptionIds = 真 decision_play recommendedPlan.optionIds（默认取真推演推荐组合·非用户额外选定）。
    expect(created[0]!.input.chosenOptionIds).toEqual(["opt-cf-cathode-shortage-a", "opt-cf-cathode-shortage-b"]);

    // 采纳（propose）→ 不 commit（待人定案）。
    expect(t.dataCore.decision.committed.length).toBe(0);

    // SSE：decision.created 发出（decision.committed 未发）。
    const events = await t.repos.events.listAfter(taskId, 0);
    const names = events.map((e) => e.event);
    expect(names).toContain("decision.created");
    expect(names).not.toContain("decision.committed");
    const createdEvt = events.find((e) => e.event === "decision.created")!;
    expect((createdEvt.payload as { status?: string }).status).toBe("PROPOSED");

    // 答案落地成决策：追加决策台账块（不再是止步方案的孤儿 chat）。
    const md = (task.answer?.blocks ?? []).map((b) => (b as { markdown?: string }).markdown ?? "").join("\n");
    expect(md).toContain("决策台账");
    expect(md).toContain(created[0]!.decision.id);
    expect(md).toContain("PROPOSED");
    await t.app.close();
  });

  it("立即落地：『怎么补…立即落地』→ create + commit(COMMITTED)·派 ActionDraft·发 decision.committed", async () => {
    const t = await createTestApp();
    const { taskId } = await submitQuery(t, ADMIN, "这个根因怎么补？立即落地", { view: "gap-waterfall", pageContext: pcDecision });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");

    expect(t.dataCore.decision.created.length).toBe(1);
    expect(t.dataCore.decision.committed.length).toBe(1); // 立即落地 → 再 commit

    const events = await t.repos.events.listAfter(taskId, 0);
    const committedEvt = events.find((e) => e.event === "decision.committed");
    expect(committedEvt).toBeTruthy();
    const payload = committedEvt!.payload as { status?: string; actionDraftIds?: string[] };
    expect(payload.status).toBe("COMMITTED");
    expect((payload.actionDraftIds ?? []).length).toBe(2); // 每选定方案派一 ActionDraft（S2 DRAFT）

    const md = (task.answer?.blocks ?? []).map((b) => (b as { markdown?: string }).markdown ?? "").join("\n");
    expect(md).toContain("已定案（COMMITTED");
    await t.app.close();
  });

  it("不劫持：纯『怎么补』无采纳/落地意图 → 出方案但**不成决策**（纯 additive）", async () => {
    const t = await createTestApp();
    const { taskId } = await submitQuery(t, ADMIN, "这个根因怎么补", { view: "gap-waterfall", pageContext: pcDecision });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.matchedIntent?.intentKey).toBe("ceo_decision"); // 仍路由 decision_play·出方案
    // 无采纳/落地意图 → 决策钩子不触发（深问止步方案是合法的·仅表意采纳才成决策）。
    expect(t.dataCore.decision.created.length).toBe(0);
    expect(t.dataCore.decision.committed.length).toBe(0);
    const names = (await t.repos.events.listAfter(taskId, 0)).map((e) => e.event);
    expect(names).not.toContain("decision.created");
    await t.app.close();
  });

  it("上下文真达（C2/C3 有牙）：同问句·不同 PageContext.focus → 不同 Decision.factorId（页面焦点真驱动成决策）", async () => {
    const t = await createTestApp();
    await waitForTask(t, (await submitQuery(t, ADMIN, "怎么补？就采纳这个方案", { view: "gap-waterfall", pageContext: pcDecision })).taskId);
    const pcEquip: PageContext = { ...pcDecision, focus: { metric: "seg_attain_ess", factorId: "cf-upstream-cut" }, selection: ["cf-upstream-cut"] };
    await waitForTask(t, (await submitQuery(t, ADMIN, "怎么补？就采纳这个方案", { view: "gap-waterfall", pageContext: pcEquip })).taskId);
    const created = t.dataCore.decision.created;
    expect(created.length).toBe(2);
    expect(created[0]!.input.factorId).toBe("cf-cathode-shortage");
    expect(created[1]!.input.factorId).toBe("cf-upstream-cut"); // PageContext 变 → 成决策的根因随之变（非写死）
    expect(created[0]!.input.factorId).not.toBe(created[1]!.input.factorId);
    await t.app.close();
  });
});
