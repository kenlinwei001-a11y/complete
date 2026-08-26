import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataCoreProviderDirectory } from "../src/llm/datacore-directory.js";
import {
  LlmProviderRegistry,
  LlmSettings,
  RoutingLlmClient,
  defaultAdapterFactory,
  type LlmAdapterFactory,
} from "../src/llm/providers.js";
import type { LlmClient } from "../src/llm/types.js";
import { Metrics } from "../src/metrics.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { loadConfig } from "../src/config.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { ADMIN, TENANT, createTestApp, submitQuery, waitForTask, type TestApp } from "./helpers.js";

/**
 * #4 role/coordinator 路静默空答修复（SEAM · KILL-MOCK · SYSTEM-ONTOLOGY §8）。
 *
 * 病根链路（沿链路走·断在接缝）：demo 全 feature 开 → coordinator/role 路抢在 free-LLM 前 →
 * 种子 role agent 硬编 model="claude-opus-4-8" → roleModel(:410) explicit 直返裸名 → 落无 key 的
 * 默认 provider anthropic（本部署只配 Kimi）→ 静默 AGENT_ERROR/空答。
 *
 * 修复：roleModel 对 explicit 的 provider 做 keyless 探测——无凭据则回落租户已绑定 LLM（本例 kimi-k2.5）；
 * 连绑定也无 → 保留 explicit 交下游真适配器由其失败落**诚实 gap 错误**（非「探索模式未能产出回答」占位）。
 *
 * 接缝驱动（非各半绿）：经真 orchestrator（submitQuery → path-B → runRolePathB → engine.runRegisteredAgent
 * → runAgentLoop → RoutingLlmClient）端到端断言，anthropic builtin 用 throwing factory 模拟无 key（不打网络）。
 */

interface StubState {
  calls: Record<string, number>;
  lastAuth: Record<string, string | undefined>;
}
const state: StubState = { calls: {}, lastAuth: {} };

let stub: Server;
let base = "";

const KIMI_ID = "llmp_kimi";
const PROVIDERS = () => [
  {
    id: KIMI_ID,
    tenantId: TENANT,
    name: "moonshot",
    kind: "openai_compatible",
    baseUrl: `${base}/kimi`,
    models: [
      { modelId: "kimi-k2.5", displayName: "Kimi K2.5（推理）", capabilities: { tools: true, structuredOutput: true, maxContext: 128000, reasoning: true } },
      { modelId: "moonshot-v1-32k", displayName: "Moonshot v1 32K", capabilities: { tools: true, structuredOutput: true, maxContext: 32000 } },
    ],
    status: "ACTIVE",
    hasApiKey: true,
  },
];

/** 每个测试用例注入自己的用途绑定（classifier/agent → kimi；可带 noReasoning 开关）。 */
let bindings: { purpose: string; providerId: string; modelId: string; noReasoning?: boolean }[] = [];

/** 分类：outOfCatalog=true → 逼入路径 B（→ 单域 role 选择）。 */
const OUT_OF_CATALOG = JSON.stringify({ candidates: [], outOfCatalog: true, extractedSlotsJson: "{}" });

beforeAll(async () => {
  // 本部署只配 Kimi、没配 Anthropic —— 确保探测判定 anthropic builtin 无 key（不受宿主环境泄漏影响）。
  delete (process.env as Record<string, string | undefined>).ANTHROPIC_API_KEY;
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += String(c)));
    req.on("end", () => {
      const url = req.url ?? "/";
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      // —— DataCore 服务间凭证消费面 ——
      if (url === "/a/v1/llm-providers") return json(200, PROVIDERS());
      if (url === "/a/v1/llm-bindings") return json(200, { bindings });
      const cred = /^\/a\/v1\/llm-providers\/([^/]+)\/credential$/.exec(url);
      if (cred) return json(200, { providerId: cred[1], apiKey: "sk-kimi-test" });
      // —— Kimi (openai_compatible) 端点 ——
      if (url === "/kimi/chat/completions") {
        state.calls.kimi = (state.calls.kimi ?? 0) + 1;
        state.lastAuth.kimi = req.headers.authorization;
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          /* ignore */
        }
        const usage = { prompt_tokens: 80, completion_tokens: 24 };
        const tools = body.tools as unknown[] | undefined;
        if (Array.isArray(tools) && tools.length > 0) {
          // 角色 agent 工具循环：文本收尾（真答·非空）——证 role 路真落 Kimi。
          return json(200, { choices: [{ message: { role: "assistant", content: "物料齐套：正极粉存在缺口，建议提前补料。（Kimi 真答）" }, finish_reason: "stop" }], usage });
        }
        return json(200, { choices: [{ message: { role: "assistant", content: OUT_OF_CATALOG }, finish_reason: "stop" }], usage });
      }
      json(404, { error: "not found" });
    });
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
});

