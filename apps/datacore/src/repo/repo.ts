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
  FeatureAuditRecord,
  FeatureConfigRecord,
  ForecastSnapshotRecord,
  IndustryTemplateRecord,
  KbChunkRecord,
  KbDocRecord,
  LinkInstance,
  LinkTypeDef,
  ObjectInstance,
  ObjectTypeDef,
  OntologyDraft,
  OntologyVersion,
  OutboxEvent,
  PermissionPolicy,
  RawDataset,
  RetentionPolicyRecord,
  Rule,
  RuleCandidate,
  RuleDoc,
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

export interface ObjectStore extends Store<ObjectInstance> {
  listByType(tenantId: string, type: string): Promise<ObjectInstance[]>;
  removeWhere(tenantId: string, pred: (o: ObjectInstance) => boolean): Promise<number>;
}

export interface LinkStore extends Store<LinkInstance> {
  removeWhere(tenantId: string, pred: (l: LinkInstance) => boolean): Promise<number>;
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
  tenants: Store<Tenant>;
  users: Store<User>;
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
  // M11 校准（§7.21 + 算法层增量）
  calibrationProposals: Store<CalibrationProposalRecord>;
  calibrationHistory: Store<CalibrationHistoryRecord>;
  calibrationForecasts: Store<CalibrationForecastRecord>;
  calibrationPairs: Store<CalibrationPairRecord>;
  /** Liveness for /readyz. */
  ping(): Promise<void>;
  close(): Promise<void>;
}
