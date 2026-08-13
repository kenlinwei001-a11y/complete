import type { AggregateRequest, CreateDecisionInput, CrossValidateRequest, CrossValidateResponse, Decision, ObjectRefResolution, ObjectRefResolveRequest, PlanSliceRequest, PlanSliceResponse, PromptKey, QueryTimeseriesAggInput, ResolvedPrompt, RuleVerdict, ToolPayload, TypeSemanticsResponse } from "@platform/contracts";
import {
  DataCoreHttpError,
  DataCoreRequestCancelledError,
  DataCoreUnavailableError,
  type ActionClient,
  type CatalogClient,
  type DataGenClient,
  type DecisionClient,
  type EpochClient,
  type DataCoreClient,
  type IamClient,
  type KbClient,
  type OntologyClient,
  type PromptClient,
  type RuleEngineClient,
  type SimClient,
  type SolverClient,
  type TimeseriesClient,
  type ToolAuthCtx,
} from "./clients.js";

/**
 * HTTP DataCore client: forwards every call to DataCore's REST API with the user's
 * JWT passed through (OBO). Connection errors → DATACORE_UNAVAILABLE.
 */
async function call<T>(
  baseUrl: string,
  ctx: ToolAuthCtx,
  method: string,
  path: string,
  body?: unknown,
  /** WO-D1 · 可选取消信号：abort → 连接真中断（DataCore 侧据此感知客户端断开并取消求解）。 */
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(ctx.token
          ? { authorization: `Bearer ${ctx.token}` }
          : ctx.debugUser
            ? { "x-debug-user": encodeURIComponent(ctx.debugUser) }
            : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch {
    // 取消导致的失败 ≠ 上游不可达：如实报 SOLVER_CANCELLED（499），不塌缩成 DATACORE_UNAVAILABLE。
    if (signal?.aborted) throw new DataCoreRequestCancelledError(`DataCore ${method} ${path} 已取消（上游超时或客户端断开）`);
    throw new DataCoreUnavailableError();
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    // 解析 DataCore 错误信封，保留原始 status/code（路由级代理透传；工具层 catch 不受影响）
    let code = `HTTP_${res.status}`;
    try {
      const parsed = JSON.parse(detail) as { error?: { code?: string } };
      if (parsed.error?.code) code = parsed.error.code;
    } catch {
      /* non-JSON upstream body */
    }
    throw new DataCoreHttpError(res.status, code, `DataCore ${method} ${path} -> ${res.status} ${detail.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

/** WO-QOS-ONTOLOGY-CONTEXT · B→A type-semantics 资源缓存（TTL 60s + {kind}.updated 事件失效，与 provider/feature 目录同机制）。 */
const TYPE_SEMANTICS_TTL_MS = 60_000;
/** WO-PROMPT-DEFAULTS-WIRING · B→A 提示词模板缓存 TTL（60s + prompt.updated 事件失效，同 B→A 资源缓存纪律）。 */
const PROMPT_TEMPLATE_TTL_MS = 60_000;

class HttpOntologyClient implements OntologyClient {
  constructor(private readonly baseUrl: string) {}
  /** 缓存键 = `${tenantId}::${sortedTypeKeys}`；命中且未过期 → 不打 A（不 per-question 打 A）。 */
  private readonly semanticsCache = new Map<string, { value: TypeSemanticsResponse; fetchedAt: number }>();

  async getTypeSemantics(ctx: ToolAuthCtx, typeKeys: string[]): Promise<TypeSemanticsResponse> {
    const keys = [...new Set(typeKeys.filter(Boolean))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (keys.length === 0) return { types: [] };
    const cacheKey = `${ctx.tenantId ?? ""}::${keys.join(",")}`;
    const hit = this.semanticsCache.get(cacheKey);
    if (hit && Date.now() - hit.fetchedAt < TYPE_SEMANTICS_TTL_MS) return hit.value;
    const value = await call<TypeSemanticsResponse>(
      this.baseUrl,
      ctx,
      "GET",
      `/a/v1/ontology/type-semantics?types=${encodeURIComponent(keys.join(","))}`,
    );
    this.semanticsCache.set(cacheKey, { value, fetchedAt: Date.now() });
    return value;
  }

  /** {kind}.updated（ontology/rules）事件失效：给 tenantId 清该租户所有键；不给 → 全清（幂等无害）。 */
  invalidateTypeSemantics(tenantId?: string): void {
    if (!tenantId) {
      this.semanticsCache.clear();
      return;
    }
    for (const k of [...this.semanticsCache.keys()]) if (k.startsWith(`${tenantId}::`)) this.semanticsCache.delete(k);
  }
  resolveSlice(ctx: ToolAuthCtx, sliceKey: string, args: Record<string, unknown>): Promise<ToolPayload> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/slices/${encodeURIComponent(sliceKey)}/resolve`, { args });
  }
  planSlice(ctx: ToolAuthCtx, req: PlanSliceRequest): Promise<PlanSliceResponse> {
    return call<PlanSliceResponse>(this.baseUrl, ctx, "POST", `/a/v1/slices/plan`, req);
  }
  putSliceSpec(
    ctx: ToolAuthCtx,
    sliceKey: string,
    spec: {
      root: { typeKey: string; selector: { byKey?: string; filter?: Record<string, unknown> } };
      paths: { linkKey: string; direction: "out" | "in"; filter?: Record<string, unknown>; limitPerNode?: number; project?: string[] }[][];
      maxNodes?: number;
    },
  ): Promise<{ sliceKey: string; version: number }> {
    return call<{ sliceKey: string; version: number }>(
      this.baseUrl,
      ctx,
      "PUT",
      `/a/v1/ontology/slices/${encodeURIComponent(sliceKey)}`,
      { version: 1, spec },
    );
  }
  queryObjects(
    ctx: ToolAuthCtx,
    objectType: string,
    filter: Record<string, unknown>,
    limit?: number,
    asOfEpoch?: number,
  ): Promise<ToolPayload> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/objects/query`, { objectType, filter, limit, ...(asOfEpoch !== undefined ? { asOfEpoch } : {}) });
  }
  getObject(ctx: ToolAuthCtx, objectType: string, objectId: string): Promise<ToolPayload> {
    return call(
      this.baseUrl,
      ctx,
      "GET",
      `/a/v1/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}`,
    );
  }
  /**
   * WO-SLOT-ENTITY-RESOLVE · 走 A 侧解析正门（**一次调用解析全类型**）——
   * 此前 slots.ts 逐个已发布类型打 `GET /objects/:type/:id`（demo 租户 92 个类型 = 92 次 HTTP 且全 404）。
   */
  resolveObjectRef(ctx: ToolAuthCtx, req: ObjectRefResolveRequest): Promise<ObjectRefResolution> {
    return call<ObjectRefResolution>(this.baseUrl, ctx, "POST", `/a/v1/ontology/resolve-ref`, req);
  }
  async aggregateObjects(ctx: ToolAuthCtx, req: AggregateRequest): Promise<ToolPayload> {
    const data = await call<unknown>(this.baseUrl, ctx, "POST", `/a/v1/objects/aggregate`, req);
    return { data } as ToolPayload;
  }
  async listObjectTypeKeys(ctx: ToolAuthCtx): Promise<string[]> {
    const types = await call<{ key: string }[]>(this.baseUrl, ctx, "GET", `/a/v1/ontology/object-types`);
    return (types ?? []).map((t) => t.key);
  }
  async listObjectTypes(ctx: ToolAuthCtx): Promise<{ key: string; label: string; domain: string; instanceCount: number }[]> {
    const res = await call<{ stats: { key: string; displayName?: string; domain?: string; count?: number }[] }>(
      this.baseUrl, ctx, "GET", `/a/v1/ontology/object-types/stats`,
    );
    return (res?.stats ?? []).map((s) => ({ key: s.key, label: s.displayName ?? s.key, domain: s.domain ?? "unassigned", instanceCount: s.count ?? 0 }));
  }
  async listObjectTypeDefs(ctx: ToolAuthCtx): Promise<import("./clients.js").ObjectTypeDefSummary[]> {
    // WO-RESOURCE-CATALOG-ONTOLOGY：object_type/field 投影供给侧（A 侧 listTypes 已过滤 ACTIVE·R1 REST 只读镜像）。
    // 注：linkKeys 不映射——真值源 ObjectTypeDef 无此字段（链接在 LinkTypeDef），该面恒缺省（见 clients.ts ObjectTypeDefSummary）。
    const types = await call<
      {
        key: string;
        displayName?: string;
        domain?: string;
        description?: string;
        status?: string;
        properties?: { propKey: string; description?: string; unit?: string; dataType?: string; isPrimaryKey?: boolean; searchable?: boolean }[];
      }[]
    >(this.baseUrl, ctx, "GET", `/a/v1/ontology/object-types`);
    return (types ?? []).map((t) => ({
      key: t.key,
      displayName: t.displayName,
      domain: t.domain,
      description: t.description,
      status: t.status,
      properties: (t.properties ?? []).map((p) => ({
        propKey: p.propKey,
        description: p.description,
        unit: p.unit,
        dataType: p.dataType,
        isPrimaryKey: p.isPrimaryKey,
        searchable: p.searchable,
      })),
    }));
  }
  crossValidate(ctx: ToolAuthCtx, req: CrossValidateRequest): Promise<CrossValidateResponse> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/ontology/cross-validate`, req);
  }
  fillData(ctx: ToolAuthCtx, req: { typeKey: string; fields: string[]; rows?: number; seed?: number }) {
    return call<{ connId: string; rowCount: number }>(this.baseUrl, ctx, "POST", `/a/v1/growth/fill-data`, req);
  }
  validateOutput(ctx: ToolAuthCtx, objectType: string, rows: Record<string, unknown>[]) {
    return call<{ ok: boolean; violations: { field: string; kind: string; detail: string }[] }>(this.baseUrl, ctx, "POST", `/a/v1/ontology/validate-output`, { objectType, rows });
  }
  queryMetaOntology(ctx: ToolAuthCtx) {
    return call<{ total: number; byKind: Record<string, number> }>(this.baseUrl, ctx, "GET", `/a/v1/meta/ontology`);
  }
  getMetaBreakpoint(ctx: ToolAuthCtx, id: string) {
    return call<unknown>(this.baseUrl, ctx, "GET", `/a/v1/meta/breakpoints/${encodeURIComponent(id)}`);
  }
  metaImpact(ctx: ToolAuthCtx, node: string) {
    return call<{ node: string; affected: { id: string; via: string }[] }>(this.baseUrl, ctx, "GET", `/a/v1/meta/impact?node=${encodeURIComponent(node)}`);
  }
}

