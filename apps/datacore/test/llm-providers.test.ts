import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, debugUser, type TestApp } from "./helpers.js";

/**
 * LLM Provider 配置体系增量 §1（落位 DataCore）+ 引用模式增量 §2.3 A 侧：
 * L1 密钥 write-only / 连接测试（mock openai_compatible 端点）/ 服务间凭证 +
 * L2 能力绑定校验 + fallback 链式禁止 + 规则发布影响面/scope 缩窄警告。
 */

const TENANT_ADMIN = debugUser("demo", "tadmin", "tenant_admin");
const SERVICE = { "x-service-token": "svc-secret", "x-tenant-id": "demo", "x-service-caller": "agentcore" };

let stub: Server;
let stubUrl = "";
const stubSeen: { auth?: string; hits: number } = { hits: 0 };

beforeAll(async () => {
  // mock openai_compatible 端点：GET /models（连接测试探测用）
  stub = createServer((req, res) => {
    stubSeen.hits += 1;
    stubSeen.auth = req.headers.authorization;
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "qwen3-72b" }, { id: "qwen3-32b" }] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
  const addr = stub.address() as { port: number };
  stubUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  stub.close();
});

async function makeProviderApp(): Promise<TestApp> {
  return makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });
}

describe("LLM Provider 增量 §1.1 — CRUD + write-only 密钥 + 连接测试（L1）", () => {
  it("新建 openai_compatible provider：密钥不回显（hasApiKey）；连接测试返回延迟与模型探测", async () => {
    const t = await makeProviderApp();
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/llm-providers",
      headers: TENANT_ADMIN,
      payload: {
        name: "本地 vLLM-Qwen",
        kind: "openai_compatible",
        baseUrl: stubUrl,
        apiKey: "sk-vllm-secret",
        models: [
          { modelId: "qwen3-72b", displayName: "Qwen3", capabilities: { tools: false, structuredOutput: false, maxContext: 131072 } },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const provider = created.json() as Record<string, unknown>;
    expect(provider.hasApiKey).toBe(true);
    expect(JSON.stringify(provider)).not.toContain("sk-vllm-secret"); // no-secrets-echo
    expect(provider.apiKeyCiphertext).toBeUndefined();

    // 列表同样不回显
    const list = await t.app.inject({ method: "GET", url: "/a/v1/llm-providers", headers: TENANT_ADMIN });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain("sk-vllm-secret");

    // 连接测试：最小请求 → 延迟 + 可用模型探测（密钥以 bearer 下发到端点）
    const test = await t.app.inject({
      method: "POST",
      url: `/a/v1/llm-providers/${provider.id}/test`,
      headers: TENANT_ADMIN,
      payload: {},
    });
    expect(test.statusCode).toBe(200);
    const result = test.json() as { ok: boolean; latencyMs: number; probedModels: string[] };
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.probedModels).toContain("qwen3-72b");
    expect(stubSeen.auth).toBe("Bearer sk-vllm-secret");
  });

  it("非 tenant_admin 不可写；planner 读取 403", async () => {
    const t = await makeProviderApp();
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/llm-providers",
      headers: debugUser("demo", "p1", "planner"),
      payload: { name: "x", kind: "anthropic", models: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("fallback 链式禁止：目标自身已有 fallback → 400", async () => {
    const t = await makeProviderApp();
    const mk = async (name: string, fallbackProviderId?: string) => {
      const r = await t.app.inject({
        method: "POST",
        url: "/a/v1/llm-providers",
        headers: TENANT_ADMIN,
        payload: { name, kind: "openai_compatible", baseUrl: stubUrl, models: [], fallbackProviderId },
      });
      return r.json() as { id: string };
    };
    const a = await mk("A");
    const b = await mk("B", a.id); // B → A（合法，1 级）
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/llm-providers",
      headers: TENANT_ADMIN,
      payload: { name: "C", kind: "openai_compatible", baseUrl: stubUrl, models: [], fallbackProviderId: b.id },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { message: string } }).error.message).toContain("链式");
  });

  it("平台级模板（platform_admin）可被租户克隆（不带密钥）", async () => {
    const t = await makeProviderApp();
    const tpl = await t.app.inject({
      method: "POST",
      url: "/a/v1/llm-providers",
      headers: debugUser("demo", "padmin", "platform_admin"),
      payload: {
        name: "Anthropic 官方模板",
        kind: "anthropic",
        scope: "platform",
        apiKey: "sk-platform",
        models: [{ modelId: "claude-opus-4-8", displayName: "Opus", capabilities: { tools: true, structuredOutput: true, maxContext: 200000 } }],
      },
    });
    expect(tpl.statusCode).toBe(201);
    const tplId = (tpl.json() as { id: string }).id;
    const cloned = await t.app.inject({
      method: "POST",
      url: `/a/v1/llm-providers/${tplId}/clone`,
      headers: TENANT_ADMIN,
      payload: {},
    });
    expect(cloned.statusCode).toBe(201);
    const c = cloned.json() as { tenantId: string; hasApiKey: boolean; models: unknown[] };
    expect(c.tenantId).toBe("demo");
    expect(c.hasApiKey).toBe(false); // 模板克隆不复制密钥
    expect(c.models).toHaveLength(1);
  });
});

describe("服务间凭证（§1.1）：SERVICE_TOKEN only + 审计", () => {
  it("用户 JWT/debug 一律 403；X-Service-Token 返回解密密钥并产生审计事件", async () => {
    const t = await makeProviderApp();
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/llm-providers",
      headers: TENANT_ADMIN,
      payload: { name: "P", kind: "openai_compatible", baseUrl: stubUrl, apiKey: "sk-cred-1", models: [] },
    });
    const id = (created.json() as { id: string }).id;

    // 用户态（admin 也不行）→ 403：密钥永不到前端
    for (const headers of [TENANT_ADMIN, debugUser("demo", "admin", "admin")]) {
      const res = await t.app.inject({ method: "GET", url: `/a/v1/llm-providers/${id}/credential`, headers });
      expect(res.statusCode).toBe(403);
    }

    // 服务态 → 200 + 明文（仅服务间传输，B 内存缓存 5min、永不落库）
    const svc = await t.app.inject({ method: "GET", url: `/a/v1/llm-providers/${id}/credential`, headers: SERVICE });
    expect(svc.statusCode).toBe(200);
    expect((svc.json() as { apiKey: string }).apiKey).toBe("sk-cred-1");

    // 每次获取全审计：outbox 事件 llm.credential_fetched（含 caller）
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "llm.credential_fetched");
    expect(events.length).toBe(1);
    expect(events[0]?.payload).toMatchObject({ providerId: id, caller: "agentcore" });
  });

  it("SERVICE_TOKEN 未配置时服务头不被接受（401 兜底）", async () => {
    const t = await makeApp(); // 无 SERVICE_TOKEN
    const res = await t.app.inject({ method: "GET", url: "/a/v1/llm-providers", headers: { "x-service-token": "whatever", "x-tenant-id": "demo" } });
    expect(res.statusCode).toBe(401);
  });
});

