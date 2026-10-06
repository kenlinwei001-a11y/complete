/**
 * WO-DSH-ARM-FAILURE-VISIBLE · 「工具失败对用户不可见」两半的接缝测试。
 *
 * ══ 被修的两件事（都是活服务实测逼出来的，不是推理）═════════════════════════════════════════
 *
 * **① 收尾支不可判** —— `reassembleDshRun` 的两条出口（`final_answer` 支 / 软收尾支）在记录上
 * **完全同形**（都是 blocks + provenance + unverifiedNumerics，软收尾不带任何标记）。
 * ⇒ 本单加 `closing` 判别位（`"FINAL_ANSWER"` / `"SOFT_CLOSE"`）。
 *
 * **② 失败不可点名** —— 实测（活服务 4002 · task_01M48KCQV09AGNSSKQY5WBJ3N6）8 次工具调用里
 * **4 次失败**（2 ERROR + 2 DENIED），而用户读到的答案对它们**只字未提**（只有一句笼统的
 * 「数据不全」）—— 用户既不知道失败的是哪次调用，也不知道撞的是哪道门。
 * ⇒ 本单在答案里补一块**可点名**的披露（工具名 + outcome + 门/原因原文）。
 *
 * ══ 同时钉住的一个真实断点（本单的 Q2，实测复现）══════════════════════════════════════════
 * 原生臂里 `mcp__solvers__{key}` **一次都执行不了**：`agent/loop.ts` 对 MCP 绑定工具传
 * `binding={kind:"MCP"}`，而 executor 的求解器归一 shim（`parseSolverMcpToolName`）只改
 * `toolName` **不改 binding** ⇒ 派发走进 `McpRuntime`（不是 `dataCore.solver.invoke`），
 * 平台内置 stdio server 默认禁用（`MCP_STDIO_ENABLED` 未设）⇒ **0-1ms ERROR、DataCore 零请求**。
 * 对照：`mcp__ontology__*` 的 shim **显式** `binding = {kind:"BUILTIN"}`，所以它同一批里是 OK 的。
 * （活服务实测：同为一次运行，`mcp__ontology__resolve_slice` OK 126ms，而 `mcp__solvers__*` 全 ERROR 0ms。）
 */
