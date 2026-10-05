/**
 * WO-DSH-RESOURCE-REACH · 切片/本体在 DSH 内核的 ReAct 链上**真可达**（驾驶接缝的组合测试）。
 *
 * **今天的行为是 X**：`agt_capacity_planner`（seed.ts 出厂授予面）的 `tools` 只有
 * {BUILTIN query_objects, BUILTIN invoke_solver, WORKFLOW wf_seed_capacity}，
 * `scopeDeclaration.toolNames` 亦只有 {query_objects, invoke_solver}
 * ⇒ `plan_slice` / `resolve_slice`（BUILTIN_TOOLS，registry.ts 同族）**在两个内核上都不可见**，
 * 模型没有机会调它们。**这不是 dsh 通道缺口**：engine.ts 的 hostTools 下发是**按 binding.kind
 * 通用筛**的，对切片工具没有任何特殊分支（全仓 `resolve_slice|plan_slice` 在 engine.ts /
 * dsh-runtime / harness plugins 下**零命中**——金丝雀：同 grep 在 tools/registry.ts 命中）。
 *
 * **应该是 Y**：授予面加上这两件之后，DSH 臂的 ReAct 循环里模型**真调用**它们、
 * 真经宿主 `/b/v1/dsh/tool-execute` 回到**同一个** GuardedToolExecutor、真拿到切片数据，
 * 且**不在授予集内的工具必须 fail-closed**（不许静默放行）。
 *
 * 分组：
 *   A = 授予面契约（setup 层，纯映射，不开子进程）
 *   B = e2e（freePort 真 listen + stub LLM + per-agent kernel=EXTERNAL，真 fork 真子进程
 *       真 HTTP 回环；agent 取自 `seedRegistry()` 出厂定义，只覆写 model/kernel 两个字段）
 *   C = 两内核一致（同一 query 同剧本，NATIVE 臂 vs EXTERNAL 臂，逐条比工具调用与执行体）
 *   D = 变异反证（把授予拿掉 ⇒ 本文件必须当场红）
 */
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition, WorkflowDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import {
  STUB_DCP_SPEC,
  startStubOpenAi,
  stubDirectory,
  stubProvider,
  type StubRound,
} from "./helpers-dsh-stub.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";
import { buildSessionSetup } from "../src/dsh-runtime/setup-spec.js";

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
const SEED_WF_ID = "wf_seed_capacity";
const SEED_WF_TOOL = "workflow_capacity_check";
/** 切片两件套（本单新增授予）。 */
const SLICE_PLAN = "plan_slice";
const SLICE_RESOLVE = "resolve_slice";
/** 明确**不在**授予集内：用于 fail-closed 对照。 */
const OUT_OF_SCOPE_TOOL = "create_action_draft";

const PLAN_ARGS = JSON.stringify({
  rootType: "Order",
  targets: ["Base", "Line", "Model"],
  question: "型号需求增量可不可行",
});

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

/** 授予面剥离形态（变异反证用）：把切片两件套从 tools 与 scopeDeclaration 同时拿掉。 */
function withoutSliceGrant(agent: AgentDefinition): AgentDefinition {
  return {
    ...agent,
    tools: agent.tools.filter(
      (t) => !(t.kind === "BUILTIN" && (t.name === SLICE_PLAN || t.name === SLICE_RESOLVE)),
    ),
    scopeDeclaration: {
      ...agent.scopeDeclaration,
      toolNames: agent.scopeDeclaration.toolNames.filter((n) => n !== SLICE_PLAN && n !== SLICE_RESOLVE),
    },
  } as AgentDefinition;
}

