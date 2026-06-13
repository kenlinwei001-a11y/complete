import type {
  ActionDraft,
  ActionTypeRecord,
  CalibrationForecastRecord,
  CalibrationHistoryRecord,
  CalibrationPairRecord,
  CalibrationProposalRecord,
  ClockTickReport,
  Connection,
  DerivationRun,
  DerivationSpecRecord,
  DerivationValueRunRecord,
  DomainRecord,
  DynamicFeatureRecord,
  ElementRefRecord,
  ObjectPropHistoryRecord,
  PublishRequestRecord,
  SliceSpecRecord,
  FeatureAuditRecord,
  FeatureConfigRecord,
  ForecastSnapshotRecord,
  IndustryTemplateRecord,
  KbChunkRecord,
  KbDocRecord,
  LinkInstance,
  LinkTypeDef,
  LivedInStateRecord,
  LlmProviderRecord,
  LlmPurposeBindingRecord,
  ObjectInstance,
  ObjectTypeDef,
  OntologyDraft,
  OntologyVersion,
  OpsScheduleStoreRecord,
  OpsTickReportRecord,
  OutboxEvent,
  PermissionPolicy,
  RawDataset,
  ReportedRefRecord,
  RetentionPolicyRecord,
  RiskCaseRecord,
  Rule,
  RuleCandidate,
  RuleDoc,
  ScenarioPackageRecord,
  ScheduledJobRecord,
  SchedulerRunRecord,
  SimulationClockRecord,
  SolverParamsHistoryRecord,
  SolverParamsRecord,
  SopVersion,
  SyncJob,
  SyntheticJob,
  Tenant,
  TsAggRunRecord,
  TsAggSpecRecord,
  TsLateArrivalRecord,
  TsPointRecord,
  TsSeriesRecord,
  User,
  ViewConfig,
  WebhookRegistration,
} from "../domain.js";

/** Generic tenant-scoped entity store. The tenant filter is enforced here (layer 1). */
export interface Store<T extends { id: string; tenantId: string }> {
  get(tenantId: string, id: string): Promise<T | undefined>;
  put(item: T): Promise<void>;
  remove(tenantId: string, id: string): Promise<void>;
  list(tenantId: string, pred?: (t: T) => boolean): Promise<T[]>;
}

/** 管理平台增量 §1：bootstrap 检测「users 表为空」需要跨租户计数。 */
export interface UserStore extends Store<User> {
  countAll(): Promise<number>;
}

/** 管理平台增量 §2：platform_admin 跨租户列出全部租户。 */
export interface TenantStore extends Store<Tenant> {
  listAll(): Promise<Tenant[]>;
}

export interface ObjectStore extends Store<ObjectInstance> {
  listByType(tenantId: string, type: string): Promise<ObjectInstance[]>;
  removeWhere(tenantId: string, pred: (o: ObjectInstance) => boolean): Promise<number>;
}

export interface LinkStore extends Store<LinkInstance> {
  removeWhere(tenantId: string, pred: (l: LinkInstance) => boolean): Promise<number>;
}

/**
 * 本体原子规格 §1：epoch 是租户级单调序列。next() 原子自增并返回新值（写入批次锚点）。
 */
export interface EpochStore {
  /** Current epoch (0 if never advanced). */
  current(tenantId: string): Promise<number>;
  /** Atomically increment and return the new epoch for a write batch. */
  next(tenantId: string): Promise<number>;
}

export interface RawRowStore {
  replace(tenantId: string, datasetId: string, rows: Record<string, unknown>[]): Promise<void>;
  list(tenantId: string, datasetId: string): Promise<Record<string, unknown>[]>;
}

// ---------------------------------------------------------------------------
// S3 scheduler — claimDue must be atomic w.r.t. concurrent ticks
// (pg: SELECT … FOR UPDATE SKIP LOCKED; memory: synchronous claim-and-advance).
// ---------------------------------------------------------------------------

export interface ClaimedJob {
  job: ScheduledJobRecord;
  scheduledAt: string;
}

export interface ScheduledJobStore extends Store<ScheduledJobRecord> {
  /**
   * Atomically claim jobs whose nextRunAt <= now and status ACTIVE, advancing
   * nextRunAt via `nextFn(cron, timezone, after)`. Concurrent callers never
   * receive the same (job, scheduledAt) pair.
   */
  claimDue(
    nowIso: string,
    nextFn: (cron: string, timezone: string, afterIso: string) => string,
  ): Promise<ClaimedJob[]>;
}

// ---------------------------------------------------------------------------
// A8 timeseries points (raw layer — never reachable from LLM-facing tools)
// ---------------------------------------------------------------------------

export interface TsPointQuery {
  entityIds?: string[];
  from?: string; // inclusive
  to?: string; // exclusive
}