class HttpSolverClient implements SolverClient {
  constructor(private readonly baseUrl: string) {}
  /** WO-D1：signal 直达 fetch —— 上游超时/客户端断开 → 这条 OBO 请求真中断（DataCore 侧据此取消求解）。 */
  invoke(ctx: ToolAuthCtx, solverKey: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolPayload> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/solvers/${encodeURIComponent(solverKey)}/invoke`, { args }, signal);
  }
}

/**
 * WO-REFGATE-ENT · N-01 · **可引用性的单一判据落成一个常量**。
 *
 * 「谁能被引用」= 已发布。这条 URL 是该判据在 B→A 方向上唯一的物理表达；
 * `HttpRuleEngineClient` 的两个读取方法都经它出去，任何一方想"少带个 status"都得改到这一行，
 * 而这一行的注释就是这句戒律本身。
 */
const PUBLISHED_RULES_PATH = "/a/v1/rules?status=PUBLISHED";

class HttpRuleEngineClient implements RuleEngineClient {
  constructor(private readonly baseUrl: string) {}
  evaluate(ctx: ToolAuthCtx, ruleIds: string[] | "ALL_APPLICABLE", payload: unknown): Promise<RuleVerdict[]> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/rules/evaluate`, { ruleIds, payload });
  }
  /**
   * WO-REFGATE-ENT · N-01：keys 版**从 `listPublishedRules` 派生**，不再自带一条 URL。
   *
   * 此前这里打的是裸 `GET /a/v1/rules`（无 status 过滤），而下面那个方法打的是 `?status=PUBLISHED`——
   * 同一个类里两条 URL、两种过滤语义、名字看不出差别。发布期引用探针用的是这一个，
   * 于是 **Skill 引用 DRAFT 规则可以正常发布**。派生 = 过滤判据只剩一处（`PUBLISHED_RULES_PATH`），
   * 抄不出第二份，也就漂移不了。
   */
  async listPublishedRuleKeys(ctx: ToolAuthCtx): Promise<string[]> {
    return (await this.listPublishedRules(ctx)).map((r) => r.key);
  }
  async listPublishedRules(ctx: ToolAuthCtx): Promise<import("./clients.js").RuleSummary[]> {
    // WO-DRIL-P1：只投影已发布规则（可发现纪律）；R1 经 REST 读 A 不 import 源。
    const rules = await call<
      { key: string; name?: string; description?: string; scopeObjectTypes?: string[]; severity?: string; expression?: string }[]
    >(this.baseUrl, ctx, "GET", PUBLISHED_RULES_PATH);
    return (rules ?? []).map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      scopeObjectTypes: r.scopeObjectTypes,
      severity: r.severity,
      expression: r.expression,
    }));
  }
}

