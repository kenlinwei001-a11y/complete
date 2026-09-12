import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, lastToolCallId, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";

/**
 * WO-LOOP-CONTROL-P2 · per-tool 调用上界 SEAM（PRD §3.3·机制 #3·经**真** `submitQuery→runPathB→runAgentLoop`）。
 *
 * 补 P1 loop-hash「同参重复」的洞：同一工具**异参狂调**（每轮 filter 递增·逃过 hash 签名）——P1 hash 永不触顶，
 * 唯 per-tool cap 认得住。接缝：BudgetTracker.tryConsumeTool 计数 × loop 计数点 × 现有 `budget.exhausted` 守卫降级。
 *  ① 异参狂调 → cap 轮触顶 `degraded{BUDGET_EXHAUSTED}`·不烧满 maxIterations=24。
 *  ② 对照：调用数 < cap → 正常 final_answer 收尾·不早停。
 *
 * opt-in：`QOS_AGENT_PER_TOOL_CALL_CAP` env 注入（缺省不设=不限=现行为字节兼容）。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };
const CAP = 3;

function stepSeqOf(events: { seq: number; event: string; payload: unknown }[], type: string): number {
  return events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === type)?.seq ?? -1;
}

describe("WO-LOOP-CONTROL-P2 · per-tool 调用上界（SEAM·经真 submitQuery→runPathB→runAgentLoop）", () => {
  it("① 同工具异参狂调（逃过 P1 hash）→ cap 轮触顶 degraded{BUDGET_EXHAUSTED}·不烧满 24", async () => {
    const t: TestApp = await createTestApp({ env: { QOS_AGENT_PER_TOOL_CALL_CAP: String(CAP) } });
    t.llm.queueClassification(OUT_OF_CATALOG);
    // 24 轮 query_objects·每轮 filter.round 递增（异参·各签名独立·P1 hash 永不触顶）·每轮均"成功"（S01 亦不触发）。
    // 唯 per-tool cap 认「同工具刷屏」→ 累计达 cap 后置 exhausted → 下一轮守卫降级。
    for (let i = 0; i < 24; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: { round: i } })] });
    }

    const { taskId } = await submitQuery(t, PLANNER, "逐轮换条件狂刷同一查询", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.path).toBe("AGENT");
    expect(task.status).toBe("COMPLETED"); // 有界降级返回（非 hang·非烧满）

    // 触顶降级·不烧满 24（cap+1 轮内：cap 轮真调 + 1 轮守卫降级前不再 agent()）。
    expect(t.llm.agentRequests.length).toBeLessThanOrEqual(CAP + 1);
    expect(t.llm.agentRequests.length).toBeLessThan(24);

    const events = await t.repos.events.listAfter(taskId, 0);
    const degradeRow = events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded");
    expect((degradeRow?.payload as { outcome?: string })?.outcome).toBe("BUDGET_EXHAUSTED");
    expect(t.metrics.agentBudgetExhausted.get()).toBe(1);
    // 与 P1 hash 互补：异参不触发环检测（专属 metric=0）——证 cap 认的是「异参刷屏」非「同参重复」。
    expect(t.metrics.agentLoopRepeat.get()).toBe(0);
  });

  it("② 对照：调用数 < cap → 正常 final_answer 收尾·不早停（不误伤）", async () => {
    const t: TestApp = await createTestApp({ env: { QOS_AGENT_PER_TOOL_CALL_CAP: String(CAP) } });
    t.llm.queueClassification(OUT_OF_CATALOG);
    // 2 轮 query_objects（< cap=3）异参 → 不触顶；末轮 final_answer 正常收尾。
    for (let i = 0; i < 2; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: { round: i } })] });
    }
    t.llm.queueAgentTurn((req) => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "对照：未达上界正常收尾 ⟦ref:0⟧。" }], provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.total" }] })],
    }));

    const { taskId } = await submitQuery(t, PLANNER, "查两轮订单再收尾", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.status).toBe("COMPLETED");
    expect(t.llm.agentRequests.length).toBe(3); // 2 查询 + 1 final_answer（未早停）
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(stepSeqOf(events, "agent_degraded")).toBe(-1);
    expect(t.metrics.agentBudgetExhausted.get()).toBe(0);
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("对照");
  });
});
