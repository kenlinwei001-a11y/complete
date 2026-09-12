/**
 * WO-DSH-PROD-READY · W8主：HTTP 带外 tool-execute 反向通道（engine 级缝 + 端点级缝）。
 *
 * **通道形态**：dsh 子进程世界调宿主 28 BUILTIN 工具，走宿主中央 GuardedToolExecutor
 * （engine.ts makeExecutor 同一实例——第二实例 = 双账本 B 级缺陷）。宿主在 dsh fork 时
 * 铸 per-run 一次性 runToken 登记 {executor, budget, seenCallIds}，经 env 缝注入子进程
 * （PLATFORM_TOOL_EXEC_URL / PLATFORM_TOOL_EXEC_TOKEN=SERVICE_TOKEN / DSH_RUN_TOKEN）；
 * wire 上零鉴权材料（runToken 随机一次性、run 结束即注销）。harness 侧 tool-bridge
 * 插件 + platform-world 把 setup.hostTools 注册成反向工具，execute = fetch 宿主端点。
 *
 * **fail-closed 链（不许削弱）**：
 *   ① 端点 requireServiceToken 未配置/不符 ⇒ 401；runToken 不识/已注销 ⇒ 401；
 *      callId 重放 ⇒ 409；载荷畸形 ⇒ 400——全部不进 executor（零审计行）；
 *   ② 桥侧非 200/不可达/超时/畸形应答 ⇒ 一律 ERROR 回执（isError），绝不静默放行；
 *   ③ 双子进程白名单闸 + 宿主 scope 门双闸保留（宿主门 = 唯一权威）。
 *
 * **逐字等契约（native loop.ts 单源镜像）**：
 *   · DENIED：AGENT_SCOPE_VIOLATION ⇒ "AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明"，
 *     其余 ⇒ "无权访问"（loop.ts:873-884）——经 tools/execute authored isError 通道
 *     （normalizeDispatchResult 原文透传），**不许**带 "Error: " 前缀（execute 抛错必有前缀）；
 *   · BUDGET_EXCEEDED ⇒ "预算已尽，请基于已有结果调用 final_answer 收尾"（loop.ts:862-871）
 *     + B6 降级桥：agent.cancel({kind:'budget-exhausted'}) ⇒ reassemble 第三分类器前置 ⇒
 *     outcome BUDGET_EXHAUSTED + 诚实摘要头（loop.ts:632 模板逐字）；
 *   · ERROR ⇒ JSON.stringify(payload)（loop.ts:886-891）；
 *   · OK ⇒ 宿主端点在 finish() 落审计行（全量 64KB 兜底）**之后**、上 wire 之前用单源
 *     truncateToolResultJson 截断（8KB 模型面），payloadJson 串原样过 wire ⇒
 *     子进程可见文案 = `<tool_data tool_call_id="tc_…">…</tool_data>` 与 native 逐字等
 *     （team-lead 2026-08-21 裁决 b：截断挪宿主侧，禁 .mjs 双源漂移）。
 *
 * 分组：A = 端点级（app.inject + 直登记册，四态 deny/缓存/鉴权/重放/畸形/截断各钉死）；
 * B = e2e（freePort 真 listen + stub LLM + per-agent kernel=EXTERNAL，真 fork 真子进程
 * 真 HTTP 回环进同一 GuardedToolExecutor）。
 * C = W8.5 workflow 反向化（同端点 additive kind:"workflow"：① e2e OK 全链 ② 端点级
 * 绑定表 miss fail-closed + wire workflowId 无视 ③ e2e 内部 FAILED → ERROR parity
 * ④ 零扰动锚——无 WORKFLOW ref 键缺席 / 旧桥无 kind 逐字节旧）。
 */
import { createServer as createHttpServer, type Server } from "node:http";
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
import { BudgetTracker } from "../src/tools/budget.js";
import { truncateToolResultJson } from "../src/agent/context.js";
import { enterNesting } from "../src/runtime.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";
import { buildSessionSetup } from "../src/dsh-runtime/setup-spec.js";

// apps/agentcore/test/ → 仓根 = ../../../
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

/** 显式假凭据（泄凭扫描对象；绝非真凭据）。 */
const FAKE_LLM_KEY = "wo-w8-main-fake-llm-key-0000000000000000000";
const SERVICE_TOKEN = "wo-w8-main-service-token-000000000000000";

const PLAIN_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };
const FINAL_ANSWER_ARGS = JSON.stringify({
  blocks: [{ type: "text", markdown: "w8 main seam answer" }],
  provenance: [],
});
/** loop.ts:632 模板逐字（budgetNote = 宿主 BUDGET_EXCEEDED payload.reason 原值）。 */
const BUDGET_HEADER =
  "[预算耗尽·诚实摘要] ⚠️ 已达最大探索轮次/预算（maxToolCalls exceeded）：本次深问未能完全解答。以下为已探索到的线索：";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 抓一个空闲端口再释放（engine cfg 在 listen 前定型 ⇒ URL 必须预知端口；竞态窗极小）。 */
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

// ---------------------------------------------------------------------------
// A 组 · 端点级：直登记册 + app.inject（不起子进程）
// ---------------------------------------------------------------------------

