/**
 * WO-DSH-RESOURCE-REACH · 本体/切片**落到 DSH 原生 MCP 模式**，并在 ReAct 链上真可达
 * （驾驶接缝的组合测试 —— 数据+引擎两半、A+B 两系统各拆开做的部分在这里合流）。
 *
 * 仓主 2026-10-05 令：每一类资源都要落到 DSH 的三种原生模式之一（plugin / MCP / skill），
 * 而不是靠我方逐 run 推的数据。**判据不是「多了一条能调通的路」，而是「DSH 自己知道有这个资源」**
 * （可配置、可发现、走原生连接与命名空间隔离）。
 *
 * **今天的行为是 X**（改造前）：切片只能靠 `agent.tools` 里的 BUILTIN 授予 + 反向工具通道下发
 * —— DSH 侧看不到任何 MCP server、页面上配不了、没有 `mcp__ontology__` 命名空间。
 * **应该是 Y**（本单）：`agt_capacity_planner` 挂一个 MCP ref + `mcpServers` 行；
 * DSH 的 `dsh-mcp-client` 真 spawn 平台自有的 stdio MCP server（`mcp__ontology__{raw}`），
 * 模型真调、真回到**同一只** GuardedToolExecutor；且**切片只有这一条路**（反向工具面里没有它）。
 *
 * 分组：
 *   A = 授予面契约（seed → expandAgentTools → setup 映射；纯映射，不开子进程）
 *   B = e2e（freePort 真 listen + stub LLM + per-agent kernel=EXTERNAL，真 fork harness
 *       + 真 spawn MCP server 子进程 + 真 HTTP 回环；agent 取自 `seedRegistry()` 出厂定义）
 *   C = 两内核一致（同一 query 同剧本，NATIVE 臂 vs EXTERNAL 臂，逐条比）
 *   D = 变异/对照（把 MCP 授予拿掉 ⇒ 红；把 MCP server 入口移走 ⇒ 红）
 */
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpServerNameSlug, type AgentDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import {
  STUB_DCP_SPEC,
  startStubOpenAi,
  stubDirectory,
  stubProvider,
  type StubRound,
} from "./helpers-dsh-stub.js";
import { seedRegistry, seedMcpConfigs } from "../src/mocks/seed.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";
import { buildSessionSetup } from "../src/dsh-runtime/setup-spec.js";
import { buildOntologyMcpTools, ONTOLOGY_MCP_DESC_PREFIX } from "../src/tools/ontology-mcp.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = join(REPO_ROOT, "packages/dsh-harness");

const SEAM_TIMEOUT = 90_000;
const CTX: ToolAuthCtx = { tenantId: TENANT, userId: "u", roles: ["planner"] };
const ENV_KEYS = [
  "DSH_HARNESS",
  "DSH_HARNESS_DIR",
  "QOS_AGENT_LOOP_REPEAT_CAP",
  "DSH_TOOL_EXEC_TIMEOUT_MS",
  "DSH_TOOL_EXEC_FETCH_TIMEOUT_MS",
] as const;

const FAKE_LLM_KEY = "wo-resource-reach-fake-llm-key-000000000000000";
const SERVICE_TOKEN = "wo-resource-reach-service-token-000000000";

const PLAIN_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };
const FINAL_ANSWER_ARGS = JSON.stringify({
  blocks: [{ type: "text", markdown: "切片已消费，结论见下。" }],
  provenance: [],
});

/** 出厂 agent id（本单的被测对象就是它的授予面）。 */
const SEED_AGENT_ID = "agt_capacity_planner";
/** 出厂 workflow（种子 agent 已带，端到端没人验过的那条）。 */
const SEED_WF_TOOL = "workflow_capacity_check";
/** 平台内置本体 MCP server 的配置行 id + 命名空间。 */
const ONTOLOGY_MCP_CONFIG_ID = "mcp_builtin_ontology";
const ONTOLOGY_SERVER_NAME = "ontology";
/** 模型可见面全名（增量 §4.2：MCP 工具一律全名，scopeDeclaration/审计同口径）。 */
const SLICE_PLAN_MCP = "mcp__ontology__plan_slice";
const SLICE_RESOLVE_MCP = "mcp__ontology__resolve_slice";
/** 裸名（MCP wire 上的 tools/call 名）——**不该**出现在模型可见面上（会出现 = 双前缀 / 漏前缀）。 */
const SLICE_PLAN_RAW = "plan_slice";
const SLICE_RESOLVE_RAW = "resolve_slice";
/** 明确**不在**授予集内：用于 fail-closed 对照。 */
const OUT_OF_SCOPE_TOOL = "create_action_draft";
/** harness 子进程真去 spawn 的 MCP server 入口（与 engine.ts resolveOntologyMcpServerPath 同址）。 */
const ONTOLOGY_SERVER_ENTRY = join(REPO_ROOT, "apps/agentcore/dist/dsh-runtime/ontology-mcp-server.js");

const PLAN_ARGS = JSON.stringify({
  rootType: "Order",
  targets: ["Base", "Line", "Model"],
  question: "型号需求增量可不可行",
});
const RESOLVE_ARGS = JSON.stringify({ sliceKey: "biz.Order.Base_Line_Model", args: {} });
const RESOLVE_ARGS_NATIVE = JSON.stringify({ sliceKey: "biz.Order.Base", args: {} });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

interface Emitted {
  event: string;
  payload: unknown;
}

/** 出厂 agent 原样取出，只覆写内核选择与模型（其余 tools/scopeDeclaration/systemPrompt 全是出厂值）。 */
function seedCapacityAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  const { agents } = seedRegistry();
  const base = agents.find((a) => a.id === SEED_AGENT_ID);
  if (!base) throw new Error(`seed agent not found: ${SEED_AGENT_ID}`);
  return { ...base, model: STUB_DCP_SPEC, kernel: "EXTERNAL", ...overrides } as AgentDefinition;
}

