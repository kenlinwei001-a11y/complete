/**
 * WO-DSH-ARM-AD-SURFACE · DSH 臂端到端实测：**模型被广告的求解器工具集 ⊆ 它真正能调用的集合**吗？
 *
 * ══ 上游留下的那条 NOT-MEASURED（本文件要证伪或证实的那一句）════════════════════════
 * 前两单把「广告面 ⊆ 可调用面」在**原生臂**上收了两层：
 *   · WO-ROSTER-RESPECT-TOOLFILTER —— 提示词目录段收进 `tools[].toolFilter`；
 *   · WO-MCP-TOP8-VS-ROSTER —— 再收进「本 run 模型面终态」（Phase6C top-k 之后）。
 * 当时登记的原话（未端到端实测的那半）：
 *   「**DSH 臂有意不收窄**：那条路子进程挂的 solver server 把 `toolFilter` 全量目录交给模型
 *    （top-k 收窄只作用于宿主授予面），广告全量在那里才是诚实的；**DSH 臂「16 条全可调」
 *    未端到端实测**（据读码 + 既有 dsh 接缝测试绿）。」
 * 本文件就是那条缺失的实测。
 *
 * ══ 两个面怎么取（两边都必须来自**真装配**，⛔ 不许拿桩的返回值当广告面的证据）══════
 *  · **广告面 A**：DSH 子进程**首轮真发给模型的 `tools[]`**（= 子进程 `tools/list` 经
 *    `mcp-client-tenant` 注册进 ToolRuntime 的那一份，其源是宿主 spawn 前现算的
 *    `SOLVERS_MCP_TOOLS_JSON`）—— 取 `mcp__solvers__*` 的**裸键**。这是模型真看见的东西，
 *    不是我们对 `expanded` 的复算。
 *  · **可调用面 C**：本 run **登记给反向通道的那只 executor**（engine 的
 *    `dshToolExecuteRuns` 活条目 —— 即 `/b/v1/dsh/tool-execute` 端点会取到的那一只），
 *    逐键**真调** `executor.run("mcp__solvers__{key}", …)`，把放行的键收下。
 *    判据落在**实值**（该实例的 scope 面 = `scopeDeclaration.toolNames ∪ 本 run 授予面`）
 *    **外加真跑一次**，不是读变量名、也不是复算一遍公式。
 *
 * ══ 判据 ═══════════════════════════════════════════════════════════════════════════
 *  ① MCP 工具 ≤8 的 agent（`agt_capacity_planner`）：A − C 与 C − A **双向为空**；
 *  ②④ MCP 工具 >8 的 agent（`agt_seed_analyst`·16 求解器）：同上，且**端到端真调一条**
 *      （原生臂 top-8 截掉的那条）—— 回执真载荷 + 宿主审计行非 DENIED；
 *  ③ 对照实验（判据有牙）：把一条不在白名单的求解器**放进白名单** ⇒ 它**从不在广告面变在**，
 *      并且把声明面清空后 **A − C 必然非空** —— 证明这台量具报得出「非空」这个结论，
 *      不是一台恒报空的装饰品。
 *
 * ⚠ 金丝雀：报「差集为空」时同臂必须给出**确定在的键**（抽取器活着）；报「DENIED」时同臂
 *   必须给出**确定放行的键**（闸有鉴别力）。两者缺一，否定结论一律不许信。
 */
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "@platform/contracts";
import { TENANT, createTestApp, setKernelRuntime, type TestApp } from "./helpers.js";
import { STUB_DCP_SPEC, startStubOpenAi, stubDirectory, stubProvider, type StubRound } from "./helpers-dsh-stub.js";
import { seedMcpConfigs, seedRegistry } from "../src/mocks/seed.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";
import type { DshToolExecuteRun } from "../src/engine.js";
import { SOLVERS_MCP_CONFIG_ID } from "../src/mcp/solvers-catalog.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = join(REPO_ROOT, "packages/dsh-harness");

const SEAM_TIMEOUT = 90_000;
const CTX: ToolAuthCtx = { tenantId: TENANT, userId: "u", roles: ["planner"] };
/** 进程级旗标：engine 分叉直读 `process.env`；还原在 afterEach。 */
const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "QOS_AGENT_LOOP_REPEAT_CAP", "QOS_AGENT_PER_TOOL_CALL_CAP"] as const;

