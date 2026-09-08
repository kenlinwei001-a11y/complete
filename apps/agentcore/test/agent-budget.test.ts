import { beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

/**
 * WO-Phase4 · ReAct Fallback 硬预算 + 超时诚实降级（确定性 R6·不依赖 LLM 输出内容）。
 *
 * 经 `engine.runRegisteredAgent`（真 executor / 真 DataCore 读 / 真 loop）驱动，用**小预算**逼出降级：
 * 每维（maxRoundTrips / maxDiscoverCalls / maxToolCalls / maxIterations / maxDurationMs）任一超 → 优雅降级
 * outcome=BUDGET_EXHAUSTED·答案含 `[预算耗尽·诚实摘要]` 前缀 + provenance（复用 finalize-force / 部分发现抢救）。
 * 无真 provider·全程 mock LLM（沙箱纪律：live 10 题复测需真 Kimi provider·留部署态·此处只证 budget/degrade 机制）。
 */

const planner = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

function agentDef(partial: Partial<AgentDefinition> & { id: string; key: string }): AgentDefinition {
  return {
    tenantId: TENANT,
    version: 1,
    name: partial.key,
    description: "budget test agent",
    model: "claude-opus-4-8",
    systemPrompt: "你是测试 agent。",
    tools: [{ kind: "BUILTIN", name: "query_objects" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: ["Base"], toolNames: ["query_objects"] },
    status: "PUBLISHED",
    ...partial,
  };
}

/** query_objects(Base) 恒返、永不 final_answer（纯空转 ReAct·无 text → degrade 走 sketch 复述工具轨迹）。 */
const queryBaseTurn = () => ({ content: [toolUse("query_objects", { objectType: "Base", filter: {} })] });

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("WO-Phase4 · 硬预算 → 优雅降级（BUDGET_EXHAUSTED·确定性 R6）", () => {
  it("① maxRoundTrips=4：5 轮工具 → 第 5 轮前硬预算降级·outcome=BUDGET_EXHAUSTED·答案含前缀+provenance", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_rt", key: "rt_agent" }));
    for (let k = 0; k < 8; k++) t.llm.queueAgentTurn(queryBaseTurn());
    const budget = new BudgetTracker({ maxRoundTrips: 4, maxIterations: 24, maxToolCalls: 40, maxDurationMs: 600_000 });

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_rt", agentId: "agt_rt", version: "latest", prompt: "把所有能查的都翻一遍给我个自由结论",
      ctx: planner, nesting: { callChain: [], budget }, emit: async () => undefined,
    });

    expect(result.outcome).toBe("BUDGET_EXHAUSTED");
    expect(result.degraded?.reason).toBe("BUDGET_EXHAUSTED");
    // 第 5 轮之前触发：只完成 4 个 round-trip（不多跑）
    expect(budget.roundTrips).toBe(4);
    const md = result.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("[预算耗尽·诚实摘要]"); // 诚实摘要前缀
    expect(md).toContain("query_objects"); // 复述已探索工具（非空壳）
    // provenance 列所有成功产出结果的 toolCallId（R13·每数字可溯源）；4 轮成功读 → 4 条
    expect(result.answer.provenance.length).toBeGreaterThanOrEqual(1);
    for (const p of result.answer.provenance) {
      expect(p.toolCallId).toBeTruthy();
      expect(p.toolName).toBe("query_objects");
    }
    expect(t.metrics.agentBudgetExhausted.get()).toBe(1);
    expect(t.metrics.agentTimeout.get()).toBe(0); // 非超时路径·timeout 不计
  });

  it("② maxDiscoverCalls=1：discover 调 2 次 → 第 2 次 deny(BUDGET_EXCEEDED)+硬预算降级", async () => {
    await t.repos.agents.insert(
      agentDef({
        id: "agt_dc", key: "dc_agent",
        tools: [{ kind: "BUILTIN", name: "discover" }],
        scopeDeclaration: { objectTypes: [], toolNames: ["discover"] },
      }),
    );
    for (let k = 0; k < 5; k++) {
      t.llm.queueAgentTurn(() => ({ content: [text("盲扫目录。"), toolUse("discover", { kind: "object_types" })] }));
    }
    const budget = new BudgetTracker({ maxDiscoverCalls: 1, maxRoundTrips: 24, maxIterations: 24, maxToolCalls: 40, maxDurationMs: 600_000 });

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_dc", agentId: "agt_dc", version: "latest", prompt: "到处盲扫看看有什么",
      ctx: planner, nesting: { callChain: [], budget }, emit: async () => undefined,
    });

    expect(result.outcome).toBe("BUDGET_EXHAUSTED");
    expect(result.degraded?.reason).toBe("BUDGET_EXHAUSTED");
    // 只允许 1 次 discover 盲扫；第 2 次被拒（discoverCalls 封顶 1）
    expect(budget.discoverCalls).toBe(1);
    expect(budget.exhausted).toBe(true);
    expect(budget.exhaustedReason).toBe("maxDiscoverCalls exceeded");
    // 审计里第 2 次 discover 记为 BUDGET_EXCEEDED（deny）
    const calls = await t.repos.toolCalls.listByTask("task_dc");
    const discovers = calls.filter((c) => c.toolName === "discover");
    expect(discovers.some((c) => c.outcome === "OK")).toBe(true);
    expect(discovers.some((c) => c.outcome === "BUDGET_EXCEEDED")).toBe(true);
    const md = result.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("[预算耗尽·诚实摘要]");
  });

  it("③ maxToolCalls=2：3 轮工具 → 第 3 轮工具预算尽 → 硬预算降级", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_tc", key: "tc_agent" }));
    for (let k = 0; k < 6; k++) t.llm.queueAgentTurn(queryBaseTurn());
    const budget = new BudgetTracker({ maxToolCalls: 2, maxRoundTrips: 24, maxIterations: 24, maxDurationMs: 600_000 });

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_tc", agentId: "agt_tc", version: "latest", prompt: "反复查",
      ctx: planner, nesting: { callChain: [], budget }, emit: async () => undefined,
    });

    expect(result.outcome).toBe("BUDGET_EXHAUSTED");
    expect(budget.toolCalls).toBe(2); // 封顶 2·第 3 次被拒
    const md = result.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("[预算耗尽·诚实摘要]");
  });

  it("④ maxIterations=3：永不 final_answer → 迭代耗尽降级（BUDGET_EXHAUSTED）", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_it", key: "it_agent" }));
    for (let k = 0; k < 8; k++) t.llm.queueAgentTurn(queryBaseTurn());
    const budget = new BudgetTracker({ maxIterations: 3, maxRoundTrips: 24, maxToolCalls: 40, maxDurationMs: 600_000 });

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_it", agentId: "agt_it", version: "latest", prompt: "反复查",
      ctx: planner, nesting: { callChain: [], budget }, emit: async () => undefined,
    });

    expect(result.outcome).toBe("BUDGET_EXHAUSTED");
    expect(budget.iterations).toBe(3);
    const md = result.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("[预算耗尽·诚实摘要]");
  });

  it("⑤ maxDurationMs=0：预算即刻耗尽·无任何工具结果 → 诚实 NO_ANSWER（provenance 空·不编造）", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_du", key: "du_agent" }));
    t.llm.queueAgentTurn(queryBaseTurn());
    // -1：elapsedMs()（≥0）恒 > -1 → 首轮迭代前即判超时（0 > 0 为假·故用 -1 保确定性触发）
    const budget = new BudgetTracker({ maxDurationMs: -1, maxRoundTrips: 24, maxIterations: 24, maxToolCalls: 40 });

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_du", agentId: "agt_du", version: "latest", prompt: "查",
      ctx: planner, nesting: { callChain: [], budget }, emit: async () => undefined,
    });

    expect(result.outcome).toBe("BUDGET_EXHAUSTED");
    expect(result.degraded?.reason).toBe("BUDGET_EXHAUSTED");
    const md = result.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("[预算耗尽·诚实摘要]");
    // 无成功工具结果 → 诚实空 provenance（不造溯源）
    expect(result.answer.provenance).toHaveLength(0);
  });
});

