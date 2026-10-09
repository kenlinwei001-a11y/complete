/**
 * WO-BUILTIN-TO-DSH · **内置工具（BUILTIN）**这一族（「查数据」「取对象」「搜知识」…）落到
 * **DSH 原生 MCP 模式**，并在真子进程 + 真 HTTP 回环 + 真 DSH 分叉上可达（接缝套件）。
 *
 * **今天的行为是 X**（改造前）：它们只能靠 `agent.tools` 里的 `{kind:"BUILTIN", name:"query_objects"}`
 * 授予 + **反向工具通道**（`setup.hostTools`：平台每 run 临时递一份 name/description/schema 给
 * DSH 的插件再注册）下发 —— **DSH 侧对它们零身份**：`tools/list` 里没有它们、命名空间里没有
 * `mcp__*`、配置面挂不上 server、租户隔离不参与。
 * **应该是 Y**（本单，试点件 = `query_objects`）：seed 有 `mcp_builtin_tools` 行；DSH 分叉真 spawn
 * `dist/dsh-runtime/builtin-mcp-server.js`，`tools/list` 给出 `query_objects`；
 * `tools/call` 走 MCP wire 转回宿主反向通道 → **同一只** GuardedToolExecutor 的
 * `case "query_objects"`（换载体，不换执行体）。
 *
 * 分组：
 *   A = DSH 侧真身（真 stdio MCP 客户端 → 真 spawn → tools/list、tools/call、fail-closed）
 *   B = 执行归一 + 值校验 + **三样不许松**（scope 门全名 / 对象域门 / 失败点名）
 *   C = 三面同改（授予面 ∧ 挂载面 ∧ 声明面；出厂种子真值 + engine 真装配，逐 agent）
 *   D = 迁前/迁后对照（同一条能力：旧载体 = hostTools 反向通道 / 新载体 = mcpServers）
 *   E = e2e 真跑（真 DSH 分叉 + stub LLM）：迁后臂 vs 迁前臂（同一条 query）+ 反向对照
 *
 * 【每条断言独立重算出处】
 *  · A1 工具名 —— 本文件用**模板串**独立拼 `mcp__${server}__${raw}`（并配金丝雀证明拼法本身对），
 *    不调生产 helper；入参模式与注册表逐键比（独立取 `BUILTIN_TOOLS` 原文）。
 *  · A2 宿主收到的 toolName/input —— 本文件起的 HTTP 回环**逐字节记录**请求体，与手写期望比。
 *  · B1 数据面实参 —— 取 `dataCore.ontology.queryObjects` 的**调用实参**；审计名/实参取
 *    `repos.toolCalls` 真落行。
 *  · C/D expanded 面 —— 取 engine `expandAgentTools` 真跑结果，不手抄名字。
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
import { mcpServerNameSlug, type AgentDefinition, type ToolDefinition } from "@platform/contracts";
import { createMockDataCore } from "../src/mocks/clients.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";
import { TENANT, createTestApp, type TestApp } from "./helpers.js";
import { STUB_DCP_SPEC, startStubOpenAi, stubDirectory, stubProvider, type StubRound } from "./helpers-dsh-stub.js";
// 原生臂剧本（C3b 用；DSH 臂走 stub OpenAI 服务器）
import { toolUse } from "../src/llm/mock.js";
import { seedRegistry, seedMcpConfigs } from "../src/mocks/seed.js";
import { buildSessionSetup } from "../src/dsh-runtime/setup-spec.js";
import { BUILTIN_TOOLS } from "../src/tools/registry.js";
// 截断豁免判据（身份归一的单点判据，loop.ts 原生臂 / server.ts 端点共用同一函数）。
import { isTruncationExemptTool } from "../src/agent/loop.js";
import {
  BUILTIN_MCP_CONFIG_ID,
  BUILTIN_MCP_DESC_PREFIX,
  BUILTIN_MCP_SERVER,
  buildBuiltinMcpTools,
  builtinMcpToolName,
  parseBuiltinMcpToolName,
  resolveBuiltinToolIdentity,
} from "../src/mcp/builtin-mcp.js";
import { ONTOLOGY_MCP_CONFIG_ID } from "../src/tools/ontology-mcp.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = `${REPO_ROOT}packages/dsh-harness`;
const SERVER_PATH = fileURLToPath(new URL("../dist/dsh-runtime/builtin-mcp-server.js", import.meta.url));

const SEAM_TIMEOUT = 90_000;
const CTX: ToolAuthCtx = { tenantId: TENANT, userId: "u", roles: ["planner"] };
const FAKE_LLM_KEY = "wo-builtin-dsh-fake-llm-key-000000000000000000";
const SERVICE_TOKEN = "wo-builtin-dsh-service-token-000000000000";
const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "QOS_AGENT_LOOP_REPEAT_CAP"] as const;

/** ⛔ 独立重算（不调 builtinMcpToolName）：全名 = mcp__{server}__{raw}。 */
const RAW = "query_objects";
const FULL = `mcp__${BUILTIN_MCP_SERVER}__${RAW}`;
/** 出厂被测 agent：11 个出厂 agent **每一个**都授予了 `query_objects`（本单选它当试点的理由）。 */
const SEED_AGENT_ID = "agt_seed_analyst";