const FAKE_LLM_KEY = "wo-ad-surface-fake-llm-key-000000000000000000";
const SERVICE_TOKEN = "wo-ad-surface-service-token-0000000000000";
const PLAIN_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };
/** 全名 = mcp__{server}__{key}（生产单源 helper；本文件**独立**再拼一份模板串做交叉对拍）。 */
const SOLVER_PREFIX = `mcp__solvers__`;
const fullNameOf = (key: string): string => `mcp__solvers__${key}`;

/** 与 `mcp-top8-vs-roster.seam.test.ts` / `arm-failure-visible` 同一句（活服务实测问句）。 */
const PROMPT = "常州基地当前的产能利用率是多少？瓶颈在哪道工序？";
const FINAL_ANSWER_ARGS = JSON.stringify({
  blocks: [{ type: "text", markdown: "见工具结果。" }],
  provenance: [],
});

/** 被测的两个出厂 agent（一个 ≤8 档、一个 >8 档）。 */
const AGENT_CAPACITY = "agt_capacity_planner";
const AGENT_ANALYST = "agt_seed_analyst";
/**
 * 对照用求解器键：**真在活目录里**（本文件用 solverRegistry 现算核实），但**不在** analyst /
 * capacity_planner 的白名单内 ⇒ 「放进白名单」这个动作对广告面是否可观测，就靠它。
 */
const OFF_WHITELIST_KEY = "lta_gap";

// ---------------------------------------------------------------------------
// 夹具（与 `dsh-resource-reach.seam.test.ts` B 组同构：真 fork + 真 MCP 子进程 + 真 HTTP 回环）
// ---------------------------------------------------------------------------
interface Emitted {
  event: string;
  payload: unknown;
}

async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** 出厂 agent 原样取出，只覆写内核选择与模型（tools/scopeDeclaration/mcpServers 全是出厂值）。 */
function seedDshAgent(id: string, overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  const base = seedRegistry().agents.find((a) => a.id === id);
  if (!base) throw new Error(`seed agent not found: ${id}`);
  return { ...base, model: STUB_DCP_SPEC, kernel: "EXTERNAL", ...overrides } as AgentDefinition;
}

async function seedWorld(t: TestApp, agent: AgentDefinition): Promise<void> {
  for (const m of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(m.id))) await t.repos.mcpConfigs.insert(m);
  for (const wf of seedRegistry().workflows) if (!(await t.repos.workflows.get(wf.id))) await t.repos.workflows.insert(wf);
  for (const sk of seedRegistry().skills) if (!(await t.repos.skills.get(sk.id))) await t.repos.skills.insert(sk);
  await t.repos.agents.insert(agent);
}

async function startDshApp(stubUrl: string): Promise<{ t: TestApp; close: () => Promise<void> }> {
  const port = await freePort();
  const t = await createTestApp({
    // WO-CLOSE-NATIVE-GAPS：内核臂改由测试装配位给（agent.kernel 字段已退役）
    kernelRuntime: "dsh",
    providerDirectory: stubDirectory(stubProvider(stubUrl), FAKE_LLM_KEY) as never,
    // 反向通道（/b/v1/dsh/tool-execute）要求 SERVICE_TOKEN；PORT 必须是子进程连得上的真端口。
    env: { PORT: String(port), SERVICE_TOKEN },
  });
  await t.app.listen({ port, host: "127.0.0.1" });
  return { t, close: () => t.app.close() };
}

interface DshRunProbe {
  result: Awaited<ReturnType<TestApp["deps"]["engine"]["runRegisteredAgent"]>>;
  /**
   * 本 run 登记给反向通道的活条目 —— **就是 `/b/v1/dsh/tool-execute` 会取到的那一只**
   * （端点读 `deps.engine.dshToolExecuteRuns.get(runToken)`）。捕获方式 = 钩住这张 Map 的
   * `set`，故拿到的是**同一引用**，不是重建的副本。
   */
  entry: DshToolExecuteRun;
}

