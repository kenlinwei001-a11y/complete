/**
 * WO-SOLVERS-MCP-REAL · 求解器落到 DSH 原生 MCP 模式，并在**真子进程 + 真 HTTP 回环**上可达。
 *
 * **今天的行为是 X**（改造前）：`mcp__solvers__{key}` 只是一个**合成名** —— 仓里只有
 * 「目录投影（治理端点）+ 执行归一（executor 的 A1 shim）」两半，**没有真 MCP server**，
 * seed 里也没有对应的 `McpServerConfig` 行 ⇒ DSH 臂**无 server 可挂**、`dsh-mcp-client`
 * 不 spawn 任何进程 ⇒ 这些工具**对模型不可达**（有声明、无实体）。
 * **应该是 Y**（本单）：seed 有 `mcp_builtin_solvers` 行；DSH 分叉真 spawn
 * `dist/dsh-runtime/solvers-mcp-server.js`，`tools/list` 给出求解器工具；`tools/call`
 * 走 MCP wire 转回宿主反向通道 → **同一只** GuardedToolExecutor 归一到 `invoke_solver`。
 *
 * 【每条断言独立重算出处】
 *  · A1 的工具名集合 —— 本文件用**模板串**独立拼 `mcp__${server}__${key}`，不调生产 helper；
 *  · A2 宿主收到的 toolName/args —— 本文件起的 HTTP 回环**逐字节记录**请求体，与手写期望比；
 *  · A3/A4/B3/D2 对照实验 —— 改掉/减掉某一个输入，先写预言再真跑对上；
 *  · B 求解器实收入参 —— 取 `dataCore.solver.invoke` 的**调用实参**；审计名取 `repos.toolCalls` 真落行；
 *  · D 展开集 —— 取活目录 `solverRegistry()` 逐 key 与授予面求交，朴素模板串重算。
 * ⛔ 无 `count()>0` 之类存在性断言；计数一律配「独立算出来的那个数」。
 */
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { TENANT, createTestApp } from "./helpers.js";
import { seedRegistry, seedMcpConfigs } from "../src/mocks/seed.js";
import { buildSolverMcpWireTools, SOLVERS_MCP_CONFIG_ID, type SolverCatalogItem } from "../src/mcp/solvers-catalog.js";

const SERVER_PATH = fileURLToPath(new URL("../dist/dsh-runtime/solvers-mcp-server.js", import.meta.url));
const SERVER_NAME = "solvers";
/** 独立重算（不调 solverMcpToolName）：全名 = mcp__{server}__{key}。 */
const fullNameOf = (key: string): string => `mcp__${SERVER_NAME}__${key}`;

/**
 * 持有求解器能力的 agent 全集（6 个首批迁移 + 4 个退裸名时一并迁）。
 * **常量名单，不是「扫出来有 MCP ref 的」** —— 后者会让漏迁的 agent 自动豁免（自证式断言）。
 * C 组（三面同改）与 D 组（展开面）**共用这一份**，不各写一份。
 */
const MIGRATED = [
  "analyst", "explore_agent", "risk_advisor", "capacity_planner", "quality_inspector", "supply_chain",
  "finance_analyst", "carbon_auditor", "external_market", "coordinator",
];

/** 本单的样例求解器目录（形状 = CatalogClient.solverRegistry 的 item）。 */
const SAMPLE_ITEMS: SolverCatalogItem[] = [
  { key: "capacity_forecast", name: "产能可行性", description: "型号需求增量产能校核", argHints: { modelId: "型号", weeks: "周数" } },
  { key: "yield_diagnosis", name: "良率诊断", description: "良率波动根因", argHints: {} },
];

interface CapturedReq {
  runToken?: string;
  callId?: string;
  toolName?: string;
  input?: Record<string, unknown>;
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
  return { seen, url: `http://127.0.0.1:${port}/b/v1/dsh/tool-execute`, close: () => new Promise<void>((r) => srv.close(() => r())) };
}

const openClients: Client[] = [];
afterEach(async () => {
  for (const c of openClients.splice(0)) await c.close().catch(() => {});
});

/** 真 spawn 求解器 MCP server 并完成 MCP 握手。 */
async function connectServer(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, ...env } as Record<string, string>,
    stderr: "ignore",
  });
  const client = new Client({ name: "wo-solvers-test", version: "0.0.1" });
  await client.connect(transport);
  openClients.push(client);
  return client;
}

const TOOLS_ENV = (items = SAMPLE_ITEMS) => ({ SOLVERS_MCP_TOOLS_JSON: JSON.stringify(buildSolverMcpWireTools(items)) });