const PLAIN_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };
const FINAL_ANSWER_ARGS = JSON.stringify({
  blocks: [{ type: "text", markdown: "已读到对象数据，结论见下。" }],
  provenance: [],
});
const ARGS_ORDER = JSON.stringify({ objectType: "Order", filter: { baseId: "base-cz" }, limit: 5 });

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

/** 真 spawn 内置工具 MCP server 并完成 MCP 握手。 */
async function connectServer(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, ...env } as Record<string, string>,
    stderr: "ignore",
  });
  const client = new Client({ name: "wo-builtin-dsh-test", version: "0.0.1" });
  await client.connect(transport);
  openClients.push(client);
  return client;
}

async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** 出厂 agent 原样取出，只覆写内核选择与模型（其余 tools/scopeDeclaration/systemPrompt 全是出厂值）。 */
function seedAgent(id: string, overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  const base = seedRegistry().agents.find((a) => a.id === id);
  if (!base) throw new Error(`seed agent not found: ${id}`);
  return { ...base, model: STUB_DCP_SPEC, kernel: "EXTERNAL", ...overrides } as AgentDefinition;
}
const seedAnalyst = (overrides: Partial<AgentDefinition> = {}) => seedAgent(SEED_AGENT_ID, overrides);

/**
 * **迁前形态**（对照臂）：把 `query_objects` 这条 MCP 路整条撤掉，换回改造前的裸 BUILTIN 授予。
 * 单变量对照 —— 除「这一件工具走哪个载体」之外，授予/声明/挂载三面逐字同（其余工具一律不动）。
 */
function preMigrationAgent(agent: AgentDefinition): AgentDefinition {
  return {
    ...agent,
    tools: [
      ...agent.tools.filter((t) => !(t.kind === "MCP" && t.mcpConfigId === BUILTIN_MCP_CONFIG_ID)),
      { kind: "BUILTIN", name: RAW },
    ] as AgentDefinition["tools"],
    mcpServers: agent.mcpServers.filter((m) => m.mcpConfigId !== BUILTIN_MCP_CONFIG_ID),
    scopeDeclaration: {
      ...agent.scopeDeclaration,
      toolNames: agent.scopeDeclaration.toolNames.map((n) => (n === FULL ? RAW : n)),
    },
  } as AgentDefinition;
}

/**
 * **反向对照形态**（判据③）：MCP 挂载在、但授予面（toolFilter）**不含**它。
 */
