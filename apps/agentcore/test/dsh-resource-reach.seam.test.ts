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
 *   D = 收敛判据（① 全仓扫描：裸名授予 = 0 ∧ 白名单裸名 = 0，配双向金丝雀；
 *       ② 通用 path-B 的工具面只产出 MCP 形态；③ path-B 真跑：退裸名之后仍调得到切片）
 *   E = 变异/对照（把 MCP 授予拿掉 ⇒ 红；把 MCP server 入口移走 ⇒ 红）
 */
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, type Dirent } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpServerNameSlug, type AgentDefinition } from "@platform/contracts";
import { PLANNER, createTestApp, setKernelRuntime, submitQuery, waitForTask, TENANT, type TestApp } from "./helpers.js";
import {
  STUB_DCP_SPEC,
  startStubOpenAi,
  stubDirectory,
  stubProvider,
  type StubRound,
} from "./helpers-dsh-stub.js";
import { seedRegistry, seedMcpConfigs, seedScenarioPackage } from "../src/mocks/seed.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";
import { buildSessionSetup } from "../src/dsh-runtime/setup-spec.js";
import { buildOntologyMcpTools, ONTOLOGY_MCP_DESC_PREFIX } from "../src/tools/ontology-mcp.js";
// WO-BUILTIN-TO-DSH · 内置工具 MCP 面的全名拼接（本文件新增的金丝雀用它，禁手抄字面量）。
import { BUILTIN_MCP_TOOL_NAMES, builtinMcpToolName } from "../src/mcp/builtin-mcp.js";
import { buildExploratoryTools } from "../src/router/orchestrator.js";
import {
  WORKFLOW_MCP_CONFIG_ID,
  WORKFLOW_MCP_DESC_PREFIX,
  WORKFLOW_MCP_SERVER,
  workflowMcpToolName,
} from "../src/mcp/workflow-mcp.js";

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
/**
 * 出厂 workflow（种子 agent 已带）。
 * ⚠ WO-WORKFLOW-MCP 起**模型可见名 = MCP 全名**（裸名 `workflow_capacity_check` 是退场记法，
 * 全仓不许再出现 —— D 组 ① 的扫描器咬的就是它）。
 */
const SEED_WF_TOOL = workflowMcpToolName("capacity_check");
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
/** WO-WORKFLOW-MCP · 工作流 MCP server 入口（与 engine.ts resolveWorkflowMcpServerPath 同址）。 */
const WORKFLOW_SERVER_ENTRY = join(REPO_ROOT, "apps/agentcore/dist/dsh-runtime/workflow-mcp-server.js");

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
 * hostTools / mcpServers 两路与 engine.ts 分叉处逐字同形（`hostWorkflowTools` 那条专用通道
 * 已随 WO-WORKFLOW-MCP 退场，工作流改走 mcpServers 里的内部 workflow server）。
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
    // ⚠ 工作流面的 allowlist 取法与本体**不同**（engine.ts 同款分支）：工作流 binding 恒为
    // `{kind:"WORKFLOW"}` 而非 `{kind:"MCP"}`,按 mcpConfigId 过滤会得到**空表** ⇒ 子进程把工具全丢。
    // 改为按公开名面（前缀即服务器命名空间）取 —— 与子进程 publicToolName 的比对口径同源。
    const workflowCatalog = tools
      .filter((x) => x.name.startsWith(`mcp__${WORKFLOW_MCP_SERVER}__`))
      .map((x) => x.name);
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
                  : tools
                      .filter((x) => x.binding.kind === "MCP" && x.binding.mcpConfigId === ref.mcpConfigId)
                      .map((x) => x.name),
            }
          : {}),
      });
    }
    // 旧记法兜底（engine.ts 同款）：带 WORKFLOW 授予但没挂 server 行的 agent 自动挂上。
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

// ---------------------------------------------------------------------------
// D 组的扫描器（**金丝雀与主查法共用同一份实现** —— 铁律 0.6 第 3 条：各抄一份正则的
// 金丝雀是装饰品，改主正则时它拿旧的去测、照样绿）。

/**
 * 剥注释（字符串/模板字面量**原样保留**，含引号 —— 正则要靠引号锚定），长度与行号 1:1 保持。
 *
 * 为什么必须剥：本仓刚因「`toContain("weightRef: {...}")` 匹到注释里的同串」立过一条机制
 * （CLAUDE.md 铁律 0.6 第 6 条）——「那个字符串出现过」不度量「那是它的赋值」。
 * 本文件自己的注释里就引用了旧路原文，不剥注释的扫描器会把**说明**当**违规**。
 *
 * 【参考实现·逐字符】语义权威，慢（21MB 语料实测 16.5s）。D0 用它给下面的快版做等价反证。
 */
function stripCommentsNaive(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "dquote" | "squote" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    const c2 = src[i + 1];
    if (mode === "code") {
      if (c === "/" && c2 === "/") { out += "  "; i++; mode = "line"; continue; }
      if (c === "/" && c2 === "*") { out += "  "; i++; mode = "block"; continue; }
      if (c === '"') mode = "dquote";
      else if (c === "'") mode = "squote";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { out += c === "\n" ? "\n" : " "; if (c === "\n") mode = "code"; continue; }
    if (mode === "block") {
      if (c === "*" && c2 === "/") { out += "  "; i++; mode = "code"; continue; }
      out += c === "\n" ? "\n" : " ";
      continue;
    }
    // 字符串态：原样保留（转义 2 字符整体搬，保持偏移与行号）
    out += c;
    if (c === "\\" && i + 1 < src.length) { out += src[i + 1]!; i++; continue; }
    if ((mode === "dquote" && c === '"') || (mode === "squote" && c === "'") || (mode === "tpl" && c === "`")) mode = "code";
  }
  return out;
}

/** 找字符串字面量的结束位置（含收尾引号；未闭合则到文件尾）。语义与参考实现同。 */
function findStringEnd(src: string, start: number, quote: string): number {
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i]!;
    if (c === "\\") { i++; continue; }
    if (c === quote) return i + 1;
  }
  return src.length;
}

/** `"` `'` `` ` `` `/` 中任意一个的位置（其余字符整段搬，避免逐字符拼接的 O(n) 常数）。 */
const INTERESTING = /["'`/]/g;

/** 剥注释·**快版**（与参考实现逐字节等价 —— D0 有反证；21MB 语料 16.5s → <1s）。 */
function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" = "code";
  for (let i = 0; i < src.length; ) {
    if (mode === "line") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? src.length : nl;
      out += " ".repeat(end - i);
      i = end;
      mode = "code";
      continue;
    }
    if (mode === "block") {
      const close = src.indexOf("*/", i);
      const end = close === -1 ? src.length : close + 2;
      out += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
      mode = "code";
      continue;
    }
    INTERESTING.lastIndex = i;
    const m = INTERESTING.exec(src);
    if (!m) { out += src.slice(i); break; }
    const j = m.index;
    const c = src[j]!;
    const c2 = src[j + 1];
    if (c === "/" && c2 === "/") { out += `${src.slice(i, j)}  `; i = j + 2; mode = "line"; continue; }
    if (c === "/" && c2 === "*") { out += `${src.slice(i, j)}  `; i = j + 2; mode = "block"; continue; }
    if (c === "/") { out += src.slice(i, j + 1); i = j + 1; continue; } // 除号 / 正则字面量：原样过
    const end = findStringEnd(src, j, c);
    out += src.slice(i, end);
    i = end;
  }
  return out;
}

