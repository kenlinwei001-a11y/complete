import type { AggregateRequest, AuthCtx, CreateDecisionInput, CrossValidateRequest, CrossValidateResponse, Decision, ObjectRefResolution, ObjectRefResolveRequest, OntologySignature, PlanSliceRequest, PlanSliceResponse, PromptKey, QueryTimeseriesAggInput, ResolvedPrompt, RuleVerdict, ToolPayload } from "@platform/contracts";

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
  /**
   * WO-SLOT-ENTITY-RESOLVE · 「实体文本 → 对象引用」解析（**槽位填充唯一入口**，A 侧 `POST /a/v1/ontology/resolve-ref`）。
   *
   * 为什么必须有它、且必须是**必填**接口：`getObject` 是**按 id/主键**查——用户说的「常州」是 `Base.name`、
   * 「整车厂A」是 `Customer.custName`，逐类型 `getObject` 全 404 ⇒ objectRef 槽恒判 missing ⇒ 系统明明抽到了槽还反问
   * （真实故障：35 道场景题 10 道停在 AWAITING_CLARIFICATION）。声明为必填 = 任何 OntologyClient 实现
   * 都不许再退回「只按 id 查」的老路（假绿第 9 形态防线：mock 比生产宽松曾把这个病盖了整整一轮）。
   */
  resolveObjectRef(ctx: ToolAuthCtx, req: ObjectRefResolveRequest): Promise<ObjectRefResolution>;
  /** 治理增量 §3.6：聚合下推（避免 agent 拉全量行）。 */
  aggregateObjects(ctx: ToolAuthCtx, req: AggregateRequest): Promise<ToolPayload>;
  /** B→A 存在性探针（引用闭合）：本租户已发布对象类型 key 全集（agent scope / intent slot 校验）。 */
  listObjectTypeKeys(ctx: ToolAuthCtx): Promise<string[]>;
  /** CL.3 discover 真实类型名：本租户已发布对象类型 {key,label(中文),domain,instanceCount}（agent 照真名查不再猜）。 */
  listObjectTypes(ctx: ToolAuthCtx): Promise<{ key: string; label: string; domain: string; instanceCount: number }[]>;
  /**
   * WO-RESOURCE-CATALOG-ONTOLOGY · 对象类型全量定义（含类型级 description + 属性口径 unit/dataType），
   * DRIL object_type/field 投影供给侧。源 `GET /a/v1/ontology/object-types`（A 侧已过滤 ACTIVE）。
   * 可选：mock/精简客户端不实现 → 投影层降级 listObjectTypes（描述按 WO §4 兜底合成）。
   */
  listObjectTypeDefs?(ctx: ToolAuthCtx): Promise<ObjectTypeDefSummary[]>;
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
  /**
   * WO-D1 · 求解调用（OBO → DataCore /a/v1/solvers/{key}/invoke）。
   *
   * @param signal 可选取消信号。**取消 ≠ 不再等**：`Promise.race([invoke, timeout])` 只是不再等它，
   * 底层求解照跑到底（审核方探针实测：504@169ms 之后再等 700ms → `finished=1`）。传入 signal 后，
   * 上游超时 / 客户端断开 → abort → HTTP 请求真中断 → DataCore 侧感知连接断开 → 把取消继续传到
   * 求解执行与优化器 sidecar 调用（见 datacore `solvers/cancellation.ts` 的可取消层清单与诚实边界）。
   * 不传 = 现行为（不可取消），向后兼容。
   */
  invoke(ctx: ToolAuthCtx, solverKey: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolPayload>;
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

/**
 * WO-RESOURCE-CATALOG-ONTOLOGY · 对象类型全量定义只读投影行（DataCore `GET /a/v1/ontology/object-types`
 * 的 B 侧镜像，R1 REST·R13 派生）——object_type/field kind 的供给侧。镜像 ObjectTypeDef/PropertyDef
 * 只读子集；description/unit 缺失即诚实缺省（投影层按 WO §4 兜底合成并标记，不编业务含义）。
 */
export interface ObjectTypeDefSummary {
  key: string;
  displayName?: string;
  domain?: string;
  description?: string;
  status?: string;
  properties?: {
    propKey: string;
    description?: string;
    unit?: string;
    dataType?: string;
    isPrimaryKey?: boolean;
    searchable?: boolean;
  }[];
  /**
   * 预留字段（当前供给侧恒 undefined）：真值源 `ObjectTypeDef` 无 linkKeys——链接关系在 `LinkTypeDef`，
   * `/a/v1/ontology/object-types` 不返回。HTTP 客户端不做映射；将来 A 侧透出时投影层自动透传。
   */
  linkKeys?: string[];
}

export interface RuleEngineClient {
  evaluate(ctx: ToolAuthCtx, ruleIds: string[] | "ALL_APPLICABLE", payload: unknown): Promise<RuleVerdict[]>;
  /**
   * **可引用性单一判据**（WO-REFGATE-ENT · N-01）：谁能被引用 = **已发布（PUBLISHED）**的规则。
   *
   * 病灶（2026-08-09 实测）：旧名 `listRuleKeys` 打的是 `GET /a/v1/rules`（**不带 status 过滤**），
   * 而同一个类里的 `listRules` 打的是 `GET /a/v1/rules?status=PUBLISHED`——**两个方法过滤语义不同，
   * 名字看不出差别**。发布期引用探针（`resources.ts probeMissingRefs`）用的恰是前者，于是
   * 「引用一条 DRAFT 规则的 Skill」在门面前一路绿灯：门确实执行了，只是它问错了问题
   * （问「这个 key 在库里有没有」，而该问「这个 key 可不可以被引用」）。
   *
   * 修法不是在调用点补一个 filter（那只是把判据又抄了一份），而是**把判据收敛到名字里**：
   * 两个读取方法都叫 `listPublished*`，且 HTTP 实现里由 `listPublishedRules` 单点持有过滤 URL，
   * keys 版从它派生——**过滤语义无处可漂移**。
   */
  listPublishedRuleKeys(ctx: ToolAuthCtx): Promise<string[]>;
  /**
   * WO-DRIL-P1 · 已发布规则的元数据全量（key/name/description/scopeObjectTypes/severity）——DRIL rule 投影供给侧。
   * 可选：mock/精简客户端不实现 → 投影层降级到 listPublishedRuleKeys（description 合成）。
   */
  listPublishedRules?(ctx: ToolAuthCtx): Promise<RuleSummary[]>;
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

/**
 * DataCore 目录项（HTTP 出口形状）。**接缝纪律**：DataCore 目录产出的字段一律在此透传，不许在 map 时丢弃。
 *  · WO-DRIL-PRECISION：`answersQuestions`/`tags` 曾被出口 map 丢掉 → DRIL 语义检索恒不命中（断在接缝）。
 *  · WO-69 P2 新增 `ontologySignature`（Function 本体签名）：DRIL inputSpec/outputSpec 由它**派生**，
 *    出口一丢，下游派生就恒空 = 又一次「两半各自绿、接缝断」。
 */
export interface CatalogClientItem {
  key: string;
  name: string;
  description: string;
  argHints: Record<string, string>;
  domain?: string;
  answersQuestions?: string[];
  tags?: string[];
  ontologySignature?: OntologySignature;
  /** WO-CAPMAP-LIVE：DataCore `/a/v1/solvers/registry` 逐条回 `SOLVER_OUTPUT_SHAPES[key]`
   *  ——能力地图注入「结果长什么样/取哪个字段溯源」全靠它；此前 HTTP 出口 map 时被丢弃，
   *  与 `answersQuestions` 同一种「断在接缝」。 */
  outputShape?: string[];
}

/** 能力发现与路由 §1：资源目录发现（discover 工具 + 求解器注册表的 DataCore 出口）。 */
export interface CatalogClient {
  discover(
    ctx: ToolAuthCtx,
    kind: "slices" | "solvers",
    query?: string,
  ): Promise<{ items: CatalogClientItem[] }>;
  /** A1：求解器全集注册表（feature 过滤）——`solvers` MCP server 工具的供给侧，含净室通用族 + A8 CP-SAT。
   *  形状统一走 `CatalogClientItem`（含 WO-CAPMAP-LIVE 的 `outputShape` 与 WO-69 P2 的 `ontologySignature`），
   *  见 datacore app.ts `/a/v1/solvers/registry`。 */
  solverRegistry(
    ctx: ToolAuthCtx,
    query?: string,
  ): Promise<{ items: CatalogClientItem[] }>;
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

/**
 * WO-PROMPT-DEFAULTS-WIRING · 平台内置提示词模板 OBO 读取（消硬编码漂移）。
 * 单一真值在 DataCore（R1·B 经 REST 读不 import A 源）；`GET /a/v1/prompt-templates/:key/resolve`
 * 返 ResolvedPrompt（含 source: TENANT_OVERRIDE|PLATFORM_DEFAULT）。TTL60s 缓存 + `prompt.updated` 事件失效
 * （复用 B→A 资源缓存纪律）。消费方仅采纳 **TENANT_OVERRIDE**（admin 真配了才生效）；PLATFORM_DEFAULT/失败/不可达
 * → 兜底 AgentCore 现有硬编码默认（fail-open·R6 字节兼容）。可选：mock/精简客户端不实现 → 消费点自然降级。
 */
export interface PromptClient {
  /** OBO 读生效模板；失败/不可达按 call 语义抛（消费方 fail-open catch）。mock 可返 undefined。 */
  getPromptTemplate(ctx: ToolAuthCtx, key: PromptKey): Promise<ResolvedPrompt | undefined>;
  /** `prompt.updated` 事件失效（/b/v1/internal/invalidate 钩子调）；给 tenantId 清该租户键，缺省全清。 */
  invalidatePromptTemplate(tenantId?: string): void;
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
  /** WO-PROMPT-DEFAULTS-WIRING：平台内置提示词模板读取（可选·缺省则消费点降级硬编码兜底·fail-open）。 */
  prompts?: PromptClient;
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

/**
 * WO-D1 · 调用被主动取消（上游超时 abort / 客户端断开）导致的 fetch 失败。
 * 继承 DataCoreHttpError → 复用既有错误信封映射（499 = client closed request，nginx 惯例），
 * 不冒充 `DATACORE_UNAVAILABLE`（那是"上游不可达"，与"我们自己取消了"是两回事，混淆会误导排查）。
 */
export class DataCoreRequestCancelledError extends DataCoreHttpError {
  constructor(message: string) {
    super(499, "SOLVER_CANCELLED", message);
    this.name = "DataCoreRequestCancelledError";
  }
}
