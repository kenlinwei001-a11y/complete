/**
 * WO-DSH-E2E · §16.2 L1 双跑字节比对（65 任务）driver。
 *
 * 对账口径单源 = fixtures/dualrun-corpus/RECONCILIATION.md（team-lead 2026-08-19 重定义：
 * scalar + kernel 唯一白名单 + native 迭代锚 + dsh stats 对齐）。骨架扩 N2
 * dsh-dualrun-reconcile.test.ts 双臂形态（蓝图 evidence 4），四断言面：
 *   A1 Answer 结构逐字节（剥 stats + provenance id/toolCallId 归一）；
 *   A2 拒绝口径（文案逐字节 + dsh wire deny 证据 + native 强制点 provId 锚）；
 *   A3 SSE 事件名序列（收缩白名单过滤后逐项等 + 差集 ⊆ ALLOWED_PSEUDO_TYPES 反咬）；
 *   A4 审计逐字段（归一化/逐值等/kernel 唯一差/native 迭代锚/dsh stats 锚）。
 * 发车哨兵（蓝图 risks #3，防 native-vs-native 假绿）：dsh 臂 stub wire 请求数 ==
 * 剧本轮数 + kernel==="EXTERNAL" + answer 含任务 marker；deny_prefork 类反向哨兵（零 spawn）；
 * EMPTY 空块类 marker 哨兵条件豁免（markerSentinelExempt 谓词 + wire 首请求替代锚，A0 双恰护栏）。
 * A5 确定性：子集同臂连跑两遍过同一比对器。
 *
 * 环境：负载 >400 时按 env-precheck 口径 180s timeout 串行（--pool=forks --maxWorkers=1
 * --maxConcurrency=1 --testTimeout=180000）。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { AgentDefinition, AgentRunRecord, RuleVerdict, SkillDefinition, WorkflowDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { scanBlocks } from "../src/util/numerics.js";
import { MockMcpClient } from "../src/mcp/mock.js";
import { encryptSecret } from "../src/crypto.js";
import {
  STUB_DCP_SPEC,
  STUB_FAKE_KEY,
  startStubOpenAi,
  stubDirectory,
  stubProvider,
  type StubRequest,
} from "./helpers-dsh-stub.js";
import {
  A5_SUBSET,
  DUALRUN_CORPUS,
  GATED_SLOTS,
  skillIdOf,
  type CorpusWorkflow,
  type DualRunTask,
} from "./fixtures/dualrun-corpus/corpus.js";

/** W8.5：workflow 语料任务 dsh 臂真 listen 的显式假 service token（绝非真凭据）。 */
const DUALRUN_SERVICE_TOKEN = "wo-dsh-e2e-dualrun50-fake-service-token-000000";

/** W8.5：抓空闲端口再释放（镜像 dsh-engine-tool-bridge.seam freePort；cfg 在 listen 前定型 ⇒ URL 须预知端口）。 */
async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
/** W8副：mcp 语料任务 dsh 臂的 stdio fixture（三工具 echo/echo2/util.calc，与语料 tools 表逐字镜像）。 */
const MOCK_SERVER_MULTI = fileURLToPath(new URL("./fixtures/mock-mcp-stdio-server-multi.mjs", import.meta.url));
/** W8副：显式假凭据（绝非真凭据；泄凭扫描对象为真凭据前缀模式）。 */
const FAKE_MCP_SECRET = "wo-dsh-prod-ready-w8sub-fake-secret-0000000000000000";
const ctx = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