/** 直登记一个 runToken 条目（engine.dshToolExecuteRuns 的形态钉死点）。 */
function registerRun(
  t: TestApp,
  token: string,
  opts: {
    taskId: string;
    ctx?: ToolAuthCtx;
    budget?: BudgetTracker;
    scopeToolNames?: string[];
    scopeObjectTypes?: string[];
    /** W8.5：workflow 分支的 per-run 绑定表 + 执行上下文（C 组臂用；缺席 = W8主 旧形态）。 */
    workflowBindings?: Map<string, { workflowId: string; version: number | "latest" }>;
    workflowCtx?: {
      taskId: string;
      ctx: ToolAuthCtx;
      nesting: ReturnType<typeof enterNesting>;
      emit: (event: string, payload: unknown) => Promise<void>;
    };
  },
): void {
  const budget = opts.budget ?? new BudgetTracker();
  t.deps.engine.dshToolExecuteRuns.set(token, {
    executor: t.deps.engine.makeExecutor(
      opts.taskId,
      opts.ctx ?? CTX,
      budget,
      opts.scopeToolNames,
      opts.scopeObjectTypes,
    ),
    budget,
    defaultTimeoutMs: 20_000,
    seenCallIds: new Set<string>(),
    hostToolCalls: new Map(), // W9-full：侧表字段（A 臂端点级亦走累积，不断言即透传）
    ...(opts.workflowBindings ? { workflowBindings: opts.workflowBindings } : {}),
    ...(opts.workflowCtx ? { workflowCtx: opts.workflowCtx } : {}),
  });
}

function callExecute(
  t: TestApp,
  body: Record<string, unknown>,
  serviceToken?: string,
) {
  return t.app.inject({
    method: "POST",
    url: "/b/v1/dsh/tool-execute",
    headers: {
      "content-type": "application/json",
      ...(serviceToken ? { "x-service-token": serviceToken } : {}),
    },
    payload: body,
  });
}

/** query_objects 派发链间谍（unknownTypeGuard + 本体读各一）。 */
function spyOntology(t: TestApp, payload: unknown) {
  vi.spyOn(t.dataCore.ontology, "listObjectTypeKeys").mockResolvedValue(["Base", "Line", "Material"]);
  return vi.spyOn(t.dataCore.ontology, "queryObjects").mockResolvedValue(qoResult(payload));
}

/** OntologyClient.queryObjects 契约形（{data, snapshotVersion}）——wire payload = 整对象。 */
function qoResult(data: unknown) {
  return { data, snapshotVersion: "w8-seam" };
}

// ---------------------------------------------------------------------------
// B 组 · e2e：真 listen + stub LLM + per-agent kernel=EXTERNAL
// ---------------------------------------------------------------------------

function agentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "agt_w8_main",
    tenantId: TENANT,
    key: "w8_main_agent",
    version: 1,
    name: "W8 Main Seam Agent",
    description: "wo-dsh-prod-ready w8-main seam",
    model: STUB_DCP_SPEC,
    systemPrompt: "你是 W8 反向通道缝测试助手。",
    tools: [{ kind: "BUILTIN", name: "query_objects" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: ["query_objects"] },
    status: "PUBLISHED",
    kernel: "EXTERNAL", // per-agent 内核驱动分叉（进程 env 恒关，来源无歧义）
    ...overrides,
  } as AgentDefinition;
}

/**
 * 生产档（缺省 cordis.yml）+ 真 listen：harness 子进程经 127.0.0.1 真 HTTP 打
 * /b/v1/dsh/tool-execute。PORT 钉死同端口 ⇒ engine 缺省推导 PLATFORM_GOV_URL 与
 * PLATFORM_TOOL_EXEC_URL 双双真被打到；toolExecUrl 显式指 = 死端口/畸形端点臂。
 */
async function startToolExecApp(opts: {
  stubUrl: string;
  serviceToken?: string;
  toolExecUrl?: string;
  env?: Record<string, string>;
}): Promise<{ t: TestApp; close: () => Promise<void> }> {
  const port = await freePort();
  const t = await createTestApp({
    providerDirectory: stubDirectory(stubProvider(opts.stubUrl), FAKE_LLM_KEY) as never,
    env: {
      PORT: String(port),
      ...(opts.serviceToken ? { SERVICE_TOKEN: opts.serviceToken } : {}),
      ...(opts.toolExecUrl ? { DSH_TOOL_EXEC_URL: opts.toolExecUrl } : {}),
      ...(opts.env ?? {}),
    },
  });
  await t.app.listen({ port, host: "127.0.0.1" });
  return { t, close: () => t.app.close() };
}

async function runAgent(
  t: TestApp,
  taskId: string,
  emitted: Emitted[],
  opts: { budget?: BudgetTracker; enforceObjectScope?: boolean } = {},
) {
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId: "agt_w8_main",
    version: 1,
    prompt: "调 query_objects 探查后收尾",
    ctx: CTX,
    nesting: enterNesting(
      { callChain: [], budget: opts.budget ?? new BudgetTracker() },
      "agent",
      "agt_w8_main",
    ),
    emit: async (event, payload) => {
      emitted.push({ event, payload });
    },
    ...(opts.enforceObjectScope ? { enforceObjectScope: true } : {}),
  });
}

/** query_objects 调用帧的 step.completed status（isError ⇒ ERROR 落屏位）。 */
function qoStepStatus(emitted: Emitted[]): string | undefined {
  const started = emitted.find((f) => f.event === "step.started" && (f.payload as { type?: string }).type === "query_objects");
  if (!started) return undefined;
  const stepId = (started.payload as { stepId: string }).stepId;
  const completed = emitted.find((f) => f.event === "step.completed" && (f.payload as { stepId?: string }).stepId === stepId);
  return (completed?.payload as { status?: string } | undefined)?.status;
}

/** 孤儿行轮询（宿主执行晚于桥放弃 ⇒ run 结束后审计行才落）。 */
async function waitForToolRows(t: TestApp, taskId: string, n: number, timeoutMs = 8000) {
  const start = Date.now();
  for (;;) {
    const rows = await t.repos.toolCalls.listByTask(taskId);
    if (rows.length >= n) return rows;
    if (Date.now() - start > timeoutMs) throw new Error(`waitForToolRows timeout: ${taskId} rows=${rows.length}`);
    await sleep(20);
  }
}

