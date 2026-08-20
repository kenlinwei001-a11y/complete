/**
 * WO-DSH-E2E · §16.2 L2 真链路三实（真 LLM + 真规则 + 真 MCP 一跳）组合套件。
 *
 * 覆盖断言（node-plan-E2E.md L2.A1-A4 + 派单裁决 2026-08-19）：
 *   L2.A1  真 LLM（engine 分叉全链）：providerDirectory 注入形态（A3 先例）——provider
 *          kind=openai_compatible、baseUrl/credential 取自 KIMI_BASE_URL/KIMI_API_KEY env、
 *          model=kimi-k3；runRegisteredAgent 真分叉 ⇒ outcome ANSWERED ∧ answer.stats
 *          .tokenUsage.uncachedInputTokens>0（真模型回包 token 痕迹）∧ 全结果面零 key 子串。
 *          env 缺失 ⇒ describe.skipIf 跳过并打印原因（A14 门控先例）。
 *   L2.A2  真规则：cordis.l2.yml（governance mode:http）→ 新裁决端点
 *          POST /b/v1/governance/adjudicate（包 deps.dataCore.rules.evaluate）。
 *          deny 臂：ruleKeys=["C03"] + 工具实参 {demandDelta:0.9} ⇒ BLOCK ⇒ 工具体不执行、
 *          reason 含真 verdict 文案且不含 "mock rule engine" 前缀；allow 臂：{demandDelta:0.1}
 *          ⇒ 工具真执行。端点→rules.evaluate 真跳经调用计数机器核。
 *   L2.A3  真 MCP：SetupSpec.mcpServers 挂 mock-mcp-tenant 夹具（stdio 真子进程）⇒
 *          whoami 应答携租户标记 whoami:t1 ∧ pidFile 计数=1 ∧ 审计工具名 mcp__erp__whoami。
 *   L2.A4  组合臂（同一会话 真 LLM × 真规则 × 真 MCP）：runner 级一会话——env 注入 =
 *          真 resolveConnectionFacts 产出的 KIMI 连接事实 + PLATFORM_GOV_URL/TOKEN 指真
 *          端点；kimi-k3 真调 whoami 后 final_answer 收尾 ⇒ 三实同帧证据。
 *   L2.A5  凭据/配置变异负向两臂（mutation 靶的常设红位形态）：
 *          ⑤a PLATFORM_GOV_URL 指已关闭端口 ⇒ fail-closed deny（reason 含 unreachable/
 *          fail-closed），工具体不执行——governance url 错 ⇒ 红位；
 *          ⑤b 缺 PLATFORM_LLM_API_KEY ⇒ MISSING_CREDENTIAL 含 env 引用名、stub 零请求
 *          （fail 在出网之前）——凭据缺失 ⇒ 红位。
 *
 * 凭据红线：真 key 只经 env 注入进子进程，绝不写仓/日志/证据；凡真跳臂断言
 * JSON.stringify(events/result) 不含 key 子串（N1 A5 形态在穿透路径复核）。
 *
 * 形态声明（对账口径，不冒充）：MCP/组合臂为 runner 级直驱——engine 分叉的
 * buildSessionSetup 不带 mcpServers（engine.ts 分叉段复核，另立 WO 修复）；LLM 臂走
 * engine 分叉全链（A3 形态）。规则臂 LLM 用 stub（裁决对象不是 LLM 智能，是规则真跳）。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { LlmProvider, PurposeBinding } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import { runDshAgent, type DshSessionEvent, type DshSetupSpec } from "../src/dsh-runtime/index.js";
import { LlmSettings } from "../src/llm/providers.js";
import { loadConfig } from "../src/config.js";

// apps/agentcore/test/ → 仓根 = ../../../
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = join(REPO_ROOT, "packages/dsh-harness");
const MCP_FIXTURE = join(HARNESS_DIR, "test/fixtures/mock-mcp-tenant.mjs");
/** L2 专档：生产档内容 + governance mode:http（url/token 由 env 注入，不落盘）。 */
const CORDIS_L2 = "cordis.l2.yml";

