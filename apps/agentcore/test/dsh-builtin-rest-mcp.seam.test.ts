/**
 * WO-BUILTIN-MIGRATE-REST · **剩余内置工具（BUILTIN）分批迁 DSH 原生 MCP 面**的接缝套件。
 *
 * 前两批（模板）：`dsh-rules-mcp.seam.test.ts`（`evaluate_rules` → `mcp__rules__*`）、
 * `dsh-builtin-mcp.seam.test.ts`（试点件 `query_objects` → `mcp__builtin__query_objects`）。
 * 本文件是**同一套写法的第三份**，被测量的对象是「批次 1」及其后各批（每批把 `MIGRATED` 加长）。
 *
 * **今天的行为是 X**（迁移前）：这些工具只能靠 `agent.tools` 里的 `{kind:"BUILTIN", name}` 授予 +
 * `setup.hostTools` 反向工具通道到达模型面 —— DSH 侧对它们零身份（`tools/list` 里没有、
 * 命名空间里没有 `mcp__*`）。**应该是 Y**：授予改挂 `mcp__builtin__*`，DSH 侧真 spawn 出 server、
 * `tools/list` 真读得到，而**执行体一个字没换**（MCP wire → 反向通道 → 同一只 GuardedToolExecutor）。
 *
 * 分组（照抄前两批的结构）：
 *   A = DSH 侧真身（真 stdio 客户端 → 真 spawn → tools/list、tools/call、fail-closed）
 *   B = 执行归一 + **三样不许松**（scope 门全名 / 对象域门 / 截断豁免身份）
 *   C = 三面同改（授予面 ∧ 挂载面 ∧ 声明面；出厂种子真值 + engine 真装配 + Phase6C 豁免）
 *   D = 迁前/迁后单变量对照（setup 层）+ 反向对照
 *   E = e2e 真跑（真 DSH 分叉 + stub LLM）：迁后臂 vs 迁前臂（同一条 query）+ 反向对照 + 失败点名
 *
 * 【每条断言独立重算出处】
 *  · A1 工具名/描述/入参 —— 用**模板串**独立拼全名，描述与入参模式取 `BUILTIN_TOOLS` 注册表**原文**。
 *  · A2 宿主收到的 toolName/input —— 本文件起的 HTTP 回环**逐字节记录**请求体。
 *  · B 归一 —— 判据是执行器**真落行**的审计名（自建 repos 直查），不调生产 helper 反推。
 *  · C 三面 —— 取 `seedRegistry()` / `expandAgentTools` 真跑结果；「该有几件」由**注册表现算**
 *    （`BUILTIN_TOOLS` − 专属面 − 已迁），不手抄名单。
 *  · E 模型可见面 —— 取 stub 首轮请求体 `tools[]`；执行证据取真审计行 + 下一轮请求体原文。
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
import { toolUse } from "../src/llm/mock.js";
import { seedRegistry, seedMcpConfigs } from "../src/mocks/seed.js";
import { buildSessionSetup } from "../src/dsh-runtime/setup-spec.js";
import { BUILTIN_TOOLS } from "../src/tools/registry.js";
import { isTruncationExemptTool } from "../src/agent/loop.js";
import { reflectAnswer } from "../src/agent/reflect.js";
import { scopeCanInvokeSolvers } from "../src/agent/navigation-slice.js";
import { promoteFallbackTrace } from "../src/ops/fallback.js";
import { renderFailedCallsBlock } from "../src/agent/failure-disclosure.js";
import {
  BUILTIN_MCP_CONFIG_ID,
  BUILTIN_MCP_DESC_PREFIX,
  BUILTIN_MCP_SERVER,
  BUILTIN_MCP_TOOL_NAMES,
  buildBuiltinMcpTools,
  builtinMcpToolName,
  parseBuiltinMcpToolName,
} from "../src/mcp/builtin-mcp.js";
import { ONTOLOGY_MCP_TOOL_NAMES } from "../src/tools/ontology-mcp.js";
import { RULES_MCP_TOOL_NAMES } from "../src/mcp/rules-mcp.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = `${REPO_ROOT}packages/dsh-harness`;
const SERVER_PATH = fileURLToPath(new URL("../dist/dsh-runtime/builtin-mcp-server.js", import.meta.url));

const SEAM_TIMEOUT = 90_000;
const CTX: ToolAuthCtx = { tenantId: TENANT, userId: "u", roles: ["planner"] };
const FAKE_LLM_KEY = "wo-builtin-rest-fake-llm-key-000000000000000000";
const SERVICE_TOKEN = "wo-builtin-rest-service-token-000000000000";

/** ⛔ 独立重算（不调 builtinMcpToolName）：全名 = mcp__{server}__{raw}。 */
const full = (raw: string): string => `mcp__${BUILTIN_MCP_SERVER}__${raw}`;

/**
 * 本单**批次台账**（独立重算：按工单的批次清单在这里再写一遍，不 import seed 的私有数组）。
 * 上两个批次的件也在列 —— 同一台机器量全表，免得「已迁」与「未迁」两套口径各说各话。
 * ⚠ 每进一批：**只往这个数组里加这一批**，其余断言自动跟随（金丝雀随之缩短）。
 */
const MIGRATED: readonly string[] = [
  // 批次 0（试点件 · WO-BUILTIN-TO-DSH）
  "query_objects",
  // 批次 1（本单 · WO-BUILTIN-MIGRATE-REST）
  "get_object",
  "aggregate_objects",
  "search_knowledge",
  "query_timeseries_agg",
  "search_experience",
  // 批次 2（本单）
  "discover",
  "retrieve_knowledge",
  "query_ontology",
  "query_system_ontology",
  // 批次 3（本单）：写路径与求解入口（硬骨头：三处按裸名认 invoke_solver 的判据已改按身份）
  "get_breakpoint",
  "impact_of",
  "read_skill_resource",
  "create_action_draft",
  "invoke_solver",
  // 批次 4（本单）：合规合成/建域（CL.2 三件）+ 推演指挥台（SIM_COMMANDER_TOOLS 四件里的前两件）
  "fill_data",
  "run_synthetic",
  "build_domain",
  "sim_init",
  "sim_tick",
];

/** 专属面（各自的内置 server 承载，不在内置工具 server 上）：本体两件 + 规则一件。 */
const DEDICATED: ReadonlySet<string> = new Set<string>([
  ...(ONTOLOGY_MCP_TOOL_NAMES as readonly string[]),
  ...(RULES_MCP_TOOL_NAMES as readonly string[]),
]);

/** 内置工具 MCP server 的**全部**成员（注册表现算 —— 判据是「注册表 − 专属面」，不手抄）。 */
const SERVER_ROSTER: readonly string[] = BUILTIN_TOOLS.map((t) => t.name).filter((n) => !DEDICATED.has(n));

/** 本批**仍未迁**的件（= 花名册 − 已迁）：它们**必须仍在反向通道上** —— 反向金丝雀。 */
const NOT_YET_MIGRATED: readonly string[] = SERVER_ROSTER.filter((n) => !MIGRATED.includes(n));

/**
 * 通用 agent 的裸名面 = **注册表 − 本体专属 − 已迁**（与 seed 侧那条 filter 同一条判据，
 * 但在这里独立再算一遍）。比 `NOT_YET_MIGRATED` 多一件 `evaluate_rules` —— 它在**规则面**上，
 * 不在本 server 的花名册里，本单最后一批才迁它。
 */
const EXPECT_GENERAL_BARE: readonly string[] = BUILTIN_TOOLS.map((t) => t.name).filter(
  (n) => !(ONTOLOGY_MCP_TOOL_NAMES as readonly string[]).includes(n) && !MIGRATED.includes(n),
);

const SEED_AGENT_ID = "agt_seed_analyst";
const GENERAL_AGENT_ID = "agt_general";