const QO_ARGS = JSON.stringify({ objectType: "Base" });
const BASE_PAYLOAD = { data: { total: 1, items: [{ id: "base-1", name: "常州基地" }] } };

// ---------------------------------------------------------------------------

describe("W8主 · A 端点级：/b/v1/dsh/tool-execute 四态 + 鉴权 + 重放 + 截断", () => {
  it("A1 scope 门 DENIED（AGENT_SCOPE_VIOLATION）⇒ 审计行 DENIED + tc_ 回执", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    registerRun(t, "dshr_a1", { taskId: "task_a1", scopeToolNames: ["get_object"] });
    const res = await callExecute(t, {
      runToken: "dshr_a1",
      callId: "c1",
      toolName: "query_objects",
      input: { objectType: "Base" },
    }, SERVICE_TOKEN);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.outcome).toBe("DENIED");
    expect((body.payload as { error?: string }).error).toBe("AGENT_SCOPE_VIOLATION");
    expect(String(body.toolCallId)).toMatch(/^tc_/);
    const rows = await t.repos.toolCalls.listByTask("task_a1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("DENIED");
    expect(rows[0]!.id).toBe(body.toolCallId); // 回执 tc_ = 审计行主键（三键合流一半）
    await t.app.close();
  });

  it("A2 IAM 门 DENIED（PERMISSION_DENIED）", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    t.dataCore.iam.denyTools.add("query_objects");
    registerRun(t, "dshr_a2", { taskId: "task_a2", scopeToolNames: ["query_objects"] });
    const res = await callExecute(t, {
      runToken: "dshr_a2",
      callId: "c1",
      toolName: "query_objects",
      input: { objectType: "Base" },
    }, SERVICE_TOKEN);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.outcome).toBe("DENIED");
    expect((body.payload as { error?: string }).error).toBe("PERMISSION_DENIED");
    await t.app.close();
  });

  it("A3 OBO 门 DENIED（OBO_TOKEN_EXPIRING，token 60s 内到期）", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    registerRun(t, "dshr_a3", {
      taskId: "task_a3",
      ctx: { ...CTX, tokenExpiresAt: Math.floor(Date.now() / 1000) + 30 },
      scopeToolNames: ["query_objects"],
    });
    const res = await callExecute(t, {
      runToken: "dshr_a3",
      callId: "c1",
      toolName: "query_objects",
      input: { objectType: "Base" },
    }, SERVICE_TOKEN);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.outcome).toBe("DENIED");
    expect((body.payload as { error?: string }).error).toBe("OBO_TOKEN_EXPIRING");
    await t.app.close();
  });

  it("A4 预算门 BUDGET_EXCEEDED（maxToolCalls=0）⇒ reason 原值 + budget.exhausted 置位", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    const budget = new BudgetTracker({ maxToolCalls: 0 });
    registerRun(t, "dshr_a4", { taskId: "task_a4", budget, scopeToolNames: ["query_objects"] });
    const res = await callExecute(t, {
      runToken: "dshr_a4",
      callId: "c1",
      toolName: "query_objects",
      input: { objectType: "Base" },
    }, SERVICE_TOKEN);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.outcome).toBe("BUDGET_EXCEEDED");
    expect((body.payload as { reason?: string }).reason).toBe("maxToolCalls exceeded");
    expect(budget.exhausted).toBe(true); // B6 桥的状态面：宿主预算真被消尽
    const rows = await t.repos.toolCalls.listByTask("task_a4");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("BUDGET_EXCEEDED");
    await t.app.close();
  });

  it("A5 OK×2 同参 ⇒ readCache 命中（queryObjects 真调 1 次）+ 双 OK 审计行（单实例反咬）", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    const qo = spyOntology(t, BASE_PAYLOAD);
    registerRun(t, "dshr_a5", { taskId: "task_a5", scopeToolNames: ["query_objects"] });
    for (const callId of ["c1", "c2"]) {
      const res = await callExecute(t, {
        runToken: "dshr_a5",
        callId,
        toolName: "query_objects",
        input: { objectType: "Base" },
      }, SERVICE_TOKEN);
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.outcome).toBe("OK");
      expect(body.payloadJson).toBe(JSON.stringify(qoResult(BASE_PAYLOAD))); // 未触 8KB ⇒ 全量原文
      expect(body.truncated).toBe(false);
      expect(String(body.toolCallId)).toMatch(/^tc_/);
    }
    // 单实例反咬：readCache 是 executor 实例字段——第二次同参命中 ⇒ 本体只真调 1 次。
    // 若端点每次新建 executor（双实例缺陷），缓存随实例消亡 ⇒ 2 次真调 ⇒ 本断言红。
    expect(qo.mock.calls.length).toBe(1);
    const rows = await t.repos.toolCalls.listByTask("task_a5");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.outcome === "OK")).toBe(true);
    await t.app.close();
  });

  it("A6 鉴权 fail-closed：无头 401 / 错头 401 / runToken 不识 401——全部零执行零审计", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    const qo = spyOntology(t, BASE_PAYLOAD);
    registerRun(t, "dshr_a6", { taskId: "task_a6", scopeToolNames: ["query_objects"] });
    const good = { runToken: "dshr_a6", callId: "c1", toolName: "query_objects", input: { objectType: "Base" } };
    expect((await callExecute(t, good)).statusCode).toBe(401); // 无 x-service-token
    expect((await callExecute(t, good, "wrong-token")).statusCode).toBe(401);
    expect((await callExecute(t, { ...good, runToken: "dshr_unknown" }, SERVICE_TOKEN)).statusCode).toBe(401);
    expect(qo.mock.calls.length).toBe(0);
    expect(await t.repos.toolCalls.listByTask("task_a6")).toHaveLength(0);
    await t.app.close();
  });

  it("A7 callId 重放 ⇒ 409（同 runToken 域内一次性）", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    const qo = spyOntology(t, BASE_PAYLOAD);
    registerRun(t, "dshr_a7", { taskId: "task_a7", scopeToolNames: ["query_objects"] });
    const first = await callExecute(t, {
      runToken: "dshr_a7",
      callId: "c1",
      toolName: "query_objects",
      input: { objectType: "Base" },
    }, SERVICE_TOKEN);
    expect(first.statusCode).toBe(200);
    const replay = await callExecute(t, {
      runToken: "dshr_a7",
      callId: "c1",
      toolName: "query_objects",
      input: { objectType: "Base" },
    }, SERVICE_TOKEN);
    expect(replay.statusCode).toBe(409);
    expect(qo.mock.calls.length).toBe(1); // 重放不进 executor
    expect(await t.repos.toolCalls.listByTask("task_a7")).toHaveLength(1);
    await t.app.close();
  });

  it("A8 载荷畸形（缺 toolName）⇒ 400 VALIDATION_ERROR", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    registerRun(t, "dshr_a8", { taskId: "task_a8", scopeToolNames: ["query_objects"] });
    const res = await callExecute(t, { runToken: "dshr_a8", callId: "c1", input: {} }, SERVICE_TOKEN);
    expect(res.statusCode).toBe(400);
    await t.app.close();
  });

  it("A9 >8KB 工具结果 ⇒ payloadJson 与单源 truncateToolResultJson 逐字等 ∧ 审计行全量", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    const items = Array.from({ length: 300 }, (_, i) => ({ id: `item-${i}`, name: "x".repeat(30) }));
    const big = { data: { total: 300, items } };
    expect(Buffer.byteLength(JSON.stringify(big), "utf8")).toBeGreaterThan(8192); // 前置：真超 8KB
    spyOntology(t, big);
    registerRun(t, "dshr_a9", { taskId: "task_a9", scopeToolNames: ["query_objects"] });
    const res = await callExecute(t, {
      runToken: "dshr_a9",
      callId: "c1",
      toolName: "query_objects",
      input: { objectType: "Base" },
    }, SERVICE_TOKEN);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.outcome).toBe("OK");
    const expected = truncateToolResultJson(qoResult(big)); // 同一单源函数算期望（禁手写复刻）
    expect(body.payloadJson, "wire 截断形必须与 native 单源逐字等").toBe(expected.json);
    expect(body.truncated).toBe(true);
    expect(String(body.note)).toContain("[已截断：共 300 条，仅含前");
    // 审计在截断前（executor 出全量 → finish() 落 64KB 兜底 → 端点截断整形 ⇒ wire）
    const rows = await t.repos.toolCalls.listByTask("task_a9");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.output)).toContain("item-299");
    await t.app.close();
  });
});

