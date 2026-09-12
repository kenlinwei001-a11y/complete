import { describe, expect, it } from "vitest";
import type { LlmProviderConfig } from "@platform/contracts";
import { runAgentLoop, type AgentToolSpec } from "../src/agent/loop.js";
import { loadConfig } from "../src/config.js";
import { encryptSecret } from "../src/crypto.js";
import { ClassifierParseError } from "../src/llm/anthropic.js";
import { ScriptedLlmClient } from "../src/llm/mock.js";
import {
  OpenAiLlmClient,
  type OpenAiChatCompletion,
  type OpenAiChatMessage,
  type OpenAiChatPort,
} from "../src/llm/openai.js";
import { LlmProviderRegistry, RoutingLlmClient } from "../src/llm/providers.js";
import { Metrics } from "../src/metrics.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { ADMIN, createTestApp, debugHeaders, PLANNER, submitQuery, TENANT, waitForTask } from "./helpers.js";

/** Stubbed openai SDK shape — adapter-level unit tests run with NO network. */
class StubOpenAi implements OpenAiChatPort {
  readonly requests: Record<string, unknown>[] = [];
  readonly script: ((params: Record<string, unknown>) => OpenAiChatCompletion)[] = [];
  chat = {
    completions: {
      create: async (params: Record<string, unknown>): Promise<OpenAiChatCompletion> => {
        this.requests.push(params);
        const next = this.script.shift();
        if (!next) throw new Error("StubOpenAi: no scripted completion");
        return next(params);
      },
    },
  };
}