async function runDsh(
  t: TestApp,
  agent: AgentDefinition,
  taskId: string,
  script: StubRound[],
  stub: { requests: { body: unknown }[] },
): Promise<DshRunProbe> {
  const runs = t.deps.engine.dshToolExecuteRuns;
  const captured: DshToolExecuteRun[] = [];
  const origSet = runs.set.bind(runs);
  runs.set = ((k: string, v: DshToolExecuteRun) => {
    captured.push(v);
    return origSet(k, v);
  }) as typeof runs.set;
  try {
    const emitted: Emitted[] = [];
    const result = await t.deps.engine.runRegisteredAgent({
      taskId,
      agentId: agent.id,
      version: 1,
      prompt: PROMPT,
      ctx: CTX,
      nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agent.id),
      emit: async (event, payload) => {
        emitted.push({ event, payload });
      },
    });
    expect(result.run.kernel, "没走 DSH 分叉 ⇒ 本臂量的是原生路，与本题无关").toBe("EXTERNAL");
    expect(captured.length, "dsh 分叉没登记反向通道条目 ⇒ 可调用面无从取（量具坏了）").toBe(1);
    expect(stub.requests.length, "stub 一轮都没收到 ⇒ 子进程没起来").toBeGreaterThan(0);
    return { result, entry: captured[0]! };
  } finally {
    delete (runs as { set?: unknown }).set;
  }
}

// ---------------------------------------------------------------------------
// 两个面的抽取器
// ---------------------------------------------------------------------------

/** 广告面 A：DSH 子进程首轮真发给模型的 `tools[]` 里 `mcp__solvers__*` 的裸键。 */
function advertisedSolverKeys(stub: { requests: { body: unknown }[] }): string[] {
  const tools = (stub.requests[0]?.body as { tools?: { function?: { name?: string } }[] } | undefined)?.tools ?? [];
  return tools
    .map((x) => x.function?.name ?? "")
    .filter((n) => n.startsWith(SOLVER_PREFIX))
    .map((n) => n.slice(SOLVER_PREFIX.length))
    .sort();
}

/**
 * 可调用面候选（**实值**，不是复算的公式）：这只 executor 的 scope 面上 `mcp__solvers__*` 的裸键。
 * ⚠ 与「广告面」**不同源**：A 取自子进程真发给模型的 tools[]，本函数取自宿主登记给反向通道的
 *   执行体实例。两面独立取，差集才有意义。
 */
function gateScopeSolverKeys(entry: DshToolExecuteRun): string[] {
  const scope = (entry.executor as unknown as { opts?: { scopeToolNames?: string[] } }).opts?.scopeToolNames ?? [];
  return scope
    .filter((n) => n.startsWith(SOLVER_PREFIX))
    .map((n) => n.slice(SOLVER_PREFIX.length))
    .sort();
}

interface GateProbe {
  key: string;
  outcome: string;
  errorCode?: string;
}

/**
 * 逐键**真调**本 run 的那只 executor（判据 = 放不放行，不是读名单）。
 *
 * `budgetDecision:{ok:true}` 的用意：executor 的**预算门在第 2 步**（scope 门在第 0 步），
 * 探测若吃掉本 run 的预算，后几条会退化成 `BUDGET_EXCEEDED`，把「真执行过」这条证据弄丢。
 * 传它 = 声明「本轮不再重复消耗」（该形参的既有语义：并行轮由循环侧预计数）——
 * 判决点（scope 门）不受影响；预算这条轴不在本单判据内（DSH 真路径确实会消耗预算，
 * 见报告 NOT-MEASURED 段）。
 */
async function probeGate(entry: DshToolExecuteRun, keys: string[]): Promise<GateProbe[]> {
  const out: GateProbe[] = [];
  for (const k of [...keys].sort()) {
    const r = await entry.executor.run(fullNameOf(k), {}, { budgetDecision: { ok: true } });
    const payload = r.payload as { error?: { code?: string } } | undefined;
    out.push({ key: k, outcome: r.outcome, ...(payload?.error?.code ? { errorCode: payload.error.code } : {}) });
  }
  return out;
}

/** scope 门放行 = 不是 DENIED（OK/ERROR 都说明它走到了执行体）。 */
const callable = (probes: GateProbe[]): string[] => probes.filter((p) => p.outcome !== "DENIED").map((p) => p.key);

function diff(a: string[], b: string[]): { over: string[]; under: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return { over: [...sa].filter((k) => !sb.has(k)), under: [...sb].filter((k) => !sa.has(k)) };
}

/**
 * 提示词**求解器目录段**的键（与 `mcp-top8-vs-roster.seam.test.ts` / `roster-toolfilter.seam.test.ts`
 * 同一台抽取器：只在标题之后取 `  · key：` 行）。前两单收的就是这一段；DSH 臂上它是否也 ⊆ 可调用面
 * 是本单的旁证面（广告还有第二条通道：提示词）。
 */
function rosterSection(text: string): string[] {
  const lines = text.replace(/\\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.includes("全部可调用的求解器目录"));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}· ([A-Za-z0-9_]+)：/.exec(l);
    if (!m) break;
    out.push(m[1]!);
  }
  return out;
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

