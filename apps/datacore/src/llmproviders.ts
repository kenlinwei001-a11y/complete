import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  LlmModelCapabilitiesSchema,
  LlmProviderKindV2Schema,
  LlmPurposeSchema,
  PLATFORM_TENANT_ID,
  PURPOSE_CAPABILITY_REQUIREMENTS,
  type LlmProvider,
  type LlmPurpose,
  type PurposeBinding,
} from "@platform/contracts";
import {
  AnthropicAdapter,
  CustomHttpAdapter,
  OpenAICompatAdapter,
  type FullLlmClient,
} from "@platform/llm-adapters";
import { AdapterBackedLlmClient, LlmParseError, type LlmClient, type LlmParseRequest } from "./llm.js";
import type { AuthCtx, LlmProviderRecord, LlmPurposeBindingRecord, ReportedRefRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { CredentialCipher } from "./crypto.js";
import type { OutboxService } from "./outbox.js";
import type { Metrics } from "./metrics.js";
import { AppError, forbidden, notFound, validationError } from "./errors.js";
import { newId } from "./ids.js";

/**
 * LLM Provider 配置体系增量 §1（落位 DataCore —— 与凭据加密、租户管理同处）。
 *
 * - apiKey write-only：写入即 AES-GCM 密文（与连接器凭据同套 CredentialCipher），
 *   任何响应/日志永不回显明文，仅 hasApiKey。
 * - 服务间凭证：GET /a/v1/llm-providers/{id}/credential 仅接受 X-Service-Token
 *   （roles 含 "service"）；用户 JWT 一律 403 —— 密钥永不到前端、永不落 B 库；
 *   每次获取经 outbox 审计（llm.credential_fetched，含 caller）。
 * - fallback ≤1 级：配置时拒绝链式（目标自身已有 fallback → 400）。
 * - 变更即发 outbox 事件 llm_provider.updated / llm_binding.updated（§2.4：B 据此
 *   立即失效缓存；事件通路故障时由 60s TTL 兜底，传播延迟 SLO ≤60s）。
 */

const ModelsSchema = z.array(
  z.object({
    modelId: z.string().min(1),
    displayName: z.string().default(""),
    capabilities: LlmModelCapabilitiesSchema,
  }),
);

export const LlmProviderCreateSchema = z.object({
  name: z.string().min(1),
  kind: LlmProviderKindV2Schema,
  baseUrl: z.string().optional(),
  /** write-only：保存后任何响应不回显，仅 hasApiKey */
  apiKey: z.string().optional(),
  models: ModelsSchema.default([]),
  status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
  fallbackProviderId: z.string().optional(),
  /** platform_admin 维护平台级模板（租户可克隆） */
  scope: z.enum(["tenant", "platform"]).default("tenant"),
});

/** PUT 专用：无 default（zod partial 仍会应用 default，避免空 models/status 覆盖既有值）。 */
export const LlmProviderUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  kind: LlmProviderKindV2Schema.optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  models: ModelsSchema.optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  fallbackProviderId: z.string().optional(),
});

const BindingsPutSchema = z.object({
  bindings: z.array(
    z.object({
      purpose: LlmPurposeSchema,
      providerId: z.string(),
      modelId: z.string(),
      // 关思考开关（Moonshot kimi-k2.5/k2.6）：true → 该用途调用注入 thinking:{type:"disabled"}（秒级直出）
      disableThinking: z.boolean().optional(),
    }),
  ),
});

const RefReportSchema = z.object({
  source: z.object({ kind: z.string(), key: z.string(), name: z.string().optional() }),
  refs: z.array(
    z.object({
      kind: z.string(),
      key: z.string(),
      version: z.union([z.number().int(), z.literal("latest")]).default("latest"),
    }),
  ),
});

function toPublic(rec: LlmProviderRecord): LlmProvider {
  const { apiKeyCiphertext, ...rest } = rec;
  return { ...rest, hasApiKey: Boolean(apiKeyCiphertext) };
}

export class LlmProviderService {
  constructor(
    private repos: Repos,
    private cipher: CredentialCipher,
    private outbox: OutboxService,
  ) {}

  /** 租户自有 + 平台级模板（克隆源）。 */
  async list(tenantId: string): Promise<LlmProvider[]> {
    const own = await this.repos.llmProviders.list(tenantId);
    const templates = tenantId === PLATFORM_TENANT_ID ? [] : await this.repos.llmProviders.list(PLATFORM_TENANT_ID);
    return [...own, ...templates].map(toPublic);
  }