describe("用途绑定矩阵（§1.3）：能力校验（L2）", () => {
  async function appWithProviders(): Promise<{ t: TestApp; noTools: string; full: string }> {
    const t = await makeProviderApp();
    const mk = async (name: string, tools: boolean, structuredOutput: boolean) => {
      const r = await t.app.inject({
        method: "POST",
        url: "/a/v1/llm-providers",
        headers: TENANT_ADMIN,
        payload: {
          name,
          kind: "openai_compatible",
          baseUrl: stubUrl,
          models: [{ modelId: "m1", displayName: "m1", capabilities: { tools, structuredOutput, maxContext: 128000 } }],
        },
      });
      return (r.json() as { id: string }).id;
    };
    return { t, noTools: await mk("无工具", false, false), full: await mk("全能力", true, true) };
  }

  it("L2：无 tools 能力绑定 agent 用途 → 拒绝并注明缺失能力", async () => {
    const { t, noTools } = await appWithProviders();
    const res = await t.app.inject({
      method: "PUT",
      url: "/a/v1/llm-bindings",
      headers: TENANT_ADMIN,
      payload: { bindings: [{ purpose: "agent", providerId: noTools, modelId: "m1" }] },
    });
    expect(res.statusCode).toBe(400);
    const msg = (res.json() as { error: { message: string } }).error.message;
    expect(msg).toContain("缺失能力：tools");
  });

  it("无 structuredOutput 绑定 classifier → 允许保存 + JSON-mode 降级警告；事件 llm_binding.updated", async () => {
    const { t, noTools, full } = await appWithProviders();
    const res = await t.app.inject({
      method: "PUT",
      url: "/a/v1/llm-bindings",
      headers: TENANT_ADMIN,
      payload: {
        bindings: [
          { purpose: "classifier", providerId: noTools, modelId: "m1" },
          { purpose: "agent", providerId: full, modelId: "m1" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { bindings: unknown[]; warnings: { purpose: string; message: string }[] };
    expect(body.bindings).toHaveLength(2);
    expect(body.warnings.some((w) => w.purpose === "classifier" && w.message.includes("JSON-mode"))).toBe(true);

    // 服务态可读绑定（B 消费）
    const svc = await t.app.inject({ method: "GET", url: "/a/v1/llm-bindings", headers: SERVICE });
    expect(svc.statusCode).toBe(200);
    expect((svc.json() as { bindings: unknown[] }).bindings).toHaveLength(2);

    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "llm_binding.updated");
    expect(events.length).toBe(1);
  });

  it("WO-11.3：PUT = 幂等替换（body 即全集）——省略的用途被解绑，不再 add-only 残留死绑定", async () => {
    const { t, full } = await appWithProviders();
    const put = (purposes: string[]) =>
      t.app.inject({
        method: "PUT",
        url: "/a/v1/llm-bindings",
        headers: TENANT_ADMIN,
        payload: { bindings: purposes.map((p) => ({ purpose: p, providerId: full, modelId: "m1" })) },
      });
    // 先绑两个用途
    await put(["classifier", "agent"]);
    let svc = await t.app.inject({ method: "GET", url: "/a/v1/llm-bindings", headers: SERVICE });
    expect((svc.json() as { bindings: { purpose: string }[] }).bindings.map((b) => b.purpose).sort()).toEqual(["agent", "classifier"]);
    // 再 PUT 只含 agent → classifier 应被解绑（替换语义，非追加）
    const res = await put(["agent"]);
    expect(res.statusCode).toBe(200);
    svc = await t.app.inject({ method: "GET", url: "/a/v1/llm-bindings", headers: SERVICE });
    expect((svc.json() as { bindings: { purpose: string }[] }).bindings.map((b) => b.purpose)).toEqual(["agent"]);
    // 被删用途也进事件失效集合（B 侧缓存可据此失效）
    const ev = await t.repos.outboxEvents.list("demo", (e) => e.event === "llm_binding.updated");
    expect(ev.some((e) => (e.payload as { purposes: string[] }).purposes.includes("classifier"))).toBe(true);
  });

  it("WO-11.3：DELETE /a/v1/llm-bindings/:purpose 撤回错绑（幂等）", async () => {
    const { t, full } = await appWithProviders();
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/llm-bindings",
      headers: TENANT_ADMIN,
      payload: { bindings: [{ purpose: "agent", providerId: full, modelId: "m1" }, { purpose: "classifier", providerId: full, modelId: "m1" }] },
    });
    const del = await t.app.inject({ method: "DELETE", url: "/a/v1/llm-bindings/classifier", headers: TENANT_ADMIN });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { bindings: { purpose: string }[] }).bindings.map((b) => b.purpose)).toEqual(["agent"]);
    // 幂等：再删一次不报错，全集不变
    const again = await t.app.inject({ method: "DELETE", url: "/a/v1/llm-bindings/classifier", headers: TENANT_ADMIN });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { bindings: { purpose: string }[] }).bindings.map((b) => b.purpose)).toEqual(["agent"]);
  });
});

