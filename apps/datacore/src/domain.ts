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
}

// ---------------------------------------------------------------------------
// A2 rule docs
// ---------------------------------------------------------------------------

export type RuleDocStatus =
  | "UPLOADED"
  | "PARSED"
  | "EXTRACTED"
  | "IN_REVIEW"
  | "PUBLISHED"
  | "REJECTED";

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
  origin: RuleOrigin;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
}

// ---------------------------------------------------------------------------
// A4 ontology + objects
// ---------------------------------------------------------------------------

export interface PropertyDef {
  propKey: string;
  dataType: "string" | "number" | "boolean" | "date" | "enum" | "ref" | "json";
  isPrimaryKey: boolean;
  refToTypeKey?: string | null;
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

export interface ObjectTypeDef {
  id: string; // otype_
  tenantId: string;
  key: string;
  displayName: string;
  properties: PropertyDef[];
  derivedProperties: DerivedPropertyDef[];
  sourceBindings: SourceBinding[];
  version: number;
  status: "ACTIVE" | "RETIRED";
}

export interface LinkTypeDef {
  id: string; // ltype_
  tenantId: string;
  key: string;
  fromTypeKey: string;
  toTypeKey: string;
  cardinality: "1:1" | "1:N" | "N:N";
  version: number;
}

export interface OntologyVersion {
  id: string; // over_
  tenantId: string;
  version: number;
  snapshot: { objectTypes: ObjectTypeDef[]; linkTypes: LinkTypeDef[] };
  createdAt: string;
}

export type ObjectOrigin =
  | { type: "SYNTHETIC"; jobId: string }
  | { type: "MATERIALIZED"; datasetId: string; jobId: string }
  | { type: "MANUAL" };

export interface ObjectInstance {
  id: string; // obj_
  tenantId: string;
  type: string; // objectType key
  props: Record<string, unknown>;
  origin: ObjectOrigin;
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
  scale: "S" | "M" | "L";
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
  event: string;
  payload: Record<string, unknown>;
  status: "PENDING" | "DELIVERED" | "FAILED";
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
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
  scale: "S" | "M" | "L";
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