describe("WO-SOLVERS-MCP-REAL · A 组：真 stdio MCP server（MCP wire 面）", () => {
  it("前置自证：server 入口文件真实存在（不存在则本组全无意义）", () => {
    expect(existsSync(SERVER_PATH), `缺入口 ${SERVER_PATH}（先 pnpm --filter agentcore build）`).toBe(true);
  });

  it("A1 tools/list：工具名 == 独立拼出来的 mcp__solvers__{key}，且声明模式逐字段透传", async () => {
    const client = await connectServer(TOOLS_ENV());
    const { tools } = await client.listTools();
    // 独立重算：期望名由本文件模板串拼，不用生产 helper
    expect(tools.map((t) => t.name).sort()).toEqual(["capacity_forecast", "yield_diagnosis"]);
    expect(tools.map((t) => fullNameOf(t.name)).sort()).toEqual([
      "mcp__solvers__capacity_forecast",
      "mcp__solvers__yield_diagnosis",
    ]);
    // 声明面**逐字段**透传（模型据此传参；漂了就与执行侧收参形态脱钩）
    const cap = tools.find((t) => t.name === "capacity_forecast")!;
    const declared = buildSolverMcpWireTools(SAMPLE_ITEMS).find((t) => t.rawName === "capacity_forecast")!;
    expect(cap.inputSchema).toEqual(declared.inputSchema);
    // 描述带来源前缀（两内核模型面同源的锚点）
    expect(cap.description!.startsWith("[MCP·求解器] ")).toBe(true);
  });

  it("A2 tools/call：宿主收到的是**全名 + 扁平原文**；模型面回执是逐字 <tool_data> 包络", async () => {
    const loop = await startHostLoopback({ outcome: "OK", payloadJson: '{"capacity":1234}', toolCallId: "tc_9" });
    try {
      const client = await connectServer({ ...TOOLS_ENV(), PLATFORM_TOOL_EXEC_URL: loop.url, DSH_RUN_TOKEN: "rt_test" });
      const r = await client.callTool({ name: "capacity_forecast", arguments: { modelId: "4680-NCM", weeks: 6 } });
      // 宿主侧逐字节证据（值校验：独立记录的请求体）
      expect(loop.seen).toHaveLength(1);
      const seen = loop.seen[0]!;
      expect(seen.toolName).toBe("mcp__solvers__capacity_forecast");
      expect(seen.runToken).toBe("rt_test");
      expect(seen.input).toEqual({ modelId: "4680-NCM", weeks: 6 });
      // 模型面回执：payloadJson 原样透传、toolCallId 用宿主的（禁 parse/stringify 往返）
      const text = (r.content as { type: string; text: string }[])[0]!.text;
      expect(text).toBe('<tool_data tool_call_id="tc_9">{"capacity":1234}</tool_data>');
      expect(r.isError).toBeFalsy();
    } finally {
      await loop.close();
    }
  });

  it("A3 对照实验（减输入）：拿掉 SOLVERS_MCP_TOOLS_JSON ⇒ 工具数 2 → 0（证明 env 是真来源）", async () => {
    const withEnv = await connectServer(TOOLS_ENV());
    const nWith = (await withEnv.listTools()).tools.length;
    const without = await connectServer({});
    const nWithout = (await without.listTools()).tools.length;
    // 金丝雀与主断言并排：withEnv 必须恰为 2，否则「0」不说明任何事
    expect(nWith).toBe(2);
    expect(nWithout).toBe(0);
  });

  it("A4 对照实验（改输入）：改 argHints ⇒ wire 上 description 按可预言的方式变", async () => {
    const base = await connectServer(TOOLS_ENV());
    const d0 = (await base.listTools()).tools.find((t) => t.name === "capacity_forecast")!.description;
    const mutated = [{ ...SAMPLE_ITEMS[0]!, argHints: { weeks: "周数(改)" } }, SAMPLE_ITEMS[1]!];
    const c2 = await connectServer(TOOLS_ENV(mutated));
    const d1 = (await c2.listTools()).tools.find((t) => t.name === "capacity_forecast")!.description;
    expect(d0).toContain("modelId=型号");
    expect(d1).not.toContain("modelId=型号");
    expect(d1).toContain("weeks=周数(改)");
  });

  it("A5 未授予的工具：回 isError 且宿主收到 **0** 次转发（fail-closed，不猜）", async () => {
    const loop = await startHostLoopback({ outcome: "OK", payloadJson: "{}" });
    try {
      const client = await connectServer({ ...TOOLS_ENV(), PLATFORM_TOOL_EXEC_URL: loop.url, DSH_RUN_TOKEN: "rt_test" });
      const r = await client.callTool({ name: "not_granted_solver", arguments: {} });
      expect(r.isError).toBe(true);
      // 独立重算出来的那个数：0（不是「>0」）
      expect(loop.seen).toHaveLength(0);
    } finally {
      await loop.close();
    }
  });
});