/** analyst 迁前真正持有的内置件（= 试点件 + 批次 1 的四件；它从未持有 aggregate_objects）。 */
const EXPECT_ANALYST_RAW = ["query_objects", "get_object", "search_knowledge", "query_timeseries_agg", "search_experience"] as const;

/** 每件的「能跑通」最小入参（B2 逐件真跑用；业务语义不是这条断言的判据 —— 归一才是）。 */
const MIN_INPUT: Record<string, Record<string, unknown>> = {
  query_objects: { objectType: "Order", filter: {} },
  get_object: { objectType: "Order", objectId: "o-probe" },
  aggregate_objects: { typeKey: "Order", metrics: [{ prop: "value", fn: "sum" }] },
  search_knowledge: { query: "订单" },
  query_timeseries_agg: { seriesKey: "output", entityIds: ["line-1"], window: { from: "2026-01-01", to: "2026-01-07", grain: "day" }, agg: "avg" },
  search_experience: { query: "产能" },
  discover: { kind: "object_types" },
  retrieve_knowledge: { query: "产能瓶颈" },
  query_ontology: { rootType: "Base", select: [] },
  query_system_ontology: {},
  get_breakpoint: { id: "G-1" },
  impact_of: { node: "I1" },
  read_skill_resource: { skillId: "skl_seed_capacity", resourceName: "x" },
  create_action_draft: { actionType: "capacity_action", payload: { probe: "b2" } },
  invoke_solver: { solverKey: "gap_attribution", args: { probe: "b2" } },
  fill_data: { typeKey: "PlanTarget", fields: ["period", "value"], rows: 6 },
  run_synthetic: { industry: "battery-manufacturing", scale: "M", seed: 42 },
  build_domain: { story: "本月计划未达成原因" },
  sim_init: { scope: { view: "risk" } },
  // sim_tick 必须有会话才走得通；最小装置里没有前置 sim_init ⇒ 诚实落 ERROR（B2 只咬归一与审计名，
  // 不咬业务的四态 —— 同批的 get_object / read_skill_resource 在批次 1/3 也是 ERROR）。
  sim_tick: { sessionId: "sims_probe", n: 1 },
};

/** 同批：`discover` 一族走**探索配额**（`DISCOVER_TOOLS`）—— 归一后配额判据必须仍咬得住。 */
const DISCOVER_FAMILY: readonly string[] = ["discover", "search_experience", "query_system_ontology", "retrieve_knowledge"];

const PLAIN_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };
const FINAL_ANSWER_ARGS = JSON.stringify({
  blocks: [{ type: "text", markdown: "已读到所需数据，结论见下。" }],
  provenance: [],
});
/**
 * e2e 探针（入参带 probe 标记 ⇒ 数据面实参统计只认这一条）。
 * ⚠ 每进一批把它换成**本批**的一件：判据① 要的是「本批的这件」迁前迁后逐键相同。
 * 批次 4 = `fill_data`（CL.2 合规合成首件；数据面落
 * `dataCore.ontology.fillData(ctx, {typeKey, fields, rows})` —— 入参可辨认）。
 */
const PROBE_RAW = "fill_data";
/** 探针实参：`fields` 里这个串是**数据面实参统计的识别标记**（只认这一条，免得把内部调用算进来）。 */
const PROBE_MARKER = "wo-builtin-rest-probe";
const PROBE_TYPE_KEY = "Order";
const PROBE_ARGS = JSON.stringify({ typeKey: PROBE_TYPE_KEY, fields: [PROBE_MARKER], rows: 3 });
/**
 * 探针件的**持有者**（出厂种子里第一个授予它的 agent）。判据① 必须用它跑 ——
 * 用一个没被授予该件的 agent 跑，模型面压根没有它（那量的是别的东西）。
 */
const PROBE_AGENT_ID: string = (() => {
  const holder = seedRegistry().agents.find((a) => rawOfFilter(builtinRef(a)).includes(PROBE_RAW));
  if (!holder) throw new Error(`出厂种子里没有 agent 持有 ${PROBE_RAW}`);
  return holder.id;
})();

/** 数据面读法：`fill_data` 落到 `dataCore.ontology.fillData(ctx, {typeKey, fields, rows})`。 */
const probeCallsOf = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(
    (c) =>
      (c[1] as { typeKey?: string } | undefined)?.typeKey === PROBE_TYPE_KEY &&
      ((c[1] as { fields?: string[] } | undefined)?.fields ?? []).includes(PROBE_MARKER),
  );

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

/**
 * 判据①（迁前/迁后**同一条 query、同一个 agent** 的 run 记录对照）用的两个槽位：
 * E1（迁后臂）写入，E2（迁前臂）写入后**当场逐键比**并把两臂原文打到屏上（证据档取该输出）。
 * 四键 = 同一只 executor / 同一行审计名 / 同一份实参 / 同一份回执，**只有载体变**。
 */
interface ArmRecord {
  carrier: string;
  auditName: string;
  outcome: string;
  inputJson: string;
  outputJson: string;
  receiptInner: string;
}
const arms: { post?: ArmRecord; pre?: ArmRecord } = {};

/** 从模型面回执原文里剥出 <tool_data …> 的**内层 JSON**（外层属性含 per-call id，不参与逐字比）。 */
function receiptInnerOf(text: string): string {
  const m = /^<tool_data[^>]*>([\s\S]*)<\/tool_data>$/.exec(text.trim());
  return m ? m[1]! : text;
}

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
  const client = new Client({ name: "wo-builtin-rest-test", version: "0.0.1" });
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

/** 出厂 agent 原样取出，只覆写模型（tools/scopeDeclaration/systemPrompt 全是出厂值）。 */
function seedAgent(id: string, overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  const base = seedRegistry().agents.find((a) => a.id === id);
  if (!base) throw new Error(`seed agent not found: ${id}`);
  return { ...base, model: STUB_DCP_SPEC, kernel: "EXTERNAL", ...overrides } as AgentDefinition;
}
const seedAnalyst = (overrides: Partial<AgentDefinition> = {}) => seedAgent(SEED_AGENT_ID, overrides);

/** 取 agent 的内置工具 MCP 授予 ref（缺省 = 该 agent 没有这条 ref）。 */
function builtinRef(agent: AgentDefinition): { toolFilter?: string[] } | undefined {
  return agent.tools.find((t) => t.kind === "MCP" && t.mcpConfigId === BUILTIN_MCP_CONFIG_ID) as { toolFilter?: string[] } | undefined;
}

/** 授予 ref 的 toolFilter → 裸名集（本文件独立剥前缀，不调生产 parse）。 */
function rawOfFilter(ref: { toolFilter?: string[] } | undefined): string[] {
  return (ref?.toolFilter ?? []).map((n) => n.slice(`mcp__${BUILTIN_MCP_SERVER}__`.length));
}

/** agent 的内置工具 MCP 授予面**全名**集（无 ref ⇒ 空数组）。 */
function expandedBuiltinNamesOf(agent: AgentDefinition): string[] {
  return builtinRef(agent)?.toolFilter ?? [];
}

/**
 * **迁前形态**（对照臂）：把**已迁**的这批从 MCP 授予撤掉，换回改造前的裸 BUILTIN 授予。
 * 单变量对照 —— 除「这批工具走哪个载体」之外，授予/声明/挂载三面逐字同（其余工具一律不动）。
 */
