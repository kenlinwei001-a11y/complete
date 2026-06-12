import { beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition, QueryTask } from "@platform/contracts";
import { ADMIN, createTestApp, debugHeaders, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { sweepInterruptedTasks, INTERRUPTED_BY_RESTART } from "../src/ops/sweep.js";
import { NoopWorkflowCheckpointStore } from "../src/workflow/checkpoint.js";
import { validatePlanSteps, WORKFLOW_TOTAL_TIMEOUT_LIMIT_MS } from "../src/workflow/validate.js";
import { InMemorySkillResourceReader } from "../src/tools/skill-resources.js";
import { BUILTIN_TOOLS } from "../src/tools/registry.js";
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

function executingTask(id: string, status: QueryTask["status"], createdAt: string): QueryTask {
  return {
    id,
    tenantId: TENANT,
    userId: "user-planner",
    packageId: "pkg_battery_manufacturing",
    conversationId: `conv_${id}`,
    query: "q",
    context: { view: "risk", selectedObjects: [], filters: {} },
    status,
    clarificationRounds: 0,
    createdAt,
  };
}

describe("增量 §2 · Workflow 执行语义", () => {
  it("§2-1 发布校验：Σ步骤超时 > 5 分钟 → 拒绝发布", async () => {
    // 11 × invoke_solver（默认 30s）= 330s > 300s
    const steps = Array.from({ length: 11 }, (_, i) => ({
      id: `s${i}`,
      type: "invoke_solver",
      params: { solverKey: "capacity_forecast", args: {} },
    }));
    const created = await t.app.inject({
      method: "POST",
      url: "/b/v1/workflows",
      headers: debugHeaders(ADMIN),
      payload: { key: "too_long", name: "超时流程", inputs: { type: "object", properties: {} }, steps },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${id}/publish`, headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(200);
    const body = pub.json() as { ok: boolean; errors: { message: string }[] };
    expect(body.ok).toBe(false);
    expect(body.errors.some((e) => e.message.includes("5 分钟"))).toBe(true);

    // 显式 timeoutMs 形态（单元）：290s + 默认 10s + 默认 30s > 300s
    const msgs = validatePlanSteps([
      { id: "a", type: "invoke_solver", params: { solverKey: "x", args: {} }, timeoutMs: 290_000 },
      { id: "b", type: "query_objects", params: { objectType: "Base", filter: {} } },
      { id: "c", type: "invoke_solver", params: { solverKey: "y", args: {} } },
    ]);
    expect(msgs.some((m) => m.includes(String(WORKFLOW_TOTAL_TIMEOUT_LIMIT_MS)))).toBe(true);
  });

  it("R5（服务端）· 启动扫描：EXECUTING_* 超 10 分钟 → FAILED INTERRUPTED_BY_RESTART + SSE 可回放事件", async () => {
    const stale = new Date(Date.now() - 20 * 60_000).toISOString();
    const fresh = new Date(Date.now() - 60_000).toISOString();
    await t.repos.tasks.insert(executingTask("task_stuck_agent", "EXECUTING_AGENT", stale));
    await t.repos.tasks.insert(executingTask("task_stuck_wf", "EXECUTING_WORKFLOW", stale));
    await t.repos.tasks.insert(executingTask("task_fresh", "EXECUTING_AGENT", fresh));
    await t.repos.tasks.insert(executingTask("task_done", "COMPLETED", stale));

    const swept = await sweepInterruptedTasks({ repos: t.repos, events: t.deps.events, metrics: t.metrics });
    expect(swept).toBe(2);

    const stuck = await t.repos.tasks.get("task_stuck_agent");
    expect(stuck?.status).toBe("FAILED");
    expect(stuck?.error?.code).toBe(INTERRUPTED_BY_RESTART);
    expect(stuck?.error?.message).toContain("系统重启中断");
    // SSE 回放可见（task.failed 事件已落库）
    const events = await t.repos.events.listAfter("task_stuck_agent", 0);
    expect(events.some((e) => e.event === "task.failed" && JSON.stringify(e.payload).includes(INTERRUPTED_BY_RESTART))).toBe(true);

    // 执行中的新任务与已完成任务不受影响
    expect((await t.repos.tasks.get("task_fresh"))?.status).toBe("EXECUTING_AGENT");
    expect((await t.repos.tasks.get("task_done"))?.status).toBe("COMPLETED");
    expect(t.metrics.interruptedTasks.get()).toBe(2);

    // 幂等：再次扫描无新增
    expect(await sweepInterruptedTasks({ repos: t.repos, events: t.deps.events, metrics: t.metrics })).toBe(0);
  });

  it("§2-3 预留接口：WorkflowCheckpointStore 空实现", async () => {
    const store = new NoopWorkflowCheckpointStore();
    await store.save({ runId: "r1", stepId: "s1", stepOutputs: {}, savedAt: new Date().toISOString() });
    expect(await store.load("r1")).toBeUndefined();
    await store.clear("r1");
  });
});

describe("R6 · read_skill_resource（增量 §3）", () => {
  const SKILL = {
    id: "skl_res",
    tenantId: TENANT,
    key: "res_skill",
    version: 1,
    name: "资源技能",
    summary: "带附件的技能",
    body: "操作步骤详见 {{resource:guide.md}}，数据模板见 {{resource:template.xlsx}}。",
    resources: [
      { name: "guide.md", blobKey: "b_guide", mime: "text/markdown", description: "操作指南" },
      { name: "template.xlsx", blobKey: "b_bin", mime: "application/vnd.ms-excel", description: "数据模板" },
    ],
    status: "PUBLISHED" as const,
  };

  it("注册表/白名单：read_skill_resource 是 READ/CHEAP 内置工具，路径 B 可用", () => {
    const def = BUILTIN_TOOLS.find((x) => x.name === "read_skill_resource");
    expect(def?.sideEffect).toBe("READ");
    expect(def?.costClass).toBe("CHEAP");
  });

  it("文本附件可读且 64KB 截断规则生效；二进制返回元信息「无法直接读取」；load_skill 附资源清单", async () => {
    await t.repos.skills.insert(SKILL);
    const reader = new InMemorySkillResourceReader({
      b_guide: `# 指南\n${"内容行。".repeat(20_000)}`, // >64KB
      b_bin: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    });
    t.deps.engine.deps.skillResources = reader;
    await t.repos.agents.insert(
      agentDef({
        id: "agt_res",
        key: "res_agent",
        tools: [{ kind: "BUILTIN", name: "read_skill_resource" }],
        skills: [{ skillId: "skl_res", version: "latest" }],
        scopeDeclaration: { objectTypes: [], toolNames: ["read_skill_resource"] },
      }),
    );

    t.llm.queueAgentTurn(
      { content: [toolUse("load_skill", { skillId: "skl_res" })] },
      (req) => {
        const serialized = JSON.stringify(req.messages);
        // 资源清单含 mime/description（模型由此知道附件是什么、何时读）
        expect(serialized).toContain("text/markdown");
        expect(serialized).toContain("操作指南");
        // body 中 {{resource:name}} 标注原样保留
        expect(serialized).toContain("{{resource:guide.md}}");
        return { content: [toolUse("read_skill_resource", { skillId: "skl_res", resourceName: "guide.md" })] };
      },
      (req) => {
        const serialized = JSON.stringify(req.messages);
        expect(serialized).toContain("# 指南");
        expect(serialized).toContain("已截断"); // 64KB 截断提示
        return { content: [toolUse("read_skill_resource", { skillId: "skl_res", resourceName: "template.xlsx" })] };
      },
      (req) => {
        const serialized = JSON.stringify(req.messages);
        expect(serialized).toContain("无法直接读取");
        expect(serialized).toContain("application/vnd.ms-excel");
        return {
          content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "附件已消费。" }], provenance: [] })],
        };
      },
    );
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r6",
      agentId: "agt_res",
      version: "latest",
      prompt: "按技能附件操作",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
    const calls = await t.repos.toolCalls.listByTask("task_r6");
    expect(calls.filter((c) => c.toolName === "read_skill_resource" && c.outcome === "OK").length).toBe(2);
  });

  it("文本内容 ≤64KB：完整返回（truncated=false）；跨租户技能不可读", async () => {
    await t.repos.skills.insert(SKILL);
    const reader = new InMemorySkillResourceReader({ b_guide: "# 指南\n简短内容" });
    t.deps.engine.deps.skillResources = reader;
    const executor = t.deps.engine.makeExecutor("task_r6b", planner);
    const ok = await executor.run("read_skill_resource", { skillId: "skl_res", resourceName: "guide.md" });
    expect(ok.ok).toBe(true);
    const payload = ok.payload as { content: string; truncated: boolean; mime: string };
    expect(payload.truncated).toBe(false);
    expect(payload.content).toContain("简短内容");
    expect(payload.mime).toBe("text/markdown");

    const otherTenant = t.deps.engine.makeExecutor("task_r6c", { tenantId: "other", userId: "u", roles: ["planner"] });
    const denied = await otherTenant.run("read_skill_resource", { skillId: "skl_res", resourceName: "guide.md" });
    expect(denied.ok).toBe(false);
  });
});

