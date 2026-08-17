/**
 * WO-DSH-N1-PROVIDER · 真 LLM provider 缝（platform-llm 插件）SEAM 组合测试。
 *
 * 覆盖 plan assertions（/tmp/dsh-web-run/n1-provider-plan.md）：
 *   A1  生产 provider 单源常量 PRODUCTION_DSH_HARNESS_PROVIDER==='platform'（!=='mock'），
 *       engine.ts 分叉段无 `?? "mock"` 字面值回退（grep 防复活）；config 缺省=建议同值。
 *   A2  cordis.yml 生产形态（含 platform-llm、不含 mock-llm）；DSH_HARNESS_PROVIDER 进
 *       check-deploy-governance 扫描面（真仓门绿 + compose 缺行的镜像负向用例门必红）。
 *   A3  SEAM 端到端（engine 分叉驱动）：绑定矩阵 dcp spec → resolveConnectionFacts 剥 modelId →
 *       env 注入子进程 → 本地 stub OpenAI-completions 端点剧本化 SSE（final_answer 轮+文本收尾轮）
 *       ⇒ outcome ANSWERED、stub 侧 model===modelId（无 dcp: 前缀）、Authorization===Bearer <注入key>。
 *   A4  usage/缓存透传：stub usage{prompt_tokens:100,completion_tokens:20,prompt_cache_hit_tokens:60}
 *       ⇒ 事件流 usage 块 inputTokens=40/cacheReadTokens=60（dsh DISJOINT 语义），usage 在 finish 前。
 *   A5  凭据红线：注入 key 的全事件流/结果/请求体无一处含 key 子串；runner client→server 参数构造
 *       静态扫描（HarnessClient 无 wire tap，扫描 runner.ts 构造点，同 A1 grep 判据风格）；
 *       不注入 key ⇒ 帧流含 MISSING_CREDENTIAL 且含 env 引用名 PLATFORM_LLM_API_KEY、stub 零请求。
 *   A6  resolveConnectionFacts 单元：dcp 解析事实 / DISABLED 抛 / 有 hasApiKey 无凭据抛 /
 *       非 dcp spec 诚实抛（指明 spec）/ custom_http 拒 / anthropic kind 通过。
 *   A7  回归零扰：DSH_HARNESS 缺省 off 时旧路逐字节不变（既有套件绿即证，本文件不加断言）。
 *
 * 注：测试里的 key 是显式假值（"n1-seam-fake-key-…"），绝不写真凭据；泄凭扫描（真凭据前缀模式 grep）必须为 0。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
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
const ENGINE_SRC = join(REPO_ROOT, "apps/agentcore/src/engine.ts");
const RUNNER_SRC = join(REPO_ROOT, "apps/agentcore/src/dsh-runtime/runner.ts");
const CORDIS_YML = join(HARNESS_DIR, "cordis.yml");
const CORDIS_POC_YML = join(HARNESS_DIR, "cordis.poc.yml");
const GATE_SCRIPT = join(REPO_ROOT, "scripts/check-deploy-governance.mjs");

const MODEL_ID = "kimi-k3";
/** 显式假 key（红线断言的扫描对象；形如真 key 但绝非凭据）。 */
const FAKE_KEY = "n1-seam-fake-key-00000000000000000000000000000000";
const INTEGRATION_TIMEOUT = 90_000;

// ---------------------------------------------------------------------------
// 本地 stub OpenAI-completions 端点（剧本化 SSE）
// ---------------------------------------------------------------------------

interface StubRequest {
  authorization: string | undefined;
  model: unknown;
  body: unknown;
}