function assistant(msg: Partial<OpenAiChatMessage>, finish = "stop"): OpenAiChatCompletion {
  return {
    choices: [{ message: { role: "assistant", content: null, ...msg }, finish_reason: finish }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  };
}

describe("OpenAI adapter (amends QOS-PRD §6 — multi-provider)", () => {
  it("classification: json_schema strict round-trip, parsed + zod-validated", async () => {
    const stub = new StubOpenAi();
    stub.script.push(() =>
      assistant({
        content: JSON.stringify({
          candidates: [{ intentKey: "affected_orders", confidence: 0.92 }],
          outOfCatalog: false,
          extractedSlotsJson: JSON.stringify({ base: "常州" }),
        }),
      }),
    );
    const llm = new OpenAiLlmClient({ client: stub, metrics: new Metrics() });
    const result = await llm.classify({ model: "gpt-test", system: "sys", user: "常州影响哪些订单" });

    expect(result.candidates).toEqual([{ intentKey: "affected_orders", confidence: 0.92 }]);
    expect(result.outOfCatalog).toBe(false);
    expect(result.extractedSlots).toEqual({ base: "常州" });

    const req = stub.requests[0] as {
      model: string;
      messages: { role: string }[];
      response_format: { type: string; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } };
    };
    expect(req.model).toBe("gpt-test");
    expect(req.response_format.type).toBe("json_schema");
    // strict:false 是刻意为之——实测 Moonshot/Kimi 在 strict:true 下返空/不可解析且会加 reason 等额外字段；
    // 兼容端点放宽 strict，靠 zod 校验兜底（见 packages/llm-adapters/src/openai.ts classifyOnce）。
    expect(req.response_format.json_schema.strict).toBe(false);
    expect(req.response_format.json_schema.name).toBe("intent_classification");
    expect(req.response_format.json_schema.schema.type).toBe("object");
    expect(req.messages[0]?.role).toBe("system");
    expect(req.messages[1]?.role).toBe("user");
  });

  it("classification: unparsable content → ClassifierParseError (typed, no string matching)", async () => {
    const stub = new StubOpenAi();
    // classify 对不可解析结果有界重试 3 次（思维型模型偶发空/不可解析 → 重试即稳）；
    // 此处每次都喂不可解析内容，耗尽重试 → 抛 ClassifierParseError（脚本须铺满 3 次）。
    for (let i = 0; i < 3; i++) stub.script.push(() => assistant({ content: "definitely not json" }));
    const llm = new OpenAiLlmClient({ client: stub });
    await expect(llm.classify({ model: "m", system: "s", user: "u" })).rejects.toBeInstanceOf(ClassifierParseError);

    // schema-invalid JSON also maps to ClassifierParseError（同样铺满 3 次重试）
    for (let i = 0; i < 3; i++) stub.script.push(() => assistant({ content: JSON.stringify({ candidates: "nope" }) }));
    await expect(llm.classify({ model: "m", system: "s", user: "u" })).rejects.toBeInstanceOf(ClassifierParseError);
  });

  it("agent tool loop: two-iteration script — tools mapping, tool_calls ↔ role:tool round-trip, final_answer short-circuit", async () => {
    const stub = new StubOpenAi();
    // turn 1: model calls query_objects via OpenAI function calling
    stub.script.push(() =>
      assistant(
        {
          content: "我需要查基地数据。",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "query_objects", arguments: JSON.stringify({ objectType: "Base", filter: {} }) },
            },
          ],
        },
        "tool_calls",
      ),
    );
    // turn 2: tool result came back as role:"tool" → model answers via final_answer
    stub.script.push((params) => {
      const messages = params.messages as OpenAiChatMessage[];
      const toolMsg = messages.find((m) => m.role === "tool");
      expect(toolMsg).toBeDefined();
      expect(toolMsg?.tool_call_id).toBe("call_1");
      expect(toolMsg?.content).toContain("<tool_data");
      // assistant tool_calls message echoed verbatim before the tool result
      const echoed = messages.find((m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0);
      expect(echoed?.tool_calls?.[0]?.id).toBe("call_1");
      const tc = /tool_call_id="(tc_[A-Z0-9]+)"/.exec(String(toolMsg?.content))?.[1] as string;
      return assistant(
        {
          tool_calls: [
            {
              id: "call_2",
              type: "function",
              function: {
                name: "final_answer",
                arguments: JSON.stringify({
                  blocks: [{ type: "text", markdown: "共 12 个基地 ⟦ref:0⟧。" }],
                  provenance: [{ toolCallId: tc, outputPath: "$.data.items" }],
                }),
              },
            },
          ],
        },
        "tool_calls",
      );
    });

    const repos = createMemoryRepos();
    const metrics = new Metrics();
    const budget = new BudgetTracker();
    const executor = new GuardedToolExecutor(
      { dataCore: createMockDataCore(), repos, metrics },
      { taskId: "task_openai_loop", ctx: { tenantId: TENANT, userId: "u1", roles: ["planner"] }, budget },
    );
    const tools: AgentToolSpec[] = [
      {
        name: "query_objects",
        description: "查询本体对象",
        inputSchema: { type: "object", properties: { objectType: { type: "string" }, filter: { type: "object" } } },
        binding: { kind: "BUILTIN" },
      },
    ];

    const result = await runAgentLoop({
      taskId: "task_openai_loop",
      model: "gpt-test",
      system: "sys",
      userContent: "有多少基地？",
      tools,
      llm: new OpenAiLlmClient({ client: stub }),
      executor,
      budget,
      repos,
      metrics,
      emit: async () => undefined,
    });

    expect(result.outcome).toBe("ANSWERED");
    expect(result.answer.provenance.length).toBe(1);
    expect(result.answer.provenance[0]?.toolName).toBe("query_objects");

    // request 1 carried OpenAI-style function tools incl. final_answer appended by the loop
    const req1 = stub.requests[0] as { tools: { type: string; function: { name: string; parameters: unknown } }[] };
    expect(req1.tools.every((t) => t.type === "function")).toBe(true);
    expect(req1.tools.map((t) => t.function.name)).toContain("query_objects");
    expect(req1.tools.map((t) => t.function.name)).toContain("final_answer");
    expect(req1.tools[0]?.function.parameters).toBeDefined();
  });

  it("error mapping: is_error tool results become role:tool content prefixed 'ERROR: '", async () => {
    const stub = new StubOpenAi();
    stub.script.push(() => assistant({ content: "ok" }));
    const llm = new OpenAiLlmClient({ client: stub });
    await llm.agent({
      model: "m",
      system: "s",
      tools: [],
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: [{ type: "tool_use", id: "call_9", name: "x", input: {} }] },
        { role: "user", content: [{ type: "tool_result", toolUseId: "call_9", content: "无权访问", isError: true }] },
      ],
    });
    const messages = (stub.requests[0] as { messages: OpenAiChatMessage[] }).messages;
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("call_9");
    expect(toolMsg?.content).toBe("ERROR: 无权访问");
  });
});

