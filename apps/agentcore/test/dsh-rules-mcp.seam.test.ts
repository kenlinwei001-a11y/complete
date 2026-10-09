/**
 * WO-AGENT-CONFIG-TO-DSH · 规则面（`evaluate_rules` / `ruleBindings` 的规则资源）落到
 * **DSH 原生 MCP 模式**，并在真子进程 + 真 HTTP 回环 + 真 DSH 分叉上可达（接缝套件）。
 *
 * **今天的行为是 X**（改造前）：`evaluate_rules` 只能靠 `agent.tools` 里的
 * `{kind:"BUILTIN", name:"evaluate_rules"}` 授予 + **反向工具通道**（`setup.hostTools` 逐 run
 * 递一份 name/description/schema 给平台插件再注册）下发 —— DSH 侧**没有任何该资源的身份**：
 * `tools/list` 里没有它、命名空间里没有 `mcp__rules__*`、配置面挂不上 server、租户隔离不参与。
 * 而「规则」在本平台是一等资源（DRIL 注册表按 kind=rule 建边的那些）。
 * **应该是 Y**（本单）：seed 有 `mcp_builtin_rules` 行；DSH 分叉真 spawn
 * `dist/dsh-runtime/rules-mcp-server.js`，`tools/list` 给出 `evaluate_rules`；`tools/call`
 * 走 MCP wire 转回宿主反向通道 → **同一只** GuardedToolExecutor 的 `case "evaluate_rules"`。
 *
 * 分组：
 *   A = DSH 侧真身（真 stdio MCP 客户端 → 真 spawn → tools/list、tools/call、fail-closed）
 *   B = 执行归一 + 值校验（真 GuardedToolExecutor：实参逐键、审计名归一）
 *   C = 三面同改（授予面 ∧ 挂载面 ∧ 声明面；出厂种子真值 + engine 真装配）
 *   D = 迁前/迁后对照（同一条授予能力：旧载体 = hostTools 反向通道 / 新载体 = mcpServers）
 *   E = e2e 真跑（真 DSH 分叉 + stub LLM）：迁后臂 vs 迁前臂，同一条 query
 *
 * 【每条断言独立重算出处】
 *  · A1 工具名 —— 本文件用**模板串**独立拼 `mcp__${server}__${raw}`，不调生产 helper；
 *  · A2 宿主收到的 toolName/input —— 本文件起的 HTTP 回环**逐字节记录**请求体，与手写期望比；
 *  · B1 规则引擎实参 —— 取 `dataCore.rules.evaluate` 的**调用实参**；审计名取 `repos.toolCalls` 真落行；
 *  · C/D expanded 面 —— 取 engine `expandAgentTools` 真跑结果，不手抄名字；
 *  · E 模型可见面 —— 取 stub 首轮请求体的 `tools[]`；执行证据取真审计行 + 下一轮请求体原文。
 * ⛔ 无 `count()>0` 之类存在性断言；计数一律配「独立算出来的那个数」。
 */
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mcpServerNameSlug, type AgentDefinition } from "@platform/contracts";
import { createMockDataCore } from "../src/mocks/clients.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";
import { TENANT, createTestApp, type TestApp } from "./helpers.js";
import { STUB_DCP_SPEC, startStubOpenAi, stubDirectory, stubProvider, type StubRound } from "./helpers-dsh-stub.js";
import { seedRegistry, seedMcpConfigs } from "../src/mocks/seed.js";
import { buildSessionSetup } from "../src/dsh-runtime/setup-spec.js";
import {
  RULES_MCP_CONFIG_ID,
  RULES_MCP_DESC_PREFIX,
  RULES_MCP_SERVER,
  buildRulesMcpTools,
  rulesMcpToolName,
} from "../src/mcp/rules-mcp.js";
import { WORKFLOW_MCP_SERVER } from "../src/mcp/workflow-mcp.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = `${REPO_ROOT}packages/dsh-harness`;
const SERVER_PATH = fileURLToPath(new URL("../dist/dsh-runtime/rules-mcp-server.js", import.meta.url));