/**
 * SEAM（config × 引擎接缝·端到端经真 submitQuery→runPipeline→runPathB→runAgentLoop）：
 * `QOS_AGENT_MAX_ROUND_TRIPS` env 注入 residual path-B 硬预算——真开放深问在 N 轮 round-trip 后有界降级（BUDGET_EXHAUSTED）
 * + `agent_degraded` 伪 step 早于 answer.final。证 orchestrator 把 config 硬预算真接到 residual 循环（非只 loop unit 半）。
 * env 未设时（既有全部 path-B 测试）→ 不覆写宽松 DEFAULT → 逐字节不变（B3 等不回归）。
 */
describe("WO-Phase4 · residual path-B 硬预算 SEAM（config→orchestrator→loop 接缝）", () => {
  it("QOS_AGENT_MAX_ROUND_TRIPS=2 → 真开放深问 2 轮后有界降级·COMPLETED·agentBudgetExhausted=1·降级事件早于 final", async () => {
    const t = await createTestApp({ env: { QOS_AGENT_MAX_ROUND_TRIPS: "2" } });
    t.llm.queueClassification(OUT_OF_CATALOG);
    // 恒返 READ 工具、永不 final_answer（纯空转 residual ReAct）
    for (let i = 0; i < 12; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: {} })] });
    }

    const { taskId } = await submitQuery(t, PLANNER, "把所有能查的都翻一遍并给我一个综合自由结论", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.path).toBe("AGENT");
    expect(task.status).toBe("COMPLETED"); // 有界返回（非 hang）
    expect(t.metrics.agentBudgetExhausted.get()).toBe(1);

    const trace = await t.repos.fallbackTraces.getByTask(taskId);
    expect(trace?.outcome).toBe("BUDGET_EXHAUSTED");

    // 降级事件 step.completed(type=agent_degraded, outcome=BUDGET_EXHAUSTED) 早于 answer.final
    const events = await t.repos.events.listAfter(taskId, 0);
    const degradeRow = events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded");
    expect((degradeRow?.payload as { outcome?: string })?.outcome).toBe("BUDGET_EXHAUSTED");
    const degradeSeq = degradeRow?.seq ?? -1;
    const finalSeq = events.find((e) => e.event === "answer.final")?.seq ?? -1;
    expect(degradeSeq).toBeGreaterThan(0);
    expect(finalSeq).toBeGreaterThan(degradeSeq);

    // 诚实摘要前缀 + 复述工具线索
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("[预算耗尽·诚实摘要]");
    expect(md).toContain("query_objects");
  });
});
