import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, lastToolCallId, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { DataCoreUnavailableError } from "../src/tools/clients.js";

/**
 * WO-LOOP-CONTROL-P2 · Retry Manager SEAM（PRD §3.2·机制 #4·经**真** `submitQuery→runPathB→runAgentLoop`·非各半 unit）。
 *
 * 头号判据 = 接缝驱动通：executor 回执 `retryable` 分类（瞬时/传输 vs 确定性）× loop 侧 RetryPolicy 有界重试 × metric 归因，
 * 端到端断言。
 *  ① 瞬时/传输错（DataCore 不可达·retryable=true）：前 1 次 ERROR 后成功 → **真重试且不计停滞**、最终 COMPLETED、`qos_agent_retry_total=1`。
 *  ② 确定性错（未知切片·TOOL_ERROR·retryable=false）×3 → **不重试**、S01 停滞早停 `degraded{BUDGET_EXHAUSTED}`（`qos_agent_retry_total=0`）。
 *
 * opt-in：`QOS_AGENT_RETRY_MAX_ATTEMPTS` env 注入（缺省不设=0 次重试=现行为字节兼容）。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

function stepSeqOf(events: { seq: number; event: string; payload: unknown }[], type: string): number {
  return events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === type)?.seq ?? -1;
}

describe("WO-LOOP-CONTROL-P2 · Retry Manager（SEAM·经真 submitQuery→runPathB→runAgentLoop）", () => {
  it("① 瞬时错（DataCore 不可达）前 1 次 ERROR 后成功 → 真重试且不计停滞·COMPLETED·retry_total=1", async () => {
    const t: TestApp = await createTestApp({ env: { QOS_AGENT_RETRY_MAX_ATTEMPTS: "1" } });
    // resolve_slice：首调抛 DataCoreUnavailableError（传输层·retryable=true）→ 有界重试 → 次调成功。
    let calls = 0;
    t.dataCore.ontology.resolveSlice = async () => {
      calls += 1;
      if (calls === 1) throw new DataCoreUnavailableError();
      return { data: { base: "常州", summary: "常州基地画像", factors: [{ name: "利用率", value: 0.9 }] }, snapshotVersion: "snap" };
    };
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn({ content: [toolUse("resolve_slice", { sliceKey: "base_risk_profile", args: { baseId: "changzhou" } })] });
    t.llm.queueAgentTurn((req) => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "常州基地画像已取回 ⟦ref:0⟧。" }],
          provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.summary" }],
        }),
      ],
    }));

    const { taskId } = await submitQuery(t, PLANNER, "取常州基地风险画像并给结论", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.path).toBe("AGENT");
    expect(task.status).toBe("COMPLETED"); // 重试成功 → 正常 final_answer 收尾（非降级）

    expect(calls).toBe(2); // 首次瞬时错 + 1 次重试成功 = 真重试发生
    expect(t.metrics.agentRetry.get()).toBe(1); // 重试归因专属 metric
    // 不计停滞：重试成功即 roundHadSuccess → 无 STALL/降级事件、无 budget 降级。
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(stepSeqOf(events, "agent_degraded")).toBe(-1);
    expect(t.metrics.agentBudgetExhausted.get()).toBe(0);
    expect(t.metrics.agentLoopRepeat.get()).toBe(0);
    // 收尾轮次少（2 轮：1 取数 + 1 收尾）——重试在 runToolBlock 内消化·不多占 agent 轮。
    expect(t.llm.agentRequests.length).toBe(2);
  });

  it("② 确定性错（未知切片·TOOL_ERROR）×多轮 → 不重试·S01 停滞早停 degraded{BUDGET_EXHAUSTED}·retry_total=0", async () => {
    const t: TestApp = await createTestApp({ env: { QOS_AGENT_RETRY_MAX_ATTEMPTS: "1" } });
    // resolve_slice("__nope__") → mock 抛 "unknown slice"（确定性·TOOL_ERROR·retryable=false）→ 绝不重试。
    t.llm.queueClassification(OUT_OF_CATALOG);
    for (let i = 0; i < 24; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("resolve_slice", { sliceKey: "__nope__", args: {} })] });
    }

    const { taskId } = await submitQuery(t, PLANNER, "反复取一个不存在的切片", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.path).toBe("AGENT");
    expect(task.status).toBe("COMPLETED"); // 有界降级返回（非 hang）

    expect(t.metrics.agentRetry.get()).toBe(0); // 确定性错不重试
    // S01 停滞早停：连续失败 ≥3 且近 ≥2 轮零成功 → 早停·不烧满 maxIterations=24。
    expect(t.llm.agentRequests.length).toBeLessThan(24);
    const events = await t.repos.events.listAfter(taskId, 0);
    const degradeRow = events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded");
    expect((degradeRow?.payload as { outcome?: string })?.outcome).toBe("BUDGET_EXHAUSTED");
    expect(t.metrics.agentBudgetExhausted.get()).toBe(1);
  });

  it("③ R6：瞬时错重试路径两跑字节级一致（retry_total / 轮数 / COMPLETED 全同）", async () => {
    const runOnce = async () => {
      const t: TestApp = await createTestApp({ env: { QOS_AGENT_RETRY_MAX_ATTEMPTS: "1" } });
      let calls = 0;
      t.dataCore.ontology.resolveSlice = async () => {
        calls += 1;
        if (calls === 1) throw new DataCoreUnavailableError();
        return { data: { base: "常州", summary: "常州基地画像", factors: [] }, snapshotVersion: "snap" };
      };
      t.llm.queueClassification(OUT_OF_CATALOG);
      t.llm.queueAgentTurn({ content: [toolUse("resolve_slice", { sliceKey: "base_risk_profile", args: { baseId: "changzhou" } })] });
      t.llm.queueAgentTurn((req) => ({
        content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "已取回 ⟦ref:0⟧。" }], provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.summary" }] })],
      }));
      const { taskId } = await submitQuery(t, PLANNER, "取常州基地风险画像并给结论", { view: "dash" });
      const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
      return { retry: t.metrics.agentRetry.get(), rounds: t.llm.agentRequests.length, status: task.status };
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a).toEqual({ retry: 1, rounds: 2, status: "COMPLETED" });
    expect(b).toEqual(a);
  });
});