async function seedWorld(t: TestApp, agent: AgentDefinition): Promise<void> {
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

/** DSH 臂模型面看到的工具名清单（stub 首轮请求体 tools[].function.name）。 */
function stubVisibleNames(stub: { requests: { body: unknown }[] }): string[] {
  const tools = (stub.requests[0]?.body as { tools?: { function?: { name?: string } }[] } | undefined)?.tools ?? [];
  return tools.map((x) => x.function?.name ?? "").filter(Boolean);
}

/** NATIVE 臂模型面看到的工具名清单（ScriptedLlmClient 收到的 LlmAgentRequest.tools[].name）。 */
function nativeVisibleNames(t: TestApp): string[] {
  return (t.llm.agentRequests[0]?.tools ?? []).map((x) => x.name);
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
 * hostTools / hostWorkflowTools 两个 IIFE 与 engine.ts 分叉处逐字同形。
 */
async function setupFromSeedAgent(agent: AgentDefinition) {
  const t = await createTestApp();
  try {
    for (const wf of seedRegistry().workflows) if (!(await t.repos.workflows.get(wf.id))) await t.repos.workflows.insert(wf);
    const tools = await t.deps.engine.expandAgentTools(agent);
    const spec = buildSessionSetup({
      agent,
      agentSystemCore: "CORE",
      grantedToolNames: tools.map((x) => x.name),
      hostTools: tools
        .filter((x) => x.binding.kind === "BUILTIN")
        .map((x) => ({ name: x.name, description: x.description, inputSchema: x.inputSchema })),
      hostWorkflowTools: tools
        .filter((x) => x.binding.kind === "WORKFLOW")
        .map((x) => ({ name: x.name, description: x.description, inputSchema: x.inputSchema })),
    });
    return { spec, expanded: tools.map((x) => x.name) };
  } finally {
    await t.app.close();
  }
}

// ---------------------------------------------------------------------------

describe("RESOURCE-REACH · A 授予面契约（seed → setup 映射）", () => {
  it("A1 出厂 agt_capacity_planner 的授予面含切片两件套（tools ∪ scopeDeclaration 双面同步）", async () => {
    const agent = seedCapacityAgent();
    const builtinNames = agent.tools.filter((t) => t.kind === "BUILTIN").map((t) => t.name);
    expect(builtinNames, "授予面").toContain(SLICE_PLAN);
    expect(builtinNames, "授予面").toContain(SLICE_RESOLVE);
    expect(agent.scopeDeclaration.toolNames, "声明面").toContain(SLICE_PLAN);
    expect(agent.scopeDeclaration.toolNames, "声明面").toContain(SLICE_RESOLVE);

    // setup 层兑现：走 engine 的真装配（expandAgentTools），不手抄工具名
    const { spec, expanded } = await setupFromSeedAgent(agent);
    expect(expanded, "授予面展开（engine 真跑）").toContain(SLICE_PLAN);
    expect(expanded).toContain(SLICE_RESOLVE);
    const hostNames = (spec.hostTools ?? []).map((x) => x.name);
    expect(hostNames).toContain(SLICE_PLAN);
    expect(hostNames).toContain(SLICE_RESOLVE);
    const allow = (spec.tools ?? []).map((x) => x.name);
    expect(allow, "harness 侧允许表").toContain(SLICE_PLAN);
    expect(allow, "harness 侧允许表").toContain(SLICE_RESOLVE);

    // 交付②的可见性前提：出厂 WORKFLOW 授予走 **hostWorkflowTools**（另一个键，各不串台）
    const wf = seedRegistry().workflows.find((w) => w.id === SEED_WF_ID);
    expect(wf, `seed workflow ${SEED_WF_ID} 在册`).toBeDefined();
    expect(wf!.key, "工具名 = workflow_<key>").toBe("capacity_check");
    expect((spec.hostWorkflowTools ?? []).map((x) => x.name), "workflow 下发面").toContain(SEED_WF_TOOL);
    expect((spec.hostTools ?? []).map((x) => x.name), "BUILTIN 面不串入 workflow").not.toContain(SEED_WF_TOOL);
  });

  it("A2 对照（把授予拿掉）：hostTools 与允许表**双双**不含切片——这是 B4 变异能红的前提", async () => {
    const stripped = withoutSliceGrant(seedCapacityAgent());
    const { spec, expanded } = await setupFromSeedAgent(stripped);
    expect(expanded, "授予面展开").not.toContain(SLICE_PLAN);
    expect(expanded).not.toContain(SLICE_RESOLVE);
    const hostNames = (spec.hostTools ?? []).map((x) => x.name);
    expect(hostNames).not.toContain(SLICE_PLAN);
    expect(hostNames).not.toContain(SLICE_RESOLVE);
    const allow = (spec.tools ?? []).map((x) => x.name);
    expect(allow).not.toContain(SLICE_PLAN);
    expect(allow).not.toContain(SLICE_RESOLVE);
    // 金丝雀：对照不是「整表空掉」——同批其余授予仍在（否则本断言对任何空实现都恒真）
    expect(hostNames).toContain("query_objects");
    expect(allow).toContain("query_objects");
  });
});

describe("RESOURCE-REACH · B e2e：DSH 臂 ReAct 真调切片（真 fork + 真 HTTP 回环）", () => {
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

  it("B1 plan_slice → resolve_slice 链：模型真调两件 ∧ 切片数据真回模型面 ∧ 同源 executor", { timeout: SEAM_TIMEOUT }, async () => {
    // 剧本：先动态规划切片，再**用规划产出的 sliceKey** 解析它（两件互为上下游），最后收尾。
    const stub = await startStubOpenAi([
      { toolCall: { name: SLICE_PLAN, arguments: PLAN_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: SLICE_RESOLVE, arguments: JSON.stringify({ sliceKey: "biz.Order.Base_Line_Model", args: {} }) }, usage: PLAIN_USAGE },
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

      // ① 模型可见面：首轮请求 tools 含切片两件套（hostTools 真下发注册）
      const first = stubVisibleNames(stub);
      expect(first, "模型可见工具面").toContain(SLICE_PLAN);
      expect(first, "模型可见工具面").toContain(SLICE_RESOLVE);

      // ② 真调用：宿主执行体被真打到，且 args 逐字 = 模型给的
      expect(planSpy.mock.calls.length, "planSlice 真调一次").toBe(1);
      const planReq = planSpy.mock.calls[0]![1] as { rootType: string; targets: string[] };
      expect(planReq.rootType).toBe("Order");
      expect(planReq.targets).toEqual(["Base", "Line", "Model"]);

      // ③ 数据流真通：resolve 吃的 sliceKey = plan 产出的那个（模型没瞎编）
      expect(resolveSpy.mock.calls.length, "resolveSlice 真调一次").toBe(1);
      expect(resolveSpy.mock.calls[0]![1], "sliceKey 必须来自 plan_slice 的返回值").toBe("biz.Order.Base_Line_Model");

      // ④ 两件都过宿主同一 GuardedToolExecutor ⇒ 各落一行 tc_ 审计（outcome OK）
      const rows = await t.repos.toolCalls.listByTask("task_reach_b1");
      const planRow = rows.find((r) => r.toolName === SLICE_PLAN);
      const resolveRow = rows.find((r) => r.toolName === SLICE_RESOLVE);
      expect(planRow?.outcome, "plan_slice 审计行").toBe("OK");
      expect(resolveRow?.outcome, "resolve_slice 审计行").toBe("OK");
      expect(planRow!.id).toMatch(/^tc_/);
      expect(resolveRow!.id).toMatch(/^tc_/);

      // ⑤ 切片数据真回模型面：下一轮请求体里逐字可见 <tool_data tool_call_id="tc_…">＋切片节点
      const second = JSON.stringify(stub.requests[1]!.body);
      expect(second, "plan 回执上模型面").toContain(`<tool_data tool_call_id=\\"${planRow!.id}\\">`);
      expect(second).toContain("biz.Order.Base_Line_Model");
      const third = JSON.stringify(stub.requests[2]!.body);
      expect(third, "resolve 回执上模型面").toContain(`<tool_data tool_call_id=\\"${resolveRow!.id}\\">`);
      // mock 侧 biz.* 切片的节点 id 形如 Order_to_Base（切片数据真的回灌进上下文）
      expect(third, "切片节点数据真回灌").toContain("Order_to_Base");
      // ⑥ 侧表吃到（W9-full）：iterations 内该两行的 toolCallId = 审计行主键
      const iterCalls = result.run.iterations.flatMap((it) => it.toolCalls);
      expect(iterCalls.find((c) => c.toolName === SLICE_PLAN)?.toolCallId).toBe(planRow!.id);
      expect(iterCalls.find((c) => c.toolName === SLICE_RESOLVE)?.toolCallId).toBe(resolveRow!.id);
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B2 workflow 端到端（交付②）：同一条工作流，超限输入被治理闸挡下 / 合规输入真跑通", { timeout: SEAM_TIMEOUT }, async () => {
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
      const result = await runAgent(t, "task_reach_b2", emitted, SEED_AGENT_ID);

      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      // 可见性：出厂 WORKFLOW 授予经 hostWorkflowTools 真下发
      expect(stubVisibleNames(stub), "模型可见工具面").toContain(SEED_WF_TOOL);

      const receipt1 = toolResultText(stub.requests[1]?.body, "call_1");
      const receipt2 = toolResultText(stub.requests[2]?.body, "call_2");
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── B2 对照对（同工具、仅入参不同）──\n` +
          `  ① demandDelta=100 回执：${receipt1.slice(0, 300)}\n` +
          `  ② demandDelta=0.2  回执：${receipt2.slice(0, 300)}\n` +
          `  审计行=${JSON.stringify((await t.repos.toolCalls.listByTask("task_reach_b2")).map((r) => `${r.toolName}/${r.outcome}`))}\n`,
      );
      // ① 超限 ⇒ 治理闸明确挡下（不是静默放行、不是宿主侧失败）
      expect(receipt1, "① 必须带规则号 C03").toMatch(/C03/);
      expect(receipt1, "① 不许是成功载荷").not.toMatch(/tool_data/);
      // ② 合规 ⇒ 真跑通：s4 render_answer 的 markdown 回模型面
      expect(receipt2, "② workflow 产物上模型面").toContain("产能校核结论");
      expect(receipt2, "② 是成功包络").toMatch(/tool_data/);
      // 真过宿主引擎：wf_seed_capacity 的 s1 query_objects(Model) 步真执行。
      // 断言「本 run 内真查过 Model」而非数总次数 —— mock 的 listObjectTypes 逐类型计数，
      // 也会走同一个 queryObjects（实测 18 次 / 9 类型，其中含 workflow 那步）。
      const qoTypes = qo.mock.calls.map((c) => c[1] as string);
      expect(qoTypes, "workflow s1 步真执行（Model 真被查过）").toContain("Model");
      // 审计面：① 未过 wire（零行）② 落一行 OK（端点分支写的 workflow 行）
      const rows = await t.repos.toolCalls.listByTask("task_reach_b2");
      const wfRows = rows.filter((r) => r.toolName === SEED_WF_TOOL);
      expect(wfRows.length, "恰好一行 = 只有 ② 过 wire").toBe(1);
      expect(wfRows[0]!.outcome).toBe("OK");
      expect(wfRows[0]!.id).toMatch(/^tc_/);
      // 侧表：两次调用都进 iterations（① ERROR / ② OK —— 一一对上）
      const iterCalls = result.run.iterations.flatMap((it) => it.toolCalls).filter((c) => c.toolName === SEED_WF_TOOL);
      expect(iterCalls.map((c) => c.outcome), "两次调用的结局").toEqual(["ERROR", "OK"]);
      expect(iterCalls[1]!.toolCallId, "OK 那次对上端点审计行").toBe(wfRows[0]!.id);
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B3 fail-closed：请求**不在授予集内**的工具 ⇒ 明确拒绝 ∧ 宿主零执行（不静默放行）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: OUT_OF_SCOPE_TOOL, arguments: JSON.stringify({ title: "越权草稿" }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, seedCapacityAgent());
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_reach_b3", emitted, SEED_AGENT_ID);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED"); // 拒绝不炸循环（与 native 同口径）
      // ① 模型面根本看不见它（授予面外 = 不下发）——这是第一道闸
      expect(stubVisibleNames(stub)).not.toContain(OUT_OF_SCOPE_TOOL);
      // ② 幻觉调用被明确拒绝（回执上模型面），不是静默 OK
      const receipt = toolResultText(stub.requests[1]?.body, "call_1");
      // eslint-disable-next-line no-console
      console.log(`\n  ── B3 fail-closed 回执原文（模型面，工具名 ${OUT_OF_SCOPE_TOOL}）──\n  ${receipt.slice(0, 500)}\n`);
      expect(receipt, "必须真回了 tool_result（静默 = 没有回执）").not.toBe("");
      expect(receipt, "不许是成功载荷").not.toMatch(/<tool_data tool_call_id="tc_/);
      expect(receipt, "必须是明确失败文案").toMatch(/not found|not in agent scope|unknown|Error|无权|不存在|invalid/i);
      // ③ 宿主零执行：没有任何一行审计行是它（DENIED 也不落 —— 被拒在 harness 允许表层，未过 wire）
      const rows = await t.repos.toolCalls.listByTask("task_reach_b3");
      expect(rows.find((r) => r.toolName === OUT_OF_SCOPE_TOOL), "宿主不许有它的审计行").toBeUndefined();
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B4 变异反证：把切片授予拿掉 ⇒ 模型面看不见 ∧ 调用 fail-closed（本文件当场红的那一对读数）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: SLICE_RESOLVE, arguments: JSON.stringify({ sliceKey: "biz.Order.Base", args: {} }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, withoutSliceGrant(seedCapacityAgent()));
      const resolveSpy = vi.spyOn(t.dataCore.ontology, "resolveSlice");
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_reach_b4", emitted, SEED_AGENT_ID);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED"); // 拒绝不炸循环
      // 变异咬位：① 可见面收缩 ② 执行体零调用 ③ 回执明确拒绝
      expect(stubVisibleNames(stub), "无授予 ⇒ 不可见").not.toContain(SLICE_RESOLVE);
      expect(resolveSpy.mock.calls.length, "无授予 ⇒ 宿主执行体零调用").toBe(0);
      const receipt = toolResultText(stub.requests[1]?.body, "call_1");
      // eslint-disable-next-line no-console
      console.log(`\n  ── B4 无授予臂回执原文（模型面，工具名 ${SLICE_RESOLVE}）──\n  ${receipt.slice(0, 500)}\n`);
      expect(receipt, "必须真回了 tool_result").not.toBe("");
      expect(receipt, "不许是成功载荷").not.toMatch(/<tool_data tool_call_id="tc_/);
      expect(receipt, "必须是明确失败文案").toMatch(/not found|not in agent scope|unknown|Error|无权|不存在|invalid/i);
      // 宿主零审计行（同 B3 ③）
      const rows = await t.repos.toolCalls.listByTask("task_reach_b4");
      expect(rows.find((r) => r.toolName === SLICE_RESOLVE), "宿主零审计行").toBeUndefined();
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
      { toolCall: { name: SLICE_RESOLVE, arguments: JSON.stringify({ sliceKey: "biz.Order.Base", args: {} }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await seedWorld(t, seedCapacityAgent({ kernel }));
      if (kernel === "NATIVE") {
        // 原生臂吃 ScriptedLlmClient（engine 只对 EXTERNAL 分叉走 dcp provider 缝）
        t.llm.queueAgentTurn({ content: [toolUse(SLICE_RESOLVE, { sliceKey: "biz.Order.Base", args: {} })] });
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
        visible: kernel === "EXTERNAL" ? stubVisibleNames(stub) : nativeVisibleNames(t),
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

  it("C1 同源：两臂同 query 同剧本 ⇒ 工具调用、执行体入参、回执形态、审计行全同；差异逐条列出", { timeout: SEAM_TIMEOUT }, async () => {
    const native = await runArm("NATIVE", "c1_native");
    const external = await runArm("EXTERNAL", "c1_external");

    // ① 内核归属确实不同（这是**设计差异**，不是缺陷）
    expect(native.kernel).toBe("NATIVE");
    expect(external.kernel).toBe("EXTERNAL");

    // ② 模型可见工具面逐项同（切片两件套在两臂都可见）。
    // 比**集合**不比顺序：两臂的注册顺序源不同（DSH = harness 注册序；native = 执行器导出序），
    // 首跑实测两臂**元素逐项相同、顺序不同** —— 这是 [D2]，登记在下方差异清单，不是行为差异。
    expect([...external.visible].sort(), "两臂可见面（集合）").toEqual([...native.visible].sort());
    expect(native.visible).toContain(SLICE_RESOLVE);

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

    // 差异逐条登记（不许写「基本一致」）：本单实测恰两条，多一条少一条都红。
    //   [D1] run.kernel 归属：设计差异（内核选择本身），行为面无差。
    //   [D2] 模型可见工具的**顺序**不同（集合逐项相同）：DSH 面 = harness 注册序（字母序），
    //        native 面 = 执行器导出序。顺序进 prompt ⇒ 理论上可影响模型选择，本单按「事实差异」登记。
    const diffs: string[] = [];
    if (external.kernel !== native.kernel) diffs.push(`[D1] run.kernel: native=${native.kernel} external=${external.kernel}`);
    if (JSON.stringify(external.visible) !== JSON.stringify(native.visible)) diffs.push("[D2] 可见工具顺序不同（集合相同）");
    if (JSON.stringify(external.resolveCalls) !== JSON.stringify(native.resolveCalls)) diffs.push("[D3] 执行体入参不同");
    if (JSON.stringify(external.rows) !== JSON.stringify(native.rows)) diffs.push("[D4] 审计行不同");
    if (external.answerMarkdown !== native.answerMarkdown) diffs.push("[D5] 答案不同");
    if (JSON.stringify(external.iterations) !== JSON.stringify(native.iterations)) diffs.push("[D6] iterations 不同");
    if (external.toolDataWrapped !== native.toolDataWrapped) diffs.push("[D7] 回执包装形态不同");
    if (external.slicePayloadOnModelFace !== native.slicePayloadOnModelFace) diffs.push("[D8] 切片数据是否上模型面不同");
    // eslint-disable-next-line no-console
    console.log(`\n  ── C1 两内核差异清单（逐条）──\n  ${diffs.join("\n  ")}\n`);
    expect(diffs, "差异清单必须恰为登记的这两条（多/少都要先解释）").toEqual([
      `[D1] run.kernel: native=${native.kernel} external=${external.kernel}`,
      "[D2] 可见工具顺序不同（集合相同）",
    ]);
  });

  it("C2 同源反证：授予拿掉后**两臂一起**收缩（不是只有 DSH 臂变）", { timeout: SEAM_TIMEOUT }, async () => {
    const agent = withoutSliceGrant(seedCapacityAgent());
    for (const kernel of ["NATIVE", "EXTERNAL"] as const) {
      const stub = await startStubOpenAi([
        { toolCall: { name: SLICE_RESOLVE, arguments: JSON.stringify({ sliceKey: "biz.Order.Base", args: {} }) }, usage: PLAIN_USAGE },
        { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
        { text: "stub final answer", usage: PLAIN_USAGE },
      ] satisfies StubRound[]);
      const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
      try {
        await seedWorld(t, { ...agent, kernel } as AgentDefinition);
        if (kernel === "NATIVE") {
          t.llm.queueAgentTurn({ content: [toolUse(SLICE_RESOLVE, { sliceKey: "biz.Order.Base", args: {} })] });
          t.llm.queueAgentTurn({
            content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "无授予，收尾。" }], provenance: [] })],
          });
        }
        const resolveSpy = vi.spyOn(t.dataCore.ontology, "resolveSlice");
        const emitted: Emitted[] = [];
        await runAgent(t, `task_reach_c2_${kernel}`, emitted, SEED_AGENT_ID);
        const visible = kernel === "EXTERNAL" ? stubVisibleNames(stub) : nativeVisibleNames(t);
        // 金丝雀：本臂**真跑起来了**（否则「不可见」是没跑而非没授予）
        if (kernel === "EXTERNAL") expect(t.llm.agentRequests.length + stub.requests.length, "本臂真起了" ).toBeGreaterThan(0);
        else expect(t.llm.agentRequests.length, "本臂真起了（原生有真 LLM 往返）").toBeGreaterThan(0);
        expect(visible, `${kernel} 臂可见面`).not.toContain(SLICE_RESOLVE);
        expect(resolveSpy.mock.calls.length, `${kernel} 臂执行体`).toBe(0);
      } finally {
        await close();
        await stub.close();
      }
    }
  });
});