// ---------------------------------------------------------------------------

describe("W8主 · B e2e：stub LLM 剧本 + dsh 臂反向调用真进 GuardedToolExecutor", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS; // per-agent kernel=EXTERNAL 驱动，进程 env 恒关
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

  it("B1 真工具三键合流：tc_ 上模型面 ∧ 审计行 OK ∧ 本体真调一次（缺省推导锚）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    // 缺省推导锚：不钉 DSH_TOOL_EXEC_URL（PORT 钉死同端口）⇒ engine `??` fallback 真被打到。
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      expect(t.config.DSH_TOOL_EXEC_URL, "缺省推导臂必须无显式配置").toBeUndefined();
      await t.repos.agents.insert(agentDef());
      const qo = spyOntology(t, BASE_PAYLOAD);
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w8_b1", emitted);

      expect(result.run.kernel).toBe("EXTERNAL"); // 真走了 DSH 分叉
      expect(result.outcome).toBe("ANSWERED");
      expect(stub.requests.length).toBeGreaterThanOrEqual(2);
      // 模型可见面：首轮请求 tools 含 query_objects（setup.hostTools 真下发）
      expect(JSON.stringify(stub.requests[0]!.body)).toContain('"query_objects"');
      // 三键合流：宿主审计行 tc_ ⇒ wire ⇒ 子进程 tool_result ⇒ 下一轮请求体原文可见
      const rows = await t.repos.toolCalls.listByTask("task_w8_b1");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.toolName).toBe("query_objects");
      expect(rows[0]!.outcome).toBe("OK");
      expect(rows[0]!.id).toMatch(/^tc_/);
      expect(qo.mock.calls.length).toBe(1); // 真过宿主 GuardedToolExecutor 派发到本体
      expect(JSON.stringify(stub.requests[1]!.body), "tc_ 必须经 <tool_data> 包装上模型面").toContain(
        `<tool_data tool_call_id=\\"${rows[0]!.id}\\">`,
      );
      expect(JSON.stringify(stub.requests[1]!.body)).toContain("常州基地");
      expect(result.answer.blocks.some((b) => b.type === "text" && b.markdown.includes("w8 main seam answer"))).toBe(true);
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B2 IAM deny 过 wire：「无权访问」逐字（authored isError 通道，无 Error: 前缀）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await t.repos.agents.insert(agentDef());
      t.dataCore.iam.denyTools.add("query_objects");
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w8_b2", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      const req1 = JSON.stringify(stub.requests[1]!.body);
      expect(req1, "native DENIED 回执文案逐字等（loop.ts:880）").toContain("无权访问");
      expect(req1, "execute 抛错通道必带 'Error: ' 前缀——出现即证明没走 authored isError 通道").not.toContain("Error: 无权访问");
      expect(qoStepStatus(emitted), "isError ⇒ step.completed status=ERROR").toBe("ERROR");
      const rows = await t.repos.toolCalls.listByTask("task_w8_b2");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.outcome).toBe("DENIED"); // 四态过 wire：宿主 DENIED 落审计行
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B3 B6 预算降级桥：BUDGET_EXCEEDED ⇒ cancel ⇒ BUDGET_EXHAUSTED + 诚实摘要头逐字", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE },
      // cancel 在步边界生效 ⇒ 第二轮请求永不发出（剧本耗尽即 500 是反向哨兵）
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await t.repos.agents.insert(agentDef());
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w8_b3", emitted, { budget: new BudgetTracker({ maxToolCalls: 0 }) });

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("BUDGET_EXHAUSTED");
      expect(result.degraded?.reason).toBe("BUDGET_EXHAUSTED");
      expect(result.run.budgetExhausted, "engine 出口 budgetExhausted 映射（engine.ts:676 同口径）").toBe(true);
      expect(stub.requests.length, "cancel 必须在第二轮 LLM 请求前咬停").toBe(1);
      // 诚实摘要头逐字（loop.ts:632 模板 × budgetNote=宿主 reason 原值）
      expect(result.answer.blocks[0]).toEqual({ type: "text", markdown: BUDGET_HEADER });
      const rows = await t.repos.toolCalls.listByTask("task_w8_b3");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.outcome).toBe("BUDGET_EXCEEDED");
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B4 反向通道中途断（端点不可达）⇒ ERROR 回执不静默放行 ∧ 零审计行", { timeout: SEAM_TIMEOUT }, async () => {
    const deadPort = await freePort(); // 抓起即放 ⇒ 端口已关闭
    const stub = await startStubOpenAi([
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({
      stubUrl: `${stub.url}/v1`,
      serviceToken: SERVICE_TOKEN,
      toolExecUrl: `http://127.0.0.1:${deadPort}/b/v1/dsh/tool-execute`,
    });
    try {
      await t.repos.agents.insert(agentDef());
      const qo = spyOntology(t, BASE_PAYLOAD);
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w8_b4", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED"); // ERROR 回执进剧本，模型诚实收尾
      expect(JSON.stringify(stub.requests[1]!.body), "不可达必须成 ERROR 回执上模型面").toContain("TOOL_EXECUTE_UNREACHABLE");
      expect(qoStepStatus(emitted)).toBe("ERROR");
      expect(qo.mock.calls.length).toBe(0); // 根本没到宿主 executor
      expect(await t.repos.toolCalls.listByTask("task_w8_b4")).toHaveLength(0);
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B5 宿主工具慢于子进程 deadline：宿主 withTimeout 收敛 ERROR ⇒ 行 ERROR + 帧 ERROR", { timeout: SEAM_TIMEOUT }, async () => {
    process.env.DSH_TOOL_EXEC_TIMEOUT_MS = "100"; // 子进程随请求上行的 per-call timeoutMs
    const stub = await startStubOpenAi([
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await t.repos.agents.insert(agentDef());
      vi.spyOn(t.dataCore.ontology, "listObjectTypeKeys").mockResolvedValue(["Base"]);
      vi.spyOn(t.dataCore.ontology, "queryObjects").mockImplementation(async () => {
        await sleep(600); // 真慢于 100ms 档
        return qoResult(BASE_PAYLOAD);
      });
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w8_b5", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      // 宿主 executor withTimeout 收敛（executor.ts:70）⇒ 审计行 ERROR + 回执 ERROR 过 wire
      const rows = await waitForToolRows(t, "task_w8_b5", 1);
      expect(rows[0]!.outcome).toBe("ERROR");
      expect(JSON.stringify(rows[0]!.output)).toContain("timed out after 100ms");
      expect(JSON.stringify(stub.requests[1]!.body), "宿主 ERROR payload 逐字回灌（loop.ts:889 同形）").toContain("timed out after 100ms");
      expect(qoStepStatus(emitted)).toBe("ERROR");
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B6 孤儿审计行：桥 fetch 先放弃（100ms）< 宿主完成（400ms）⇒ 帧 ERROR 而宿主行 OK", { timeout: SEAM_TIMEOUT }, async () => {
    process.env.DSH_TOOL_EXEC_TIMEOUT_MS = "3000"; // 宿主档够宽 ⇒ 执行体真完成
    process.env.DSH_TOOL_EXEC_FETCH_TIMEOUT_MS = "100"; // 桥本地 fetch 截止先行放弃
    const stub = await startStubOpenAi([
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await t.repos.agents.insert(agentDef());
      vi.spyOn(t.dataCore.ontology, "listObjectTypeKeys").mockResolvedValue(["Base"]);
      vi.spyOn(t.dataCore.ontology, "queryObjects").mockImplementation(async () => {
        await sleep(400);
        return qoResult(BASE_PAYLOAD);
      });
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w8_b6", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      expect(JSON.stringify(stub.requests[1]!.body)).toContain("TOOL_EXECUTE_TIMEOUT");
      expect(qoStepStatus(emitted)).toBe("ERROR");
      // 孤儿行（REC §3 B3 登记的事实源）：桥放弃后宿主执行体仍跑到静息 ⇒ 晚落 OK 行。
      // 帧面 ERROR ∧ 宿主行 OK 的背离是合法的——审计行表 ∪ 帧流共同构成事实源。
      const rows = await waitForToolRows(t, "task_w8_b6", 1);
      expect(rows[0]!.outcome).toBe("OK");
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B7 watchdog 咬在反向调用中途：drain 语义——已起步结果帧照落 + turn 步边界收束", { timeout: SEAM_TIMEOUT }, async () => {
    process.env.QOS_AGENT_LOOP_REPEAT_CAP = "2"; // 第 2 次同参调用后 cancel
    const stub = await startStubOpenAi([
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE }, // 永不到达（反向哨兵）
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await t.repos.agents.insert(agentDef());
      spyOntology(t, BASE_PAYLOAD);
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w8_b7", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("BUDGET_EXHAUSTED");
      expect(result.degraded?.reason).toBe("STALL_LOOP");
      expect(stub.requests.length, "cap=2 ⇒ 第三轮 LLM 请求永不发出").toBe(2);
      // drain：两次反向调用都真完成、真落宿主审计行（cancel 不丢已起步的执行体）
      const rows = await t.repos.toolCalls.listByTask("task_w8_b7");
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.outcome === "OK")).toBe(true);
      expect(JSON.stringify(result.answer.blocks[0])).toContain("检测到无进度循环");
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B8 对象 scope 回归（B8 修复回咬）：enforceObjectScope 真到 executor ⇒ 越界 DENIED 逐字", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: "query_objects", arguments: JSON.stringify({ objectType: "Line" }) }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await t.repos.agents.insert(
        agentDef({ scopeDeclaration: { objectTypes: ["Material"], toolNames: ["query_objects"] } }),
      );
      spyOntology(t, BASE_PAYLOAD);
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w8_b8", emitted, { enforceObjectScope: true });

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      const req1 = JSON.stringify(stub.requests[1]!.body);
      expect(req1, "scope 类 DENIED 文案逐字等（loop.ts:880 第一支）").toContain(
        "AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明",
      );
      const rows = await t.repos.toolCalls.listByTask("task_w8_b8");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.outcome).toBe("DENIED");
      expect(JSON.stringify(rows[0]!.output), "对象 scope 门 payload 携带越界事实").toContain("AGENT_SCOPE_VIOLATION");
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B9 双侧无 SERVICE_TOKEN ⇒ 端点 401 fail-closed ⇒ ERROR 回执 ∧ 零审计行（mutation a 锚）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    // poc 档 = mock 治理放行（本臂只考 tool-execute 鉴权链，治理 401 另有 F-1 ④ 钉死）
    const { t, close } = await startToolExecApp({
      stubUrl: `${stub.url}/v1`,
      env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
    });
    try {
      await t.repos.agents.insert(agentDef());
      const qo = spyOntology(t, BASE_PAYLOAD);
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w8_b9", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      expect(JSON.stringify(stub.requests[1]!.body), "401 必须成 ERROR 回执（不许静默放行）").toContain("HTTP 401");
      expect(qoStepStatus(emitted)).toBe("ERROR");
      expect(qo.mock.calls.length).toBe(0);
      expect(await t.repos.toolCalls.listByTask("task_w8_b9")).toHaveLength(0);
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B10 端点畸形应答（200 但无 outcome）⇒ ERROR 回执 ∧ 零审计行（mutation b 锚）", { timeout: SEAM_TIMEOUT }, async () => {
    const bogus: Server = createHttpServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ bogus: true }));
    });
    await new Promise<void>((r) => bogus.listen(0, "127.0.0.1", r));
    const bogusPort = (bogus.address() as AddressInfo).port;
    const stub = await startStubOpenAi([
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({
      stubUrl: `${stub.url}/v1`,
      serviceToken: SERVICE_TOKEN,
      toolExecUrl: `http://127.0.0.1:${bogusPort}/b/v1/dsh/tool-execute`,
    });
    try {
      await t.repos.agents.insert(agentDef());
      const qo = spyOntology(t, BASE_PAYLOAD);
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w8_b10", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      expect(JSON.stringify(stub.requests[1]!.body), "畸形应答必须成 ERROR 回执").toContain("TOOL_EXECUTE_MALFORMED");
      expect(qo.mock.calls.length).toBe(0); // 打的是畸形替身，真端点未参与
      expect(await t.repos.toolCalls.listByTask("task_w8_b10")).toHaveLength(0);
    } finally {
      await close();
      await stub.close();
      await new Promise<void>((r) => bogus.close(() => r()));
    }
  });

  it("B11 >8KB 工具结果 e2e：子进程可见文案 = native 截断形逐字等 ∧ 审计行全量", { timeout: SEAM_TIMEOUT }, async () => {
    const items = Array.from({ length: 300 }, (_, i) => ({ id: `item-${i}`, name: "x".repeat(30) }));
    const big = { data: { total: 300, items } };
    const stub = await startStubOpenAi([
      { toolCall: { name: "query_objects", arguments: QO_ARGS }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await t.repos.agents.insert(agentDef());
      spyOntology(t, big);
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w8_b11", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED");
      const req1 = JSON.stringify(stub.requests[1]!.body);
      expect(req1, "截断标记形态必须上模型面（与 native 逐字等）").toContain("[已截断：共 300 条，仅含前");
      expect(req1).toContain("item-0"); // 截断保留前段
      expect(req1, "尾元素必须被截掉（模型面 ≠ 全量）").not.toContain("item-299");
      expect(req1).toContain('<tool_data tool_call_id=\\"tc_');
      const rows = await t.repos.toolCalls.listByTask("task_w8_b11");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.outcome).toBe("OK");
      expect(JSON.stringify(rows[0]!.output), "审计行 = 截断前全量（64KB 兜底）").toContain("item-299");
    } finally {
      await close();
      await stub.close();
    }
  });
});