interface ScanHit { line: number; text: string }

/**
 * 查法 ①·**授予形状**：`{kind:"BUILTIN", name:"<tool>"}`（两种键序都算，允许键间 ≤60 字符）。
 * 判据是**两个键在同一个对象字面量里**，不是「这两个串在文件里出现过」。
 * ⚠ 入参必须是**已剥注释**的文本（`stripComments` 的输出）—— 扫描器只做一件事，剥离由调用方一次做完。
 */
function scanGrantShapeText(clean: string, toolNames: readonly string[]): ScanHit[] {
  const hits: ScanHit[] = [];
  const name = `(?:${toolNames.join("|")})`;
  const patterns = [
    new RegExp(`kind\\s*:\\s*["']BUILTIN["'][\\s\\S]{0,60}?name\\s*:\\s*["']${name}["']`, "g"),
    new RegExp(`name\\s*:\\s*["']${name}["'][\\s\\S]{0,60}?kind\\s*:\\s*["']BUILTIN["']`, "g"),
  ];
  for (const re of patterns) {
    for (const m of clean.matchAll(re)) {
      const idx = m.index ?? 0;
      hits.push({ line: clean.slice(0, idx).split("\n").length, text: m[0].replace(/\s+/g, " ").slice(0, 90) });
    }
  }
  return hits;
}

/**
 * 查法 ②·**白名单裸名**：`toolWhitelist|toolNames|toolFilter: [ … "<裸名>" … ]`。
 * 引号锚定是关键 —— `"mcp__ontology__resolve_slice"` 里含 `resolve_slice` 子串，
 * 但它**不是**旧路（MCP 全名正是收敛后的形态），子串匹配会把收敛结果误报成违规。
 * ⚠ 入参同样是**已剥注释**的文本。
 */
function scanWhitelistText(clean: string, toolNames: readonly string[]): ScanHit[] {
  const hits: ScanHit[] = [];
  // ⚠ 数组正文必须**按方括号配对**取，不能 `[\s\S]{0,600}?\]`（非贪婪取到**第一个** `]`）：
  //    本仓真实白名单里就嵌着 `(X as readonly string[]).includes(n)` —— 一刀切在第一个 `]` 处
  //    会把正文截在裸名之前 ⇒ **假阴性**（这个 bug 是变异反证 M-D2 当场咬出来的：
  //    往 package 白名单里塞回 `"resolve_slice"`，门照样绿）。
  const keyRe = /\b(?:toolWhitelist|toolNames|toolFilter)\s*:\s*\[/g;
  for (const m of clean.matchAll(keyRe)) {
    const openIdx = (m.index ?? 0) + m[0].length - 1;
    const body = arrayBodyAt(clean, openIdx);
    for (const t of toolNames) {
      if (new RegExp(`["']${t}["']`).test(body)) {
        const idx = m.index ?? 0;
        hits.push({ line: clean.slice(0, idx).split("\n").length, text: `${m[0].slice(0, 40)}… 含 "${t}"` });
      }
    }
  }
  return hits;
}

/** `openIdx` 指向 `[`；返回配对 `]` 之间的正文（跳过字符串字面量里的方括号）。 */
function arrayBodyAt(clean: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < clean.length; i++) {
    const c = clean[i]!;
    if (c === '"' || c === "'" || c === "`") { i = findStringEnd(clean, i, c) - 1; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) return clean.slice(openIdx + 1, i); }
  }
  // 未配对（文件被截断）→ 一直取到文件尾：**宁可多扫不可少扫**（门的假阴性比假阳性贵得多）
  return clean.slice(openIdx + 1);
}

const SCAN_EXT = /\.(?:ts|tsx|mjs|cjs|js)$/;
const SCAN_SKIP_DIR = new Set(["node_modules", "dist", ".git", ".claude", "coverage", ".turbo"]);

/** 全仓**源码面**（不含构建产物）：四包的 src/test + harness 的 .mjs。 */
function scanRoots(): string[] {
  return [
    join(REPO_ROOT, "apps/agentcore/src"),
    join(REPO_ROOT, "apps/agentcore/test"),
    join(REPO_ROOT, "apps/datacore/src"),
    join(REPO_ROOT, "apps/datacore/test"),
    join(REPO_ROOT, "apps/frontend-shell/src"),
    join(REPO_ROOT, "apps/frontend-shell/test"),
    join(REPO_ROOT, "packages/contracts/src"),
    join(REPO_ROOT, "packages/llm-adapters/src"),
    join(REPO_ROOT, "packages/dsh-harness"),
  ];
}

interface SourceFile { rel: string; clean: string }
const sourceCache: { files?: SourceFile[] } = {};
function loadSources(): SourceFile[] {
  if (sourceCache.files) return sourceCache.files;
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 目录不存在（如某个包没有 test/）→ 跳过，不算「扫过了」
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SCAN_SKIP_DIR.has(e.name)) walk(join(dir, e.name));
        continue;
      }
      if (!SCAN_EXT.test(e.name)) continue;
      const abs = join(dir, e.name);
      const raw = readFileSync(abs, "utf8");
      const clean = stripComments(raw);
      // 剥注释的**自证**（逐文件·便宜）：长度与换行数必须 1:1 —— 剥歪了（例如把 `"` 当字符串起点
      // 一路吞掉半份代码）会当场自曝，而不是静默给出「0 命中」这个否定结论。
      if (clean.length !== raw.length || (clean.match(/\n/g)?.length ?? 0) !== (raw.match(/\n/g)?.length ?? 0)) {
        throw new Error(`剥注释自证失败（长度/换行不一致）：${relative(REPO_ROOT, abs)}`);
      }
      files.push({ rel: relative(REPO_ROOT, abs).split(sep).join("/"), clean });
    }
  };
  for (const r of scanRoots()) walk(r);
  sourceCache.files = files;
  return files;
}

function scanAll(
  textHit: (clean: string, names: readonly string[]) => ScanHit[],
  names: readonly string[],
): string[] {
  const out: string[] = [];
  for (const f of loadSources()) {
    for (const h of textHit(f.clean, names)) out.push(`${f.rel}:${h.line} :: ${h.text}`);
  }
  return out;
}

