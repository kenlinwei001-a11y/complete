import { beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { HANG, text, toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";

/**
 * G-9 SEAM 组合测（经真 QOS 管线 submitQuery → runPipeline → runPathB → runAgentLoop，非直调 loop unit）：
 * path-B agent 工具循环遇「接不到求解器的自由深问」不再空转/挂住 —— 有界终止 + 诚实部分发现 + 降级事件（早于 answer.final）。
 *
 * Case A 空转：函数 turn 恒返 READ 工具无 text（无定时器）→ 预算耗尽有界终止（BUDGET_EXHAUSTED）。
 * Case B 挂死：QOS_AGENT_LLM_TIMEOUT_MS=50 + 首轮 HANG turn → per-call deadline abort → 优雅降级（TIMEOUT）。
 *
 * 降级事件复用 step.completed 伪 step（type=agent_degraded），不新增 PRD §8.2 事件名。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

/** 取某事件（event + payload.type/outcome 匹配）的 seq；不存在返回 -1。 */
function seqOf(
  events: { seq: number; event: string; payload: unknown }[],
  event: string,
  payloadType?: string,
): number {
  const row = events.find(
    (e) => e.event === event && (payloadType === undefined || (e.payload as { type?: string })?.type === payloadType),
  );
  return row?.seq ?? -1;
}

describe("G-9 · path-B agent 有界超时 + 优雅降级（SEAM）", () => {
  let t: TestApp;

  describe("Case A · 空转（接不到求解器的自由深问）→ 预算耗尽有界终止", () => {
    beforeEach(async () => {
      t = await createTestApp();
    });

    it("有界返回 COMPLETED + 降级事件(BUDGET_EXHAUSTED 早于 answer.final) + 诚实部分发现 + B3 不回归", async () => {
      t.llm.queueClassification(OUT_OF_CATALOG);
      // 函数 turn 恒返 READ 工具、无 text（纯空转，无定时器）；预算调参后 24 轮 = maxIterations(24) → 预算耗尽
      for (let i = 0; i < 24; i++) {
        t.llm.queueAgentTurn(() => ({
          content: [
            toolUse("query_objects", { objectType: "Order", filter: {} }),
            toolUse("query_objects", { objectType: "Base", filter: {} }),
          ],
        }));
      }

      const { taskId } = await submitQuery(t, PLANNER, "帮我把所有能查的都翻一遍并给个自由结论", { view: "dash" });
      // 有界返回（非 hang）
      const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
      expect(task.path).toBe("AGENT");
      expect(task.status).toBe("COMPLETED");

      // B3 不回归：预算耗尽计数 + fallbackTrace outcome
      expect(t.metrics.agentBudgetExhausted.get()).toBe(1);
      expect(t.metrics.agentTimeout.get()).toBe(0); // 非超时路径，timeout 不计
      const trace = await t.repos.fallbackTraces.getByTask(taskId);
      expect(trace?.outcome).toBe("BUDGET_EXHAUSTED");

      // 降级事件：step.completed 伪 step type=agent_degraded outcome=BUDGET_EXHAUSTED，且 seq 早于 answer.final
      const events = await t.repos.events.listAfter(taskId, 0);
      const degradeSeq = seqOf(events, "step.completed", "agent_degraded");
      const finalSeq = seqOf(events, "answer.final");
      expect(degradeSeq).toBeGreaterThan(0);
      expect(finalSeq).toBeGreaterThan(0);
      expect(degradeSeq).toBeLessThan(finalSeq);
      const degradeRow = events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded");
      expect((degradeRow?.payload as { outcome?: string })?.outcome).toBe("BUDGET_EXHAUSTED");

      // 诚实措辞 + 复述工具线索（非空壳）
      const md = (task.answer?.blocks ?? [])
        .map((b) => (b.type === "text" ? b.markdown : ""))
        .join("\n");
      expect(md).not.toContain("（探索模式未能产出回答）");
      expect(md).toMatch(/未能完全解答|已达最大探索轮次/);
      expect(md).toContain("query_objects"); // 复述已探索的工具调用
    });
  });

  describe("Case B · 挂死（某次 llm.agent() 挂住）→ per-call deadline 优雅降级", () => {
    beforeEach(async () => {
      t = await createTestApp({ env: { QOS_AGENT_LLM_TIMEOUT_MS: "50" } });
    });

    it("<<8s 有界返回 COMPLETED + agentTimeout=1 + 降级事件(TIMEOUT 早于 final) + signal 穿到适配器面", async () => {
      t.llm.queueClassification(OUT_OF_CATALOG);
      // 首轮就挂住（HANG 永不 resolve，仅 signal abort 时 reject AbortError）
      t.llm.queueAgentTurn(HANG, {
        content: [text("（不会到这里：首轮已被 per-call deadline 终止）")],
      });

      const started = Date.now();
      const { taskId } = await submitQuery(t, PLANNER, "为什么这个基地长期未达成？给我根因", { view: "dash" });
      // 在 <<8s（约 50ms 量级）返回，而非 hang
      const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 8000);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(4000);

      expect(task.status).toBe("COMPLETED"); // 非 FAILED、非裸 INTERNAL_ERROR
      expect(task.path).toBe("AGENT");
      expect(t.metrics.agentTimeout.get()).toBe(1);

      // 降级事件 outcome=TIMEOUT，早于 answer.final
      const events = await t.repos.events.listAfter(taskId, 0);
      const degradeRow = events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded");
      expect((degradeRow?.payload as { outcome?: string })?.outcome).toBe("TIMEOUT");
      const degradeSeq = seqOf(events, "step.completed", "agent_degraded");
      const finalSeq = seqOf(events, "answer.final");
      expect(degradeSeq).toBeGreaterThan(0);
      expect(finalSeq).toBeGreaterThan(0);
      expect(degradeSeq).toBeLessThan(finalSeq);

      // 诚实部分发现含"探索超时"
      const md = (task.answer?.blocks ?? [])
        .map((b) => (b.type === "text" ? b.markdown : ""))
        .join("\n");
      expect(md).toContain("探索超时");

      // signal 穿到适配器面（证 AbortSignal 从 loop → llm.agent 请求）
      expect(t.llm.agentRequests[0]?.signal).toBeDefined();
      expect(t.llm.agentRequests[0]?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("Case C · engine.runRegisteredAgent 路径挂死（角色 agent / CEO 深问 / 场景启动器）→ 同样有界降级", () => {
    // 转圈根因修复：runRegisteredAgent 此前漏传 llmCallTimeoutMs（engine.ts:216）→ 真 LLM 某次调用挂住时循环卡死、
    // 永不发终结事件 → 前端 useTaskStream 无限重连 → 转圈（用户三次实测：深问块 / 场景启动器）。本例短超时 + 首轮 HANG，
    // 直击 engine.runRegisteredAgent（非 submitQuery 主 path B），断言有界降级 TIMEOUT。**修前此测 hang → 超时红。**
    it("HANG + QOS_AGENT_LLM_TIMEOUT_MS=50 → engine.runRegisteredAgent <<4s 有界返回 degraded=TIMEOUT（非挂死）", async () => {
      t = await createTestApp({ env: { QOS_AGENT_LLM_TIMEOUT_MS: "50" } });
      const agent: AgentDefinition = {
        id: "agt_ceo_timeout", key: "ceo_timeout_agent", tenantId: TENANT, version: 1,
        name: "ceo_timeout_agent", description: "test", model: "claude-opus-4-8",
        systemPrompt: "你是测试角色 agent。", tools: [{ kind: "BUILTIN", name: "query_objects" }],
        ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" }, skills: [], mcpServers: [],
        scopeDeclaration: { objectTypes: ["Base"], toolNames: ["query_objects"] }, status: "PUBLISHED",
      };
      await t.repos.agents.insert(agent);
      t.llm.queueAgentTurn(HANG); // 首轮就挂住（HANG 仅在 signal abort 时 reject）

      const started = Date.now();
      const result = await t.deps.engine.runRegisteredAgent({
        taskId: "task_ceo_timeout", agentId: agent.id, version: "latest",
        prompt: "为什么这个基地长期未达成？给我根因",
        ctx: { tenantId: TENANT, userId: "user-planner", roles: ["planner"] },
        nesting: { callChain: [], budget: new BudgetTracker() },
        emit: async () => undefined,
      });
      const elapsed = Date.now() - started;

      // 修前：无 per-call 超时 → 此调用永挂 → 测试超时红。修后：<<4s 有界返回优雅降级。
      expect(elapsed).toBeLessThan(4000);
      expect(result.degraded?.reason).toBe("TIMEOUT");
      expect(result.outcome).toBe("BUDGET_EXHAUSTED");
      expect(result.answer.blocks.length).toBeGreaterThan(0); // 诚实降级答复非空壳
      expect(t.llm.agentRequests[0]?.signal).toBeInstanceOf(AbortSignal); // signal 真穿到适配器面
    });
  });
});
