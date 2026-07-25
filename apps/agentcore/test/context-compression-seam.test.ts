import { describe, expect, it, vi } from "vitest";
import { runAgentLoop, type AgentToolSpec } from "../src/agent/loop.js";
import { makeLlmRollingSummarizer, defaultRollingSummary } from "../src/agent/context.js";
import { ScriptedLlmClient, toolUse } from "../src/llm/mock.js";
import type { LlmClient } from "../src/llm/types.js";
import { Metrics } from "../src/metrics.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";

/**
 * WO-CONTEXT-COMPRESSION · 真 LLM 滚动摘要器 SEAM（补齐上下文压缩最后一块）。
 *
 * 接缝：`defaultRollingSummary` 是确定性拼接，`makeLlmRollingSummarizer` 接上真 LLM 摘要（llm.compose）·**fail-open**。
 * ① 有 provider + queue composeResults → 折叠轮触发 → 摘要走 LLM compose（compose 被调·摘要含 stub 文本进后续 system）；
 * ② 无 provider → 退 defaultRollingSummary（compose 未调·字节兼容）；③ compose 抛错 → fail-open 退确定性（不阻断循环）。
 */

const TENANT = "demo";
const TOOLS: AgentToolSpec[] = [
  { name: "query_objects", description: "查询对象", inputSchema: { type: "object", properties: {} }, binding: { kind: "BUILTIN" } },
];

describe("WO-CONTEXT-COMPRESSION · makeLlmRollingSummarizer（fail-open·R6 兜底）", () => {
  const notes = ["第1轮[query_objects:常州]", "第2轮[invoke_solver:capacity_forecast]", "第3轮[query_objects:订单]"];

  it("① provider 可用 + composeResults → 用 llm.compose 蒸馏（compose 被调·摘要=stub）", async () => {
    const llm = new ScriptedLlmClient();
    llm.composeResults = ["【前情摘要】已验证：常州化成良率 92% ⟦ref:0⟧·查过 capacity_forecast"];
    const spy = vi.spyOn(llm, "compose");
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, true);
    const out = await summarize(notes);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toContain("前情摘要");
    expect(out).toContain("92%");
  });

  it("② provider 不可用 → 退 defaultRollingSummary（compose 未调·字节一致）", async () => {
    const llm = new ScriptedLlmClient();
    const spy = vi.spyOn(llm, "compose");
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, false);
    const out = await summarize(notes);
    expect(spy).not.toHaveBeenCalled();
    expect(out).toBe(defaultRollingSummary(notes)); // 确定性兜底逐字节一致
  });

  it("③ compose 抛错 → fail-open 退 defaultRollingSummary（不阻断）", async () => {
    const llm = { compose: async () => { throw new Error("no provider / key 失效"); } } as unknown as Pick<LlmClient, "compose">;
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, true);
    expect(await summarize(notes)).toBe(defaultRollingSummary(notes));
  });

  it("③b compose 返回空串 → 退 defaultRollingSummary（不注入空摘要）", async () => {
    const llm = { compose: async () => "   " } as unknown as Pick<LlmClient, "compose">;
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, true);
    expect(await summarize(notes)).toBe(defaultRollingSummary(notes));
  });
});

describe("WO-CONTEXT-COMPRESSION · SEAM 端到端：折叠触发 → 注入的 LLM 摘要器真被调用（摘要进后续轮 system）", () => {
  async function runWithSummarizer(providerAvailable: boolean, composeStub: string) {
    const repos = createMemoryRepos();
    const metrics = new Metrics();
    const budget = new BudgetTracker();
    const dataCore = createMockDataCore();
    // 大 tool_result → 逼上下文过软阈值 → 折叠最旧轮 → 触发滚动摘要器。
    dataCore.ontology.queryObjects = async () => ({
      data: { items: Array.from({ length: 60 }, (_, i) => ({ idx: i, pad: "x".repeat(120) })) },
      snapshotVersion: "snap",
    });
    const llm = new ScriptedLlmClient();
    llm.caps = { countTokens: true, compaction: false, maxContextTokens: 6000 };
    if (providerAvailable) llm.composeResults = [composeStub, composeStub, composeStub];
    const composeSpy = vi.spyOn(llm, "compose");
    const captured: string[] = [];
    // 5 轮查询（累积折叠）→ 末轮捕获 system 后 final_answer 收尾。
    for (let k = 0; k < 5; k++) {
      llm.queueAgentTurn(() => ({ content: [toolUse("query_objects", { objectType: "Base", filter: { k } })] }));
    }
    llm.queueAgentTurn((req) => {
      captured.push(req.system);
      return { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "完成。" }], provenance: [] })] };
    });
    const executor = new GuardedToolExecutor(
      { dataCore, repos, metrics },
      { taskId: "task_cc", ctx: { tenantId: TENANT, userId: "u1", roles: ["planner"] }, budget },
    );
    const res = await runAgentLoop({
      taskId: "task_cc", model: "m", system: "基座系统提示", userContent: "把能查的都查一遍",
      tools: TOOLS, llm, executor, budget, repos, metrics, emit: async () => undefined,
      summarizer: makeLlmRollingSummarizer(llm, "m", TENANT, providerAvailable),
    });
    return { res, composeSpy, captured };
  }

  it("provider 可用 → 折叠后 system 含 LLM compose 蒸馏摘要（compose 真被调·接缝通）", async () => {
    const stub = "LLM蒸馏：已查常州各基地 Base";
    const { res, composeSpy, captured } = await runWithSummarizer(true, stub);
    expect(res.outcome).toBe("ANSWERED");
    expect(composeSpy).toHaveBeenCalled(); // 命门：注入的 LLM 摘要器真被折叠触发
    // 折叠后的前情摘要（compose 输出）注入了后续轮 system。
    expect(captured.some((s) => s.includes(stub))).toBe(true);
  });

  it("provider 不可用 → 折叠走确定性摘要（compose 未调·字节兼容·既有行为不变）", async () => {
    const { res, composeSpy, captured } = await runWithSummarizer(false, "不该出现");
    expect(res.outcome).toBe("ANSWERED");
    expect(composeSpy).not.toHaveBeenCalled(); // compose 从未被调
    expect(captured.some((s) => s.includes("不该出现"))).toBe(false);
    // 仍有前情摘要注入（确定性版）——证折叠摘要机制照跑，只是用兜底。
    expect(captured.some((s) => s.includes("前情摘要"))).toBe(true);
  });
});
