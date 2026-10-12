import { describe, expect, it } from "vitest";
import { runAgentLoop, type AgentToolSpec } from "../src/agent/loop.js";
import { LlmEmptyResponseError, requireUsage } from "@platform/llm-adapters";
import type { LlmClient } from "../src/llm/types.js";
import { Metrics } from "../src/metrics.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";

/**
 * PRD 空响应护栏：agent 用途 LLM 返回 undefined/缺 usage 时，runAgentLoop **早失败为结构化 LlmEmptyResponseError**
 * （code=LLM_EMPTY_RESPONSE），而非裸读 .usage 崩成 `INTERNAL_ERROR · Cannot read ... 'usage'`。
 */
const TENANT = "demo";
const tools: AgentToolSpec[] = [
  { name: "query_objects", description: "查询", inputSchema: { type: "object", properties: {} }, binding: { kind: "BUILTIN" } },
];
async function runWith(agentImpl: () => Promise<unknown>) {
  const repos = createMemoryRepos();
  const metrics = new Metrics();
  const budget = new BudgetTracker();
  const executor = new GuardedToolExecutor(
    { dataCore: createMockDataCore(), repos, metrics },
    { taskId: "task_guard", ctx: { tenantId: TENANT, userId: "u1", roles: ["planner"] }, budget },
  );
  const llm = { agent: agentImpl } as unknown as LlmClient;
  return runAgentLoop({ taskId: "task_guard", model: "kimi-test", system: "s", userContent: "推演", tools, llm, executor, budget, repos, metrics, emit: async () => undefined });
}

describe("PRD · LLM agent 空响应护栏（FIX.1 loop + FIX.2 requireUsage）", () => {
  it("requireUsage：undefined / 缺 usage → LlmEmptyResponseError(code=LLM_EMPTY_RESPONSE)；含 usage → 通过", () => {
    expect(() => requireUsage(undefined, "m")).toThrow(LlmEmptyResponseError);
    expect(() => requireUsage({ usage: null }, "m")).toThrow(LlmEmptyResponseError);
    try { requireUsage(undefined, "kimi-x"); } catch (e) {
      expect((e as LlmEmptyResponseError).code).toBe("LLM_EMPTY_RESPONSE");
      expect((e as Error).message).toContain("kimi-x");
    }
    expect(() => requireUsage({ usage: { input_tokens: 1, output_tokens: 2 } }, "m")).not.toThrow();
  });

  it("runAgentLoop：agent() 返回 undefined → 抛 LlmEmptyResponseError（不再裸读 .usage）", async () => {
    await expect(runWith(async () => undefined)).rejects.toBeInstanceOf(LlmEmptyResponseError);
    await expect(runWith(async () => undefined)).rejects.toMatchObject({ code: "LLM_EMPTY_RESPONSE" });
  });

  it("runAgentLoop：agent() 返回缺 usage 的响应 → 同样护栏（指明 model）", async () => {
    const noUsage = async () => ({ content: [{ type: "text", text: "x" }], stopReason: "end_turn" });
    await expect(runWith(noUsage)).rejects.toBeInstanceOf(LlmEmptyResponseError);
    await expect(runWith(noUsage)).rejects.toThrow(/kimi-test/);
  });
});