describe("Provider registry + routing + bindings (amends QOS-PRD §6)", () => {
  it("resolves providerKey:model specs (tenant config, apiKeyEnv + credentialRef) and plain specs (default provider)", async () => {
    const config = loadConfig({ LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);
    const repos = createMemoryRepos();
    process.env.TEST_DS_KEY = "sk-from-env";
    await repos.llmProviders.upsert({
      id: "llmp_ds",
      tenantId: "t1",
      key: "deepseek",
      kind: "openai_compatible",
      baseUrl: "http://localhost:9999/v1",
      apiKeyEnv: "TEST_DS_KEY",
      status: "ACTIVE",
    });
    const credId = "cred_q1";
    await repos.credentials.insert({
      id: credId,
      tenantId: "t1",
      name: "llm:qwen",
      ciphertext: encryptSecret("sk-from-cred", config.CREDENTIAL_KEY),
      createdAt: new Date().toISOString(),
    });
    await repos.llmProviders.upsert({
      id: "llmp_qw",
      tenantId: "t1",
      key: "qwen",
      kind: "openai_compatible",
      baseUrl: "http://localhost:8888/v1",
      credentialRef: credId,
      status: "ACTIVE",
    });

    const made: { cfg: LlmProviderConfig; apiKey: string | undefined }[] = [];
    const scripted = new ScriptedLlmClient();
    const registry = new LlmProviderRegistry({
      repos,
      config,
      factory: (cfg, apiKey) => {
        made.push({ cfg, apiKey });
        return scripted;
      },
    });

    const ds = await registry.resolve("deepseek:deepseek-chat", "t1");
    expect(ds.model).toBe("deepseek-chat");
    expect(ds.providerKey).toBe("deepseek");
    expect(made[0]?.cfg.kind).toBe("openai_compatible");
    expect(made[0]?.cfg.baseUrl).toBe("http://localhost:9999/v1");
    expect(made[0]?.apiKey).toBe("sk-from-env");

    const qw = await registry.resolve("qwen:qwen-max", "t1");
    expect(qw.model).toBe("qwen-max");
    expect(made[1]?.apiKey).toBe("sk-from-cred"); // AES-GCM credentialRef decrypted

    // plain spec → default provider (anthropic builtin)
    const plain = await registry.resolve("claude-haiku-4-5");
    expect(plain.model).toBe("claude-haiku-4-5");
    expect(plain.providerKey).toBe("anthropic");
    expect(made[2]?.cfg.kind).toBe("anthropic");

    // adapter cache: same provider resolved again → no extra factory call
    await registry.resolve("deepseek:deepseek-reasoner", "t1");
    expect(made.length).toBe(3);

    // RoutingLlmClient delegates with the PLAIN model id
    scripted.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const routing = new RoutingLlmClient(registry);
    await routing.classify({ model: "deepseek:deepseek-chat", system: "s", user: "u", tenantId: "t1" });
    expect(scripted.classifyRequests[0]?.model).toBe("deepseek-chat");
  });

  it("CRUD /b/v1/llm/providers + /b/v1/llm/bindings — credential never echoed; binding drives classifier model spec", async () => {
    const t = await createTestApp();

    const create = await t.app.inject({
      method: "POST",
      url: "/b/v1/llm/providers",
      headers: debugHeaders(ADMIN),
      payload: {
        key: "deepseek",
        kind: "openai_compatible",
        baseUrl: "https://api.deepseek.com",
        credential: "sk-super-secret",
        status: "ACTIVE",
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as LlmProviderConfig & { credential?: string };
    expect(created.credential).toBeUndefined(); // never echoed
    expect(created.credentialRef).toMatch(/^cred_/);
    expect(JSON.stringify(create.json())).not.toContain("sk-super-secret");

    const list = await t.app.inject({ method: "GET", url: "/b/v1/llm/providers", headers: debugHeaders(PLANNER) });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain("sk-super-secret");

    // stored encrypted (AES-GCM), not plaintext
    const cred = await t.repos.credentials.get(created.credentialRef as string);
    expect(cred?.ciphertext).toBeDefined();
    expect(cred?.ciphertext).not.toContain("sk-super-secret");

    // bindings: classifier role → deepseek; package has no classifierModel → binding wins over env default
    const put = await t.app.inject({
      method: "PUT",
      url: "/b/v1/llm/bindings",
      headers: debugHeaders(ADMIN),
      payload: { bindings: [{ role: "classifier", providerKey: "deepseek", model: "deepseek-chat" }] },
    });
    expect(put.statusCode).toBe(200);

    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const { taskId } = await submitQuery(t, PLANNER, "随便问问目录外问题", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(t.llm.classifyRequests[0]?.model).toBe("deepseek:deepseek-chat");
    await t.app.close();
  });
});