/**
 * 授予面剥离形态（变异反证用）：把本体 MCP 这条路**整条**拿掉 ——
 * `tools` 里的 MCP ref、`mcpServers` 挂载行、`scopeDeclaration` 全名三面同时撤。
 * 三面缺一都还能看出残缺（例如只撤 tools 而不撤 mcpServers ⇒ server 仍被 spawn）。
 */
function withoutOntologyMcp(agent: AgentDefinition): AgentDefinition {
  return {
    ...agent,
    tools: agent.tools.filter((t) => !(t.kind === "MCP" && t.mcpConfigId === ONTOLOGY_MCP_CONFIG_ID)),
    mcpServers: agent.mcpServers.filter((m) => m.mcpConfigId !== ONTOLOGY_MCP_CONFIG_ID),
    scopeDeclaration: {
      ...agent.scopeDeclaration,
      toolNames: agent.scopeDeclaration.toolNames.filter((n) => !n.startsWith(`mcp__${ONTOLOGY_SERVER_NAME}__`)),
    },
  } as AgentDefinition;
}

async function seedWorld(t: TestApp, agent: AgentDefinition): Promise<void> {
  for (const m of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(m.id))) await t.repos.mcpConfigs.insert(m);
  for (const wf of seedRegistry().workflows) if (!(await t.repos.workflows.get(wf.id))) await t.repos.workflows.insert(wf);
  for (const sk of seedRegistry().skills) if (!(await t.repos.skills.get(sk.id))) await t.repos.skills.insert(sk);
  await t.repos.agents.insert(agent);
}

async function startToolExecApp(opts: {
  stubUrl: string;
  serviceToken?: string;
}): Promise<{ t: TestApp; close: () => Promise<void> }> {
  const port = await freePort();
  const t = await createTestApp({
    providerDirectory: stubDirectory(stubProvider(opts.stubUrl), FAKE_LLM_KEY) as never,
    env: {
      PORT: String(port),
      ...(opts.serviceToken ? { SERVICE_TOKEN: opts.serviceToken } : {}),
    },
  });
  await t.app.listen({ port, host: "127.0.0.1" });
  return { t, close: () => t.app.close() };
}

async function runAgent(
  t: TestApp,
  taskId: string,
  emitted: Emitted[],
  agentId: string,
): Promise<Awaited<ReturnType<TestApp["deps"]["engine"]["runRegisteredAgent"]>>> {
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId,
    version: 1,
    prompt: "型号需求增量可不可行？请用切片取证后收尾。",
    ctx: CTX,
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
    emit: async (event, payload) => {
      emitted.push({ event, payload });
    },
  });
}

/** DSH 臂模型面看到的工具（stub 首轮请求体 tools[].function.{name,description}）。 */
function stubVisibleTools(stub: { requests: { body: unknown }[] }): { name: string; description: string }[] {
  const tools = (stub.requests[0]?.body as { tools?: { function?: { name?: string; description?: string } }[] } | undefined)?.tools ?? [];
  return tools
    .map((x) => ({ name: x.function?.name ?? "", description: x.function?.description ?? "" }))
    .filter((x) => x.name);
}

/** NATIVE 臂模型面看到的工具（ScriptedLlmClient 收到的 LlmAgentRequest.tools）。 */
function nativeVisibleTools(t: TestApp): { name: string; description: string }[] {
  return (t.llm.agentRequests[0]?.tools ?? []).map((x) => ({ name: x.name, description: x.description }));
}

/** 从 OpenAI 线格式请求体里取某次工具调用的回执原文（= 模型实际看到的字节）。 */
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

/**
 * seed 授予面 → engine 真装配（`expandAgentTools` 真跑，不是手抄名字）→ `buildSessionSetup`。
 * hostTools / hostWorkflowTools / mcpServers 三路与 engine.ts 分叉处逐字同形。
 */
async function setupFromSeedAgent(agent: AgentDefinition) {
  const t = await createTestApp();
  try {
    for (const m of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(m.id))) await t.repos.mcpConfigs.insert(m);
    for (const wf of seedRegistry().workflows) if (!(await t.repos.workflows.get(wf.id))) await t.repos.workflows.insert(wf);
    const tools = await t.deps.engine.expandAgentTools(agent);
    // mcpServers 映射：与 engine.ts DSH 分叉同构（serverName 从配置行取 + toolAllowlist = expanded 收窄）。
    // ⚠ 注意本助手**不**复刻 engine 的运行期注入（command/args/env：绝对路径 + per-run runToken），
    // 那一段只在真分叉里兑现，由 B 组 e2e 驱动真身 —— 静态映射只验「有哪些 server / 收窄到哪些工具」。
    const mcpServers: { serverName: string; toolAllowlist?: string[] }[] = [];
    for (const ref of agent.mcpServers) {
      const cfg = await t.repos.mcpConfigs.get(ref.mcpConfigId);
      if (!cfg) continue;
      const serverName = cfg.serverName ?? mcpServerNameSlug(cfg.name);
      const ref0 = agent.tools.find((tr) => tr.kind === "MCP" && tr.mcpConfigId === ref.mcpConfigId);
      mcpServers.push({
        serverName,
        ...(ref0 && ref0.kind === "MCP" && ref0.toolFilter !== undefined
          ? {
              toolAllowlist: tools
                .filter((x) => x.binding.kind === "MCP" && x.binding.mcpConfigId === ref.mcpConfigId)
                .map((x) => x.name),
            }
          : {}),
      });
    }
    const spec = buildSessionSetup({
      agent,
      agentSystemCore: "CORE",
      grantedToolNames: tools.map((x) => x.name),
      ...(mcpServers.length ? { mcpServers: mcpServers as never } : {}),
      hostTools: tools
        .filter((x) => x.binding.kind === "BUILTIN")
        .map((x) => ({ name: x.name, description: x.description, inputSchema: x.inputSchema })),
      hostWorkflowTools: tools
        .filter((x) => x.binding.kind === "WORKFLOW")
        .map((x) => ({ name: x.name, description: x.description, inputSchema: x.inputSchema })),
    });
    return { spec, expanded: tools };
  } finally {
    await t.app.close();
  }
}

