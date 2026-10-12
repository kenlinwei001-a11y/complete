/** 临时探针（WO-GRANT-MISMATCH · 取证用，最终形态待定）。 */
import { describe, expect, it } from "vitest";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { STUB_DCP_SPEC, startStubOpenAi, stubDirectory, stubProvider, type StubRound } from "./helpers-dsh-stub.js";
import { GENERAL_AGENT_ID, seedMcpConfigs, seedRegistry } from "../src/mocks/seed.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = `${REPO_ROOT}packages/dsh-harness`;
const SEAM_TIMEOUT = 90_000;
const CTX: ToolAuthCtx = { tenantId: TENANT, userId: "u", roles: ["planner"] };
const FAKE_LLM_KEY = "wo-grant-mismatch-fake-key-0000000000000000000";
const FINAL_ARGS = JSON.stringify({ blocks: [{ type: "text", markdown: "探针收尾。" }], provenance: [] });
const USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };

async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

function generalFromSeed(): AgentDefinition {
  const g = seedRegistry().agents.find((a) => a.id === GENERAL_AGENT_ID);
  if (!g) throw new Error("seedRegistry 里没有通用 agent");
  return { ...g, model: STUB_DCP_SPEC } as AgentDefinition;
}

async function seedWorld(t: TestApp, agent: AgentDefinition): Promise<void> {
  for (const m of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(m.id))) await t.repos.mcpConfigs.insert(m);
  for (const wf of seedRegistry().workflows) if (!(await t.repos.workflows.get(wf.id))) await t.repos.workflows.insert(wf);
  for (const sk of seedRegistry().skills) if (!(await t.repos.skills.get(sk.id))) await t.repos.skills.insert(sk);
  await t.repos.agents.insert(agent);
}

async function startApp(stubUrl: string): Promise<{ t: TestApp; close: () => Promise<void> }> {
  const port = await freePort();
  const t = await createTestApp({
    kernelRuntime: "dsh",
    providerDirectory: stubDirectory(stubProvider(stubUrl), FAKE_LLM_KEY) as never,
    env: { PORT: String(port) },
  });
  await t.app.listen({ port, host: "127.0.0.1" });
  return { t, close: () => t.app.close() };
}

function visibleTools(stub: { requests: { body: unknown }[] }): string[] {
  const tools = (stub.requests[0]?.body as { tools?: { function?: { name?: string } }[] } | undefined)?.tools ?? [];
  return tools.map((x) => x.function?.name ?? "").filter(Boolean);
}

function toolResultText(body: unknown, toolCallId: string): string {
  const msgs = (body as { messages?: unknown[] } | undefined)?.messages ?? [];
  for (const m of msgs) {
    const mm = m as { role?: string; tool_call_id?: string; content?: unknown };
    if (mm.role === "tool" && mm.tool_call_id === toolCallId) {
      return typeof mm.content === "string" ? mm.content : JSON.stringify(mm.content);
    }
  }
  return "";
}

