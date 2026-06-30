import type {
  ActionStatus,
  ApprovalStep,
  ActionType,
  CandidateRule,
  PermissionPolicy,
  RuleOrigin,
  IndustryTemplate,
  FieldProfile,
  ScheduledJobKind,
  SopVersionStatus,
  TsAggSpec,
} from "@platform/contracts";

// ---------------------------------------------------------------------------
// A0 IAM
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string;
  tenantId: string; // == id (uniform Store shape)
  name: string;
  industry?: string;
  // ---- 管理平台增量 §2（additive）----
  key?: string; // == id（展示用短键）
  status?: "ACTIVE" | "SUSPENDED";
  createdAt?: string;
}

export interface User {
  id: string;
  tenantId: string;
  username: string;
  passwordHash: string;
  roles: string[];
  attributes: Record<string, unknown>; // e.g. { baseScope: ["changzhou"] }
  // ---- 管理平台增量 §2（additive）----
  email?: string;
  displayName?: string;
  status?: "ACTIVE" | "DISABLED"; // 缺省 = ACTIVE（旧种子兼容）
  lastLoginAt?: string;
}

/** 管理平台增量 §3：场景包（空建 / 行业模板实例化 / 克隆）。 */
export interface ScenarioPackageRecord {
  id: string; // pkg_
  tenantId: string;
  name: string;
  fromTemplate?: string; // industryKey | fromPackageId
  views: string[];
  toolWhitelist: string[];
  modelOverrides: Record<string, string>;
  thresholds: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

/** 管理平台增量 §3：ViewConfig 联动注册的动态功能（view.{viewKey}，默认开）。 */
export interface DynamicFeatureRecord {
  id: string; // dynf_<tenant>_<key>
  tenantId: string;
  key: string; // view.{viewKey}
  name: string;
  level: "VIEW";
  defaultOn: boolean;
  createdAt: string;
}

export interface ViewConfig {
  id: string;
  tenantId: string;
  role: string; // resolved by tenant + role
  scenarioPackages: string[];
  views: {
    key: string;
    title: string;
    /** 前端 PRD §7.1 渲染器键（dashboard | ontology-graph | risk-board | ledger | plan-audit | …） */
    renderer?: string;
    layout?: Record<string, unknown>;
    options?: Record<string, unknown>;
  }[];
  theme: Record<string, unknown>;
  navigation: { key: string; label: string; viewKey?: string; group?: "business" | "admin" }[];
  origin?: "SYNTHETIC" | "MANUAL";
}

export interface AuthCtx {
  tenantId: string;
  userId: string;
  roles: string[];
  attributes: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// A1 connectors
// ---------------------------------------------------------------------------

export interface Connection {
  id: string; // conn_
  tenantId: string;
  connectorTypeKey: string;
  name: string;
  config: Record<string, unknown>; // credential fields stored encrypted (enc:v1:...)
  schedule?: { cron: string };
  status: "ACTIVE" | "DISABLED" | "ERROR";
  lastSyncAt?: string;
  lastError?: string;
  /** A11 per-connection 归类：实例级来源系统类（创建时默认取连接器类型 category，可覆盖、可自定义值 R14）。 */
  category?: string;
  /** 约束执行层（可配置,按租户）：该源导入数据的本体校验策略 + 字段映射（适配不同数据字段）。 */
  validationPolicy?: import("@platform/contracts").ValidationPolicy;
}

export interface SyncJob {
  id: string; // sync_
  tenantId: string;
  connId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  startedAt: string;
  finishedAt?: string;
  rowCounts: Record<string, number>; // dataset -> rows
  error?: string;
}

export interface RawDataset {
  id: string; // rds_
  tenantId: string;
  sourceConnId: string;
  name: string; // dataset name
  fields: FieldProfile[];
  rowCount: number;
  syncedAt: string;
  /** A11 溯源继承：产出该数据集的连接 category（便于数据浏览按来源类筛）。 */
  sourceCategory?: string;
  /** WO-PIPE-INCR ①：增量同步水位（watermarkField 最大值）。下次 sync?since=watermark 只取更新行（CDC·非全量重灌）。 */
  watermark?: string;
}

// ---------------------------------------------------------------------------
// A2 rule docs
// ---------------------------------------------------------------------------

export type RuleDocStatus =
  | "UPLOADED"
  | "PARSED"
  // T1：抽取异步化——doc 解析完成后进 EXTRACTING（后台 job 真打 LLM 抽取中），前端轮询至终态。
  | "EXTRACTING"
  | "EXTRACTED"
  | "IN_REVIEW"
  | "PUBLISHED"
  | "REJECTED"
  // 执行语义 §6：分段抽取部分失败（已成功段落可审，失败段落可单独重试）
  | "PARTIAL";

export interface DocSegment {
  idx: number;
  heading?: string;
  text: string;
  spanStart: number;
  spanEnd: number;
}

export interface RuleDoc {
  id: string; // doc_
  tenantId: string;
  filename: string;
  blobKey: string;
  status: RuleDocStatus;
  extractJobId?: string;
  segments?: DocSegment[];
  droppedCandidates: number; // failed sourceQuote substring validation
  extractError?: string; // T1：后台异步抽取整体失败时的兜底原因（doc 落 PARTIAL）
  createdAt: string;
}

export interface RuleCandidate {
  id: string; // cand_
  tenantId: string;
  docId: string;
  extractJobId: string;
  segmentIdx: number;
  span: { start: number; end: number };
  candidate: CandidateRule;
  status: "PENDING" | "APPROVED" | "REJECTED";
  diff?: "新增" | "变更" | "疑似删除";
  publishedRuleId?: string;
  /** S4.2 near-duplicate detection: embedding similarity > threshold vs a published rule. */
  suspectedDuplicateOf?: { ruleId: string; ruleKey: string; similarity: number };
}

// ---------------------------------------------------------------------------
// A5 rules
// ---------------------------------------------------------------------------

export interface Rule {
  id: string; // rule_
  tenantId: string;
  key: string; // e.g. C03
  name: string;
  description?: string;
  expression: string;
  scopeObjectTypes: string[];
  severity: "BLOCK" | "WARN" | "INFO";
  /** WO-18：规则类型（评估规则 evaluation / 约束条件 constraint）。缺省视为 evaluation（向后兼容）。 */
  ruleType?: "evaluation" | "constraint";
  /** 规则即引用：命名阈值（求解器读 rule.params 去硬编码；改 param 即改推演）。 */
  params?: Record<string, number>;
  origin: RuleOrigin;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  /** 轨N 增量2 规则 provenance（R13 溯源延伸到规则层）：谁设定/何时/有效边界/依据。诚实——种子标治理基线，不编造人名。 */
  definedBy?: string;
  definedAt?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  basis?: string;
}

// ---------------------------------------------------------------------------
// A4 ontology + objects
// ---------------------------------------------------------------------------

export interface PropertyDef {
  propKey: string;
  dataType: "string" | "number" | "boolean" | "date" | "enum" | "ref" | "json";
  isPrimaryKey: boolean;
  refToTypeKey?: string | null;
  /** 本体原子规格 §1：枚举取值（dataType=enum）。 */
  enumValues?: string[];
  /** 本体原子规格 §1：required 标记。 */
  required?: boolean;
  /** 本体原子规格 §1：temporal=true 的属性变更落 object_prop_history。 */
  temporal?: boolean;
  /** 治理增量 §3：关键词搜索命中范围（A3 建议对名称类字段置 true）。 */
  searchable?: boolean;
  /** 治理增量 §4：单位（场景包单位字典约束）+ 展示格式（如 "0.0"）。 */
  unit?: string;
  displayFormat?: string;
  /** DF.5 语义目录：属性业务语义描述（"这字段是什么"），喂生成接地 prompt + /catalog/search 检索。 */
  description?: string;
}

export interface SourceBinding {
  connId: string;
  dataset: string;
  fieldMappings: Record<string, string>; // propKey -> sourceField
}

/** Declarative derivation formula, recomputed in dependency topo order. */
export interface DerivedPropertyDef {
  propKey: string;
  /** e.g. "SUM(Order.qty BY model)" | "COUNT(Order.so BY bases)" | "qty * unitPrice" */
  formula: string;
}

/** 治理增量 §2.2 弃用元数据（type/link/prop 复用同结构）。 */
export interface DeprecationMeta {
  status: "ACTIVE" | "DEPRECATED" | "RETIRED";
  supersededBy?: string;
  deprecatedAt?: string;
  graceUntil?: string; // 缺省 deprecatedAt + 90d
  retiredAt?: string;
}

export interface ObjectTypeDef {
  id: string; // otype_
  tenantId: string;
  key: string;
  displayName: string;
  /** 治理增量 §1：归域强制（FK 校验到 domains；无法判断归 unassigned）。 */
  domain?: string;
  properties: PropertyDef[];
  derivedProperties: DerivedPropertyDef[];
  sourceBindings: SourceBinding[];
  version: number;
  status: "ACTIVE" | "RETIRED";
  /** 治理增量 §2：是否曾 PUBLISHED（API 名不可变纪律的锚点）。 */
  published?: boolean;
  /** 治理增量 §2.2：弃用状态机。 */
  deprecation?: DeprecationMeta;
}

export interface LinkTypeDef {
  id: string; // ltype_
  tenantId: string;
  key: string;
  fromTypeKey: string;
  toTypeKey: string;
  cardinality: "1:1" | "1:N" | "N:N";
  version: number;
  published?: boolean;
  deprecation?: DeprecationMeta;
}

/** 治理增量 §1：域（升格为一等治理单元）。UNIQUE(tenant, domainKey)。 */
export interface DomainRecord {
  id: string; // dom_<tenant>_<key>
  tenantId: string;
  domainKey: string;
  displayName: string;
  color?: string;
  ownerUserId?: string | null;
  description?: string;
  createdAt: string;
}

/** 治理增量 §7.4：发布物入库时抽取的引用三元组（查询即索引查表）。 */
export interface ElementRefRecord {
  id: string; // eref_
  tenantId: string;
  elementKind: "type" | "link" | "prop" | "slice" | "rule";
  elementKey: string;
  prop?: string;
  refKind: "slice" | "derivation" | "rule" | "plan" | "intent" | "agent";
  refKey: string;
  refVersion: number | "latest";
  where: string;
}

/** 治理增量 §7.1：发布请求（域 owner 会签状态机）。 */
export interface PublishRequestRecord {
  id: string; // preq_
  tenantId: string;
  ontologyVersion: number;
  requestedBy: string;
  status: "PENDING_SIGNOFF" | "APPROVED" | "REJECTED" | "EXPIRED";
  signoffs: PublishSignoffRecord[];
  createdAt: string;
  decidedAt?: string;
}

export interface PublishSignoffRecord {
  domainKey: string;
  ownerUserId: string | null;
  decision: "APPROVE" | "REJECT" | null;
  comment?: string;
  decidedAt?: string;
  onBehalfOf?: string;
}

export interface OntologyVersion {
  id: string; // over_
  tenantId: string;
  version: number;
  snapshot: { objectTypes: ObjectTypeDef[]; linkTypes: LinkTypeDef[] };
  createdAt: string;
}

export type ObjectOrigin =
  // 活数据可溯（PRD-live-traceable-data §3.1，additive）：合成对象现经"合成数据源→RawDataset→物化"
  // 落地，origin 记源头 backref（sourceConnId/rawDatasetId/rawRowIdx）→ 结果可溯回原始行与连接器。
  | { type: "SYNTHETIC"; jobId: string; sourceConnId?: string; rawDatasetId?: string; rawRowIdx?: number }
  | { type: "MATERIALIZED"; datasetId: string; jobId: string }
  | { type: "MANUAL" }
  // Dogfooding：系统本体自反投影（从 SYSTEM-ONTOLOGY.md/prd-index 确定性重生成,可溯回章节锚点）。
  | { type: "META"; source: string; anchor?: string };

export interface ObjectInstance {
  id: string; // obj_
  tenantId: string;
  type: string; // objectType key
  props: Record<string, unknown>;
  origin: ObjectOrigin;
  /** 本体原子规格 §1：业务主键（缺省 = props[primaryKey]）。 */
  objectKey?: string;
  /** 本体原子规格 §1：写入批次序号（snapshotVersion = {ontologyVersion}.{epoch}）。 */
  epoch?: number;
  /** OC1 实体解析：被并入 golden 对象的 id（置则该对象不出现在查询/切片/聚合，只见 golden）。 */
  mergedInto?: string;
  updatedAt?: string;
}

/**
 * 本体原子规格 §1：epoch 是租户级单调序列；每个写入批次（连接器同步/对象化/
 * 派生运行/Action 写回）+1，批内所有行打同一 epoch。一条/租户（id == tenantId）。
 */
export interface EpochCounterRecord {
  id: string; // == tenantId
  tenantId: string;
  epoch: number;
  updatedAt: string;
}

/**
 * 本体原子规格 §1：temporal=true 属性变更落历史（append-only）。当前值始终在
 * objects.props，读路径不查此表。
 */
export interface ObjectPropHistoryRecord {
  id: string; // ophist_
  tenantId: string;
  objectId: string;
  prop: string;
  value: unknown;
  epoch: number;
  validFrom: string;
  recordedAt: string;
  provenance?: Record<string, unknown>;
}

/**
 * 本体原子规格 §2：派生规格（编译期解析公式→缓存 deps）。spec_key 唯一/版本。
 */
export interface DerivationSpecRecord {
  id: string; // dspec_
  tenantId: string;
  ontologyVersion: number;
  specKey: string;
  targetType: string;
  targetProp: string;
  formula: string; // §2 DSL
  deps: { typeKey: string; prop: string; via?: string; direction?: "out" | "in" }[];
  status: "ACTIVE" | "RETIRED";
}

/**
 * 本体原子规格 §2.4：每次派生写值同步记录（inputs 快照 + epoch），溯源弹窗数据源。
 */
export interface DerivationValueRunRecord {
  id: string; // dvrun_
  tenantId: string;
  specId: string;
  specKey: string;
  objectId: string;
  targetProp: string;
  value: unknown;
  inputs: { objectId: string; prop: string; value: unknown }[];
  epoch: number;
  ranAt: string;
  warnings?: string[];
}

/** 本体原子规格 §3：切片规格（版本化场景包内容，slices 表）。 */
export interface SliceSpecRecord {
  id: string; // slice_
  tenantId: string;
  sliceKey: string;
  version: number;
  spec: {
    root: { typeKey: string; selector: { byKey?: string; filter?: Record<string, unknown> } };
    paths: {
      linkKey: string;
      direction: "out" | "in";
      filter?: Record<string, unknown>;
      limitPerNode?: number;
      project?: string[];
    }[][];
    maxNodes?: number;
    /** 治理增量 §7.2：切片契约 fixtures（每 PUBLISHED slice ≥1）。 */
    contractFixtures?: {
      name: string;
      args: Record<string, string | number>;
      expect: {
        rootType: string;
        minNodes: number;
        mustIncludeTypes: string[];
        mustIncludeLinkKeys?: string[];
        maxNodes?: number;
      };
    }[];
  };
}

export interface LinkInstance {
  id: string; // lnk_
  tenantId: string;
  type: string; // linkType key
  fromId: string;
  toId: string;
  /** Edge properties (e.g. certification status on model↔line links, §S1.2). */
  props?: Record<string, unknown>;
  origin: ObjectOrigin;
}

export interface DerivationRun {
  id: string; // drun_
  tenantId: string;
  startedAt: string;
  finishedAt?: string;
  updatedObjects: number;
  order: string[]; // type keys in topo order
  status: "SUCCEEDED" | "FAILED";
  error?: string;
}

/** S2 action draft with the full approval state machine (contracts ActionDraftSchema shape). */
export interface ActionDraft {
  id: string; // act_
  tenantId: string;
  actionTypeKey: string;
  payload: Record<string, unknown>; // immutable after submit
  origin: { taskId?: string; agentId?: string; userId: string };
  status: ActionStatus;
  approvalSteps: ApprovalStep[];
  executionResult?: { ok: boolean; targetRef?: string; error?: string; attempts: number };
  createdAt: string;
  updatedAt: string;
}

export interface ActionTypeRecord extends ActionType {
  id: string; // atype_
  tenantId: string;
}

// ---------------------------------------------------------------------------
// A3 modeling
// ---------------------------------------------------------------------------

export type DraftOperation =
  | { op: "renameType"; typeKey: string; newTypeKey: string; newDisplayName?: string }
  | {
      op: "addProperty";
      typeKey: string;
      property: {
        propKey: string;
        sourceField: string;
        dataType: "string" | "number" | "boolean" | "date" | "enum" | "ref";
        isPrimaryKey: boolean;
        refToTypeKey: string | null;
      };
    }
  | { op: "removeProperty"; typeKey: string; propKey: string }
  | { op: "renameProperty"; typeKey: string; propKey: string; newPropKey: string }
  | { op: "setRef"; typeKey: string; propKey: string; refToTypeKey: string | null }
  | { op: "setPrimaryKey"; typeKey: string; propKey: string }
  | { op: "setDomain"; typeKey: string; domain: string }
  | { op: "removeObjectType"; typeKey: string };

export interface FkCandidate {
  fromDataset: string;
  fromField: string;
  toDataset: string;
  toField: string;
  containment: number;
}

export interface OntologyDraft {
  id: string; // draft_
  tenantId: string;
  status: "DRAFT" | "REVIEWED" | "PUBLISHED";
  rawDatasetIds: string[];
  fkCandidates: FkCandidate[];
  suggestion: import("@platform/contracts").ModelingSuggestion;
  operationLog: { at: string; operation: DraftOperation }[];
  publishedVersion?: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// A7 synthetic
// ---------------------------------------------------------------------------

export interface IndustryTemplateRecord {
  id: string; // tmpl_
  tenantId: string;
  industryKey: string;
  template: IndustryTemplate;
  source: "BUILTIN" | "LLM";
  createdAt: string;
}

export interface SyntheticJob {
  id: string; // job_
  tenantId: string;
  industry: string;
  scale: "S" | "M" | "L" | "XL";
  seed: number;
  status: "SUCCEEDED" | "FAILED";
  report?: SyntheticReport;
  error?: string;
  createdAt: string;
  /** 运营态出厂配置增量 §1：livedIn 回放统计（批次/天数/点数/墙钟耗时）。 */
  livedIn?: { batches: number; days: number; points: number; durationMs: number };
}

export interface SyntheticReport {
  rowCounts: Record<string, number>;
  fkChecks: { check: string; passed: boolean; sampled: number }[];
  ruleScan: { ruleKey: string; evaluated: number; violations: number }[];
  derivationSpotChecks: { typeKey: string; propKey: string; objectId: string; ok: boolean }[];
  views: string[];
  accounts: string[];
  /** A8.6: history point counts / gap scan / aggregation spot recomputation. */
  timeseries?: {
    pointCounts: Record<string, number>;
    gaps: { seriesKey: string; entityId: string; missingDays: number }[];
    aggSpotChecks: { specKey: string; entityId: string; ok: boolean }[];
  };
}

// ---------------------------------------------------------------------------
// C-2 webhook outbox
// ---------------------------------------------------------------------------

export interface WebhookRegistration {
  id: string; // wh_
  tenantId: string;
  url: string;
  events: string[]; // e.g. ["ontology.published", "rules.updated"]
  status: "ACTIVE" | "DISABLED";
}

export interface OutboxEvent {
  id: string; // evt_
  tenantId: string;
  /** §2: globally-unique id consumers dedupe on (defaults to id for legacy rows). */
  eventId: string;
  event: string;
  /** §2: per-aggregate ordering — same aggregateKey delivered serially by seq. */
  aggregateKey: string;
  seq: number;
  payload: Record<string, unknown>;
  status: "PENDING" | "DELIVERED" | "FAILED" | "DEAD";
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Execution semantics（PRD-addendum-execution-semantics §1/§4/§6）
// ---------------------------------------------------------------------------

/** §1 管线执行互斥与重入：每 (kind,key) 一行，fence 单调每次获取 +1。 */
export interface ExecutionLockRecord {
  id: string; // = `${resourceKind}|${resourceKey}`
  tenantId: string;
  resourceKind: string;
  resourceKey: string;
  holderId: string;
  acquiredAt: string;
  leaseUntil: string;
  fence: number;
  /** §1.3 变更触发类：持锁期间累积的"待重跑"标志。 */
  rerunRequested: boolean;
}

/** §2/§4 幂等记录：同键重复请求返回首次结果摘要（7d 过期）。 */
export interface IdempotencyRecord {
  id: string; // = idempotency key
  tenantId: string;
  scope: string; // e.g. "approval" | "sop" | "replay"
  responseDigest: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

/** §4 回放进度检查点：每 tick 提交，中断重入从 last+1 续。 */
export interface ReplayProgressRecord {
  id: string; // = `replay|${tenantId}`
  tenantId: string;
  lastCompletedTick: number;
  updatedAt: string;
}

/** 闭环验证引擎 VLE：一次验证运行的报告（七段×断言点 + 覆盖率 + 工程验证度）。 */
export interface ValidationRunRecord {
  id: string; // vrun_
  tenantId: string;
  profile: "SMOKE" | "FULL" | "SOAK";
  seed: number;
  startedAt: string;
  finishedAt?: string;
  report?: Record<string, unknown>;
}

/** 运营完备性 §9 通知中心：定向站内通知（铃铛未读 + 跳转 refType 对应页）。 */
export interface NotificationRecord {
  id: string; // ntf_
  tenantId: string;
  userId: string;
  kind: string; // approval_pending | action_approved | action_rejected | ...
  title: string;
  body: string;
  refType?: string; // action | sop | ...
  refId?: string;
  readAt?: string;
  createdAt: string;
}

/** 运营完备性 §4 数据隔离区：行级失败不再使批次失败，异常行落隔离区可修复重处理。 */
/** Dogfooding P2：元本体访问策略记录（id=tenantId;角色白名单,默认 ["admin"]）。 */
export interface MetaAccessPolicyRecord {
  id: string; // = tenantId
  tenantId: string;
  roles: string[];
  updatedAt?: string;
}

export interface QuarantineRowRecord {
  id: string; // qr_
  tenantId: string;
  connId: string; // datasetId（来源管线锚点）
  dataset: string; // dataset 名
  raw: Record<string, unknown>; // 原始行（可行内编辑后重投）
  reason: "SCHEMA_MISMATCH" | "TYPE_ERROR" | "REF_NOT_FOUND" | "UNIT_ERROR" | "RULE_REJECT" | "DUP_KEY";
  detail?: string;
  status: "PENDING" | "REPROCESSED" | "DISCARDED";
  /** 重处理上下文：目标类型 + 字段映射 + 主键（重投时重建对象）。 */
  reprocess: { targetKey: string; mapping: { propKey: string; sourceField: string }[]; pk?: string };
  createdAt: string;
}

/** §6 A2 分段抽取的段落级状态表（PARTIAL 任务可单段重试）。 */
export interface ExtractSegmentRecord {
  id: string; // = `${docId}|${segNo}`
  tenantId: string;
  docId: string;
  segNo: number;
  status: "OK" | "FAILED" | "PENDING";
  result?: Record<string, unknown>;
  error?: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// S1.8 S&OP monthly plan versions
// ---------------------------------------------------------------------------

export interface SopVersion {
  id: string; // sop_
  tenantId: string;
  month: string; // "2026-07"
  status: SopVersionStatus;
  inputs: Record<string, unknown>;
  steps: {
    s1?: Record<string, unknown>;
    s2?: Record<string, unknown>;
    s3?: Record<string, unknown>;
    s4?: Record<string, unknown>;
    s5?: Record<string, unknown>;
  };
  agenda: { source: string; title: string; detail?: Record<string, unknown> }[];
  resolutions: { name: string; delta: number }[];
  supFinal?: number;
  /** 增量 §7.12：定稿 Action 草稿已创建、待审批（EXECUTED → FINAL 时清除） */
  pendingApproval?: { draftId: string } | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// S3 scheduler
// ---------------------------------------------------------------------------

export interface ScheduledJobRecord {
  id: string; // sjob_
  tenantId: string;
  kind: ScheduledJobKind;
  refId: string;
  cron: string;
  timezone: string;
  nextRunAt: string;
  lastRunAt?: string;
  status: "ACTIVE" | "PAUSED";
  lastError?: string;
}

export interface SchedulerRunRecord {
  id: string; // `${jobId}@${scheduledAt}` — the idempotency key
  tenantId: string;
  jobId: string;
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "MISSED";
  error?: string;
}

// ---------------------------------------------------------------------------
// A8 timeseries
// ---------------------------------------------------------------------------

export interface TsSeriesRecord {
  id: string; // tser_
  tenantId: string;
  connId?: string;
  seriesKey: string; // e.g. "oee:equip"
  entityType: string;
  entityRefField: string;
  timeField: string;
  measureFields: string[]; // [0] is the primary measure; weighted_avg weight may be [1]
  unit?: string;
  origin?: "SYNTHETIC" | "CONNECTOR";
  createdAt: string;
}

export interface TsPointRecord {
  seriesId: string;
  entityId: string;
  ts: string; // ISO timestamp (bucket start for day-grain synthetic data)
  values: Record<string, number>;
  ingestedAt: string;
  tick?: number; // simulation tick that produced the point (0 = initial history)
  /** 运营态增量 §6：origin 标记（缺省 = 系列 origin；LIVE = 真历史按月回填覆盖）。 */
  origin?: "SYNTHETIC" | "LIVE";
}

export interface TsLateArrivalRecord {
  id: string;
  tenantId: string;
  seriesId: string;
  entityId: string;
  ts: string;
  values: Record<string, number>;
  receivedAt: string;
}

export interface TsAggSpecRecord extends TsAggSpec {
  lastRunAt?: string;
}

export interface TsAggRunRecord {
  id: string; // run id (specKey + entity + window)
  tenantId: string;
  specId: string;
  specKey: string;
  specVersion: number;
  entityId: string;
  windowStart: string;
  windowEnd: string;
  rowsIn: number;
  value: number;
  runAt: string;
}

export interface RetentionPolicyRecord {
  id: string;
  tenantId: string;
  seriesKey: string;
  rawDays: number;
  downsampleAfterDays?: number;
  downsampleGrain?: "day" | "week";
}

// ---------------------------------------------------------------------------
// A8.6 simulation clock
// ---------------------------------------------------------------------------

export interface SimulationClockRecord {
  id: string; // == tenantId
  tenantId: string;
  t0: string; // ISO date of "now" at initial synthesis
  currentTick: number;
  seed: number;
  industry: string;
  scale: "S" | "M" | "L" | "XL";
  status: "ACTIVE" | "TICKING" | "RESETTING";
  firedEvents: { tick: number; event: string; params: Record<string, unknown> }[];
  /** alert keys (ruleKey:entityId) active after the last RULE_SCAN — for raised/cleared diffs */
  activeAlerts: string[];
}

export interface ClockTickReport {
  id: string; // tickjob_
  tenantId: string;
  fromTick: number;
  toTick: number;
  newPoints: number;
  topChangedSnapshots: { objectId: string; objectType: string; property: string; from: number | null; to: number }[];
  alertsRaised: string[];
  alertsCleared: string[];
  scenarioEvents: { tick: number; event: string }[];
  forecastDeviation?: { modelId: string; predictedDaily: number; actualDaily: number; deviation: number };
  createdAt: string;
}

/** Stored when capacity_forecast runs — feeds the T9 deviation/calibration loop. */
export interface ForecastSnapshotRecord {
  id: string; // fcst_<tenant>_<model>
  tenantId: string;
  modelId: string;
  p50: number;
  weeks: number;
  predictedDaily: number; // 万套/日
  createdAt: string;
}

// ---------------------------------------------------------------------------
// M11 校准（§7.21）：参数更新提案 + 校准历史（提案变更必须走 校准参数变更 Action）
// ---------------------------------------------------------------------------

export type CalibrationMethodKind = "EMA" | "REPLAY_ATTRIBUTION" | "QUANTILE";

export interface CalibrationEvidenceRecord {
  windowFrom: string;
  windowTo: string;
  nPairs: number;
  mapeBefore: number; // %（百分点口径）
  simulatedMapeAfter: number; // % — 建议参数对窗口内全部配对样本重放
  bias: number; // Σerror / Σactual
  flags: string[]; // STRUCTURAL_SHIFT | NO_IMPROVEMENT | FREQUENCY_LIMIT | CASCADE_HOLD | AUTO_APPLIED | …
}

export interface CalibrationProposalRecord {
  id: string; // cal_（M11；旧种子 calp_ 兼容）
  tenantId: string;
  parameter: string; // 节拍/良率/OEE 基线 等展示名
  /** solver_params 内的点路径（如 "ramp.base"），Action EXECUTED 后写入（= paramRef.path） */
  paramPath: string;
  objectRef?: string;
  currentValue: number;
  proposedValue: number;
  basis: { windowFrom: string; windowTo: string; samples: number };
  trigger: string; // "C12" | "手动" | "CALIBRATION_RUN"
  status: "PENDING" | "APPLIED" | "ROLLED_BACK" | "REJECTED" | "HOLD";
  /** 应用前的旧值（回滚还原用） */
  appliedFrom?: number;
  appliedAt?: string;
  createdAt: string;
  // ---- M11 增量 ----
  sliceKey?: string; // solverKey|baseId|modelId
  paramRef?: { scope: "SOLVER_PARAMS" | "ONTOLOGY_PROPERTY"; path: string };
  method?: CalibrationMethodKind;
  evidence?: CalibrationEvidenceRecord;
  /** §6 元闭环：APPLIED 14 天后回写（预言 vs 实现） */
  realizedMape?: number;
  /** 应用后的 solver_params 版本（回滚 = 恢复上一版本） */
  appliedParamsVersion?: number;
  /** 应用时刻的模拟时钟 tick（元闭环 14 个模拟日计时锚点） */
  appliedTick?: number;
  /** ONTOLOGY_PROPERTY scope：应用前各对象旧值快照（精确回滚） */
  appliedSnapshot?: Record<string, number>;
}

export interface CalibrationHistoryRecord {
  id: string; // calh_
  tenantId: string;
  at: string;
  trigger: string; // "C12" | "手动" | "回滚"
  changedParams: string[];
  mapeBefore: number;
  mapeAfter: number;
  // ---- M11 增量：预言 vs 实现 ----
  proposalId?: string;
  method?: CalibrationMethodKind;
  simulatedMapeAfter?: number;
  realizedMape?: number;
}

// ---------------------------------------------------------------------------
// M11 §1 配对引擎：轻量预测记录（capacity_forecast 运行/快照刷新时写入）+
// 配对样本（窗口完全过期 + 数据新鲜度正常后一次性配对）。
// ---------------------------------------------------------------------------

export interface CalibrationForecastRecord {
  id: string; // calf_<tenant>_<solver>_<model>_<base|all>_<date>
  tenantId: string;
  solverKey: string; // capacity_forecast
  modelId: string;
  /** undefined = 全基地合计；否则单基地切片 */
  baseId?: string;
  windowFrom: string; // ISO date（本期按日窗口：from == to）
  windowTo: string;
  predicted: number; // 万套/日（窗口内日均预测）
  predictedP90: number; // predicted × healthFactor
  paramsVersion: number; // 预测时的 solver_params 版本
  weekOfWindow: number; // 距 forecastStart 的预测周序（1 起，爬坡归因用）
  createdAt: string;
  /** 一个预测只配对一次 */
  pairedAt?: string;
}

export interface CalibrationPairRecord {
  id: string; // calpair_
  tenantId: string;
  solverKey: string;
  entityRef: string; // "Model:<id>" 或 "Model:<id>@Base:<id>"
  modelId: string;
  baseId?: string;
  windowFrom: string;
  windowTo: string;
  predicted: number;
  predictedP90: number;
  actual: number; // ts_agg_runs 同窗口聚合（A8）
  error: number; // predicted − actual
  ape: number; // |error| / max(actual, ε)
  paramsVersion: number;
  /** 预测后参数已变更：仍用于评估旧参数，不进入新提案回测基线 */
  staleParams: boolean;
  sliceKey: string; // solverKey|baseId|modelId
  weekOfWindow: number;
  pairedAt: string;
}

// ---------------------------------------------------------------------------
// 运营态出厂配置增量（lived-in）：告警-处置闭环案例 + 运营态元数据
// ---------------------------------------------------------------------------

/** §1.2 告警-处置闭环案例：越线日→采纳方案（关联 Action）→曲线消解→受影响订单清单。 */
export interface RiskCaseRecord {
  id: string; // case_lh_<tenant>_<n>
  tenantId: string;
  caseNo: string; // CASE-001..
  title: string;
  baseId: string;
  baseName: string;
  factor: string;
  severity: string;
  windowFrom: string; // 风险窗口（叙事互引的时间窗）
  windowTo: string;
  crossedAt: string;
  adoptedAt: string;
  resolvedAt: string;
  mitigation: { name: string; planKey: string };
  /** 关联的已执行 Action（act_lh_*） */
  actionId: string;
  affectedOrders: string[]; // SO 号
  timeline: { date: string; event: string }[];
  tags: string[]; // 如 ["到货危机"]
  /** 前端案例点击回放当时的时序曲线（query_timeseries_agg 参数） */
  curve: { seriesKey: string; entityId: string; from: string; to: string };
}

/**
 * 运营态元数据（livedIn 合成时写入，每租户一条，id == tenantId）：
 * generatedFrom（水印来源）、52 周 MAPE 叙事、场景任务史副本（事实源 =
 * contracts LIVED_IN_SCENE_HISTORY 常量，A/B 各自消费同一常量）、孵化记录、
 * 规则演进备注、LIVE 回填月份（origin 替换路径 §6）。
 */
export interface LivedInStateRecord {
  id: string; // == tenantId
  tenantId: string;
  generatedFrom: {
    industry: string;
    scale: string;
    seed: number;
    jobId: string;
    replayFrom: string;
    replayTo: string;
    replayDays: number;
  };
  crisisWindow: { from: string; to: string };
  mapeSeries: { week: number; weekStart: string; mape: number; event?: string }[];
  taskHistory: { scene: string; question: string; answer: string; trustLevel: string; date: string }[];
  incubated: { intentKey: string; name: string; question: string; count: number; incubatedAt: string }[];
  ruleChanges: { key: string; name: string; version: number; label: string; expression: string; reason: string; changedAt: string; status: string; tags: string[] }[];
  liveMonths: string[];
  replay: { batches: number; days: number; points: number };
}

/** S1 修订：solver_params 版本历史（runWithParams(version) / 回滚锚点）。 */
export interface SolverParamsHistoryRecord {
  id: string; // sparh_<tenant>_v<version>
  tenantId: string;
  version: number;
  params: Record<string, unknown>;
  note?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// S4 knowledge base / vectors
// ---------------------------------------------------------------------------

export interface KbDocRecord {
  id: string; // kbdoc_
  tenantId: string;
  connId: string;
  filename: string;
  blobKey: string;
  chunkCount: number;
  createdAt: string;
}

export interface KbChunkRecord {
  id: string; // kbch_
  tenantId: string;
  connId: string;
  docId: string;
  seq: number;
  text: string;
  span: { start: number; end: number };
  embedding: number[];
}

// ---------------------------------------------------------------------------
// Feature entitlement
// ---------------------------------------------------------------------------

export interface FeatureConfigRecord {
  id: string; // fcfg_<tenant> | fcfg_<tenant>_<role>
  tenantId: string;
  role?: string; // absent = tenant layer
  overrides: Record<string, boolean>;
  configVersion: number;
  updatedBy: string;
  updatedAt: string;
}

export interface FeatureAuditRecord {
  id: string;
  tenantId: string;
  role?: string;
  diff: Record<string, { from: boolean | null; to: boolean }>;
  configVersion: number;
  updatedBy: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Per-tenant solver params (scenario-pack constants, §S1 通用约定)
// ---------------------------------------------------------------------------

export interface SolverParamsRecord {
  id: string; // spar_<tenant>
  tenantId: string;
  params: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

export type { PermissionPolicy };

// ---------------------------------------------------------------------------
// LLM Provider 配置体系增量 §1.1（表 llm_providers / llm_purpose_bindings）
// ---------------------------------------------------------------------------

export interface LlmProviderRecord {
  id: string; // llmp_
  tenantId: string; // "platform" = 平台级模板（platform_admin 维护，可克隆）
  name: string;
  kind: "anthropic" | "openai_compatible" | "custom_http";
  baseUrl?: string;
  /** apiKey 写入即 AES-GCM 密文（与连接器凭据同套 CredentialCipher），永不回显 */
  apiKeyCiphertext?: string;
  models: {
    modelId: string;
    displayName: string;
    capabilities: { tools: boolean; structuredOutput: boolean; maxContext: number };
  }[];
  status: "ACTIVE" | "DISABLED";
  /** 不可用时的降级目标（≤1 级，禁止链式） */
  fallbackProviderId?: string;
  createdAt: string;
  updatedAt: string;
}

/** 增量 §1.3：用途绑定（租户级默认；id = llmb_{purpose}，每租户每用途一条）。 */
export interface LlmPurposeBindingRecord {
  id: string; // llmb_{purpose}
  tenantId: string;
  purpose: string; // classifier|agent|extraction|modeling|template_gen|compose
  providerId: string;
  modelId: string;
  /** 关思考开关（Moonshot kimi-k2.5/k2.6）：true → 该用途调用注入 thinking:{type:"disabled"}（秒级直出）。 */
  disableThinking?: boolean;
  updatedAt: string;
}

/**
 * 引用模式增量 §2.3：B→A 引用上报登记（B 资源发布时上报其对 A 资源的出向引用，
 * 规则发布据此反查影响面）。id = refr_{sourceKind}_{sourceKey}（每来源一条，覆盖式）。
 */
export interface ReportedRefRecord {
  id: string;
  tenantId: string;
  source: { kind: string; key: string; name?: string };
  refs: { kind: string; key: string; version: number | "latest" }[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 回放编排器与虚拟操作团队（PRD-addendum-replay-orchestrator）
// ---------------------------------------------------------------------------

/**
 * §6 OpsSchedule 存储记录（tenantId 唯一 → id == tenantId）。
 * 契约 OpsScheduleRecord 的存储映射（额外携带 Store 必需的 id）。
 */
export interface OpsScheduleStoreRecord {
  id: string; // == tenantId
  tenantId: string;
  forecasts: { cron: string; modelIds: string[] | "ALL_ACTIVE"; weeks: number }[];
  sopCycle?: { openCron: string; stepDeadlines: number[]; escalateAfterDays: number };
  approvalReminder?: { remindAfterDays: number; escalateAfterDays: number; escalateToRole: string };
  autoApprove?: { actionTypes: string[]; maxAmount?: number; enabled: boolean };
  updatedAt: string;
  updatedBy: string;
}

/**
 * §3 OpsTickReport 持久化（每 SYNTHETIC 租户的剧本第⑦步执行报告，可下钻）。
 * id == ops_tick_<tenant>_<tick>。
 */
export interface OpsTickReportRecord {
  id: string;
  tenantId: string;
  tick: number;
  date: string;
  executed: { kind: string; persona: string; ref?: string; decision?: string }[];
  skipped: { kind: string; persona: string; reason: string }[];
  createdAt: string;
}