// ---------------------------------------------------------------------------
// C 组 · W8.5：workflow 工具反向化（同端点 additive kind:"workflow" + 宿主 per-run 绑定表）
// ---------------------------------------------------------------------------

const WF_ID = "wf_w85_probe";
const WF_KEY = "w85_probe";
const WF_TOOL = `workflow_${WF_KEY}`; // expandAgentTools 命名口径（engine.ts:401）
const WF_RUN_TOKEN = "dshr_w85";

/** 2-step 确定性夹具：query_objects（本体间谍）+ render_answer（marker 块），零 LLM 步。 */
function workflowDef(): WorkflowDefinition {
  return {
    id: WF_ID,
    tenantId: TENANT,
    key: WF_KEY,
    version: 1,
    name: "W8.5 探针流程",
    description: "wo-dsh-prod-ready w8.5 seam",
    inputs: { type: "object", properties: {} },
    steps: [
      { id: "qo", type: "query_objects", params: { objectType: "Base", filter: {} } },
      { id: "ra", type: "render_answer", params: { blocks: [{ type: "text", markdown: "w85 workflow marker" }] } },
    ],
    status: "PUBLISHED",
  };
}

/** W8.5 agent：tools 仅 WORKFLOW ref（expand 后名 = workflow_<key>）。 */
function workflowAgentDef(): AgentDefinition {
  return agentDef({
    tools: [{ kind: "WORKFLOW", workflowId: WF_ID, version: 1 }],
    scopeDeclaration: { objectTypes: [], toolNames: [WF_TOOL] },
  } as Partial<AgentDefinition>);
}