/** 换授的同 server 另一件（见 ungrantedAgent 注）。 */
const UNGRANTED_SWAP = "query_timeseries_agg";
function ungrantedAgent(agent: AgentDefinition): AgentDefinition {
  const swapped = builtinMcpToolName(UNGRANTED_SWAP);
  return {
    ...agent,
    tools: agent.tools.map((t) =>
      t.kind === "MCP" && t.mcpConfigId === BUILTIN_MCP_CONFIG_ID ? { ...t, toolFilter: [swapped] } : t,
    ) as AgentDefinition["tools"],
    scopeDeclaration: {
      ...agent.scopeDeclaration,
      toolNames: agent.scopeDeclaration.toolNames.map((n) => (n === FULL ? swapped : n)),
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
  opts: { enforceObjectScope?: boolean; prompt?: string } = {},
): Promise<Awaited<ReturnType<TestApp["deps"]["engine"]["runRegisteredAgent"]>>> {
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId,
    version: 1,
    prompt: opts.prompt ?? "看一下常州基地的订单情况。",
    ctx: CTX,
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
    emit: async () => {},
    ...(opts.enforceObjectScope ? { enforceObjectScope: true } : {}),
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
 * hostTools / mcpServers 两路与 engine.ts DSH 分叉处逐字同形（内置工具 server 无需 per-run 工具目录
 * env —— 工具集平台固定，与本体/规则同走静态投影）。
 */
async function setupFromSeedAgent(agent: AgentDefinition) {
  const t = await createTestApp();
  try {
    for (const m of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(m.id))) await t.repos.mcpConfigs.insert(m);
    for (const wf of seedRegistry().workflows) if (!(await t.repos.workflows.get(wf.id))) await t.repos.workflows.insert(wf);
    const tools = await t.deps.engine.expandAgentTools(agent);
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
    });
    return { spec, expanded: tools };
  } finally {
    await t.app.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// A 组 · DSH 侧真身：真 stdio MCP 客户端 → 真 spawn → tools/list / tools/call
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-BUILTIN-TO-DSH · A 组：DSH 侧真看到的内置工具（MCP wire 面）", () => {
  it("前置自证：server 入口文件真实存在（不存在则本组全无意义）", () => {
    expect(existsSync(SERVER_PATH), `缺入口 ${SERVER_PATH}（先 pnpm --filter agentcore build）`).toBe(true);
  });

  it("A1 tools/list：DSH 侧真拿到 query_objects，描述/入参模式与宿主静态投影逐字同源（两内核同源锚点）", async () => {
    const client = await connectServer({});
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    // 独立重算：wire 上注册的是**裸名**（harness 拼 mcp__builtin__），期望由本文件模板串拼
    expect(names).toContain(RAW);
    expect(FULL).toBe("mcp__builtin__query_objects"); // 金丝雀：模板串拼法本身是对的
    // 工具清单 = 注册表现算（本文件独立从 BUILTIN_TOOLS 重算一遍，不调生产 helper）
    const dedicated = new Set(["plan_slice", "resolve_slice", "evaluate_rules"]);
    const expectedRaw = BUILTIN_TOOLS.map((t: ToolDefinition) => t.name).filter((n) => !dedicated.has(n));
    expect([...names].sort()).toEqual([...expectedRaw].sort());
    // 宿主静态投影（原生臂模型面）与 MCP 广告（DSH 臂模型面）**同一段文字**
    const advertised = buildBuiltinMcpTools();
    const wire = tools.find((t) => t.name === RAW)!;
    const projected = advertised.find((t) => t.rawName === RAW)!;
    expect(projected.name).toBe(FULL);
    expect(wire.description).toBe(projected.description);
    expect(String(wire.description).startsWith(BUILTIN_MCP_DESC_PREFIX)).toBe(true);
    // 入参声明透传：与 BUILTIN 注册表**同一个对象**（不许在 server 侧另抄一份 zod）
    const def = BUILTIN_TOOLS.find((t) => t.name === RAW)!;
    expect(wire.inputSchema).toEqual(def.inputSchema);
    const props = (wire.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props).sort()).toEqual(["filter", "limit", "objectType"]);
  });

  it("A2 tools/call：宿主收到的是**全名** + 入参逐键原文；模型面回执是逐字 <tool_data> 包络", async () => {
    const loop = await startHostLoopback({ outcome: "OK", payloadJson: '{"rows":[{"id":"o_1"}],"total":1}', toolCallId: "tc_9" });
    try {
      const client = await connectServer({ PLATFORM_TOOL_EXEC_URL: loop.url, DSH_RUN_TOKEN: "rt_test" });
      const r = await client.callTool({ name: RAW, arguments: { objectType: "Order", filter: { baseId: "base-cz" }, limit: 5 } });
      expect(loop.seen).toHaveLength(1);
      const seen = loop.seen[0]!;
      // 全名——宿主 executor 的 scope 门用全名校验（转发裸名会被自己的门 DENIED）
      expect(seen.toolName).toBe(FULL);
      expect(seen.runToken).toBe("rt_test");
      expect(seen.input).toEqual({ objectType: "Order", filter: { baseId: "base-cz" }, limit: 5 });
      const text = (r.content as { type: string; text: string }[])[0]!.text;
      expect(text).toBe('<tool_data tool_call_id="tc_9">{"rows":[{"id":"o_1"}],"total":1}</tool_data>');
      expect(r.isError).toBeFalsy();
    } finally {
      await loop.close();
    }
  });

  it("A3 对照（减输入）：无宿主桥 ⇒ fail-closed 明确失败 ∧ 宿主零转发（不静默放行）", async () => {
    const loop = await startHostLoopback({ outcome: "OK", payloadJson: "{}" });
    try {
      const client = await connectServer({});
      const r = await client.callTool({ name: RAW, arguments: { objectType: "Order", filter: {} } });
      expect(r.isError).toBe(true);
      const text = (r.content as { type: string; text: string }[])[0]!.text;
      expect(text).toMatch(/PLATFORM_TOOL_EXEC_URL|DSH_RUN_TOKEN/);
      // 独立重算出来的那个数：0（不是「>0」）——拿掉 env 之后一条都不许转
      expect(loop.seen).toHaveLength(0);
      expect(RAW).toBe("query_objects");
    } finally {
      await loop.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B 组 · 执行归一 + 值校验 + 三样不许松
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-BUILTIN-TO-DSH · B 组：MCP 全名归一回同一只执行体（且三道门一道都不松）", () => {
  function makeExec(opts: { scopeToolNames?: string[]; scopeObjectTypes?: string[] } = {}) {
    const dataCore = createMockDataCore();
    const calls: { objectType: string; filter: unknown; limit: unknown }[] = [];
    const orig = dataCore.ontology.queryObjects.bind(dataCore.ontology);
    dataCore.ontology.queryObjects = (async (
      _ctx: unknown,
      objectType: string,
      filter: Record<string, unknown>,
      limit?: number,
      epoch?: number,
    ) => {
      calls.push({ objectType, filter, limit });
      return orig(_ctx as never, objectType, filter, limit, epoch);
    }) as typeof dataCore.ontology.queryObjects;
    const repos = createMemoryRepos();
    const exec = new GuardedToolExecutor(
      { dataCore, repos, metrics: new Metrics() },
      {
        taskId: "t_builtin_mcp",
        ctx: { tenantId: TENANT, userId: "admin", roles: ["admin"] },
        budget: new BudgetTracker(),
        scopeToolNames: opts.scopeToolNames ?? [FULL],
        ...(opts.scopeObjectTypes ? { scopeObjectTypes: opts.scopeObjectTypes } : {}),
      },
    );
    return { exec, calls, repos };
  }

  it("B1 值校验：按声明面调用 ⇒ 数据面实参逐键等于原文（objectType/filter/limit 不许被丢成 undefined）", async () => {
    const { exec, calls } = makeExec();
    await exec.run(FULL, { objectType: "Order", filter: { baseId: "base-cz" }, limit: 5 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.objectType).toBe("Order");
    expect(calls[0]!.filter).toEqual({ baseId: "base-cz" });
    expect(calls[0]!.limit).toBe(5);
  });

  it("B2 审计名归一到裸名（并以同一条读法做对照，证明读的是真落行）", async () => {
    const { exec, repos } = makeExec({ scopeToolNames: [FULL, "evaluate_rules"] });
    await exec.run(FULL, { objectType: "Order", filter: {} });
    await exec.run("evaluate_rules", { ruleIds: ["C03"], payload: {} });
    const rows = await repos.toolCalls.listByTask("t_builtin_mcp");
    // 内置工具那笔记裸名；对照那笔保持原名 ⇒ 该读法有鉴别力（不是恒返回同一串）
    expect(rows.map((r) => r.toolName)).toEqual([RAW, "evaluate_rules"]);
    expect(rows[0]!.outcome).toBe("OK");
  });

  it("B3 对象域门（§4.2 一个字不许松）：域外对象照样被拒 ∧ 域内放行（对照实验：改输入 ⇒ 结果按可预言方式变）", async () => {
    const { exec, calls, repos } = makeExec({ scopeObjectTypes: ["Material"] });
    // 预言①：域外（Line）⇒ 不进数据面，落 DENIED 审计行，payload 带越界事实与放行名单
    await exec.run(FULL, { objectType: "Line", filter: {} });
    expect(calls).toHaveLength(0);
    const denied = await repos.toolCalls.listByTask("t_builtin_mcp");
    expect(denied.map((r) => [r.toolName, r.outcome])).toEqual([[RAW, "DENIED"]]);
    expect(JSON.stringify(denied[0]!.output)).toContain("AGENT_SCOPE_VIOLATION");
    expect(JSON.stringify(denied[0]!.output)).toContain("Material");
    // 预言②：改成域内（Material）⇒ 恰好一次数据面实参
    await exec.run(FULL, { objectType: "Material", filter: {} });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.objectType).toBe("Material");
  });

  it("B4 授予面门（§4.1）：授予面上只有**全名** ⇒ 全名过、裸名被拒（且拒绝行的审计名 = 调用原名）", async () => {
    const { exec, calls, repos } = makeExec({ scopeToolNames: [FULL] });
    await exec.run(RAW, { objectType: "Order", filter: {} }); // 裸名 = 未授予
    expect(calls).toHaveLength(0);
    const rows = await repos.toolCalls.listByTask("t_builtin_mcp");
    expect(rows.map((r) => [r.toolName, r.outcome])).toEqual([[RAW, "DENIED"]]);
    await exec.run(FULL, { objectType: "Order", filter: {} });
    expect(calls).toHaveLength(1);
  });

  it("B5 截断豁免集按**身份**判：全名形态照样豁免（不归一会静默失效）∧ 非豁免工具仍不豁免", () => {
    // 豁免集内容独立重算自 loop.ts 的常量（此处断言的是判据函数，不是清单本身）
    expect(isTruncationExemptTool(`mcp__${BUILTIN_MCP_SERVER}__query_timeseries_agg`)).toBe(true);
    expect(isTruncationExemptTool(`mcp__${BUILTIN_MCP_SERVER}__read_skill_resource`)).toBe(true);
    expect(isTruncationExemptTool("query_timeseries_agg")).toBe(true);
    // 反向对照：同一族里**不**豁免的工具（含裸名与全名两种形态）⇒ false
    expect(isTruncationExemptTool(`mcp__${BUILTIN_MCP_SERVER}__query_objects`)).toBe(false);
    expect(isTruncationExemptTool("query_objects")).toBe(false);
    // 身份归一本身的对照：本 MCP 面解析得出裸名，非本面的名字/未知工具名原样返回
    expect(resolveBuiltinToolIdentity(FULL)).toBe(RAW);
    expect(parseBuiltinMcpToolName(FULL)).toBe(RAW);
    expect(parseBuiltinMcpToolName("mcp__rules__evaluate_rules")).toBeUndefined();
    expect(resolveBuiltinToolIdentity("final_answer")).toBe("final_answer");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C 组 · 三面同改（出厂种子真值 + engine 真装配）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-BUILTIN-TO-DSH · C 组：内置工具面三面同改 + 只剩一条授予路", () => {
  it("C1 出厂 analyst：授予面 ∧ 挂载面 ∧ 声明面三面一致，裸名已退净，配置行在册", async () => {
    const agent = seedAnalyst();
    // ① 授予面：MCP ref（不是 BUILTIN 授予）
    const ref = agent.tools.find((t) => t.kind === "MCP" && t.mcpConfigId === BUILTIN_MCP_CONFIG_ID);
    expect(ref, "内置工具走 MCP 授予（server 在 ref 里）").toBeTruthy();
    const filter = (ref as { toolFilter?: string[] }).toolFilter ?? [];
    // 独立重算：每个 filter 名必须等于本文件模板串拼出来的全名
    for (const n of filter) expect(n).toBe(`mcp__${BUILTIN_MCP_SERVER}__${n.replace(`mcp__${BUILTIN_MCP_SERVER}__`, "")}`);
    expect(filter).toEqual([FULL]);
    // ② 声明面按契约惯例记**全名**且不再记裸名
    expect(agent.scopeDeclaration.toolNames, "声明面全名").toContain(FULL);
    expect(agent.scopeDeclaration.toolNames, "声明面不再记裸名").not.toContain(RAW);
    // ③ DSH 挂载面（「DSH 自己知道有这个 server」的登记点）
    expect(agent.mcpServers.map((m) => m.mcpConfigId), "DSH mcpServers 挂载面").toContain(BUILTIN_MCP_CONFIG_ID);
    // ④ 裸名授予已退净（对照：旧形态必须为 0）
    expect(agent.tools.some((t) => t.kind === "BUILTIN" && t.name === RAW), "仍有裸名授予").toBe(false);
    // ⑤ 配置行真在册（缺它 ⇒ expandAgentTools 的 `if (!config) continue` 静默零工具）
    const row = seedMcpConfigs().find((m) => m.id === BUILTIN_MCP_CONFIG_ID);
    expect(row, `seedMcpConfigs 里必须有 ${BUILTIN_MCP_CONFIG_ID}`).toBeDefined();
    expect(row!.serverName, "命名空间（进 mcp__<server>__ 前缀）").toBe(BUILTIN_MCP_SERVER);
    expect(row!.transport.type, "stdio = DSH 侧真 spawn 子进程的那种").toBe("stdio");
    expect(row!.status).toBe("ACTIVE");
  });

  it("C2 **逐 agent** 扫出厂种子：11 个 agent 的 `query_objects` 三面都在 MCP 面上（裸名授予 = 0）", () => {
    const agents = seedRegistry().agents;
    // 金丝雀：出厂 agent 数量非空且探针数不是 0（否则下面「零个裸名授予」对空实现恒真）
    expect(agents.length).toBeGreaterThanOrEqual(11);
    const withQuery = agents.filter((a) => a.scopeDeclaration.toolNames.includes(FULL));
    expect(withQuery.length, "每个 agent 都在用 query_objects ⇒ 逐个都该出现在 MCP 面上").toBe(agents.length);
    for (const a of agents) {
      const bare = a.tools.filter((t) => t.kind === "BUILTIN" && t.name === RAW);
      expect(bare, `${a.key}: 裸名授予已退净（有 = 两条授予路并存）`).toEqual([]);
      const ref = a.tools.find((t) => t.kind === "MCP" && t.mcpConfigId === BUILTIN_MCP_CONFIG_ID);
      expect(ref, `${a.key}: 授予面有内置工具 MCP ref`).toBeTruthy();
      expect(
        (ref as { toolFilter?: string[] }).toolFilter,
        `${a.key}: 授予面收窄到本 agent 该拿的那几件`,
      ).toContain(FULL);
      expect(a.mcpServers.map((m) => m.mcpConfigId), `${a.key}: 挂载面`).toContain(BUILTIN_MCP_CONFIG_ID);
      expect(a.scopeDeclaration.toolNames, `${a.key}: 声明面不再记裸名`).not.toContain(RAW);
    }
  });

  it("C3 engine 真装配（analyst）：expanded 面出全名 ∧ hostTools 面**没有**它（单路证明）", async () => {
    const { spec, expanded } = await setupFromSeedAgent(seedAnalyst());
    const expandedNames = expanded.map((x) => x.name);
    expect(expandedNames, "授予面展开（engine 真跑）").toContain(FULL);
    expect(expandedNames, "裸名不许出现在模型可见面（会与全名撞成两条）").not.toContain(RAW);
    // 反向工具面不许有它（有 = 两条路并存）
    const hostNames = (spec.hostTools ?? []).map((x) => x.name);
    expect(hostNames, "反向工具面不许有全名形态").not.toContain(FULL);
    expect(hostNames, "反向工具面不许有裸名").not.toContain(RAW);
    // 金丝雀：反向工具面**没有空掉**（否则上面两条 not.toContain 对空实现恒真）——
    // analyst 仍有同批**未迁**的内置工具走反向通道
    expect(hostNames).toContain("get_object");
    // MCP 面：真 server spec + toolAllowlist 收窄到一件；按 serverName 取，⛔ 不按下标
    const builtinServer = spec.mcpServers?.find((m) => m.serverName === BUILTIN_MCP_SERVER);
    expect(builtinServer, "DSH 侧 MCP server 面（内置工具 server 必须在挂载表里）").toBeDefined();
    expect(builtinServer!.toolAllowlist, "MCP wire 侧允许表（逐字钉死）").toEqual([FULL]);
    // 描述文本与 MCP server 广告逐字同源（两内核模型面不许各写一份前缀）
    const advertised = buildBuiltinMcpTools();
    const specTool = expanded.find((x) => x.name === FULL)!;
    expect(specTool.description, "静态投影 = MCP server 广告描述").toBe(advertised.find((x) => x.name === FULL)!.description);
    expect(specTool.description.startsWith(BUILTIN_MCP_DESC_PREFIX)).toBe(true);
    // 允许表（harness 侧白名单）含全名
    expect((spec.tools ?? []).map((x) => x.name)).toContain(FULL);
  });

  it("C3b Phase6C 收窄豁免（原生臂真跑）：内置工具面不参与 top-k，其余 MCP 面照旧收窄到 8", async () => {
    const t = await createTestApp();
    try {
      // 原生臂（本单要防的回归就在这条路上：MCP 面被 `selectMcpTools` 按 query 相关性砍到 8）
      const agent = seedAnalyst({ kernel: "NATIVE" });
      await seedWorld(t, agent);
      t.llm.queueAgentTurn({
        content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "免调工具，直接收尾。" }], provenance: [] })],
      });
      await runAgent(t, "task_builtin_c3b", SEED_AGENT_ID);
      const names = (t.llm.agentRequests[0]?.tools ?? []).map((x) => x.name);
      const mcpFace = names.filter((n) => n.startsWith("mcp__"));
      const visibleSolvers = names.filter((n) => n.startsWith("mcp__solvers__"));
      // eslint-disable-next-line no-console
      console.log(`\n  ── C3b 原生臂模型面 · MCP 工具（${mcpFace.length} 件）──\n  ${mcpFace.join("\n  ")}\n`);
      // 独立重算：授予的求解器件数 = seed 里那条 ref 的 toolFilter 原文（本文件不手抄 16）
      const solverRef = agent.tools.find(
        (x) => x.kind === "MCP" && ((x as { toolFilter?: string[] }).toolFilter ?? []).some((n) => n.startsWith("mcp__solvers__")),
      );
      const grantedSolvers = ((solverRef as { toolFilter?: string[] })?.toolFilter ?? []).filter((n) =>
        n.startsWith("mcp__solvers__"),
      );
      // 金丝雀：收窄**真在跑**（可见求解器 < 授予求解器），否则下面「内置工具面在」可能只是收窄压根没生效
      expect(grantedSolvers.length).toBeGreaterThan(8);
      expect(visibleSolvers.length, "top-k 收窄生效（可见 < 授予）").toBeLessThan(grantedSolvers.length);
      expect(visibleSolvers.length).toBeGreaterThan(0);
      // 主判据①：内置工具面在模型面上
      expect(names, "内置工具面在模型面（豁免生效）").toContain(FULL);
      expect(names.filter((n) => n.startsWith(`mcp__${BUILTIN_MCP_SERVER}__`)).length, "恰一件，不许重复").toBe(1);
      // 主判据②（与①合起来才是完全判别式）：**参与收窄的那一面恰为 top-k=8**。
      // 收窄面 = `mcpSpecs` 里的非内置项（本体/求解器/规则）；工作流面 binding 是 WORKFLOW，
      // 从来不进 `mcpSpecs` ⇒ 两边都从集合里排掉后再数。
      // 两条反事实各被一条咬住：① 若内置面留在收窄集合里且 query_objects 排进 top-k ⇒ 这条变成 7；
      //                         ② 若它没排进 top-k ⇒ 上面的 `toContain(FULL)` 红。
      const routerFace = names.filter(
        (n) => n.startsWith("mcp__") && !n.startsWith(`mcp__${BUILTIN_MCP_SERVER}__`) && !n.startsWith("mcp__workflow__"),
      );
      expect(routerFace.length, "收窄面恰为 top-k(8)（内置面不占名额）").toBe(8);
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── C3b 原生臂模型面 · MCP 工具（${mcpFace.length} 件）──\n  ${mcpFace.join("\n  ")}\n` +
          `  （授予求解器 ${grantedSolvers.length} 件 → 可见 ${visibleSolvers.length} 件 ⇒ top-k 真在跑）\n`,
      );
    } finally {
      await t.app.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D 组 · 迁前/迁后对照（同一条能力，换载体：hostTools 反向通道 → mcpServers 原生面）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-BUILTIN-TO-DSH · D 组：迁前/迁后单变量对照（setup 层）", () => {
  it("D1 迁前臂：裸 BUILTIN 授予 ⇒ 能力在 hostTools（平台组装的反向工具），DSH 侧零内置工具 server", async () => {
    const { spec, expanded } = await setupFromSeedAgent(preMigrationAgent(seedAnalyst()));
    expect(expanded.map((x) => x.name)).toContain(RAW);
    expect((spec.hostTools ?? []).map((x) => x.name), "迁前：能力在反向工具面").toContain(RAW);
    expect(
      (spec.mcpServers ?? []).map((m) => m.serverName),
      "迁前：DSH 侧没有内置工具 server（这就是「DSH 不知道它存在」的判据）",
    ).not.toContain(BUILTIN_MCP_SERVER);
  });

  it("D2 迁后臂：同一条能力改走 MCP ⇒ DSH 侧有 server 且允许表恰为一件；除该条外两臂逐字同", async () => {
    const post = await setupFromSeedAgent(seedAnalyst());
    const pre = await setupFromSeedAgent(preMigrationAgent(seedAnalyst()));
    // 迁后
    expect((post.spec.mcpServers ?? []).map((m) => m.serverName)).toContain(BUILTIN_MCP_SERVER);
    expect((post.spec.hostTools ?? []).map((x) => x.name)).not.toContain(RAW);
    // 单变量：除这一条外，两臂的其余授予逐字同（证明对照不是「整表被换掉」）
    const strip = (names: string[], drop: string[]) => names.filter((n) => !drop.includes(n)).sort();
    const postNames = strip(post.expanded.map((x) => x.name), [FULL]);
    const preNames = strip(pre.expanded.map((x) => x.name), [RAW]);
    expect(postNames).toEqual(preNames);
    // 能力在两条臂上都是**恰一件**（不许多/不许少）
    expect(post.expanded.filter((x) => x.name.startsWith(`mcp__${BUILTIN_MCP_SERVER}__`)).length).toBe(1);
    expect(pre.expanded.filter((x) => x.name === RAW).length).toBe(1);
  });

  it("D3 反向对照臂（判据③·setup 层）：挂载在但授予面不含它 ⇒ 展开面/允许表一起没有它（同 server 另一件仍在）", async () => {
    const un = await setupFromSeedAgent(ungrantedAgent(seedAnalyst()));
    const names = un.expanded.map((x) => x.name);
    expect(names, "授予面拿掉 ⇒ 展开面没有它").not.toContain(FULL);
    expect(names, "裸名也没有（两条路都不该有）").not.toContain(RAW);
    const allow = (un.spec.tools ?? []).map((x) => x.name);
    expect(allow).not.toContain(FULL);
    // 金丝雀（有鉴别力）：**同一个 server 的**另一件仍在 ⇒ 那条读数不是「整体塌了」伪装成「拿掉了」
    const swapped = builtinMcpToolName(UNGRANTED_SWAP);
    expect(names, "同 server 换授的那件在").toContain(swapped);
    expect(allow).toContain(swapped);
    const builtinServer = un.spec.mcpServers?.find((m) => m.serverName === BUILTIN_MCP_SERVER);
    expect(builtinServer?.toolAllowlist, "wire 侧允许表 = 换授后的那一件").toEqual([swapped]);
    // 其余面不受影响
    expect((un.spec.hostTools ?? []).map((x) => x.name)).toContain("get_object");
    expect(allow.some((n) => n.startsWith("mcp__solvers__"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E 组 · e2e 真跑（真 DSH 分叉 + stub LLM）：迁后臂 vs 迁前臂 + 反向对照
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-BUILTIN-TO-DSH · E 组：真跑的 run 记录（迁前 / 迁后同一条 query）", () => {
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

  it("E1 迁后（DSH 原生 MCP）：模型面有 mcp__builtin__query_objects ∧ 真调 ∧ 数据面真查 ∧ 审计行（裸名）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: FULL, arguments: ARGS_ORDER }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, seedAnalyst());
      const querySpy = vi.spyOn(t.dataCore.ontology, "queryObjects");
      const result = await runAgent(t, "task_builtin_e1", SEED_AGENT_ID);
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");

      // ① 模型可见面：全名 + 描述逐字 = MCP 广告（这一面是 MCP 客户端注册出来的）
      const visible = stubVisibleTools(stub);
      const names = visible.map((x) => x.name);
      expect(names, "模型可见工具面").toContain(FULL);
      expect(names, "裸名不在模型面").not.toContain(RAW);
      const advertised = buildBuiltinMcpTools().find((x) => x.rawName === RAW)!;
      expect(visible.find((x) => x.name === FULL)?.description, "描述逐字 = MCP 广告文本").toBe(advertised.description);
      // 金丝雀：模型面没空掉（否则上面 not.toContain 恒真）
      expect(names.length).toBeGreaterThan(5);

      // ② 真调用：数据面被真打到，实参逐键 = 模型给的
      const modelCalls = querySpy.mock.calls.filter(
        (c) => c[1] === "Order" && JSON.stringify(c[2]) === JSON.stringify({ baseId: "base-cz" }) && c[3] === 5,
      );
      expect(modelCalls.length, "模型那一次查询恰一次").toBe(1);

      // ③ 同一只 host executor ⇒ 落一行审计（名归一到裸名，不是全名）
      const rows = await t.repos.toolCalls.listByTask("task_builtin_e1");
      const row = rows.find((r) => r.toolName === RAW);
      expect(row?.outcome, "内置工具审计行").toBe("OK");
      expect(row!.id).toMatch(/^tc_/);
      expect(rows.find((r) => r.toolName === FULL), "审计面不许有全名行（有 = 两条路都执行过）").toBeUndefined();

      // ④ 回执真回模型面：下一轮请求体里逐字可见 <tool_data tool_call_id="tc_…">
      const second = JSON.stringify(stub.requests[1]!.body);
      expect(second, "回执上模型面").toContain(`<tool_data tool_call_id=\\"${row!.id}\\">`);
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

  it("E2 迁前（对照臂·同一 query）：能力在反向工具面（裸名）∧ DSH 侧零内置工具 server ∧ 同一执行体同一行审计名", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: RAW, arguments: ARGS_ORDER }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, preMigrationAgent(seedAnalyst()));
      const querySpy = vi.spyOn(t.dataCore.ontology, "queryObjects");
      const result = await runAgent(t, "task_builtin_e2", SEED_AGENT_ID);
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");

      const visible = stubVisibleTools(stub);
      const names = visible.map((x) => x.name);
      // 迁前判据：模型面**只有裸名**，全名一个都没有 —— 这就是「DSH 不知道这族工具有身份」
      expect(names, "迁前：能力以裸名到达模型面").toContain(RAW);
      expect(names, "迁前：DSH 侧没有任何 mcp__builtin__* 身份").not.toContain(FULL);
      expect(names.filter((n) => n.startsWith(`mcp__${BUILTIN_MCP_SERVER}__`)), "迁前：零条内置工具 MCP 工具").toEqual([]);
      // 能力仍在（对照不是「把能力删了」）：数据面同样真执行、实参逐字同
      const modelCalls = querySpy.mock.calls.filter(
        (c) => c[1] === "Order" && JSON.stringify(c[2]) === JSON.stringify({ baseId: "base-cz" }) && c[3] === 5,
      );
      expect(modelCalls.length, "迁前臂：模型那一次查询恰一次").toBe(1);
      const rows = await t.repos.toolCalls.listByTask("task_builtin_e2");
      expect(rows.find((r) => r.toolName === RAW)?.outcome, "同一只 host executor、同一行审计名").toBe("OK");
      // 金丝雀：模型面没空掉（否则上面 not.toContain 恒真）
      expect(names.length).toBeGreaterThan(5);
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── E2 迁前臂 · 模型面里 name 含 query 的那条 ──\n` +
          `  ${names.filter((n) => n.includes("query")).join(", ") || "(无)"}\n` +
          `  ── 审计行 ──\n  ${JSON.stringify(rows.map((r) => `${r.toolName}/${r.outcome}`))}\n`,
      );
    } finally {
      await close();
      await stub.close();
    }
  });

  it("E3 反向对照（判据③·e2e）：授予面拿掉 ⇒ DSH 侧模型面**没有它** ∧ 宿主零数据面调用（那条读数是活的）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      // 模型**照旧**点名它（幻觉/陈旧剧本）——授予面已拿掉，DSH 侧不该让它到达数据面
      // ⚠ 探针实参带 `probe` 标记：数据面实参统计**只认这一条**（mock 的目录统计等内部调用
      //   也会打 `queryObjects`，把它们算进来会得到「拿掉之后还调了 N 次」的假红）。
      { toolCall: { name: FULL, arguments: JSON.stringify({ objectType: "Order", filter: { probe: "e3" }, limit: 5 }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, ungrantedAgent(seedAnalyst()));
      const querySpy = vi.spyOn(t.dataCore.ontology, "queryObjects");
      const result = await runAgent(t, "task_builtin_e3", SEED_AGENT_ID);
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");

      const names = stubVisibleTools(stub).map((x) => x.name);
      // 判据③：同一条读数（DSH 侧模型面）在授予面拿掉之后**读不到它** ⇒ 那条读数不是恒有
      expect(names, "授予面拿掉 ⇒ DSH 侧看不到它").not.toContain(FULL);
      expect(names, "裸名形态也不在").not.toContain(RAW);
      // 金丝雀（有鉴别力）：**同一个 server 的**换授件仍在模型面 ⇒ 不是「整体塌了」
      expect(names, "同 server 换授的那件在模型面").toContain(builtinMcpToolName(UNGRANTED_SWAP));
      // 失败必须点名：调用未授予的工具 ⇒ 该次调用**不许静默成功**（宿主零数据面实参）
      const qoCalls = querySpy.mock.calls.filter((c) => JSON.stringify(c[2]).includes("probe"));
      expect(qoCalls.length, "宿主零数据面调用（fail-closed）").toBe(0);
      const rows = await t.repos.toolCalls.listByTask("task_builtin_e3");
      expect(rows.some((r) => r.toolName === RAW && r.outcome === "OK"), "不许有 OK 审计行").toBe(false);
      // 金丝雀：模型面/工具面没空掉（否则上面「读不到」可能是整体塌了）
      expect(names.length).toBeGreaterThan(5);
      expect(names.some((n) => n.startsWith("mcp__solvers__"))).toBe(true);
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── E3 反向对照 · 模型面里的内置工具面 ──\n` +
          `  ${names.filter((n) => n.includes(BUILTIN_MCP_SERVER)).join(", ") || "(无 —— 授予面拿掉后确实读不到)"}\n` +
          `  ── 审计行 ──\n  ${JSON.stringify(rows.map((r) => `${r.toolName}/${r.outcome}`))}\n`,
      );
    } finally {
      await close();
      await stub.close();
    }
  });

  it("E4 §4.2 端到端：DSH 臂上调它读**域外**对象 ⇒ 对象域门照样拒（正文点名）∧ 域内放行", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      // 域外类型（声明面只有 Base）+ 带 `probe` 标记的实参（见 E3 注：只认这一条）
      { toolCall: { name: FULL, arguments: JSON.stringify({ objectType: "Line", filter: { probe: "e4" } }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      // 声明面收窄到 Base（出厂 analyst 的域里有 Line ⇒ 本臂刻意用**域外**的 Line 探针）
      await seedWorld(t, seedAnalyst({ scopeDeclaration: { ...seedAnalyst().scopeDeclaration, objectTypes: ["Base"] } }));
      const querySpy = vi.spyOn(t.dataCore.ontology, "queryObjects");
      const result = await runAgent(t, "task_builtin_e4", SEED_AGENT_ID, { enforceObjectScope: true });
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");
      // 门在水位上：模型面回执点名 AGENT_SCOPE_VIOLATION（loop.ts 第一支文案逐字）
      const req1 = JSON.stringify(stub.requests[1]!.body);
      expect(req1, "scope 类 DENIED 文案逐字等").toContain("AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明");
      // 且真的没到数据面 + 审计行是 DENIED
      expect(
        querySpy.mock.calls.filter((c) => JSON.stringify(c[2]).includes("probe")).length,
        "域外调用零数据面实参",
      ).toBe(0);
      const rows = await t.repos.toolCalls.listByTask("task_builtin_e4");
      expect(rows.map((r) => [r.toolName, r.outcome])).toEqual([[RAW, "DENIED"]]);
      expect(JSON.stringify(rows[0]!.output), "拒绝 payload 带越界事实").toContain("AGENT_SCOPE_VIOLATION");
    } finally {
      await close();
      await stub.close();
    }
  });
});