function preMigrationAgent(agent: AgentDefinition): AgentDefinition {
  // ⚠ 只回退**它真正持有的那些件**（= 它的 MCP 授予表），⛔ 不是把整张 `MIGRATED` 一律塞成裸名 ——
  // 后者会给一个从未持有某件的 agent「凭空加能力」，单变量对照当场失真。
  const reverted = rawOfFilter(builtinRef(agent)).filter((n) => MIGRATED.includes(n));
  const kept = rawOfFilter(builtinRef(agent)).filter((n) => !MIGRATED.includes(n));
  return {
    ...agent,
    tools: [
      ...agent.tools.filter((t) => !(t.kind === "MCP" && t.mcpConfigId === BUILTIN_MCP_CONFIG_ID)),
      ...reverted.map((n): AgentDefinition["tools"][number] => ({ kind: "BUILTIN", name: n })),
      ...(kept.length
        ? [{ kind: "MCP", mcpConfigId: BUILTIN_MCP_CONFIG_ID, toolFilter: kept.map((n) => builtinMcpToolName(n)) } as AgentDefinition["tools"][number]]
        : []),
    ] as AgentDefinition["tools"],
    ...(kept.length ? {} : { mcpServers: agent.mcpServers.filter((m) => m.mcpConfigId !== BUILTIN_MCP_CONFIG_ID) }),
    scopeDeclaration: {
      ...agent.scopeDeclaration,
      toolNames: agent.scopeDeclaration.toolNames.map((n) => {
        const raw = parseBuiltinMcpToolName(n);
        return raw && MIGRATED.includes(raw) ? raw : n;
      }),
    },
  } as AgentDefinition;
}

/**
 * **单变量前臂（判一件）**：只把 `raw` 这一件从 MCP 面回退成裸 BUILTIN 授予，其余一律不动。
 * e2e 的判据① 要的正是「同一条 query、同一个 agent、只有**这一件**换了载体」。
 */
function preMigrationOne(agent: AgentDefinition, raw: string): AgentDefinition {
  const before = expandedBuiltinNamesOf(agent);
  const after = before.filter((n) => n !== builtinMcpToolName(raw));
  return {
    ...agent,
    tools: [
      ...agent.tools.filter((t) => !(t.kind === "MCP" && t.mcpConfigId === BUILTIN_MCP_CONFIG_ID)),
      ...(after.length ? [{ kind: "MCP", mcpConfigId: BUILTIN_MCP_CONFIG_ID, toolFilter: after } as AgentDefinition["tools"][number]] : []),
      { kind: "BUILTIN", name: raw },
    ] as AgentDefinition["tools"],
    scopeDeclaration: {
      ...agent.scopeDeclaration,
      toolNames: agent.scopeDeclaration.toolNames.map((n) => (n === builtinMcpToolName(raw) ? raw : n)),
    },
  } as AgentDefinition;
}

/** **单变量反向对照（判一件）**：只把 `raw` 从授予面拿掉，并换授同 server 的另一件（在金丝雀用）。 */
function ungrantedOne(agent: AgentDefinition, raw: string): AgentDefinition {
  const swapped = builtinMcpToolName(UNGRANTED_SWAP);
  const kept = expandedBuiltinNamesOf(agent).filter((n) => n !== builtinMcpToolName(raw) && n !== swapped);
  return {
    ...agent,
    tools: agent.tools.map((t) =>
      t.kind === "MCP" && t.mcpConfigId === BUILTIN_MCP_CONFIG_ID ? { ...t, toolFilter: [...kept, swapped] } : t,
    ) as AgentDefinition["tools"],
    scopeDeclaration: {
      ...agent.scopeDeclaration,
      toolNames: [
        ...agent.scopeDeclaration.toolNames.filter((n) => n !== builtinMcpToolName(raw)),
        ...(agent.scopeDeclaration.toolNames.includes(builtinMcpToolName(raw)) ? [swapped] : []),
      ],
    },
  } as AgentDefinition;
}

/**
 * **反向对照形态**（判据③）：MCP 挂载在、但授予面（toolFilter）**不含**已迁的这批。
 * 换授同 server 的**另一件**（还没迁的一件）—— 证明「读不到」不是「整台 server 塌了」。
 */