import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "@platform/contracts";
import { reassembleDshRun, type DshSessionEvent } from "../src/dsh-runtime/reassemble.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { seedMcpConfigs } from "../src/mocks/seed.js";
import { SOLVERS_MCP_CONFIG_ID } from "../src/mcp/solvers-catalog.js";
import { McpRuntime } from "../src/mcp/runtime.js";
import { sdkMcpConnectorFactory } from "../src/mcp/client.js";
import { Metrics } from "../src/metrics.js";
import { ScriptedLlmClient, toolUse } from "../src/llm/mock.js";
import { wireDeps } from "../src/deps.js";
import { loadConfig, stdioPolicyFromConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { TENANT } from "./helpers.js";

// ---------------------------------------------------------------------------
// 帧构造（形态照 dsh-reflect-parity.seam.test.ts / dsh-runtime-reassemble.test.ts，不另立第二套）
// ---------------------------------------------------------------------------
const toolCall = (callId: string, name: string, args: unknown): DshSessionEvent => ({
  type: "tool/call",
  data: { turn: 1, step: 1, callId, name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
/** `text` 缺省 = 成功回执；失败帧的 text 取**生产同形**（MCP 反向桥 / loop 镜像的两种文案）。 */
const toolResult = (toolCallId: string, isError: boolean, text = "ok"): DshSessionEvent => ({
  type: "tool/result",
  data: { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId, content: [{ type: "text", text }], isError }] } },
});
const turnEnd = (kind: string): DshSessionEvent => ({ type: "turn/end", data: { turn: 1, reason: { kind } } });
const finalAnswer = (markdown: string, provenance: unknown[] = []): DshSessionEvent =>
  toolCall("c_fa", "final_answer", { blocks: [{ type: "text", markdown }], provenance });

/** 生产同形的两条失败文案（一字不改）：
 *  · DENIED（scope 门）—— mcp-host-bridge.ts `DENIED_SCOPE_TEXT` / loop.ts:850 同一句；
 *  · ERROR（求解器调用）—— loop.ts:886 `JSON.stringify(payload)` 形态。 */
const DENIED_TEXT = "AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明";
const ERROR_TEXT = JSON.stringify({ error: "TOOL_ERROR", message: "stdio 启动被拒：stdio 传输默认禁用" });

describe("WO-DSH-ARM-FAILURE-VISIBLE · ① 收尾支可判 + 溯源口径（对照实验）", () => {
  it("① final_answer 支：provenance 声明落在范围内 ⇒ provenance.length>0 且 unverifiedNumerics=false", () => {
    const r = reassembleDshRun([
      toolCall("c1", "query_objects", { objectType: "Line" }),
      toolResult("c1", false, '{"data":[]}'),
      finalAnswer("在产线共 9 条⟦ref:0⟧。", [{ toolCallId: "c1", outputPath: "$" }]),
      turnEnd("completed"),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.provenance.length, "声明了一条 ⇒ 表里必须有一条").toBe(1);
    expect(r.answer.provenance[0]!.toolName, "toolName 从帧流 tool/call 回填").toBe("query_objects");
    expect(r.answer.unverifiedNumerics, "0/0 指得出 ⇒ 不亮诚实标").toBe(false);
  });

  it("② 同一夹具只把 ref 改成越界（⟦ref:99⟧）⇒ unverifiedNumerics=true（① 与 ② 必须同时成立）", () => {
    const r = reassembleDshRun([
      toolCall("c1", "query_objects", { objectType: "Line" }),
      toolResult("c1", false, '{"data":[]}'),
      finalAnswer("在产线共 9 条⟦ref:99⟧。", [{ toolCallId: "c1", outputPath: "$" }]),
      turnEnd("completed"),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.unverifiedNumerics, "99 落在 [0,1) 之外 ⇒ 该句不豁免").toBe(true);
  });

  it("③ 软收尾支：可判（closing=SOFT_CLOSE）+ provenance 恒空；final_answer 支可判为 FINAL_ANSWER", () => {
    const soft = reassembleDshRun([
      toolCall("c1", "query_objects", { objectType: "Line" }),
      toolResult("c1", false, '{"data":[]}'),
      turnEnd("completed"),
    ]);
    expect(soft.ok).toBe(true);
    if (!soft.ok) return;
    expect(soft.closing, "无 final_answer ⇒ 软收尾这件事必须可判").toBe("SOFT_CLOSE");
    expect(soft.answer.provenance).toEqual([]);

    const hard = reassembleDshRun([
      toolCall("c1", "query_objects", { objectType: "Line" }),
      toolResult("c1", false, '{"data":[]}'),
      finalAnswer("结论如下。", [{ toolCallId: "c1", outputPath: "$" }]),
      turnEnd("completed"),
    ]);
    expect(hard.ok).toBe(true);
    if (!hard.ok) return;
    expect(hard.closing, "final_answer 支必须与软收尾可区分").toBe("FINAL_ANSWER");
  });
});

describe("WO-DSH-ARM-FAILURE-VISIBLE · ④ 工具失败可点名（哪次调用 + 哪道门）", () => {
  const textOf = (r: ReturnType<typeof reassembleDshRun>): string =>
    r.ok ? r.answer.blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n") : "";

  const failedRun = (withFinalAnswer: boolean): DshSessionEvent[] => [
    toolCall("c1", "mcp__solvers__bottleneck_matrix", { baseIds: ["changzhou"] }),
    toolResult("c1", true, ERROR_TEXT),
    toolCall("c2", "query_objects", { objectType: "Line" }),
    toolResult("c2", false, '{"data":[]}'),
    toolCall("c3", "mcp__solvers__cockpit_kpi", { baseId: "changzhou" }),
    toolResult("c3", true, DENIED_TEXT),
    ...(withFinalAnswer
      ? [finalAnswer("常州基地产线共 9 条⟦ref:0⟧，数据不全。", [{ toolCallId: "c2", outputPath: "$" }])]
      : []),
    turnEnd("completed"),
  ];

  it("④a final_answer 支：答案里必须**指名**两个失败调用（工具名 + outcome + 门/原因原文）", () => {
    const r = reassembleDshRun(failedRun(true));
    const text = textOf(r);
    expect(text, "失败的工具名必须上屏（可点名）").toContain("mcp__solvers__bottleneck_matrix");
    expect(text, "必须指名另一条失败路径").toContain("mcp__solvers__cockpit_kpi");
    expect(text, "必须给出门/原因原文（scope 门文案逐字）").toContain("超出本 Agent 的能力声明");
    expect(text, "ERROR 的原因原文必须透出（不是「出错了」这种笼统话）").toContain("stdio 启动被拒");
  });

  it("④b 软收尾支：同一条判据（失败披露不只在 final_answer 支）", () => {
    const r = reassembleDshRun(failedRun(false));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.closing).toBe("SOFT_CLOSE");
    const text = textOf(r);
    expect(text).toContain("mcp__solvers__bottleneck_matrix");
    expect(text).toContain("mcp__solvers__cockpit_kpi");
  });

  it("④c 反向金丝雀：零失败的夹具**不许**长出披露块（否则它只是噪声，不是信号）", () => {
    const r = reassembleDshRun([
      toolCall("c1", "query_objects", { objectType: "Line" }),
      toolResult("c1", false, '{"data":[]}'),
      finalAnswer("常州基地产线共 9 条⟦ref:0⟧。", [{ toolCallId: "c1", outputPath: "$" }]),
      turnEnd("completed"),
    ]);
    const text = textOf(r);
    expect(text).not.toContain("失败");
  });
});

// ---------------------------------------------------------------------------
// Q2 复现：原生臂 `mcp__solvers__{key}` 的派发断点（真 wireDeps + 真 McpRuntime + 真 loop）
// ---------------------------------------------------------------------------

/** 与活服务 `agt_capacity_planner` 同形的求解器 agent（scope 两面都写，否则 scope 门先拒）。 */
function solverAgent(id: string): AgentDefinition {
  return {
    tenantId: TENANT,
    id,
    key: id,
    version: 1,
    name: id,
    description: "solver MCP dispatch seam agent",
    model: "claude-opus-4-8",
    systemPrompt: "你是测试 agent。",
    tools: [{ kind: "MCP", mcpConfigId: SOLVERS_MCP_CONFIG_ID, toolFilter: ["mcp__solvers__bottleneck_matrix"] }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [{ mcpConfigId: SOLVERS_MCP_CONFIG_ID }],
    scopeDeclaration: { objectTypes: [], toolNames: ["mcp__solvers__bottleneck_matrix"] },
    status: "PUBLISHED",
  };
}

describe("WO-DSH-ARM-FAILURE-VISIBLE · Q2 复现：原生臂求解器 MCP 工具必须真到 dataCore.solver.invoke", () => {
  it("归一后 binding 必须落 BUILTIN ⇒ 调用真到求解器（修前：0ms ERROR、DataCore 零请求）", async () => {
    const config = loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);
    const repos = createMemoryRepos();
    for (const c of seedMcpConfigs()) await repos.mcpConfigs.insert(c);
    const dataCore = createMockDataCore();
    const metrics = new Metrics();
    // 与 main.ts 同形的真运行时（stdio 策略取 config：MCP_STDIO_ENABLED 未设 ⇒ 禁用）。
    const mcp = new McpRuntime({
      repos,
      credentialKeyHex: config.CREDENTIAL_KEY,
      factory: sdkMcpConnectorFactory,
      metrics,
      stdioPolicy: stdioPolicyFromConfig(config),
    });
    const llm = new ScriptedLlmClient();
    const deps = wireDeps({ config, repos, llm, dataCore, mcp, metrics });
    const app = await buildServer(deps);
    await app.ready();

    /** 求解器实收（打桩计数：断点判据 = 「有没有走到求解器客户端」）。 */
    const seen: { key: string; args: Record<string, unknown> }[] = [];
    const realInvoke = dataCore.solver.invoke.bind(dataCore.solver);
    dataCore.solver.invoke = async (ctx, key, args, signal) => {
      seen.push({ key, args });
      return realInvoke(ctx, key, args, signal);
    };

    const taskId = "task_solver_mcp_dispatch";
    await repos.agents.insert(solverAgent("agt_solver_mcp"));
    llm.queueAgentTurn(() => ({ content: [toolUse("mcp__solvers__bottleneck_matrix", { baseIds: ["changzhou"] })] }));
    llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结论见求解器输出。" }], provenance: [] })],
    }));

    try {
      await deps.engine.runRegisteredAgent({
        taskId,
        agentId: "agt_solver_mcp",
        version: "latest",
        prompt: "常州基地瓶颈在哪道工序",
        ctx: { tenantId: TENANT, userId: "user-planner", roles: ["planner"] },
        nesting: { callChain: [], budget: new BudgetTracker({ maxRoundTrips: 24, maxIterations: 24 }) },
        emit: async () => undefined,
      });

      // 审计行里的**原始报文** —— 它就是「这次调用为什么没跑成」的唯一直接证据。
      const rows = (await repos.toolCalls.listByTask(taskId)).filter((c) => c.toolName === "invoke_solver");
      expect(rows.length, "求解器调用必须留下审计行").toBeGreaterThan(0);
      const raw = JSON.stringify(rows[0]!.output);
      expect(rows[0]!.outcome, `求解器调用结果（原始报文 ${raw}）`).toBe("OK");
      expect(seen.map((s) => s.key), "必须真到 dataCore.solver.invoke（走 MCP 运行时 = 断点）").toEqual(["bottleneck_matrix"]);
      expect(seen[0]!.args, "扁平入参口径逐键透传到求解器").toEqual({ baseIds: ["changzhou"] });
    } finally {
      await app.close();
    }
  });
});