describe("R10 · 工具并行执行（增量 §5）", () => {
  it("同轮 3 个 READ 并行（耗时 < 串行）；结果按 tool_use 原顺序回填；预算先计后发", async () => {
    await t.repos.agents.insert(agentDef({ id: "agt_par", key: "par_agent" }));
    let active = 0;
    let maxConcurrent = 0;
    t.dataCore.ontology.queryObjects = async (_ctx, _type, filter) => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise((r) => setTimeout(r, 100));
      active -= 1;
      return { data: { items: [{ echo: filter }] }, snapshotVersion: "snap" };
    };

    const u1 = toolUse("query_objects", { objectType: "Base", filter: { n: 1 } }) as { id: string; type: "tool_use"; name: string; input: unknown };
    const u2 = toolUse("query_objects", { objectType: "Base", filter: { n: 2 } }) as typeof u1;
    const u3 = toolUse("query_objects", { objectType: "Base", filter: { n: 3 } }) as typeof u1;
    const budget = new BudgetTracker();

    t.llm.queueAgentTurn({ content: [u1, u2, u3] }, (req) => {
      const last = req.messages[req.messages.length - 1];
      const results = (last?.content as { type: string; toolUseId: string }[]).filter((b) => b.type === "tool_result");
      // 结果按 tool_use 原顺序回填
      expect(results.map((r) => r.toolUseId)).toEqual([u1.id, u2.id, u3.id]);
      return {
        content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "并行完成。" }], provenance: [] })],
      };
    });

    const t0 = Date.now();
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r10a",
      agentId: "agt_par",
      version: "latest",
      prompt: "三路并查",
      ctx: planner,
      nesting: { callChain: [], budget },
      emit: async () => undefined,
    });
    const elapsed = Date.now() - t0;
    expect(result.outcome).toBe("ANSWERED");
    expect(maxConcurrent).toBeGreaterThanOrEqual(2); // 实际并行
    expect(elapsed).toBeLessThan(250); // 串行需 ≥300ms
    expect(budget.toolCalls).toBe(3); // 预算确定性：3 次 READ 全部计数
  });

  it("含 COMPUTE 的混合轮全部串行", async () => {
    await t.repos.agents.insert(
      agentDef({
        id: "agt_ser",
        key: "ser_agent",
        tools: [
          { kind: "BUILTIN", name: "query_objects" },
          { kind: "BUILTIN", name: "invoke_solver" },
        ],
        scopeDeclaration: { objectTypes: ["Base"], toolNames: ["query_objects", "invoke_solver"] },
      }),
    );
    let active = 0;
    let maxConcurrent = 0;
    const track = async <T>(fn: () => Promise<T>): Promise<T> => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise((r) => setTimeout(r, 40));
      const v = await fn();
      active -= 1;
      return v;
    };
    t.dataCore.ontology.queryObjects = async () => track(async () => ({ data: { items: [] }, snapshotVersion: "s" }));
    t.dataCore.solver.invoke = async () => track(async () => ({ data: { p50: 1 }, snapshotVersion: "s" }));

    t.llm.queueAgentTurn(
      {
        content: [
          toolUse("query_objects", { objectType: "Base", filter: {} }),
          toolUse("invoke_solver", { solverKey: "capacity_forecast", args: {} }),
          toolUse("query_objects", { objectType: "Base", filter: { x: 1 } }),
        ],
      },
      {
        content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "串行完成。" }], provenance: [] })],
      },
    );
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r10b",
      agentId: "agt_ser",
      version: "latest",
      prompt: "混合轮",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
    expect(maxConcurrent).toBe(1); // 完全串行（审计顺序与预算计数确定性）
  });
});