const MODEL_ID = "kimi-k3";
const PROVIDER_ID = "llmp_kimi_l2";
const KIMI_KEY = process.env.KIMI_API_KEY;
const KIMI_BASE = process.env.KIMI_BASE_URL;
const KIMI_READY = typeof KIMI_KEY === "string" && KIMI_KEY.length > 0 && typeof KIMI_BASE === "string" && KIMI_BASE.length > 0;
if (!KIMI_READY) {
  console.info("[dsh-e2e-real-triad] KIMI_API_KEY/KIMI_BASE_URL 未注入：L2.A1/L2.A4 真跳臂 skip（A14 门控先例）");
}
/** 显式假 key（stub 臂用；形如真 key 但绝非凭据，红线断言的扫描对象）。 */
const FAKE_KEY = "l2-e2e-fake-key-00000000000000000000000000000000";
/** 服务间凭据（测试值）：端点 requireServiceToken 与插件 x-service-token 头对表。 */
const SERVICE_TOKEN = "l2-e2e-service-token-0000000000000000";

const STUB_TIMEOUT = 90_000;
const REAL_TIMEOUT = 180_000;

// ---------------------------------------------------------------------------
// 本地 stub OpenAI-completions 端点（剧本化 SSE；A3 同款形态）
// ---------------------------------------------------------------------------

interface StubRequest {
  authorization: string | undefined;
  model: unknown;
  body: unknown;
}

interface StubRound {
  toolCall?: { name: string; arguments: string };
  text?: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function roundToSse(round: StubRound): string {
  const base = { id: "chatcmpl-stub", object: "chat.completion.chunk", created: 1, model: MODEL_ID };
  let out = "";
  if (round.toolCall) {
    out += sseChunk({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: null,
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: round.toolCall.name, arguments: "" } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    out += sseChunk({
      ...base,
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: round.toolCall.arguments } }] },
          finish_reason: null,
        },
      ],
    });
    out += sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: round.usage });
  } else {
    out += sseChunk({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: round.text ?? "" }, finish_reason: null }] });
    out += sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: round.usage });
  }
  out += "data: [DONE]\n\n";
  return out;
}

async function startStubOpenAi(rounds: StubRound[]): Promise<{ url: string; requests: StubRequest[]; close: () => Promise<void> }> {
  const requests: StubRequest[] = [];
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      requests.push({ authorization: req.headers.authorization, model: (body as { model?: unknown })?.model, body });
      const round = rounds[requests.length - 1];
      if (!round) {
        res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "stub script exhausted" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "close" });
      res.end(roundToSse(round));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** 取一个「确定已关闭」的端口（开过即关，OS 不会立即复用分给别的监听者）。 */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

const USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };
const FINAL_ANSWER_SCHEMA = {
  type: "object",
  properties: { blocks: { type: "array" }, provenance: { type: "array" } },
  required: ["blocks", "provenance"],
};
const finalAnswerRound = (text: string): StubRound => ({
  toolCall: { name: "final_answer", arguments: JSON.stringify({ blocks: [{ type: "text", markdown: text }], provenance: [] }) },
  usage: USAGE,
});

// ---------------------------------------------------------------------------
// 共享组态件
// ---------------------------------------------------------------------------

/** runner opts.env 注入形态（= engine 分叉经 resolveConnectionFacts 产出的连接事实注入，A3 注释口径）。 */
function platformEnv(baseUrl: string, key?: string): Record<string, string> {
  return {
    PLATFORM_LLM_API: "openai-completions",
    PLATFORM_LLM_BASE_URL: baseUrl,
    PLATFORM_LLM_MODEL: MODEL_ID,
    PLATFORM_LLM_CONTEXT_WINDOW: "131072",
    ...(key === undefined ? {} : { PLATFORM_LLM_API_KEY: key }),
  };
}

/** mock-mcp-tenant 夹具的 DshMcpServerSpec（N4 stdioCfg 形态：marker=租户标记，pidFile 计数锚）。 */
function mcpSpec(marker: string, pidFile: string): NonNullable<DshSetupSpec["mcpServers"]>[number] {
  return {
    transport: "stdio",
    serverName: "erp",
    command: process.execPath,
    args: [MCP_FIXTURE, marker, pidFile],
    toolCallTimeoutMs: 5000,
    failOnStartupError: true, // 挂载 resolve ⇒ 首连+首轮工具同步已完成
    reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 1 },
  };
}