interface StubRound {
  /** 第一轮：final_answer 工具调用（携带 usage 含 prompt_cache_hit_tokens）。 */
  toolCall?: { name: string; arguments: string };
  /** 第二轮：纯文本收尾。 */
  text?: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_cache_hit_tokens?: number };
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
    out += sseChunk({
      ...base,
      choices: [{ index: 0, delta: { role: "assistant", content: round.text ?? "" }, finish_reason: null }],
    });
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
      requests.push({
        authorization: req.headers.authorization,
        model: (body as { model?: unknown })?.model,
        body,
      });
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
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const FINAL_ANSWER_ARGS = JSON.stringify({
  blocks: [{ type: "text", markdown: "structured answer via platform provider stub" }],
  provenance: [],
});

const CACHE_USAGE = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 60 };
const PLAIN_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };

const SCRIPT: StubRound[] = [
  { toolCall: { name: "final_answer", arguments: FINAL_ANSWER_ARGS }, usage: CACHE_USAGE },
  { text: "stub final answer", usage: PLAIN_USAGE },
];

/** runner opts.env 注入形态（= engine 分叉经 resolveConnectionFacts 产出的连接事实注入）。 */
function platformEnv(baseUrl: string, key?: string): Record<string, string> {
  return {
    PLATFORM_LLM_API: "openai-completions",
    PLATFORM_LLM_BASE_URL: baseUrl,
    PLATFORM_LLM_MODEL: MODEL_ID,
    PLATFORM_LLM_CONTEXT_WINDOW: "131072",
    ...(key === undefined ? {} : { PLATFORM_LLM_API_KEY: key }),
  };
}

const SETUP: DshSetupSpec = {
  tenantId: "t1", // 协调①: N4 tenantId 必填化后的字面量补齐（对位 poc-acceptance 形态）
  persona: "n1 provider seam stub",
  finalAnswer: {
    description: "终止工具（N1 seam）",
    schema: { type: "object", properties: { blocks: { type: "array" }, provenance: { type: "array" } }, required: ["blocks", "provenance"] },
  },
};

function usageChunks(events: readonly DshSessionEvent[]): { inputTokens: number; outputTokens: number; cacheReadTokens?: number }[] {
  return events
    .filter((e) => e.type === "assistant/chunk")
    .map((e) => (e.data as { chunk?: { type: string; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number } } }).chunk)
    .filter((c): c is { type: string; usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number } } => c?.type === "usage" && !!c.usage)
    .map((c) => c.usage);
}

// ---------------------------------------------------------------------------
// A1 · 生产 provider 单源常量 + engine 分叉无 mock 回退（grep 防复活）
// ---------------------------------------------------------------------------

describe("A1 · 生产 provider 单源常量与 mock 回退根除", () => {
  it("PRODUCTION_DSH_HARNESS_PROVIDER==='platform'（!=='mock'）；config 缺省=建议同值；engine 分叉段无 ?? \"mock\"", async () => {
    const { PRODUCTION_DSH_HARNESS_PROVIDER } = await import("../src/config.js");
    expect(PRODUCTION_DSH_HARNESS_PROVIDER).toBe("platform");
    expect(PRODUCTION_DSH_HARNESS_PROVIDER).not.toBe("mock");

    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(cfg.DSH_HARNESS_PROVIDER).toBe(PRODUCTION_DSH_HARNESS_PROVIDER); // 缺省与建议同值
    expect(cfg.DSH_HARNESS).toBe("0"); // 出货缺省 off（§16.1a 部署层回退）

    const src = readFileSync(ENGINE_SRC, "utf8");
    const forkStart = src.indexOf('DSH_HARNESS === "1"');
    expect(forkStart).toBeGreaterThanOrEqual(0);
    const fork = src.slice(forkStart, src.indexOf("runAgentLoop({", forkStart));
    expect(fork).not.toContain('?? "mock"');
    expect(fork).not.toContain("?? 'mock'");
  });
});

// ---------------------------------------------------------------------------
// A2 · cordis.yml 生产形态 + 部署治理门扫描面（含负向用例）
// ---------------------------------------------------------------------------

