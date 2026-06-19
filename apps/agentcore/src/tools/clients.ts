import type { AggregateRequest, AuthCtx, CrossValidateRequest, CrossValidateResponse, QueryTimeseriesAggInput, RuleVerdict, ToolPayload } from "@platform/contracts";

/** Auth context flowing through tool calls; carries the raw OBO bearer token. */
export interface ToolAuthCtx extends AuthCtx {
  /** Raw bearer token, passed through on every DataCore HTTP call (OBO). */
  token?: string;
  /** Token `exp` (epoch seconds); expiring in <60s → refuse new tool calls. */
  tokenExpiresAt?: number;
  /** 开发期 X-Debug-User 原值：无 bearer token 时透传给 DataCore（仅非生产）。 */
  debugUser?: string;
}

export interface OntologyClient {
  resolveSlice(ctx: ToolAuthCtx, sliceKey: string, args: Record<string, unknown>): Promise<ToolPayload>;
  queryObjects(
    ctx: ToolAuthCtx,
    objectType: string,
    filter: Record<string, unknown>,
    limit?: number,
    /** 并发一致性 §13.1：任务级快照读（执行器注入 taskEpoch）。 */
    asOfEpoch?: number,
  ): Promise<ToolPayload>;
  getObject(ctx: ToolAuthCtx, objectType: string, objectId: string): Promise<ToolPayload>;
  /** 治理增量 §3.6：聚合下推（避免 agent 拉全量行）。 */
  aggregateObjects(ctx: ToolAuthCtx, req: AggregateRequest): Promise<ToolPayload>;
  /** B→A 存在性探针（引用闭合）：本租户已发布对象类型 key 全集（agent scope / intent slot 校验）。 */
  listObjectTypeKeys(ctx: ToolAuthCtx): Promise<string[]>;
  /** 推演验证痕迹 Layer 2：把结论断言交给 DataCore 对照知识图谱已有事实交叉验证。 */
  crossValidate(ctx: ToolAuthCtx, req: CrossValidateRequest): Promise<CrossValidateResponse>;
  /** 自成长 P2：缺数据真人正门补——确定性生成 CSV 经公开上传门导入。 */
  fillData(ctx: ToolAuthCtx, req: { typeKey: string; fields: string[]; rows?: number; seed?: number }): Promise<{ connId: string; rowCount: number }>;
  /** 约束执行层 stage3②：工具输出按本体对象类型 schema/值域校验（不符即 ok=false，执行器据此拒）。 */
  validateOutput(ctx: ToolAuthCtx, objectType: string, rows: Record<string, unknown>[]): Promise<{ ok: boolean; violations: { field: string; kind: string; detail: string }[] }>;
  // Dogfooding P3：让 Agent 问运行中的系统自己（受 DataCore 侧 MetaAccessPolicy 白名单门控）。
  queryMetaOntology(ctx: ToolAuthCtx): Promise<{ total: number; byKind: Record<string, number> }>;
  getMetaBreakpoint(ctx: ToolAuthCtx, id: string): Promise<unknown>;
  metaImpact(ctx: ToolAuthCtx, node: string): Promise<{ node: string; affected: { id: string; via: string }[] }>;
}

export interface SolverClient {
  invoke(ctx: ToolAuthCtx, solverKey: string, args: Record<string, unknown>): Promise<ToolPayload>;
}

export interface RuleEngineClient {
  evaluate(ctx: ToolAuthCtx, ruleIds: string[] | "ALL_APPLICABLE", payload: unknown): Promise<RuleVerdict[]>;
  /** B→A 存在性探针（引用闭合）：本租户已发布规则 key 全集（workflow evaluate_rules 校验）。 */
  listRuleKeys(ctx: ToolAuthCtx): Promise<string[]>;
}

export interface ActionClient {
  createDraft(
    ctx: ToolAuthCtx,
    actionType: string,
    payload: unknown,
  ): Promise<{ draftId: string; status: "PENDING_APPROVAL" }>;
}

export interface IamClient {
  check(ctx: ToolAuthCtx, toolName: string, args: unknown): Promise<{ allowed: boolean; reason?: string }>;
}

/** S4.1 knowledge-base hit shape (also the KB_CHUNK provenance payload). */
export interface KbHit {
  text: string;
  score: number;
  docId: string;
  span: { start: number; end: number };
  source: string;
}

export interface KbClient {
  search(ctx: ToolAuthCtx, input: { query: string; topK?: number; connId?: string }): Promise<ToolPayload>;
}

/** A8.4 aggregated timeseries query — NEVER returns raw ts_points rows. */
export interface TimeseriesClient {
  aggQuery(ctx: ToolAuthCtx, input: QueryTimeseriesAggInput): Promise<ToolPayload>;
}

/** 并发一致性 §13.1：任务级快照锚点——任务首读时捕获租户 epoch。 */
export interface EpochClient {
  current(ctx: ToolAuthCtx): Promise<{ epoch: number }>;
}

/** 能力发现与路由 §1：资源目录发现（discover 工具的 DataCore 出口）。 */
export interface CatalogClient {
  discover(
    ctx: ToolAuthCtx,
    kind: "slices" | "solvers",
    query?: string,
  ): Promise<{ items: { key: string; name: string; description: string; argHints: Record<string, string>; domain?: string }[] }>;
}

/** Aggregate DataCore client surface — HTTP impl (OBO passthrough) or in-memory mock. */
export interface DataCoreClient {
  ontology: OntologyClient;
  solver: SolverClient;
  rules: RuleEngineClient;
  action: ActionClient;
  iam: IamClient;
  kb: KbClient;
  timeseries: TimeseriesClient;
  catalog: CatalogClient;
  epoch: EpochClient;
}

export class DataCoreUnavailableError extends Error {
  readonly code = "DATACORE_UNAVAILABLE";
  constructor(message = "DataCore is unreachable") {
    super(message);
    this.name = "DataCoreUnavailableError";
  }
}

/**
 * Upstream DataCore non-2xx with the original 状态码/错误码 preserved，使路由级
 * 代理（如 /b/v1/solvers/:key/run）能透传真实错误信封而不是塌缩成 500。
 */
export class DataCoreHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DataCoreHttpError";
  }
}
