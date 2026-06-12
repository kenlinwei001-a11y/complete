import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataCoreProviderDirectory } from "../src/llm/datacore-directory.js";
import { LlmProviderRegistry, RoutingLlmClient } from "../src/llm/providers.js";
import { Metrics } from "../src/metrics.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { loadConfig } from "../src/config.js";
import { createTestApp, PLANNER, submitQuery, waitForTask } from "./helpers.js";

/**
 * LLM Provider 增量（B 侧消费）：
 * L1 绑定 classifier 用途后分类调用走 openai_compatible mock 端点（审计含 providerId）；
 * L3 无结构化输出 provider → JSON-mode 降级 + zod 重试 ≤2，仍失败 → 既有失败语义（路径 B）；
 * L4 provider 故障 → fallback 接管（指标可见），禁止链式。
 */

interface StubState {
  /** path → 行为开关 */
  fail: Set<string>;
  calls: Record<string, number>;
  /** 每个端点收到的请求体（最后一个） */
  lastBody: Record<string, Record<string, unknown>>;
  lastAuth: Record<string, string | undefined>;
  credentialFetches: number;
}

const state: StubState = { fail: new Set(), calls: {}, lastBody: {}, lastAuth: {}, credentialFetches: 0 };

let stub: Server;
let base = "";

const PROVIDERS = () => [
  {
    id: "llmp1",
    tenantId: "demo",
    name: "可结构化端点",
    kind: "openai_compatible",
    baseUrl: `${base}/p1`,
    models: [{ modelId: "m1", displayName: "m1", capabilities: { tools: true, structuredOutput: true, maxContext: 128000 } }],
    status: "ACTIVE",
    hasApiKey: true,
  },
  {
    id: "llmp_noso",
    tenantId: "demo",
    name: "无结构化端点",
    kind: "openai_compatible",
    baseUrl: `${base}/noso`,
    models: [{ modelId: "m2", displayName: "m2", capabilities: { tools: false, structuredOutput: false, maxContext: 32000 } }],
    status: "ACTIVE",
    hasApiKey: false,
  },
  {
    id: "llmp_bad",
    tenantId: "demo",
    name: "故障端点",
    kind: "openai_compatible",
    baseUrl: `${base}/bad`,
    models: [{ modelId: "m1", displayName: "m1", capabilities: { tools: true, structuredOutput: true, maxContext: 128000 } }],
    status: "ACTIVE",
    fallbackProviderId: "llmp2",
    hasApiKey: false,
  },
  {
    id: "llmp2",
    tenantId: "demo",
    name: "降级目标",
    kind: "openai_compatible",
    baseUrl: `${base}/p2`,
    models: [{ modelId: "m1", displayName: "m1", capabilities: { tools: true, structuredOutput: true, maxContext: 128000 } }],
    status: "ACTIVE",
    // 链式配置（A 侧校验会拒绝；此处故意提供以验证运行期禁止链式）
    fallbackProviderId: "llmp3",
    hasApiKey: false,
  },
  {
    id: "llmp3",
    tenantId: "demo",
    name: "链式第三级（不得生效）",
    kind: "openai_compatible",
    baseUrl: `${base}/p3`,
    models: [{ modelId: "m1", displayName: "m1", capabilities: { tools: true, structuredOutput: true, maxContext: 128000 } }],
    status: "ACTIVE",
    hasApiKey: false,
  },
];

let bindings: { purpose: string; providerId: string; modelId: string }[] = [];

const CLASSIFICATION_CONTENT = JSON.stringify({
  candidates: [{ intentKey: "risk_root_cause", confidence: 0.95 }],
  outOfCatalog: false,
  extractedSlotsJson: "{}",
});

