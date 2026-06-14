import type { AggregateRequest, QueryTimeseriesAggInput, RuleVerdict, ToolPayload } from "@platform/contracts";
import {
  DataCoreHttpError,
  DataCoreUnavailableError,
  type ActionClient,
  type CatalogClient,
  type EpochClient,
  type DataCoreClient,
  type IamClient,
  type KbClient,
  type OntologyClient,
  type RuleEngineClient,
  type SolverClient,
  type TimeseriesClient,
  type ToolAuthCtx,
} from "./clients.js";

/**
 * HTTP DataCore client: forwards every call to DataCore's REST API with the user's
 * JWT passed through (OBO). Connection errors → DATACORE_UNAVAILABLE.
 */
async function call<T>(baseUrl: string, ctx: ToolAuthCtx, method: string, path: string, body?: unknown): Promise<T> {
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
    });
  } catch {
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

class HttpOntologyClient implements OntologyClient {
  constructor(private readonly baseUrl: string) {}
  resolveSlice(ctx: ToolAuthCtx, sliceKey: string, args: Record<string, unknown>): Promise<ToolPayload> {
    return call(this.baseUrl, ctx, "POST", `/a/v1/slices/${encodeURIComponent(sliceKey)}/resolve`, { args });
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
  };
}