// ---------------------------------------------------------------------------

describe("RESOURCE-REACH · A 授予面契约（seed → expandAgentTools → setup 映射）", () => {
  it("A1 出厂 agt_capacity_planner **以 MCP 模式**获得切片：工具面/声明面/mcpServers 三面同步，且反向工具面里没有它", async () => {
    const agent = seedCapacityAgent();
    // ① seed 侧：MCP ref（不是 BUILTIN 授予）
    const mcpRefs = agent.tools.filter((t) => t.kind === "MCP");
    const mcpRefIds = mcpRefs.map((r) => (r.kind === "MCP" ? r.mcpConfigId : ""));
    // ⚠ 收编方订正（2026-10-05）：原写 `toEqual([ONTOLOGY_MCP_CONFIG_ID])` —— 那等于断言
    // 「本体是**唯一**的 MCP server」。WO-SOLVERS-MCP-REAL 合并后本 agent 合法地多挂了一个
    // solvers server，该断言随即变红。**那不是回归，是这条断言把「当时的状态」当成了判据。**
    // 本文件的主语是「切片」⇒ 判据收窄到本体这一条；同时保留「ref 不许重复」这条硬约束
    // （重复 = 同一 server 挂两次，也会让模型面出现两份同名工具）。
    expect(mcpRefIds, "切片走 MCP 授予（本体 server 在 ref 里）").toContain(ONTOLOGY_MCP_CONFIG_ID);
    expect(new Set(mcpRefIds).size, "MCP ref 不许重复").toBe(mcpRefIds.length);
    // WO-WORKFLOW-MCP · 旧记法已退净：本 agent 上不许再有 WORKFLOW ref（有 = 两条路并存）
    expect(agent.tools.filter((t) => t.kind === "WORKFLOW"), "旧 WORKFLOW 记法已退净").toEqual([]);
    expect(
      agent.tools.filter((t) => t.kind === "BUILTIN").map((t) => (t.kind === "BUILTIN" ? t.name : "")),
      "BUILTIN 授予面不再含切片（收敛：不许两条路并存）",
    ).not.toContain(SLICE_PLAN_RAW);
    // ② 声明面按契约惯例记**全名**
    expect(agent.scopeDeclaration.toolNames, "声明面全名").toContain(SLICE_PLAN_MCP);
    expect(agent.scopeDeclaration.toolNames, "声明面全名").toContain(SLICE_RESOLVE_MCP);
    expect(agent.scopeDeclaration.toolNames, "声明面不再记裸名").not.toContain(SLICE_PLAN_RAW);
    // ③ DSH 挂载面：mcpServers 行在（这是「DSH 自己知道有这个 server」的登记点）
    expect(agent.mcpServers.map((m) => m.mcpConfigId), "DSH mcpServers 挂载面").toContain(ONTOLOGY_MCP_CONFIG_ID);
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
    // 按 serverName 取，⛔ 不按下标 —— 下标会被后续新增的 server 挤走（本行原先就是踩了这个）。
    const ontServer = spec.mcpServers?.find((m) => m.serverName === ONTOLOGY_SERVER_NAME);
    expect(ontServer, "DSH 侧 MCP server 面（本体 server 必须在挂载表里）").toBeDefined();
    expect(ontServer!.toolAllowlist, "MCP wire 侧允许表（逐字钉死，收窄口径不许漂）").toEqual([
      SLICE_PLAN_MCP,
      SLICE_RESOLVE_MCP,
    ]);
    // ⑧ 描述文本与 MCP server 广告的逐字同源（两内核模型面不许各写一份前缀）
    const advertised = buildOntologyMcpTools();
    const planSpec = expanded.find((x) => x.name === SLICE_PLAN_MCP)!;
    expect(planSpec.description, "静态投影 = MCP server 广告描述").toBe(
      advertised.find((x) => x.name === SLICE_PLAN_MCP)!.description,
    );
    expect(planSpec.description.startsWith(ONTOLOGY_MCP_DESC_PREFIX)).toBe(true);
    // ⑨ 交付②的可见性前提：出厂 WORKFLOW 授予走 **MCP 面**（`mcp__workflow__{key}`，
    // 与本体同一套命名空间/挂载/收窄机制；专用字段 `hostWorkflowTools` 已退场）。
    const wfSpec = spec.mcpServers?.find((m) => m.serverName === WORKFLOW_MCP_SERVER);
    expect(wfSpec, "工作流 server 必须挂上（只有 ref 没有它 = 模型面拿不到工具）").toBeDefined();
    expect(wfSpec?.toolAllowlist, "workflow wire 侧允许表 = 公开名面").toEqual([SEED_WF_TOOL]);
    expect(expandedNames, "授予面展开是全名").toContain(SEED_WF_TOOL);
    // ⑨b 描述文本单源：宿主静态投影 = MCP server 广告（`workflow-mcp.ts` 一处生成，两内核同字）
    const wfGrants = expanded.filter((x) => x.name === SEED_WF_TOOL);
    expect(wfGrants.length, "同一工作流只许有一条授予（两条 = 旧记法没退净）").toBe(1);
    expect(wfGrants[0]!.description.startsWith(WORKFLOW_MCP_DESC_PREFIX), "workflow 描述前缀 = MCP 广告前缀").toBe(true);
    expect(hostNames, "BUILTIN 面不串入 workflow").not.toContain(SEED_WF_TOOL);
    // ⑩ 金丝雀：整表没空掉 —— 其余出厂授予仍在（否则上面所有 not.toContain 对空实现恒真）
    // ⚠ WO-BUILTIN-TO-DSH：本 agent（capacity_planner）的内置工具 `query_objects` 已改挂
    //    内置工具 MCP 面 ⇒ 它的**反向工具面本来就空了**（结构性事实，不是数据缺失），
    //    故金丝雀改成两半：① 本 agent 的允许表（MCP 面）没空掉；
    //    ② 旧载体仍活 —— 同批**未迁**的 analyst 仍有裸 BUILTIN 授予（`get_object` 走反向通道）。
    expect(hostNames, "本 agent 反向工具面：内置工具已全走 MCP 面 ⇒ 结构性为空").toEqual([]);
    expect(allow, "允许表没空掉（MCP 面仍在）").toContain(SLICE_PLAN_MCP);
    expect(allow).toContain(SEED_WF_TOOL);
    const analystSeed = seedRegistry().agents.find((a) => a.id === "agt_seed_analyst");
    if (!analystSeed) throw new Error("seed analyst not found");
    const other = await setupFromSeedAgent({ ...analystSeed, kernel: "EXTERNAL" } as AgentDefinition);
    // ⚠ WO-BUILTIN-MIGRATE-REST：analyst 的**未迁件已归零**（本批把它手里最后四件也迁走了）
    // ⇒ 旧载体金丝雀换成**通用 agent**（它还有未迁件：discover 一族走反向通道）。
    const generalSeed = seedRegistry().agents.find((a) => a.id === "agt_general");
    if (!generalSeed) throw new Error("seed general agent not found");
    expect(
      (other.spec.hostTools ?? []).map((x) => x.name),
      "旧载体金丝雀①：analyst 已无未迁件 ⇒ 其余反向工具面结构性为空",
    ).toEqual([]);
    const general = await setupFromSeedAgent({ ...generalSeed, kernel: "EXTERNAL" } as AgentDefinition);
    // 旧载体金丝雀②：通用 agent 的**两半合起来 = 内置工具花名册全量**（任一半归零都会在这里现形，
    // 且不随本单一批批迁移而漂 —— 每进一批只是件从这一半挪到那一半）。
    const generalHost = (general.spec.hostTools ?? []).map((x) => x.name);
    const generalMcp = (general.spec.tools ?? []).map((x) => x.name).filter((n) => n.startsWith("mcp__builtin__"));
    expect(generalHost.length + generalMcp.length, "旧载体金丝雀②：反向面 + MCP 面 = 花名册全量").toBe(
      BUILTIN_MCP_TOOL_NAMES.length,
    );
    expect(generalHost.length, "金丝雀有牙：反向面本批仍非空（未迁件还在）").toBeGreaterThan(0);
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
    expect(
      (spec.mcpServers ?? []).map((m) => m.serverName),
      "本体 server 面也撤（不许「ref 撤了 server 还在」的残缺态）",
    ).not.toContain(ONTOLOGY_SERVER_NAME);
    // 金丝雀：对照不是「整表空掉」——同批其余授予仍在
    // ⚠ WO-BUILTIN-TO-DSH：同 A1 ⑩ —— 本 agent 的内置工具已全走 MCP 面，反向工具面结构性为空；
    // 金丝雀改为「允许表（MCP 面）非空 ∧ 旧载体对未迁工具仍活（analyst 的 get_object）」。
    const allow = (spec.tools ?? []).map((x) => x.name);
    // ⚠ 本体那一件**已被本对照拿掉**（上面刚断言过）⇒ 金丝雀落在**不受本对照影响**的两条上：
    // 内置工具 MCP 面（WO-BUILTIN-TO-DSH）与工作流 MCP 面。
    expect(allow, "允许表没空掉（MCP 面仍在）").toContain(builtinMcpToolName("query_objects"));
    expect(allow).toContain(SEED_WF_TOOL);
    // ⚠ WO-BUILTIN-MIGRATE-REST：同 A1 —— analyst 已无未迁件，旧载体金丝雀换成通用 agent。
    const generalSeed = seedRegistry().agents.find((a) => a.id === "agt_general");
    if (!generalSeed) throw new Error("seed general agent not found");
    const general = await setupFromSeedAgent({ ...generalSeed, kernel: "EXTERNAL" } as AgentDefinition);
    const generalHost = (general.spec.hostTools ?? []).map((x) => x.name);
    const generalMcp = (general.spec.tools ?? []).map((x) => x.name).filter((n) => n.startsWith("mcp__builtin__"));
    expect(generalHost.length + generalMcp.length, "旧载体金丝雀：反向面 + MCP 面 = 花名册全量").toBe(
      BUILTIN_MCP_TOOL_NAMES.length,
    );
    expect(generalHost.length, "金丝雀有牙：反向面本批仍非空（未迁件还在）").toBeGreaterThan(0);
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
      // ★ WO-CLOSE-NATIVE-GAPS：B 组一律跑 DSH 臂（装配位；agent 的 kernel 字段已退役不被读）。
      setKernelRuntime(t, "dsh");
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
      // ★ WO-CLOSE-NATIVE-GAPS：B 组一律跑 DSH 臂（装配位；agent 的 kernel 字段已退役不被读）。
      setKernelRuntime(t, "dsh");
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
      // ★ WO-CLOSE-NATIVE-GAPS：B 组一律跑 DSH 臂（装配位；agent 的 kernel 字段已退役不被读）。
      setKernelRuntime(t, "dsh");
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
      // ② 不许带 tool_call_id 属性（workflow 面与 BUILTIN 面不同形 —— 模型无法引用多步流程的中间 id）
      expect(receipt2, "② 包络无 tool_call_id 属性").toMatch(/^<tool_data>\{/);

      // ── 值校验（§4 铁律：这条数我独立地再算一遍）────────────────────────────
      // 回执里的求解器读数**不是我复述的**，是按它的定义式重算出来的：
      //   mocks/clients.ts `capacity_forecast`：capWanP50 = round1(baseGwh × (1+rnd×0.1))
      //                                        effectiveDemand = round1(capWanP50 × (1 + demandDelta))
      //                                        baselineDemand  = round1(effectiveDemand / max(0.01, 1+demandDelta))
      // 故拿回执自带的 capWanP50 与脚本入参 0.2 就能独立复算 effectiveDemand —— 两者必须逐位相等。
      // ⛔ 不是「回执里有数」这种存在性断言：下面三行都**先算出数**再比对。
      const round1 = (x: number) => Math.round(x * 10) / 10;
      const envJson = receipt2.slice(receipt2.indexOf("<tool_data>") + "<tool_data>".length, receipt2.indexOf("</tool_data>"));
      const wfPayload = JSON.parse(envJson) as {
        status?: string;
        stepOutputs?: Record<string, { data?: Record<string, number> }>;
      };
      expect(wfPayload.status, "② 工作流终态").toBe("COMPLETED");
      const s2 = wfPayload.stepOutputs?.s2?.data;
      expect(s2, "② 求解器 s2 读数必须在产物里（值校验的输入）").toBeDefined();
      const capWanP50 = s2!.capWanP50!;
      const deltaIn = 0.2; // ① 与 ② 的唯一自变量（脚本里写死的那个数）
      expect(s2!.demandDelta, "② 求解器收到的 delta = 我发出去的那个数").toBe(deltaIn);
      // 【值校验·主】按定义式独立复算 —— 左边是回执里的数，右边是我现算的
      expect(round1(capWanP50 * (1 + deltaIn)), "② effectiveDemand = round1(capWanP50×(1+δ)) 独立复算").toBe(
        s2!.effectiveDemand,
      );
      // 【值校验·副】反向再算一次（除法而非乘法，走另一条式子）
      expect(round1(s2!.effectiveDemand! / (1 + deltaIn)), "② baselineDemand 反向复算").toBe(s2!.baselineDemand);
      // 金丝雀：复算式**不是恒等式**（把 delta 换成另一个数，等式必须不成立）
      // —— 否则上面两条对任何输入都绿，等于没验。
      expect(round1(capWanP50 * (1 + 0.5)) === s2!.effectiveDemand, "复算式有鉴别力（δ=0.5 时不成立）").toBe(false);

      const qoTypes = qo.mock.calls.map((c) => c[1] as string);
      expect(qoTypes, "workflow s1 步真执行（Model 真被查过）").toContain("Model");
      const rows = await t.repos.toolCalls.listByTask("task_reach_b3wf");
      const wfRows = rows.filter((r) => r.toolName === SEED_WF_TOOL);
      expect(wfRows.length, "恰好一行 = 只有 ② 过 wire").toBe(1);
      expect(wfRows[0]!.outcome).toBe("OK");
      expect(wfRows[0]!.id).toMatch(/^tc_/);
      const iterCalls = result.run.iterations.flatMap((it) => it.toolCalls).filter((c) => c.toolName === SEED_WF_TOOL);
      expect(iterCalls.map((c) => c.outcome), "两次调用的结局").toEqual(["ERROR", "OK"]);
      // 差异 [B3-D1]（**登记，不是缺陷**；与 B1 的 [B1-D1] 是**同一条结构性原因**在 workflow 面的观测点）：
      // MCP 路的 `iterations.toolCallId` 是 **DSH 帧 id**，不是宿主审计行主键 `tc_`。
      // 迁前那条反向工具路是 `hostToolCalls.get(call.callId)` 命中的 —— 因为桥把**帧 callId 直通**上了
      // 反向通道；MCP wire 不带 DSH 帧 id（`tools/call` 的 JSON-RPC id 由 SDK 自铸），故本 server 只能按
      // `{全名}@{自增}` 自铸 callId（见 workflow-mcp-server.ts 头注），侧表**必然 miss** ⇒ 回落成帧 id。
      // ⚠ 这不是「关联丢了」：① 模型面**本就没有** workflow 的 tool_call_id 可引用（包络刻意不带该属性，
      //    与迁前 `withCallId:false` 同形 —— 上一条断言已咬）；② 帧 id ↔ `tc_` 审计行的对应由**端点回执**
      //    承担（bridge C 组断言 `rows[0].id === body.toolCallId`，全名逐字可追）。
      // 下面两条**钉死该差异**，漂了就红：帧 id 必须**真能在模型面回执里寻址**（同一份证据两处读到），
      // 且**不是**审计行主键 —— 只写 `.not.toBe` 是纯否定，没有鉴别力，故后一条是值校验。
      const frameId = iterCalls[1]!.toolCallId;
      expect(frameId, "[B3-D1] 非宿主审计行主键").not.toBe(wfRows[0]!.id);
      expect(toolResultText(stub.requests[2]?.body, frameId), "[B3-D1] 帧 id 在模型面可寻址且载荷 = ② 那份").toBe(receipt2);
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B6 对照实验（workflow MCP 入口移走）：工作流工具不可见 ∧ 宿主零执行 ∧ 零审计行，且本体面**不受影响**", { timeout: SEAM_TIMEOUT }, async () => {
    // 这条是 B2 的**同形对照臂**，被自变量换成工作流 server（WO-WORKFLOW-MCP 的那条新 seam）：
    //   自变量 X：workflow MCP server 入口在不在
    //   预言的 Y：在 ⇒ 工具可见且真能被调用（B3 已证）；不在 ⇒ 工具**从未注册**、执行体零调用、
    //             审计零行；而**同一 run 的另一个 MCP server（本体）照常工作** —— 后一条是关键，
    //             否则「工具不见了」可能只是「整条 MCP 路都死了」，对照就失去鉴别力。
    expect(existsSync(WORKFLOW_SERVER_ENTRY), `workflow MCP server 入口必须存在：${WORKFLOW_SERVER_ENTRY}`).toBe(true);
    const before = createHash("sha256").update(readFileSync(WORKFLOW_SERVER_ENTRY)).digest("hex");
    const parked = `${WORKFLOW_SERVER_ENTRY}.parked-by-seam-test`;
    let restored = false;

    const stub = await startStubOpenAi([
      { toolCall: { name: SEED_WF_TOOL, arguments: JSON.stringify({ model: "4680-NCM", demandDelta: 0.2, weeks: 4 }) }, usage: PLAIN_USAGE },
      { toolCall: { name: SLICE_PLAN_MCP, arguments: PLAN_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      // ★ WO-CLOSE-NATIVE-GAPS：B 组一律跑 DSH 臂（装配位；agent 的 kernel 字段已退役不被读）。
      setKernelRuntime(t, "dsh");
      await seedWorld(t, seedCapacityAgent());
      renameSync(WORKFLOW_SERVER_ENTRY, parked);
      const wfSpy = vi.spyOn(t.deps.engine, "runWorkflowAsTool");
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_reach_b6wf", emitted, SEED_AGENT_ID);

      // ① 金丝雀：席位仍在（不是整场没起来）
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");
      const names = stubVisibleTools(stub).map((x) => x.name);
      // ② 自变量落到模型面：工作流工具**从未注册**
      expect(names, "server 不在 ⇒ 工作流不可见").not.toContain(SEED_WF_TOOL);
      expect(names.map((n) => n.replace(/^mcp__[a-z]+__/, "")), "裸名也不许冒出来").not.toContain("capacity_check");
      // ③ **鉴别力对照**：同一 run 的另一个 MCP server 工具照常在 —— 「不见了」只归因于被移走的那个
      expect(names, "另一个 MCP server 不受影响（否则本对照无鉴别力）").toContain(SLICE_PLAN_MCP);
      // ④ 执行体零调用 + 零审计行（fail-closed，绝不静默成功）
      expect(wfSpy.mock.calls.length, "宿主 workflow 执行体零调用").toBe(0);
      const rows = await t.repos.toolCalls.listByTask("task_reach_b6wf");
      expect(rows.filter((r) => r.toolName === SEED_WF_TOOL).length, "宿主零审计行").toBe(0);
      // ⑤ 幻觉调用拿到明确失败（不是静默 OK），且**不是**成功包络
      const receipt = toolResultText(stub.requests[1]?.body, "call_1");
      expect(receipt, "必须真回了 tool_result（静默 = 没有回执）").not.toBe("");
      expect(receipt, "不许是成功载荷").not.toMatch(/<tool_data>/);
      expect(receipt, "必须是明确失败文案").toMatch(/not found|not in agent scope|unknown|Error|无权|不存在|invalid/i);
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── B6 对照（workflow MCP 入口移走）：模型面工具数=${names.length}` +
          `（含 workflow=${names.some((n) => n.includes("workflow"))} / 含本体切片=${names.some((n) => n.includes("ontology"))}）\n` +
          `  ── workflow 执行体调用次数=${wfSpy.mock.calls.length}，审计行=${rows.length} ──\n  ${receipt.slice(0, 300)}\n`,
      );
    } finally {
      if (existsSync(parked) && !existsSync(WORKFLOW_SERVER_ENTRY)) renameSync(parked, WORKFLOW_SERVER_ENTRY);
      restored = existsSync(WORKFLOW_SERVER_ENTRY);
      await close();
      await stub.close();
    }
    // 还原自证：sha256 与移动前逐字节同
    expect(restored, "入口文件必须还原").toBe(true);
    expect(createHash("sha256").update(readFileSync(WORKFLOW_SERVER_ENTRY)).digest("hex"), "还原后 sha256").toBe(before);
  });

  it("B4 fail-closed：请求**不在授予集内**的工具 ⇒ 明确拒绝 ∧ 宿主零执行（不静默放行）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: OUT_OF_SCOPE_TOOL, arguments: JSON.stringify({ title: "越权草稿" }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      // ★ WO-CLOSE-NATIVE-GAPS：B 组一律跑 DSH 臂（装配位；agent 的 kernel 字段已退役不被读）。
      setKernelRuntime(t, "dsh");
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
      setKernelRuntime(t, "dsh"); // ★ WO-CLOSE-NATIVE-GAPS：装配位（kernel 字段已退役）
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
      // ★ WO-CLOSE-NATIVE-GAPS：臂改由**测试装配位**选（旧写法靠 agent 的 kernel 字段，该字段已退役不被读）。
      setKernelRuntime(t, kernel === "EXTERNAL" ? "dsh" : "inprocess");
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

    // ② 模型可见工具面：**名字集合**逐项同 —— 唯**技能加载器**一件是**臂属差异**（[D3]）：
    //    dsh 臂的加载器是上游 `dsh-tool-skill` 注册的模型面真名 `skill`（P2A 换名后）；
    //    native 臂是我方常量 `load_skill`（`tools/registry.ts`）。两臂**各自与自己的真名对得上**才是判据，
    //    ⛔ 不是「两臂名字相同」——那在换名后必然假红；也⛔ 不是把这两个名字从比较里删掉：
    //    删掉会让「两臂的加载器都没了」这种回归静默通过。故下面**既登记差异、又各查各的真名**。
    //    比**集合**不比顺序：两臂的注册顺序源不同（DSH = harness 注册序；native = 执行器导出序）⇒ [D2]。
    const LOADER_NAME: Record<string, string> = { NATIVE: "load_skill", EXTERNAL: "skill" };
    const LOADER_NAMES = new Set([LOADER_NAME.NATIVE, LOADER_NAME.EXTERNAL]);
    const isLoader = (n: string) => LOADER_NAMES.has(n);
    const sortBy = <T extends { name: string }>(xs: T[]) => [...xs].sort((a, b) => (a.name < b.name ? -1 : 1));
    const namesNativeAll = sortBy(native.visible).map((x) => x.name);
    const namesExternalAll = sortBy(external.visible).map((x) => x.name);
    // 正向对照（缺了它，「两臂加载器都没了」会被读成「登记差异成功」）
    expect(namesNativeAll, "native 臂含自己的加载器真名").toContain(LOADER_NAME.NATIVE);
    expect(namesExternalAll, "dsh 臂含自己的加载器真名").toContain(LOADER_NAME.EXTERNAL);
    // 非空性钉子（防止把「登记差异」做成「把这两个名字从比较里删掉」）：
    // 每臂**恰好**排掉一件（就是它自己的加载器）。若哪天把 isLoader 放宽成多排/全排，
    // 下面的集合比较会退化成空集比空集而恒真 —— 这两条就是那个退化的判据。
    expect(namesNativeAll.filter(isLoader), "native 臂被排除的加载器件数").toHaveLength(1);
    expect(namesExternalAll.filter(isLoader), "dsh 臂被排除的加载器件数").toHaveLength(1);
    expect(namesExternalAll.filter((n) => !isLoader(n)), "两臂可见工具名集合（除各臂加载器真名外）").toEqual(
      namesNativeAll.filter((n) => !isLoader(n)),
    );
    const descOf = (xs: { name: string; description: string }[]) => Object.fromEntries(xs.map((x) => [x.name, x.description]));
    const dNative = descOf(native.visible);
    const dExternal = descOf(external.visible);
    // [D3] 描述漂移：**除加载器外**两臂描述必须逐项同。
    //      加载器名不同是上面登记的**臂属差异**，不是「描述漂移」——原文写「漂移名单恰为 load_skill」，
    //      那是把**名字差异**误记成**描述差异**，且只扫 native 一侧的键（dsh 独有名字它结构上看不见）。
    //      改为剔掉两侧加载器后：名字集合逐项同 ∧ 漂移名单为空集（比原判据更严：真描述漂移现在会红）。
    const withoutLoader = (m: Record<string, string>) =>
      Object.fromEntries(Object.entries(m).filter(([n]) => !isLoader(n)));
    const dNativeNoLoader = withoutLoader(dNative);
    const dExternalNoLoader = withoutLoader(dExternal);
    expect(Object.keys(dNativeNoLoader).sort(), "[D3] 两侧工具名（除加载器）").toEqual(
      Object.keys(dExternalNoLoader).sort(),
    );
    expect(
      Object.keys(dNativeNoLoader).filter((n) => dNativeNoLoader[n] !== dExternalNoLoader[n]),
      "[D3] 描述漂移名单（除加载器外必须为空集）",
    ).toEqual([]);
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
    //   [D3] **技能加载器名两臂不同**：native = `load_skill`（我方常量，`tools/registry.ts`）；
    //        dsh = `skill`（上游 `dsh-tool-skill` 注册的模型面真名）。
    //        ⚠ 这是 **P2A 换名后的有意差异**，不是缺陷：dsh 臂用 DSH 自己的加载器才是「迁到原生配置面」的落点；
    //        P5 退役 native loop 后只剩 `skill`。收编 P2A 时本单原判据「两臂名字逐字相同」由此假红，
    //        处置 = **登记为臂属差异 + 各查各的真名**（见上 ②），⛔ 不是删掉比较。
    //        （原文记的是「load_skill 描述文本不同、只登记不收敛、归 p2a 单」——P2A 已落定，
    //         那条差异**随加载器名一起**变成了本条；描述漂移本身已由 ② 的 [D3] 断言收成空集。）
    const diffs: string[] = [];
    if (external.kernel !== native.kernel) diffs.push(`[D1] run.kernel: native=${native.kernel} external=${external.kernel}`);
    // [D2] 除各臂加载器真名外：集合必须逐项相同，差异只允许出在**顺序**上。
    const namesEx = external.visible.map((x) => x.name).filter((n) => !isLoader(n));
    const namesNa = native.visible.map((x) => x.name).filter((n) => !isLoader(n));
    if (JSON.stringify(namesEx) !== JSON.stringify(namesNa)) {
      const sameSet = [...namesEx].sort().join(" ") === [...namesNa].sort().join(" ");
      diffs.push(sameSet ? "[D2] 可见工具顺序不同（集合相同）" : "[D2] 除加载器外可见工具集合不同");
    }
    // [D3] 技能加载器名两臂不同（P2A 换名）。**由实测数据推导**，不是拿写死常量自比——
    //      哪天 dsh 臂改回同名，本条不再入列，下方「恰三条」断言会当场红出来要求解释。
    const loaderSeen = (vs: { name: string }[]) => vs.map((x) => x.name).filter((n) => isLoader(n));
    if (JSON.stringify(loaderSeen(external.visible)) !== JSON.stringify(loaderSeen(native.visible)))
      diffs.push("[D3] 技能加载器名两臂不同（native=load_skill / dsh=skill，归 P2A 换名）");
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
      "[D3] 技能加载器名两臂不同（native=load_skill / dsh=skill，归 P2A 换名）",
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

describe("RESOURCE-REACH · D 收敛判据：切片只剩 MCP 一条授予路（全仓扫描 + path-B 真跑）", () => {
  /** 出厂场景包里曾以裸名授予的两件（path-B 的工具面 = 它 + BUILTIN 注册表当场算出来的）。 */
  const PROD_RAW_SLICES = ["plan_slice", "resolve_slice"];
  const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

  it("D0 扫描器金丝雀（合成样例·与 D1 共用同一实现）：正样例必中 ∧ 全名形态必不中 ∧ 注释里的同串必不中", () => {
    // ⚠ 本文件自己要被 D1 扫到 ⇒ 合成样例一律**拼装**，不在源码里写出裸名字面量
    //   （否则「测试文件的样例」会被判成「仓库里的违规」——这个门第一版就是这么自咬的）。
    const bare = "plan" + "_slice";
    const full = `mcp__${ONTOLOGY_SERVER_NAME}__` + "plan" + "_slice";
    const scan = (s: string) => stripComments(s);
    // ⓪ 剥注释快版的**等价反证**：与逐字符参考实现在同一份刁钻语料上逐字节同
    //   （含：`//` 出现在字符串里、转义引号、块注释、模板字面量、正则字面量、注释里的同串）
    const corpus = [
      `const a = "http://x//y"; // 真注释\n`,
      `const b = 'it\\'s //not-comment'; /* 块\n注释 */ const c = \`tpl // ${bare}\`;\n`,
      `// { kind: "BUILTIN", name: "${bare}" }\nconst d = /["']/g;\n`,
      `const e = 1 / 2; // 除号\n`,
    ].join("");
    expect(stripComments(corpus), "快版剥注释 = 逐字符参考实现（逐字节）").toBe(stripCommentsNaive(corpus));
    // ① 正样例：授予形状必中
    expect(scanGrantShapeText(scan(`tools: [{ kind: "BUILTIN", name: "${bare}" }]`), ["plan_slice"]).length, "① 授予形状正样例必中").toBe(1);
    // ② 全名形态**不是**旧路（它是收敛后的目标形态）
    expect(
      scanGrantShapeText(scan(`tools: [{ kind: "BUILTIN", name: "${full}" }]`), ["plan_slice"]).length,
      "② 全名形态不得命中",
    ).toBe(0);
    // ③ 反向金丝雀（铁律 0.6 第 6 条）：**只出现在注释里**的同串不许被数到
    expect(
      scanGrantShapeText(scan(`// 旧路长这样：{ kind: "BUILTIN", name: "${bare}" }`), ["plan_slice"]).length,
      "③ 注释里的同串不许算（证明工具在数语法位置，不是数字符串出现）",
    ).toBe(0);
    // ④ 白名单查法：正样例必中
    expect(scanWhitelistText(scan(`toolWhitelist: ["query_objects", "${bare}"]`), ["plan_slice"]).length, "④ 白名单正样例必中").toBe(1);
    // ⑤ 白名单查法：全名形态必不中（子串匹配会把收敛结果误报成违规 ⇒ 这条是这道门的命门）
    expect(scanWhitelistText(scan(`toolWhitelist: ["${full}"]`), ["plan_slice"]).length, "⑤ 全名形态不得命中（引号锚定）").toBe(0);
    // ⑥ 嵌套方括号金丝雀（**M-D2 变异咬出来的那个假阴性**）：白名单里嵌着 `string[]` 时，
    //    裸名仍必须被数到 —— 非贪婪取到第一个 `]` 的实现会在这里漏掉。
    expect(
      scanWhitelistText(
        scan(`toolWhitelist: [...X.filter((n) => !(Y as readonly string[]).includes(n)), "${bare}"]`),
        ["plan_slice"],
      ).length,
      "⑥ 数组里嵌 `string[]` 时裸名仍必中（括号配对，不是取第一个 `]`）",
    ).toBe(1);
    // ⑦ 长数组金丝雀：裸名出现在数组第 700 字符之后仍必中（证明没有 600 字符窗口截断）
    expect(
      scanWhitelistText(scan(`toolWhitelist: [${'"pad", '.repeat(120)}"${bare}"]`), ["plan_slice"]).length,
      "⑦ 裸名在长数组尾部仍必中（无长度窗口）",
    ).toBe(1);
    // ⑧ 结构性反向：同样嵌套结构里换成全名 ⇒ 不许中
    expect(
      scanWhitelistText(
        scan(`toolWhitelist: [...X.filter((n) => !(Y as readonly string[]).includes(n)), "${full}"]`),
        ["plan_slice"],
      ).length,
      "⑧ 嵌套结构里的全名形态不得命中",
    ).toBe(0);
  });

  it("D1 全仓收敛：`{kind:\"BUILTIN\", name:切片裸名}` = 0 ∧ 白名单裸名 = 0（金丝雀 query_objects 必须非 0）", { timeout: 120_000 }, () => {
    const files = loadSources();
    // 金丝雀 ⓪：扫描面本身非空 —— 「遍历坏了」与「全仓干净」在屏上一模一样（铁律 0.6 判据 5）
    expect(files.length, "扫描面文件数（遍历坏了会得到空集 ⇒ 后面所有 0 命中都是假的）").toBeGreaterThan(100);
    console.log(`\n  ── D1 扫描面 ${files.length} 个源码文件（四包 src/test + harness .mjs，不含 dist）──\n`);

    const grantCanary = scanAll(scanGrantShapeText, ["query_objects"]);
    const grantViolations = scanAll(scanGrantShapeText, PROD_RAW_SLICES);
    const wlCanary = scanAll(scanWhitelistText, ["query_objects"]);
    const wlViolations = scanAll(scanWhitelistText, PROD_RAW_SLICES);
    console.log(
      `  ── D1 读数 ──\n` +
        `  授予形状: 切片裸名命中 ${grantViolations.length} / 金丝雀 query_objects 命中 ${grantCanary.length}\n` +
        `  白名单  : 切片裸名命中 ${wlViolations.length} / 金丝雀 query_objects 命中 ${wlCanary.length}\n` +
        (grantViolations.length ? `  ① 违规：\n  ${grantViolations.join("\n  ")}\n` : "") +
        (wlViolations.length ? `  ② 违规：\n  ${wlViolations.join("\n  ")}\n` : ""),
    );
    // 金丝雀**先**断言（与主判据同一查法）：为 0 ⇒ 报「工具坏了」，不许报「仓库干净」
    expect(grantCanary.length, "金丝雀①：同一条查法查 query_objects 必须非 0").toBeGreaterThan(0);
    expect(wlCanary.length, "金丝雀②：白名单查法查 query_objects 必须非 0").toBeGreaterThan(0);
    expect(grantViolations, "全仓 BUILTIN 裸名授予必须为 0").toEqual([]);
    expect(wlViolations, "全仓白名单裸名必须为 0").toEqual([]);
  });

  it("D2 通用 path-B 的工具装配：切片只以 MCP 形态产出（白名单不给 ⇒ 一件没有；旧记法仍认 ⇒ 不丢能力）", () => {
    const tools = buildExploratoryTools(seedScenarioPackage(), { simCommanderOn: false });
    // ① 裸 BUILTIN 切片不许再产出（「退旧路」在 path-B 上的落点）
    expect(
      tools.filter((t) => (PROD_RAW_SLICES as readonly string[]).includes(t.name)).map((t) => t.name),
      "path-B 工具面不许出现裸切片名",
    ).toEqual([]);
    // ② 两件切片以 MCP 形态在，且绑定指向本体 MCP 配置行
    const mcpSlices = tools.filter((t) => t.binding.kind === "MCP" && t.name.startsWith(`mcp__${ONTOLOGY_SERVER_NAME}__`));
    expect(mcpSlices.map((t) => t.name), "path-B 的切片工具").toEqual([SLICE_PLAN_MCP, SLICE_RESOLVE_MCP]);
    expect(
      mcpSlices.map((t) => (t.binding.kind === "MCP" ? t.binding.mcpConfigId : "")),
      "绑定指向本体 MCP 配置行",
    ).toEqual([ONTOLOGY_MCP_CONFIG_ID, ONTOLOGY_MCP_CONFIG_ID]);
    // ③ 描述逐字 = MCP server 广告文本（模型面单一来源）
    const advertised = buildOntologyMcpTools();
    for (const t of mcpSlices) {
      expect(t.description, `${t.name} 描述 = MCP 广告`).toBe(advertised.find((a) => a.name === t.name)!.description);
    }
    // ④ fail-closed 方向：白名单不给切片 ⇒ 一件都没有（授予由白名单驱动，不是无条件放行）
    const none = buildExploratoryTools({ toolWhitelist: ["query_objects"] }, { simCommanderOn: false });
    expect(none.filter((t) => t.name.startsWith(`mcp__${ONTOLOGY_SERVER_NAME}__`))).toEqual([]);
    // ⑤ 旧记法（升级前播种的场景包行里仍是裸名）仍认 ⇒ 存量租户不丢能力，但产出**恒为 MCP 形态**
    const legacyRaw = "resolve" + "_slice";
    const legacy = buildExploratoryTools({ toolWhitelist: ["query_objects", legacyRaw] }, { simCommanderOn: false });
    expect(legacy.map((t) => t.name), "旧记法仍授出（MCP 形态）").toContain(SLICE_RESOLVE_MCP);
    expect(legacy.some((t) => t.name === legacyRaw), "旧记法也不产出裸名").toBe(false);
    // 金丝雀：整表没空掉（否则上面所有 not.toContain 对空实现恒真）
    expect(tools.map((t) => t.name)).toContain("query_objects");
    expect(tools.map((t) => t.name)).toContain("invoke_solver");
  });

  it("D3 path-B e2e（真跑）：退裸名之后模型仍能真调切片 —— 走 MCP 授予面、回到同一只执行体", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn({ content: [toolUse(SLICE_RESOLVE_MCP, { sliceKey: "biz.Order.Base", args: {} })] });
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "切片已消费，结论见下。" }], provenance: [] })],
    });
    const resolveSpy = vi.spyOn(t.dataCore.ontology, "resolveSlice");
    const { taskId } = await submitQuery(t, PLANNER, "把所有能查的都翻一遍并给我一个综合自由结论", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 30_000);

    // 金丝雀 ⓪：真走通用 path-B（没有 agent 定义那条路），不是 path-A / 组合路径
    expect(task.path, "真走通用 path-B").toBe("AGENT");
    expect(task.status).toBe("COMPLETED");

    // ① 模型面：切片只有 MCP 形态（裸名不许出现 —— 有 = 两条路都还在）
    const visible = nativeVisibleTools(t).map((x) => x.name);
    console.log(
      `\n  ── D3 path-B 模型面（共 ${visible.length} 件，切片相关列出）──\n  ${visible
        .filter((n) => /ontology|slice/.test(n))
        .join("\n  ")}\n`,
    );
    expect(visible, "path-B 模型面").toContain(SLICE_RESOLVE_MCP);
    expect(visible, "裸切片名不许出现在模型面").not.toContain(SLICE_RESOLVE_RAW);
    expect(visible, "裸切片名不许出现在模型面").not.toContain(SLICE_PLAN_RAW);

    // ② 能力不减：切片真被执行体打到，入参逐字 = 模型给的
    expect(resolveSpy.mock.calls.length, "resolveSlice 真调一次").toBe(1);
    expect(resolveSpy.mock.calls[0]![1]).toBe("biz.Order.Base");

    // ③ 同一只执行体：审计行落在**裸名**上（executor 的归一形态，与 DSH 臂 / 注册 agent 臂同口径）
    const rows = await t.repos.toolCalls.listByTask(taskId);
    const row = rows.find((r) => r.toolName === SLICE_RESOLVE_RAW);
    expect(row?.outcome, "审计行（裸名归一口径）").toBe("OK");
    expect(rows.find((r) => r.toolName === SLICE_RESOLVE_MCP), "审计面不许有全名行").toBeUndefined();
    expect(rows.length, "金丝雀：审计面确实有行（否则上面的 find 是空集合上的 find）").toBeGreaterThan(0);

    // ④ 切片数据真回模型面（下一轮请求体里可见）
    const req1 = JSON.stringify(t.llm.agentRequests[1] ?? {});
    expect(req1, "切片节点数据真回灌").toContain("Order_to_Base");
    console.log(`\n  ── D3 审计行 ──\n  ${JSON.stringify(rows.map((r) => `${r.toolName}/${r.outcome}`))}\n`);
    await t.app.close();
  });
});
