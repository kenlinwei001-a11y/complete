import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";

/**
 * WO-LOOP-CONTROL-P1 · Loop Detector 环检测 SEAM（补 S01「成功但空转」最后一个洞）。
 *
 * 经**真 QOS 管线** `submitQuery → runPipeline → runPathB → runAgentLoop`（app.inject·mock LLM 驱动病态·非直调 loop unit）：
 *  ① 同签名：每轮吐**相同参数**的 query_objects（即便每次"成功"）→ ≤ LOOP_REPEAT_CAP+1 轮内 `degraded{reason:STALL_LOOP}`
 *     收尾，**不烧到 maxIterations**（对比：无此层会烧满 24 轮）。
 *  ② 不误伤：每轮**不同入参** → 各签名独立计数不累加 → 跑满正常轮次、不早停（对照组）。
 *  ③ R6：同输入两跑字节级一致（reason / 轮数 / 答案 markdown 全同）。
 *
 * opt-in：经 `QOS_AGENT_LOOP_REPEAT_CAP` env 注入（mirror QOS_AGENT_MAX_ROUND_TRIPS·缺省禁用=现行为字节兼容）。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };
const CAP = 3;

/** 取某伪 step 事件（event + payload.type 匹配）的 seq；不存在返回 -1。 */
function stepSeqOf(events: { seq: number; event: string; payload: unknown }[], type: string): number {
  return events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === type)?.seq ?? -1;
}
function seqOf(events: { seq: number; event: string }[], event: string): number {
  return events.find((e) => e.event === event)?.seq ?? -1;
}

describe("WO-LOOP-CONTROL-P1 · Loop Detector 环检测（SEAM·经真 submitQuery→runPathB→runAgentLoop）", () => {
  it("① 同签名反复 query_objects → ≤ cap+1 轮内 STALL_LOOP 收尾（不烧满 maxIterations=24）+ 诚实部分发现", async () => {
    const t: TestApp = await createTestApp({ env: { QOS_AGENT_LOOP_REPEAT_CAP: String(CAP) } });
    t.llm.queueClassification(OUT_OF_CATALOG);
    // 病态：24 轮**同签名** query_objects(Order,{filter:{status:"OPEN"}})（每轮均"成功"→ S01 恒复位永不触发）。
    // 若无环检测将烧满 24 轮；有环检测 → 第 3 轮（count≥cap）即 STALL_LOOP。
    for (let i = 0; i < 24; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: { status: "OPEN" } })] });
    }

    const { taskId } = await submitQuery(t, PLANNER, "把所有未结订单反复翻一遍给我个自由结论", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.path).toBe("AGENT");
    expect(task.status).toBe("COMPLETED"); // 有界返回（非 hang·非 500）

    // 核心：≤ cap+1 轮内收尾（**不烧满 24**）——agentRequests = 已消耗 agent 轮数。
    expect(t.llm.agentRequests.length).toBeLessThanOrEqual(CAP + 1);
    expect(t.llm.agentRequests.length).toBeLessThan(24);

    // 归因：STALL_LOOP 专属 metric=1；未误计 timeout；未走满预算 exhausted 计数（只计环检测 counter）。
    expect(t.metrics.agentLoopRepeat.get()).toBe(1);
    expect(t.metrics.agentTimeout.get()).toBe(0);
    expect(t.metrics.agentBudgetExhausted.get()).toBe(0);

    // 降级伪 step outcome=STALL_LOOP 且早于 answer.final（前端零改·复用 agent_degraded）。
    const events = await t.repos.events.listAfter(taskId, 0);
    const degradeSeq = stepSeqOf(events, "agent_degraded");
    const finalSeq = seqOf(events, "answer.final");
    expect(degradeSeq).toBeGreaterThan(0);
    expect(finalSeq).toBeGreaterThan(0);
    expect(degradeSeq).toBeLessThan(finalSeq);
    const degradeRow = events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded");
    expect((degradeRow?.payload as { outcome?: string })?.outcome).toBe("STALL_LOOP");

    // fallbackTrace / run 仍归 BUDGET_EXHAUSTED 家族（outcome 口径不变）。
    const trace = await t.repos.fallbackTraces.getByTask(taskId);
    expect(trace?.outcome).toBe("BUDGET_EXHAUSTED");
    const run = await t.repos.agentRuns.getByTask(taskId);
    expect(run?.budgetExhausted).toBe(true);

    // 诚实措辞（R13）：标"无进度循环"+ 复述已探索工具（非空壳/非假答）。
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("无进度循环");
    expect(md).toContain("query_objects");
    expect(md).not.toContain("（探索模式未能产出回答）");
  });

  it("② 每轮不同入参 → 各签名独立计数不累加 → 跑过 cap+1 轮不早停（不误伤·对照组）", async () => {
    const t: TestApp = await createTestApp({ env: { QOS_AGENT_LOOP_REPEAT_CAP: String(CAP) } });
    t.llm.queueClassification(OUT_OF_CATALOG);
    // 6 轮**各不同入参**（filter.round 递增 → 6 个不同签名·各计 1）→ 环检测永不触顶；末轮 final_answer 正常收尾。
    for (let i = 0; i < 6; i++) {
      t.llm.queueAgentTurn({ content: [text(`第 ${i + 1} 轮`), toolUse("query_objects", { objectType: "Order", filter: { round: i } })] });
    }
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "对照组：异参多轮后正常收尾。" }], provenance: [] })],
    });

    const { taskId } = await submitQuery(t, PLANNER, "逐轮换条件查订单再收尾", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.path).toBe("AGENT");
    expect(task.status).toBe("COMPLETED");

    // 跑过 cap+1（=4）轮才收尾 → 证明异参不被误判为环。
    expect(t.llm.agentRequests.length).toBeGreaterThan(CAP + 1);
    expect(t.llm.agentRequests.length).toBe(7); // 6 查询轮 + 1 final_answer

    // 无环检测触发：专属 metric=0，无 STALL_LOOP 降级事件（正常 final_answer 收尾）。
    expect(t.metrics.agentLoopRepeat.get()).toBe(0);
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(stepSeqOf(events, "agent_degraded")).toBe(-1);
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("对照组");
  });

  it("③ R6：同签名病态输入两跑字节级一致（reason / 轮数 / 答案 markdown 全同）", async () => {
    const runOnce = async () => {
      const t: TestApp = await createTestApp({ env: { QOS_AGENT_LOOP_REPEAT_CAP: String(CAP) } });
      t.llm.queueClassification(OUT_OF_CATALOG);
      for (let i = 0; i < 24; i++) {
        t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: { status: "OPEN" } })] });
      }
      const { taskId } = await submitQuery(t, PLANNER, "把所有未结订单反复翻一遍给我个自由结论", { view: "dash" });
      const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
      const events = await t.repos.events.listAfter(taskId, 0);
      const degradeRow = events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded");
      const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
      return { rounds: t.llm.agentRequests.length, reason: (degradeRow?.payload as { outcome?: string })?.outcome, md };
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a.reason).toBe("STALL_LOOP");
    expect(b).toEqual(a); // 轮数 + reason + 答案 markdown 全一致（R6）
  });
});