class HttpActionClient implements ActionClient {
  constructor(private readonly baseUrl: string) {}
  createDraft(
    ctx: ToolAuthCtx,
    actionType: string,
    payload: unknown,
  ): Promise<{ draftId: string; status: "PENDING_APPROVAL" }> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/action-drafts`, { actionType, payload });
  }
}

/**
 * WO-DECISION-KERNEL-WIRE：L2 决策内核 OBO 出口（真 HTTP·透传用户 JWT）。
 * create → `POST /a/v1/decisions`（kernel 从真 gap_attribution+decision_play 派生·PROPOSED）；
 * commit → `POST /a/v1/decisions/:id/commit`（COMMITTED + 派 ActionDraft·S2 DRAFT）。
 */
class HttpDecisionClient implements DecisionClient {
  constructor(private readonly baseUrl: string) {}
  create(ctx: ToolAuthCtx, input: CreateDecisionInput): Promise<Decision> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/decisions`, input);
  }
  commit(ctx: ToolAuthCtx, decisionId: string): Promise<Decision> {
    // 空体 POST：commit 端点只读 :id 路径参，但 `call` 恒设 content-type: application/json ——
    // Fastify 拒空体（FST_ERR_CTP_EMPTY_JSON_BODY·真 HTTP seam 咬出）→ 送 `{}` 占位（端点忽略之）。
    return call(this.baseUrl, ctx, "POST", `/a/v1/decisions/${encodeURIComponent(decisionId)}/commit`, {});
  }
}