function report(title: string, lines: string[]): void {
  // eslint-disable-next-line no-console
  console.log(`\n  ── ${title} ──\n${lines.map((l) => `  ${l}`).join("\n")}\n`);
}

let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.DSH_HARNESS; // 内核选择走**出厂 agent 配置**（kernel:"EXTERNAL"），不靠 env
  process.env.DSH_HARNESS_DIR = HARNESS_DIR;
  delete process.env.QOS_AGENT_LOOP_REPEAT_CAP; // 看门狗仅按 同name+同args 计数，本单剧本全不同名
  delete process.env.QOS_AGENT_PER_TOOL_CALL_CAP;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ① MCP 工具 ≤8 的 agent：广告面与可调用面双向差集为空
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-DSH-ARM-AD-SURFACE · ① agt_capacity_planner（5 求解器·≤8）", () => {
  it("DSH 臂：广告面 == 可调用面（双向差集为空）且 == 其 toolFilter", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startDshApp(`${stub.url}/v1`);
    try {
      const agent = seedDshAgent(AGENT_CAPACITY);
      await seedWorld(t, agent);
      const { entry } = await runDsh(t, agent, "task_ad_arm1", [], stub);

      const advertised = advertisedSolverKeys(stub);
      const scope = gateScopeSolverKeys(entry);
      const probes = await probeGate(entry, [...new Set([...advertised, ...scope])]);
      const passed = callable(probes);
      const over = advertised.filter((k) => !passed.includes(k)); // 广告了却调不到
      const under = passed.filter((k) => !advertised.includes(k)); // 调得到却没广告

      // 金丝雀（量具活着）：广告面非空，且**确定在**的那个键在（模型面真看得见求解器）。
      expect(advertised.length, "广告面一条求解器都没有 ⇒ 本臂没量到东西").toBeGreaterThan(0);
      expect(advertised, "确定在白名单里的 capacity_forecast 没被广告 ⇒ 抽取器坏了").toContain("capacity_forecast");
      // 金丝雀（真执行过）：探针必须真打到执行体（不是「全 DENIED」也不是「空转」）。
      expect(passed.length, "没有一条探针放行 ⇒ scope 面抽取/执行坏了").toBeGreaterThan(0);
      expect(probes.filter((p) => p.outcome === "OK").length, "探针一条都没真执行过 ⇒ 上面的放行不可信").toBe(
        advertised.length,
      );

      report("① capacity_planner · DSH 臂", [
        `广告面 A(${advertised.length}) = ${advertised.join(",")}`,
        `scope 面实值(${scope.length}) = ${scope.join(",")}`,
        `逐键真调通过(${passed.length}) = ${passed.join(",")}`,
        `A − C = [${over.join(",")}]  ·  C − A = [${under.join(",")}]`,
      ]);
      expect(over, `广告面点名了调不到的：${over.join(",")}`).toEqual([]);
      expect(under, `调得动却没广告：${under.join(",")}`).toEqual([]);
    } finally {
      await close();
      await stub.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ②④ MCP 工具 >8 的 agent（analyst·16）：同上 + 端到端真调
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-DSH-ARM-AD-SURFACE · ②④ agt_seed_analyst（16 求解器·>8）", () => {
  it("DSH 臂：双向差集为空 + 被原生臂 top-k 截掉的那条端到端真通（非 DENIED）", { timeout: SEAM_TIMEOUT }, async () => {
    // 剧本：① 真调 gap_attribution（原生臂 top-8 下被 deferred 的那条）② 真调一条**不在**
    // 白名单的求解器（负对照：广告面是承重的吗）③ final_answer 收尾。
    const stub = await startStubOpenAi([
      { toolCall: { name: fullNameOf("gap_attribution"), arguments: "{}" }, usage: PLAIN_USAGE },
      { toolCall: { name: fullNameOf(OFF_WHITELIST_KEY), arguments: "{}" }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startDshApp(`${stub.url}/v1`);
    try {
      const agent = seedDshAgent(AGENT_ANALYST);
      await seedWorld(t, agent);
      const { entry } = await runDsh(t, agent, "task_ad_arm2", [], stub);
      // 负对照的前提：这条键**真在活目录里**（否则「放不进白名单」是目录缺件，不是判据有牙）
      const catalogKeys = new Set(
        (await t.dataCore.catalog.solverRegistry(CTX)).items.map((i) => i.key),
      );
      expect(catalogKeys.has(OFF_WHITELIST_KEY), `对照键 ${OFF_WHITELIST_KEY} 不在活目录里 ⇒ 对照无效`).toBe(true);
      expect(catalogKeys.size, "活目录空 ⇒ 上面那条前提是空集上的真").toBeGreaterThan(50);

      const advertised = advertisedSolverKeys(stub);
      const roster = rosterSection(JSON.stringify(stub.requests[0]?.body));
      const scope = gateScopeSolverKeys(entry);
      // 探针面 = 两面之并 ∪ 负对照（对照必须**真被拒**，否则「都放行」与「闸坏了」同形）
      const probes = await probeGate(entry, [...new Set([...advertised, ...scope, OFF_WHITELIST_KEY])]);
      const passed = callable(probes);
      const over = advertised.filter((k) => !passed.includes(k));
      const under = passed.filter((k) => !advertised.includes(k));

      // 金丝雀：广告面非空 ∧ 确定在的键在 ∧ 负对照真被拒（闸有鉴别力）。
      expect(advertised.length, "广告面一条求解器都没有 ⇒ 本臂没量到东西").toBeGreaterThan(0);
      expect(advertised, "确定在授予面里的 gap_attribution 没被广告 ⇒ 抽取器坏了").toContain("gap_attribution");
      const neg = probes.find((p) => p.key === OFF_WHITELIST_KEY)!;
      expect(neg.outcome, `不在授予面的 ${OFF_WHITELIST_KEY} 却被放行 ⇒ 闸坏了，上面的「为空」不可信`).toBe("DENIED");
      // 金丝雀（真执行过）：广告面那 16 条探针必须**条条真打到执行体**（OK），
      // 否则「放行」可能是被预算/其它门掩盖出来的同形结论。
      expect(probes.filter((p) => p.outcome === "OK").length, "广告面探针没条条真执行 ⇒ 放行不可信").toBe(
        advertised.length,
      );

      report("②④ analyst · DSH 臂", [
        `提示词目录段(${roster.length}) = ${roster.join(",")}`,
        `广告面 A(${advertised.length}) = ${advertised.join(",")}`,
        `scope 面实值(${scope.length}) = ${scope.join(",")}`,
        `逐键真调通过(${passed.length}) = ${passed.join(",")}`,
        `A − C = [${over.join(",")}]  ·  C − A = [${under.join(",")}]`,
        `负对照 ${OFF_WHITELIST_KEY} ⇒ ${neg.outcome}${neg.errorCode ? `/${neg.errorCode}` : ""}`,
      ]);
      expect(advertised.length, "analyst 的广告面必须等于它的求解器白名单（16）").toBe(16);
      expect(over, `广告面点名了调不到的：${over.join(",")}`).toEqual([]);
      expect(under, `调得动却没广告：${under.join(",")}`).toEqual([]);
      // 旁证面①：提示词目录段（前两单收的那一段）同样 ⊆ 可调用面。
      expect(roster.length, "目录段一行都没抽到 ⇒ 该抽取器在 DSH 臂上没内容可量").toBeGreaterThan(0);
      expect(
        roster.filter((k) => !passed.includes(k)),
        "提示词目录段点名了调不到的",
      ).toEqual([]);
      // 旁证面②：目录段不许超出 MCP 广告面（两条通道不许各说各话）。
      expect(roster.filter((k) => !advertised.includes(k)), "目录段有、MCP 工具面没有").toEqual([]);

      // ── 端到端：被原生臂 top-k 截掉的那条，在 DSH 臂真通 ──────────────────────
      const rows = await t.repos.toolCalls.listByTask("task_ad_arm2");
      const solved = rows.filter((r) => r.toolName === "invoke_solver");
      expect(solved.map((r) => r.outcome), "gap_attribution 必须真到宿主执行体且非 DENIED").toContain("OK");
      // 回执上模型面：真载荷（<tool_data tool_call_id="tc_…">），不是拒绝文案
      const receipt = toolResultText(stub.requests[1]?.body, "call_1");
      expect(receipt, "gap_attribution 的回执不许是空的（静默 = 没回执）").not.toBe("");
      expect(receipt, "gap_attribution 的回执必须是真载荷").toMatch(/<tool_data tool_call_id="tc_/);
      // 负对照那一轮：宿主零执行（该键从未被注册/从未过闸）——「广告面」是承重的
      const offReceipt = toolResultText(stub.requests[2]?.body, "call_2");
      expect(offReceipt, "不在广告面的求解器必须拿到明确失败，不许静默").not.toBe("");
      expect(offReceipt, `不在广告面的 ${OFF_WHITELIST_KEY} 竟拿到成功载荷`).not.toMatch(/<tool_data tool_call_id="tc_/);
      report("②④ 端到端回执（模型面原文，各截 200 字）", [
        `gap_attribution → ${receipt.replace(/\s+/g, " ").slice(0, 200)}`,
        `${OFF_WHITELIST_KEY} → ${offReceipt.replace(/\s+/g, " ").slice(0, 200)}`,
        `宿主审计行 = ${JSON.stringify(rows.map((r) => `${r.toolName}/${r.outcome}`))}`,
      ]);
    } finally {
      await close();
      await stub.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ③ 对照实验：广告面随白名单变 ∧ 量具报得出「非空」
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-DSH-ARM-AD-SURFACE · ③ 对照：白名单进一条 ⇒ 广告面进一条；声明面清空 ⇒ 差集非空", () => {
  it("同一台量具：加白名单 ⇒ 键出现（有牙）；声明面清空（反事实配置）⇒ A − C 必然非空（不瞎）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startDshApp(`${stub.url}/v1`);
    try {
      const base = seedDshAgent(AGENT_ANALYST);
      // 反事实配置（⛔ 不是出厂态，只用于证明量具有牙）：① 白名单 +1 条（声明面**不动**）
      // ② 声明面里的求解器全名清空 —— 后者让 A − C 结构性非空（|A| = 17 > top-8 上限 8）。
      const variant: AgentDefinition = {
        ...base,
        tools: base.tools.map((tr) =>
          tr.kind === "MCP" && tr.mcpConfigId === SOLVERS_MCP_CONFIG_ID
            ? ({ ...tr, toolFilter: [...(tr.toolFilter ?? []), fullNameOf(OFF_WHITELIST_KEY)] } as typeof tr)
            : tr,
        ),
        scopeDeclaration: {
          ...base.scopeDeclaration,
          toolNames: base.scopeDeclaration.toolNames.filter((n) => !n.startsWith(SOLVER_PREFIX)),
        },
      } as AgentDefinition;
      await seedWorld(t, variant);
      const { entry } = await runDsh(t, variant, "task_ad_arm3", [], stub);

      const advertised = advertisedSolverKeys(stub);
      const probes = await probeGate(entry, advertised);
      const passed = callable(probes);
      const over = advertised.filter((k) => !passed.includes(k));

      report("③ 反事实配置 · DSH 臂", [
        `广告面 A(${advertised.length}) = ${advertised.join(",")}`,
        `逐键真调通过(${passed.length}) = ${passed.join(",")}`,
        `A − C(${over.length}) = ${over.join(",")}`,
      ]);
      // 有牙①：白名单里加一条 ⇒ 它出现在广告面（对照臂 analyst 出厂态里没有它，见 ②④）
      expect(advertised, `放进白名单的 ${OFF_WHITELIST_KEY} 没进广告面 ⇒ 判据变瞎`).toContain(OFF_WHITELIST_KEY);
      // 有牙②：这条**不在**声明面的键，真调必被拒 —— 与「放进白名单就出现」并排，
      //        说明两个面是**独立取**的（广告面归广告面，可调用面归可调用面）。
      const probe = probes.find((p) => p.key === OFF_WHITELIST_KEY)!;
      expect(probe.outcome, `声明面没有它却被放行 ⇒ scope 门坏了`).toBe("DENIED");
      // 有牙③：量具报得出非空（A 有 17 条 > 本 run 授予上限 8 ⇒ 差集结构性非空）
      expect(over.length, "反事实配置下差集仍为空 ⇒ 量具恒报空，前面的「空」不可信").toBeGreaterThanOrEqual(9);
      expect(over).toContain(OFF_WHITELIST_KEY);
      // 有牙④：拒的那批必须是 **DENIED**（scope 门）而不是别的形态 —— 说明量的是那一道门，
      // 且 scope 门的裁决**不受预算/其它门掩盖**（同批次另有 6 条真执行 OK，金丝雀）。
      expect(
        probes.filter((p) => p.outcome === "DENIED").map((p) => p.key),
        "差集那批的形态必须是 scope 门 DENIED",
      ).toEqual(over);
      expect(probes.filter((p) => p.outcome === "OK").length, "对照臂也要有真执行的那一批（否则拒绝无鉴别力）").toBe(
        passed.length,
      );
    } finally {
      await close();
      await stub.close();
    }
  });
});
