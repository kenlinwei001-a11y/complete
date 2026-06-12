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
}

export interface User {
  id: string;
  tenantId: string;
  username: string;
  passwordHash: string;
  roles: string[];
  attributes: Record<string, unknown>; // e.g. { baseScope: ["changzhou"] }
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

export interface CalibrationProposalRecord {
  id: string; // calp_
  tenantId: string;
  parameter: string; // 节拍/良率/OEE 基线 等展示名
  /** solver_params 内的点路径（如 "ramp.base"），Action EXECUTED 后写入 */
  paramPath: string;
  objectRef?: string;
  currentValue: number;
  proposedValue: number;
  basis: { windowFrom: string; windowTo: string; samples: number };
  trigger: string; // "C12" | "手动"
  status: "PENDING" | "APPLIED" | "ROLLED_BACK";
  /** 应用前的旧值（回滚还原用） */
  appliedFrom?: number;
  appliedAt?: string;
  createdAt: string;
}

export interface CalibrationHistoryRecord {
  id: string; // calh_
  tenantId: string;
  at: string;
  trigger: string; // "C12" | "手动" | "回滚"
  changedParams: string[];
  mapeBefore: number;
  mapeAfter: number;
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