beforeAll(async () => {
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += String(c)));
    req.on("end", () => {
      const url = req.url ?? "/";
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      // —— 充当 DataCore（服务间凭证消费面） ——
      if (url === "/a/v1/llm-providers") {
        if (req.headers["x-service-token"] !== "svc-secret") return json(403, { error: { code: "FORBIDDEN", message: "no", requestId: "r" } });
        return json(200, PROVIDERS());
      }
      if (url === "/a/v1/llm-bindings") return json(200, { bindings });
      const cred = /^\/a\/v1\/llm-providers\/([^/]+)\/credential$/.exec(url);
      if (cred) {
        state.credentialFetches += 1;
        return json(200, { providerId: cred[1], apiKey: "sk-test" });
      }
      // —— 充当 openai_compatible 端点：/{name}/chat/completions ——
      const m = /^\/(p1|p2|p3|noso|bad)\/chat\/completions$/.exec(url);
      if (m) {
        const name = m[1] as string;
        state.calls[name] = (state.calls[name] ?? 0) + 1;
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          /* ignore */
        }
        state.lastBody[name] = body;
        state.lastAuth[name] = req.headers.authorization;
        if (state.fail.has(name)) return json(500, { error: "boom" });
        const usage = { prompt_tokens: 100, completion_tokens: 20 };
        if (name === "noso") {
          // 无结构化输出端点：永远回非 JSON 文本（JSON-mode 降级 + 重试均失败）
          return json(200, { choices: [{ message: { role: "assistant", content: "我不会输出 JSON 的。" }, finish_reason: "stop" }], usage });
        }
        const tools = body.tools as unknown[] | undefined;
        if (Array.isArray(tools) && tools.length > 0) {
          // agent 工具循环：直接文本收尾（end_turn → 降级文本回答）
          return json(200, { choices: [{ message: { role: "assistant", content: "已完成探索分析。" }, finish_reason: "stop" }], usage });
        }
        // 分类（response_format json_schema）
        return json(200, { choices: [{ message: { role: "assistant", content: CLASSIFICATION_CONTENT }, finish_reason: "stop" }], usage });
      }
      json(404, { error: "not found" });
    });
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
});

afterAll(() => stub.close());

function makeRouting(): { llm: RoutingLlmClient; directory: DataCoreProviderDirectory; metrics: Metrics } {
  const directory = new DataCoreProviderDirectory({ baseUrl: base, serviceToken: "svc-secret" });
  const metrics = new Metrics();
  const config = loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);
  const registry = new LlmProviderRegistry({ repos: createMemoryRepos(), config, metrics, directory });
  return { llm: new RoutingLlmClient(registry), directory, metrics };
}

const RISK_CONTEXT = { view: "risk", selectedObjects: [{ objectType: "Base", objectId: "base_changzhou", label: "常州" }] };

describe("L1 · 用途绑定后分类走配置端点（审计含 providerId）", () => {
  it("classifier 绑定 llmp1/m1 → 分类经 mock 端点（bearer 凭证）；任务审计含 providerId/modelId；token 指标带 provider 标签", async () => {
    bindings = [{ purpose: "classifier", providerId: "llmp1", modelId: "m1" }];
    const { llm, directory, metrics } = makeRouting();
    const t = await createTestApp({ llm, providerDirectory: directory });
    // 路径 A：分类高置信 → risk_root_cause 工作流
    const { taskId } = await submitQuery(t, PLANNER, "为什么这天越线", RISK_CONTEXT);
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("WORKFLOW");
    // §1.3 审计：每次 LLM 调用补 {providerId, modelId}
    expect(task.classification?.providerId).toBe("llmp1");
    expect(task.classification?.modelId).toBe("m1");
    expect(task.classification?.model).toBe("dcp:llmp1:m1");
    // 密钥经服务间凭证拉取并以 bearer 下发到端点（永不落 B 库）
    expect(state.lastAuth.p1).toBe("Bearer sk-test");
    expect(state.credentialFetches).toBeGreaterThanOrEqual(1);
    // qos_llm_tokens_total 增加 provider 标签
    expect(metrics.llmTokens.get({ model: "m1", direction: "input", provider: "llmp1" })).toBeGreaterThan(0);
  });

  it("provider 配置/凭证缓存：second call 命中缓存（60s TTL / 凭证 5min）", async () => {
    bindings = [{ purpose: "classifier", providerId: "llmp1", modelId: "m1" }];
    const { llm, directory } = makeRouting();
    const before = state.credentialFetches;
    await llm.classify({ model: "dcp:llmp1:m1", system: "s", user: "u", tenantId: "demo" });
    await llm.classify({ model: "dcp:llmp1:m1", system: "s", user: "u", tenantId: "demo" });
    expect(state.credentialFetches - before).toBe(1); // 凭证仅取一次（5min 内存缓存）
    expect(directory.stats.cacheHits).toBeGreaterThan(0);
    // 事件失效（§2.4）：invalidate 后 provider 配置重新拉取（配置变更会带新 updatedAt → 适配器/密钥随之重建）
    const fetchesBefore = directory.stats.fetches;
    directory.invalidate("demo");
    await llm.classify({ model: "dcp:llmp1:m1", system: "s", user: "u", tenantId: "demo" });
    expect(directory.stats.fetches).toBeGreaterThan(fetchesBefore);
  });
});

