import type { BuildJob, BuildPlan, BuildWorkflowRun, DataBuilderAgent, Decision, DecisionCase, DecisionPackage, ExperimentArm, FusedObjectSnapshot, OntologyBinding, PropagationRule, SchemaReconcileCandidate, SimCheckpoint, SimSession, SimTickState, SolverArtifact, SolverBinding, SolverExperiment, StoryBuildRun } from "@platform/contracts";
import type {
  ActionDraft,
  ActionTypeRecord,
  AuditLogRecord,
  ImportedScenarioRecord,
  CalibrationForecastRecord,
  CalibrationHistoryRecord,
  CalibrationConvergenceRecord,
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
  ExecutionLockRecord,
  ExtractSegmentRecord,
  IdempotencyRecord,
  NotificationRecord,
  QuarantineRowRecord,
  MetaAccessPolicyRecord,
  ReplayProgressRecord,
  ValidationRunRecord,
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
  OntologyWorkflowRecord,
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

/**
 * §1 执行锁：原子抢占过期租约（INSERT … ON CONFLICT DO UPDATE WHERE lease_until < now()）。
 * 返回获取到的锁（含 fence）或 undefined（已被未过期持有者占用）。
 */
export interface ExecutionLockStore extends Store<ExecutionLockRecord> {
  tryAcquire(input: {
    tenantId: string;
    resourceKind: string;
    resourceKey: string;
    holderId: string;
    leaseMs: number;
    now?: number;
    /**
     * WO-T5-RESUME-LEASE：无条件夺锁（绕过"未过期租约"判定），fence 仍单调 +1。
     * 仅重启续跑用——新进程启动时任何"在抽取中"doc 的锁必属已死进程，陈旧 60min 租约可安全 steal
     * （fencing 防僵尸写）。常态抢占不传，保持 lease_until<now() 互斥语义。
     */
    steal?: boolean;
  }): Promise<ExecutionLockRecord | undefined>;
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
  // 执行语义增量（011_execution_semantics.sql）
  executionLocks: ExecutionLockStore;
  idempotencyRecords: Store<IdempotencyRecord>;
  replayProgress: Store<ReplayProgressRecord>;
  extractSegments: Store<ExtractSegmentRecord>;
  quarantineRows: Store<QuarantineRowRecord>;
  mergeCandidates: Store<import("@platform/contracts").MergeCandidate>;
  objectMerges: Store<import("@platform/contracts").ObjectMerge>;
  notifications: Store<NotificationRecord>;
  validationRuns: Store<ValidationRunRecord>;
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
  /** WO-RETENTION（⑤·数据留存/TTL）：每表留存策略（平台默认 + 租户覆盖·R2）。 */
  tableRetentionPolicies: Store<import("@platform/contracts").RetentionPolicy>;
  simulationClocks: Store<SimulationClockRecord>;
  clockTickReports: Store<ClockTickReport>;
  forecastSnapshots: Store<ForecastSnapshotRecord>;
  // Feature entitlement
  featureConfigs: Store<FeatureConfigRecord>;
  featureAudit: Store<FeatureAuditRecord>;
  /** WO-AUDIT-OBS：统一 append-only 审计日志（audit_log，migration029；只插不改不删·R13）。 */
  auditLog: Store<AuditLogRecord>;
  /** WO-ENTERPRISE-DR-AUDIT：外部审计 sink 配置（audit_sinks，migration034；secret 加密·仅 credentialRef·R5）。 */
  auditSinks: Store<import("@platform/contracts").AuditSink>;
  /** OC3 配置迁移 Saga 状态机持久化（import_jobs，migration017）。 */
  importJobs: Store<import("@platform/contracts").ImportJob>;
  /** OC6 提示词配置化（prompt_templates，migration018）。 */
  promptTemplates: Store<import("@platform/contracts").PromptTemplate>;
  llmBudgets: Store<import("@platform/contracts").LlmBudget>;
  factoryCalendars: Store<import("@platform/contracts").FactoryCalendar>;
  writebackEchoes: Store<import("@platform/contracts").WritebackEcho>;
  /** 数据接入分类的接入方式覆盖（系统对接/文件上传，按租户，migration022）。 */
  dataCategorySettings: Store<import("@platform/contracts").DataCategorySetting>;
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
  // WO-E1（校准活体常态化）：每轮 CALIBRATION_SWEEP 收敛度落库（越用越准证据）
  calibrationConvergence: Store<CalibrationConvergenceRecord>;
  // 运营态出厂配置增量（lived-in）
  riskCases: Store<RiskCaseRecord>;
  livedInStates: Store<LivedInStateRecord>;
  // 回放编排器与虚拟操作团队（replay-orchestrator）
  opsSchedules: Store<OpsScheduleStoreRecord>;
  opsTickReports: Store<OpsTickReportRecord>;
  // A7 Foundry-Grade Data Builder（agent 驱动 data pipeline 发动机）
  dataBuilderAgents: Store<DataBuilderAgent>;
  buildPlans: Store<BuildPlan>;
  buildJobs: Store<BuildJob>;
  // A18.2 LLM 临时求解器件（冻结代码 + 状态机；只有 GOVERNED 能写真值）
  solverArtifacts: Store<SolverArtifact>;
  // WO-EXPERIMENT 决策 A/B·冠军-挑战者：实验定义 + 两臂累加器（R2 租户列·确定性分流记录）
  solverExperiments: Store<SolverExperiment>;
  experimentArms: Store<ExperimentArm & { id: string; tenantId: string }>;
  // prototype-intake P2：schema 对账人确认候选（HITL 队列；类比 MergeCandidate）
  reconcileCandidates: Store<SchemaReconcileCandidate & { id: string; tenantId: string }>;
  // g8 故事驱动全栈倒推 · P1：构建期历史推演记录（与 GrowthLedgerEntry 经 runId 归一）
  storyBuildRuns: Store<StoryBuildRun>;
  // 工业级工作流运行时：故事建域的持久化步骤状态机（检查点/可重入/可重试/可观测）
  buildWorkflowRuns: Store<BuildWorkflowRun>;
  // Dogfooding P2：元本体访问策略（角色白名单,按租户;id=tenantId）
  metaAccessPolicies: Store<MetaAccessPolicyRecord>;
  // 推演沙盘（migration026·SPEC-sandbox-propagation-and-session §2.3；行业无关 jsonb）
  sim: SimRepo;
  // G-12 收口（增量E·U5）：OntologyBinding 落库（/a/v1/opt/bindings·migration027；R14 每租户绑不同本体）
  optBindings: Store<OntologyBinding>;
  // WO-SOLVER-ONTOLOGY-BINDING（B3·G-17·migration033）：canonical 业务求解器 role→租户真实类型/字段
  // 绑定（/a/v1/solvers/:key/bindings）。无绑定回退 canonical 默认（向后兼容）；DF.8 接地校验在 service/app 层。
  solverBindings: Store<SolverBinding>;
  // WO-MULTISRC-FUSION-DOMAIN（N1·migration034）：多源融合对象快照（append-only·SUSPECT/冲突对象落库供复盘，
  // 与 audit_log 互补——审计记动作、此记融合态全貌：取哪源/为何/测谎命中什么/逐字段置信）。R2 隔离·R13 溯源。
  fusedObjects: Store<FusedObjectSnapshot>;
  // WO-DECISION-RECORD（PRD §3.7 D8·migration029）：一等 Decision 记录（上下文/备选/否决/决策人/预测 vs 实现，R2）
  decisions: Store<Decision>;
  // OntoFlow（WO-MERGE-01·migration037）：本体建模工作流（画布 doc jsonb·R2 租户隔离·双实现）。
  ontologyWorkflows: Store<OntologyWorkflowRecord>;
  // WO-L1.5-2（企业记忆 CBR·migration038）：结构化决策案例 index（咨询派生·可 drop 重建·doc jsonb·R2）。
  // id = caseId；DecisionCase & {id} 满足 Store 约束（id 为 caseId 别名·upsert 天然去重）。
  decisionCases: Store<DecisionCase & { id: string }>;
  // WO-L2-4（决策内核·migration039）：决策制品 DecisionPackage（咨询派生·可 drop 重生·doc jsonb·R2）。
  // id = packageId；DecisionPackage & {id} 满足 Store 约束。
  decisionPackages: Store<DecisionPackage & { id: string }>;
  // WO-IMPORT-SCENARIO（G3·migration040）：导入场景卡（Stage 3.15 场景 → IndustryScenario）落库·doc jsonb·R2。
  importedScenarios: Store<ImportedScenarioRecord>;
  /** Liveness for /readyz. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

/**
 * 推演沙盘会话仓储（SPEC-sandbox-propagation-and-session §2.3）。
 * 跨租户读一律 null（R2）；PropagationRule 只返 PUBLISHED。
 */
export interface SimRepo {
  createSession(s: SimSession): Promise<void>;
  putSession(s: SimSession): Promise<void>; // 状态/cur_tick 更新
  getSession(tenantId: string, id: string): Promise<SimSession | null>;
  listSessions(tenantId: string): Promise<SimSession[]>;
  putTickState(ts: SimTickState): Promise<void>;
  getTickState(tenantId: string, sessionId: string, tick: number): Promise<SimTickState | null>;
  listTickStates(tenantId: string, sessionId: string): Promise<SimTickState[]>;
  deleteTicksAfter(tenantId: string, sessionId: string, tick: number): Promise<void>; // rollback
  createCheckpoint(cp: SimCheckpoint): Promise<void>;
  getCheckpoint(tenantId: string, id: string): Promise<SimCheckpoint | null>;
  listCheckpoints(tenantId: string, sessionId: string): Promise<SimCheckpoint[]>;
  putPropagationRule(r: PropagationRule): Promise<void>;
  listPropagationRules(tenantId: string, publishedOnly?: boolean): Promise<PropagationRule[]>;
}