afterAll(() => stub.close());

/** anthropic builtin 无 key → 适配器 agent() 抛（模拟本部署未配 Anthropic·不打网络）；其余 kind 走默认。 */
const anthropicKeylessFactory: LlmAdapterFactory = (cfg, apiKey, metrics) => {
  if (cfg.kind === "anthropic") {
    const boom = (): never => {
      const e = new Error("anthropic provider 无凭据（本部署未配 ANTHROPIC_API_KEY）");
      (e as { code?: string }).code = "PROVIDER_CREDENTIAL_MISSING";
      throw e;
    };
    return {
      classify: async () => boom(),
      agent: async () => boom(),
      compose: async () => boom(),
      capabilities: async () => ({ countTokens: false, compaction: false }),
      countTokens: async () => 0,
    } as LlmClient;
  }
  return defaultAdapterFactory(cfg, apiKey, metrics);
};

function makeRouting(): { llm: RoutingLlmClient; directory: DataCoreProviderDirectory } {
  const directory = new DataCoreProviderDirectory({ baseUrl: base, serviceToken: "svc-secret" });
  const registry = new LlmProviderRegistry({
    repos: createMemoryRepos(),
    config: loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv),
    metrics: new Metrics(),
    directory,
    factory: anthropicKeylessFactory,
  });
  return { llm: new RoutingLlmClient(registry), directory };
}

async function seedAgents(t: TestApp): Promise<void> {
  for (const ag of seedRegistry().agents) {
    if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
  }
}

const RISK = { view: "risk" };

describe("#4 SEAM · role/coordinator 路 keyless-provider 回落（消静默空答）", () => {
  it("① role agent 硬编 claude-opus-4-8（anthropic 无 key）→ 回落租户 kimi 绑定 → 真出非空答（非 gap）", async () => {
    bindings = [
      { purpose: "classifier", providerId: KIMI_ID, modelId: "kimi-k2.5" },
      { purpose: "agent", providerId: KIMI_ID, modelId: "kimi-k2.5" },
    ];
    state.calls.kimi = 0;
    const { llm, directory } = makeRouting();
    const t = await createTestApp({ llm, providerDirectory: directory });
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]); // 暗发门显式开
    await seedAgents(t);

    const { taskId } = await submitQuery(t, ADMIN, "帮我看看物料齐套现在到底怎么样", RISK);
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED" || x.status === "FAILED");

    // 按 role 选供应链角色 agent（非通用 loop）。
    expect(task.status).toBe("COMPLETED");
    expect(task.classification?.model).toBe("agent:role:supply-chain");

    // 答案非空、非 gap（回落 Kimi 真答·非静默空答）。
    const blocks = task.answer?.blocks ?? [];
    expect(blocks.some((b) => b.type === "gap")).toBe(false);
    const md = blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("Kimi 真答");
    expect(md.trim().length).toBeGreaterThan(0);
    expect(md).not.toContain("探索模式未能产出回答");

    // 接缝证据：角色 agent 的 LLM 调用真落 Kimi 端点（bearer=服务间凭证下发的 key）——非无 key 的 anthropic。
    expect(state.calls.kimi ?? 0).toBeGreaterThan(0);
    expect(state.lastAuth.kimi).toBe("Bearer sk-kimi-test");

    await t.app.close();
  });

  it("② 连租户绑定也无（仅 classifier 绑 kimi·无 agent 绑定）→ 诚实 gap 错误（provider 缺失码）·非「探索模式未能产出回答」占位", async () => {
    bindings = [{ purpose: "classifier", providerId: KIMI_ID, modelId: "kimi-k2.5" }]; // 无 agent 绑定
    state.calls.kimi = 0;
    const { llm, directory } = makeRouting();
    const t = await createTestApp({ llm, providerDirectory: directory });
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);

    const { taskId } = await submitQuery(t, ADMIN, "帮我看看物料齐套现在到底怎么样", RISK);
    const task = await waitForTask(t, taskId, (x) => x.status === "FAILED" || x.status === "COMPLETED");

    // 无绑定 → role agent 落 keyless anthropic → 真适配器抛 → 诚实错误信封（非静默空答）。
    expect(task.status).toBe("FAILED");
    expect(task.error?.code).toBe("PROVIDER_CREDENTIAL_MISSING");

    // 答案侧：结构化 gap 块（BLOCKED·可诊断），且绝不出现占位「探索模式未能产出回答」。
    const blocks = task.answer?.blocks ?? [];
    const gap = blocks.find((b) => b.type === "gap");
    expect(gap).toBeDefined();
    const md = blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).not.toContain("探索模式未能产出回答");

    await t.app.close();
  });
});