describe("引用模式增量 §2.3 A 侧：引用上报 + 规则发布影响面（L5 A 半）", () => {
  it("B 上报引用 → 规则 publish 响应含 impact + references 端点统一形态；scope 缩窄 → 非阻断警告", async () => {
    const t = await makeProviderApp();
    // B 上报：agent explore_agent 与 plan capacity_feasibility 引用规则 C08（latest）
    for (const [kind, key] of [["agent", "explore_agent"], ["plan", "capacity_feasibility"]] as const) {
      const rep = await t.app.inject({
        method: "POST",
        url: "/a/v1/references/report",
        headers: SERVICE,
        payload: { source: { kind, key, name: key }, refs: [{ kind: "rule", key: "C08", version: "latest" }] },
      });
      expect(rep.statusCode).toBe(204);
    }
    // 用户态上报被拒（服务间专用）
    const userRep = await t.app.inject({
      method: "POST",
      url: "/a/v1/references/report",
      headers: TENANT_ADMIN,
      payload: { source: { kind: "agent", key: "x" }, refs: [] },
    });
    expect(userRep.statusCode).toBe(403);

    // v1 发布（宽 scope）
    const v1 = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules",
      headers: TENANT_ADMIN,
      payload: { key: "C08", name: "外协红线", expression: "Plan.outsourceRatio > 0.3", scopeObjectTypes: ["Plan", "Order"], severity: "WARN", status: "PUBLISHED" },
    });
    expect(v1.statusCode).toBe(201);

    // v2（阈值变更 + scope 缩窄）→ publish 响应附影响面与警告
    const v2 = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules",
      headers: TENANT_ADMIN,
      payload: { key: "C08", name: "外协红线", expression: "Plan.outsourceRatio > 0.2", scopeObjectTypes: ["Plan"], severity: "WARN" },
    });
    const v2id = (v2.json() as { id: string }).id;
    const pub = await t.app.inject({ method: "POST", url: `/a/v1/rules/${v2id}/publish`, headers: TENANT_ADMIN, payload: {} });
    expect(pub.statusCode).toBe(200);
    const body = pub.json() as {
      status: string;
      version: number;
      impact: { agents: number; plans: number; intents: number; refs: { kind: string; key: string }[] };
      warnings: { code: string }[];
    };
    expect(body.status).toBe("PUBLISHED");
    expect(body.version).toBe(2);
    expect(body.impact.agents).toBe(1);
    expect(body.impact.plans).toBe(1);
    expect(body.impact.refs.map((r) => r.key).sort()).toEqual(["capacity_feasibility", "explore_agent"]);
    expect(body.warnings.some((w) => w.code === "RULE_SCOPE_NARROWED")).toBe(true);

    // references 端点（统一形态 {references, count}）
    const refs = await t.app.inject({ method: "GET", url: `/a/v1/rules/${v2id}/references`, headers: TENANT_ADMIN });
    expect((refs.json() as { count: number }).count).toBe(2);

    // 求值带 ruleVersion（§2.2 留痕）且新版阈值立即生效（执行时解析，零运营动作）
    const ev = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules/evaluate",
      headers: TENANT_ADMIN,
      payload: { ruleIds: ["C08"], payload: { Plan: { outsourceRatio: 0.25 } } },
    });
    const verdicts = ev.json() as { ruleId: string; passed: boolean; ruleVersion: number }[];
    expect(verdicts[0]?.ruleVersion).toBe(2);
    expect(verdicts[0]?.passed).toBe(false); // 新阈值 0.2 → 0.25 违规

    // 变更通知：rules.updated outbox 事件已产生（webhook 投递由 C-2 机制负责）
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "rules.updated");
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});

