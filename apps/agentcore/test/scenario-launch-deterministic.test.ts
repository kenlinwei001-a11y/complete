import { describe, expect, it } from "vitest";
import type { GapReport, GrowthTicket } from "@platform/contracts";
import { createTestApp, ADMIN, PLANNER, TENANT, debugHeaders, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import type { RoleNotification } from "../src/growth/notify.js";

/**
 * ONTO-SCEN-LAUNCH-DET（PRD-scenario-ontogenesis §2.4/§2.5 · 验收 #3/#4）齿：
 *  ① GOVERNED 卡 launch **全程零 classifier**——LLM classify 被物理拔掉（调用即计数+抛错）仍确定性走
 *     Path A 出真答案；revert §2.4 绑定即红（classify 被调/任务失败）。
 *  ② 人为删求解器 → 点卡 → 卡降 PROVISIONAL + GapReport(SOLVER_NOT_FOUND) + GrowthTicket + 通知 +
 *     scenario.gap_detected（outbox）+ 答案为诚实 gap 块（附 scenario.ticketId，前端发育卡）；重复点卡工单幂等不刷屏。
 *  ③ GOVERNED 卡意图不可绑定（被删/退发布）→ 不回落 LLM classify/探索，诚实缺口终结（NO_INTENT）。
 *  ④ 路径 B 探索空产出 → 结构化 gap 块（非任何无信息死答文本）——全站零「未能产出回答」的运行时面。
 */

type GapBlock = { type: "gap"; report: GapReport; scenario?: { scenarioKey: string; maturity: string; ticketId: string | null } };

/** 物理拔掉 classifier：任何 classify 调用计数并抛错（等价无 LLM key 环境的解绑态）。 */
function unplugClassifier(t: TestApp): { calls: () => number } {
  let n = 0;
  (t.llm as unknown as { classify: () => Promise<never> }).classify = async () => {
    n += 1;
    throw new Error("classifier unplugged (no LLM)");
  };
  return { calls: () => n };
}

async function growToGoverned(t: TestApp, key: string): Promise<void> {
  const res = await t.app.inject({ method: "POST", url: `/b/v1/scenarios/${key}/grow`, headers: debugHeaders(ADMIN) });
  expect(res.statusCode).toBe(200);
  expect((res.json() as { maturity: string }).maturity).toBe("GOVERNED");
}

describe("ONTO-SCEN-LAUNCH-DET · GOVERNED 卡确定性启动 + 缺口诚实处置", () => {
  it("验收#3 齿：classifier 物理拔掉 → 点 GOVERNED 卡仍确定性 Path A 出真答案（零 classify 调用）", async () => {
    const t = await createTestApp();
    await growToGoverned(t, "S01");
    const spy = unplugClassifier(t); // grow 之后拔——launch 全程不得再碰 classifier

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/launch", headers: debugHeaders(PLANNER) });
    expect(res.statusCode).toBe(202);
    const { taskId } = res.json() as { taskId: string };
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("WORKFLOW");
    expect(task.classification?.model).toBe("deterministic:scenario-bind");
    // 真答案（非缺口/非兜底）：含承载数据块
    expect((task.answer?.blocks ?? []).some((b) => b.type === "kpi" || b.type === "table")).toBe(true);
    expect(spy.calls()).toBe(0); // 齿心：launch 全程零 classifier 依赖（revert §2.4 即红）
  });

  it("验收#4 齿：人为删求解器 → 卡降 PROVISIONAL + GapReport + GrowthTicket + 通知 + 诚实发育 gap 块；重复点卡工单幂等", async () => {
    const t = await createTestApp();
    await growToGoverned(t, "S01");
    const spy = unplugClassifier(t);
    // 人为删求解器（等价 datacore 侧 SOLVER_NOT_FOUND）：solver.invoke 一律 404。
    (t.dataCore.solver as unknown as { invoke: () => Promise<never> }).invoke = async () => {
      const e = new Error("SOLVER_NOT_FOUND: solver capacity_feasibility 已被删除") as Error & { code: string; statusCode: number };
      e.code = "SOLVER_NOT_FOUND";
      e.statusCode = 404;
      throw e;
    };
    const notifications: { tenantId: string; n: RoleNotification }[] = [];
    t.deps.notifyRole = async (tenantId, n) => {
      notifications.push({ tenantId, n });
    };

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/launch", headers: debugHeaders(PLANNER) });
    const { taskId } = res.json() as { taskId: string };
    const task = await waitForTask(t, taskId, (x) => x.status === "FAILED");

    // ① 答案 = 诚实 gap 块（非裸错、非死答文本），附场景发育态 + 工单深链数据
    const gap = task.answer?.blocks.find((b) => b.type === "gap") as GapBlock | undefined;
    expect(gap).toBeDefined();
    expect(gap!.report.findings[0]?.gapCode).toBe("SOLVER_NOT_FOUND");
    expect(gap!.scenario?.scenarioKey).toBe("S01");
    expect(gap!.scenario?.maturity).toBe("PROVISIONAL");
    const ticketId = gap!.scenario?.ticketId;
    expect(ticketId).toBeTruthy();
    expect(JSON.stringify(task.answer)).not.toContain("未能产出回答"); // 零死答（运行时面）

    // ② 卡降 PROVISIONAL + 留痕 ScenarioOntogenesisRun（launch 起源，taskId 溯源，gaps 关联工单）
    const sc = await t.repos.scenarios.byKey(task.tenantId, "S01");
    expect(sc?.maturity).toBe("PROVISIONAL");
    expect(sc?.lastOntogenesisRun?.verification.taskId).toBe(taskId);
    expect(sc?.lastOntogenesisRun?.gaps?.[0]?.ticketId).toBe(ticketId);
    const runs = await t.repos.ontogenesisRuns.listByScenario(task.tenantId, "S01");
    expect(runs.some((r) => r.verification.taskId === taskId && r.maturity === "PROVISIONAL")).toBe(true);

    // ③ GrowthTicket 开出（OPEN·SOLVER_NOT_FOUND）
    const tickets = (await t.repos.growthTickets.listByTenant(task.tenantId)).filter(
      (tk: GrowthTicket) => tk.status === "OPEN" && tk.gapCode === "SOLVER_NOT_FOUND",
    );
    expect(tickets.length).toBe(1);
    expect(tickets[0]!.id).toBe(ticketId);

    // ④ 通知 + 收件箱（角色扇出 admin，refId 深链工单）
    expect(notifications.length).toBe(1);
    expect(notifications[0]!.n.role).toBe("admin");
    expect(notifications[0]!.n.refType).toBe("growth_ticket");
    expect(notifications[0]!.n.refId).toBe(ticketId);

    // ⑤ 事件双通道之 outbox：scenario.gap_detected + growth.ticket_opened 可被下游轮询
    const events = await t.repos.domainEvents.listSince(task.tenantId);
    expect(events.some((e) => e.event === "scenario.gap_detected")).toBe(true);
    expect(events.some((e) => e.event === "growth.ticket_opened")).toBe(true);

    // ⑥ 重复点卡 → 工单幂等复用（同卡同码 OPEN 不再新开）
    const res2 = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/launch", headers: debugHeaders(PLANNER) });
    const task2 = await waitForTask(t, (res2.json() as { taskId: string }).taskId, (x) => x.status === "FAILED");
    const gap2 = task2.answer?.blocks.find((b) => b.type === "gap") as GapBlock | undefined;
    expect(gap2?.scenario?.ticketId).toBe(ticketId);
    const ticketsAfter = (await t.repos.growthTickets.listByTenant(task.tenantId)).filter(
      (tk: GrowthTicket) => tk.status === "OPEN" && tk.gapCode === "SOLVER_NOT_FOUND",
    );
    expect(ticketsAfter.length).toBe(1);
    expect(notifications.length).toBe(1); // 通知只随新开票发一次——重复点卡不轰炸收件箱

    expect(spy.calls()).toBe(0); // 缺口处置链同样零 classifier
  });

  it("§2.4 守底：GOVERNED 卡意图不可绑定（被删/退发布）→ 不回落 classify/探索，诚实缺口终结 NO_INTENT", async () => {
    const t = await createTestApp();
    await growToGoverned(t, "S01");
    const spy = unplugClassifier(t);
    // 模拟意图被删：卡指向幽灵意图（GOVERNED 相位保持——正是"闭包坏了但门牌还挂着"的病态）。
    const sc = (await t.repos.scenarios.byKey(TENANT, "S01"))!;
    await t.repos.scenarios.upsert({ ...sc, intentKey: "ghost_intent" });

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/launch", headers: debugHeaders(PLANNER) });
    const { taskId } = res.json() as { taskId: string };
    const task = await waitForTask(t, taskId, (x) => x.status === "FAILED");
    expect(task.error?.code).toBe("INTENT_NOT_AVAILABLE");
    const gap = task.answer?.blocks.find((b) => b.type === "gap") as GapBlock | undefined;
    expect(gap?.report.findings[0]?.gapCode).toBe("NO_INTENT");
    expect(gap?.scenario?.maturity).toBe("PROVISIONAL"); // 卡同样诚实降级
    expect(spy.calls()).toBe(0); // 绑定失败也绝不回落 LLM classify（revert 守底逻辑即红）
  });

  it("§2.5 全站零死答（路径 B 面）：探索空产出 → 结构化 gap 块（OTHER），非无信息文本", async () => {
    const t = await createTestApp();
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    // 模型直接结束：无文本、无推理、无工具 → 旧实现落「（探索模式未能产出回答）」死答，现应出 gap 块。
    t.llm.queueAgentTurn({ content: [], stopReason: "end_turn" });
    const { taskId } = await submitQuery(t, PLANNER, "一个探索不出结果的问题", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");
    const gap = task.answer?.blocks.find((b) => b.type === "gap") as GapBlock | undefined;
    expect(gap).toBeDefined();
    expect(gap!.report.question).toBe("一个探索不出结果的问题"); // question=原问句（触发补齐/续推可重跑）
    expect(gap!.report.findings[0]?.blocking).toBe(true);
    expect(JSON.stringify(task.answer)).not.toContain("未能产出回答");
  });

  it("内部验证任务（grow/probe internal）不触发 launch 缺口处置（不重复开票/通知）", async () => {
    const t = await createTestApp();
    const notifications: RoleNotification[] = [];
    t.deps.notifyRole = async (_tid, n) => {
      notifications.push(n);
    };
    // 删求解器后 grow（内部验证会失败）→ 通知零（grow 自有开票/留痕路径，hook 只服务真人点卡）。
    (t.dataCore.solver as unknown as { invoke: () => Promise<never> }).invoke = async () => {
      throw Object.assign(new Error("SOLVER_NOT_FOUND: gone"), { code: "SOLVER_NOT_FOUND", statusCode: 404 });
    };
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { maturity: string }).maturity).not.toBe("GOVERNED");
    expect(notifications.length).toBe(0);
  });
});
