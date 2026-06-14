import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { AnthropicLlmClient, COMPACTION_BETA } from "../src/llm/anthropic.js";
import {
  CONTEXT_FULL_REMINDER,
  estimateTokensChars,
  truncateToolResultJson,
} from "../src/agent/context.js";
import { BudgetTracker } from "../src/tools/budget.js";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

const planner = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

function agentDef(partial: Partial<AgentDefinition> & { id: string; key: string }): AgentDefinition {
  return {
    tenantId: TENANT,
    version: 1,
    name: partial.key,
    description: "test agent",
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

function bigItems(n: number, padChars: number): { idx: number; pad: string }[] {
  return Array.from({ length: n }, (_, i) => ({ idx: i, pad: "x".repeat(padChars) }));
}

describe("增量 §1.2 · tool_result 截断（单元）", () => {
  it("≤8KB 原样；>8KB 在最大数组维度截断且 JSON 结构合法 + 尾注语义一字不差", () => {
    const small = truncateToolResultJson({ data: { items: bigItems(3, 10) } });
    expect(small.truncated).toBe(false);

    const payload = { data: { items: bigItems(500, 30), total: 500 }, snapshotVersion: "snap" };
    const r = truncateToolResultJson(payload);
    expect(r.truncated).toBe(true);
    const parsed = JSON.parse(r.json) as { data: { items: unknown[]; total: number }; snapshotVersion: string };
    expect(parsed.data.items.length).toBeLessThan(500);
    expect(parsed.data.total).toBe(500); // 非数组字段保留 → 结构合法
    expect(parsed.snapshotVersion).toBe("snap");
    expect(Buffer.byteLength(r.json, "utf8")).toBeLessThanOrEqual(8 * 1024);
    expect(r.note).toBe(`[已截断：共 500 条，仅含前 ${parsed.data.items.length} 条。请用更精确的过滤条件或聚合工具重查]`);
  });

  it("非数组型超长（巨字符串）降级为 preview 包装，仍是合法 JSON", () => {
    const r = truncateToolResultJson({ data: { blob: "y".repeat(20_000) } });
    expect(r.truncated).toBe(true);
    expect(() => JSON.parse(r.json)).not.toThrow();
    expect(r.note).toContain("已截断");
  });
});

describe("R1 · 工具返回 500 条对象（>8KB）", () => {
  it("上下文截断+尾注；审计存全量；模型下一轮用更窄过滤重查", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_r1", key: "r1_agent" }));
    t.dataCore.ontology.queryObjects = async (_ctx, _type, filter) => {
      const all = bigItems(500, 24);
      const narrowed = (filter as { idx?: number }).idx !== undefined;
      return {
        data: { items: narrowed ? all.slice(0, 3) : all, total: narrowed ? 3 : 500 },
        snapshotVersion: "snap-r1",
      };
    };

    t.llm.queueAgentTurn(
      { content: [toolUse("query_objects", { objectType: "Order", filter: {} })] },
      (req) => {
        const serialized = JSON.stringify(req.messages);
        // 进入上下文的内容被截断 + 模型可自纠的尾注
        expect(serialized).toContain("已截断：共 500 条，仅含前 ");
        expect(serialized).toContain("请用更精确的过滤条件或聚合工具重查");
        // 模型据此用更窄过滤条件重查
        return { content: [toolUse("query_objects", { objectType: "Order", filter: { idx: 1 } })] };
      },
      {
        content: [
          toolUse("final_answer", { blocks: [{ type: "text", markdown: "已基于窄查询完成。" }], provenance: [] }),
        ],
      },
    );

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r1",
      agentId: "agt_r1",
      version: "latest",
      prompt: "查订单",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");

    // 审计存全量（tool_calls 既有规则不变）
    const calls = await t.repos.toolCalls.listByTask("task_r1");
    const first = calls.find((c) => c.toolName === "query_objects");
    const out = first?.output as { data: { items: unknown[] } };
    expect(out.data.items.length).toBe(500);
    // 第二次调用确实带了更窄过滤
    const second = calls.filter((c) => c.toolName === "query_objects")[1];
    expect(JSON.stringify(second?.input)).toContain('"idx":1');
  });

  it("query_timeseries_agg 不受二次截断影响（桶上限已内置）", async () => {
    await t.repos.agents.insert(
      agentDef({
        id: "agt_r1b",
        key: "r1b_agent",
        tools: [{ kind: "BUILTIN", name: "query_timeseries_agg" }],
        scopeDeclaration: { objectTypes: ["Base"], toolNames: ["query_timeseries_agg"] },
      }),
    );
    const huge = { data: { points: bigItems(400, 30), tsAgg: { aggRunId: "a", specKey: "s@v1", window: { start: "x", end: "y" }, rowsIn: 1 } } };
    t.dataCore.timeseries.aggQuery = async () => huge;
    t.llm.queueAgentTurn(
      {
        content: [
          toolUse("query_timeseries_agg", {
            seriesKey: "oee:base",
            entityIds: ["base_changzhou"],
            window: { from: "2026-01-01", to: "2026-01-10", grain: "day" },
            agg: "avg",
          }),
        ],
      },
      (req) => {
        const serialized = JSON.stringify(req.messages);
        expect(serialized).not.toContain("已截断：共 400 条");
        // 全量 400 条进入上下文（豁免）
        expect(serialized).toContain('\\"idx\\":399');
        return {
          content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "时序完成。" }], provenance: [] })],
        };
      },
    );
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r1b",
      agentId: "agt_r1b",
      version: "latest",
      prompt: "查时序",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
  });
});