const SEAM_TIMEOUT = 90_000;
const CTX: ToolAuthCtx = { tenantId: TENANT, userId: "u", roles: ["planner"] };
const FAKE_LLM_KEY = "wo-agent-config-dsh-fake-llm-key-00000000000000";
const SERVICE_TOKEN = "wo-agent-config-dsh-service-token-000000000";
const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "QOS_AGENT_LOOP_REPEAT_CAP"] as const;

/** ⛔ 独立重算（不调 rulesMcpToolName）：全名 = mcp__{server}__{raw}。 */
const RAW = "evaluate_rules";
const FULL = `mcp__${RULES_MCP_SERVER}__${RAW}`;
/** 出厂被测 agent：本轮「先挑一个 agent」的那个（11 个里唯一同时挂规则面 + 本体 + 求解器 + 工作流的）。 */
const SEED_AGENT_ID = "agt_seed_analyst";

const PLAIN_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };
const FINAL_ANSWER_ARGS = JSON.stringify({
  blocks: [{ type: "text", markdown: "规则已评估，结论见下。" }],
  provenance: [],
});
const RULE_ARGS = JSON.stringify({ ruleIds: ["C03"], payload: { demandDelta: 0.12 } });

interface CapturedReq {
  runToken?: string;
  callId?: string;
  toolName?: string;
  input?: Record<string, unknown>;
}

const openClients: Client[] = [];
afterEach(async () => {
  for (const c of openClients.splice(0)) await c.close().catch(() => {});
});

/** 真 HTTP 回环：逐字节记录宿主收到的请求体，按剧本回执。 */
async function startHostLoopback(reply: Record<string, unknown>) {
  const seen: CapturedReq[] = [];
  const srv: HttpServer = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push(JSON.parse(body) as CapturedReq);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as AddressInfo).port;
  return {
    seen,
    url: `http://127.0.0.1:${port}/b/v1/dsh/tool-execute`,
    close: () => new Promise<void>((r) => srv.close(() => r())),
  };
}

/** 真 spawn 规则 MCP server 并完成 MCP 握手。 */
async function connectServer(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, ...env } as Record<string, string>,
    stderr: "ignore",
  });
  const client = new Client({ name: "wo-agent-config-dsh-test", version: "0.0.1" });
  await client.connect(transport);
  openClients.push(client);
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** 出厂 analyst 原样取出，只覆写内核选择与模型（其余 tools/scopeDeclaration/systemPrompt 全是出厂值）。 */
function seedAnalyst(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  const base = seedRegistry().agents.find((a) => a.id === SEED_AGENT_ID);
  if (!base) throw new Error(`seed agent not found: ${SEED_AGENT_ID}`);
  return { ...base, model: STUB_DCP_SPEC, kernel: "EXTERNAL", ...overrides } as AgentDefinition;
}

/**
 * **迁前形态**（对照臂）：把规则这条 MCP 路整条撤掉，换回改造前的裸 BUILTIN 授予。
 * 单变量对照 —— 除「规则走哪个载体」之外，授予/声明/挂载三面逐字同（其余工具一律不动）。
 */
function preMigrationAnalyst(agent: AgentDefinition): AgentDefinition {
  return {
    ...agent,
    tools: [
      ...agent.tools.filter((t) => !(t.kind === "MCP" && t.mcpConfigId === RULES_MCP_CONFIG_ID)),
      { kind: "BUILTIN", name: RAW },
    ] as AgentDefinition["tools"],
    mcpServers: agent.mcpServers.filter((m) => m.mcpConfigId !== RULES_MCP_CONFIG_ID),
    scopeDeclaration: {
      ...agent.scopeDeclaration,
      toolNames: agent.scopeDeclaration.toolNames.map((n) => (n === FULL ? RAW : n)),
    },
  } as AgentDefinition;
}