describe("A2 · cordis.yml 生产形态与部署治理门", () => {
  it("yml 含 platform-llm 且不含 mock-llm；poc 专档含 mock-llm 反向锚定；真仓门绿；compose 缺 DSH_HARNESS_PROVIDER 行的镜像 ⇒ 门必红", () => {
    const yml = readFileSync(CORDIS_YML, "utf8");
    expect(yml).toContain("- id: platform-llm");
    // 条目语义（裁决 A 条件 6「不含 mock-llm 条目」）：条目 id 与插件引用双防，
    // 注释里允许出现迁移说明文字（条目形态才注册适配器，注释不注册）。
    expect(yml).not.toContain("- id: mock-llm");
    expect(yml).not.toContain("mock-llm.mjs");

    // 反向锚定（裁决 A 条件 6）：测试专档 cordis.poc.yml 必须含 mock-llm + echo-tool
    // （E1/E2/smoke/stall 剧本的 fixture），防误删；生产档摘除即靠它兜底。
    const pocYml = readFileSync(CORDIS_POC_YML, "utf8");
    expect(pocYml).toContain("- id: mock-llm");
    expect(pocYml).toContain("- id: echo-tool");
    expect(pocYml).toContain("- id: platform-llm");

    // 正向：真仓门绿，且 DSH_HARNESS_PROVIDER 真进了扫描报告。
    const ok = spawnSync(process.execPath, [GATE_SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("DSH_HARNESS_PROVIDER");

    // 负向：镜像仓（同脚本同 config.ts，compose 删 DSH_HARNESS_PROVIDER 行）⇒ 门必红且点名该键。
    const tmp = mkdtempSync(join(tmpdir(), "dsh-n1-gate-"));
    try {
      mkdirSync(join(tmp, "scripts"), { recursive: true });
      mkdirSync(join(tmp, "apps/agentcore/src"), { recursive: true });
      mkdirSync(join(tmp, "apps/datacore/src"), { recursive: true });
      copyFileSync(GATE_SCRIPT, join(tmp, "scripts/check-deploy-governance.mjs"));
      copyFileSync(join(REPO_ROOT, "apps/agentcore/src/config.ts"), join(tmp, "apps/agentcore/src/config.ts"));
      copyFileSync(join(REPO_ROOT, "apps/datacore/src/config.ts"), join(tmp, "apps/datacore/src/config.ts"));
      const compose = readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8")
        .split("\n")
        .filter((l) => !/^\s+DSH_HARNESS_PROVIDER:/.test(l))
        .join("\n");
      writeFileSync(join(tmp, "docker-compose.yml"), compose);
      const bad = spawnSync(process.execPath, [join(tmp, "scripts/check-deploy-governance.mjs")], { encoding: "utf8" });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("DSH_HARNESS_PROVIDER");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// A3 · SEAM 端到端（engine 分叉驱动：绑定矩阵 → env 注入 → stub 端点）
// ---------------------------------------------------------------------------

const CTX = { tenantId: TENANT, userId: "u", roles: ["planner"] };

function stubProvider(baseUrl: string): LlmProvider {
  return {
    id: "llmp_stub",
    tenantId: "platform",
    name: "N1 Stub Provider",
    kind: "openai_compatible",
    baseUrl,
    models: [{ modelId: MODEL_ID, displayName: "Kimi K3", capabilities: { tools: true, structuredOutput: true, maxContext: 131072 } }],
    status: "ACTIVE",
    hasApiKey: true,
  };
}

function stubDirectory(provider: LlmProvider | undefined, apiKey: string | undefined) {
  const binding = { providerId: "llmp_stub", modelId: MODEL_ID } as PurposeBinding;
  return {
    provider: async (_tenantId: string, id: string) => (provider && id === provider.id ? provider : undefined),
    credential: async () => apiKey,
    bindingFor: async (_tenantId: string, purpose: string) => (purpose === "agent" ? binding : undefined),
  };
}

async function makeBareAgent(t: TestApp): Promise<string> {
  const agent = {
    id: "agt_n1_provider_seam",
    tenantId: TENANT,
    key: "n1_provider_seam",
    version: 1,
    name: "N1 Provider Seam Agent",
    description: "n1 seam",
    model: "",
    systemPrompt: "你是 N1 seam 测试助手。",
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

describe("A3 · SEAM 端到端：engine 分叉 → 绑定矩阵解析 → env 注入 → stub OpenAI 端点", () => {
  it(
    "dcp spec 剥出 modelId；provider=PRODUCTION_DSH_HARNESS_PROVIDER；stub 见 model 无前缀、Authorization=Bearer key",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const { PRODUCTION_DSH_HARNESS_PROVIDER } = await import("../src/config.js");
      const stub = await startStubOpenAi([...SCRIPT.map((r) => ({ ...r }))]);
      const prevHarnessDir = process.env.DSH_HARNESS_DIR;
      const prevHarness = process.env.DSH_HARNESS;
      process.env.DSH_HARNESS_DIR = HARNESS_DIR;
      process.env.DSH_HARNESS = "1"; // engine 守卫直读 process.env（D3 休眠门判据形态）
      try {
        const t = await createTestApp({
          providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), FAKE_KEY) as never,
        });
        const agentId = await makeBareAgent(t);
        const result = await t.deps.engine.runRegisteredAgent({
          taskId: "task_n1_a3",
          agentId,
          version: 1,
          prompt: "调 final_answer 收尾",
          ctx: CTX,
          nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
          emit: async () => {},
          expectsSchema: SETUP.finalAnswer!.schema,
        });
        expect(result.outcome).toBe("ANSWERED");
        // 两轮（final_answer 调用轮 + 文本收尾轮）都真打到 stub，且：
        expect(stub.requests.length).toBeGreaterThanOrEqual(2);
        for (const r of stub.requests) {
          expect(r.model).toBe(MODEL_ID); // M3 咬点：dcp: 前缀未剥 ⇒ 此处红
          expect(r.authorization).toBe(`Bearer ${FAKE_KEY}`);
        }
        // provider 实参非字面量：常量即生产值（A1 已锁 'platform'）。
        expect(PRODUCTION_DSH_HARNESS_PROVIDER).toBe("platform");
      } finally {
        if (prevHarnessDir === undefined) delete process.env.DSH_HARNESS_DIR;
        else process.env.DSH_HARNESS_DIR = prevHarnessDir;
        if (prevHarness === undefined) delete process.env.DSH_HARNESS;
        else process.env.DSH_HARNESS = prevHarness;
        await stub.close();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// A4 · usage/缓存透传（DISJOINT 语义；usage 在 finish 前、finish 后零块）
// ---------------------------------------------------------------------------

describe("A4 · usage 缓存透传", () => {
  it(
    "prompt_cache_hit_tokens=60 ⇒ usage 块 inputTokens=40/cacheReadTokens=60/outputTokens=20；usage 在 finish 前",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const { PRODUCTION_DSH_HARNESS_PROVIDER } = await import("../src/config.js");
      const stub = await startStubOpenAi([...SCRIPT.map((r) => ({ ...r }))]);
      try {
        const out = await runDshAgent(
          { prompt: "调 final_answer 收尾", setup: SETUP, provider: PRODUCTION_DSH_HARNESS_PROVIDER, model: MODEL_ID },
          { harnessDir: HARNESS_DIR, requestTimeoutMs: 60_000, env: platformEnv(`${stub.url}/v1`, FAKE_KEY) },
        );
        expect(out.result.ok).toBe(true);
        const usages = usageChunks(out.events);
        expect(usages.length).toBe(2);
        // DISJOINT：inputTokens = prompt_tokens - prompt_cache_hit_tokens = 100 - 60 = 40（M4 咬点）。
        expect(usages[0]).toMatchObject({ inputTokens: 40, outputTokens: 20, cacheReadTokens: 60 });
        expect(usages[1]).toMatchObject({ inputTokens: 50, outputTokens: 10 });
        expect(usages[1]!.cacheReadTokens).toBeUndefined();
        // usage 在 finish 前、finish 后零块：逐轮 usage 下标 < 对应 finish 下标，末 finish 后无 usage。
        const types = out.events
          .filter((e) => e.type === "assistant/chunk")
          .map((e) => (e.data as { chunk?: { type: string } }).chunk?.type);
        const finishes = types.map((t, i) => (t === "finish" ? i : -1)).filter((i) => i >= 0);
        const usageIdx = types.map((t, i) => (t === "usage" ? i : -1)).filter((i) => i >= 0);
        expect(finishes.length).toBe(2);
        expect(usageIdx).toHaveLength(2);
        expect(usageIdx[0]!).toBeLessThan(finishes[0]!);
        expect(usageIdx[1]!).toBeLessThan(finishes[1]!);
        expect(usageIdx[1]!).toBeGreaterThan(finishes[0]!);
      } finally {
        await stub.close();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// A5 · 凭据红线
// ---------------------------------------------------------------------------

describe("A5 · 凭据红线", () => {
  it(
    "注入 key：事件流/结果/stub 请求体零 key 子串；runner 参数构造无 key；缺 key ⇒ MISSING_CREDENTIAL 含 env 引用名",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const { PRODUCTION_DSH_HARNESS_PROVIDER } = await import("../src/config.js");

      // case 1：key 注入 —— key 只许出现在 stub 的 Authorization 头，不得进任何帧/事件/请求体。
      const stub = await startStubOpenAi([...SCRIPT.map((r) => ({ ...r }))]);
      try {
        const out = await runDshAgent(
          { prompt: "调 final_answer 收尾", setup: SETUP, provider: PRODUCTION_DSH_HARNESS_PROVIDER, model: MODEL_ID },
          { harnessDir: HARNESS_DIR, requestTimeoutMs: 60_000, env: platformEnv(`${stub.url}/v1`, FAKE_KEY) },
        );
        expect(out.result.ok).toBe(true);
        expect(JSON.stringify(out.events)).not.toContain(FAKE_KEY); // server→client 全部帧载荷
        expect(JSON.stringify(out.result)).not.toContain(FAKE_KEY);
        for (const r of stub.requests) {
          expect(JSON.stringify(r.body)).not.toContain(FAKE_KEY); // 上行请求体（key 只走 Authorization 头）
          expect(r.authorization).toBe(`Bearer ${FAKE_KEY}`);
        }
      } finally {
        await stub.close();
      }

      // client→server 帧（initialize/session-prompt 参数）静态扫描：HarnessClient 无 wire tap，
      // 参数构造点在 runner.ts —— 扫描构造块不得出现 apiKey/PLATFORM_LLM_API_KEY（M5 咬点，同 A1 grep 判据）。
      const runnerSrc = readFileSync(RUNNER_SRC, "utf8");
      const initStart = runnerSrc.indexOf("client.initialize({");
      expect(initStart).toBeGreaterThanOrEqual(0);
      const initBlock = runnerSrc.slice(initStart, runnerSrc.indexOf("});", initStart));
      expect(initBlock).not.toMatch(/apiKey/i);
      const promptStart = runnerSrc.indexOf('client.request("session/prompt"');
      expect(promptStart).toBeGreaterThanOrEqual(0);
      const promptBlock = runnerSrc.slice(promptStart, runnerSrc.indexOf("});", promptStart));
      expect(promptBlock).not.toMatch(/apiKey/i);

      // case 2：不注入 key —— stream 失败码 MISSING_CREDENTIAL，错误串含 env 引用名、不含 key，stub 零请求。
      const stub2 = await startStubOpenAi([...SCRIPT.map((r) => ({ ...r }))]);
      try {
        const out2 = await runDshAgent(
          { prompt: "调 final_answer 收尾", setup: SETUP, provider: PRODUCTION_DSH_HARNESS_PROVIDER, model: MODEL_ID },
          { harnessDir: HARNESS_DIR, requestTimeoutMs: 60_000, env: platformEnv(`${stub2.url}/v1`) },
        );
        const wire = JSON.stringify(out2.events) + JSON.stringify(out2.result);
        expect(wire).toContain("MISSING_CREDENTIAL");
        expect(wire).toContain("PLATFORM_LLM_API_KEY"); // env 引用名（assertUsableApiKey 语义：指引用名，不含值）
        expect(wire).not.toContain(FAKE_KEY);
        expect(stub2.requests.length).toBe(0); // key 解析在发请求之前 ⇒ 零出网
      } finally {
        await stub2.close();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// A6 · resolveConnectionFacts 绑定矩阵解析（单元）
// ---------------------------------------------------------------------------

describe("A6 · resolveConnectionFacts 绑定矩阵解析", () => {
  const mk = (provider: LlmProvider | undefined, apiKey: string | undefined): LlmSettings =>
    new LlmSettings({} as never, loadConfig({} as NodeJS.ProcessEnv), stubDirectory(provider, apiKey) as never);

  it("dcp:llmp_stub:kimi-k3 ⇒ {providerId, modelId 剥前缀, kind, baseUrl, apiKey}", async () => {
    const s = mk(stubProvider("https://stub.example/v1"), FAKE_KEY);
    const facts = await s.resolveConnectionFacts("dcp:llmp_stub:kimi-k3", "t1");
    expect(facts).toMatchObject({
      providerId: "llmp_stub",
      modelId: MODEL_ID, // M3 咬点：带 dcp: 前缀 ⇒ 此处红
      kind: "openai_compatible",
      baseUrl: "https://stub.example/v1",
      apiKey: FAKE_KEY,
    });
  });

  it("provider DISABLED ⇒ 抛错", async () => {
    const s = mk({ ...stubProvider("https://stub.example/v1"), status: "DISABLED" }, FAKE_KEY);
    await expect(s.resolveConnectionFacts("dcp:llmp_stub:kimi-k3", "t1")).rejects.toThrow(/disabled/i);
  });

  it("hasApiKey 而凭据取不到 ⇒ 抛错（fail-closed，不静默 keyless）", async () => {
    const s = mk(stubProvider("https://stub.example/v1"), undefined);
    await expect(s.resolveConnectionFacts("dcp:llmp_stub:kimi-k3", "t1")).rejects.toThrow(/credential|apiKey|凭据/i);
  });

  it("非 dcp spec ⇒ 诚实抛错并指明 spec", async () => {
    const s = mk(stubProvider("https://stub.example/v1"), FAKE_KEY);
    await expect(s.resolveConnectionFacts("anthropic:claude-opus-4-8", "t1")).rejects.toThrow(/anthropic:claude-opus-4-8/);
  });

  it("custom_http kind ⇒ v1 诚实拒绝（不静默回落）", async () => {
    const s = mk({ ...stubProvider("https://stub.example/v1"), kind: "custom_http" }, FAKE_KEY);
    await expect(s.resolveConnectionFacts("dcp:llmp_stub:kimi-k3", "t1")).rejects.toThrow(/custom_http/);
  });

  it("anthropic kind ⇒ 通过（映射 anthropic-messages 协议路）", async () => {
    const p = { ...stubProvider("https://stub.example/v1"), kind: "anthropic" } as LlmProvider;
    const s = mk(p, FAKE_KEY);
    const facts = await s.resolveConnectionFacts("dcp:llmp_stub:kimi-k3", "t1");
    expect(facts.kind).toBe("anthropic");
  });

  it("未知 provider ⇒ 抛错", async () => {
    const s = mk(undefined, FAKE_KEY);
    await expect(s.resolveConnectionFacts("dcp:llmp_ghost:kimi-k3", "t1")).rejects.toThrow(/unknown|不存在|llmp_ghost/i);
  });
});