describe("R2 · 软阈值触发第 1 刀折叠", () => {
  it("最旧轮折叠、最近 2 轮完整；contextOps 记录；任务正常完成", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_r2", key: "r2_agent" }));
    t.llm.caps = { countTokens: true, compaction: false, maxContextTokens: 10_000 };
    t.dataCore.ontology.queryObjects = async () => ({
      data: { items: bigItems(50, 100) },
      snapshotVersion: "snap-r2",
    });

    for (let k = 0; k < 5; k++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Base", filter: { k } })] });
    }
    t.llm.queueAgentTurn((req) => {
      const toolResultMsgs = req.messages.filter(
        (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"),
      );
      expect(toolResultMsgs.length).toBe(5);
      const texts = toolResultMsgs.map((m) => JSON.stringify(m.content));
      // 最旧轮已折叠（占位摘要保留 tool_result 结构；原始数据已不在上下文中）
      expect(texts[0]).toContain("已折叠");
      expect(texts[0]).toContain("如需请重新调用");
      expect(texts[0]).not.toContain("<tool_data");
      expect(texts[0]).not.toContain('\\"idx\\":49');
      // 最近 2 轮永不折叠
      expect(texts[3]).toContain("<tool_data");
      expect(texts[4]).toContain("<tool_data");
      // assistant 的 tool_use 块保留（消息结构合法）
      const assistantMsgs = req.messages.filter((m) => m.role === "assistant");
      expect(assistantMsgs.length).toBe(5);
      return {
        content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "分析完成。" }], provenance: [] })],
      };
    });

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r2",
      agentId: "agt_r2",
      version: "latest",
      prompt: "连续分析",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
    const folds = (result.run.contextOps ?? []).filter((o) => o.op === "fold");
    expect(folds.length).toBeGreaterThanOrEqual(1);
    expect(t.metrics.contextOps.get({ op: "fold" })).toBe(folds.length);
    // count_tokens 每 2 轮实测一次（共 6 轮 → 3 次实测）
    expect(t.llm.countTokensRequests.length).toBe(3);
  });

  it("Phase7C: 折叠轮次蒸馏为「前情摘要」注入后续 system（消息级滚动摘要）", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_r7c", key: "r7c_agent" }));
    t.llm.caps = { countTokens: true, compaction: false, maxContextTokens: 10_000 };
    t.dataCore.ontology.queryObjects = async () => ({ data: { items: bigItems(50, 100) }, snapshotVersion: "snap-r7c" });

    for (let k = 0; k < 5; k++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Base", filter: { k } })] });
    }
    let sawRollingSummary = false;
    t.llm.queueAgentTurn((req) => {
      // 折叠已发生 → 本轮 system 应含「前情摘要」段 + 折叠轮的工具蒸馏（query_objects）
      if (req.system.includes("前情摘要（已折叠") && req.system.includes("query_objects")) sawRollingSummary = true;
      return { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "完成。" }], provenance: [] })] };
    });

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r7c",
      agentId: "agt_r7c",
      version: "latest",
      prompt: "连续分析",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
    expect((result.run.contextOps ?? []).some((o) => o.op === "fold")).toBe(true);
    expect(sawRollingSummary, "后续 system 注入了折叠轮的前情摘要").toBe(true);
  });
});

