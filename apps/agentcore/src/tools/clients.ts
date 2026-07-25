import type { AggregateRequest, AuthCtx, CreateDecisionInput, CrossValidateRequest, CrossValidateResponse, Decision, PlanSliceRequest, PlanSliceResponse, QueryTimeseriesAggInput, RuleVerdict, ToolPayload } from "@platform/contracts";

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
  /** A3-SUITE-2：动态切片持久化。将规划器产出的 SlicePlan 登记为一等 SliceSpec，使后续 resolve_slice 可消费。 */
  putSliceSpec(
    ctx: ToolAuthCtx,
    sliceKey: string,
    spec: {
      root: { typeKey: string; selector: { byKey?: string; filter?: Record<string, unknown> } };
      paths: { linkKey: string; direction: "out" | "in"; filter?: Record<string, unknown>; limitPerNode?: number; project?: string[] }[][];
      maxNodes?: number;
    },
  ): Promise<{ sliceKey: string; version: number }>;
  /** P3 O11：发育闭环自动规划切片（OBO → DataCore /a/v1/slices/plan，rootType+targets→SliceSpec，复用既有已发布切片）。 */
  planSlice(ctx: ToolAuthCtx, req: PlanSliceRequest): Promise<PlanSliceResponse>;
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
  /** CL.3 discover 真实类型名：本租户已发布对象类型 {key,label(中文),domain,instanceCount}（agent 照真名查不再猜）。 */
  listObjectTypes(ctx: ToolAuthCtx): Promise<{ key: string; label: string; domain: string; instanceCount: number }[]>;
  /**
   * WO-QOS-ONTOLOGY-CONTEXT · 口径语义（缺口③文档三层投喂第二层）：请求类型的属性口径/派生公式/规则表达式。
   * 单一真值在 A（GET /a/v1/ontology/type-semantics）·B 经 REST 读（R1 不 import 源）·复用 B→A 资源缓存
   * TTL60s + {kind}.updated(ontology/rules) 失效（不 per-question 打 A）。可选：mock 客户端不实现 → 注入点降级空块。
   */
  getTypeSemantics?(ctx: ToolAuthCtx, typeKeys: string[]): Promise<import("@platform/contracts").TypeSemanticsResponse>;
  /** WO-QOS-ONTOLOGY-CONTEXT · 失效 type-semantics 缓存（/b/v1/internal/invalidate 钩子按 ontology/rules 事件调）。 */
  invalidateTypeSemantics?(tenantId?: string): void;
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

/** WO-DRIL-P1 · 规则投影供给侧（DataCore /a/v1/rules 的只读投影行，R1 REST·R13 派生）。 */
export interface RuleSummary {
  key: string;
  name?: string;
  description?: string;
  scopeObjectTypes?: string[];
  severity?: string;
  expression?: string;
}

export interface RuleEngineClient {
  evaluate(ctx: ToolAuthCtx, ruleIds: string[] | "ALL_APPLICABLE", payload: unknown): Promise<RuleVerdict[]>;
  /** B→A 存在性探针（引用闭合）：本租户已发布规则 key 全集（workflow evaluate_rules 校验）。 */
  listRuleKeys(ctx: ToolAuthCtx): Promise<string[]>;
  /**
   * WO-DRIL-P1 · 规则元数据全量（key/name/description/scopeObjectTypes/severity）——DRIL rule 投影供给侧。
   * 可选：mock/精简客户端不实现 → 投影层降级到 listRuleKeys（description 合成）。
   */
  listRules?(ctx: ToolAuthCtx): Promise<RuleSummary[]>;
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

/**
 * WO-DECISION-KERNEL-WIRE：L2 决策内核出口（OBO）——闭"CEO 深问止步方案·不成决策"脑裂。
 * 深问出真方案（decision_play）后按意图落一等 `Decision`：`create` → PROPOSED（bundling 真 gap_attribution +
 * decision_play·选定 chosenOptionIds）；`commit` → COMMITTED + 派 ActionDraft（S2 DRAFT·审批门不绕）。
 * 透传用户 JWT/X-Debug-User（OBO），DataCore 侧 kernel 从真推演派生（非写死·改根因→重推→Decision 变）。
 */
export interface DecisionClient {
  create(ctx: ToolAuthCtx, input: CreateDecisionInput): Promise<Decision>;
  commit(ctx: ToolAuthCtx, decisionId: string): Promise<Decision>;
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
  /** A1：求解器全集注册表（31，feature 过滤）——`solvers` MCP server 工具的供给侧，含净室通用族 + A8 CP-SAT。 */
  solverRegistry(
    ctx: ToolAuthCtx,
    query?: string,
  ): Promise<{ items: { key: string; name: string; description: string; argHints: Record<string, string>; domain?: string }[] }>;
}

/** Aggregate DataCore client surface — HTTP impl (OBO passthrough) or in-memory mock. */
/**
 * CL.2 合规数据生成：触发确定性、走管线、可溯源的合成/建域（**触发合成 ≠ 伪造**）。
 * 回执只含元信息（jobId/runId/counts），业务数字由 agent 后续 query_* 工具读回真实物化值。
 * 产出落 PROVISIONAL（未审核态），经 R4 转正才计真值。
 */
export interface DataGenClient {
  runSynthetic(
    ctx: ToolAuthCtx,
    req: { industry: string; scale: string; seed?: number; livedIn?: boolean },
  ): Promise<Record<string, unknown>>;
  buildDomain(ctx: ToolAuthCtx, req: { story: string; seed?: number }): Promise<Record<string, unknown>>;
}

/**
 * 增量4 §5：AI 推演指挥台 —— path B agent 把沙盘当工具驱动（OBO 到 DataCore /a/v1/sim/*，透传用户 JWT）。
 * R4 安全：tick/act 是**模拟态不写真值**（DataCore 已保证：act 只改沙盘 TickState，采纳才出 ActionDraft 走审批）；
 * 这些方法的回执只含会话态元信息（sessionId/curTick/状态值），不绕审批、不出真值写出口。
 */
export interface SimClient {
  /** 开沙盘：建会话（可选 baseSnapshot/scope）。回执 {id,status,curTick,...}。 */
  init(ctx: ToolAuthCtx, req: { baseSnapshot?: Record<string, unknown>; scope?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  /** 推进 n 个 tick（模拟态传导，不写真值）。回执 {curTick,state,trace?}。 */
  tick(ctx: ToolAuthCtx, sessionId: string, n: number): Promise<Record<string, unknown>>;
  /** 读当前世界态（沙盘内 tick + state）。 */
  world(ctx: ToolAuthCtx, sessionId: string): Promise<Record<string, unknown>>;
  /** 就绪认证 L0–L4（只读评估，不写真值）。scope=GLOBAL|LOCAL，可选 target。 */
  certify(ctx: ToolAuthCtx, sessionId: string, scope?: string, target?: string): Promise<Record<string, unknown>>;
}

export interface DataCoreClient {
  ontology: OntologyClient;
  solver: SolverClient;
  rules: RuleEngineClient;
  action: ActionClient;
  /** WO-DECISION-KERNEL-WIRE：L2 决策内核（CEO 深问出方案后成一等 Decision·commit 派 ActionDraft 进 S2）。 */
  decision: DecisionClient;
  iam: IamClient;
  kb: KbClient;
  timeseries: TimeseriesClient;
  catalog: CatalogClient;
  epoch: EpochClient;
  datagen: DataGenClient;
  /** 增量4 §5：AI 推演指挥台的沙盘工具出口（仅 sim.commander/sim.sandbox 开通时对 agent 可见）。 */
  sim: SimClient;
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