// ---------------------------------------------------------------------------

describe("RESOURCE-REACH · A 授予面契约（seed → expandAgentTools → setup 映射）", () => {
  it("A1 出厂 agt_capacity_planner **以 MCP 模式**获得切片：工具面/声明面/mcpServers 三面同步，且反向工具面里没有它", async () => {
    const agent = seedCapacityAgent();
    // ① seed 侧：MCP ref（不是 BUILTIN 授予）
    const mcpRefs = agent.tools.filter((t) => t.kind === "MCP");
    expect(mcpRefs.map((r) => (r.kind === "MCP" ? r.mcpConfigId : "")), "工具面 MCP ref").toEqual([
      ONTOLOGY_MCP_CONFIG_ID,
    ]);
    expect(
      agent.tools.filter((t) => t.kind === "BUILTIN").map((t) => (t.kind === "BUILTIN" ? t.name : "")),
      "BUILTIN 授予面不再含切片（收敛：不许两条路并存）",
    ).not.toContain(SLICE_PLAN_RAW);
    // ② 声明面按契约惯例记**全名**
    expect(agent.scopeDeclaration.toolNames, "声明面全名").toContain(SLICE_PLAN_MCP);
    expect(agent.scopeDeclaration.toolNames, "声明面全名").toContain(SLICE_RESOLVE_MCP);
    expect(agent.scopeDeclaration.toolNames, "声明面不再记裸名").not.toContain(SLICE_PLAN_RAW);
    // ③ DSH 挂载面：mcpServers 行在（这是「DSH 自己知道有这个 server」的登记点）
    expect(agent.mcpServers.map((m) => m.mcpConfigId), "DSH mcpServers 挂载面").toEqual([ONTOLOGY_MCP_CONFIG_ID]);
    // ④ 配置行真在册（缺它 ⇒ expandAgentTools 的 `if (!config) continue` 静默零工具）
    const row = seedMcpConfigs().find((m) => m.id === ONTOLOGY_MCP_CONFIG_ID);
    expect(row, `seedMcpConfigs 里必须有 ${ONTOLOGY_MCP_CONFIG_ID}`).toBeDefined();
    expect(row!.serverName, "命名空间（进 mcp__<server>__ 前缀）").toBe(ONTOLOGY_SERVER_NAME);
    expect(row!.transport.type, "stdio = DSH 侧真 spawn 子进程的那种").toBe("stdio");

    // ⑤ setup 层兑现：走 engine 的真装配（expandAgentTools），不手抄工具名
    const { spec, expanded } = await setupFromSeedAgent(agent);
    const expandedNames = expanded.map((x) => x.name);
    expect(expandedNames, "授予面展开（engine 真跑）").toContain(SLICE_PLAN_MCP);
    expect(expandedNames).toContain(SLICE_RESOLVE_MCP);
    expect(expandedNames, "裸名不许出现在模型可见面（会与全名撞成两条）").not.toContain(SLICE_PLAN_RAW);
    const allow = (spec.tools ?? []).map((x) => x.name);
    expect(allow, "harness 侧允许表").toContain(SLICE_PLAN_MCP);
    expect(allow, "harness 侧允许表").toContain(SLICE_RESOLVE_MCP);
    // ⑥ **单路证明（结构面）**：切片不进 hostTools —— 反向工具面里没有它 ⇒ 不可能与 MCP 面并存。
    const hostNames = (spec.hostTools ?? []).map((x) => x.name);
    expect(hostNames, "反向工具面不许有切片（有 = 两条路）").not.toContain(SLICE_PLAN_MCP);
    expect(hostNames).not.toContain(SLICE_RESOLVE_MCP);
    expect(hostNames).not.toContain(SLICE_PLAN_RAW);
    // ⑦ MCP 面：真 server spec + toolAllowlist 收窄到两件
    expect(spec.mcpServers?.map((m) => m.serverName), "DSH 侧 MCP server 面").toEqual([ONTOLOGY_SERVER_NAME]);
    expect(spec.mcpServers?.[0]?.toolAllowlist, "MCP wire 侧允许表").toEqual([SLICE_PLAN_MCP, SLICE_RESOLVE_MCP]);
    // ⑧ 描述文本与 MCP server 广告的逐字同源（两内核模型面不许各写一份前缀）
    const advertised = buildOntologyMcpTools();
    const planSpec = expanded.find((x) => x.name === SLICE_PLAN_MCP)!;
    expect(planSpec.description, "静态投影 = MCP server 广告描述").toBe(
      advertised.find((x) => x.name === SLICE_PLAN_MCP)!.description,
    );
    expect(planSpec.description.startsWith(ONTOLOGY_MCP_DESC_PREFIX)).toBe(true);
    // ⑨ 交付②的可见性前提：出厂 WORKFLOW 授予走 **hostWorkflowTools**（另一个键，各不串台）
    expect((spec.hostWorkflowTools ?? []).map((x) => x.name), "workflow 下发面").toContain(SEED_WF_TOOL);
    expect(hostNames, "BUILTIN 面不串入 workflow").not.toContain(SEED_WF_TOOL);
    // ⑩ 金丝雀：整表没空掉 —— 其余出厂授予仍在（否则上面所有 not.toContain 对空实现恒真）
    expect(hostNames).toContain("query_objects");
    expect(allow).toContain("query_objects");
  });

  it("A2 对照（把 MCP 授予拿掉）：展开面 / 允许表 / mcpServers **三面一起**收缩——这是 D1 变异能红的前提", async () => {
    const stripped = withoutOntologyMcp(seedCapacityAgent());
    const { spec, expanded } = await setupFromSeedAgent(stripped);
    const expandedNames = expanded.map((x) => x.name);
    expect(expandedNames).not.toContain(SLICE_PLAN_MCP);
    expect(expandedNames).not.toContain(SLICE_RESOLVE_MCP);
    expect((spec.tools ?? []).map((x) => x.name)).not.toContain(SLICE_PLAN_MCP);
    expect(spec.hostTools ?? [], "反向工具面本来就没有它").toEqual(
      (spec.hostTools ?? []).filter((x) => x.name !== SLICE_PLAN_MCP),
    );
    expect(spec.mcpServers, "server 面也撤（不许「ref 撤了 server 还在」的残缺态）").toBeUndefined();
    // 金丝雀：对照不是「整表空掉」——同批其余授予仍在
    expect((spec.hostTools ?? []).map((x) => x.name)).toContain("query_objects");
  });
});