describe("TenantRoutedLlmClient（A2/A3/A7 用途路由 + fallback）", () => {
  it("extraction 绑定 → 经绑定 provider/model 调用（含 JSON-mode 降级）；无绑定回落默认；故障走 fallback（禁止链式）", async () => {
    const { z } = await import("zod");
    const { createMemoryRepos } = await import("../src/repo/memory.js");
    const { CredentialCipher } = await import("../src/crypto.js");
    const { Metrics } = await import("../src/metrics.js");
    const { TenantRoutedLlmClient } = await import("../src/llmproviders.js");
    const { ScriptedLlmClient } = await import("../src/llm.js");

    const repos = createMemoryRepos();
    const now = new Date().toISOString();
    const mkProvider = (id: string, so: boolean, fallbackProviderId?: string) => ({
      id, tenantId: "demo", name: id, kind: "openai_compatible" as const, baseUrl: "http://x",
      models: [{ modelId: "m1", displayName: "m1", capabilities: { tools: false, structuredOutput: so, maxContext: 1000 } }],
      status: "ACTIVE" as const, fallbackProviderId, createdAt: now, updatedAt: now,
    });
    await repos.llmProviders.put(mkProvider("llmp_x", true, "llmp_fb"));
    await repos.llmProviders.put(mkProvider("llmp_fb", true, "llmp_third"));
    await repos.llmProviders.put(mkProvider("llmp_third", true));
    await repos.llmPurposeBindings.put({ id: "llmb_demo_extraction", tenantId: "demo", purpose: "extraction", providerId: "llmp_x", modelId: "m1", updatedAt: now });

    const calls: { provider: string; model: string }[] = [];
    const behavior: Record<string, "ok" | "fail"> = { llmp_x: "ok", llmp_fb: "ok", llmp_third: "ok" };
    const fakeAdapter = (rec: { id: string }) => ({
      async parse(req: { model: string }) {
        calls.push({ provider: rec.id, model: req.model });
        if (behavior[rec.id] === "fail") throw new Error("endpoint down");
        return { value: `from-${rec.id}` };
      },
      async complete() { throw new Error("unused"); },
      async *toolLoop() { /* unused */ },
      async classify() { throw new Error("unused"); },
      async agent() { throw new Error("unused"); },
      async compose() { return ""; },
    });

    const fallbackDefault = new ScriptedLlmClient().enqueue({ value: "from-default" });
    const metrics = new Metrics();
    const routed = new TenantRoutedLlmClient(
      repos, new CredentialCipher("k".repeat(64)), fallbackDefault, metrics,
      (rec) => fakeAdapter(rec) as never,
    );
    const schema = z.object({ value: z.string() });
    const req = { model: "env-default-model", maxTokens: 100, system: "s", messages: [{ role: "user" as const, content: "u" }], schema };

    // 绑定命中：走 llmp_x/m1（模型覆盖 env 默认），审计指标带 provider/model
    const out = await routed.parseStructured({ ...req, tenantId: "demo", purpose: "extraction" });
    expect(out).toEqual({ value: "from-llmp_x" });
    expect(calls.at(-1)).toEqual({ provider: "llmp_x", model: "m1" });
    expect(metrics.get("dc_llm_calls_total", { purpose: "extraction", provider: "llmp_x", model: "m1" })).toBe(1);

    // 无绑定（其他用途）→ 回落 env 默认 client
    const out2 = await routed.parseStructured({ ...req, tenantId: "demo", purpose: "modeling" });
    expect(out2).toEqual({ value: "from-default" });

    // provider 故障 → fallback 接管；fallback 也故障 → 抛错且第三级不被调用（禁止链式）
    behavior.llmp_x = "fail";
    const out3 = await routed.parseStructured({ ...req, tenantId: "demo", purpose: "extraction" });
    expect(out3).toEqual({ value: "from-llmp_fb" });
    expect(metrics.get("dc_llm_fallback_total", { from: "llmp_x", to: "llmp_fb" })).toBe(1);
    behavior.llmp_fb = "fail";
    await expect(routed.parseStructured({ ...req, tenantId: "demo", purpose: "extraction" })).rejects.toThrow();
    expect(calls.filter((c) => c.provider === "llmp_third")).toHaveLength(0);
  });
});