describe("WO-GRANT-MISMATCH 探针", () => {
  it("B · 授予面/声明面/挂载面原始读数（buildSessionSetup 真跑）", async () => {
    const { buildSessionSetup } = await import("../src/dsh-runtime/setup-spec.js");
    const t = await createTestApp();
    try {
      for (const m of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(m.id))) await t.repos.mcpConfigs.insert(m);
      for (const wf of seedRegistry().workflows) if (!(await t.repos.workflows.get(wf.id))) await t.repos.workflows.insert(wf);
      const agent = generalFromSeed();
      const expanded = await t.deps.engine.expandAgentTools(agent);
      const builtinBindings = expanded.filter((x) => x.binding.kind === "BUILTIN").map((x) => x.name);
      const mcpServers = agent.mcpServers.map((ref) => {
        const cfg = seedMcpConfigs().find((c) => c.id === ref.mcpConfigId)!;
        const tr = agent.tools.find((x) => x.kind === "MCP" && x.mcpConfigId === ref.mcpConfigId);
        return {
          serverName: cfg.serverName ?? cfg.name,
          toolAllowlist:
            tr && tr.kind === "MCP" && tr.toolFilter !== undefined
              ? expanded.filter((x) => x.binding.kind === "MCP" && x.binding.mcpConfigId === ref.mcpConfigId).map((x) => x.name)
              : undefined,
        };
      });
      const spec = buildSessionSetup({
        agent,
        agentSystemCore: "CORE",
        grantedToolNames: expanded.map((x) => x.name),
        mcpServers: mcpServers as never,
        hostTools: expanded
          .filter((x) => x.binding.kind === "BUILTIN")
          .map((x) => ({ name: x.name, description: x.description, inputSchema: x.inputSchema })),
      });
      const allowBare = spec.tools!.map((x) => x.name).filter((n) => !n.startsWith("mcp__"));
      // eslint-disable-next-line no-console
      console.log(
        `\n[探针B] expanded=${expanded.length} · BUILTIN 绑定=${JSON.stringify(builtinBindings)}\n` +
          `[探针B] hostTools=${JSON.stringify(spec.hostTools?.map((h) => h.name))}\n` +
          `[探针B] 声明面裸名=${JSON.stringify(agent.scopeDeclaration.toolNames.filter((n) => !n.startsWith("mcp__")))}\n` +
          `[探针B] allow-list 裸名=${JSON.stringify(allowBare)} · 总长=${spec.tools!.length}\n` +
          `[探针B] allow-list 含 mcp__builtin__final_answer=${spec.tools!.some((x) => x.name === "mcp__builtin__final_answer")}` +
          ` · 含 mcp__builtin__evaluate_rules=${spec.tools!.some((x) => x.name === "mcp__builtin__evaluate_rules")}` +
          ` · 含 mcp__rules__evaluate_rules=${spec.tools!.some((x) => x.name === "mcp__rules__evaluate_rules")}\n` +
          `[探针B] mcpServers=${JSON.stringify(mcpServers.map((m) => ({ s: m.serverName, n: m.toolAllowlist?.length })))}\n` +
          `[探针B] builtin allowlist=${JSON.stringify(mcpServers.find((m) => m.serverName === "builtin")?.toolAllowlist)}\n`,
      );
      expect(spec.tools!.length).toBeGreaterThan(0);
    } finally {
      await t.app.close();
    }
  });

  it("A · 通用 agent 模型面 + mcp__builtin__final_answer 被拒原文", { timeout: SEAM_TIMEOUT }, async () => {
    const saved = { h: process.env.DSH_HARNESS, d: process.env.DSH_HARNESS_DIR };
    delete process.env.DSH_HARNESS;
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    const stub = await startStubOpenAi([
      { toolCall: { name: "mcp__builtin__final_answer", arguments: FINAL_ARGS }, usage: USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ARGS }, usage: USAGE },
      { text: "stub done", usage: USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startApp(`${stub.url}/v1`);
    try {
      await seedWorld(t, generalFromSeed());
      const result = await t.deps.engine.runRegisteredAgent({
        taskId: "task_probe_a",
        agentId: GENERAL_AGENT_ID,
        version: 1,
        prompt: "把能查的都翻一遍并给一个综合结论",
        ctx: CTX,
        nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", GENERAL_AGENT_ID),
        emit: async () => {},
      });
      const names = visibleTools(stub);
      const b0 = stub.requests[0]?.body as { messages?: { role?: string; content?: unknown }[]; tools?: { function?: { name?: string; description?: string } }[] } | undefined;
      const sys = (b0?.messages ?? []).map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n---\n");
      const fa = (b0?.tools ?? []).find((t) => t.function?.name === "final_answer");
      const er = (b0?.tools ?? []).find((t) => t.function?.name === "evaluate_rules");
      // eslint-disable-next-line no-console
      console.log(`\n[探针A-system] 前 3000 字：\n${sys.slice(0, 3000)}\n[探针A-system] **全文出现 mcp__builtin__ = ${(sys.match(/mcp__builtin__/g) ?? []).length} 次 · final_answer = ${(sys.match(/final_answer/g) ?? []).length} 次**\n[探针A-tool] final_answer 项：${JSON.stringify(fa?.function)}\n[探针A-tool] evaluate_rules 项：${JSON.stringify(er?.function)}\n`);
      console.log(
        `\n[探针A] 模型面 ${names.length} 件：\n${names.join("\n")}\n` +
          `\n[探针A] 含 mcp__builtin__final_answer = ${names.includes("mcp__builtin__final_answer")}` +
          ` · 含 mcp__builtin__evaluate_rules = ${names.includes("mcp__builtin__evaluate_rules")}` +
          ` · 含裸 final_answer = ${names.includes("final_answer")}` +
          ` · 含裸 evaluate_rules = ${names.includes("evaluate_rules")}\n` +
          `\n[探针A] call_1 回执：${toolResultText(stub.requests[1]?.body, "call_1")}\n` +
          `\n[探针A] call_2 回执：${toolResultText(stub.requests[2]?.body, "call_2")}\n` +
          `\n[探针A] outcome=${result.outcome} kernel=${result.run.kernel} blocks=${JSON.stringify(result.answer?.blocks)}\n`,
      );
      expect(result.run.kernel).toBe("EXTERNAL");
    } finally {
      await close();
      await stub.close();
      if (saved.h === undefined) delete process.env.DSH_HARNESS;
      else process.env.DSH_HARNESS = saved.h;
      if (saved.d === undefined) delete process.env.DSH_HARNESS_DIR;
      else process.env.DSH_HARNESS_DIR = saved.d;
    }
  });
});
