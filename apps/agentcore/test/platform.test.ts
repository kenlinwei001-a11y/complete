import { beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition, WorkflowDefinition } from "@platform/contracts";
import { createTestApp, debugHeaders, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

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

function wfDef(partial: Partial<WorkflowDefinition> & { id: string; key: string }): WorkflowDefinition {
  return {
    tenantId: TENANT,
    version: 1,
    name: partial.key,
    inputs: { type: "object", properties: {} },
    steps: [{ id: "s1", type: "query_objects", params: { objectType: "Base", filter: {} } }],
    status: "PUBLISHED",
    ...partial,
  };
}

const planner = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

describe("platform acceptance", () => {
  it("WF1: invoke_agent with expectsSchema → structured output referenced by next step", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_stats", key: "stats_agent" }));
    const wf = wfDef({
      id: "wf_util",
      key: "util_report",
      inputs: { type: "object", properties: {} },
      steps: [
        {
          id: "ag",
          type: "invoke_agent",
          params: {
            agentId: "agt_stats",
            version: "latest",
            prompt: "统计平均利用率：{{slots}}",
            expectsSchema: {
              type: "object",
              properties: { avgUtil: { type: "number" }, comment: { type: "string" } },
              required: ["avgUtil"],
            },
          },
        },
        {
          id: "render",
          type: "render_answer",
          params: {
            blocks: [
              { type: "kpi", label: "平均利用率", value: "{{steps.ag.output.data.avgUtil}}", fromStep: "ag" },
            ],
          },
        },
      ],
    });
    await t.repos.workflows.insert(wf);

    // nested agent returns structured final_answer per expectsSchema
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { avgUtil: 0.78, comment: "ok" })],
    });

    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/workflows/wf_util/run",
      headers: debugHeaders(PLANNER),
      payload: { inputs: {} },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string;
      answer: { blocks: { type: string; value?: string }[] };
      stepOutputs: Record<string, { data?: { avgUtil: number } }>;
    };
    expect(body.status).toBe("COMPLETED");
    expect(body.stepOutputs.ag?.data?.avgUtil).toBe(0.78);
    const kpi = body.answer.blocks.find((b) => b.type === "kpi");
    expect(kpi?.value).toBe("0.78");
    // the nested agent's final_answer tool schema was replaced by expectsSchema
    const lastReq = t.llm.agentRequests[t.llm.agentRequests.length - 1];
    const fa = lastReq?.tools.find((x) => x.name === "final_answer");
    expect(JSON.stringify(fa?.inputSchema)).toContain("avgUtil");
  });

  it("WF1b: invalid structured output is rejected and retried", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_stats2", key: "stats_agent2" }));
    await t.repos.workflows.insert(
      wfDef({
        id: "wf_util2",
        key: "util_report2",
        steps: [
          {
            id: "ag",
            type: "invoke_agent",
            params: {
              agentId: "agt_stats2",
              version: "latest",
              prompt: "统计",
              expectsSchema: { type: "object", properties: { avgUtil: { type: "number" } }, required: ["avgUtil"] },
            },
          },
          { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "完成。" }] } },
        ],
      }),
    );
    t.llm.queueAgentTurn(
      { content: [toolUse("final_answer", { wrong: true })] }, // schema violation
      { content: [toolUse("final_answer", { avgUtil: 0.5 })] },
    );
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/workflows/wf_util2/run",
      headers: debugHeaders(PLANNER),
      payload: { inputs: {} },
    });
    const body = res.json() as { status: string; stepOutputs: Record<string, { data?: { avgUtil?: number } }> };
    expect(body.status).toBe("COMPLETED");
    expect(body.stepOutputs.ag?.data?.avgUtil).toBe(0.5);
  });

  it("WF2: depth 3 ok; depth 4 → NESTING_DEPTH_EXCEEDED; static cycle → publish rejected", async () => {
    // chain: agentA(top, not counted) → wf1(1) → agentB(2) → wf2(3) [ok] / wf2b→agentC(4) [exceeded]
    const wf2 = wfDef({ id: "wf_l3", key: "wf_l3" }); // plain tool step, depth 3
    await t.repos.workflows.insert(wf2);
    const agentB = agentDef({
      id: "agt_b",
      key: "agent_b",
      tools: [{ kind: "WORKFLOW", workflowId: "wf_l3", version: "latest" }],
      scopeDeclaration: { objectTypes: [], toolNames: ["workflow_wf_l3"] },
    });
    await t.repos.agents.insert(agentB);
    const wf1 = wfDef({
      id: "wf_l1",
      key: "wf_l1",
      steps: [
        { id: "ag", type: "invoke_agent", params: { agentId: "agt_b", version: "latest", prompt: "继续" } },
      ],
    });
    await t.repos.workflows.insert(wf1);
    const agentA = agentDef({
      id: "agt_a",
      key: "agent_a",
      tools: [{ kind: "WORKFLOW", workflowId: "wf_l1", version: "latest" }],
      scopeDeclaration: { objectTypes: [], toolNames: ["workflow_wf_l1"] },
    });
    await t.repos.agents.insert(agentA);

    // depth-3 success: A calls wf1 → invoke_agent B → B calls wf_l3 → ok
    t.llm.queueAgentTurn(
      { content: [toolUse("workflow_wf_l1", {})] }, // agentA turn 1
      { content: [toolUse("workflow_wf_l3", {})] }, // agentB turn 1
      {
        content: [
          toolUse("final_answer", { blocks: [{ type: "text", markdown: "子流程完成。" }], provenance: [] }),
        ],
      }, // agentB turn 2
      {
        content: [
          toolUse("final_answer", { blocks: [{ type: "text", markdown: "全部完成。" }], provenance: [] }),
        ],
      }, // agentA turn 2
    );
    const ok = await t.deps.engine.runRegisteredAgent({
      taskId: "task_wf2_ok",
      agentId: "agt_a",
      version: "latest",
      prompt: "执行多级流程",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(ok.outcome).toBe("ANSWERED");
    expect(t.metrics.nestedInvocations.get({ kind: "workflow" })).toBeGreaterThanOrEqual(2);
    expect(t.metrics.nestedInvocations.get({ kind: "agent" })).toBeGreaterThanOrEqual(1);

    // depth-4: wf_l3 v2 carries invoke_agent → exceeds
    await t.repos.workflows.insert(
      wfDef({
        id: "wf_l3b",
        key: "wf_l3",
        version: 2,
        steps: [{ id: "ag", type: "invoke_agent", params: { agentId: "agt_stats_x", version: "latest", prompt: "x" } }],
      }),
    );
    await t.repos.agents.insert(agentDef({ id: "agt_stats_x", key: "agent_x" }));
    t.llm.queueAgentTurn(
      { content: [toolUse("workflow_wf_l1", {})] }, // agentA
      { content: [toolUse("workflow_wf_l3", {})] }, // agentB → resolves latest wf_l3 (v2) → depth 4
      (req) => {
        expect(JSON.stringify(req.messages)).toContain("NESTING_DEPTH_EXCEEDED");
        return {
          content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "超深被拒。" }], provenance: [] })],
        };
      }, // agentB sees the failure
      { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结束。" }], provenance: [] })] },
    );
    const deep = await t.deps.engine.runRegisteredAgent({
      taskId: "task_wf2_deep",
      agentId: "agt_a",
      version: "latest",
      prompt: "执行多级流程",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(deep.outcome).toBe("ANSWERED");

    // static cycle: wf_cycle invoke_agent agt_cycle; agt_cycle tools → wf_cycle → publish rejected
    await t.repos.workflows.insert(
      wfDef({
        id: "wf_cycle",
        key: "wf_cycle",
        steps: [{ id: "ag", type: "invoke_agent", params: { agentId: "agt_cycle", version: "latest", prompt: "x" } }],
      }),
    );
    await t.repos.agents.insert(
      agentDef({
        id: "agt_cycle",
        key: "agent_cycle",
        status: "DRAFT",
        tools: [{ kind: "WORKFLOW", workflowId: "wf_cycle", version: "latest" }],
      }),
    );
    const pub = await t.app.inject({
      method: "POST",
      url: "/b/v1/agents/agt_cycle/publish",
      headers: debugHeaders(PLANNER),
    });
    expect(pub.statusCode).toBe(400);
    expect((pub.json() as { error: { code: string } }).error.code).toBe("CYCLIC_INVOCATION");
  });

  it("AU3: tool call outside scopeDeclaration → AGENT_SCOPE_VIOLATION audited", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_scoped", key: "scoped_agent" }));
    t.llm.queueAgentTurn(
      // LLM attempts a tool that is NOT in scopeDeclaration.toolNames
      { content: [toolUse("invoke_solver", { solverKey: "capacity_forecast", args: {} })] },
      (req) => {
        expect(JSON.stringify(req.messages)).toContain("AGENT_SCOPE_VIOLATION");
        return {
          content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "超出能力声明。" }], provenance: [] })],
        };
      },
    );
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_au3",
      agentId: "agt_scoped",
      version: "latest",
      prompt: "算一下产能",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
    const calls = await t.repos.toolCalls.listByTask("task_au3");
    const denied = calls.find((c) => c.toolName === "invoke_solver");
    expect(denied?.outcome).toBe("DENIED");
    expect(JSON.stringify(denied?.output)).toContain("AGENT_SCOPE_VIOLATION");
    expect(t.metrics.toolCalls.get({ tool: "invoke_solver", outcome: "DENIED" })).toBe(1);
  });

  it("SC1: WORKFLOW_ONLY vs AGENT_FIRST behave differently for the same question", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_explore", key: "explorer" }));
    await t.repos.sceneEntries.upsert({
      id: "scn_wonly",
      tenantId: TENANT,
      viewKey: "wonly",
      mode: "WORKFLOW_ONLY",
      uiHints: { placeholder: "仅预设问题", suggestedQuestions: [] },
    });
    await t.repos.sceneEntries.upsert({
      id: "scn_afirst",
      tenantId: TENANT,
      viewKey: "afirst",
      mode: "AGENT_FIRST",
      defaultAgentId: "agt_explore",
      uiHints: { placeholder: "随便问", suggestedQuestions: [] },
    });

    // WORKFLOW_ONLY: no intent hit → 请换个问法 + intent list, agent NOT invoked
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const q1 = await submitQuery(t, PLANNER, "聊聊天气", { view: "wonly" });
    const task1 = await waitForTask(t, q1.taskId, (x) => x.status === "COMPLETED");
    const txt1 = task1.answer?.blocks[0];
    expect(txt1?.type === "text" && txt1.markdown.includes("请换个问法")).toBe(true);
    expect(txt1?.type === "text" && txt1.markdown.includes("受影响订单查询")).toBe(true);
    expect(t.llm.agentRequests.length).toBe(0); // no agent loop ran

    // AGENT_FIRST: classification skipped, goes straight to the configured agent
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "探索模式直接回答。" }], provenance: [] })],
    });
    const classifyCallsBefore = t.llm.classifyRequests.length;
    const q2 = await submitQuery(t, PLANNER, "聊聊天气", { view: "afirst" });
    const task2 = await waitForTask(t, q2.taskId, (x) => x.status === "COMPLETED");
    expect(task2.path).toBe("AGENT");
    const txt2 = task2.answer?.blocks[0];
    expect(txt2?.type === "text" && txt2.markdown.includes("探索模式直接回答")).toBe(true);
    expect(t.llm.classifyRequests.length).toBe(classifyCallsBefore); // classifier skipped
  });

  it("SK1: load_skill body lands in the next prompt; summary always in system", async () => {
    await t.repos.skills.insert({
      id: "skl_sop",
      tenantId: TENANT,
      key: "capacity_sop",
      version: 1,
      name: "产能分析 SOP",
      summary: "产能分析标准作业程序摘要",
      body: "技能正文：产能分析 SOP-9527，第一步拉取产线利用率，第二步对比瓶颈工序。",
      resources: [{ name: "template.xlsx", blobKey: "blob/template" }],
      status: "PUBLISHED",
    });
    await t.repos.agents.insert(
      agentDef({
        id: "agt_skilled",
        key: "skilled_agent",
        skills: [{ skillId: "skl_sop", version: "latest" }],
      }),
    );
    t.llm.queueAgentTurn(
      { content: [toolUse("load_skill", { skillId: "skl_sop" })] },
      (req) => {
        expect(JSON.stringify(req.messages)).toContain("SOP-9527"); // 全文已注入对话
        return {
          content: [
            toolUse("final_answer", { blocks: [{ type: "text", markdown: "已按 SOP 执行。" }], provenance: [] }),
          ],
        };
      },
    );
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_sk1",
      agentId: "agt_skilled",
      version: "latest",
      prompt: "按产能 SOP 分析",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
    // 摘要常驻 system prompt（渐进披露）
    expect(t.llm.agentRequests[0]?.system).toContain("产能分析标准作业程序摘要");
    expect(t.llm.agentRequests[0]?.system).not.toContain("SOP-9527");
    // load_skill audited
    const calls = await t.repos.toolCalls.listByTask("task_sk1");
    expect(calls.some((c) => c.toolName === "load_skill" && c.outcome === "OK")).toBe(true);
  });

  it("MC1: MCP tool call (mock client) audited + wrapped as untrusted", async () => {
    await t.repos.mcpConfigs.insert({
      id: "mcp_demo",
      tenantId: TENANT,
      name: "demo",
      transport: { type: "stdio", command: "node", args: ["dist/mcp/demo-server.js"] },
      status: "ACTIVE",
    });
    await t.repos.agents.insert(
      agentDef({
        id: "agt_mcp",
        key: "mcp_agent",
        tools: [{ kind: "MCP", mcpConfigId: "mcp_demo" }],
        mcpServers: [{ mcpConfigId: "mcp_demo" }],
        scopeDeclaration: { objectTypes: [], toolNames: ["demo_echo", "demo_add"] },
      }),
    );
    t.llm.queueAgentTurn(
      { content: [toolUse("demo_add", { a: 2, b: 3 })] },
      (req) => {
        const serialized = JSON.stringify(req.messages);
        expect(serialized).toContain("<tool_data");
        expect(serialized).toContain("5");
        return {
          content: [
            toolUse("final_answer", { blocks: [{ type: "text", markdown: "外部工具调用完成 ⟦ref:0⟧。" }], provenance: [] }),
          ],
        };
      },
    );
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_mc1",
      agentId: "agt_mcp",
      version: "latest",
      prompt: "用外部工具算 2+3",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
    expect(t.mcp.calls).toEqual([{ mcpConfigId: "mcp_demo", toolName: "demo_add", args: { a: 2, b: 3 } }]);
    const calls = await t.repos.toolCalls.listByTask("task_mc1");
    expect(calls.some((c) => c.toolName === "demo_add" && c.outcome === "OK")).toBe(true);
    // MCP tools (sideEffect=EXTERNAL) are never in the QOS path B whitelist
    const { BUILTIN_TOOLS } = await import("../src/tools/registry.js");
    expect(BUILTIN_TOOLS.some((x) => x.name === "demo_add")).toBe(false);
  });

  it("MCP credential is encrypted at rest and never echoed", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/mcp-configs",
      headers: debugHeaders(PLANNER),
      payload: {
        name: "ext",
        transport: { type: "streamable_http", url: "https://mcp.example.com/mcp" },
        status: "ACTIVE",
        credential: "super-secret-token",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; credentialRef?: string; credential?: string };
    expect(body.credential).toBeUndefined();
    expect(body.credentialRef).toMatch(/^cred_/);
    const cred = await t.repos.credentials.get(body.credentialRef as string);
    expect(cred?.ciphertext).not.toContain("super-secret-token");
  });
});
