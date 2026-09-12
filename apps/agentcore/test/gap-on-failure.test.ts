import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

/**
 * CL.7 GF.2 · 路径 B agent 硬失败 → 答案流并入结构化缺口块（对话坞渲染可点缺口卡而非只剩红错）。
 * 闭 G-3 对话侧：失败任务带 gap-block answer，前端 GapCard 可▶触发自成长 LOOP 诊断+补→续推。
 */
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("CL.7 GF.2 · agent 失败并入缺口块", () => {
  it("路径 B agent 中断 → 任务 FAILED 但 answer 含 gap 块（缺口卡数据就绪）", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    // 注入 agent 推演异常 → runAgentLoop 抛 → orchestrator failFromError → failTask
    t.llm.queueAgentTurn(() => {
      throw new Error("注入：agent 推演中断");
    });
    const { taskId } = await submitQuery(t, PLANNER, "本月经营怎么样", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "FAILED", 15000);

    expect(task.path).toBe("AGENT");
    expect(task.answer).toBeTruthy();
    const gap = task.answer?.blocks.find((b) => b.type === "gap") as { type: string; report: { verdict: string; findings: { gapCode: string }[] } } | undefined;
    expect(gap).toBeTruthy();
    expect(gap!.report.verdict).toBe("BLOCKED");
    expect(gap!.report.findings[0]?.gapCode).toBe("OTHER");
  });
});