describe("RESOURCE-REACH · B e2e：DSH 臂经 MCP 真调切片（真 fork + 真 MCP 子进程 + 真 HTTP 回环）", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS;
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    delete process.env.QOS_AGENT_LOOP_REPEAT_CAP;
    delete process.env.DSH_TOOL_EXEC_TIMEOUT_MS;
    delete process.env.DSH_TOOL_EXEC_FETCH_TIMEOUT_MS;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("B1 MCP 模式端到端：模型真调 mcp__ontology__* ∧ 切片数据真回模型面 ∧ 同源 executor", { timeout: SEAM_TIMEOUT }, async () => {
    // 剧本：先动态规划切片，再**用规划产出的 sliceKey** 解析它（两件互为上下游），最后收尾。
    const stub = await startStubOpenAi([
      { toolCall: { name: SLICE_PLAN_MCP, arguments: PLAN_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: SLICE_RESOLVE_MCP, arguments: RESOLVE_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, seedCapacityAgent());
      const planSpy = vi.spyOn(t.dataCore.ontology, "planSlice");
      const resolveSpy = vi.spyOn(t.dataCore.ontology, "resolveSlice");
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_reach_b1", emitted, SEED_AGENT_ID);

      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");

      // ① 模型可见面：全名 + 描述逐字 = MCP server 广告的（说明这一面是 MCP 客户端注册出来的）
      const visible = stubVisibleTools(stub);
      const names = visible.map((x) => x.name);
      expect(names, "模型可见工具面").toContain(SLICE_PLAN_MCP);
      expect(names, "模型可见工具面").toContain(SLICE_RESOLVE_MCP);
      const advertised = buildOntologyMcpTools();
      for (const t2 of advertised) {
        expect(visible.find((x) => x.name === t2.name)?.description, `${t2.name} 描述逐字 = MCP 广告文本`).toBe(
          t2.description,
        );
      }
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── B1 DSH 模型面（首轮）──\n` +
          visible.map((x) => `  ${x.name} :: ${x.description.slice(0, 60)}`).join("\n") +
          `\n`,
      );

      // ② 真调用：宿主执行体被真打到，且 args 逐字 = 模型给的
      expect(planSpy.mock.calls.length, "planSlice 真调一次").toBe(1);
      const planReq = planSpy.mock.calls[0]![1] as { rootType: string; targets: string[] };
      expect(planReq.rootType).toBe("Order");
      expect(planReq.targets).toEqual(["Base", "Line", "Model"]);

      // ③ 数据流真通：resolve 吃的 sliceKey = plan 产出的那个（模型没瞎编）
      expect(resolveSpy.mock.calls.length, "resolveSlice 真调一次").toBe(1);
      expect(resolveSpy.mock.calls[0]![1], "sliceKey 必须来自 plan_slice 的返回值").toBe("biz.Order.Base_Line_Model");

      // ④ 两件都过宿主同一 GuardedToolExecutor ⇒ 各落一行 tc_ 审计（outcome OK）
      //    审计名归一到裸名（executor 的 shim；与 solvers 先例同口径），不是全名。
      const rows = await t.repos.toolCalls.listByTask("task_reach_b1");
      const planRow = rows.find((r) => r.toolName === SLICE_PLAN_RAW);
      const resolveRow = rows.find((r) => r.toolName === SLICE_RESOLVE_RAW);
      expect(planRow?.outcome, "plan_slice 审计行").toBe("OK");
      expect(resolveRow?.outcome, "resolve_slice 审计行").toBe("OK");
      expect(planRow!.id).toMatch(/^tc_/);
      expect(resolveRow!.id).toMatch(/^tc_/);
      // 金丝雀：审计面**没有**全名行（有 = 两条路都执行过）
      expect(rows.find((r) => r.toolName === SLICE_PLAN_MCP), "审计面不许有全名行").toBeUndefined();

      // ⑤ 切片数据真回模型面：下一轮请求体里逐字可见 <tool_data tool_call_id="tc_…">＋切片节点
      const second = JSON.stringify(stub.requests[1]!.body);
      expect(second, "plan 回执上模型面").toContain(`<tool_data tool_call_id=\\"${planRow!.id}\\">`);
      expect(second).toContain("biz.Order.Base_Line_Model");
      const third = JSON.stringify(stub.requests[2]!.body);
      expect(third, "resolve 回执上模型面").toContain(`<tool_data tool_call_id=\\"${resolveRow!.id}\\">`);
      // mock 侧 biz.* 切片的节点 id 形如 Order_to_Base（切片数据真的回灌进上下文）
      expect(third, "切片节点数据真回灌").toContain("Order_to_Base");
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── B1 回执对（模型面原文，各截 260 字）──\n` +
          `  ① ${SLICE_PLAN_MCP} → ${toolResultText(stub.requests[1]?.body, "call_1").replace(/\s+/g, " ").slice(0, 260)}\n` +
          `  ② ${SLICE_RESOLVE_MCP} → ${toolResultText(stub.requests[2]?.body, "call_2").replace(/\s+/g, " ").slice(0, 260)}\n` +
          `  审计行=${JSON.stringify(rows.map((r) => `${r.toolName}/${r.outcome}`))}\n`,
      );

      // ⑥ 两内核同源（工具名面）：iterations 里记的是**模型面全名**，与原生臂
      //    loop.ts:918-924（`toolName: block.name` = mcp__ontology__*）逐字同形 —— 不是审计面裸名。
      const iterCalls = result.run.iterations.flatMap((it) => it.toolCalls);
      // eslint-disable-next-line no-console
      console.log(`\n  ── B1 iterations.toolCalls 原文 ──\n  ${JSON.stringify(iterCalls)}\n`);
      expect(iterCalls.map((c) => c.toolName), "iterations 工具名 = 模型面全名").toEqual(
        expect.arrayContaining([SLICE_PLAN_MCP, SLICE_RESOLVE_MCP]),
      );
      // 差异 [B1-D1]（**登记，不是缺陷**）：MCP 路的 iterations.toolCallId 是 **DSH 帧 id**，
      // 不是宿主审计行主键 tc_。结构性原因：MCP wire 不携带 DSH 帧 callId（mcp-client-tenant 的
      // callTool 由 SDK 自铸 JSON-RPC id），W9-full 侧表（reassemble.ts hostToolCalls.get(call.callId)）
      // 必然 miss ⇒ 反向工具那条「帧 callId 直通」的关联在 MCP 路上结构上不存在。
      // ⚠ **模型面不受影响**：包络里的 tool_call_id 取宿主回执的 r.toolCallId（tc_…），
      // 与原生臂逐字同（断言⑤已咬）。本断言**钉死**该差异，漂了就红。
      const planIter = iterCalls.find((c) => c.toolName === SLICE_PLAN_MCP);
      expect(planIter?.toolCallId, "[B1-D1] 非宿主审计行主键").not.toBe(planRow!.id);
      expect(planIter?.toolCallId, "[B1-D1] 帧 id 非空").toBeTruthy();
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B2 MCP 真身（结构面，不依赖模型）：MCP server 入口不在 ⇒ DSH 面**拿不到**切片，调用 fail-closed", { timeout: SEAM_TIMEOUT }, async () => {
    // ⛔ 本用例按「cp 备份 + 改名 + 还原」处置（禁用 git checkout 还原未提交实现）——
    //    动的是**构建产物**入口文件，不是源码；还原后比 sha256 自证干净。
    expect(existsSync(ONTOLOGY_SERVER_ENTRY), `MCP server 入口必须存在：${ONTOLOGY_SERVER_ENTRY}`).toBe(true);
    const before = createHash("sha256").update(readFileSync(ONTOLOGY_SERVER_ENTRY)).digest("hex");
    const parked = `${ONTOLOGY_SERVER_ENTRY}.parked-by-seam-test`;
    let restored = false;

    const stub = await startStubOpenAi([
      { toolCall: { name: SLICE_PLAN_MCP, arguments: PLAN_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, seedCapacityAgent());
      renameSync(ONTOLOGY_SERVER_ENTRY, parked);
      const planSpy = vi.spyOn(t.dataCore.ontology, "planSlice");
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_reach_b2mcp", emitted, SEED_AGENT_ID);

      // ① 席位仍在（harness 侧不是整场没起来）——金丝雀，否则「不可见」可能只是「没跑」
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");
      // ② DSH 面拿不到切片：MCP 客户端连不上 ⇒ 这些工具**从未被注册**（不是注册了再拒）
      const names = stubVisibleTools(stub).map((x) => x.name);
      expect(names, "MCP server 不在 ⇒ 切片不可见").not.toContain(SLICE_PLAN_MCP);
      expect(names, "MCP server 不在 ⇒ 切片不可见").not.toContain(SLICE_RESOLVE_MCP);
      // ③ 执行体零调用 + 零审计行（fail-closed，绝不静默成功）
      expect(planSpy.mock.calls.length, "宿主执行体零调用").toBe(0);
      const rows = await t.repos.toolCalls.listByTask("task_reach_b2mcp");
      expect(rows.find((r) => r.toolName === SLICE_PLAN_RAW), "宿主零审计行").toBeUndefined();
      // ④ 幻觉调用拿到明确失败（不是静默 OK）
      const receipt = toolResultText(stub.requests[1]?.body, "call_1");
      expect(receipt, "必须真回了 tool_result（静默 = 没有回执）").not.toBe("");
      expect(receipt, "不许是成功载荷").not.toMatch(/<tool_data tool_call_id="tc_/);
      expect(receipt, "必须是明确失败文案").toMatch(/not found|not in agent scope|unknown|Error|无权|不存在|invalid/i);
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── B2 MCP server 入口移走后：模型面工具数=${names.length}（含切片=${names.some((n) => n.includes("ontology"))}）\n` +
          `  ── 回执原文 ──\n  ${receipt.slice(0, 400)}\n`,
      );
    } finally {
      if (existsSync(parked) && !existsSync(ONTOLOGY_SERVER_ENTRY)) renameSync(parked, ONTOLOGY_SERVER_ENTRY);
      restored = existsSync(ONTOLOGY_SERVER_ENTRY);
      await close();
      await stub.close();
    }
    // 还原自证：sha256 与移动前逐字节同
    expect(restored, "入口文件必须还原").toBe(true);
    expect(createHash("sha256").update(readFileSync(ONTOLOGY_SERVER_ENTRY)).digest("hex"), "还原后 sha256").toBe(before);
  });

  it("B3 workflow 端到端（交付②）：同一条工作流，超限输入被治理闸挡下 / 合规输入真跑通", { timeout: SEAM_TIMEOUT }, async () => {
    // 一个剧本打两次同一个工作流工具，只有入参不同 —— 收成一对对照读数：
    //   ① demandDelta=100 ⇒ 规则 C03（BLOCK）在 tools/pre-execute 挡下，宿主零执行
    //   ② demandDelta=0.2 ⇒ 真跑到 s4 render_answer，产物回模型面，端点落审计行
    const stub = await startStubOpenAi([
      { toolCall: { name: SEED_WF_TOOL, arguments: JSON.stringify({ model: "4680-NCM", demandDelta: 100, weeks: 4 }) }, usage: PLAIN_USAGE },
      { toolCall: { name: SEED_WF_TOOL, arguments: JSON.stringify({ model: "4680-NCM", demandDelta: 0.2, weeks: 4 }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, seedCapacityAgent());
      const qo = vi.spyOn(t.dataCore.ontology, "queryObjects");
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_reach_b3wf", emitted, SEED_AGENT_ID);

      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      expect(stubVisibleTools(stub).map((x) => x.name), "模型可见工具面").toContain(SEED_WF_TOOL);

      const receipt1 = toolResultText(stub.requests[1]?.body, "call_1");
      const receipt2 = toolResultText(stub.requests[2]?.body, "call_2");
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── B3 对照对（同工具、仅入参不同）──\n` +
          `  ① demandDelta=100 回执：${receipt1.slice(0, 300)}\n` +
          `  ② demandDelta=0.2  回执：${receipt2.slice(0, 300)}\n` +
          `  审计行=${JSON.stringify((await t.repos.toolCalls.listByTask("task_reach_b3wf")).map((r) => `${r.toolName}/${r.outcome}`))}\n`,
      );
      expect(receipt1, "① 必须带规则号 C03").toMatch(/C03/);
      expect(receipt1, "① 不许是成功载荷").not.toMatch(/tool_data/);
      expect(receipt2, "② workflow 产物上模型面").toContain("产能校核结论");
      expect(receipt2, "② 是成功包络").toMatch(/tool_data/);
      const qoTypes = qo.mock.calls.map((c) => c[1] as string);
      expect(qoTypes, "workflow s1 步真执行（Model 真被查过）").toContain("Model");
      const rows = await t.repos.toolCalls.listByTask("task_reach_b3wf");
      const wfRows = rows.filter((r) => r.toolName === SEED_WF_TOOL);
      expect(wfRows.length, "恰好一行 = 只有 ② 过 wire").toBe(1);
      expect(wfRows[0]!.outcome).toBe("OK");
      expect(wfRows[0]!.id).toMatch(/^tc_/);
      const iterCalls = result.run.iterations.flatMap((it) => it.toolCalls).filter((c) => c.toolName === SEED_WF_TOOL);
      expect(iterCalls.map((c) => c.outcome), "两次调用的结局").toEqual(["ERROR", "OK"]);
      expect(iterCalls[1]!.toolCallId, "OK 那次对上端点审计行").toBe(wfRows[0]!.id);
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B4 fail-closed：请求**不在授予集内**的工具 ⇒ 明确拒绝 ∧ 宿主零执行（不静默放行）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: OUT_OF_SCOPE_TOOL, arguments: JSON.stringify({ title: "越权草稿" }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, seedCapacityAgent());
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_reach_b4", emitted, SEED_AGENT_ID);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED"); // 拒绝不炸循环（与 native 同口径）
      const names = stubVisibleTools(stub).map((x) => x.name);
      expect(names).not.toContain(OUT_OF_SCOPE_TOOL);
      const receipt = toolResultText(stub.requests[1]?.body, "call_1");
      // eslint-disable-next-line no-console
      console.log(`\n  ── B4 fail-closed 回执原文（模型面，工具名 ${OUT_OF_SCOPE_TOOL}）──\n  ${receipt.slice(0, 500)}\n`);
      expect(receipt, "必须真回了 tool_result（静默 = 没有回执）").not.toBe("");
      expect(receipt, "不许是成功载荷").not.toMatch(/<tool_data tool_call_id="tc_/);
      expect(receipt, "必须是明确失败文案").toMatch(/not found|not in agent scope|unknown|Error|无权|不存在|invalid/i);
      const rows = await t.repos.toolCalls.listByTask("task_reach_b4");
      expect(rows.find((r) => r.toolName === OUT_OF_SCOPE_TOOL), "宿主不许有它的审计行").toBeUndefined();
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B5 变异反证（文件内，不靠外部改动）：整条 MCP 授予拿掉 ⇒ 不可见 ∧ 调用 fail-closed ∧ 宿主零审计行", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: SLICE_RESOLVE_MCP, arguments: RESOLVE_ARGS_NATIVE }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, withoutOntologyMcp(seedCapacityAgent()));
      const resolveSpy = vi.spyOn(t.dataCore.ontology, "resolveSlice");
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_reach_b5", emitted, SEED_AGENT_ID);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      const names = stubVisibleTools(stub).map((x) => x.name);
      expect(names, "无授予 ⇒ 不可见").not.toContain(SLICE_RESOLVE_MCP);
      expect(names, "无授予 ⇒ 裸名也不许冒出来").not.toContain(SLICE_RESOLVE_RAW);
      expect(resolveSpy.mock.calls.length, "无授予 ⇒ 宿主执行体零调用").toBe(0);
      const receipt = toolResultText(stub.requests[1]?.body, "call_1");
      // eslint-disable-next-line no-console
      console.log(`\n  ── B5 无授予臂回执原文（模型面，工具名 ${SLICE_RESOLVE_MCP}）──\n  ${receipt.slice(0, 500)}\n`);
      expect(receipt, "必须真回了 tool_result").not.toBe("");
      expect(receipt, "不许是成功载荷").not.toMatch(/<tool_data tool_call_id="tc_/);
      expect(receipt, "必须是明确失败文案").toMatch(/not found|not in agent scope|unknown|Error|无权|不存在|invalid/i);
      const rows = await t.repos.toolCalls.listByTask("task_reach_b5");
      expect(rows.find((r) => r.toolName === SLICE_RESOLVE_RAW), "宿主零审计行").toBeUndefined();
    } finally {
      await close();
      await stub.close();
    }
  });
});

describe("RESOURCE-REACH · C 两内核一致：同一 query 同剧本，逐条比", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS;
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    delete process.env.QOS_AGENT_LOOP_REPEAT_CAP;
    delete process.env.DSH_TOOL_EXEC_TIMEOUT_MS;
    delete process.env.DSH_TOOL_EXEC_FETCH_TIMEOUT_MS;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  /** 同一条剧本，跑指定内核，回报可逐条比对的读数。 */
  async function runArm(kernel: "NATIVE" | "EXTERNAL", tag: string) {
    const stub = await startStubOpenAi([
      { toolCall: { name: SLICE_RESOLVE_MCP, arguments: RESOLVE_ARGS_NATIVE }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, seedCapacityAgent({ kernel }));
      if (kernel === "NATIVE") {
        // 原生臂吃 ScriptedLlmClient（engine 只对 EXTERNAL 分叉走 dcp provider 缝）
        t.llm.queueAgentTurn({ content: [toolUse(SLICE_RESOLVE_MCP, { sliceKey: "biz.Order.Base", args: {} })] });
        t.llm.queueAgentTurn({
          content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "切片已消费，结论见下。" }], provenance: [] })],
        });
      }
      const resolveSpy = vi.spyOn(t.dataCore.ontology, "resolveSlice");
      const emitted: Emitted[] = [];
      const result = await runAgent(t, `task_reach_${tag}`, emitted, SEED_AGENT_ID);
      const rows = await t.repos.toolCalls.listByTask(`task_reach_${tag}`);
      // 两臂的「模型面」是两个不同的观测面（各取各的，逐项比）：DSH 臂 = stub 线格式请求体；
      // 原生臂 = ScriptedLlmClient 收到的 LlmAgentRequest。**同一个模型面语义**（下一轮上下文）。
      const req1 =
        kernel === "EXTERNAL"
          ? JSON.stringify(stub.requests[1]?.body ?? {})
          : JSON.stringify(t.llm.agentRequests[1] ?? {});
      return {
        kernel: result.run.kernel,
        outcome: result.outcome,
        visible: kernel === "EXTERNAL" ? stubVisibleTools(stub) : nativeVisibleTools(t),
        resolveCalls: resolveSpy.mock.calls.map((c) => ({ sliceKey: c[1], args: c[2] })),
        rows: rows.map((r) => ({ toolName: r.toolName, outcome: r.outcome, input: r.input })),
        // JSON.stringify 把引号转义成 \" ⇒ 正则必须容忍反斜杠（两臂观测面都是 JSON 串）
        toolDataWrapped: /tool_data tool_call_id=\\?"tc_[^"\\]+\\?"/.test(req1),
        slicePayloadOnModelFace: req1.includes("Order_to_Base"),
        answerMarkdown: result.answer.blocks
          .filter((b) => b.type === "text")
          .map((b) => (b as { markdown: string }).markdown)
          .join("\n"),
        iterations: result.run.iterations.flatMap((it) => it.toolCalls).map((c) => ({
          toolName: c.toolName,
          outcome: c.outcome,
        })),
      };
    } finally {
      await close();
      await stub.close();
    }
  }

  it("C1 同源：两臂同 query 同剧本 ⇒ 可见工具（名+描述）、执行体入参、回执形态、审计行全同；差异逐条列出", { timeout: SEAM_TIMEOUT }, async () => {
    const native = await runArm("NATIVE", "c1_native");
    const external = await runArm("EXTERNAL", "c1_external");

    // ① 内核归属确实不同（这是**设计差异**，不是缺陷）
    expect(native.kernel).toBe("NATIVE");
    expect(external.kernel).toBe("EXTERNAL");

    // ② 模型可见工具面：**名字集合**逐项同；**描述**逐项同 —— 唯 `load_skill` 一件例外（[D3]）。
    //    比**集合**不比顺序：两臂的注册顺序源不同（DSH = harness 注册序；native = 执行器导出序），
    //    首跑实测两臂**元素逐项相同、顺序不同** —— 这是 [D2]，登记在下方差异清单，不是行为差异。
    const sortBy = <T extends { name: string }>(xs: T[]) => [...xs].sort((a, b) => (a.name < b.name ? -1 : 1));
    expect(sortBy(external.visible).map((x) => x.name), "两臂可见工具名集合").toEqual(
      sortBy(native.visible).map((x) => x.name),
    );
    const descOf = (xs: { name: string; description: string }[]) => Object.fromEntries(xs.map((x) => [x.name, x.description]));
    const dNative = descOf(native.visible);
    const dExternal = descOf(external.visible);
    // [D3] 描述漂移的**全部**成员必须恰为 load_skill（多一件少一件都红）——见下方差异清单。
    expect(Object.keys(dNative).filter((n) => dNative[n] !== dExternal[n]), "[D3] 描述漂移名单").toEqual(["load_skill"]);
    // 本单主角：本体 MCP 两件的描述两核**逐字同**（[MCP·本体] 前缀单源，见 tools/ontology-mcp.ts）
    for (const n of [SLICE_PLAN_MCP, SLICE_RESOLVE_MCP]) {
      expect(dExternal[n], `${n} 描述两核逐字同`).toBe(dNative[n]);
      expect(dExternal[n], `${n} 单源前缀`).toContain("[MCP·本体] ");
    }
    expect(native.visible.map((x) => x.name)).toContain(SLICE_RESOLVE_MCP);

    // ③ 执行体入参逐字同（同一条 executor 语义）
    expect(external.resolveCalls).toEqual(native.resolveCalls);
    expect(native.resolveCalls).toEqual([{ sliceKey: "biz.Order.Base", args: {} }]);

    // ④ 审计行（toolName / outcome / 入参）逐条同
    expect(external.rows.map((r) => [r.toolName, r.outcome, r.input])).toEqual(
      native.rows.map((r) => [r.toolName, r.outcome, r.input]),
    );
    // ⑤ 回执形态同：两臂都走 <tool_data tool_call_id="tc_…"> 包装，切片数据都上了模型面
    expect(native.toolDataWrapped).toBe(true);
    expect(external.toolDataWrapped).toBe(true);
    expect(native.slicePayloadOnModelFace).toBe(true);
    expect(external.slicePayloadOnModelFace).toBe(true);
    // ⑥ 收尾答案与 iterations 同
    expect(external.answerMarkdown).toBe(native.answerMarkdown);
    expect(external.iterations).toEqual(native.iterations);

    // 差异逐条登记（不许写「基本一致」）：本单实测恰三条，多一条少一条都红。
    //   [D1] run.kernel 归属：设计差异（内核选择本身），行为面无差。
    //   [D2] 模型可见工具的**顺序**不同（集合逐项相同）：DSH 面 = harness 注册序（字母序），
    //        native 面 = 执行器导出序。顺序进 prompt ⇒ 理论上可影响模型选择，本单按「事实差异」登记。
    //   [D3] `load_skill` 的描述文本两核不同（**本单不修，顶回**）：
    //        native = "按 skillId 加载技能全文（渐进披露）。当技能摘要与当前任务相关时调用。"
    //        DSH   = "按需加载技能全文（目录摘要在 system prompt；调此取 body/resources）。"
    //        两处来源：native 在 `apps/agentcore/src/tools/registry.ts`（本单范围内可改），
    //        DSH 在 `packages/dsh-harness/plugins/platform-world.mjs` 的 **skills 段**
    //        —— 🚦该段归 WO `claude/handoff-dsh-p2a-skill-seam`，本单**禁改**（只顶回，不改）。
    //        故本单**只登记不收敛**：修要等 skill seam 那张单落定后由收编方二选一。
    //        ⚠ 不是本单引入：MCP 迁移前就存在，与非本体类资源无关。
    const diffs: string[] = [];
    if (external.kernel !== native.kernel) diffs.push(`[D1] run.kernel: native=${native.kernel} external=${external.kernel}`);
    if (JSON.stringify(external.visible.map((x) => x.name)) !== JSON.stringify(native.visible.map((x) => x.name)))
      diffs.push("[D2] 可见工具顺序不同（集合相同）");
    if (dExternal.load_skill !== dNative.load_skill) diffs.push("[D3] load_skill 描述文本不同（两处来源，归 p2a 单）");
    if (JSON.stringify(external.resolveCalls) !== JSON.stringify(native.resolveCalls)) diffs.push("[D4] 执行体入参不同");
    if (JSON.stringify(external.rows) !== JSON.stringify(native.rows)) diffs.push("[D5] 审计行不同");
    if (external.answerMarkdown !== native.answerMarkdown) diffs.push("[D6] 答案不同");
    if (JSON.stringify(external.iterations) !== JSON.stringify(native.iterations)) diffs.push("[D7] iterations 不同");
    if (external.toolDataWrapped !== native.toolDataWrapped) diffs.push("[D8] 回执包装形态不同");
    if (external.slicePayloadOnModelFace !== native.slicePayloadOnModelFace) diffs.push("[D9] 切片数据是否上模型面不同");
    // eslint-disable-next-line no-console
    console.log(`\n  ── C1 两内核差异清单（逐条）──\n  ${diffs.join("\n  ")}\n`);
    expect(diffs, "差异清单必须恰为登记的这三条（多/少都要先解释）").toEqual([
      `[D1] run.kernel: native=${native.kernel} external=${external.kernel}`,
      "[D2] 可见工具顺序不同（集合相同）",
      "[D3] load_skill 描述文本不同（两处来源，归 p2a 单）",
    ]);
  });

  it("C2 同源反证：MCP 授予拿掉后**两臂一起**收缩（不是只有 DSH 臂变）", { timeout: SEAM_TIMEOUT }, async () => {
    const agent = withoutOntologyMcp(seedCapacityAgent());
    for (const kernel of ["NATIVE", "EXTERNAL"] as const) {
      const stub = await startStubOpenAi([
        { toolCall: { name: SLICE_RESOLVE_MCP, arguments: RESOLVE_ARGS_NATIVE }, usage: PLAIN_USAGE },
        { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
        { text: "stub final answer", usage: PLAIN_USAGE },
      ] satisfies StubRound[]);
      const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
      try {
        await seedWorld(t, { ...agent, kernel } as AgentDefinition);
        if (kernel === "NATIVE") {
          t.llm.queueAgentTurn({ content: [toolUse(SLICE_RESOLVE_MCP, { sliceKey: "biz.Order.Base", args: {} })] });
          t.llm.queueAgentTurn({
            content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "无授予，收尾。" }], provenance: [] })],
          });
        }
        const resolveSpy = vi.spyOn(t.dataCore.ontology, "resolveSlice");
        const emitted: Emitted[] = [];
        await runAgent(t, `task_reach_c2_${kernel}`, emitted, SEED_AGENT_ID);
        const visible = (kernel === "EXTERNAL" ? stubVisibleTools(stub) : nativeVisibleTools(t)).map((x) => x.name);
        // 金丝雀：本臂**真跑起来了**（否则「不可见」是没跑而非没授予）
        if (kernel === "EXTERNAL") expect(t.llm.agentRequests.length + stub.requests.length, "本臂真起了").toBeGreaterThan(0);
        else expect(t.llm.agentRequests.length, "本臂真起了（原生有真 LLM 往返）").toBeGreaterThan(0);
        expect(visible, `${kernel} 臂可见面`).not.toContain(SLICE_RESOLVE_MCP);
        expect(visible, `${kernel} 臂可见面`).not.toContain(SLICE_RESOLVE_RAW);
        expect(resolveSpy.mock.calls.length, `${kernel} 臂执行体`).toBe(0);
      } finally {
        await close();
        await stub.close();
      }
    }
  });
});