async function seedWorld(t: TestApp, agent: AgentDefinition): Promise<void> {
  for (const m of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(m.id))) await t.repos.mcpConfigs.insert(m);
  for (const wf of seedRegistry().workflows) if (!(await t.repos.workflows.get(wf.id))) await t.repos.workflows.insert(wf);
  for (const sk of seedRegistry().skills) if (!(await t.repos.skills.get(sk.id))) await t.repos.skills.insert(sk);
  await t.repos.agents.insert(agent);
}

async function startToolExecApp(opts: { stubUrl: string; serviceToken?: string }): Promise<{ t: TestApp; close: () => Promise<void> }> {
  const port = await freePort();
  const t = await createTestApp({
    providerDirectory: stubDirectory(stubProvider(opts.stubUrl), FAKE_LLM_KEY) as never,
    env: { PORT: String(port), ...(opts.serviceToken ? { SERVICE_TOKEN: opts.serviceToken } : {}) },
  });
  await t.app.listen({ port, host: "127.0.0.1" });
  return { t, close: () => t.app.close() };
}

async function runAgent(
  t: TestApp,
  taskId: string,
  agentId: string,
): Promise<Awaited<ReturnType<TestApp["deps"]["engine"]["runRegisteredAgent"]>>> {
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId,
    version: 1,
    prompt: "需求增量 0.12 会不会触线？请核规则后收尾。",
    ctx: CTX,
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
    emit: async () => {},
  });
}