describe("L3 · 无结构化输出 → JSON-mode 降级 + zod 重试 ≤2 → 既有失败语义（转路径 B）", () => {
  it("noso 端点永远回非 JSON：每次分类尝试 ≤3 次 JSON-mode 请求（无 response_format），最终转路径 B", async () => {
    bindings = [
      { purpose: "classifier", providerId: "llmp_noso", modelId: "m2" },
      { purpose: "agent", providerId: "llmp1", modelId: "m1" },
    ];
    const { llm, directory } = makeRouting();
    const t = await createTestApp({ llm, providerDirectory: directory });
    state.calls.noso = 0;
    const { taskId } = await submitQuery(t, PLANNER, "随便聊聊产能", RISK_CONTEXT);
    const task = await waitForTask(t, taskId);
    // 既有失败语义：分类失败 → 路径 B（agent 兜底完成）
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("AGENT");
    // 降级形态：JSON-mode 提示（非原生 response_format）+ 每次尝试重试 ≤2（共 3 请求/尝试 × 3 尝试）
    expect(state.calls.noso).toBe(9);
    const lastNoso = state.lastBody.noso ?? {};
    expect(lastNoso.response_format).toBeUndefined();
    const sys = JSON.stringify(lastNoso.messages ?? []);
    expect(sys).toContain("JSON Schema"); // JSON-mode 提示词
    // 路径 B 的 agent 调用走 llmp1（tools 能力端点）
    expect(state.calls.p1 ?? 0).toBeGreaterThan(0);
  });
});

describe("L4 · provider 故障 → fallback 接管；禁止链式", () => {
  it("llmp_bad 故障 → llmp2 接管（指标 qos_llm_fallback_total 可见）", async () => {
    bindings = [{ purpose: "classifier", providerId: "llmp_bad", modelId: "m1" }];
    state.fail.add("bad");
    state.fail.delete("p2");
    const { llm, metrics } = makeRouting();
    const out = await llm.classify({ model: "dcp:llmp_bad:m1", system: "s", user: "u", tenantId: "demo" });
    expect(out.candidates[0]?.intentKey).toBe("risk_root_cause");
    expect(metrics.llmFallback.get({ from: "llmp_bad", to: "llmp2" })).toBe(1);
    expect(state.calls.p2 ?? 0).toBeGreaterThan(0);
  });

  it("fallback 的 fallback 不生效：llmp2 也故障 → 直接失败，llmp3 零调用", async () => {
    bindings = [{ purpose: "classifier", providerId: "llmp_bad", modelId: "m1" }];
    state.fail.add("bad");
    state.fail.add("p2");
    state.calls.p3 = 0;
    const { llm } = makeRouting();
    await expect(llm.classify({ model: "dcp:llmp_bad:m1", system: "s", user: "u", tenantId: "demo" })).rejects.toThrow();
    expect(state.calls.p3).toBe(0); // 链式禁止
    state.fail.delete("bad");
    state.fail.delete("p2");
  });
});
