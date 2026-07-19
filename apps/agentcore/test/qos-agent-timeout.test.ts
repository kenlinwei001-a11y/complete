import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { HANG, toolUse } from "../src/llm/mock.js";
import type { QueryEventRow } from "../src/persistence/repos.js";

/**
 * WO-TIER3-AGENT-TIMEOUT-FALLBACK · SEAM 组合测试。
 *
 * 经**真实 QOS 管线**（submitQuery → runPipeline → runPathB → runAgentLoop），用 mock LLM 造两种
 * 病态，断言「有界终止 + 诚实部分发现 + 降级事件（早于 answer.final）」：
 *  - Case A：无限工具调用空转（无定时器，纯确定性）→ 预算耗尽降级。
 *  - Case B：单次 LLM 调用挂死（小 deadline 驱动 AbortController）→ 超时降级（signal 穿到适配器）。
 *
 * 数据半（mock 造空转/挂死）× 引擎半（deadline/degrade/事件）任一半漏即红。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

/** 从事件流里取某事件的首个 seq；不存在返回 undefined。 */
function seqOf(events: QueryEventRow[], predicate: (e: QueryEventRow) => boolean): number | undefined {
  return events.find(predicate)?.seq;
}

function degradedStep(events: QueryEventRow[]): QueryEventRow | undefined {
  return events.find(
    (e) => e.event === "step.completed" && (e.payload as { type?: string } | null)?.type === "agent_degraded",
  );
}

function firstTextMarkdown(blocks: unknown[] | undefined): string {
  const joined = (blocks ?? [])
    .filter((b): b is { type: "text"; markdown: string } => (b as { type?: string })?.type === "text")
    .map((b) => b.markdown)
    .join("\n");
  return joined;
}

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("WO-TIER3 · path-B agent 有界超时 + 优雅降级（SEAM）", () => {
  it("Case A: 无限工具调用空转 → 有界终止 + BUDGET_EXHAUSTED + 降级事件早于 answer.final + 诚实部分发现", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    // 函数 turn 恒返回一个 READ 工具且**无 text**（模拟接不到求解器、永不 final_answer）。
    // 排满 maxIterations 轮，靠 iterations 预算下界收敛（无定时器，纯确定性）。
    const spin = () => ({ content: [toolUse("query_objects", { objectType: "Order", filter: {} })] });
    t.llm.queueAgentTurn(...Array.from({ length: 12 }, () => spin));

    const started = Date.now();
    const { taskId } = await submitQuery(t, PLANNER, "把整个体系里所有能查的都翻一遍再深推一层", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    // 有界终止（非 hang）
    expect(Date.now() - started).toBeLessThan(6000);
    expect(task.path).toBe("AGENT");

    // B3 语义不回归：预算耗尽 outcome/metric/trace
    expect(t.metrics.agentBudgetExhausted.get()).toBe(1);
    expect(t.metrics.agentTimeout.get()).toBe(0);
    const trace = await t.repos.fallbackTraces.getByTask(taskId);
    expect(trace?.outcome).toBe("BUDGET_EXHAUSTED");

    // 降级事件存在，且早于 answer.final
    const events = await t.repos.events.listAfter(taskId, 0);
    const degraded = degradedStep(events);
    expect(degraded).toBeDefined();
    expect((degraded?.payload as { outcome?: string }).outcome).toBe("BUDGET_EXHAUSTED");
    const answerSeq = seqOf(events, (e) => e.event === "answer.final");
    expect(answerSeq).toBeDefined();
    expect((degraded as QueryEventRow).seq).toBeLessThan(answerSeq as number);

    // 诚实部分发现：非空壳；含诚实措辞 + 复述已探索工具线索
    const md = firstTextMarkdown(task.answer?.blocks);
    expect(md).not.toContain("（探索模式未能产出回答）");
    expect(md).toContain("未能完全解答");
    expect(md).toContain("已达最大探索轮次");
    expect(md).toContain("已探索线索");
    expect(md).toContain("query_objects"); // 复述实际调用过的工具
    // 不编造 provenance
    expect(task.answer?.provenance.length).toBe(0);
  });

  it("Case B: 单次 LLM 调用挂死 + QOS_AGENT_LLM_TIMEOUT_MS:50 → <<8s 返回 COMPLETED + agentTimeout=1 + TIMEOUT 降级事件 + signal 穿到适配器", async () => {
    t = await createTestApp({ env: { QOS_AGENT_LLM_TIMEOUT_MS: "50" } });
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(HANG); // 首轮挂死：自身永不 resolve，只在 signal abort 时 reject

    const started = Date.now();
    const { taskId } = await submitQuery(t, PLANNER, "帮我把这个开放性问题深推到底", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const elapsed = Date.now() - started;

    // deadline 真触发（约 50ms 量级），非等 90s、非 hang
    expect(elapsed).toBeLessThan(4000);
    // 捕获而非裸抛：COMPLETED，非 FAILED / INTERNAL_ERROR
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("AGENT");
    expect(t.metrics.agentTimeout.get()).toBe(1);

    // 降级事件 TIMEOUT，早于 answer.final
    const events = await t.repos.events.listAfter(taskId, 0);
    const degraded = degradedStep(events);
    expect(degraded).toBeDefined();
    expect((degraded?.payload as { outcome?: string }).outcome).toBe("TIMEOUT");
    const answerSeq = seqOf(events, (e) => e.event === "answer.final");
    expect((degraded as QueryEventRow).seq).toBeLessThan(answerSeq as number);

    // 诚实部分发现：含「探索超时」措辞
    const md = firstTextMarkdown(task.answer?.blocks);
    expect(md).not.toContain("（探索模式未能产出回答）");
    expect(md).toContain("未能完全解答");
    expect(md).toContain("超时");

    // signal 已穿到适配器面（per-call deadline AbortController）
    expect(t.llm.agentRequests[0]?.signal).toBeDefined();
    expect(t.llm.agentRequests[0]?.signal?.aborted).toBe(true);
  });
});