const BASE_SETUP: Pick<DshSetupSpec, "tenantId" | "persona" | "finalAnswer"> = {
  tenantId: "t1",
  persona: "l2 e2e real triad",
  finalAnswer: { description: "终止工具（L2 e2e）", schema: FINAL_ANSWER_SCHEMA },
};

const GOV_C03: DshSetupSpec["governance"] = {
  ruleBindings: { ruleKeys: ["C03"], mode: "PRE_CHECK" },
  scopeObjectTypes: [],
};

/** Kimi provider 目录注入形态（A3 stubDirectory 先例；连接事实全取真 env）。 */
function kimiDirectory(): unknown {
  const provider: LlmProvider = {
    id: PROVIDER_ID,
    tenantId: "platform",
    name: "L2 Kimi Provider",
    kind: "openai_compatible",
    baseUrl: KIMI_BASE as string,
    models: [{ modelId: MODEL_ID, displayName: "Kimi K3", capabilities: { tools: true, structuredOutput: true, maxContext: 131072 } }],
    status: "ACTIVE",
    hasApiKey: true,
  };
  const binding = { providerId: PROVIDER_ID, modelId: MODEL_ID } as PurposeBinding;
  return {
    provider: async (_tenantId: string, id: string) => (id === PROVIDER_ID ? provider : undefined),
    credential: async () => KIMI_KEY,
    bindingFor: async (_tenantId: string, purpose: string) => (purpose === "agent" ? binding : undefined),
  };
}

/** 真 resolveConnectionFacts 解析链（A6 形态）→ runner env 注入（engine 分叉映射同款）。 */
async function kimiPlatformEnv(): Promise<Record<string, string>> {
  const settings = new LlmSettings({} as never, loadConfig({} as NodeJS.ProcessEnv), kimiDirectory() as never);
  const facts = await settings.resolveConnectionFacts(`dcp:${PROVIDER_ID}:${MODEL_ID}`, "t1");
  expect(facts.modelId).toBe(MODEL_ID); // dcp: 前缀已剥（Ruling A wire spec 形态）
  return {
    PLATFORM_LLM_API: facts.kind === "anthropic" ? "anthropic-messages" : "openai-completions",
    ...(facts.baseUrl ? { PLATFORM_LLM_BASE_URL: facts.baseUrl } : {}),
    PLATFORM_LLM_MODEL: facts.modelId,
    ...(facts.apiKey ? { PLATFORM_LLM_API_KEY: facts.apiKey } : {}),
    ...(facts.contextWindow ? { PLATFORM_LLM_CONTEXT_WINDOW: String(facts.contextWindow) } : {}),
  };
}

/** 真 listen 的测试 app（harness 子进程经 127.0.0.1 真 HTTP 打裁决端点）。 */
async function startGovApp(opts?: { providerDirectory?: unknown }): Promise<{
  t: TestApp;
  govUrl: string;
  evalCalls: { ruleIds: string[] | "ALL_APPLICABLE"; payload: unknown }[];
  close: () => Promise<void>;
}> {
  const t = await createTestApp({
    env: { SERVICE_TOKEN },
    ...(opts?.providerDirectory ? { providerDirectory: opts.providerDirectory as never } : {}),
  });
  // 端点→rules.evaluate 真跳的机器核：包装 mock 实例方法计调用（不动实现）。
  const evalCalls: { ruleIds: string[] | "ALL_APPLICABLE"; payload: unknown }[] = [];
  const orig = t.dataCore.rules.evaluate.bind(t.dataCore.rules);
  t.dataCore.rules.evaluate = (async (_ctx: unknown, ruleIds: string[] | "ALL_APPLICABLE", payload: unknown) => {
    evalCalls.push({ ruleIds, payload });
    return orig(_ctx as never, ruleIds, payload);
  }) as typeof t.dataCore.rules.evaluate;
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = t.app.server.address() as AddressInfo;
  return {
    t,
    govUrl: `http://127.0.0.1:${port}/b/v1/governance/adjudicate`,
    evalCalls,
    close: async () => {
      await t.app.close();
    },
  };
}

const eventsWire = (events: readonly DshSessionEvent[], result: unknown): string =>
  JSON.stringify(events) + JSON.stringify(result);