describe("W8.5 · C workflow 反向化：模型可见 + 同端点反向执行 + 治理/审计/预算同账", () => {
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

  it("C1 workflow e2e OK：可见 + 真过宿主引擎 + 审计行三键 + 侧表 iterations + emit 透传", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: WF_TOOL, arguments: "{}" }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await t.repos.agents.insert(workflowAgentDef());
      await t.repos.workflows.insert(workflowDef());
      const qo = spyOntology(t, BASE_PAYLOAD);
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w85_c1", emitted);

      expect(result.run.kernel).toBe("EXTERNAL"); // 真走 DSH 分叉
      expect(result.outcome).toBe("ANSWERED");
      // 可见性：首轮请求 tools 面含 workflow_<key>（hostWorkflowTools 下发注册成反向工具）
      expect(JSON.stringify(stub.requests[0]!.body)).toContain(`"${WF_TOOL}"`);
      // 真过宿主引擎：nested workflow 的 qo 步本体真调一次
      expect(qo.mock.calls.length).toBe(1);
      // 审计行 = 2 行（native 同构）：nested qo 步过 GuardedToolExecutor 自落一行 +
      // 端点 workflow 行（loop.ts:805-815 对齐：tc_/taskId/toolName/outcome/durationMs 实测）
      const rows = await t.repos.toolCalls.listByTask("task_w85_c1");
      expect(rows).toHaveLength(2);
      const wfRow = rows.find((r) => r.toolName === WF_TOOL);
      const qoRow = rows.find((r) => r.toolName === "query_objects");
      expect(qoRow?.outcome, "nested 步执行行（executor 自落，native 同构）").toBe("OK");
      expect(wfRow, "端点 workflow 审计行").toBeDefined();
      expect(wfRow!.outcome).toBe("OK");
      expect(wfRow!.id).toMatch(/^tc_/);
      // stepOutputs 实回：模型面 <tool_data> 包装含 qo 步产物 + render_answer marker
      // （native WORKFLOW OK 包装 loop.ts:820 逐字——无 tool_call_id 属性，与 BUILTIN 面 :901 不同形）
      const req1 = JSON.stringify(stub.requests[1]!.body);
      expect(req1).toContain("常州基地");
      expect(req1).toContain("w85 workflow marker");
      // W9-full 侧表零改动吃到：run.iterations 该行 toolCallId = 审计行 tc_、outcome OK
      const iterCalls = result.run.iterations.flatMap((it) => it.toolCalls);
      const wfCall = iterCalls.find((c) => c.toolName === WF_TOOL);
      expect(wfCall, "iterations 须经 hostToolCalls 侧表吃到 workflow 调用行").toBeDefined();
      expect(wfCall!.toolCallId).toBe(wfRow!.id);
      expect(wfCall!.outcome).toBe("OK");
      // emit 透传：nested workflow 步事件经 workflowCtx.emit 宿主侧发射（出处差登记：非帧流）
      expect(emitted.some((f) => f.event === "step.started" && (f.payload as { stepId?: string }).stepId === "qo")).toBe(true);
      expect(emitted.some((f) => f.event === "step.completed" && (f.payload as { stepId?: string }).stepId === "ra")).toBe(true);
    } finally {
      await close();
      await stub.close();
    }
  });

  it("C2 端点级：绑定表 miss ⇒ ERROR fail-closed + ERROR 审计行（wire workflowId 被无视）", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    try {
      // wire 点名的 workflow 真实存在——仍不许越权解析（绑定表 = 唯一权威，mutation m2 咬位）
      await t.repos.workflows.insert(workflowDef());
      registerRun(t, WF_RUN_TOKEN, {
        taskId: "task_w85_c2",
        workflowBindings: new Map([[WF_TOOL, { workflowId: WF_ID, version: 1 }]]),
        workflowCtx: {
          taskId: "task_w85_c2",
          ctx: CTX,
          nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", "agt_w8_main"),
          emit: async () => {},
        },
      });
      const res = await callExecute(t, {
        runToken: WF_RUN_TOKEN,
        callId: "c2-1",
        kind: "workflow",
        toolName: "workflow_evil", // 幻觉名：不在绑定表
        input: {},
        workflowId: WF_ID, // 越权点名材料：实现若从 wire 读 workflowId，本调用会真跑 wf_w85_probe ⇒ 红
      }, SERVICE_TOKEN);
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.outcome).toBe("ERROR"); // fail-closed ERROR，非 DENIED（native 面该工具不可见，无 DENIED 对位）
      expect(JSON.stringify(body.payload)).toContain("WORKFLOW");
      const rows = await t.repos.toolCalls.listByTask("task_w85_c2");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.outcome).toBe("ERROR");
      expect(rows[0]!.toolName).toBe("workflow_evil");
      expect(rows[0]!.id).toBe(body.toolCallId); // 回执 tc_ = 审计行主键（与 tool 分支同口径）
    } finally {
      await t.app.close();
    }
  });

  it("C3 workflow 内部 FAILED ⇒ ERROR parity（两态词表 + ERROR 审计行 + isError 回执上模型面）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: WF_TOOL, arguments: "{}" }, usage: PLAIN_USAGE },
      { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: PLAIN_USAGE },
      { text: "stub final answer", usage: PLAIN_USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startToolExecApp({ stubUrl: `${stub.url}/v1`, serviceToken: SERVICE_TOKEN });
    try {
      await t.repos.agents.insert(workflowAgentDef());
      await t.repos.workflows.insert(workflowDef());
      vi.spyOn(t.dataCore.ontology, "listObjectTypeKeys").mockResolvedValue(["Base", "Line", "Material"]);
      vi.spyOn(t.dataCore.ontology, "queryObjects").mockRejectedValue(new Error("w85 ontology down"));
      const emitted: Emitted[] = [];
      const result = await runAgent(t, "task_w85_c3", emitted);

      expect(result.run.kernel).toBe("EXTERNAL");
      expect(result.outcome).toBe("ANSWERED"); // workflow 失败不炸 agent 循环（native catch → ERROR 同口径）
      const rows = await t.repos.toolCalls.listByTask("task_w85_c3");
      expect(rows).toHaveLength(2); // nested qo 步 ERROR 行（executor 自落）+ 端点 workflow ERROR 行
      const wfRow = rows.find((r) => r.toolName === WF_TOOL);
      expect(rows.find((r) => r.toolName === "query_objects")?.outcome).toBe("ERROR");
      expect(wfRow).toBeDefined();
      expect(wfRow!.outcome).toBe("ERROR"); // CANCELLED/FAILED/预算 throw 一律 ERROR（两态词表）
      const req1 = JSON.stringify(stub.requests[1]!.body);
      expect(req1, "ERROR payload JSON 上模型面（loop.ts:889 同形）").toContain("w85 ontology down");
    } finally {
      await close();
      await stub.close();
    }
  });

  it("C4 零扰动锚：无 WORKFLOW ref ⇒ setup 键缺席；wire 无 kind ⇒ tool 路逐字节旧；kind 畸形 ⇒ 400", async () => {
    // 形态B 单元：setup 层键缺席/内容透传（对位 W8副 A6-B 同手法）
    const agent = agentDef(); // 默认 tools 仅 BUILTIN query_objects，无 WORKFLOW ref
    const baseInput = { agent, agentSystemCore: "CORE", grantedToolNames: ["query_objects"] };
    const specWithout = buildSessionSetup(baseInput);
    expect(
      Object.prototype.hasOwnProperty.call(specWithout, "hostWorkflowTools"),
      "无 WORKFLOW 授予 ⇒ hostWorkflowTools 键必须缺席（setup 帧逐字节旧行为）",
    ).toBe(false);
    const wfTools = [{ name: WF_TOOL, description: "d", inputSchema: { type: "object" } }];
    const specWith = buildSessionSetup({ ...baseInput, hostWorkflowTools: wfTools });
    expect(specWith.hostWorkflowTools).toEqual(wfTools);

    // 端点级：run 条目带 workflow 绑定表，wire 不带 kind ⇒ 仍走 tool 路（旧桥逐字节旧）
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    try {
      registerRun(t, WF_RUN_TOKEN, {
        taskId: "task_w85_c4",
        workflowBindings: new Map([[WF_TOOL, { workflowId: WF_ID, version: 1 }]]),
        workflowCtx: {
          taskId: "task_w85_c4",
          ctx: CTX,
          nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", "agt_w8_main"),
          emit: async () => {},
        },
      });
      spyOntology(t, BASE_PAYLOAD);
      const res = await callExecute(t, {
        runToken: WF_RUN_TOKEN,
        callId: "c4-1",
        toolName: "query_objects", // 无 kind ⇒ 缺席 = tool（additive 旧行为）
        input: { objectType: "Base" },
      }, SERVICE_TOKEN);
      expect(res.statusCode).toBe(200);
      expect((res.json() as Record<string, unknown>).outcome).toBe("OK");
      const rows = await t.repos.toolCalls.listByTask("task_w85_c4");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.toolName).toBe("query_objects");
      // kind 畸形 ⇒ 400 fail-closed（词表外值不许静默当 tool）
      const bad = await callExecute(t, {
        runToken: WF_RUN_TOKEN,
        callId: "c4-2",
        kind: "bogus",
        toolName: "query_objects",
        input: {},
      }, SERVICE_TOKEN);
      expect(bad.statusCode).toBe(400);
    } finally {
      await t.app.close();
    }
  });
});