  async getRecord(tenantId: string, id: string): Promise<LlmProviderRecord> {
    const rec =
      (await this.repos.llmProviders.get(tenantId, id)) ??
      (await this.repos.llmProviders.get(PLATFORM_TENANT_ID, id));
    if (!rec) throw notFound("llm provider");
    return rec;
  }

  private async validateFallback(tenantId: string, selfId: string | undefined, fallbackProviderId?: string): Promise<void> {
    if (!fallbackProviderId) return;
    if (fallbackProviderId === selfId) throw validationError("fallbackProviderId 不能指向自身");
    const target = await this.repos.llmProviders.get(tenantId, fallbackProviderId);
    if (!target) throw validationError(`fallback 目标不存在：${fallbackProviderId}`);
    // ≤1 级，禁止链式：目标自身不得再有 fallback
    if (target.fallbackProviderId) {
      throw validationError(`禁止链式 fallback：目标 ${target.name} 自身已配置 fallbackProviderId`);
    }
  }

  async create(ctx: AuthCtx, input: z.infer<typeof LlmProviderCreateSchema>): Promise<LlmProvider> {
    const tenantId = input.scope === "platform" ? PLATFORM_TENANT_ID : ctx.tenantId;
    if (input.kind === "openai_compatible" && !input.baseUrl) {
      throw validationError("openai_compatible 必须提供 baseUrl");
    }
    await this.validateFallback(tenantId, undefined, input.fallbackProviderId);
    const now = new Date().toISOString();
    const rec: LlmProviderRecord = {
      id: newId("llmp"),
      tenantId,
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      apiKeyCiphertext: input.apiKey ? this.cipher.encrypt(input.apiKey) : undefined,
      models: input.models,
      status: input.status,
      fallbackProviderId: input.fallbackProviderId,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.llmProviders.put(rec);
    await this.outbox.emit(tenantId, "llm_provider.updated", { providerId: rec.id, op: "create" });
    return toPublic(rec);
  }

  async update(ctx: AuthCtx, id: string, patch: z.infer<typeof LlmProviderUpdateSchema>): Promise<LlmProvider> {
    const rec = await this.repos.llmProviders.get(ctx.tenantId, id);
    if (!rec) throw notFound("llm provider");
    if (patch.fallbackProviderId !== undefined) {
      await this.validateFallback(ctx.tenantId, id, patch.fallbackProviderId || undefined);
    }
    const updated: LlmProviderRecord = {
      ...rec,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
      ...(patch.models !== undefined ? { models: patch.models } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.fallbackProviderId !== undefined ? { fallbackProviderId: patch.fallbackProviderId || undefined } : {}),
      // 「更换」密钥：apiKey 出现才覆盖（write-only）；空字符串 = 清除
      ...(patch.apiKey !== undefined
        ? { apiKeyCiphertext: patch.apiKey ? this.cipher.encrypt(patch.apiKey) : undefined }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.repos.llmProviders.put(updated);
    await this.outbox.emit(ctx.tenantId, "llm_provider.updated", { providerId: id, op: "update" });
    return toPublic(updated);
  }

  /** 平台级模板克隆为租户 provider（不复制密钥 —— 租户须自行配置）。 */
  async clone(ctx: AuthCtx, templateId: string): Promise<LlmProvider> {
    const tpl = await this.repos.llmProviders.get(PLATFORM_TENANT_ID, templateId);
    if (!tpl) throw notFound("platform llm provider template");
    const now = new Date().toISOString();
    const rec: LlmProviderRecord = {
      ...tpl,
      id: newId("llmp"),
      tenantId: ctx.tenantId,
      apiKeyCiphertext: undefined,
      fallbackProviderId: undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.llmProviders.put(rec);
    await this.outbox.emit(ctx.tenantId, "llm_provider.updated", { providerId: rec.id, op: "clone", from: templateId });
    return toPublic(rec);
  }

  /** 服务间凭证：解密密钥（调用方负责审计事件）。 */
  decryptedKey(rec: LlmProviderRecord): string | undefined {
    return rec.apiKeyCiphertext ? this.cipher.decrypt(rec.apiKeyCiphertext) : undefined;
  }

  /**
   * 连接测试（§1.4）：发一条最小请求 → 延迟 + 可用模型探测。
   * openai_compatible / anthropic（带 baseUrl）→ GET {baseUrl}/models；
   * custom_http → 预留接口，明确提示。可注入 fetchImpl（测试/parity 用本地 stub）。
   */
  async test(
    ctx: AuthCtx,
    id: string,
    fetchImpl: typeof fetch,
  ): Promise<{ ok: boolean; latencyMs?: number; probedModels?: string[]; message?: string }> {
    const rec = await this.getRecord(ctx.tenantId, id);
    if (rec.kind === "custom_http") {
      return { ok: false, message: "custom_http 适配器为预留接口，本期不支持连接测试" };
    }
    const base = rec.baseUrl ?? (rec.kind === "anthropic" ? "https://api.anthropic.com" : undefined);
    if (!base) return { ok: false, message: "未配置 baseUrl，无法探测端点" };
    const url = `${base.replace(/\/$/, "")}${rec.kind === "anthropic" && !rec.baseUrl ? "/v1" : ""}/models`;
    const key = rec.apiKeyCiphertext ? this.cipher.decrypt(rec.apiKeyCiphertext) : undefined;
    const t0 = Date.now();
    try {
      const res = await fetchImpl(url, {
        headers: {
          ...(key
            ? rec.kind === "anthropic"
              ? { "x-api-key": key }
              : { authorization: `Bearer ${key}` }
            : {}),
        },
      });
      const latencyMs = Date.now() - t0;
      if (!res.ok) return { ok: false, latencyMs, message: `端点返回 ${res.status}` };
      const body = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
      const probedModels = Array.isArray(body.data)
        ? body.data.map((m) => String(m.id ?? "")).filter(Boolean).slice(0, 20)
        : undefined;
      return { ok: true, latencyMs, probedModels };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        message: `连接失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ---- 用途绑定（§1.3 用途矩阵：租户级默认） --------------------------------

  async bindings(tenantId: string): Promise<PurposeBinding[]> {
    const recs = await this.repos.llmPurposeBindings.list(tenantId);
    return recs.map((r) => ({
      purpose: r.purpose as LlmPurpose,
      providerId: r.providerId,
      modelId: r.modelId,
      ...(r.disableThinking ? { disableThinking: true } : {}),
    }));
  }

  /**
   * 绑定校验（§1.2/§1.3）：`tools` 为硬性要求（无原生 tools → 不可绑定 agent 用途，
   * 绑定时拒绝并注明缺失能力 —— 工具循环不做提示词模拟）；`structuredOutput` 缺失
   * 允许保存（运行期 JSON-mode 降级），响应附 warnings。
   */
  async putBindings(
    ctx: AuthCtx,
    bindings: { purpose: LlmPurpose; providerId: string; modelId: string; disableThinking?: boolean }[],
  ): Promise<{ bindings: PurposeBinding[]; warnings: { purpose: string; message: string }[] }> {
    const warnings: { purpose: string; message: string }[] = [];
    for (const b of bindings) {
      const provider =
        (await this.repos.llmProviders.get(ctx.tenantId, b.providerId)) ??
        (await this.repos.llmProviders.get(PLATFORM_TENANT_ID, b.providerId));
      if (!provider) throw validationError(`provider 不存在：${b.providerId}`);
      if (provider.status !== "ACTIVE") throw validationError(`provider 已停用：${provider.name}`);
      const model = provider.models.find((m) => m.modelId === b.modelId);
      if (!model) throw validationError(`provider「${provider.name}」无模型：${b.modelId}`);
      const req = PURPOSE_CAPABILITY_REQUIREMENTS[b.purpose];
      if (req.tools && !model.capabilities.tools) {
        throw new AppError(
          "VALIDATION_ERROR",
          `绑定被拒：用途「${b.purpose}」要求模型具备 tools 能力，` +
            `而 ${provider.name}/${b.modelId} 缺失能力：tools（工具循环不做提示词模拟）`,
          400,
        );
      }
      if (req.structuredOutput && !model.capabilities.structuredOutput) {
        warnings.push({
          purpose: b.purpose,
          message: `${provider.name}/${b.modelId} 无原生 structuredOutput —— 运行期走 JSON-mode 降级（zod 校验重试 ≤2）`,
        });
      }
    }
    for (const b of bindings) {
      const rec: LlmPurposeBindingRecord = {
        id: `llmb_${ctx.tenantId}_${b.purpose}`,
        tenantId: ctx.tenantId,
        purpose: b.purpose,
        providerId: b.providerId,
        modelId: b.modelId,
        ...(b.disableThinking ? { disableThinking: true } : {}),
        updatedAt: new Date().toISOString(),
      };
      await this.repos.llmPurposeBindings.put(rec);
    }
    // WO-11.3：PUT = 幂等替换（body 即用途绑定全集）。body 中省略的用途 → 解绑（删除其绑定记录），
    // 否则错绑无法仅靠 PUT 撤回（旧 add-only 语义遗留死绑定）。被删用途一并进事件失效集合。
    const keep = new Set(bindings.map((b) => b.purpose));
    const removed: string[] = [];
    for (const rec of await this.repos.llmPurposeBindings.list(ctx.tenantId)) {
      if (!keep.has(rec.purpose as LlmPurpose)) {
        await this.repos.llmPurposeBindings.remove(ctx.tenantId, rec.id);
        removed.push(rec.purpose);
      }
    }
    await this.outbox.emit(ctx.tenantId, "llm_binding.updated", {
      purposes: [...new Set([...bindings.map((b) => b.purpose), ...removed])],
    });
    return { bindings: await this.bindings(ctx.tenantId), warnings };
  }

  /** WO-11.3：解绑单个用途（DELETE /a/v1/llm-bindings/:purpose）。幂等——不存在亦返回当前全集。 */
  async deleteBinding(ctx: AuthCtx, purpose: string): Promise<{ bindings: PurposeBinding[] }> {
    const id = `llmb_${ctx.tenantId}_${purpose}`;
    const existing = await this.repos.llmPurposeBindings.get(ctx.tenantId, id);
    if (existing) {
      await this.repos.llmPurposeBindings.remove(ctx.tenantId, id);
      await this.outbox.emit(ctx.tenantId, "llm_binding.updated", { purposes: [purpose] });
    }
    return { bindings: await this.bindings(ctx.tenantId) };
  }
}

// ---------------------------------------------------------------------------
// 用途路由（A2 extraction / A3 modeling / A7 template_gen / compose）
// ---------------------------------------------------------------------------

/**
 * DataCore 内部 LLM 调用方的租户路由（增量 §1.1：A2/A3/A7 与 AgentCore 共同消费
 * provider 配置）。请求带 {tenantId, purpose} 且存在绑定 → 经共享适配器调用对应
 * provider（密钥本地解密，不出进程）；无绑定 → 回落 env 默认 client + DC_LLM_MODEL。
 * 每次路由调用审计（metrics dc_llm_calls_total{purpose,provider,model} —— §1.3
 * 审计记录补 {providerId, modelId}），故障时按 fallbackProviderId 降级（≤1 级）。
 */
export class TenantRoutedLlmClient implements LlmClient {
  private readonly adapterCache = new Map<string, FullLlmClient>();

  constructor(
    private repos: Repos,
    private cipher: CredentialCipher,
    private fallback: LlmClient,
    private metrics: Metrics,
    /** Test seam：替换适配器构造（CI 不出网）。 */
    private adapterFactory?: (rec: LlmProviderRecord, apiKey: string | undefined) => FullLlmClient,
  ) {}

  /**
   * WO-1A：用途未解析到 provider 时的回落（同根接缝单点）。
   * 仍尝试 env 默认 fallback（有真凭据则正常服务；测试态注入的 mock client 安全可用），
   * 但**捕获 LLM SDK 原始鉴权失败串**（无凭据/key 失效）→ 归一为结构化 `LLM_PURPOSE_UNBOUND`（R7 信封·中文引导），
   * 绝不把 SDK 内部串泄漏给用户。其它错误（如 mock 的 LlmParseError）原样抛，保留既有失败语义。
   */
  private async fallbackOrThrow<T>(req: LlmParseRequest<T>): Promise<T> {
    try {
      return await this.fallback.parseStructured(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/could not resolve authentication|x-api-key|authentication_error|no api key|api[_ ]?key/i.test(msg)) {
        throw new AppError(
          "LLM_PURPOSE_UNBOUND",
          `用途 ${req.purpose ?? "(未指定)"} 未绑定 LLM provider，请在 设置→LLM 用途绑定 配置`,
          400,
        );
      }
      throw err;
    }
  }

  private buildAdapter(rec: LlmProviderRecord): FullLlmClient {
    const cacheKey = `${rec.tenantId}|${rec.id}|${rec.updatedAt}`;
    const hit = this.adapterCache.get(cacheKey);
    if (hit) return hit;
    const apiKey = rec.apiKeyCiphertext ? this.cipher.decrypt(rec.apiKeyCiphertext) : undefined;
    const adapter = this.adapterFactory
      ? this.adapterFactory(rec, apiKey)
      : rec.kind === "anthropic"
        ? new AnthropicAdapter(undefined, { apiKey, baseUrl: rec.baseUrl, providerLabel: rec.id })
        : rec.kind === "openai_compatible"
          ? new OpenAICompatAdapter({ apiKey, baseUrl: rec.baseUrl, providerLabel: rec.id })
          : new CustomHttpAdapter({ baseUrl: rec.baseUrl, apiKey });
    this.adapterCache.set(cacheKey, adapter);
    return adapter;
  }

  private async resolveBinding(
    tenantId: string,
    purpose: LlmPurpose,
  ): Promise<{ rec: LlmProviderRecord; modelId: string } | undefined> {
    const binding = await this.repos.llmPurposeBindings.get(tenantId, `llmb_${tenantId}_${purpose}`);
    if (!binding) return undefined;
    const rec =
      (await this.repos.llmProviders.get(tenantId, binding.providerId)) ??
      (await this.repos.llmProviders.get(PLATFORM_TENANT_ID, binding.providerId));
    if (!rec || rec.status !== "ACTIVE") return undefined;
    return { rec, modelId: binding.modelId };
  }

  private async parseVia<T>(target: { rec: LlmProviderRecord; modelId: string }, req: LlmParseRequest<T>): Promise<T> {
    const model = target.rec.models.find((m) => m.modelId === target.modelId);
    const jsonMode = model ? !model.capabilities.structuredOutput : false;
    const client = new AdapterBackedLlmClient(this.buildAdapter(target.rec), { jsonMode });
    // §1.3：每次 LLM 调用审计补 {providerId, modelId}（+ provider 标签指标）
    this.metrics.inc("dc_llm_calls_total", {
      purpose: req.purpose ?? "unknown",
      provider: target.rec.id,
      model: target.modelId,
    });
    return client.parseStructured({ ...req, model: target.modelId });
  }

  async parseStructured<T>(req: LlmParseRequest<T>): Promise<T> {
    // WO-1A：无路由信息 / 无用途绑定 → 经 fallbackOrThrow（仅 env 真有凭据才回落，否则结构化错误，不泄漏 SDK 串）。
    if (!req.tenantId || !req.purpose) return this.fallbackOrThrow(req);
    const target = await this.resolveBinding(req.tenantId, req.purpose);
    if (!target) return this.fallbackOrThrow(req);
    try {
      return await this.parseVia(target, req);
    } catch (err) {
      // 解析失败按调用点既有失败语义；传输/提供方故障 → fallbackProviderId 降级（≤1 级，禁止链式）
      if (err instanceof LlmParseError || !target.rec.fallbackProviderId) throw err;
      const fbRec =
        (await this.repos.llmProviders.get(req.tenantId, target.rec.fallbackProviderId)) ??
        (await this.repos.llmProviders.get(PLATFORM_TENANT_ID, target.rec.fallbackProviderId));
      if (!fbRec || fbRec.status !== "ACTIVE") throw err;
      const fbModel = fbRec.models.find((m) => m.modelId === target.modelId) ?? fbRec.models[0];
      if (!fbModel) throw err;
      this.metrics.inc("dc_llm_fallback_total", { from: target.rec.id, to: fbRec.id });
      return this.parseVia({ rec: fbRec, modelId: fbModel.modelId }, req);
    }
  }
}

// ---------------------------------------------------------------------------
// 路由注册
// ---------------------------------------------------------------------------

export interface LlmProviderRouteDeps {
  repos: Repos;
  service: LlmProviderService;
  outbox: OutboxService;
  ctx: (req: FastifyRequest) => AuthCtx;
  fetchImpl: typeof fetch;
}

/** tenant_admin（admin / platform_admin 放行）写权限；service 角色可读（B 消费）。 */
function requireTenantAdmin(c: AuthCtx): void {
  if (!c.roles.some((r) => ["tenant_admin", "admin", "platform_admin"].includes(r.split(":")[0] as string))) {
    throw forbidden("tenant_admin only");
  }
}

function isService(c: AuthCtx): boolean {
  return c.roles.includes("service");
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw validationError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export function registerLlmProviderRoutes(app: FastifyInstance, deps: LlmProviderRouteDeps): void {
  const { service, ctx } = deps;
  const readCtx = (req: FastifyRequest): AuthCtx => {
    const c = ctx(req);
    if (!isService(c)) requireTenantAdmin(c);
    return c;
  };

  app.get("/a/v1/llm-providers", async (req) => service.list(readCtx(req).tenantId));

  app.post("/a/v1/llm-providers", async (req, reply) => {
    const c = ctx(req);
    requireTenantAdmin(c);
    const body = parseBody(LlmProviderCreateSchema, req.body);
    if (body.scope === "platform" && !c.roles.some((r) => r.split(":")[0] === "platform_admin")) {
      throw forbidden("平台级模板仅 platform_admin 可维护");
    }
    return reply.status(201).send(await service.create(c, body));
  });

  app.get("/a/v1/llm-providers/:id", async (req) => {
    const c = readCtx(req);
    const { id } = req.params as { id: string };
    const rec = await service.getRecord(c.tenantId, id);
    const { apiKeyCiphertext, ...rest } = rec;
    return { ...rest, hasApiKey: Boolean(apiKeyCiphertext) };
  });

  app.put("/a/v1/llm-providers/:id", async (req) => {
    const c = ctx(req);
    requireTenantAdmin(c);
    const { id } = req.params as { id: string };
    const body = parseBody(LlmProviderUpdateSchema, req.body);
    return service.update(c, id, body);
  });

  // §1.4 连接测试：最小请求 → 延迟 + 可用模型探测（失败 → ok:false + message，不抛 5xx）
  app.post("/a/v1/llm-providers/:id/test", async (req) => {
    const c = ctx(req);
    requireTenantAdmin(c);
    const { id } = req.params as { id: string };
    return service.test(c, id, deps.fetchImpl);
  });

  // 平台级模板克隆（§1.1）
  app.post("/a/v1/llm-providers/:id/clone", async (req, reply) => {
    const c = ctx(req);
    requireTenantAdmin(c);
    const { id } = req.params as { id: string };
    return reply.status(201).send(await service.clone(c, id));
  });

  /**
   * 服务间凭证（§1.1）：解密密钥仅对 SERVICE_TOKEN 鉴权的请求返回；
   * 用户 JWT / X-Debug-User 一律 403。每次获取经 outbox 审计（含 caller）。
   */
  app.get("/a/v1/llm-providers/:id/credential", async (req) => {
    const c = ctx(req);
    if (!isService(c)) {
      throw forbidden("credential endpoint is service-to-service only（密钥永不到前端）");
    }
    const { id } = req.params as { id: string };
    const rec = await service.getRecord(c.tenantId, id);
    const caller = String(req.headers["x-service-caller"] ?? "unknown");
    await deps.outbox.emit(rec.tenantId === "platform" ? c.tenantId : rec.tenantId, "llm.credential_fetched", {
      providerId: rec.id,
      caller,
    });
    return { providerId: rec.id, apiKey: service.decryptedKey(rec) ?? null };
  });

  // ---- §1.3 用途绑定矩阵 -----------------------------------------------------
  app.get("/a/v1/llm-bindings", async (req) => {
    const c = readCtx(req);
    return { bindings: await service.bindings(c.tenantId) };
  });

  app.put("/a/v1/llm-bindings", async (req) => {
    const c = ctx(req);
    requireTenantAdmin(c);
    const body = parseBody(BindingsPutSchema, req.body);
    return service.putBindings(c, body.bindings);
  });

  // WO-11.3：单用途解绑（错绑可撤回）。tenant_admin only，与 PUT 同权。
  app.delete("/a/v1/llm-bindings/:purpose", async (req) => {
    const c = ctx(req);
    requireTenantAdmin(c);
    const { purpose } = req.params as { purpose: string };
    return service.deleteBinding(c, purpose);
  });

  // ---- 引用模式增量 §2.3：B→A 引用上报（服务间） -------------------------------
  app.post("/a/v1/references/report", async (req, reply) => {
    const c = ctx(req);
    if (!isService(c)) throw forbidden("reference report is service-to-service only");
    const body = parseBody(RefReportSchema, req.body);
    const rec: ReportedRefRecord = {
      id: `refr_${c.tenantId}_${body.source.kind}_${body.source.key}`.replace(/[^\w-]/g, "_"),
      tenantId: c.tenantId,
      source: body.source,
      refs: body.refs,
      updatedAt: new Date().toISOString(),
    };
    await deps.repos.reportedRefs.put(rec);
    return reply.status(204).send();
  });
}