export interface TsPointStore {
  /** Idempotent upsert keyed (seriesId, entityId, ts). Returns number written. */
  upsert(tenantId: string, points: TsPointRecord[]): Promise<number>;
  list(tenantId: string, seriesId: string, q?: TsPointQuery): Promise<TsPointRecord[]>;
  /** Points ingested after `since` — drives incremental aggregation (incl. late points). */
  listIngestedSince(tenantId: string, seriesId: string, since: string): Promise<TsPointRecord[]>;
  maxTs(tenantId: string, seriesId: string): Promise<string | undefined>;
  count(tenantId: string, seriesId?: string): Promise<number>;
  removeWhere(tenantId: string, pred: (p: TsPointRecord) => boolean): Promise<number>;
}

// ---------------------------------------------------------------------------
// S4 vector index over kb_chunks (memory cosine / pgvector with JSONB fallback)
// ---------------------------------------------------------------------------

export interface VectorHit {
  chunk: KbChunkRecord;
  score: number;
}

export interface VectorIndex {
  upsert(chunks: KbChunkRecord[]): Promise<void>;
  search(
    tenantId: string,
    queryVec: number[],
    topK: number,
    filter?: (c: KbChunkRecord) => boolean,
  ): Promise<VectorHit[]>;
  removeByDoc(tenantId: string, docId: string): Promise<void>;
}

export interface Repos {
  tenants: TenantStore;
  users: UserStore;
  viewConfigs: Store<ViewConfig>;
  policies: Store<PermissionPolicy>;
  connections: Store<Connection>;
  syncJobs: Store<SyncJob>;
  rawDatasets: Store<RawDataset>;
  rawRows: RawRowStore;
  ruleDocs: Store<RuleDoc>;
  ruleCandidates: Store<RuleCandidate>;
  rules: Store<Rule>;
  ontologyTypes: Store<ObjectTypeDef>;
  ontologyLinks: Store<LinkTypeDef>;
  ontologyDrafts: Store<OntologyDraft>;
  ontologyVersions: Store<OntologyVersion>;
  objects: ObjectStore;
  links: LinkStore;
  derivationRuns: Store<DerivationRun>;
  // 本体原子规格 §1/§2/§3（additive；008_ontology_core.sql）
  epochs: EpochStore;
  objectPropHistory: Store<ObjectPropHistoryRecord>;
  derivationSpecs: Store<DerivationSpecRecord>;
  derivationValueRuns: Store<DerivationValueRunRecord>;
  sliceSpecs: Store<SliceSpecRecord>;
  // 治理增量（009_ontology_governance.sql）
  domains: Store<DomainRecord>;
  elementRefs: Store<ElementRefRecord>;
  publishRequests: Store<PublishRequestRecord>;
  actionDrafts: Store<ActionDraft>;
  actionTypes: Store<ActionTypeRecord>;
  industryTemplates: Store<IndustryTemplateRecord>;
  syntheticJobs: Store<SyntheticJob>;
  outboxEvents: Store<OutboxEvent>;
  webhooks: Store<WebhookRegistration>;
  // S1.8
  sopVersions: Store<SopVersion>;
  // S1 per-tenant solver params（+ M11/S1 修订：版本历史）
  solverParams: Store<SolverParamsRecord>;
  solverParamsHistory: Store<SolverParamsHistoryRecord>;
  // S3
  scheduledJobs: ScheduledJobStore;
  schedulerRuns: Store<SchedulerRunRecord>;
  // S4
  kbDocs: Store<KbDocRecord>;
  kbChunks: VectorIndex;
  // A8
  tsSeries: Store<TsSeriesRecord>;
  tsPoints: TsPointStore;
  tsLateArrivals: Store<TsLateArrivalRecord>;
  tsAggSpecs: Store<TsAggSpecRecord>;
  tsAggRuns: Store<TsAggRunRecord>;
  retentionPolicies: Store<RetentionPolicyRecord>;
  simulationClocks: Store<SimulationClockRecord>;
  clockTickReports: Store<ClockTickReport>;
  forecastSnapshots: Store<ForecastSnapshotRecord>;
  // Feature entitlement
  featureConfigs: Store<FeatureConfigRecord>;
  featureAudit: Store<FeatureAuditRecord>;
  // 管理平台增量 §3
  scenarioPackages: Store<ScenarioPackageRecord>;
  dynamicFeatures: Store<DynamicFeatureRecord>;
  // LLM Provider 配置体系增量 §1.1/§1.3
  llmProviders: Store<LlmProviderRecord>;
  llmPurposeBindings: Store<LlmPurposeBindingRecord>;
  // 引用模式增量 §2.3：B→A 引用上报登记
  reportedRefs: Store<ReportedRefRecord>;
  // M11 校准（§7.21 + 算法层增量）
  calibrationProposals: Store<CalibrationProposalRecord>;
  calibrationHistory: Store<CalibrationHistoryRecord>;
  calibrationForecasts: Store<CalibrationForecastRecord>;
  calibrationPairs: Store<CalibrationPairRecord>;
  // 运营态出厂配置增量（lived-in）
  riskCases: Store<RiskCaseRecord>;
  livedInStates: Store<LivedInStateRecord>;
  // 回放编排器与虚拟操作团队（replay-orchestrator）
  opsSchedules: Store<OpsScheduleStoreRecord>;
  opsTickReports: Store<OpsTickReportRecord>;
  /** Liveness for /readyz. */
  ping(): Promise<void>;
  close(): Promise<void>;
}