describe("#4 SEAM · roleModel 决策（有 anthropic key 不回归正常路 / 无 key 回落）", () => {
  const directory = () => new DataCoreProviderDirectory({ baseUrl: base, serviceToken: "svc-secret" });

  it("③ 有 ANTHROPIC_API_KEY → explicit claude-opus-4-8 保持不变（不误回落·正常路不回归）", async () => {
    bindings = [{ purpose: "agent", providerId: KIMI_ID, modelId: "kimi-k2.5" }];
    const config = loadConfig({ PORT: "0", LOG_LEVEL: "silent", ANTHROPIC_API_KEY: "sk-ant-test" } as NodeJS.ProcessEnv);
    const settings = new LlmSettings(createMemoryRepos(), config, directory());
    const spec = await settings.roleModel(TENANT, "agent", "claude-opus-4-8");
    expect(spec).toBe("claude-opus-4-8"); // provider 有 key → 不回落
  });

  it("③b 无 ANTHROPIC_API_KEY → explicit claude-opus-4-8 回落到租户 kimi 绑定 spec", async () => {
    bindings = [{ purpose: "agent", providerId: KIMI_ID, modelId: "kimi-k2.5" }];
    const config = loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);
    delete (process.env as Record<string, string | undefined>).ANTHROPIC_API_KEY;
    const settings = new LlmSettings(createMemoryRepos(), config, directory());
    const spec = await settings.roleModel(TENANT, "agent", "claude-opus-4-8");
    expect(spec).toBe(`dcp:${KIMI_ID}:kimi-k2.5`); // keyless → 回落租户绑定
  });
});

describe("WO-QOS-NOREASON SEAM · 用途绑定「关推理」开关 → 解析期改用非推理兄弟模型", () => {
  const directory = () => new DataCoreProviderDirectory({ baseUrl: base, serviceToken: "svc-secret" });
  const cfg = () => loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);

  it("④ noReasoning ON + 绑定推理型 kimi-k2.5 → 解析改用同 provider 非推理兄弟 moonshot-v1-32k（根因治本·因 Moonshot 无请求级关推理参数）", async () => {
    bindings = [{ purpose: "classifier", providerId: KIMI_ID, modelId: "kimi-k2.5", noReasoning: true }];
    const spec = await new LlmSettings(createMemoryRepos(), cfg(), directory()).roleModel(TENANT, "classifier", undefined);
    expect(spec).toBe(`dcp:${KIMI_ID}:moonshot-v1-32k`);
  });

  it("④b noReasoning ON 但绑定的本就是非推理模型 → 原样保留（无兄弟切换）", async () => {
    bindings = [{ purpose: "classifier", providerId: KIMI_ID, modelId: "moonshot-v1-32k", noReasoning: true }];
    const spec = await new LlmSettings(createMemoryRepos(), cfg(), directory()).roleModel(TENANT, "classifier", undefined);
    expect(spec).toBe(`dcp:${KIMI_ID}:moonshot-v1-32k`);
  });

  it("④c 开关关 + 非 classifier 用途（agent）→ 保持推理模型 kimi-k2.5（既有零回归·推理档留给 agent 多步/最终综合·§3）", async () => {
    bindings = [{ purpose: "agent", providerId: KIMI_ID, modelId: "kimi-k2.5" }];
    const spec = await new LlmSettings(createMemoryRepos(), cfg(), directory()).roleModel(TENANT, "agent", undefined);
    expect(spec).toBe(`dcp:${KIMI_ID}:kimi-k2.5`);
  });

  it("④d WO-CLASSIFY-NO-REASON：classifier 用途**默认**避推理——即便 noReasoning 缺省也自动换非推理兄弟 moonshot-v1-32k（治 Q1 分类器 82s·§3「D 模型分层：分类不用推理档」）", async () => {
    bindings = [{ purpose: "classifier", providerId: KIMI_ID, modelId: "kimi-k2.5" }]; // 无 noReasoning
    const spec = await new LlmSettings(createMemoryRepos(), cfg(), directory()).roleModel(TENANT, "classifier", undefined);
    expect(spec).toBe(`dcp:${KIMI_ID}:moonshot-v1-32k`); // 分类器被强制避推理·换非推理兄弟
  });
});