/** S4.1 knowledge-base semantic search (OBO passthrough). */
class HttpKbClient implements KbClient {
  constructor(private readonly baseUrl: string) {}
  search(ctx: ToolAuthCtx, input: { query: string; topK?: number; connId?: string }): Promise<ToolPayload> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/kb/search`, input);
  }
}

/** A8.4 aggregated timeseries query (OBO passthrough; DataCore enforces the 120-bucket cap). */
class HttpTimeseriesClient implements TimeseriesClient {
  constructor(private readonly baseUrl: string) {}
  aggQuery(ctx: ToolAuthCtx, input: QueryTimeseriesAggInput): Promise<ToolPayload> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/timeseries/agg-query`, input);
  }
}

class HttpEpochClient implements EpochClient {
  constructor(private readonly baseUrl: string) {}
  current(ctx: ToolAuthCtx): Promise<{ epoch: number }> {
    return call(this.baseUrl, ctx, "GET", `/a/v1/epoch/current`);
  }
}

class HttpDataGenClient implements DataGenClient {
  constructor(private readonly baseUrl: string) {}
  runSynthetic(ctx: ToolAuthCtx, req: { industry: string; scale: string; seed?: number; livedIn?: boolean }): Promise<Record<string, unknown>> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/synthetic/jobs`, {
      industry: req.industry,
      scale: req.scale,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      ...(req.livedIn !== undefined ? { livedIn: req.livedIn } : {}),
    });
  }
  buildDomain(ctx: ToolAuthCtx, req: { story: string; seed?: number }): Promise<Record<string, unknown>> {
    // 故事驱动建域；落 PROVISIONAL（未审核态，A18），R4 转正才计真值。
    return call(this.baseUrl, ctx, "POST", `/a/v1/databuilder/runs`, {
      script: req.story,
      stage: "build",
      buildMode: "PROVISIONAL",
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    });
  }
}

/**
 * 增量4 §5：沙盘指挥台 OBO 出口 —— 透传用户 JWT 调 DataCore /a/v1/sim/*。
 * DataCore 侧每端点各有 entitlement 门（sandbox/propagation/certification）；
 * 这里只转发，模拟态不写真值的语义由 DataCore 保证（act 改 TickState、采纳才出 ActionDraft）。
 */
class HttpSimClient implements SimClient {
  constructor(private readonly baseUrl: string) {}
  init(ctx: ToolAuthCtx, req: { baseSnapshot?: Record<string, unknown>; scope?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/sim/sessions`, {
      ...(req.baseSnapshot !== undefined ? { baseSnapshot: req.baseSnapshot } : {}),
      ...(req.scope !== undefined ? { scope: req.scope } : {}),
    });
  }
  tick(ctx: ToolAuthCtx, sessionId: string, n: number): Promise<Record<string, unknown>> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/tick`, { n });
  }
  world(ctx: ToolAuthCtx, sessionId: string): Promise<Record<string, unknown>> {
    return call(this.baseUrl, ctx, "GET", `/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/world`);
  }
  certify(ctx: ToolAuthCtx, sessionId: string, scope?: string, target?: string): Promise<Record<string, unknown>> {
    const qs = [scope ? `scope=${encodeURIComponent(scope)}` : "", target ? `target=${encodeURIComponent(target)}` : ""].filter(Boolean).join("&");
    return call(this.baseUrl, ctx, "GET", `/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/certification${qs ? `?${qs}` : ""}`);
  }
}

class HttpCatalogClient implements CatalogClient {
  constructor(private readonly baseUrl: string) {}
  discover(
    ctx: ToolAuthCtx,
    kind: "slices" | "solvers",
    query?: string,
  ): Promise<{ items: { key: string; name: string; description: string; argHints: Record<string, string>; domain?: string; answersQuestions?: string[]; tags?: string[] }[] }> {
    const qs = `kind=${kind}${query ? `&query=${encodeURIComponent(query)}` : ""}`;
    return call(this.baseUrl, ctx, "GET", `/a/v1/catalog?${qs}`);
  }
  async solverRegistry(
    ctx: ToolAuthCtx,
    query?: string,
  ): Promise<{ items: { key: string; name: string; description: string; argHints: Record<string, string>; domain?: string; answersQuestions?: string[]; tags?: string[]; outputShape?: string[] }[] }> {
    const qs = query ? `?query=${encodeURIComponent(query)}` : "";
    const res = await call<{ solvers: { key: string; name: string; description: string; argHints?: Record<string, string>; domain?: string; answersQuestions?: string[]; tags?: string[]; outputShape?: string[] }[] }>(
      this.baseUrl,
      ctx,
      "GET",
      `/a/v1/solvers/registry${qs}`,
    );
    // WO-DRIL-PRECISION：透传 answersQuestions/tags（DataCore 目录已产出），供 DRIL 语义检索——勿在接缝丢弃。
    // WO-CAPMAP-LIVE：同理透传 outputShape（A 侧 `SOLVER_OUTPUT_SHAPES` 单一真值·app.ts:3024 逐条已带）。
    // 丢了它，能力地图就只能回去抄那份手写镜像才知道「结果长什么样」——这正是本单要拆掉的依赖。
    return {
      items: (res.solvers ?? []).map((s) => ({
        key: s.key,
        name: s.name,
        description: s.description,
        argHints: s.argHints ?? {},
        domain: s.domain,
        ...(s.answersQuestions && s.answersQuestions.length > 0 ? { answersQuestions: s.answersQuestions } : {}),
        ...(s.tags && s.tags.length > 0 ? { tags: s.tags } : {}),
        ...(s.outputShape && s.outputShape.length > 0 ? { outputShape: s.outputShape } : {}),
      })),
    };
  }
}

/**
 * Coarse tool-level IAM. Per platform PRD §6.2 the single enforcement point is DataCore's
 * data layer (row filtering on every read); this client therefore allows by default and
 * relies on the data layer — unless DataCore exposes /a/v1/authz/check, which we try first.
 */
class HttpIamClient implements IamClient {
  private checkSupported: boolean | undefined;
  constructor(private readonly baseUrl: string) {}
  async check(ctx: ToolAuthCtx, toolName: string, args: unknown): Promise<{ allowed: boolean; reason?: string }> {
    if (this.checkSupported === false) return { allowed: true };
    try {
      const res = await fetch(`${this.baseUrl}/a/v1/authz/check`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(ctx.token
          ? { authorization: `Bearer ${ctx.token}` }
          : ctx.debugUser
            ? { "x-debug-user": encodeURIComponent(ctx.debugUser) }
            : {}),
        },
        body: JSON.stringify({ toolName, args }),
      });
      if (res.status === 404) {
        this.checkSupported = false;
        return { allowed: true };
      }
      if (!res.ok) return { allowed: true };
      this.checkSupported = true;
      return (await res.json()) as { allowed: boolean; reason?: string };
    } catch {
      throw new DataCoreUnavailableError();
    }
  }
}

/**
 * WO-PROMPT-DEFAULTS-WIRING · B→A 提示词模板 OBO 读取 + 缓存（TTL60s + `prompt.updated` 事件失效，
 * 与 type-semantics/provider 目录同机制·不 per-question 打 A）。经 `GET /a/v1/prompt-templates/:key/resolve`
 * （admin 门·OBO 透传用户 JWT/X-Debug-User）取 ResolvedPrompt；非 admin/不可达 → 抛（消费方 fail-open 兜底硬编码）。
 */
class HttpPromptClient implements PromptClient {
  constructor(private readonly baseUrl: string) {}
  /** 缓存键 = `${tenantId}::${key}`；命中且未过期 → 不打 A。 */
  private readonly cache = new Map<string, { value: ResolvedPrompt; fetchedAt: number }>();

  async getPromptTemplate(ctx: ToolAuthCtx, key: PromptKey): Promise<ResolvedPrompt | undefined> {
    const cacheKey = `${ctx.tenantId ?? ""}::${key}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.fetchedAt < PROMPT_TEMPLATE_TTL_MS) return hit.value;
    const value = await call<ResolvedPrompt>(
      this.baseUrl,
      ctx,
      "GET",
      `/a/v1/prompt-templates/${encodeURIComponent(key)}/resolve`,
    );
    this.cache.set(cacheKey, { value, fetchedAt: Date.now() });
    return value;
  }

  /** `prompt.updated` 事件失效：给 tenantId 清该租户所有键；不给 → 全清（幂等无害）。 */
  invalidatePromptTemplate(tenantId?: string): void {
    if (!tenantId) {
      this.cache.clear();
      return;
    }
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${tenantId}::`)) this.cache.delete(k);
  }
}

export function createHttpDataCore(baseUrl: string): DataCoreClient {
  return {
    ontology: new HttpOntologyClient(baseUrl),
    solver: new HttpSolverClient(baseUrl),
    rules: new HttpRuleEngineClient(baseUrl),
    action: new HttpActionClient(baseUrl),
    decision: new HttpDecisionClient(baseUrl),
    iam: new HttpIamClient(baseUrl),
    kb: new HttpKbClient(baseUrl),
    timeseries: new HttpTimeseriesClient(baseUrl),
    catalog: new HttpCatalogClient(baseUrl),
    epoch: new HttpEpochClient(baseUrl),
    datagen: new HttpDataGenClient(baseUrl),
    sim: new HttpSimClient(baseUrl),
    prompts: new HttpPromptClient(baseUrl),
  };
}