/** 真 LLM 臂网络抖动重试一次再定性（派单纪律）；断言在最后一次跑里执行。 */
async function runRealOnce<T>(fn: () => Promise<T>, ok: (out: T) => boolean): Promise<T> {
  const first = await fn();
  if (ok(first)) return first;
  return fn();
}

// ---------------------------------------------------------------------------
// L2.A1 · 真 LLM（engine 分叉全链；env 门控）
// ---------------------------------------------------------------------------

const CTX = { tenantId: TENANT, userId: "u", roles: ["planner"] };

async function makeBareAgent(t: TestApp): Promise<string> {
  const agent = {
    id: "agt_l2_real_llm",
    tenantId: TENANT,
    key: "l2_real_llm",
    version: 1,
    name: "L2 Real LLM Agent",
    description: "l2 e2e",
    model: "",
    systemPrompt: "你是 L2 e2e 测试助手。",
    tools: [],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: [] },
    status: "PUBLISHED",
  } as const;
  await t.repos.agents.insert(agent as never);
  return agent.id;
}

describe.skipIf(!KIMI_READY)("L2.A1 · 真 LLM：engine 分叉 → 绑定矩阵解析 → env 注入 → 真 Kimi 端点", () => {
  it(
    "runRegisteredAgent 真分叉 ⇒ ANSWERED ∧ 真 token 痕迹（stats.tokenUsage）∧ 全面零 key 子串",
    { timeout: REAL_TIMEOUT },
    async () => {
      const prevHarnessDir = process.env.DSH_HARNESS_DIR;
      const prevHarness = process.env.DSH_HARNESS;
      process.env.DSH_HARNESS_DIR = HARNESS_DIR;
      process.env.DSH_HARNESS = "1"; // engine 守卫直读 process.env（D3 休眠门判据形态）
      let t: TestApp | undefined;
      try {
        t = await createTestApp({ providerDirectory: kimiDirectory() as never });
        const agentId = await makeBareAgent(t);
        const run = () =>
          t!.deps.engine.runRegisteredAgent({
            taskId: "task_l2_a1",
            agentId,
            version: 1,
            prompt:
              "直接调用 final_answer 工具收尾，" +
              '参数严格使用这个 JSON 形态（不要添加任何其他键）：{"blocks":[{"type":"text","markdown":"L2 真跳"}],"provenance":[]}。',
            ctx: CTX,
            nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
            emit: async () => {},
          });
        const result = await runRealOnce(run, (r) => r.outcome === "ANSWERED");
        expect(result.outcome).toBe("ANSWERED");
        // 真跳证据：answer.stats（N2·D-2 fold）携带真模型 token 账——stub/剧本给不出非零真值口径。
        const stats = (result.answer as { stats?: { tokenUsage?: { uncachedInputTokens: number; outputTokens: number } } }).stats;
        expect(stats?.tokenUsage).toBeDefined();
        expect(stats!.tokenUsage!.uncachedInputTokens).toBeGreaterThan(0);
        expect(stats!.tokenUsage!.outputTokens).toBeGreaterThan(0);
        console.info(
          `[L2.A1 真跳痕迹] model=${MODEL_ID} uncachedInputTokens=${stats!.tokenUsage!.uncachedInputTokens} outputTokens=${stats!.tokenUsage!.outputTokens}`,
        );
        // 凭据红线：结果面（answer/run/sketch）零 key 子串。
        expect(JSON.stringify(result)).not.toContain(KIMI_KEY as string);
      } finally {
        if (prevHarnessDir === undefined) delete process.env.DSH_HARNESS_DIR;
        else process.env.DSH_HARNESS_DIR = prevHarnessDir;
        if (prevHarness === undefined) delete process.env.DSH_HARNESS;
        else process.env.DSH_HARNESS = prevHarness;
        await t?.app.close();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// L2.A2 · 真规则：governance http 模式 → 新裁决端点 → 真 rules.evaluate
// ---------------------------------------------------------------------------

describe("L2.A2 · 真规则：platform-governance http → POST /b/v1/governance/adjudicate → deps.dataCore.rules.evaluate", () => {
  it(
    "allow 臂：C03 + {demandDelta:0.1} ⇒ 放行 ∧ 工具真执行（whoami 对位 only_t1:t1）∧ 端点→rules.evaluate 计数≥2",
    { timeout: STUB_TIMEOUT },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "l2-gov-allow-"));
      const pidFile = join(dir, "pids");
      const gov = await startGovApp();
      const stub = await startStubOpenAi([
        { toolCall: { name: "mcp__erp__only_t1", arguments: JSON.stringify({ demandDelta: 0.1 }) }, usage: USAGE },
        finalAnswerRound("allow arm done"),
        { text: "allow arm done", usage: USAGE },
      ]);
      try {
        const out = await runDshAgent(
          {
            prompt: "调 only_t1 再 final_answer",
            setup: { ...BASE_SETUP, governance: GOV_C03, mcpServers: [mcpSpec("t1", pidFile)] },
            provider: "platform",
            model: MODEL_ID,
          },
          {
            harnessDir: HARNESS_DIR,
            cordisFile: CORDIS_L2,
            requestTimeoutMs: 60_000,
            env: { ...platformEnv(`${stub.url}/v1`, FAKE_KEY), PLATFORM_GOV_URL: gov.govUrl, PLATFORM_GOV_TOKEN: SERVICE_TOKEN },
          },
        );
        expect(out.result.ok).toBe(true);
        const wire = eventsWire(out.events, out.result);
        expect(wire).toContain("only_t1:t1"); // 工具体真执行（MCP 夹具应答）
        expect(wire).not.toContain("mock rule engine"); // 裁决出处非 harness mock 档
        // 端点→rules.evaluate 真跳：only_t1 与 final_answer 各裁决一次，ruleIds 原样透传。
        expect(gov.evalCalls.length).toBeGreaterThanOrEqual(2);
        expect(gov.evalCalls[0]!.ruleIds).toEqual(["C03"]);
        expect(JSON.stringify(gov.evalCalls[0]!.payload)).toContain("mcp__erp__only_t1");
      } finally {
        await stub.close();
        await gov.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it(
    "deny 臂：C03 + {demandDelta:0.9} ⇒ BLOCK ⇒ 工具体不执行 ∧ reason 含真 verdict 文案（无 mock 前缀）",
    { timeout: STUB_TIMEOUT },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "l2-gov-deny-"));
      const pidFile = join(dir, "pids");
      const gov = await startGovApp();
      const stub = await startStubOpenAi([
        { toolCall: { name: "mcp__erp__only_t1", arguments: JSON.stringify({ demandDelta: 0.9 }) }, usage: USAGE },
        finalAnswerRound("deny arm done"),
        { text: "deny arm done", usage: USAGE },
      ]);
      try {
        const out = await runDshAgent(
          {
            prompt: "调 only_t1 再 final_answer",
            setup: { ...BASE_SETUP, governance: GOV_C03, mcpServers: [mcpSpec("t1", pidFile)] },
            provider: "platform",
            model: MODEL_ID,
          },
          {
            harnessDir: HARNESS_DIR,
            cordisFile: CORDIS_L2,
            requestTimeoutMs: 60_000,
            env: { ...platformEnv(`${stub.url}/v1`, FAKE_KEY), PLATFORM_GOV_URL: gov.govUrl, PLATFORM_GOV_TOKEN: SERVICE_TOKEN },
          },
        );
        const wire = eventsWire(out.events, out.result);
        // 真 verdict 文案（MockRuleEngineClient C03 explanation 原文），非 "mock rule engine" 前缀。
        expect(wire).toContain("需求增量 0.9 超过产能上限约束");
        expect(wire).not.toContain("mock rule engine");
        expect(wire).not.toContain("only_t1:t1"); // 工具体未执行（pre-execute 拦死）
        expect(gov.evalCalls.length).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(gov.evalCalls[0]!.payload)).toContain("0.9");
      } finally {
        await stub.close();
        await gov.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// L2.A3 · 真 MCP：mock-mcp-tenant stdio 夹具一跳（stub LLM 驱动，裁决对象是 MCP 真跳）
// ---------------------------------------------------------------------------

describe("L2.A3 · 真 MCP：SetupSpec.mcpServers 挂 mock-mcp-tenant ⇒ whoami 携租户标记", () => {
  it(
    "whoami 应答 whoami:t1 ∧ pidFile 计数=1 ∧ 审计工具名 mcp__erp__whoami 在帧流",
    { timeout: STUB_TIMEOUT },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "l2-mcp-"));
      const pidFile = join(dir, "pids");
      const stub = await startStubOpenAi([
        { toolCall: { name: "mcp__erp__whoami", arguments: "{}" }, usage: USAGE },
        finalAnswerRound("mcp arm done"),
        { text: "mcp arm done", usage: USAGE },
      ]);
      try {
        const out = await runDshAgent(
          {
            prompt: "调 whoami 再 final_answer",
            setup: { ...BASE_SETUP, mcpServers: [mcpSpec("t1", pidFile)] },
            provider: "platform",
            model: MODEL_ID,
          },
          {
            harnessDir: HARNESS_DIR,
            cordisFile: CORDIS_L2,
            requestTimeoutMs: 60_000,
            // 插件 apply 期即校验 url 存在；本臂 setup 无 governance，裁决器永不被调用（url 是死值）。
            env: { ...platformEnv(`${stub.url}/v1`, FAKE_KEY), PLATFORM_GOV_URL: "http://127.0.0.1:9/unused" },
          },
        );
        expect(out.result.ok).toBe(true);
        const wire = eventsWire(out.events, out.result);
        expect(wire).toContain("whoami:t1"); // 租户标记应答（真 stdio 子进程回包）
        expect(wire).toContain("mcp__erp__whoami"); // 审计工具名
        const pids = readFileSync(pidFile, "utf8").split("\n").filter(Boolean);
        expect(pids.length).toBe(1); // 真子进程一跳，一连接一行
      } finally {
        await stub.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// L2.A4 · 组合臂：同一会话 真 LLM × 真规则 × 真 MCP（env 门控）
// ---------------------------------------------------------------------------

describe.skipIf(!KIMI_READY)("L2.A4 · 组合臂：kimi-k3 真调 + C03 真裁决 + whoami 真 MCP 同会话", () => {
  it(
    "真 resolveConnectionFacts 注 env + PLATFORM_GOV_URL 真端点 ⇒ ANSWERED ∧ whoami:t1 ∧ 真 token 账 ∧ 裁决计数≥1 ∧ 零 key 泄漏",
    { timeout: REAL_TIMEOUT },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "l2-combo-"));
      const pidFile = join(dir, "pids");
      const gov = await startGovApp({ providerDirectory: kimiDirectory() });
      try {
        const env = {
          ...(await kimiPlatformEnv()), // 真解析链产出（dcp spec → 连接事实 → env 注入形态）
          PLATFORM_GOV_URL: gov.govUrl,
          PLATFORM_GOV_TOKEN: SERVICE_TOKEN,
        };
        const run = () =>
          runDshAgent(
            {
              prompt:
                "按顺序执行两步：第一步调用 mcp__erp__whoami 工具获取租户标记；第二步调用 final_answer 工具收尾，" +
                '参数严格使用这个 JSON 形态（不要添加任何其他键）：{"blocks":[{"type":"text","markdown":"<这里写 whoami 的返回文本>"}],"provenance":[]}。',
              setup: { ...BASE_SETUP, governance: GOV_C03, mcpServers: [mcpSpec("t1", pidFile)] },
              provider: "platform",
              model: MODEL_ID,
            },
            { harnessDir: HARNESS_DIR, cordisFile: CORDIS_L2, requestTimeoutMs: 150_000, env },
          );
        const out = await runRealOnce(run, (o) => o.result.ok && eventsWire(o.events, o.result).includes("whoami:t1"));
        if (!out.result.ok) {
          // 超时/失败形态记负载（排障留痕，不含凭据——帧流红线断言在下方）。
          console.info(
            `[L2.A4 失败形态] errors=${JSON.stringify(out.result.ok ? [] : out.result.errors)} eventTypes=${JSON.stringify(out.events.map((e) => e.type))}`,
          );
        }
        expect(out.result.ok).toBe(true);
        const wire = eventsWire(out.events, out.result);
        expect(wire).toContain("whoami:t1"); // 真 MCP 跳
        expect(gov.evalCalls.length).toBeGreaterThanOrEqual(1); // 真规则跳（端点→rules.evaluate）
        expect(gov.evalCalls[0]!.ruleIds).toEqual(["C03"]);
        // 真 LLM 跳：stats fold 的真 token 账（wire 上真模型回包痕迹）。
        const stats = out.result.ok ? out.result.stats : undefined;
        expect(stats?.tokenUsage.uncachedInputTokens).toBeGreaterThan(0);
        expect(stats?.tokenUsage.outputTokens).toBeGreaterThan(0);
        console.info(
          `[L2.A4 真跳痕迹] model=${MODEL_ID} uncachedInputTokens=${stats?.tokenUsage.uncachedInputTokens} outputTokens=${stats?.tokenUsage.outputTokens} evalCalls=${gov.evalCalls.length}`,
        );
        // 凭据红线：全帧流/结果零 key 子串。
        expect(wire).not.toContain(KIMI_KEY as string);
        const pids = readFileSync(pidFile, "utf8").split("\n").filter(Boolean);
        expect(pids.length).toBe(1);
      } finally {
        await gov.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// L2.A5 · 凭据/配置变异负向两臂（mutation 靶常设红位：⑤a governance url 错 ⇒ fail-closed；
//          ⑤b 凭据缺失 ⇒ MISSING_CREDENTIAL 类）
// ---------------------------------------------------------------------------

describe("L2.A5 · 变异负向臂（fail-closed 红位常设）", () => {
  it(
    "⑤a PLATFORM_GOV_URL 指已关闭端口 ⇒ 裁决不可达 fail-closed deny ∧ 工具体不执行",
    { timeout: STUB_TIMEOUT },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "l2-gov-dead-"));
      const pidFile = join(dir, "pids");
      const dead = await closedPort();
      const stub = await startStubOpenAi([
        { toolCall: { name: "mcp__erp__only_t1", arguments: JSON.stringify({ demandDelta: 0.1 }) }, usage: USAGE },
        finalAnswerRound("dead gov arm done"),
        { text: "dead gov arm done", usage: USAGE },
      ]);
      try {
        const out = await runDshAgent(
          {
            prompt: "调 only_t1 再 final_answer",
            setup: { ...BASE_SETUP, governance: GOV_C03, mcpServers: [mcpSpec("t1", pidFile)] },
            provider: "platform",
            model: MODEL_ID,
          },
          {
            harnessDir: HARNESS_DIR,
            cordisFile: CORDIS_L2,
            requestTimeoutMs: 60_000,
            env: {
              ...platformEnv(`${stub.url}/v1`, FAKE_KEY),
              PLATFORM_GOV_URL: `http://127.0.0.1:${dead}/b/v1/governance/adjudicate`,
              PLATFORM_GOV_TOKEN: SERVICE_TOKEN,
            },
          },
        );
        const wire = eventsWire(out.events, out.result);
        expect(wire).toContain("fail-closed"); // 插件 fail-closed 语义原样透出
        expect(wire).toMatch(/unreachable|HTTP 5|ECONNREFUSED/);
        expect(wire).not.toContain("only_t1:t1"); // 工具体未执行（url 错 ⇒ 全拒）
      } finally {
        await stub.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it(
    "⑤b 缺 PLATFORM_LLM_API_KEY ⇒ MISSING_CREDENTIAL 含 env 引用名 ∧ stub 零请求（fail 在出网前）",
    { timeout: STUB_TIMEOUT },
    async () => {
      const stub = await startStubOpenAi([finalAnswerRound("never reached"), { text: "never", usage: USAGE }]);
      try {
        const out = await runDshAgent(
          { prompt: "调 final_answer 收尾", setup: { ...BASE_SETUP }, provider: "platform", model: MODEL_ID },
          {
            harnessDir: HARNESS_DIR,
            cordisFile: CORDIS_L2,
            requestTimeoutMs: 60_000,
            // 同 A3：apply 期 url 校验用死值；setup 无 governance，裁决器永不调用。
            env: { ...platformEnv(`${stub.url}/v1`), PLATFORM_GOV_URL: "http://127.0.0.1:9/unused" },
          },
        );
        const wire = eventsWire(out.events, out.result);
        expect(wire).toContain("MISSING_CREDENTIAL");
        expect(wire).toContain("PLATFORM_LLM_API_KEY"); // env 引用名（指名不含值）
        expect(wire).not.toContain(FAKE_KEY);
        expect(stub.requests.length).toBe(0); // key 解析在发请求之前 ⇒ 零出网
      } finally {
        await stub.close();
      }
    },
  );
});