describe("R3 · 硬阈值强制收尾", () => {
  it("注入收尾提醒后 1 轮内 final_answer → ANSWERED；不抛 context 异常", async () => {
    await t.repos.agents.insert(
      agentDef({ id: "agt_r3", key: "r3_agent", systemPrompt: "提示词填充。".repeat(700) }),
    );
    t.llm.caps = { countTokens: true, compaction: false, maxContextTokens: 1000 };
    t.llm.queueAgentTurn((req) => {
      const last = req.messages[req.messages.length - 1];
      expect(last?.content).toBe(CONTEXT_FULL_REMINDER);
      return {
        content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "立即收尾。" }], provenance: [] })],
      };
    });
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r3a",
      agentId: "agt_r3",
      version: "latest",
      prompt: "问题",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
    expect((result.run.contextOps ?? []).some((o) => o.op === "force_finalize")).toBe(true);
    expect(t.metrics.contextOps.get({ op: "force_finalize" })).toBe(1);
  });

  it("提醒后仍无 final_answer → 按预算耗尽语义降级（不抛给用户）", async () => {
    await t.repos.agents.insert(
      agentDef({ id: "agt_r3b", key: "r3b_agent", systemPrompt: "提示词填充。".repeat(700) }),
    );
    t.llm.caps = { countTokens: true, compaction: false, maxContextTokens: 1000 };
    t.llm.queueAgentTurn({
      content: [text("还想继续查"), toolUse("query_objects", { objectType: "Base", filter: {} })],
    });
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r3b",
      agentId: "agt_r3b",
      version: "latest",
      prompt: "问题",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("BUDGET_EXHAUSTED");
    expect(result.answer.blocks[0]?.type).toBe("text");
  });

  it("收到 model_context_window_exceeded → 折叠+收尾提醒重试一次，不向用户抛异常", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_r3c", key: "r3c_agent" }));
    t.llm.queueAgentTurn(
      () => {
        throw new Error("model_context_window_exceeded: prompt is too long");
      },
      (req) => {
        const last = req.messages[req.messages.length - 1];
        expect(last?.content).toBe(CONTEXT_FULL_REMINDER);
        return {
          content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "超窗后收尾。" }], provenance: [] })],
        };
      },
    );
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r3c",
      agentId: "agt_r3c",
      version: "latest",
      prompt: "问题",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
    expect((result.run.contextOps ?? []).some((o) => o.op === "force_finalize")).toBe(true);
  });
});

describe("增量 §1.3 第 2 刀 · 服务端 compaction", () => {
  it("AnthropicAdapter：capability 开启时下发 context_management edits + beta 头；compaction 块原样映射", async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: "compaction", content: "前文已压缩摘要" },
        { type: "text", text: "继续" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 11, output_tokens: 7 },
    }));
    const countTokens = vi.fn(async () => ({ input_tokens: 4321 }));
    const fake = { messages: { create, countTokens } } as unknown as Anthropic;

    const client = new AnthropicLlmClient(undefined, { client: fake, enableCompaction: true });
    expect((await client.capabilities("claude-x")).compaction).toBe(true);

    const resp = await client.agent({
      model: "claude-x",
      system: "s",
      tools: [],
      messages: [{ role: "user", content: "hi" }],
      contextEdits: [{ type: COMPACTION_BETA }],
    });
    expect(create).toHaveBeenCalledTimes(1);
    const [params, callOpts] = create.mock.calls[0] as unknown as [Record<string, unknown>, { headers: Record<string, string> }];
    expect(params.context_management).toEqual({ edits: [{ type: COMPACTION_BETA }] });
    expect(callOpts.headers["anthropic-beta"]).toBe(COMPACTION_BETA);
    expect(resp.content[0]?.type).toBe("compaction");
    expect(resp.raw).toBeDefined(); // raw verbatim 回传载体

    expect(await client.countTokens({ model: "claude-x", system: "s", tools: [], messages: [] })).toBe(4321);

    // capability flag 关闭 → 不下发 edits
    const create2 = vi.fn(async () => ({ content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
    const off = new AnthropicLlmClient(undefined, {
      client: { messages: { create: create2, countTokens } } as unknown as Anthropic,
      enableCompaction: false,
    });
    expect((await off.capabilities("claude-x")).compaction).toBe(false);
    await off.agent({ model: "claude-x", system: "s", tools: [], messages: [], contextEdits: [{ type: COMPACTION_BETA }] });
    const [params2] = create2.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params2.context_management).toBeUndefined();
  });

  it("循环：折叠不足以回到软阈值 → 请求 compaction；响应 compaction 块后历史被其替代", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_cmp", key: "cmp_agent" }));
    t.llm.caps = { countTokens: true, compaction: true, maxContextTokens: 8000 };
    const bigPrompt = `分析任务：${"内容填充。".repeat(4200)}`; // ~21000 chars ≈ 6000 tokens（soft=5600, hard=7200 之间）

    t.llm.queueAgentTurn(
      (req) => {
        expect(req.contextEdits?.[0]?.type).toBe(COMPACTION_BETA);
        return {
          content: [
            { type: "compaction", summary: "服务端压缩块" },
            toolUse("query_objects", { objectType: "Base", filter: {} }),
          ],
        };
      },
      (req) => {
        // 压缩后：首条 user + 携带 compaction 的 assistant + tool_results —— 共 3 条
        expect(req.messages.length).toBe(3);
        expect(JSON.stringify(req.messages[1]?.content)).toContain("compaction");
        return {
          content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "压缩后完成。" }], provenance: [] })],
        };
      },
    );
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_cmp",
      agentId: "agt_cmp",
      version: "latest",
      prompt: bigPrompt,
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
    expect((result.run.contextOps ?? []).some((o) => o.op === "compact")).toBe(true);
    expect(t.metrics.contextOps.get({ op: "compact" })).toBe(1);
  });
});