// ---------------------------------------------------------------------------
// 白名单单源守卫：ALLOWED_PSEUDO_TYPES / KNOWN_EVENTS 的唯一权威在 N2 套件
// （dsh-dualrun-reconcile.test.ts，蓝图 evidence 4「单源白名单」）。本文件不重声明——
// 直接解析源文件字面量，源漂移即红（import 该测试文件会重复注册其套件，故走文本锚）。
// ---------------------------------------------------------------------------
const N2_SRC = readFileSync(fileURLToPath(new URL("./dsh-dualrun-reconcile.test.ts", import.meta.url)), "utf8");
function literalArray(name: string): string[] {
  const m = N2_SRC.match(new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`));
  // ⚠ `m` 与 `m[1]` 要分开判：正则整体没命中 ⇒ 源文件里根本没这个常量（单源守卫该报的那件事）；
  //    命中而捕获组为空 ⇒ 正则写错了。两者处置方向不同，合成一句会把「工具坏了」读成「源没这个符号」。
  if (!m) throw new Error(`单源守卫：${name} 在 dsh-dualrun-reconcile.test.ts 中未找到`);
  const body = m[1];
  if (body === undefined) throw new Error(`单源守卫：${name} 命中但捕获组为空 —— 是这里的正则坏了，不是源缺符号`);
  const out = [...body.matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((v): v is string => v !== undefined);
  // 金丝雀：单源白名单不可能是空的。抽出 0 条 ⇒ 报「工具坏了」，不许静默返回 []
  // （那会让下游所有基于该白名单的断言变成恒真）。
  if (out.length === 0) throw new Error(`单源守卫：${name} 抽出 0 条 ⇒ 抽取器坏了，不是白名单空了`);
  return out;
}
const ALLOWED_PSEUDO_TYPES = literalArray("ALLOWED_PSEUDO_TYPES");
const SHRUNK_PSEUDO_TYPES = ALLOWED_PSEUDO_TYPES.filter((t) => t !== "final_answer" && t !== "load_skill");
const KNOWN_EVENTS = literalArray("KNOWN_EVENTS");

// ---------------------------------------------------------------------------
// 双臂驱动
// ---------------------------------------------------------------------------

interface CapturedEvent {
  event: string;
  payload: Record<string, unknown>;
}

interface ArmProducts {
  outcome: string;
  answer: Record<string, unknown>;
  /** G2：result.structured 捕获（expectsSchema 任务的双臂对账面；非结构化任务两臂同 undefined）。 */
  structured?: unknown;
  /** G3：result.degraded 捕获（length 截断任务的分锚面；先补观测面再断言，同 structured 纪律）。 */
  degraded?: { reason: string };
  run: AgentRunRecord;
  sketch: { toolName: string; inputSummary: string }[];
  events: CapturedEvent[];
  stubRequests: StubRequest[];
  /**
   * W5 块3（A4b）：本臂运行落库的 toolCalls 审计行（repos.toolCalls.listByTask 原样快照，
   * 仅取对账字段）。native 臂 load_skill 每轮一行（loop.ts:731）；dsh 臂恒零行
   * （reassemble 纯重组装零 IO——固有不对称 #4 的审计空壳维度，本面把它从「登记」升级为「锚」）。
   * W8.5 翻锚：语料声明 expect.auditRows 的任务（dr50-cm）两臂真对账——行 id 随快照带出，
   * 比对时钉 tc_ 形态（归一化为形态锚，不比值）。
   */
  auditRows: { id: string; toolName: string; outcome: string; input: unknown }[];
  /**
   * W8副（#54）：本臂模型可见工具名集（原始序）。native 臂 = llm.agentRequests[0].tools
   * （in-process mock 捕获面）；dsh 臂 = stub.requests[0].body.tools[].function.name
   * （子进程世界真注册面，wire 实证）。仅 mcp 语料任务捕获/比对。
   */
  visibleToolNames?: string[];
}

function agentDef(task: DualRunTask): AgentDefinition {
  return {
    id: `agt_${task.id}`,
    tenantId: TENANT,
    key: `agt_${task.id}`,
    version: 1,
    name: `L1 双跑 ${task.id}`,
    description: "WO-DSH-E2E L1 dualrun50 corpus agent",
    model: STUB_DCP_SPEC, // 两臂同值：model 成真 scalar（探针 P1 坐实 roleModel 回落原值）
    systemPrompt: `你是 L1 双跑对账 agent（${task.id}）。`,
    tools: [
      { kind: "BUILTIN", name: "query_objects" },
      // W8副：mcp 语料任务的 MCP ref（toolFilter 真源 = agent.tools，contracts AgentToolRefSchema）。
      ...(task.mcp
        ? [{ kind: "MCP" as const, mcpConfigId: task.mcp.configId, ...(task.mcp.toolFilter ? { toolFilter: task.mcp.toolFilter } : {}) }]
        : []),
      // W8.5：workflow 语料任务的 WORKFLOW ref（条件散布照 mcp 先例；expand 后模型可见名 = workflow_<key>）。
      ...(task.workflow
        ? [{ kind: "WORKFLOW" as const, workflowId: task.workflow.id, version: task.workflow.version }]
        : []),
    ],
    ruleBindings: task.ruleBindings,
    skills: task.skills.map((s) => ({ skillId: skillIdOf(task.id, s.key), version: 1 as const })),
    mcpServers: task.mcp ? [{ mcpConfigId: task.mcp.configId }] : [],
    scopeDeclaration: {
      objectTypes: ["Base"],
      // W8.5：workflow_<key> 须进 scope 允许表——native loop.ts:766 scope 闸与 dsh setup
      // scoped 允许表同源消费（缺 ⇒ native DENIED / dsh 注册期 fail-closed，两臂同红）。
      toolNames: ["query_objects", ...(task.workflow ? [`workflow_${task.workflow.key}`] : [])],
    },
    status: "PUBLISHED",
  };
}

/** W8.5：语料声明 → WorkflowDefinition 行（两臂同 seed，同 skillDef 手法）。 */
function workflowDef(task: DualRunTask, w: CorpusWorkflow): WorkflowDefinition {
  return {
    id: w.id,
    tenantId: TENANT,
    key: w.key,
    version: w.version,
    name: w.name,
    description: w.description,
    inputs: w.inputs,
    steps: w.steps,
    status: "PUBLISHED",
  } as WorkflowDefinition;
}

function skillDef(task: DualRunTask, s: DualRunTask["skills"][number]): SkillDefinition {
  return {
    id: skillIdOf(task.id, s.key),
    tenantId: TENANT,
    key: s.key,
    version: 1,
    name: s.name,
    summary: s.summary,
    body: s.body,
    resources: [],
    status: "PUBLISHED",
    // W5 块2：治理位从语料声明取（缺省 = 既有硬编码，旧 59 条零漂移；dr50-cj 置 WRITE ⇒ writeMode 通道开）。
    sideEffect: s.sideEffect ?? "READ",
    approvalGate: s.approvalGate ?? "none",
    provenancePolicy: "best_effort",
    references: (s.preRuleKeys ?? []).map((key) => ({
      kind: "rule" as const,
      key,
      role: "precondition" as const,
      required: true,
    })),
  } as SkillDefinition;
}

/** 规则求值逐任务编剧：pre-check（queryText 载荷）/ POST_CHECK（answerText 载荷）分流。 */
function patchRules(t: TestApp, task: DualRunTask): void {
  if (!task.native.preBlock && !task.native.postBlock) return;
  const rules = t.dataCore.rules as unknown as {
    evaluate: (c: unknown, k: unknown, p: unknown) => Promise<RuleVerdict[]>;
  };
  const orig = rules.evaluate.bind(rules);
  rules.evaluate = async (c: unknown, k: unknown, p: unknown) => {
    const payload = (p ?? {}) as Record<string, unknown>;
    if (task.native.preBlock && "queryText" in payload) return task.native.preBlock;
    if (task.native.postBlock && "answerText" in payload) return task.native.postBlock;
    return orig(c, k, p);
  };
}

async function runArm(task: DualRunTask, flag: "off" | "on"): Promise<ArmProducts> {
  const stub = flag === "on" ? await startStubOpenAi(task.dsh.rounds.map((r) => ({ ...r }))) : undefined;
  // W8.5：workflow 语料任务的 dsh 臂必须真 listen——子进程经 127.0.0.1 真 HTTP 打
  // /b/v1/dsh/tool-execute（镜像 dsh-engine-tool-bridge.seam startToolExecApp：freePort +
  // env PORT 钉死 + SERVICE_TOKEN ⇒ engine 缺省推导 PLATFORM_TOOL_EXEC_URL/TOKEN 双双真到；
  // finally close）。native 臂 in-process runWorkflowAsTool，维持现状不 listen。
  // 非 workflow 任务零扰动（不 listen、帧逐字节旧——A0/既有任务回归即证）。
  const needsListen = flag === "on" && task.workflow !== undefined;
  const listenPort = needsListen ? await freePort() : undefined;
  // W8副：mcp 语料任务两臂同 seed——in-process MockMcpClient 同工具表镜像（宿主
  // expandAgentTools 枚举面两臂同源）；记录文件路径仅 dsh 臂 stdio fixture 真写。
  const mcpTmp = task.mcp ? mkdtempSync(join(tmpdir(), `dualrun-mcp-${task.id}-`)) : undefined;
  const mcpOpt = task.mcp ? { mcp: new MockMcpClient({ [task.mcp.configId]: task.mcp.tools }) } : {};
  const t = await createTestApp(
    // F-1：dsh 臂钉 poc 档（生产档治理已切 http；govDeny 语料依赖 mock 模式 PLATFORM_GOV_DENY）。
    stub ? { providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never, env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml", ...(needsListen ? { PORT: String(listenPort), SERVICE_TOKEN: DUALRUN_SERVICE_TOKEN } : {}) }, ...mcpOpt } : mcpOpt,
  );
  // W8.5：workflow 定义行两臂同 seed（声明驱动；nested 执行两臂同经 runWorkflowAsTool 解析）。
  if (task.workflow) {
    await t.repos.workflows.insert(workflowDef(task, task.workflow));
    // 本体间谍（镜像 seam spyOntology）：query_objects 步确定性产物，两臂同形。
    vi.spyOn(t.dataCore.ontology, "listObjectTypeKeys").mockResolvedValue(["Base", "Line", "Material"]);
    vi.spyOn(t.dataCore.ontology, "queryObjects").mockResolvedValue({
      data: { total: 1, items: [{ id: "base-cm", name: `常州基地（${task.id}）` }] },
      snapshotVersion: "dualrun-w85",
    });
  }
  if (task.mcp && mcpTmp) {
    const mcp = task.mcp;
    await t.repos.mcpConfigs.insert({
      id: mcp.configId,
      tenantId: TENANT,
      name: `dualrun mcp ${task.id}`,
      serverName: mcp.serverName,
      transport: { type: "stdio", command: process.execPath, args: [MOCK_SERVER_MULTI, join(mcpTmp, "record.json")] },
      credentialRef: mcp.credId,
      credentialKind: "static_bearer",
      status: "ACTIVE",
    } as never);
    await t.repos.credentials.insert({
      id: mcp.credId,
      tenantId: TENANT,
      name: `dualrun mcp cred ${task.id}`,
      ciphertext: encryptSecret(FAKE_MCP_SECRET, t.config.CREDENTIAL_KEY),
      createdAt: new Date().toISOString(),
    });
  }
  for (const s of task.skills) await t.repos.skills.insert(skillDef(task, s));
  await t.repos.agents.insert(agentDef(task));
  patchRules(t, task);
  const events: CapturedEvent[] = [];
  const emit = async (event: string, payload: unknown) => {
    events.push({ event, payload: payload as Record<string, unknown> });
  };
  if (flag === "on") {
    process.env.DSH_HARNESS = "1";
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    if (task.dsh.govDeny) process.env.PLATFORM_GOV_DENY = task.dsh.govDeny.join(",");
  }
  try {
    if (needsListen) await t.app.listen({ port: listenPort!, host: "127.0.0.1" });
    if (flag === "off") t.llm.queueAgentTurn(...task.native.turns);
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: `task_${task.id}`,
      agentId: `agt_${task.id}`,
      version: "latest",
      prompt: task.prompt,
      ctx,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit,
      // G2：expectsSchema 透传（engine.ts:225 opts 字段，两臂接线俱在：:605 setup/:620 reassemble/:695 loop）
      ...(task.expectsSchema ? { expectsSchema: task.expectsSchema } : {}),
    });
    // 镜像 orchestrator.ts:2187（G-9 逃生舱）：answer.final 整对象直发 result.answer（两臂同一行，N2 同形）。
    events.push({ event: "answer.final", payload: result.answer as Record<string, unknown> });
    // W5 块3（A4b）：审计行快照在臂内完成（repos 随 TestApp 存活；行序 = listByTask 的 createdAt 序，
    // 同毫秒并列时 V8 稳定排序保插入序——语料逐轮串行插入，次序即剧本序）。
    const auditRows = (await t.repos.toolCalls.listByTask(`task_${task.id}`)).map((r) => ({
      id: r.id,
      toolName: r.toolName,
      outcome: r.outcome,
      input: r.input,
    }));
    // W8副：mcp 语料任务的可见工具名集捕获（各臂各源，比对在 compareArms）。
    let visibleToolNames: string[] | undefined;
    if (task.mcp) {
      if (flag === "on") {
        const tools = (stub?.requests[0]?.body as { tools?: { function?: { name?: string } }[] } | undefined)?.tools ?? [];
        visibleToolNames = tools.map((x) => x.function?.name ?? "");
      } else {
        const reqs = (t.llm as unknown as { agentRequests: { tools: { name: string }[] }[] }).agentRequests;
        visibleToolNames = (reqs[0]?.tools ?? []).map((x) => x.name);
      }
    }
    return {
      outcome: result.outcome,
      answer: result.answer as Record<string, unknown>,
      structured: (result as { structured?: unknown }).structured,
      degraded: (result as { degraded?: { reason: string } }).degraded,
      run: result.run,
      sketch: result.sketch,
      events,
      stubRequests: stub?.requests ?? [],
      auditRows,
      visibleToolNames,
    };
  } finally {
    delete process.env.DSH_HARNESS;
    delete process.env.DSH_HARNESS_DIR;
    delete process.env.PLATFORM_GOV_DENY;
    if (needsListen) await t.app.close();
    if (stub) await stub.close();
    if (mcpTmp) rmSync(mcpTmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 比对器（归一化 + 声明映射 + kernel 唯一白名单）
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** answer 归一：剥 dsh stats 附加键；provenance 的 id/toolCallId 归一占位（归一化集 + 声明映射集）。 */
function normalizeAnswer(a: Json): Json {
  const rest = { ...a };
  delete rest.stats;
  const provenance = ((rest.provenance as Json[] | undefined) ?? []).map((p) => ({
    ...p,
    id: "<prov>",
    toolCallId: "<tc>",
  }));
  return { ...rest, provenance };
}

/** run 归一：剔归一化集（id/createdAt）与分项锚定集（iterations/tokens/kernel）后比 scalar 尾。 */
function scalarTail(r: AgentRunRecord): Json {
  const rest = { ...(r as AgentRunRecord & { createdAt?: string }) } as Json;
  // 归一化集（id/createdAt）+ 分项锚定集（iterations/tokens/kernel）逐键剔除。
  for (const k of ["id", "createdAt", "iterations", "totalInputTokens", "totalOutputTokens", "kernel"]) delete rest[k];
  return rest;
}

const seqOf = (events: readonly CapturedEvent[]): string[] =>
  events.map((e) => `${e.event}:${typeof e.payload?.type === "string" ? e.payload.type : ""}`);

const stripStats = (events: readonly CapturedEvent[]): CapturedEvent[] =>
  events.map((e) => {
    if (e.event !== "answer.final" || !("stats" in e.payload)) return e;
    const rest = { ...e.payload };
    delete rest.stats;
    return { event: e.event, payload: rest };
  });

const filterPseudo = (events: readonly CapturedEvent[]): CapturedEvent[] =>
  events.filter((e) => !(typeof e.payload?.type === "string" && SHRUNK_PSEUDO_TYPES.includes(e.payload.type)));

/** N2 A5 同形：多重集差（剥 stats 后、过滤前计算）。 */
function diffItems(a: readonly CapturedEvent[], b: readonly CapturedEvent[]): string[] {
  const seqA = [...seqOf(stripStats(a))];
  const seqB = [...seqOf(stripStats(b))];
  const bagB = new Map<string, number>();
  for (const s of seqB) bagB.set(s, (bagB.get(s) ?? 0) + 1);
  const onlyA: string[] = [];
  for (const s of seqA) {
    const n = bagB.get(s) ?? 0;
    if (n > 0) bagB.set(s, n - 1);
    else onlyA.push(s);
  }
  const bagA = new Map<string, number>();
  for (const s of seqA) bagA.set(s, (bagA.get(s) ?? 0) + 1);
  const onlyB: string[] = [];
  for (const s of seqB) {
    const n = bagA.get(s) ?? 0;
    if (n > 0) bagA.set(s, n - 1);
    else onlyB.push(s);
  }
  return [...onlyA, ...onlyB];
}

function checkSseFace(task: DualRunTask, x: ArmProducts, y: ArmProducts, flags: { x: "off" | "on"; y: "off" | "on" }): void {
  // W8.5：workflow 语料任务的声明制剥除（REC §3 W8.5 登记项）——dsh 臂帧流 mapper 为
  // workflow 调用自身发 step.started{type:workflow_<key>} + step.completed{stepId,status}
  // 两条（reassemble mapper tool/call·tool/result 分支）；native WORKFLOW 分支无该发射点
  // （step.started/step.completed 发射点 loop.ts:848-849 仅 executor 路径）。nested 步事件
  // （qo/ra）两臂同 executor 码发射（dsh 臂来自宿主端点 workflowCtx.emit 路径——emit 出处差
  // 登记），序列逐项等不剥。双向反咬：dsh 臂必须真产该两条（反向通道真被调用之证，消失即红），
  // native 臂必须不产（发射点漂移即红）。
  const stripWfFrameEvents = (arm: ArmProducts, flag: "off" | "on"): CapturedEvent[] => {
    if (!task.workflow) return arm.events;
    const wfTool = `workflow_${task.workflow.key}`;
    const started = arm.events.filter((e) => e.event === "step.started" && e.payload?.type === wfTool);
    if (flag === "on") {
      expect(started, `${task.id} A3 反向钉：dsh 臂帧流必须真产 step.started:${wfTool}（反向通道真调用之证）`).toHaveLength(1);
      const stepId = started[0]!.payload.stepId;
      const completed = arm.events.filter((e) => e.event === "step.completed" && e.payload?.stepId === stepId);
      expect(completed, `${task.id} A3 反向钉：dsh 臂帧流必须真产 workflow 调用自身的 step.completed`).toHaveLength(1);
      return arm.events.filter((e) => e !== started[0] && e !== completed[0]);
    }
    expect(started, `${task.id} A3 反向钉：native 臂 WORKFLOW 分支不得为调用自身发 step.started（发射点仅 executor 路径）`).toHaveLength(0);
    return arm.events;
  };
  const xEvents = stripWfFrameEvents(x, flags.x);
  const yEvents = stripWfFrameEvents(y, flags.y);
  for (const item of diffItems(xEvents, yEvents)) {
    const pseudoType = item.split(":")[1] ?? "";
    expect(
      ALLOWED_PSEUDO_TYPES.includes(pseudoType),
      `${task.id} 差集项 ${item} 的伪步类型必须在 ALLOWED_PSEUDO_TYPES 内（加项须评审）`,
    ).toBe(true);
  }
  expect(seqOf(filterPseudo(stripStats(xEvents)))).toEqual(seqOf(filterPseudo(stripStats(yEvents))));
  for (const e of [...xEvents, ...yEvents]) {
    expect(KNOWN_EVENTS, `${task.id} 事件名 ${e.event} 必须在 KNOWN_EVENTS 十名内`).toContain(e.event);
  }
}

function checkAuditFace(task: DualRunTask, x: ArmProducts, y: ArmProducts, flags: { x: "off" | "on"; y: "off" | "on" }): void {
  const div = task.expect.lengthDivergence;
  if (div) {
    // G3 分锚（RECONCILIATION §2 A4 分锚行 + §3 #9；team-lead 2026-08-21 裁决）：
    // budgetExhausted 两臂不互比、各锚各的声明值（先例 = A4 token 账两臂分锚）——
    // 从 scalar 尾剔出后逐臂锚定，其余 scalar 尾照常逐值等；全局断言对非 div 任务零放宽。
    const xTail = scalarTail(x.run);
    const yTail = scalarTail(y.run);
    delete xTail.budgetExhausted;
    delete yTail.budgetExhausted;
    expect(xTail).toEqual(yTail);
    // native 臂锚 = false（loop.ts:1027 软收尾不走 finishRun(true)）；dsh 臂锚 = 语料声明 true。
    expect(x.run.budgetExhausted, `${task.id} budgetExhausted 分锚（x 臂）`).toBe(flags.x === "on" ? div.dsh.budgetExhausted : false);
    expect(y.run.budgetExhausted, `${task.id} budgetExhausted 分锚（y 臂）`).toBe(flags.y === "on" ? div.dsh.budgetExhausted : false);
  } else {
    // scalar 尾逐值等 + kernel 两臂锚定字面量（⇒ 差集恰 = {kernel}，白名单零膨胀）
    expect(scalarTail(x.run)).toEqual(scalarTail(y.run));
  }
  expect(x.run.kernel).toBe(flags.x === "on" ? "EXTERNAL" : "NATIVE");
  expect(y.run.kernel).toBe(flags.y === "on" ? "EXTERNAL" : "NATIVE");
  // 归一化集形态锚
  expect(x.run.id).toMatch(/^run_/);
  expect(y.run.id).toMatch(/^run_/);
}

/** 单臂锚：native 迭代/token 锚 + dsh 空壳/stats 锚（RECONCILIATION §2-A4）。 */
function checkArmAnchors(task: DualRunTask, flag: "off" | "on", arm: ArmProducts): void {
  if (flag === "off") {
    expect(arm.run.totalInputTokens).toBe(task.expect.nativeTokens.input);
    expect(arm.run.totalOutputTokens).toBe(task.expect.nativeTokens.output);
    const its = arm.run.iterations;
    expect(its.length).toBe(task.expect.nativeIterations.length);
    its.forEach((it, i) => {
      const anchor = task.expect.nativeIterations[i];
      // ⚠ 显式断言锚点存在，不用 `!` 抹掉 —— 上一行刚断言过 `its.length === nativeIterations.length`，
      //    但那是**另一个**命题：长度相等不保证逐个下标取得到（数组可含空洞）。
      //    锚点缺失时这里必须**当场红并指出是第几轮**，而不是在下一行报一个看不懂的 undefined。
      expect(anchor, `第 ${i} 轮缺锚点（nativeIterations 长度对得上但取不到该下标）`).toBeDefined();
      if (!anchor) return;
      expect(it.toolCalls.length).toBe(anchor.calls.length);
      it.toolCalls.forEach((c, j) => {
        const ec = anchor.calls[j];
        expect(ec, `第 ${i} 轮第 ${j} 个工具调用缺锚点`).toBeDefined();
        if (!ec) return;
        expect(c.toolName).toBe(ec.toolName);
        expect(c.outcome).toBe(ec.outcome);
        if (ec.input !== undefined) expect(c.input).toEqual(ec.input);
        expect(c.toolCallId).toMatch(/^tc_/);
        expect(c.durationMs).toBeGreaterThanOrEqual(0);
      });
    });
  } else {
    // dsh 臂审计锚（固有不对称 #4 已销·W9-full 单翻落线；MCP 两态上限余 #10 部分销）：
    // 两臂不互比、各锚各的剧本——A4 锚定方案不变（scalar 互比零触、kernel 唯一差不变）。
    // W9-full 单翻（2026-08-22 裁决）：断言结构翻四态词表 + tc_ 形态许可；锚值零动——
    // 语料 meta-only ⇒ 侧表恒空 ⇒ 值面仍帧推导（OK/ERROR + 帧 callId 原值），四态值
    // （DENIED/BUDGET_EXCEEDED）与 tc_ 值面的真对账待语料引入真反向调用（A4b 同登记）。
    const anchor = task.expect.dshStats;
    const stats = (arm.answer as { stats?: { tokenUsage: Json; contextPressure?: Json; sessionStats: Json } }).stats;
    if (!anchor) {
      // 零 spawn（分叉前预检早退）：无帧流 ⇒ 空壳维持（诚实缺省，骨架不造无源数据）
      expect(stats, `${task.id} 零 spawn 任务不得有 stats 键`).toBeUndefined();
      expect(arm.run.iterations, `${task.id} 零 spawn ⇒ iterations 空壳维持`).toEqual([]);
      expect(arm.run.totalInputTokens, `${task.id} 零 spawn ⇒ tokens 0/0 维持`).toBe(0);
      expect(arm.run.totalOutputTokens, `${task.id} 零 spawn ⇒ tokens 0/0 维持`).toBe(0);
      return;
    }
    expect(stats, `${task.id} dsh 臂必带 stats（N2 M8 回声）`).toBeDefined();
    expect(stats!.tokenUsage).toEqual({
      uncachedInputTokens: anchor.uncachedInputTokens,
      outputTokens: anchor.outputTokens,
      cacheReadTokens: anchor.cacheReadTokens,
      cacheWriteTokens: anchor.cacheWriteTokens,
    });
    expect(stats!.contextPressure).toEqual({ pressureTokens: anchor.pressureTokens });
    expect(stats!.sessionStats.turns).toBe(anchor.turns);
    expect(stats!.sessionStats.steps).toBe(anchor.steps);
    // WO-DSH-PROD-READY W9-full 骨架锚①（W9-lite 结构 + 单翻词表/形态）：iterations = 帧流 step
    // 分组（team-lead 2026-08-21 裁决②——native 迭代粒度 = 每 LLM 轮 = step，turn 恒 1 时 turn
    // 分组恒产单迭代无 parity 价值）。
    // 每 stub 轮 = 一个 LLM step（与上方 stats 锚 steps === 剧本轮数同源互证）⇒ 迭代数 === 剧本轮数，
    // index 0 基顺编号对位 native index=i；非 meta 调用对点所属轮（final_answer 剔除其轮留空迭代，
    // 对位 native 审计口径 + :1041 空轮形态）；outcome 词表翻四态（OK/DENIED/ERROR/BUDGET_EXCEEDED——
    // 侧表命中支四态有源；本语料 meta-only 侧表恒空，值面恒 OK/ERROR，锚值不变）；durationMs
    // 只锚非负形态（命中支宿主实测/未命中支帧 time 差推导，墙钟，A4 时间量豁免同口径）。
    const its = arm.run.iterations;
    expect(its, `${task.id} dsh 臂迭代数 === 剧本轮数（step 分组，每 LLM 轮一迭代）`).toHaveLength(task.dsh.rounds.length);
    its.forEach((iter, i) => {
      expect(iter.index, `${task.id} dsh 迭代 ${i} index 0 基顺编号`).toBe(i);
      const tc = task.dsh.rounds[i]?.toolCall;
      if (tc === undefined || tc.name === "final_answer") {
        expect(iter.toolCalls, `${task.id} dsh 第 ${i} 轮（文本/final_answer 轮）⇒ 空迭代`).toEqual([]);
        return;
      }
      expect(iter.toolCalls.map((c) => c.toolName), `${task.id} dsh 第 ${i} 轮 toolName 对点剧本`).toEqual([tc.name]);
      const c = iter.toolCalls[0];
      expect(c, `${task.id} dsh 第 ${i} 轮调用锚点缺失`).toBeDefined();
      if (!c) return;
      expect(c.outcome, `${task.id} dsh 调用 ${tc.name} outcome 锚（锚值不变：govDeny⇒ERROR/否则OK）`).toBe(
        (task.dsh.govDeny ?? []).includes(tc.name) ? "ERROR" : "OK",
      );
      // W9-full 单翻：词表翻四态（侧表命中支 DENIED/BUDGET_EXCEEDED 有源即合法值）。
      expect(["OK", "DENIED", "ERROR", "BUDGET_EXCEEDED"], `${task.id} dsh outcome 词表四态`).toContain(c.outcome);
      expect(c.durationMs).toBeGreaterThanOrEqual(0);
      // W9-full 单翻：tc_ 形态许可——命中支 = 宿主 tc_ id，未命中支 = 帧 callId 原值；
      // 结构齿：DENIED/BUDGET_EXCEEDED 唯侧表可产 ⇒ 该两态下 toolCallId 必 tc_ 形态。
      expect(typeof c.toolCallId).toBe("string");
      if (c.outcome === "DENIED" || c.outcome === "BUDGET_EXCEEDED") {
        expect(c.toolCallId, `${task.id} dsh 四态值 ⇒ toolCallId 必 tc_ 形态`).toMatch(/^tc_/);
      }
    });
    // W9-lite 骨架锚②：B11 同源等值（ROLLOUT §6.5 验收判据）——run.total* === answer.stats
    // 对应桶（同一份帧流 fold 的两个载体）；两臂 token 账不互比维持。
    const buckets = stats!.tokenUsage as { uncachedInputTokens: number; outputTokens: number };
    expect(arm.run.totalInputTokens, `${task.id} run.totalInputTokens === stats.uncachedInputTokens（同源等值）`).toBe(buckets.uncachedInputTokens);
    expect(arm.run.totalOutputTokens, `${task.id} run.totalOutputTokens === stats.outputTokens（同源等值）`).toBe(buckets.outputTokens);
  }
}

/**
 * EMPTY 空块类豁免谓词（发车哨兵第 3 条「answer 含任务 marker」的唯一条件位）。
 *
 * 为何豁免是安全的——哨兵本意是防「压根没发车」（蓝图 risks #3：native-vs-native 假绿），
 * 不是防「答案为空」。空答案 ≠ 没发车：EMPTY 类（blocks:[] / 空 markdown / 空白软收尾）
 * 的答案结构上不可能携带 marker，强留哨兵等于判这类任务死刑。豁免后发车事实由以下
 * 互补证据链锁定（缺一即红，不比 marker 哨兵弱）：
 *   dsh 臂  ① stub.requests.length === 剧本轮数（HTTP wire 实证子进程真 spawn 真走完）；
 *           ② run.kernel === "EXTERNAL"（engine 分叉真返回，A4 锚定字面量）；
 *           ③ answer.stats.sessionStats.turns/steps 锚（A4 stats 对齐，证明 harness 真跑了轮次）；
 *           ④ wire 首请求体含本任务 id（豁免任务的 prompt 必含 id——A0 闸强制，
 *              证明子进程消费的是**本任务**输入而非旁路，顶替 marker 的「剧本身份」职能）。
 *   native 臂 ⑤ token 锚 100/50 × 轮数（ScriptedLlmClient 只有真消费剧本才记账）+
 *             迭代锚逐轮对点。
 * 双恰护栏（A0 闸）：「豁免位置位 ⇔ expect.answer 序列化后确无本任务 id」——
 * 给有 marker 的任务误置豁免位会红（谓词第二析取不成立 ⇒ 哨兵照常跑），
 * 给纯空答案漏置豁免位也会红（哨兵必败）。豁免面被锁死在 EMPTY 类，不可外溢。
 */
const markerSentinelExempt = (task: DualRunTask): boolean =>
  task.expect.skipMarkerSentinel === true && !JSON.stringify(task.expect.answer).includes(task.id);

/** 四面对账主入口。flags 标明每臂实际身份（A5 同臂复跑也过同一比对器）。 */
function compareArms(task: DualRunTask, x: ArmProducts, y: ArmProducts, flags: { x: "off" | "on"; y: "off" | "on" }): void {
  // ---- 发车哨兵（蓝图 risks #3）：按各臂实际身份锚定 ----
  const arms = [
    { label: "x", arm: x, flag: flags.x },
    { label: "y", arm: y, flag: flags.y },
  ];
  for (const { label, arm, flag } of arms) {
    if (flag === "on") {
      if (task.expect.dshZeroSpawn) {
        expect(arm.stubRequests.length, `${task.id} 反向哨兵：分叉前预检早退 ⇒ dsh 零 spawn`).toBe(0);
      } else {
        expect(
          arm.stubRequests.length,
          `${task.id} 哨兵：dsh 臂子进程必须真走完整剧本（wire 请求数 == 剧本轮数）`,
        ).toBe(task.dsh.rounds.length);
      }
    } else {
      expect(arm.stubRequests.length, `${task.id} 哨兵：native 臂不得触 stub wire`).toBe(0);
    }
    if (markerSentinelExempt(task)) {
      // EMPTY 类：marker 哨兵豁免（安全性论证见 markerSentinelExempt 注释），
      // dsh 臂改锚 wire 级替代证据——首请求体必含本任务 id（剧本身份顶替位）。
      if (flag === "on") {
        expect(
          JSON.stringify(arm.stubRequests[0]?.body ?? null),
          `${task.id} 豁免位替代哨兵：dsh wire 首请求体须含本任务 id（prompt 锚定剧本身份）`,
        ).toContain(task.id);
      }
    } else {
      expect(JSON.stringify(arm.answer), `${task.id} 哨兵：${label} 臂 answer 须含任务 marker`).toContain(task.id);
    }
  }

  // ---- A1 · Answer 结构逐字节（剥 stats + provenance 归一）----
  const div = task.expect.lengthDivergence;
  if (div) {
    // G3 分锚（§3 #9 设计取向差）：两臂各锚各的声明产物，不互比——
    // native 臂锚 = expect.answer 本位（软收尾原文）；dsh 臂锚 = div.dsh.answer（摘要头 + 截断前文）。
    // A5 同臂复跑两臂同 flag ⇒ 锚同一份，比对器噪声检查不受影响。
    expect(normalizeAnswer(x.answer), `${task.id} A1 分锚（x 臂）`).toEqual(
      normalizeAnswer((flags.x === "on" ? div.dsh.answer : task.expect.answer) as unknown as Json),
    );
    expect(normalizeAnswer(y.answer), `${task.id} A1 分锚（y 臂）`).toEqual(
      normalizeAnswer((flags.y === "on" ? div.dsh.answer : task.expect.answer) as unknown as Json),
    );
  } else {
    expect(normalizeAnswer(x.answer)).toEqual(normalizeAnswer(y.answer));
    expect(normalizeAnswer(x.answer)).toEqual(normalizeAnswer(task.expect.answer as unknown as Json));
  }

  // ---- A1b · structured 深等（G2 expectsSchema 任务对账面；非结构化任务两臂同 undefined 也逐值咬）----
  expect(x.structured, `${task.id} structured 双臂深等`).toEqual(y.structured);
  if (task.expect.structured !== undefined) {
    expect(x.structured, `${task.id} structured 须等于语料声明锚`).toEqual(task.expect.structured);
  }

  // ---- A2 · 拒绝口径（deny 类）----
  for (const { arm, flag } of arms) {
    if (flag !== "on") continue;
    for (const w of task.expect.denyWire ?? []) {
      const body = JSON.stringify(arm.stubRequests[w.requestIndex]?.body ?? null);
      expect(body, `${task.id} dsh 臂治理桥 deny 证据：requests[${w.requestIndex}] 须含 deny reason`).toContain(w.reason);
    }
  }
  if (task.cls === "deny_prefork") {
    expect(JSON.stringify(x.answer)).toContain("prov_skill_rule_check");
  } else if (task.cls.startsWith("deny_")) {
    expect(JSON.stringify(x.answer)).toContain("prov_post_check");
  }

  // ---- A3 · SSE 事件名序列 ----
  checkSseFace(task, x, y, flags);

  // ---- A4 · 审计逐字段 ----
  checkAuditFace(task, x, y, flags);
  checkArmAnchors(task, flags.x, x);
  checkArmAnchors(task, flags.y, y);

  // ---- A4b · audit 写入不变量（W5 块3：audit 写入不因内核选择而**隐性**分裂）----
  // 锚定形态（双向防漂）：
  //   native 臂 = 剧本里每个 load_skill tool_use 一行审计（toolName/outcome/input 逐点）；
  //   dsh 臂   = 恒零行（reassemble 零 IO，固有不对称 #4 的审计空壳维度——登记差异被锚成字面量，
  //              dsh 侧哪天开始写审计 = 未登记的语义变更 ⇒ 红；native 侧哪天丢行 = 审计丢失 ⇒ 红）；
  //   deny_prefork = 两臂恒零行（分叉前预检拒止 ⇒ 零执行痕迹——entitlement/治理拒止时点
  //              跨核一致的强形态：拒止早于一切可观测执行，kernel 选择不改变拒止时点）。
  // W8.5 翻锚（按任务维度，REC §2-A4b 修订）：语料声明 expect.auditRows 的任务（dr50-cm）
  //   走双臂真对账——两臂各行 toolName/outcome/input 逐点深等声明 + 行 id 钉 tc_ 形态
  //   （归一化为形态锚）；声明任务恰 1 条由 A0 闸钉死，未声明任务旧锚零放宽。
  {
    if (task.expect.auditRows) {
      const decl = task.expect.auditRows;
      for (const { label, arm } of arms) {
        expect(
          arm.auditRows.length,
          `${task.id} A4b：${label} 臂审计行数 == 语料声明行数（dr50-cm = 内层 qo 步 + 外层 workflow 行）`,
        ).toBe(decl.length);
        arm.auditRows.forEach((row, i) => {
          const anchor = decl[i];
          expect(anchor, `${task.id} A4b：第 ${i} 行缺声明锚点`).toBeDefined();
          if (!anchor) return;
          expect(row.id, `${task.id} A4b：${label} 臂第 ${i} 行 id 须 tc_ 形态（归一化形态锚）`).toMatch(/^tc_/);
          expect(row.toolName, `${task.id} A4b：${label} 臂第 ${i} 行 toolName`).toBe(anchor.toolName);
          expect(row.outcome, `${task.id} A4b：${label} 臂第 ${i} 行 outcome`).toBe(anchor.outcome);
          expect(row.input, `${task.id} A4b：${label} 臂第 ${i} 行 input 与声明逐值等`).toEqual(anchor.input);
        });
      }
    } else {
    const expectedLoadSkillCalls: unknown[] = [];
    for (const turn of task.native.turns) {
      if (typeof turn !== "object" || !("content" in turn)) continue;
      for (const b of turn.content) {
        if (b.type === "tool_use" && b.name === "load_skill") expectedLoadSkillCalls.push(b.input);
      }
    }
    for (const { label, arm, flag } of arms) {
      if (flag === "on") {
        expect(arm.auditRows, `${task.id} A4b：dsh 臂 toolCalls 审计行恒零（reassemble 纯重组装零 IO）`).toEqual([]);
      } else {
        expect(
          arm.auditRows.length,
          `${task.id} A4b：native 臂审计行数 == 剧本 load_skill 轮数（每轮一行，不多不少）`,
        ).toBe(expectedLoadSkillCalls.length);
        arm.auditRows.forEach((row, i) => {
          expect(row.toolName, `${task.id} A4b：第 ${i} 行 toolName`).toBe("load_skill");
          expect(row.outcome, `${task.id} A4b：第 ${i} 行 outcome`).toBe("OK");
          expect(row.input, `${task.id} A4b：第 ${i} 行 input 与剧本 load_skill 入参逐值等`).toEqual(expectedLoadSkillCalls[i]);
        });
      }
      void label;
    }
    }
  }

  // ---- W8副（#54）· MCP 可见性 name-set parity（mcp 语料任务限定；不咬 description 字节——REC §3 #13）----
  if (task.mcp) {
    const mcp = task.mcp;
    const extras = mcp.dshExtraTools ?? [];
    const nativeExtras = mcp.nativeExtraTools ?? [];
    const yRaw = y.visibleToolNames ?? [];
    const xRaw = x.visibleToolNames ?? [];
    // 反向钉：声明的 poc 夹具件必须真在 dsh 原始集（豁免件消失即红——防豁免名单掩盖真实漂移）。
    // 仅 y 臂确为 dsh（flag on）时钉；A5 同臂复跑 off/off 时 y 是 native 臂，无夹具件可钉。
    if (flags.y === "on") {
      for (const e of extras) {
        expect(yRaw, `${task.id} name-set：声明豁免件 ${e} 须真在 dsh 臂可见集（豁免不得掩盖消失）`).toContain(e);
      }
    }
    // 对称反向钉（native 侧）：load_skill 类 native 固有额外面必须真在 native 原始集
    // （engine.ts:811 无条件挂 vs setup-spec.ts:251 条件挂——预存不对称，REC 登记）。
    // 仅 x 臂确为 native（flag off）时钉。
    if (flags.x === "off") {
      for (const e of nativeExtras) {
        expect(xRaw, `${task.id} name-set：声明豁免件 ${e} 须真在 native 臂可见集（豁免不得掩盖消失）`).toContain(e);
      }
    }
    const xSet = xRaw.filter((n) => !(flags.x === "off" && nativeExtras.includes(n))).sort();
    const ySet = yRaw.filter((n) => !(flags.y === "on" && extras.includes(n))).sort();
    expect(ySet, `${task.id} W8副 name-set parity：双臂模型可见工具名集合（dsh 剥 poc 夹具件后）逐序等`).toEqual(xSet);
    // 防「空集对空集」假绿 + 锚收窄真发生：mcp__ 子集恰等语料声明的滤后留存名
    // （宿主 expandAgentTools 同口径：裸名/全名双形态匹配）。
    const expectedMcp = mcp.tools
      .filter(
        (tool) =>
          !mcp.toolFilter ||
          mcp.toolFilter.includes(tool.name) ||
          mcp.toolFilter.includes(`mcp__${mcp.serverName}__${tool.name}`),
      )
      .map((tool) => `mcp__${mcp.serverName}__${tool.name}`)
      .sort();
    expect(
      xSet.filter((n) => n.startsWith("mcp__")),
      `${task.id} name-set 防空集假绿：x 臂 mcp__ 子集须恰为语料滤后留存名`,
    ).toEqual(expectedMcp);
  }

  // ---- sketch / outcome parity ----
  expect(x.sketch).toEqual(y.sketch);
  if (div) {
    // G3 分锚：outcome/degraded 两臂各锚各的（native 常量锚 ANSWERED/无 degraded；
    // dsh 锚语料声明 BUDGET_EXHAUSTED/degraded{BUDGET_EXHAUSTED}）。
    expect(x.outcome, `${task.id} outcome 分锚（x 臂）`).toBe(flags.x === "on" ? div.dsh.outcome : "ANSWERED");
    expect(y.outcome, `${task.id} outcome 分锚（y 臂）`).toBe(flags.y === "on" ? div.dsh.outcome : "ANSWERED");
    expect(x.degraded, `${task.id} degraded 分锚（x 臂）`).toEqual(flags.x === "on" ? div.dsh.degraded : undefined);
    expect(y.degraded, `${task.id} degraded 分锚（y 臂）`).toEqual(flags.y === "on" ? div.dsh.degraded : undefined);
  } else {
    expect(x.outcome).toBe(y.outcome);
  }
}

// ---------------------------------------------------------------------------
// 套件
// ---------------------------------------------------------------------------

describe("WO-DSH-E2E · §16.2 L1 双跑字节比对（65 任务）", () => {
  it("A0 语料自检：构成 / 四维覆盖 / gated 槽在册", () => {
    expect(DUALRUN_CORPUS.length).toBe(65);
    expect(new Set(DUALRUN_CORPUS.map((t) => t.id)).size).toBe(65);
    // W8副：MCP name-set parity 任务恰一条（dr50-cl；新增 mcp 任务须同步本钉与 REC 登记）。
    expect(DUALRUN_CORPUS.filter((t) => t.mcp !== undefined).length).toBe(1);
    // W8.5：workflow 反向对拍任务恰一条（dr50-cm；新增 workflow 任务须同步本钉与 REC 登记）。
    expect(DUALRUN_CORPUS.filter((t) => t.workflow !== undefined).length).toBe(1);
    // W8.5：A4b 翻锚声明面恰一处，且必挂在 workflow 任务上（防 auditRows 声明外溢到旧锚任务）。
    const auditDeclared = DUALRUN_CORPUS.filter((t) => t.expect.auditRows !== undefined);
    expect(auditDeclared.length).toBe(1);
    expect(auditDeclared[0]!.workflow, "A4b 翻锚声明必须挂在 workflow 任务上").toBeDefined();
    const deny = DUALRUN_CORPUS.filter((t) => t.cls.startsWith("deny_"));
    expect(deny.length).toBeGreaterThanOrEqual(10);
    expect(deny.filter((t) => t.cls === "deny_pre").length).toBeGreaterThanOrEqual(1);
    expect(deny.filter((t) => t.cls === "deny_mid").length).toBeGreaterThanOrEqual(1);
    expect(deny.filter((t) => t.cls === "deny_all").length).toBeGreaterThanOrEqual(1);
    expect(DUALRUN_CORPUS.filter((t) => t.source === "scenario").length).toBeGreaterThanOrEqual(20);
    expect(DUALRUN_CORPUS.filter((t) => t.prompt.length >= 4096).length).toBeGreaterThanOrEqual(4);
    // 工具轮 0/1/3 + 多轮 5 往返（native turns 数 = LLM 往返数）
    const turnsOf = (t: DualRunTask) => t.native.turns.length;
    expect(DUALRUN_CORPUS.some((t) => turnsOf(t) === 1)).toBe(true);
    expect(DUALRUN_CORPUS.some((t) => turnsOf(t) === 2)).toBe(true);
    expect(DUALRUN_CORPUS.some((t) => turnsOf(t) === 5)).toBe(true);
    expect(DUALRUN_CORPUS.some((t) => t.native.turns.filter((tn) => typeof tn === "object" && tn.content.some((b) => b.type === "tool_use" && b.name === "load_skill")).length === 3)).toBe(true);
    // provenance 形态 + 多块形态
    expect(DUALRUN_CORPUS.some((t) => (t.expect.answer.provenance?.length ?? 0) > 0)).toBe(true);
    expect(DUALRUN_CORPUS.some((t) => t.expect.answer.blocks.some((b) => b.type === "table"))).toBe(true);
    // A5 子集 ∈ 语料
    for (const id of A5_SUBSET) expect(DUALRUN_CORPUS.some((t) => t.id === id)).toBe(true);
    // 答案块经生产 scanBlocks 零裸数（unverifiedNumerics:false 锚的单源护栏）
    for (const t of DUALRUN_CORPUS) {
      expect(scanBlocks(t.expect.answer.blocks), `${t.id} 答案块含裸数，unverifiedNumerics 锚会漂`).toBe(false);
    }
    // EMPTY 豁免位双恰护栏：「豁免位生效 ⇔ expect.answer 确无本任务 id」——
    // 给有 marker 的任务误置豁免位 ⇒ 谓词不成立 ⇒ 哨兵照常跑（此断言同红，双保险）；
    // 给纯空答案漏置豁免位 ⇒ 此断言红。豁免任务的 prompt 必含 id（wire 替代哨兵的前提）。
    for (const t of DUALRUN_CORPUS) {
      const carriesMarker = JSON.stringify(t.expect.answer).includes(t.id);
      expect(
        markerSentinelExempt(t),
        `${t.id} 豁免位双恰：有 marker 不得豁免、纯空答案必须置豁免位`,
      ).toBe(!carriesMarker);
      if (markerSentinelExempt(t)) {
        expect(t.prompt, `${t.id} 豁免任务的 prompt 必含本任务 id（wire 首请求替代哨兵的锚源）`).toContain(t.id);
      }
    }
    expect(GATED_SLOTS.length).toBe(2);
  });

  for (const task of DUALRUN_CORPUS) {
    it(
      `${task.id} [${task.cls}] 双臂四面对账`,
      { timeout: 180_000 },
      async () => {
        const off = await runArm(task, "off");
        const on = await runArm(task, "on");
        compareArms(task, off, on, { x: "off", y: "on" });
      },
    );
  }

  describe("A5 确定性（同臂连跑两遍，比对器不得把噪声当差集）", () => {
    for (const id of A5_SUBSET) {
      const task = DUALRUN_CORPUS.find((t) => t.id === id)!;
      it(`${id} 双臂各复跑一遍过同一比对器`, { timeout: 300_000 }, async () => {
        const off1 = await runArm(task, "off");
        const off2 = await runArm(task, "off");
        compareArms(task, off1, off2, { x: "off", y: "off" });
        const on1 = await runArm(task, "on");
        const on2 = await runArm(task, "on");
        compareArms(task, on1, on2, { x: "on", y: "on" });
      });
    }
  });

  // -------------------------------------------------------------------------
  // W5 块1 · A3c SSE 事件族覆盖矩阵
  //
  // 15 族 = KNOWN_EVENTS 十名（前端 useTaskStream.ts:29-38 订阅面，单源经 N2 字面量锚）
  // ∪ ALLOWED_PSEUDO_TYPES 五名（payload.type 伪步族，N2 单源）。矩阵每行声明一族在本
  // 驱动级（engine.runRegisteredAgent 双臂 + answer.final 镜像）的覆盖真相：
  //   triggered   —— 至少一条语料真触发（本 it 自跑声明任务实证，精确族集断言）；
  //   unreachable —— 本驱动级物理不可达，原因四类闭枚举，逐行登记进 REC §2-A3 补表
  //                  （本 it 文本锚 REC 防登记漂移），不冒充覆盖。
  // -------------------------------------------------------------------------

  /** 不可达原因闭枚举（加类须评审；中文标签须与 REC §2-A3 补表逐字一致）。 */
  const UNREACHABLE_REASONS = {
    /** 编排层事件：orchestrator 在 runRegisteredAgent 之外发射（task.accepted 等七名），本驱动级够不着。 */
    ORCHESTRATOR_LEVEL: "编排层事件·本驱动级不可达",
    /** 真工具步族：语料两臂同用 meta 剧本保 parity（固有不对称 #3），真工具 SSE 对拍物理不可达。
     *  W8.5 起暂无引用行（step.started/step.completed 两行已翻 triggered·dr50-cm）——闭枚举
     *  保留原位（删枚举值 = 矩阵结构变更，须评审；留着不咬任何断言）。 */
    REAL_TOOL_ONLY: "真工具步族·meta-only 语料不可达",
    /** harness 内部决策：压缩由子进程上下文压力触发，剧本面无确定性通道（mapper 分支由 N2 A6b/A3/A4 单测钉死）。 */
    HARNESS_INTERNAL: "harness 内部决策·剧本面无确定性触发通道",
    /** meta skip 销账项：D-7 双臂同不产 meta 步事件，绿态恒不出现；出现即差集反咬 + 收缩过滤后序列不等（M10 咬点）。 */
    META_SKIP_GREEN_ABSENT: "meta-skip 销账项·绿态恒不出现",
  } as const;
  type UnreachableReason = keyof typeof UNREACHABLE_REASONS;

  interface FamilyRow {
    /** 族名（KNOWN_EVENTS 事件名 或 ALLOWED_PSEUDO_TYPES 伪步类型名）。 */
    name: string;
    /** seqOf 族串（事件名:伪类型）——观测面对账单元。 */
    family: string;
    status:
      | { kind: "triggered"; taskId: string; expect: { off: string[]; on: string[] } }
      | { kind: "unreachable"; reason: UnreachableReason };
  }

  const EVENT_FAMILY_MATRIX: readonly FamilyRow[] = [
    { name: "task.accepted", family: "task.accepted:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    { name: "routing.completed", family: "routing.completed:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    { name: "clarification.required", family: "clarification.required:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    { name: "coordinator.planned", family: "coordinator.planned:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    // W8.5 翻锚：dr50-cm 起真工具步族不再不可达——nested workflow 步事件（qo/ra）两臂同
    // executor 码真触发（dsh 臂经宿主端点 workflowCtx.emit 路径，emit 出处差 REC §3 W8.5 登记）。
    // dsh 臂观测集另含帧流 mapper 为 workflow 调用自身发的两条（step.started:workflow_dr50cm +
    // status 形 step.completed:）——native WORKFLOW 分支无该发射点，A3 对账面声明制剥除，
    // 本矩阵按原始观测如实登记。dsh 臂 step.completed:agent_narration 来自末轮 rTx 文本轮（既有族）。
    {
      name: "step.started",
      family: "step.started:query_objects",
      status: {
        kind: "triggered",
        taskId: "dr50-cm",
        expect: {
          off: [
            "answer.final:",
            "step.completed:query_objects",
            "step.completed:render_answer",
            "step.started:query_objects",
            "step.started:render_answer",
          ],
          on: [
            "answer.final:",
            "step.completed:",
            "step.completed:agent_narration",
            "step.completed:query_objects",
            "step.completed:render_answer",
            "step.started:query_objects",
            "step.started:render_answer",
            "step.started:workflow_dr50cm",
          ],
        },
      },
    },
    {
      name: "step.completed",
      family: "step.completed:query_objects",
      status: {
        kind: "triggered",
        taskId: "dr50-cm",
        expect: {
          off: [
            "answer.final:",
            "step.completed:query_objects",
            "step.completed:render_answer",
            "step.started:query_objects",
            "step.started:render_answer",
          ],
          on: [
            "answer.final:",
            "step.completed:",
            "step.completed:agent_narration",
            "step.completed:query_objects",
            "step.completed:render_answer",
            "step.started:query_objects",
            "step.started:render_answer",
            "step.started:workflow_dr50cm",
          ],
        },
      },
    },
    {
      name: "answer.final",
      family: "answer.final:",
      status: {
        kind: "triggered",
        taskId: "dr50-aa",
        expect: { off: ["answer.final:"], on: ["step.completed:agent_narration", "answer.final:"] },
      },
    },
    { name: "action_draft.created", family: "action_draft.created:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    { name: "task.failed", family: "task.failed:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    { name: "task.cancelled", family: "task.cancelled:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    {
      name: "agent_narration",
      family: "step.completed:agent_narration",
      status: {
        kind: "triggered",
        taskId: "dr50-aa",
        expect: { off: ["answer.final:"], on: ["step.completed:agent_narration", "answer.final:"] },
      },
    },
    {
      name: "agent_think",
      family: "step.completed:agent_think",
      status: {
        kind: "triggered",
        taskId: "dr50-ck",
        expect: {
          off: ["answer.final:"],
          on: ["step.completed:agent_think", "step.completed:agent_narration", "answer.final:"],
        },
      },
    },
    { name: "compaction", family: "step.started:compaction|step.completed:compaction", status: { kind: "unreachable", reason: "HARNESS_INTERNAL" } },
    { name: "final_answer", family: "step.started:final_answer|step.completed:final_answer", status: { kind: "unreachable", reason: "META_SKIP_GREEN_ABSENT" } },
    { name: "load_skill", family: "step.started:load_skill|step.completed:load_skill", status: { kind: "unreachable", reason: "META_SKIP_GREEN_ABSENT" } },
  ];

  it("A3c 事件族覆盖矩阵：15 族每族真触发或登记不可达，不冒充覆盖", { timeout: 300_000 }, async () => {
    // ① 完备性：矩阵恰 = KNOWN_EVENTS ∪ ALLOWED_PSEUDO_TYPES（单源字面量漂移 ⇒ 此断言红）。
    const declared = EVENT_FAMILY_MATRIX.map((r) => r.name);
    expect(new Set(declared).size, "矩阵族名零重复").toBe(declared.length);
    expect([...declared].sort()).toEqual([...KNOWN_EVENTS, ...ALLOWED_PSEUDO_TYPES].sort());

    // ② 触发行真触发：按 taskId 分组自跑双臂，观测族集（Set 语义）与声明逐组精确等——
    //    「精确等」是双向咬：声明的族没出现 ⇒ 红（冒充触发）；出现声明外的族 ⇒ 红（事件面漂移）。
    const triggeredRows = EVENT_FAMILY_MATRIX.filter(
      (r): r is FamilyRow & { status: Extract<FamilyRow["status"], { kind: "triggered" }> } => r.status.kind === "triggered",
    );
    const byTask = new Map<string, typeof triggeredRows>();
    for (const r of triggeredRows) {
      const group = byTask.get(r.status.taskId) ?? [];
      group.push(r);
      byTask.set(r.status.taskId, group);
    }
    for (const [taskId, rows] of byTask) {
      for (const r of rows) {
        expect(r.status.expect, `矩阵同任务 ${taskId} 的各行 expect 声明必须一致`).toEqual(rows[0]!.status.expect);
        expect(r.status.expect.off.includes(r.family) || r.status.expect.on.includes(r.family),
          `矩阵行 ${r.name} 的族串 ${r.family} 须在其声明的观测集内`).toBe(true);
      }
      const task = DUALRUN_CORPUS.find((t) => t.id === taskId);
      expect(task, `矩阵触发任务 ${taskId} 须在语料内`).toBeDefined();
      const off = await runArm(task!, "off");
      const on = await runArm(task!, "on");
      expect([...new Set(seqOf(off.events))].sort(), `${taskId} native 臂观测族集 == 矩阵声明`).toEqual(
        [...rows[0]!.status.expect.off].sort(),
      );
      expect([...new Set(seqOf(on.events))].sort(), `${taskId} dsh 臂观测族集 == 矩阵声明`).toEqual(
        [...rows[0]!.status.expect.on].sort(),
      );
    }

    // ③ 不可达行登记锚：原因 ∈ 闭枚举 ∧ REC §2-A3 补表逐行登记（族名 + 原因中文标签文本锚）。
    const rec = readFileSync(fileURLToPath(new URL("./fixtures/dualrun-corpus/RECONCILIATION.md", import.meta.url)), "utf8");
    const a3Section = rec.slice(rec.indexOf("### A3"), rec.indexOf("### A4"));
    expect(a3Section.length, "REC §2-A3 节须存在").toBeGreaterThan(0);
    for (const r of EVENT_FAMILY_MATRIX) {
      if (r.status.kind !== "unreachable") continue;
      expect(
        a3Section.includes(r.name) && a3Section.includes(UNREACHABLE_REASONS[r.status.reason]),
        `REC §2-A3 补表须登记不可达族 ${r.name}（原因 ${r.status.reason} = ${UNREACHABLE_REASONS[r.status.reason]}）`,
      ).toBe(true);
    }

    // ④ META_SKIP 反咬机制锚（静态）：final_answer/load_skill 恒在全量白名单但恒不在收缩集——
    //    skip 破损时它们以差集出现（白名单内可过 diff 断言）但收缩过滤滤不掉 ⇒ 序列不等红（M10 咬点不动）。
    for (const meta of ["final_answer", "load_skill"]) {
      expect(ALLOWED_PSEUDO_TYPES).toContain(meta);
      expect(SHRUNK_PSEUDO_TYPES).not.toContain(meta);
    }
  });

  it("gated 槽鸣报：角色路/场景路 STALL_LOOP 覆盖维持 gated（缝已落线；缺口=编排层驱动级+触发通道缺，REC §3 #7 裁决口径）", () => {
    for (const g of GATED_SLOTS) {
      console.warn(`GATED ${g.id}（${g.path} ${g.scenario}）：${g.gate}`);
    }
    expect(GATED_SLOTS.map((g) => g.path)).toEqual(["runRolePathB", "runSceneAgent"]);
  });
});