/** 反向对照的「换授件」= **同 server 尚未迁**的一件（全迁完之后退到花名册首件，仍同 server）。 */
const UNGRANTED_SWAP: string = NOT_YET_MIGRATED[0] ?? SERVER_ROSTER[0]!;
function ungrantedAgent(agent: AgentDefinition): AgentDefinition {
  const swapped = builtinMcpToolName(UNGRANTED_SWAP);
  const kept = rawOfFilter(builtinRef(agent)).filter((n) => !MIGRATED.includes(n));
  return {
    ...agent,
    tools: agent.tools.map((t) =>
      t.kind === "MCP" && t.mcpConfigId === BUILTIN_MCP_CONFIG_ID
        ? { ...t, toolFilter: [...kept.map((n) => builtinMcpToolName(n)), swapped] }
        : t,
    ) as AgentDefinition["tools"],
    scopeDeclaration: {
      ...agent.scopeDeclaration,
      toolNames: [
        ...agent.scopeDeclaration.toolNames.filter((n) => {
          const raw = parseBuiltinMcpToolName(n);
          return !(raw && MIGRATED.includes(raw));
        }),
        swapped,
      ],
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
    // WO-CLOSE-NATIVE-GAPS 之后内核不由 agent 数据决定 —— 真 DSH 臂要走测试装配位。
    kernelRuntime: "dsh",
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
    prompt: opts.prompt ?? "常州基地的产能与订单情况如何？",
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
 * seed 授予面 → engine 真装配（`expandAgentTools` 真跑）→ `buildSessionSetup`（与 engine.ts DSH
 * 分叉处同形：内置工具 server 无需 per-run 工具目录 env —— 工具集平台固定，走静态投影）。
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

/** 裸执行器（自建 repos 直查审计行）：量**归一**这一件事时的最小装置。 */
function bareExecutor() {
  const repos = createMemoryRepos();
  const ex = new GuardedToolExecutor(
    { repos, dataCore: createMockDataCore(), metrics: new Metrics() } as never,
    { taskId: "task_norm", ctx: CTX } as never,
  );
  return { ex, repos };
}

// ═══════════════════════════════════════════════════════════════════════════
// A 组 · DSH 侧真身：真 stdio MCP 客户端 → 真 spawn → tools/list / tools/call
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-BUILTIN-MIGRATE-REST · A 组：DSH 侧真看到的这批工具（MCP wire 面）", () => {
  it("前置自证：server 入口文件真实存在 ∧ 花名册非空 ∧ 仍有未迁件（否则金丝雀恒真）", () => {
    expect(existsSync(SERVER_PATH), `缺入口 ${SERVER_PATH}（先 pnpm --filter agentcore build）`).toBe(true);
    expect(SERVER_ROSTER.length, "花名册 = 注册表 − 专属面").toBe(BUILTIN_MCP_TOOL_NAMES.length);
    expect(MIGRATED.length).toBeGreaterThan(0);
    expect(NOT_YET_MIGRATED.length, "本批之后仍有未迁件 ⇒「未迁仍在反向通道」那条不是对空集断言").toBeGreaterThan(0);
  });

  it("A1 tools/list（判据②）：真 spawn + 真握手，本批每一件都在 ∧ 名/描述/入参模式与注册表逐字同源", { timeout: SEAM_TIMEOUT }, async () => {
    const client = await connectServer({});
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    // 金丝雀：清单恰为花名册全量（少了 = 断言「在」会因「压根没广告」而假绿）
    expect(names.length).toBe(SERVER_ROSTER.length);
    expect(names.some((n) => n.startsWith("mcp__")), "wire 上必须是裸名（harness 侧自己拼前缀）").toBe(false);
    for (const raw of MIGRATED) {
      expect(names, `DSH 侧 tools/list 缺 ${raw}`).toContain(raw);
      const spec = listed.tools.find((t) => t.name === raw)!;
      const def = BUILTIN_TOOLS.find((d) => d.name === raw)!;
      expect(spec.description, `${raw} 描述 = 前缀 + 注册表原文`).toBe(`${BUILTIN_MCP_DESC_PREFIX}${def.descriptionForLLM}`);
      expect(spec.inputSchema, `${raw} 入参模式 = 注册表原文`).toEqual(def.inputSchema);
    }
    // 公开名（模型面）= 本文件独立拼的模板串（金丝雀：拼法本身对）
    expect(full("query_objects")).toBe("mcp__builtin__query_objects");
    // eslint-disable-next-line no-console
    console.log(
      `\n  ── A1 DSH 侧真 tools/list（${names.length} 件 · 真 spawn 子进程）──\n` +
        `  本批（模型面名）：${MIGRATED.map((r) => `${r}=${full(r)}`).join(" · ")}\n` +
        `  仍未迁（同 server 也广告，但出厂 agent 未授予 ⇒ 反向通道）：${NOT_YET_MIGRATED.join(" · ")}\n`,
    );
  });

  it("A2 tools/call：宿主收到的是**全名** + 入参逐键原文；模型面回执是逐字 <tool_data> 包络", { timeout: SEAM_TIMEOUT }, async () => {
    // 回执信封形态取自宿主端点契约（`mcp-host-bridge.ts` 认 `outcome` + `payloadJson` 两键）
    const loop = await startHostLoopback({
      outcome: "OK",
      payloadJson: '{"data":{"hits":[{"docId":"doc-9","text":"回环回执"}]},"snapshotVersion":"sv-1"}',
      toolCallId: "tc_loopback",
    });
    try {
      const client = await connectServer({
        PLATFORM_TOOL_EXEC_URL: loop.url,
        DSH_RUN_TOKEN: "tok-abcdef",
        DSH_TOOL_EXEC_TIMEOUT_MS: "5000",
      });
      const r = await client.callTool({ name: PROBE_RAW, arguments: JSON.parse(PROBE_ARGS) as Record<string, unknown> });
      expect(loop.seen.length).toBe(1);
      expect(loop.seen[0]!.toolName, "回宿主的是**全名**（scope 门按全名校验）").toBe(full(PROBE_RAW));
      expect(loop.seen[0]!.input, "入参逐键原文").toEqual(JSON.parse(PROBE_ARGS));
      const text = (r.content as { type: string; text: string }[])[0]!.text;
      expect(text, "回执逐字 = 宿主给的 payloadJson（不 parse/不 stringify）").toBe(
        '<tool_data tool_call_id="tc_loopback">{"data":{"hits":[{"docId":"doc-9","text":"回环回执"}]},"snapshotVersion":"sv-1"}</tool_data>',
      );
      expect(r.isError).toBeFalsy();
      // eslint-disable-next-line no-console
      console.log(`\n  ── A2 tools/call 回环 ──\n  宿主收到 toolName=${loop.seen[0]!.toolName} input=${JSON.stringify(loop.seen[0]!.input)}\n  模型面回执=${text.replace(/\s+/g, " ").slice(0, 220)}\n`);
    } finally {
      await loop.close();
    }
  });

  it("A3 对照（减输入）：无宿主桥 ⇒ fail-closed 明确失败 ∧ 不静默成功", { timeout: SEAM_TIMEOUT }, async () => {
    const client = await connectServer({});
    const r = await client.callTool({ name: PROBE_RAW, arguments: { query: "x" } });
    expect(r.isError, "无 runToken/URL ⇒ isError").toBe(true);
    const text = (r.content as { type: string; text: string }[])[0]!.text;
    expect(text.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`\n  ── A3 fail-closed（无宿主桥）──\n  ${text.replace(/\s+/g, " ").slice(0, 200)}\n`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B 组 · 归一 + 两门不许松（scope 门 / 对象域门 / 截断豁免身份）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-BUILTIN-MIGRATE-REST · B 组：MCP 全名归一回同一具执行体（门一道不松）", () => {
  it("B1 身份归一（逐件）：全名→裸名可逆 ∧ 裸名原样返回", () => {
    for (const raw of MIGRATED) {
      expect(parseBuiltinMcpToolName(full(raw)), `${raw} 全名归一`).toBe(raw);
      expect(parseBuiltinMcpToolName(raw), `${raw} 裸名不该被改`).toBeUndefined();
    }
    expect(full("query_objects")).toBe("mcp__builtin__query_objects");
  });

  it("B2 审计名归一（逐件真跑）：以**全名**调用本批每一件，落行名一律是**裸名** ∧ 不许落到 unknown-tool", async () => {
    const { ex, repos } = bareExecutor();
    const out: string[] = [];
    for (const raw of MIGRATED) {
      const r = await ex.run(full(raw), MIN_INPUT[raw] ?? {});
      const row = await repos.toolCalls.get(r.toolCallId);
      expect(row, `${raw}: 审计行真落库`).toBeTruthy();
      expect(row!.toolName, `${raw}: 审计名 = 裸名（归一没生效就会记成全名）`).toBe(raw);
      // 归一失守的第二种指纹：dispatch 落到 default 抛 unknown tool（那时 outcome=ERROR 且文案带全名）
      expect(JSON.stringify(row!.output ?? {}), `${raw}: 不许落到 unknown tool`).not.toContain("unknown tool");
      out.push(`${raw}/${r.outcome}`);
    }
    // eslint-disable-next-line no-console
    console.log(`\n  ── B2 逐件真跑（全名调用 → 审计行裸名）──\n  ${out.join(" · ")}\n`);
  });

  it("B3 对象域门（§4.2 一个字不许松）：域外对象照样被拒 ∧ 拒绝行记的是**裸名**（归一在门之前）∧ 域内放行", async () => {
    const repos = createMemoryRepos();
    const scoped = new GuardedToolExecutor(
      { repos, dataCore: createMockDataCore(), metrics: new Metrics() } as never,
      { taskId: "task_scope", ctx: CTX, scopeObjectTypes: ["Base"] } as never,
    );
    // 对象域门认的那三件（按身份，不按载体）——本批里占了 get_object / aggregate_objects
    const probes: Record<string, Record<string, unknown>> = {
      query_objects: { objectType: "Line", filter: {} },
      get_object: { objectType: "Line", objectId: "probe" },
      aggregate_objects: { typeKey: "Line", metrics: [{ prop: "value", fn: "sum" }] },
    };
    for (const [raw, input] of Object.entries(probes)) {
      const denied = await scoped.run(full(raw), input);
      expect(denied.outcome, `${raw} 域外对象 ⇒ DENIED`).toBe("DENIED");
      const row = await repos.toolCalls.get(denied.toolCallId);
      expect(row!.toolName, `${raw} 拒绝行记**裸名**（归一在门之前）`).toBe(raw);
      expect(JSON.stringify(row!.output), "拒绝 payload 带越界事实").toContain("AGENT_SCOPE_VIOLATION");
      // 对照实验：把 objectType 换回声明面内的 Base ⇒ 门放行（结果按可预言方式变）
      const inScope = await scoped.run(full(raw), { ...input, objectType: "Base", typeKey: "Base" });
      expect(inScope.outcome, `${raw} 域内不再被对象域门拒`).not.toBe("DENIED");
    }
  });

  it("B3b 工具 scope 门按**调用原名**判（本批耦合）：本批件以全名调用、声明面不含它 ⇒ DENIED 且拒绝行记**全名**；声明面补上全名即放行", async () => {
    // ⚠ 这一条与 B3 的区别是**门不同、拒绝行记法也不同**：B3 是对象域门（在归一**之后** ⇒ 记裸名），
    // 本条是步骤 0 的工具 scope 门（在归一**之前** ⇒ 记调用原名）。本批要证的是：`fill_data` 换了载体
    // 之后，门既不因「名字里多了前缀」而**误拒**（声明面记全名即放行），也不因载体而**放行越界**。
    const repos = createMemoryRepos();
    const mk = (taskId: string, scopeToolNames: string[]) =>
      new GuardedToolExecutor(
        { repos, dataCore: createMockDataCore(), metrics: new Metrics() } as never,
        { taskId, ctx: CTX, scopeToolNames } as never,
      );
    const denied = await mk("task_tool_scope", [full("query_objects")]).run(full(PROBE_RAW), MIN_INPUT[PROBE_RAW]!);
    expect(denied.outcome, "声明面不含它 ⇒ 全名形态照样被门咬住").toBe("DENIED");
    const deniedRow = await repos.toolCalls.get(denied.toolCallId);
    expect(deniedRow!.toolName, "工具 scope 门在归一之前 ⇒ 拒绝行记**调用原名**").toBe(full(PROBE_RAW));
    expect(JSON.stringify(deniedRow!.output), "拒绝 payload 带越界事实").toContain("AGENT_SCOPE_VIOLATION");
    // 对照实验：声明面换成它的**全名** ⇒ 同一入参放行（结果按可预言方式变，不是「门恒拒」）
    const allowed = await mk("task_tool_scope_ok", [full(PROBE_RAW)]).run(full(PROBE_RAW), MIN_INPUT[PROBE_RAW]!);
    expect(allowed.outcome, "声明面记全名 ⇒ 不被 scope 门误拒（这才是迁移要的形态）").not.toBe("DENIED");
    // 金丝雀：同一条门对**裸名**形态同样咬得住（证明上面不是「只认全名」的新病）
    const bareDenied = await mk("task_tool_scope_bare", ["sim_world"]).run(PROBE_RAW, MIN_INPUT[PROBE_RAW]!);
    expect(bareDenied.outcome, "裸名形态同样被拒（门不因载体而换判据）").toBe("DENIED");
  });

  it("B4 截断豁免集按**身份**判：全名形态照样豁免 ∧ 非豁免件不豁免", () => {
    expect(isTruncationExemptTool(full("query_timeseries_agg")), "时序聚合：全名形态仍豁免").toBe(true);
    expect(isTruncationExemptTool("query_timeseries_agg"), "裸名形态（反向通道）同样豁免").toBe(true);
    expect(isTruncationExemptTool(full("get_object")), "非豁免件不许被误豁免").toBe(false);
    expect(isTruncationExemptTool("get_object")).toBe(false);
  });

  it("B5 探索配额（`DISCOVER_TOOLS`）按**身份**咬：全名形态照样消耗同一份配额 ∧ 超额即 BUDGET_EXCEEDED", async () => {
    // 本批里 discover / query_system_ontology / retrieve_knowledge / search_experience 都在配额集里
    // ⇒ 归一失守时这条配额会**静默失效**（读到的名字对不上集合 ⇒ 不扣名额 ⇒ 白扫）。
    const t = await createTestApp();
    try {
      const repos = createMemoryRepos();
      const budget = new BudgetTracker({ maxDiscoverCalls: 1 });
      const ex = new GuardedToolExecutor(
        { repos, dataCore: createMockDataCore(), metrics: new Metrics() } as never,
        { taskId: "task_quota", ctx: CTX, budget } as never,
      );
      const first = await ex.run(full("discover"), { kind: "object_types" });
      expect(first.outcome, "第 1 次（全名）：还在配额内").not.toBe("BUDGET_EXCEEDED");
      const second = await ex.run(full("discover"), { kind: "object_types" });
      expect(second.outcome, "第 2 次（全名）：配额只用 1 ⇒ 必须超额").toBe("BUDGET_EXCEEDED");
      const row = await repos.toolCalls.get(second.toolCallId);
      expect(row!.toolName, "超额那行也记裸名").toBe("discover");
    } finally {
      await t.app.close();
    }
  });

  it("B7 求解能力判据按**身份**认（判据①的耦合）：全名形态照样算得出「调得动 solver」", () => {
    // `scopeCanInvokeSolvers` 决定「要不要去打活求解器目录」——认错了是**静默少一段**（不报错）
    expect(scopeCanInvokeSolvers([full("invoke_solver")]), "全名形态：调得动求解器").toBe(true);
    expect(scopeCanInvokeSolvers(["invoke_solver"]), "裸名形态（旧载体）同样成立").toBe(true);
    expect(scopeCanInvokeSolvers(["mcp__solvers__gap_attribution"]), "求解器 MCP 面成立").toBe(true);
    // 反向：本体/工作流面**不许**算成「调得动求解器」（否则每 run 白打一次活目录）
    expect(scopeCanInvokeSolvers([full("query_objects"), "mcp__ontology__resolve_slice", "mcp__workflow__capacity_check"])).toBe(false);
    // 金丝雀：未声明 = 不限（恒真那一支），证明上面三条 not-false 不是「函数恒真」
    expect(scopeCanInvokeSolvers(undefined)).toBe(true);
  });

  it("B8 复盘「求解纪律」按**身份**认（判据①的耦合）：iterations 里是全名也算「走了 solver」", () => {
    const base = {
      blocks: [{ type: "text" as const, markdown: "已按求解器结论作答，结论见下。" }],
      provenanceCount: 0,
      userContent: "帮我做排产优化",
    };
    const iter = (toolName: string) => [
      { index: 0, toolCalls: [{ toolCallId: "tc_1", toolName, input: {}, outcome: "OK" as const, durationMs: 1 }] },
    ];
    // 全名形态 ⇒ 不减「求解纪律」那条
    const ok = reflectAnswer({ ...base, iterations: iter(full("invoke_solver")) });
    // 对照（有鉴别力）：同一份输入、把工具换成别的 ⇒ 那条必须报出来
    const bad = reflectAnswer({ ...base, iterations: iter(full("query_objects")) });
    const hit = (v: { reasons: string[] }) => v.reasons.some((r) => r.includes("求解") || r.includes("solver"));
    expect(hit(ok), "全名 invoke_solver ⇒ 不算违规").toBe(false);
    expect(hit(bad), "换一件工具 ⇒ 求解纪律必须报出来（否则上一条是恒真）").toBe(true);
  });

  it("B9 失败→意图提升的 sketch 查表按**身份**认（判据①的耦合）：全名 sketch 仍出得一步、标记位仍在", async () => {
    const repos = createMemoryRepos();
    const traceId = "fbt_probe";
    await repos.fallbackTraces.insert({
      id: traceId,
      taskId: "task_promote",
      tenantId: TENANT,
      packageId: "pkg_seed",
      query: "把产能对齐一下",
      view: "dash",
      // ⚠ sketch 记的是**模型面调用名**（载体）—— 迁后是全名
      executedPlanSketch: [
        { toolName: full("query_objects"), inputSummary: "{}" },
        { toolName: full("invoke_solver"), inputSummary: "{}" },
        { toolName: full("create_action_draft"), inputSummary: "{}" },
      ],
      outcome: "ANSWERED",
      createdAt: new Date().toISOString(),
      normalizedQuery: "把产能对齐一下",
      embedding: [],
    } as never);
    const { intentId, planId } = await promoteFallbackTrace(repos, TENANT, traceId);
    const plan = await repos.plans.get(planId);
    const intent = await repos.intents.get(intentId);
    // 三步查表全部命中（少一步就是**静默丢步**）+ 末尾固定补一步 render_answer
    expect(plan!.steps.map((x) => x.type)).toEqual(["query_objects", "invoke_solver", "create_action_draft", "render_answer"]);
    // 标记位：sketch 里有写动作 ⇒ riskLevel=ACTION_DRAFT（查表判据同源；归一失守时会退成 READ）
    expect(intent!.riskLevel, "写动作标记位仍在（按身份判）").toBe("ACTION_DRAFT");
  });

  it("B6 失败点名披露块：换个载体仍点得出名（渲染里带的是调用名，不是 unknown）", () => {
    const block = renderFailedCallsBlock([
      { toolName: full("get_object"), outcome: "DENIED", reason: "AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明" },
    ]);
    expect(block, "有失败 ⇒ 有披露块").toBeTruthy();
    expect(block!.markdown).toContain(full("get_object"));
    expect(block!.markdown).toContain("DENIED");
    // 金丝雀：空失败 ⇒ 不产块（否则上面两条对「永远产块」的实现恒真）
    expect(renderFailedCallsBlock([])).toBeUndefined();
  });
});

/** 模型面名 → 裸名（本文件自己的读法；`rawName` 与 `full` 互逆，金丝雀在 A1 咬）。 */
function rawName(n: string): string {
  expect(parseBuiltinMcpToolName(n), `rawName 只接受本 server 的全名：${n}`).toBeTruthy();
  return parseBuiltinMcpToolName(n)!;
}

// ═══════════════════════════════════════════════════════════════════════════
// C 组 · 三面同改（授予 ∧ 挂载 ∧ 声明）+ engine 真装配
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-BUILTIN-MIGRATE-REST · C 组：三面同改 + 只剩一条授予路", () => {
  it("C1 出厂 analyst：本批四件 + 试点件全在 MCP 面上，裸名退净，配置行在册", () => {
    const agent = seedAnalyst();
    const ref = builtinRef(agent);
    expect(ref, "analyst 有内置工具 MCP 授予 ref").toBeTruthy();
    expect(rawOfFilter(ref).sort(), "授予面 = 迁前真正持有的那几件（集合不许变）").toEqual([...EXPECT_ANALYST_RAW].sort());
    // 全名形态自证：每个 filter 名 = 本文件模板串拼的
    for (const n of ref!.toolFilter ?? []) expect(n).toBe(full(rawName(n)));
    // 声明面按契约惯例记全名，且不再记裸名
    for (const raw of EXPECT_ANALYST_RAW) {
      expect(agent.scopeDeclaration.toolNames, `声明面全名 ${raw}`).toContain(full(raw));
      expect(agent.scopeDeclaration.toolNames, `声明面不再记裸名 ${raw}`).not.toContain(raw);
    }
    // 挂载面
    expect(agent.mcpServers.map((m) => m.mcpConfigId), "DSH mcpServers 挂载面").toContain(BUILTIN_MCP_CONFIG_ID);
    // 配置行真在册（缺它 ⇒ expandAgentTools 的 `if (!config) continue` 静默零工具）
    const row = seedMcpConfigs().find((m) => m.id === BUILTIN_MCP_CONFIG_ID);
    expect(row, `seedMcpConfigs 里必须有 ${BUILTIN_MCP_CONFIG_ID}`).toBeDefined();
    expect(row!.serverName).toBe(BUILTIN_MCP_SERVER);
    expect(row!.transport.type).toBe("stdio");
    expect(row!.status).toBe("ACTIVE");
  });

  it("C2 **逐 agent** 扫出厂种子：本批每一件都只剩 MCP 一条路（裸名授予 = 0）∧ 未迁件仍在反向通道", () => {
    const agents = seedRegistry().agents;
    expect(agents.length, "金丝雀：出厂 agent 数量非空").toBeGreaterThanOrEqual(11);
    for (const a of agents) {
      for (const raw of MIGRATED) {
        expect(a.tools.filter((t) => t.kind === "BUILTIN" && t.name === raw), `${a.key}: ${raw} 裸名授予已退净`).toEqual([]);
        expect(a.scopeDeclaration.toolNames, `${a.key}: 声明面不再记 ${raw} 裸名`).not.toContain(raw);
        const holds = rawOfFilter(builtinRef(a)).includes(raw);
        if (holds) {
          expect(a.mcpServers.map((m) => m.mcpConfigId), `${a.key}: 挂了 MCP ref 就必须挂 server`).toContain(BUILTIN_MCP_CONFIG_ID);
          expect(a.scopeDeclaration.toolNames, `${a.key}: 声明面记全名 ${raw}`).toContain(full(raw));
        }
      }
    }
    // 反向金丝雀：**未迁**的件在通用 agent 上仍是裸名 BUILTIN 授予（⇒ 上面的「退净」不是整体塌了）
    const general = agents.find((a) => a.id === GENERAL_AGENT_ID)!;
    const generalBare = general.tools.filter((t) => t.kind === "BUILTIN").map((t) => t.name).sort();
    expect(generalBare, "通用 agent 的裸名面 = 注册表 − 本体专属 − 已迁（逐条推导，不手抄）").toEqual(
      [...EXPECT_GENERAL_BARE].sort(),
    );
    expect(rawOfFilter(builtinRef(general)).sort(), "通用 agent 的 MCP 面 = 已迁全量").toEqual([...MIGRATED].sort());
  });

  it("C3 engine 真装配（analyst）：expanded 出全名 ∧ 反向工具面**空**（单路证明）∧ 允许表 = 本 agent 那几件", async () => {
    const { spec, expanded } = await setupFromSeedAgent(seedAnalyst());
    const names = expanded.map((x) => x.name);
    for (const raw of EXPECT_ANALYST_RAW) {
      expect(names, "授予面展开（engine 真跑）").toContain(full(raw));
      expect(names, "裸名不许出现在模型可见面").not.toContain(raw);
    }
    // analyst 迁完本批后，反向工具面**一件都不剩**（这不是「读不到」，是「这条路对它关掉了」）
    expect((spec.hostTools ?? []).map((x) => x.name), "analyst 已无未迁件 ⇒ 反向工具面空").toEqual([]);
    const builtinServer = spec.mcpServers?.find((m) => m.serverName === BUILTIN_MCP_SERVER);
    expect(builtinServer, "DSH 侧挂载表里有内置工具 server").toBeDefined();
    expect([...(builtinServer!.toolAllowlist ?? [])].sort(), "wire 侧允许表 = analyst 的 MCP 件（逐条）").toEqual(
      EXPECT_ANALYST_RAW.map((r) => full(r)).sort(),
    );
    // 描述文本与 MCP server 广告逐字同源（两内核模型面不许各写一份前缀）
    const advertised = buildBuiltinMcpTools();
    for (const raw of EXPECT_ANALYST_RAW) {
      const specTool = expanded.find((x) => x.name === full(raw))!;
      expect(specTool.description, `${raw} 静态投影 = MCP 广告`).toBe(advertised.find((x) => x.rawName === raw)!.description);
      expect(specTool.description.startsWith(BUILTIN_MCP_DESC_PREFIX)).toBe(true);
    }
    expect((spec.tools ?? []).map((x) => x.name), "harness 白名单含全名").toContain(full(EXPECT_ANALYST_RAW[0]));
  });

  it("C4 engine 真装配（通用 agent）：裸名面 = 未迁件 ∧ Phase6C 不砍内置工具面（原生臂真跑）", async () => {
    const { spec, expanded } = await setupFromSeedAgent(seedAgent(GENERAL_AGENT_ID));
    const names = expanded.map((x) => x.name);
    // 通用 agent：已迁全量在模型面（全名），未迁全量在反向面（裸名）
    for (const raw of MIGRATED) expect(names).toContain(full(raw));
    const hostNames = (spec.hostTools ?? []).map((x) => x.name).sort();
    for (const raw of MIGRATED) expect(hostNames).not.toContain(raw);
    expect(hostNames, "反向工具面 = 裸名面逐条相同（两处同源）").toEqual([...EXPECT_GENERAL_BARE].sort());

    // Phase6C 收窄豁免：内置工具面**不参与** top-k（否则通用 agent 的 26 件会被砍到 8 以内）
    const t = await createTestApp();
    try {
      await seedWorld(t, seedAgent(GENERAL_AGENT_ID, { kernel: "NATIVE" }));
      t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "免调工具，直接收尾。" }], provenance: [] })] });
      await runAgent(t, "task_rest_c4", GENERAL_AGENT_ID);
      const visible = (t.llm.agentRequests[0]?.tools ?? []).map((x) => x.name);
      for (const raw of MIGRATED) expect(visible, `模型面有 ${raw}`).toContain(full(raw));
      const builtinFace = visible.filter((n) => n.startsWith(`mcp__${BUILTIN_MCP_SERVER}__`));
      expect(builtinFace.length, "内置工具面恒全量（= 已迁件数，一件不多一件不少）").toBe(MIGRATED.length);
      const routerFace = visible.filter((n) => n.startsWith("mcp__") && !n.startsWith(`mcp__${BUILTIN_MCP_SERVER}__`) && !n.startsWith("mcp__workflow__"));
      // 金丝雀：收窄真在跑（可见求解器 < 授予的全部求解器），否则「收窄面=8」可能只是压根没收窄
      expect(routerFace.length, "收窄面恰为 top-k(8)（内置面不占名额）").toBe(8);
      // eslint-disable-next-line no-console
      console.log(`\n  ── C4 通用 agent 原生臂模型面 · 内置工具面 ${builtinFace.length} 件（已迁全量）· 收窄面 ${routerFace.length} 件 ──\n`);
    } finally {
      await t.app.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D 组 · 迁前/迁后单变量对照（setup 层）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-BUILTIN-MIGRATE-REST · D 组：迁前/迁后单变量对照（setup 层）", () => {
  it("D1 迁前臂：同一批件在反向工具面（裸名）∧ DSH 侧零内置工具 server 认知", async () => {
    const { spec, expanded } = await setupFromSeedAgent(preMigrationAgent(seedAnalyst()));
    const names = expanded.map((x) => x.name);
    for (const raw of EXPECT_ANALYST_RAW) {
      expect(names, `迁前：${raw} 以裸名到达模型面`).toContain(raw);
      expect(names, `迁前：没有 ${raw} 的 MCP 身份`).not.toContain(full(raw));
      expect((spec.hostTools ?? []).map((x) => x.name), `迁前：${raw} 在反向工具面`).toContain(raw);
    }
    expect((spec.mcpServers ?? []).map((m) => m.serverName), "迁前：DSH 侧没有内置工具 server").not.toContain(BUILTIN_MCP_SERVER);
  });

  it("D2 迁后臂：同一批件改走 MCP ⇒ 除载体外两臂逐字同（能力一件不多一件不少）", async () => {
    const post = await setupFromSeedAgent(seedAnalyst());
    const pre = await setupFromSeedAgent(preMigrationAgent(seedAnalyst()));
    expect((post.spec.mcpServers ?? []).map((m) => m.serverName)).toContain(BUILTIN_MCP_SERVER);
    const strip = (names: string[], drop: string[]) => names.filter((n) => !drop.includes(n)).sort();
    const postNames = strip(post.expanded.map((x) => x.name), EXPECT_ANALYST_RAW.map((r) => full(r)));
    const preNames = strip(pre.expanded.map((x) => x.name), [...EXPECT_ANALYST_RAW]);
    expect(postNames, "单变量：除这一批外其余授予逐字同（对照不是整表换掉）").toEqual(preNames);
    // 件数守恒（两个方向都不许多/少）
    expect(post.expanded.filter((x) => x.name.startsWith(`mcp__${BUILTIN_MCP_SERVER}__`)).length).toBe(EXPECT_ANALYST_RAW.length);
    expect(pre.expanded.filter((x) => EXPECT_ANALYST_RAW.includes(x.name)).length).toBe(EXPECT_ANALYST_RAW.length);
  });

  it("D3 反向对照（判据③·setup 层）：授予面换授 ⇒ 展开面/允许表一起没有它（同 server 另一件仍在）", async () => {
    const un = await setupFromSeedAgent(ungrantedAgent(seedAnalyst()));
    const names = un.expanded.map((x) => x.name);
    for (const raw of MIGRATED) {
      expect(names, `授予面拿掉 ⇒ ${raw} 不在展开面`).not.toContain(full(raw));
      expect(names, `裸名也没有`).not.toContain(raw);
    }
    const swapped = builtinMcpToolName(UNGRANTED_SWAP);
    expect(names, "金丝雀：同 server 的换授件仍在（不是整台 server 塌了）").toContain(swapped);
    const allow = (un.spec.tools ?? []).map((x) => x.name);
    expect(allow).not.toContain(full(PROBE_RAW));
    expect(allow).toContain(swapped);
    const builtinServer = un.spec.mcpServers?.find((m) => m.serverName === BUILTIN_MCP_SERVER);
    expect(builtinServer?.toolAllowlist, "wire 侧允许表 = 换授后的那一件").toEqual([swapped]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E 组 · e2e 真跑（真 DSH 分叉 + stub LLM）：迁后臂 vs 迁前臂 + 反向对照 + 失败点名
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-BUILTIN-MIGRATE-REST · E 组：真跑的 run 记录（迁前 / 迁后同一条 query）", () => {
  // 真 DSH 分叉要能定位到 harness 目录（真子进程）：`resolveHarnessDir` 的判据是
  // 「该目录下有 cordis.yml」—— 缺它整组报 `cordis.yml not found`（那是**环境**红，不是产品红）。
  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    savedEnv.DSH_HARNESS_DIR = process.env.DSH_HARNESS_DIR;
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
  });
  afterEach(() => {
    if (savedEnv.DSH_HARNESS_DIR === undefined) delete process.env.DSH_HARNESS_DIR;
    else process.env.DSH_HARNESS_DIR = savedEnv.DSH_HARNESS_DIR;
  });
  it("E1 迁后（DSH 原生 MCP）：模型面有全名 ∧ 真调 ∧ 数据面真查 ∧ 审计行（裸名）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: full(PROBE_RAW), arguments: PROBE_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, seedAgent(PROBE_AGENT_ID));
      const fillSpy = vi.spyOn(t.dataCore.ontology, "fillData");
      const result = await runAgent(t, "task_rest_e1", PROBE_AGENT_ID);
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");

      const visible = stubVisibleTools(stub);
      const names = visible.map((x) => x.name);
      expect(names, "模型可见工具面").toContain(full(PROBE_RAW));
      expect(names, "裸名不在模型面").not.toContain(PROBE_RAW);
      const advertised = buildBuiltinMcpTools().find((x) => x.rawName === PROBE_RAW)!;
      expect(visible.find((x) => x.name === full(PROBE_RAW))?.description, "描述逐字 = MCP 广告文本").toBe(advertised.description);
      expect(names.length, "金丝雀：模型面没空掉").toBeGreaterThan(5);

      const probeCalls = probeCallsOf(fillSpy);
      expect(probeCalls.length, "模型那一次合成恰一次").toBe(1);
      expect((probeCalls[0]![1] as { fields: string[] }).fields, "入参逐键 = 模型给的").toContain(PROBE_MARKER);
      expect((probeCalls[0]![1] as { typeKey: string }).typeKey, "入参逐键 = 模型给的").toBe(PROBE_TYPE_KEY);

      const rows = await t.repos.toolCalls.listByTask("task_rest_e1");
      const row = rows.find((r) => r.toolName === PROBE_RAW);
      expect(row?.outcome, "内置工具审计行").toBe("OK");
      expect(rows.find((r) => r.toolName === full(PROBE_RAW)), "审计面不许有全名行（有 = 两条路都执行过）").toBeUndefined();

      const second = JSON.stringify(stub.requests[1]!.body);
      expect(second, "回执上模型面").toContain(`<tool_data tool_call_id=\\"${row!.id}\\">`);
      arms.post = {
        carrier: full(PROBE_RAW),
        auditName: row!.toolName,
        outcome: row!.outcome,
        inputJson: JSON.stringify(row!.input),
        outputJson: JSON.stringify(row!.output),
        receiptInner: receiptInnerOf(toolResultText(stub.requests[1]!.body, "call_1")),
      };
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── E1 迁后臂 · DSH 模型面（首轮 · ${names.length} 件）──\n` +
          `  探针件在模型面：${names.includes(full(PROBE_RAW))}（名=${full(PROBE_RAW)}）\n` +
          `  ── 审计行 ──\n  ${JSON.stringify(rows.map((r) => `${r.toolName}/${r.outcome}`))}\n` +
          `  ── 回执原文 ──\n  ${toolResultText(stub.requests[1]!.body, "call_1").replace(/\s+/g, " ").slice(0, 240)}\n`,
      );
    } finally {
      await close();
      await stub.close();
    }
  });

  it("E2 迁前（对照臂·同一 query · 同一 agent · 单变量）：能力在反向工具面（裸名）∧ 同一执行体同一行审计名", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: PROBE_RAW, arguments: PROBE_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, preMigrationOne(seedAgent(PROBE_AGENT_ID), PROBE_RAW));
      const fillSpy = vi.spyOn(t.dataCore.ontology, "fillData");
      const result = await runAgent(t, "task_rest_e2", PROBE_AGENT_ID);
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");

      const names = stubVisibleTools(stub).map((x) => x.name);
      expect(names, "迁前：能力以裸名到达模型面").toContain(PROBE_RAW);
      expect(names, "迁前：DSH 侧没有这批工具的 MCP 身份").not.toContain(full(PROBE_RAW));
      // 单变量：**只这一件**回到裸名，同 server 的其余已迁件照旧在 MCP 面上（否则对照不是单变量）
      const stillMigrated = names.filter((n) => n.startsWith(`mcp__${BUILTIN_MCP_SERVER}__`));
      expect(stillMigrated, "迁前臂：其余已迁件一件不少").toEqual(
        expandedBuiltinNamesOf(seedAgent(PROBE_AGENT_ID))
          .filter((n) => n !== full(PROBE_RAW))
          .sort(),
      );
      expect(stillMigrated.length, "金丝雀：单变量臂不是「整台 server 撤了」").toBeGreaterThan(0);
      const probeCalls = probeCallsOf(fillSpy);
      expect(probeCalls.length, "迁前臂：模型那一次合成恰一次").toBe(1);
      const rows = await t.repos.toolCalls.listByTask("task_rest_e2");
      const preRow = rows.find((r) => r.toolName === PROBE_RAW);
      expect(preRow?.outcome, "同一只 host executor、同一行审计名").toBe("OK");
      const receiptPre = toolResultText(stub.requests[1]!.body, "call_1");
      // ── 判据①：迁前 / 迁后**同一条 query、同一个 agent** 的 run 记录逐键对照 ──────────
      const post = arms.post;
      expect(post, "迁后臂必须先跑过（同一条 query 的对照）").toBeDefined();
      expect(post!.carrier, "载体变了（这是本单的目的）").not.toBe(PROBE_RAW);
      expect(post!.carrier).toBe(full(PROBE_RAW));
      expect(post!.auditName, "审计名相同（同一行）").toBe(PROBE_RAW);
      expect(post!.outcome, "结局相同").toBe("OK");
      expect(post!.inputJson, "实参逐字节相同").toBe(JSON.stringify(preRow!.input));
      expect(post!.outputJson, "审计回执逐字节相同").toBe(JSON.stringify(preRow!.output));
      expect(post!.receiptInner, "模型面回执内层逐字节相同").toBe(receiptInnerOf(receiptPre));
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── 判据① 迁前/迁后 run 记录对照（同一条 query · 同一个 agent ${PROBE_AGENT_ID} · 只有载体变）──\n` +
          `  载体（模型面名）  迁前=${PROBE_RAW}  迁后=${post!.carrier}   ← 唯一变的一格\n` +
          `  审计行名          迁前=${PROBE_RAW}  迁后=${post!.auditName}\n` +
          `  outcome           迁前=OK  迁后=${post!.outcome}\n` +
          `  实参              ${post!.inputJson}\n` +
          `                    byteEqual=${post!.inputJson === JSON.stringify(preRow!.input)}\n` +
          `  审计回执(前 200)  ${post!.outputJson.slice(0, 200)}\n` +
          `                    迁前迁后 byteEqual=${post!.outputJson === JSON.stringify(preRow!.output)}（len=${post!.outputJson.length}）\n` +
          `  模型面回执(内层)  迁前迁后 byteEqual=${post!.receiptInner === receiptInnerOf(receiptPre)}\n`,
      );
    } finally {
      await close();
      await stub.close();
    }
  });

  it("E3 反向对照（判据③·e2e）：授予面拿掉 ⇒ DSH 侧读不到它 ∧ 宿主零数据面调用（那条读数是活的）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      // 模型**照旧**点名它（幻觉/陈旧剧本）—— 授予面已拿掉，DSH 侧不该让它到达数据面
      { toolCall: { name: full(PROBE_RAW), arguments: PROBE_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, ungrantedOne(seedAgent(PROBE_AGENT_ID), PROBE_RAW));
      const fillSpy = vi.spyOn(t.dataCore.ontology, "fillData");
      const result = await runAgent(t, "task_rest_e3", PROBE_AGENT_ID);
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");
      const names = stubVisibleTools(stub).map((x) => x.name);
      expect(names, `授予面拿掉 ⇒ DSH 侧看不到 ${PROBE_RAW}`).not.toContain(full(PROBE_RAW));
      expect(names, `裸名形态也不在`).not.toContain(PROBE_RAW);
      expect(names, "金丝雀：同 server 换授的那件在模型面").toContain(builtinMcpToolName(UNGRANTED_SWAP));
      expect(probeCallsOf(fillSpy).length, "宿主零数据面调用（fail-closed）").toBe(0);
      const rows = await t.repos.toolCalls.listByTask("task_rest_e3");
      expect(rows.some((r) => r.toolName === PROBE_RAW && r.outcome === "OK"), "不许有 OK 审计行").toBe(false);
      expect(names.length, "金丝雀：模型面没空掉").toBeGreaterThan(5);
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

  it("E4 §4.2 端到端 + 失败点名：DSH 臂上调它读**域外**对象 ⇒ 对象域门照样拒 ∧ 答案尾部点得出名", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: full("get_object"), arguments: JSON.stringify({ objectType: "Line", objectId: "probe-e4" }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      // 声明面收窄到 Base（出厂 analyst 的域里有 Line ⇒ 本臂刻意用**域外**的 Line 探针）
      await seedWorld(t, seedAnalyst({ scopeDeclaration: { ...seedAnalyst().scopeDeclaration, objectTypes: ["Base"] } }));
      const getSpy = vi.spyOn(t.dataCore.ontology, "getObject");
      const result = await runAgent(t, "task_rest_e4", SEED_AGENT_ID, { enforceObjectScope: true });
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");
      const req1 = JSON.stringify(stub.requests[1]!.body);
      expect(req1, "scope 类 DENIED 文案逐字等").toContain("AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明");
      expect(getSpy.mock.calls.filter((c) => c[2] === "probe-e4").length, "域外调用零数据面实参").toBe(0);
      const rows = await t.repos.toolCalls.listByTask("task_rest_e4");
      expect(rows.map((r) => [r.toolName, r.outcome]), "审计行：裸名 + DENIED").toEqual([["get_object", "DENIED"]]);
      // 失败点名披露块（换了载体仍点得出名）：答案 blocks 里点出**调用名**与门原文
      const blocks = result.answer.blocks ?? [];
      const disclosure = JSON.stringify(blocks);
      expect(disclosure, "答案尾部点名该失败").toContain(full("get_object"));
      expect(disclosure).toContain("AGENT_SCOPE_VIOLATION");
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── E4 失败点名（DSH 臂 · 全名载体）──\n  ${disclosure.replace(/\\n/g, " ").slice(0, 320)}\n  ── 审计行 ──\n  ${JSON.stringify(rows.map((r) => `${r.toolName}/${r.outcome}`))}\n`,
      );
    } finally {
      await close();
      await stub.close();
    }
  });
});