describe("R4 · 同 conversation 追问（增量 §1.4 前情摘要）", () => {
  it("前情摘要注入（含关键实体）；不携带上一任务原始 messages；分类器 6 轮摘要共用构建器", async () => {
    const conversationId = "conv_r4";
    // 任务 1：路径 B，回答常州相关问题
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(
      { content: [toolUse("query_objects", { objectType: "Base", filter: { name: "常州" } })] },
      {
        content: [
          toolUse("final_answer", {
            blocks: [{ type: "text", markdown: "常州基地利用率处于高位，瓶颈为化成工序。" }],
            provenance: [],
          }),
        ],
      },
    );
    const q1 = await submitQuery(t, PLANNER, "常州的风险怎么样", {
      conversationId,
      selectedObjects: [{ objectType: "Base", objectId: "base_changzhou", label: "常州" }],
    });
    await waitForTask(t, q1.taskId, (x) => x.status === "COMPLETED");
    const task1ToolData = JSON.stringify(t.llm.agentRequests.at(-1)?.messages ?? []);
    expect(task1ToolData).toContain("<tool_data"); // 任务 1 自己的循环里有原始工具结果

    // 任务 2：同 conversation 追问（指代消解依赖前情摘要）
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const before = t.llm.agentRequests.length;
    t.llm.queueAgentTurn((req) => {
      // 不复用上一任务原始循环 messages：全新对话只有 1 条 user 消息
      expect(req.messages.length).toBe(1);
      const content = String(req.messages[0]?.content);
      expect(content).toContain("前情摘要");
      expect(content).toContain("常州的风险怎么样");
      expect(content).toContain("关键实体: Base:常州");
      // 上一任务的原始 tool_result 不在上下文中（token 断言）
      expect(content).not.toContain("<tool_data");
      expect(estimateTokensChars({ system: "", tools: [], messages: req.messages })).toBeLessThan(2000);
      return {
        content: [
          toolUse("final_answer", { blocks: [{ type: "text", markdown: "指常州：风险维持高位。" }], provenance: [] }),
        ],
      };
    });
    const q2 = await submitQuery(t, PLANNER, "那常州呢", { conversationId });
    const task2 = await waitForTask(t, q2.taskId, (x) => x.status === "COMPLETED");
    expect(task2.path).toBe("AGENT");
    expect(t.llm.agentRequests.length).toBe(before + 1);
    // 分类器的 6 轮摘要规则不变（共用同一摘要构建器）
    const lastClassify = t.llm.classifyRequests.at(-1);
    expect(lastClassify?.user).toContain("最近会话摘要");
    expect(lastClassify?.user).toContain("常州的风险怎么样");
  });
});
