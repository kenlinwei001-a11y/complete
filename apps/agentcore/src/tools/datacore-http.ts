import type { AggregateRequest, CrossValidateRequest, CrossValidateResponse, PlanSliceRequest, PlanSliceResponse, QueryTimeseriesAggInput, RuleVerdict, ToolPayload } from "@platform/contracts";
import {
  DataCoreHttpError,
  DataCoreUnavailableError,
  type ActionClient,
  type CatalogClient,
  type DataGenClient,
  type EpochClient,
  type DataCoreClient,
  type IamClient,
  type KbClient,
  type OntologyClient,
  type RuleEngineClient,
  type SimClient,
  type SolverClient,
  type TimeseriesClient,
  type ToolAuthCtx,
} from "./clients.js";
import { injectTraceContext, withSpan } from "../tracing.js";

/**
 * HTTP DataCore client: forwards every call to DataCore's REST API with the user's
 * JWT passed through (OBO). Connection errors → DATACORE_UNAVAILABLE.
 */
async function call<T>(baseUrl: string, ctx: ToolAuthCtx, method: string, path: string, body?: unknown): Promise<T> {
  // WO-OBSERVABILITY (OBS-2)：OBO 跨服务调用自定义 span（root→datacore 的接缝）。
  // attr 带 tenantId（R2 隔离）；禁带凭据明文（token/debugUser 不进 attr·no-secrets-echo R5）。
  return withSpan(
    "obo.datacore",
    { "http.method": method, "http.route": path, "peer.service": "datacore", "app.tenant_id": ctx.tenantId, "app.request_id": ctx.requestId },
    async () => {
      // 双轨：x-request-id（人读关联键·AUDIT-OBS 不破）+ traceparent（机器读分布式 trace context）。
      const headers: Record<string, string> = {
        "content-type": "application/json",
        // WO-AUDIT-OBS：跨服务追踪——透传 requestId（无则生成），DataCore 优先取入站 x-request-id。
        "x-request-id": ctx.requestId ?? `req_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
        ...(ctx.token
          ? { authorization: `Bearer ${ctx.token}` }
          : ctx.debugUser
            ? { "x-debug-user": encodeURIComponent(ctx.debugUser) }
            : {}),
      };
      // WO-OBSERVABILITY：注入 W3C traceparent → DataCore 续同一 trace（与 x-request-id 双轨并存）。
      injectTraceContext(headers);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        throw new DataCoreUnavailableError();
      }
      return handleResponse<T>(res, method, path);
    },
  );
}

async function handleResponse<T>(res: Response, method: string, path: string): Promise<T> {
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

class HttpOntologyClient implements OntologyClient {
  constructor(private readonly baseUrl: string) {}
  resolveSlice(ctx: ToolAuthCtx, sliceKey: string, args: Record<string, unknown>): Promise<ToolPayload> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/slices/${encodeURIComponent(sliceKey)}/resolve`, { args });
  }
  planSlice(ctx: ToolAuthCtx, req: PlanSliceRequest): Promise<PlanSliceResponse> {
    return call<PlanSliceResponse>(this.baseUrl, ctx, "POST", `/a/v1/slices/plan`, req);
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
  crossValidate(ctx: ToolAuthCtx, req: CrossValidateRequest): Promise<CrossValidateResponse> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/ontology/cross-validate`, req);
  }
  fillData(ctx: ToolAuthCtx, req: { typeKey: string; fields: string[]; rows?: number; seed?: number }) {
    return call<{ connId: string; rowCount: number }>(this.baseUrl, ctx, "POST", `/a/v1/growth/fill-data`, req);
  }
  provisionWorld(ctx: ToolAuthCtx, req?: { scale?: string; seed?: number }) {
    return call<{ provisioned: boolean; reason?: string; industry?: string; objectCount?: number }>(this.baseUrl, ctx, "POST", `/a/v1/growth/provision-world`, req ?? {});
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
  invoke(ctx: ToolAuthCtx, solverKey: string, args: Record<string, unknown>): Promise<ToolPayload> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/solvers/${encodeURIComponent(solverKey)}/invoke`, { args });
  }
}

class HttpRuleEngineClient implements RuleEngineClient {
  constructor(private readonly baseUrl: string) {}
  evaluate(ctx: ToolAuthCtx, ruleIds: string[] | "ALL_APPLICABLE", payload: unknown): Promise<RuleVerdict[]> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/rules/evaluate`, { ruleIds, payload });
  }
  async listRuleKeys(ctx: ToolAuthCtx): Promise<string[]> {
    const rules = await call<{ key: string }[]>(this.baseUrl, ctx, "GET", `/a/v1/rules`);
    return (rules ?? []).map((r) => r.key);
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
  ): Promise<{ items: { key: string; name: string; description: string; argHints: Record<string, string>; domain?: string }[] }> {
    const qs = `kind=${kind}${query ? `&query=${encodeURIComponent(query)}` : ""}`;
    return call(this.baseUrl, ctx, "GET", `/a/v1/catalog?${qs}`);
  }
  async solverRegistry(
    ctx: ToolAuthCtx,
    query?: string,
  ): Promise<{ items: { key: string; name: string; description: string; argHints: Record<string, string>; domain?: string }[] }> {
    const qs = query ? `?query=${encodeURIComponent(query)}` : "";
    const res = await call<{ solvers: { key: string; name: string; description: string; argHints?: Record<string, string>; domain?: string }[] }>(
      this.baseUrl,
      ctx,
      "GET",
      `/a/v1/solvers/registry${qs}`,
    );
    return { items: (res.solvers ?? []).map((s) => ({ key: s.key, name: s.name, description: s.description, argHints: s.argHints ?? {}, domain: s.domain })) };
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
      const authzHeaders: Record<string, string> = {
        "content-type": "application/json",
        // WO-AUDIT-OBS：跨服务追踪 requestId 透传（同 call()）。
        "x-request-id": ctx.requestId ?? `req_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
        ...(ctx.token
        ? { authorization: `Bearer ${ctx.token}` }
        : ctx.debugUser
          ? { "x-debug-user": encodeURIComponent(ctx.debugUser) }
          : {}),
      };
      // WO-OBSERVABILITY：traceparent 双轨注入（同 call()）。
      injectTraceContext(authzHeaders);
      const res = await fetch(`${this.baseUrl}/a/v1/authz/check`, {
        method: "POST",
        headers: authzHeaders,
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

export function createHttpDataCore(baseUrl: string): DataCoreClient {
  return {
    ontology: new HttpOntologyClient(baseUrl),
    solver: new HttpSolverClient(baseUrl),
    rules: new HttpRuleEngineClient(baseUrl),
    action: new HttpActionClient(baseUrl),
    iam: new HttpIamClient(baseUrl),
    kb: new HttpKbClient(baseUrl),
    timeseries: new HttpTimeseriesClient(baseUrl),
    catalog: new HttpCatalogClient(baseUrl),
    epoch: new HttpEpochClient(baseUrl),
    datagen: new HttpDataGenClient(baseUrl),
    sim: new HttpSimClient(baseUrl),
  };
}