/** DSH 臂模型面看到的工具（stub 首轮请求体 tools[].function.{name,description}）。 */
function stubVisibleTools(stub: { requests: { body: unknown }[] }): { name: string; description: string }[] {
  const tools = (stub.requests[0]?.body as { tools?: { function?: { name?: string; description?: string } }[] } | undefined)?.tools ?? [];
  return tools
    .map((x) => ({ name: x.function?.name ?? "", description: x.function?.description ?? "" }))
    .filter((x) => x.name);
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
 * hostTools / mcpServers 两路与 engine.ts DSH 分叉处逐字同形（规则 server 无需 per-run 工具目录
 * env —— 工具集平台固定，与本体同走静态投影）。
 */
async function setupFromSeedAgent(agent: AgentDefinition) {
  const t = await createTestApp();
  try {
    for (const m of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(m.id))) await t.repos.mcpConfigs.insert(m);
    for (const wf of seedRegistry().workflows) if (!(await t.repos.workflows.get(wf.id))) await t.repos.workflows.insert(wf);
    const tools = await t.deps.engine.expandAgentTools(agent);
    const workflowCatalog = tools.filter((x) => x.name.startsWith(`mcp__${WORKFLOW_MCP_SERVER}__`)).map((x) => x.name);
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
              toolAllowlist:
                serverName === WORKFLOW_MCP_SERVER
                  ? workflowCatalog
                  : tools.filter((x) => x.binding.kind === "MCP" && x.binding.mcpConfigId === ref.mcpConfigId).map((x) => x.name),
            }
          : {}),
      });
    }
    if (workflowCatalog.length > 0 && !mcpServers.some((s) => s.serverName === WORKFLOW_MCP_SERVER)) {
      mcpServers.push({ serverName: WORKFLOW_MCP_SERVER, toolAllowlist: workflowCatalog });
    }
    const spec = buildSessionSetup({
      agent,
      agentSystemCore: "CORE",
      grantedToolNames: tools.map((x) => x.name),
      ...(mcpServers.length ? { mcpServers: mcpServers as never } : {}),
      hostTools: tools
        .filter((x) => x.binding.kind === "BUILTIN")
        .map((x) => ({ name: x.name, description: x.description, inputSchema: x.inputSchema })),
    });
    return { spec, expanded: tools };
  } finally {
    await t.app.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// A 组 · DSH 侧真身：真 stdio MCP 客户端 → 真 spawn → tools/list / tools/call
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-AGENT-CONFIG-TO-DSH · A 组：DSH 侧真看到的规则资源（MCP wire 面）", () => {
  it("前置自证：server 入口文件真实存在（不存在则本组全无意义）", () => {
    expect(existsSync(SERVER_PATH), `缺入口 ${SERVER_PATH}（先 pnpm --filter agentcore build）`).toBe(true);
  });

  it("A1 tools/list：DSH 侧真拿到 evaluate_rules，且描述逐字 = 宿主静态投影（两内核同源锚点）", async () => {
    const client = await connectServer({});
    const { tools } = await client.listTools();
    // 独立重算：wire 上注册的是**裸名**（harness 拼 mcp__rules__），期望由本文件模板串拼
    expect(tools.map((t) => t.name)).toEqual([RAW]);
    expect(tools.map((t) => `${RULES_MCP_SERVER}_ns:${t.name}`)).toEqual([`${RULES_MCP_SERVER}_ns:${RAW}`]);
    expect(FULL).toBe("mcp__rules__evaluate_rules"); // 金丝雀：模板串拼法本身是对的
    // 宿主静态投影（原生臂模型面）与 MCP 广告（DSH 臂模型面）**同一段文字**
    const advertised = buildRulesMcpTools();
    expect(advertised.map((t) => t.name)).toEqual([FULL]);
    const desc: string = tools[0]!.description ?? "";
    expect(desc).toBe(advertised[0]!.description);
    expect(desc.startsWith(RULES_MCP_DESC_PREFIX)).toBe(true);
    // 入参声明透传（模型据此传参；与 BUILTIN 定义同源，不许在 server 侧另抄一份）
    const props = (tools[0]!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props).toHaveProperty("ruleIds");
    expect(props).toHaveProperty("payload");
  });

  it("A2 tools/call：宿主收到的是**全名** + 入参逐键原文；模型面回执是逐字 <tool_data> 包络", async () => {
    const loop = await startHostLoopback({ outcome: "OK", payloadJson: '{"verdicts":[{"ruleId":"C03","status":"PASS"}]}', toolCallId: "tc_9" });
    try {
      const client = await connectServer({ PLATFORM_TOOL_EXEC_URL: loop.url, DSH_RUN_TOKEN: "rt_test" });
      const r = await client.callTool({ name: RAW, arguments: { ruleIds: ["C03"], payload: { demandDelta: 0.12 } } });
      expect(loop.seen).toHaveLength(1);
      const seen = loop.seen[0]!;
      // 全名——宿主 executor 的 scope 门用全名校验（转发裸名会被自己的门 DENIED）
      expect(seen.toolName).toBe(FULL);
      expect(seen.runToken).toBe("rt_test");
      expect(seen.input).toEqual({ ruleIds: ["C03"], payload: { demandDelta: 0.12 } });
      const text = (r.content as { type: string; text: string }[])[0]!.text;
      expect(text).toBe('<tool_data tool_call_id="tc_9">{"verdicts":[{"ruleId":"C03","status":"PASS"}]}</tool_data>');
      expect(r.isError).toBeFalsy();
    } finally {
      await loop.close();
    }
  });

  it("A3 对照（减输入）：无宿主桥 ⇒ fail-closed 明确失败 ∧ 宿主零转发（不静默放行）", async () => {
    const loop = await startHostLoopback({ outcome: "OK", payloadJson: "{}" });
    try {
      const client = await connectServer({});
      const r = await client.callTool({ name: RAW, arguments: { ruleIds: "ALL_APPLICABLE", payload: {} } });
      expect(r.isError).toBe(true);
      const text = (r.content as { type: string; text: string }[])[0]!.text;
      expect(text).toMatch(/PLATFORM_TOOL_EXEC_URL|DSH_RUN_TOKEN/);
      // 独立重算出来的那个数：0（不是「>0」）——拿掉 env 之后一条都不许转
      expect(loop.seen).toHaveLength(0);
      expect(RAW).toBe("evaluate_rules");
    } finally {
      await loop.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B 组 · 执行归一 + 值校验（真 GuardedToolExecutor）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-AGENT-CONFIG-TO-DSH · B 组：MCP 全名归一回同一只执行体", () => {
  function makeExec() {
    const dataCore = createMockDataCore();
    const calls: { ruleIds: unknown; payload: unknown }[] = [];
    const orig = dataCore.rules.evaluate.bind(dataCore.rules);
    dataCore.rules.evaluate = (async (_ctx: unknown, ruleIds: unknown, payload: unknown) => {
      calls.push({ ruleIds, payload });
      return orig(_ctx as never, ruleIds as never, payload as never);
    }) as typeof dataCore.rules.evaluate;
    const repos = createMemoryRepos();
    const exec = new GuardedToolExecutor(
      { dataCore, repos, metrics: new Metrics() },
      {
        taskId: "t_rules_mcp",
        ctx: { tenantId: TENANT, userId: "admin", roles: ["admin"] },
        budget: new BudgetTracker(),
        // 授予面：规则**全名**（scope 门用全名校验）+ 一个对照用 BUILTIN
        scopeToolNames: [FULL, "query_objects"],
      },
    );
    return { exec, calls, repos };
  }

  it("B1 值校验：按声明面调用 ⇒ 规则引擎实参逐键等于原文（ruleIds/payload 不许被丢成 undefined）", async () => {
    const { exec, calls } = makeExec();
    await exec.run(FULL, { ruleIds: ["C03"], payload: { demandDelta: 0.12 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ruleIds).toEqual(["C03"]);
    expect(calls[0]!.payload).toEqual({ demandDelta: 0.12 });
  });

  it("B2 字面量形态：ruleIds=ALL_APPLICABLE 原样透传（契约两条路都不许被改写）", async () => {
    const { exec, calls } = makeExec();
    await exec.run(FULL, { ruleIds: "ALL_APPLICABLE", payload: { month: "2026-09" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ruleIds).toBe("ALL_APPLICABLE");
    expect(calls[0]!.payload).toEqual({ month: "2026-09" });
  });

  it("B3 对照实验（改工具名 ⇒ 结果按可预言的方式变）：授予名→真执行；未授予名→零实参 + 审计 DENIED", async () => {
    const { exec, calls, repos } = makeExec();
    // 预言：scope 面未授予 ⇒ 不进执行体，零实参
    await exec.run("mcp__rules__no_such_tool", { ruleIds: [], payload: {} });
    expect(calls).toHaveLength(0);
    const denied = await repos.toolCalls.listByTask("t_rules_mcp");
    expect(denied.map((r) => [r.toolName, r.outcome])).toEqual([["mcp__rules__no_such_tool", "DENIED"]]);
    // 改成授予面内的名字 ⇒ 恰好一次实参
    await exec.run(FULL, { ruleIds: ["C01"], payload: { x: 1 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ ruleIds: ["C01"], payload: { x: 1 } });
  });

  it("B4 审计名归一到裸名（并以同一条读法做对照，证明读的是真落行）", async () => {
    const { exec, repos } = makeExec();
    await exec.run(FULL, { ruleIds: ["C03"], payload: {} });
    await exec.run("query_objects", { objectType: "Model" });
    const rows = await repos.toolCalls.listByTask("t_rules_mcp");
    // 规则那笔记裸名；对照那笔保持原名 ⇒ 该读法有鉴别力（不是恒返回同一串）
    expect(rows.map((r) => r.toolName)).toEqual([RAW, "query_objects"]);
    expect(rows[0]!.outcome).toBe("OK");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C 组 · 三面同改（出厂种子真值 + engine 真装配）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-AGENT-CONFIG-TO-DSH · C 组：规则面三面同改 + 只剩一条授予路", () => {
  it("C1 出厂 analyst：授予面 ∧ 挂载面 ∧ 声明面三面一致，裸名已退净", async () => {
    const agent = seedAnalyst();
    // ① 授予面：MCP ref（不是 BUILTIN 授予）
    const ref = agent.tools.find((t) => t.kind === "MCP" && t.mcpConfigId === RULES_MCP_CONFIG_ID);
    expect(ref, "规则走 MCP 授予（规则 server 在 ref 里）").toBeTruthy();
    const filter = (ref as { toolFilter?: string[] }).toolFilter ?? [];
    // 独立重算：每个 filter 名必须等于本文件模板串拼出来的全名
    for (const n of filter) expect(n).toBe(`mcp__${RULES_MCP_SERVER}__${n.replace(`mcp__${RULES_MCP_SERVER}__`, "")}`);
    expect(filter).toEqual([FULL]);
    // ② 声明面按契约惯例记**全名**且不再记裸名
    expect(agent.scopeDeclaration.toolNames, "声明面全名").toContain(FULL);
    expect(agent.scopeDeclaration.toolNames, "声明面不再记裸名").not.toContain(RAW);
    // ③ DSH 挂载面（「DSH 自己知道有这个 server」的登记点）
    expect(agent.mcpServers.map((m) => m.mcpConfigId), "DSH mcpServers 挂载面").toContain(RULES_MCP_CONFIG_ID);
    // ④ 裸名授予已退净（对照：旧形态必须为 0）
    expect(agent.tools.some((t) => t.kind === "BUILTIN" && t.name === RAW), "仍有裸名授予").toBe(false);
    // ⑤ 配置行真在册（缺它 ⇒ expandAgentTools 的 `if (!config) continue` 静默零工具）
    const row = seedMcpConfigs().find((m) => m.id === RULES_MCP_CONFIG_ID);
    expect(row, `seedMcpConfigs 里必须有 ${RULES_MCP_CONFIG_ID}`).toBeDefined();
    expect(row!.serverName, "命名空间（进 mcp__<server>__ 前缀）").toBe(RULES_MCP_SERVER);
    expect(row!.transport.type, "stdio = DSH 侧真 spawn 子进程的那种").toBe("stdio");
    expect(row!.status).toBe("ACTIVE");
  });

  it("C2 engine 真装配：expanded 面出全名 ∧ hostTools 面**没有**它（单路证明）", async () => {
    const { spec, expanded } = await setupFromSeedAgent(seedAnalyst());
    const expandedNames = expanded.map((x) => x.name);
    expect(expandedNames, "授予面展开（engine 真跑）").toContain(FULL);
    expect(expandedNames, "裸名不许出现在模型可见面（会与全名撞成两条）").not.toContain(RAW);
    // 反向工具面不许有规则（有 = 两条路并存）
    const hostNames = (spec.hostTools ?? []).map((x) => x.name);
    expect(hostNames, "反向工具面不许有规则").not.toContain(FULL);
    expect(hostNames, "反向工具面不许有裸名规则").not.toContain(RAW);
    // 金丝雀：反向工具面**没有空掉**（否则上面两条 not.toContain 对空实现恒真）
    // ⚠ WO-BUILTIN-TO-DSH：金丝雀原锚 `query_objects` 已改挂内置工具 MCP 面（`mcp__builtin__*`）
    // ⇒ 改用同批**未迁**的 analyst 内置工具 `get_object`（它仍是裸 BUILTIN 授予）。
    expect(hostNames).toContain("get_object");
    expect(hostNames.length).toBeGreaterThan(0);
    // MCP 面：真 server spec + toolAllowlist 收窄到一件；按 serverName 取，⛔ 不按下标
    const rulesServer = spec.mcpServers?.find((m) => m.serverName === RULES_MCP_SERVER);
    expect(rulesServer, "DSH 侧 MCP server 面（规则 server 必须在挂载表里）").toBeDefined();
    expect(rulesServer!.toolAllowlist, "MCP wire 侧允许表（逐字钉死）").toEqual([FULL]);
    // 描述文本与 MCP server 广告逐字同源（两内核模型面不许各写一份前缀）
    const advertised = buildRulesMcpTools();
    const ruleSpec = expanded.find((x) => x.name === FULL)!;
    expect(ruleSpec.description, "静态投影 = MCP server 广告描述").toBe(advertised.find((x) => x.name === FULL)!.description);
    expect(ruleSpec.description.startsWith(RULES_MCP_DESC_PREFIX)).toBe(true);
    // 允许表（harness 侧白名单）含全名
    expect((spec.tools ?? []).map((x) => x.name)).toContain(FULL);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D 组 · 迁前/迁后对照（同一条能力，换载体：hostTools 反向通道 → mcpServers 原生面）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-AGENT-CONFIG-TO-DSH · D 组：迁前/迁后单变量对照（setup 层）", () => {
  it("D1 迁前臂：裸 BUILTIN 授予 ⇒ 能力在 hostTools（平台组装的反向工具），DSH 侧零 server", async () => {
    const { spec, expanded } = await setupFromSeedAgent(preMigrationAnalyst(seedAnalyst()));
    expect(expanded.map((x) => x.name)).toContain(RAW);
    expect((spec.hostTools ?? []).map((x) => x.name), "迁前：能力在反向工具面").toContain(RAW);
    expect(
      (spec.mcpServers ?? []).map((m) => m.serverName),
      "迁前：DSH 侧没有规则 server（这就是「DSH 不知道它存在」的判据）",
    ).not.toContain(RULES_MCP_SERVER);
  });

  it("D2 迁后臂：同一条能力改走 MCP ⇒ DSH 侧有 server 且允许表恰为一件；能力数不变", async () => {
    const post = await setupFromSeedAgent(seedAnalyst());
    const pre = await setupFromSeedAgent(preMigrationAnalyst(seedAnalyst()));
    // 迁后
    expect((post.spec.mcpServers ?? []).map((m) => m.serverName)).toContain(RULES_MCP_SERVER);
    expect((post.spec.hostTools ?? []).map((x) => x.name)).not.toContain(RAW);
    // 单变量：除规则那一条外，两臂的其余授予逐字同（证明对照不是「整表被换掉」）
    const strip = (names: string[], drop: string[]) => names.filter((n) => !drop.includes(n)).sort();
    const postNames = strip(post.expanded.map((x) => x.name), [FULL]);
    const preNames = strip(pre.expanded.map((x) => x.name), [RAW]);
    expect(postNames).toEqual(preNames);
    // 规则能力在两条臂上都是**恰一件**（不许多/不许少）
    expect(post.expanded.filter((x) => x.name.startsWith(`mcp__${RULES_MCP_SERVER}__`)).length).toBe(1);
    expect(pre.expanded.filter((x) => x.name === RAW).length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E 组 · e2e 真跑（真 DSH 分叉 + stub LLM）：迁后臂 vs 迁前臂，同一条 query
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-AGENT-CONFIG-TO-DSH · E 组：真跑的 run 记录（迁前 / 迁后同一条 query）", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS;
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("E1 迁后（DSH 原生 MCP）：模型面有 mcp__rules__evaluate_rules ∧ 真调 ∧ 规则引擎真执行 ∧ 审计行", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: FULL, arguments: RULE_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, seedAnalyst());
      const evalSpy = vi.spyOn(t.dataCore.rules, "evaluate");
      const result = await runAgent(t, "task_rules_mcp_e1", SEED_AGENT_ID);
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");

      // ① 模型可见面：全名 + 描述逐字 = MCP 广告（这一面是 MCP 客户端注册出来的）
      const visible = stubVisibleTools(stub);
      const names = visible.map((x) => x.name);
      expect(names, "模型可见工具面").toContain(FULL);
      expect(names, "裸名不在模型面").not.toContain(RAW);
      const advertised = buildRulesMcpTools()[0]!;
      expect(visible.find((x) => x.name === FULL)?.description, "描述逐字 = MCP 广告文本").toBe(advertised.description);

      // ② 真调用：规则引擎被真打到，实参逐键 = 模型给的
      // ⚠ 计数口径：规则引擎**同一条 run 里不止被工具面打**（治理裁决/后验也走它），故不许
      //   断言「总调用数 == 1」——那样断言的是「别的消费者都别调」，而非本次迁移的行为。
      //   判据落在**模型那一次**上：实参等于 stub 给定入参的调用**恰一次**（独立重算的数）。
      const modelCalls = evalSpy.mock.calls.filter(
        (c) => JSON.stringify(c[1]) === JSON.stringify(["C03"]) && JSON.stringify(c[2]) === JSON.stringify({ demandDelta: 0.12 }),
      );
      expect(modelCalls.length, "模型那一次规则调用恰一次").toBe(1);
      expect(evalSpy.mock.calls.length, "金丝雀：规则引擎确实被本 run 打到过").toBeGreaterThan(0);

      // ③ 同一只 host executor ⇒ 落一行审计（名归一到裸名，不是全名）
      const rows = await t.repos.toolCalls.listByTask("task_rules_mcp_e1");
      const ruleRow = rows.find((r) => r.toolName === RAW);
      expect(ruleRow?.outcome, "规则审计行").toBe("OK");
      expect(ruleRow!.id).toMatch(/^tc_/);
      expect(rows.find((r) => r.toolName === FULL), "审计面不许有全名行（有 = 两条路都执行过）").toBeUndefined();

      // ④ 回执真回模型面：下一轮请求体里逐字可见 <tool_data tool_call_id="tc_…">
      const second = JSON.stringify(stub.requests[1]!.body);
      expect(second, "回执上模型面").toContain(`<tool_data tool_call_id=\\"${ruleRow!.id}\\">`);
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── E1 迁后臂 · DSH 模型面（首轮）──\n` +
          visible.map((x) => `  ${x.name} :: ${x.description.slice(0, 70)}`).join("\n") +
          `\n  ── 审计行 ──\n  ${JSON.stringify(rows.map((r) => `${r.toolName}/${r.outcome}`))}\n` +
          `  ── 回执原文 ──\n  ${toolResultText(stub.requests[1]!.body, "call_1").replace(/\s+/g, " ").slice(0, 260)}\n`,
      );
    } finally {
      await close();
      await stub.close();
    }
  });

  it("E2 迁前（对照臂·同一 query）：能力在反向工具面（裸名）∧ DSH 侧零规则 server ∧ 同一执行体", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: RAW, arguments: RULE_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, preMigrationAnalyst(seedAnalyst()));
      const evalSpy = vi.spyOn(t.dataCore.rules, "evaluate");
      const result = await runAgent(t, "task_rules_mcp_e2", SEED_AGENT_ID);
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");

      const names = stubVisibleTools(stub).map((x) => x.name);
      // 迁前判据：模型面**只有裸名**，全名一个都没有 —— 这就是「DSH 不知道规则是个资源」
      expect(names, "迁前：能力以裸名到达模型面").toContain(RAW);
      expect(names, "迁前：DSH 侧没有任何 mcp__rules__* 身份").not.toContain(FULL);
      expect(names.filter((n) => n.startsWith(`mcp__${RULES_MCP_SERVER}__`)), "迁前：零条规则 MCP 工具").toEqual([]);
      // 能力仍在（对照不是「把能力删了」）：规则引擎同样真执行、实参逐字同（计数口径同 E1）
      const modelCalls = evalSpy.mock.calls.filter(
        (c) => JSON.stringify(c[1]) === JSON.stringify(["C03"]) && JSON.stringify(c[2]) === JSON.stringify({ demandDelta: 0.12 }),
      );
      expect(modelCalls.length, "迁前臂：模型那一次规则调用恰一次").toBe(1);
      const rows = await t.repos.toolCalls.listByTask("task_rules_mcp_e2");
      expect(rows.find((r) => r.toolName === RAW)?.outcome, "同一只 host executor、同一行审计名").toBe("OK");
      // 金丝雀：模型面没空掉（否则上面 not.toContain 恒真）
      expect(names.length).toBeGreaterThan(5);
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── E2 迁前臂 · 模型面里的规则工具名 ──\n` +
          `  ${names.filter((n) => n.includes("rule")).join(", ") || "(无)"}\n` +
          `  ── 审计行 ──\n  ${JSON.stringify(rows.map((r) => `${r.toolName}/${r.outcome}`))}\n`,
      );
    } finally {
      await close();
      await stub.close();
    }
  });
});