describe("WO-SOLVERS-MCP-REAL · B 组：执行归一 + 入参形态（真 executor）", () => {
  /** 捕获求解器**实参**（不看回执，看调用实参）；同时留 repos 供查真审计行。 */
  function makeExec() {
    const dataCore = createMockDataCore();
    const calls: { key: string; args: Record<string, unknown> }[] = [];
    const orig = dataCore.solver.invoke.bind(dataCore.solver);
    dataCore.solver.invoke = (async (_ctx: unknown, key: string, args: Record<string, unknown>) => {
      calls.push({ key, args });
      return orig(_ctx as never, key, args);
    }) as typeof dataCore.solver.invoke;
    const repos = createMemoryRepos();
    const exec = new GuardedToolExecutor(
      { dataCore, repos, metrics: new Metrics() },
      {
        taskId: "t_solvers_mcp",
        ctx: { tenantId: TENANT, userId: "admin", roles: ["admin"] },
        budget: new BudgetTracker(),
        // 授予面：求解器全名（scope 门用**全名**校验）+ 一个对照用 BUILTIN
        scopeToolNames: [fullNameOf("capacity_forecast"), "query_objects"],
      },
    );
    return { exec, calls, repos };
  }

  it("B1 值校验：按**声明面**（扁平入参）调用 ⇒ 求解器实参逐键等于扁平原文（不许被丢成 {}）", async () => {
    const { exec, calls } = makeExec();
    await exec.run("mcp__solvers__capacity_forecast", { modelId: "4680-NCM", demandDelta: 0.1, weeks: 6 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe("capacity_forecast");
    expect(calls[0]!.args).toEqual({ modelId: "4680-NCM", demandDelta: 0.1, weeks: 6 });
  });

  it("B2 兼容：既有 {args:{…}} 包裹形态仍走同一条路（逐键相等）", async () => {
    const { exec, calls } = makeExec();
    await exec.run("mcp__solvers__capacity_forecast", { args: { modelId: "4680-NCM", weeks: 6 } });
    expect(calls[0]!.args).toEqual({ modelId: "4680-NCM", weeks: 6 });
  });

  it("B3 对照实验（改工具名 ⇒ 结果按可预言的方式变）：授予名→实参到位；未授予名→零实参 + 审计 DENIED", async () => {
    const { exec, calls, repos } = makeExec();
    await exec.run("mcp__solvers__yield_diagnosis", { processKey: "P1", days: 7 });
    // 预言：scope 面未授予 ⇒ 不进执行体，零实参
    expect(calls).toHaveLength(0);
    const denied = await repos.toolCalls.listByTask("t_solvers_mcp");
    expect(denied.map((r) => [r.toolName, r.outcome])).toEqual([["mcp__solvers__yield_diagnosis", "DENIED"]]);
    // 改成授予面内的名字 ⇒ 恰好一次实参，且 args 原样（名称不污染 args）
    await exec.run("mcp__solvers__capacity_forecast", { processKey: "P1", days: 7 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ key: "capacity_forecast", args: { processKey: "P1", days: 7 } });
  });

  it("B4 审计名归一到 invoke_solver（并以同一条读法做对照，证明读的是真落行）", async () => {
    const { exec, repos } = makeExec();
    await exec.run("mcp__solvers__capacity_forecast", { modelId: "X", weeks: 1 });
    await exec.run("query_objects", { objectType: "Model" });
    const rows = await repos.toolCalls.listByTask("t_solvers_mcp");
    // 求解器那笔记归一名；对照那笔保持原名 ⇒ 该读法有鉴别力（不是恒返回同一串）
    expect(rows.map((r) => r.toolName)).toEqual(["invoke_solver", "query_objects"]);
  });
});

describe("WO-SOLVERS-MCP-REAL · C 组：三面同改（授予面 ∧ 挂载面 ∧ 声明面）", () => {
  it("C1 每个已迁移 agent：tools 的 MCP ref、mcpServers 挂载行、scopeDeclaration 全名**三面一致**", () => {
    const agents = seedRegistry().agents.filter((a) => MIGRATED.includes(a.key));
    expect(agents.map((a) => a.key).sort()).toEqual([...MIGRATED].sort()); // 金丝雀：十个都在
    for (const a of agents) {
      const ref = a.tools.find((t) => t.kind === "MCP" && t.mcpConfigId === SOLVERS_MCP_CONFIG_ID);
      expect(ref, `${a.key} 缺授予面`).toBeTruthy();
      const filter = (ref as { toolFilter?: string[] }).toolFilter ?? [];
      // 独立重算：每个 filter 名必须等于本文件模板串拼出来的全名
      for (const n of filter) expect(n).toBe(fullNameOf(n.replace(`mcp__${SERVER_NAME}__`, "")));
      // 挂载面
      expect(a.mcpServers.some((m) => m.mcpConfigId === SOLVERS_MCP_CONFIG_ID), `${a.key} 缺挂载面`).toBe(true);
      // 声明面 ⊇ 授予面（逐名）
      for (const n of filter) expect(a.scopeDeclaration.toolNames, `${a.key} 声明面漏 ${n}`).toContain(n);
      // 裸名已退净（对照：旧形态必须为 0）
      expect(a.tools.some((t) => t.kind === "BUILTIN" && t.name === "invoke_solver"), `${a.key} 仍有裸名授予`).toBe(false);
    }
  });

  it("C2 seed 真的有求解器 MCP server 配置行，且 serverName 与工具名前缀同源", () => {
    const row = seedMcpConfigs().find((m) => m.id === SOLVERS_MCP_CONFIG_ID);
    expect(row).toBeTruthy();
    expect(row!.serverName).toBe(SERVER_NAME);
    expect(row!.transport.type).toBe("stdio");
    // 工具名前缀由 serverName 拼出（同一串，serverName 改了两处一起改）
    expect(fullNameOf("x")).toBe(`mcp__${row!.serverName}__x`);
  });

  it("C3 幽灵授予即红：十个 agent 的**每一个**授予键都真在活目录里（逐键核，不是数个数）", async () => {
    const t = await createTestApp();
    const registryKeys = new Set(
      (await t.dataCore.catalog.solverRegistry({ tenantId: TENANT, userId: "admin", roles: ["admin"] })).items.map((i) => i.key),
    );
    expect(registryKeys.size).toBeGreaterThan(50); // 金丝雀：目录活了，「一个都不缺」才有意义
    const missing: string[] = [];
    for (const a of seedRegistry().agents.filter((x) => MIGRATED.includes(x.key))) {
      for (const ref of a.tools) {
        if (ref.kind !== "MCP" || ref.mcpConfigId !== SOLVERS_MCP_CONFIG_ID) continue;
        for (const n of (ref as { toolFilter?: string[] }).toolFilter ?? []) {
          const key = n.replace(`mcp__${SERVER_NAME}__`, "");
          if (!registryKeys.has(key)) missing.push(`${a.key}:${key}`);
        }
      }
    }
    // 反面实例（本条就是为抓它而写）：`sop_balance` 是本仓 S1.8 服务/场景卡的名字，
    // **不在** SOLVER_KEYS（63 条无此键）⇒ 授予它 = 三面结构齐全而目录里永远没有这件工具
    //（有声明、无实体）。写这个断言时 seed 里真有三处，已改为登记替身 `mrp_netting`。
    expect(missing).toEqual([]);
  });
});

describe("WO-SOLVERS-MCP-REAL · D 组：引擎展开面（原生臂与 DSH 臂的共同派生源）", () => {
  const ctx = { tenantId: TENANT, userId: "admin", roles: ["admin"] };
  const solverSpecsOf = (specs: { name: string; binding: { kind: string; mcpConfigId?: string } }[]) =>
    specs.filter((s) => s.binding.kind === "MCP" && s.binding.mcpConfigId === SOLVERS_MCP_CONFIG_ID).map((s) => s.name).sort();

  it("D1 值校验：十个 agent 各自展开出的求解器工具 == 活目录 ∩ 该 agent 授予面（逐 agent 独立重算）", async () => {
    const t = await createTestApp();
    for (const m of seedMcpConfigs()) await t.repos.mcpConfigs.insert(m);
    const items = (await t.dataCore.catalog.solverRegistry(ctx)).items;
    const registryKeys = new Set(items.map((i) => i.key));
    expect(registryKeys.size).toBeGreaterThan(50); // 金丝雀：目录活了，否则交集恒空、断言无意义
    const expanded: Record<string, string[]> = {};
    for (const key of MIGRATED) {
      const agent = seedRegistry().agents.find((a) => a.key === key)!;
      const ref = agent.tools.find((x) => x.kind === "MCP" && x.mcpConfigId === SOLVERS_MCP_CONFIG_ID) as { toolFilter?: string[] };
      // 独立重算：授予面逐键 ∩ 活目录（朴素模板串拼全名，不调生产 helper）
      const granted = (ref.toolFilter ?? []).map((n) => n.replace(`mcp__${SERVER_NAME}__`, ""));
      expect(granted.length, `${key} 授予面为空 —— 交集恒空，断言无意义`).toBeGreaterThan(0);
      const expected = granted.filter((k) => registryKeys.has(k)).map(fullNameOf).sort();
      const specs = await t.deps.engine.expandAgentTools(agent, ctx);
      expanded[key] = solverSpecsOf(specs);
      expect(expanded[key], `${key} 展开集 != 授予面 ∩ 活目录`).toEqual(expected);
      expect(expected.length, `${key} 声明了却一条都没展开`).toBeGreaterThan(0);
    }
    // 十个 agent 的展开集**两两不同来源**：先证明它们不是同一份被复用（否则上面十条等于只测了一条）
    expect(new Set(Object.values(expanded).map((v) => v.join(","))).size).toBeGreaterThan(3);
    // 展开的描述带来源前缀（两内核同一段文字）
    const analystSpecs = await t.deps.engine.expandAgentTools(seedRegistry().agents.find((a) => a.key === "analyst")!, ctx);
    const one = analystSpecs.find((s) => s.name === fullNameOf("capacity_forecast"))!;
    expect(one.description.startsWith("[MCP·求解器] ")).toBe(true);
  });

  it("D2 对照实验（改授予面 ⇒ 展开集按可预言方式变）：全放行 63 条 / 收窄到 1 条 / 该 agent 恰 1 条", async () => {
    const t = await createTestApp();
    for (const m of seedMcpConfigs()) await t.repos.mcpConfigs.insert(m);
    const registryKeys = (await t.dataCore.catalog.solverRegistry(ctx)).items.map((i) => i.key);
    const base = seedRegistry().agents.find((a) => a.key === "analyst")!;
    const withSolvers = (toolFilter?: string[]) => ({
      ...base,
      tools: base.tools.map((x) =>
        x.kind === "MCP" && x.mcpConfigId === SOLVERS_MCP_CONFIG_ID ? ({ kind: "MCP", mcpConfigId: SOLVERS_MCP_CONFIG_ID, ...(toolFilter ? { toolFilter } : {}) } as typeof x) : x,
      ),
    });
    // X → 去掉过滤器：预言 = 活目录里**每一个** key 都出现（逐 key 独立重算）
    const all = solverSpecsOf(await t.deps.engine.expandAgentTools(withSolvers(undefined), ctx));
    expect(all).toEqual([...registryKeys].map(fullNameOf).sort());
    // X' → 收窄到单个 key：预言 = 恰好那一条（且上面那个全集里它本来就在，属真子集）
    const narrowed = solverSpecsOf(await t.deps.engine.expandAgentTools(withSolvers([fullNameOf("yield_diagnosis")]), ctx));
    expect(narrowed).toEqual([fullNameOf("yield_diagnosis")]);
    expect(all.length).toBeGreaterThan(narrowed.length);
  });

  it("D3 反例：**名单之外**的 agent 展开出 0 条求解器工具（金丝雀：它确有自己的工具，且这样的 agent 真存在）", async () => {
    const t = await createTestApp();
    for (const m of seedMcpConfigs()) await t.repos.mcpConfigs.insert(m);
    // 判据是**名单**而不是某一名写死的 agent：写死过 `finance_analyst`，它一被迁移这条反例就失效
    // （实测：撤掉这条写死后真红了 1 条 —— 那次红是对的，反例选错了对象）。
    const others = seedRegistry().agents.filter((a) => !MIGRATED.includes(a.key));
    expect(others.length, "没有『名单之外』的 agent ⇒ 反例空转，等于没测").toBeGreaterThan(0);
    expect(others.map((a) => a.key)).toContain("code_assistant"); // 独立旁证：这个反例对象是具体的、不是空集
    for (const agent of others) {
      const specs = await t.deps.engine.expandAgentTools(agent, ctx);
      // 金丝雀与主断言并排：这名 agent 的 tools 非空，否则「0 条求解器」可能只是没读到它的 tools
      expect(specs.length, `${agent.key} 自己的工具为 0 ⇒ 断言无鉴别力`).toBeGreaterThan(0);
      expect(solverSpecsOf(specs), `${agent.key} 未挂求解器 server 却展开了求解器工具`).toEqual([]);
    }
  });
});
