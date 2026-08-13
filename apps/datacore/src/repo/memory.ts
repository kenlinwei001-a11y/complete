import type {
  ExecutionLockRecord,
  KbChunkRecord,
  LinkInstance,
  ObjectInstance,
  ScheduledJobRecord,
  Tenant,
  TsPointRecord,
  User,
} from "../domain.js";
import type {
  ClaimedJob,
  ExecutionLockStore,
  LinkStore,
  ObjectStore,
  RawRowStore,
  Repos,
  EpochStore,
  ScheduledJobStore,
  SimRepo,
  Store,
  TenantStore,
  TsPointQuery,
  TsPointStore,
  UserStore,
  VectorHit,
  VectorIndex,
} from "./repo.js";
import type { Perturbation, PropagationRule, SimCheckpoint, SimSession, SimTickState } from "@platform/contracts";

/** 推演沙盘内存仓储（R2 跨租户 null；R6 clone 隔离）。 */
class MemSimRepo implements SimRepo {
  private sessions = new Map<string, SimSession>();
  private ticks = new Map<string, SimTickState>(); // key = `${sessionId}|${tick}`
  private checkpoints = new Map<string, SimCheckpoint>();
  private rules = new Map<string, PropagationRule>();
  // key = perturbation id；`seq` = 插入序号（= pg 侧 created_at 的语义对应物，见 listPerturbations 注释）
  private perturbations = new Map<string, { seq: number; p: Perturbation }>();
  private perturbationSeq = 0;
  async createSession(s: SimSession) { this.sessions.set(s.id, clone(s)); }
  async putSession(s: SimSession) { this.sessions.set(s.id, clone(s)); }
  async getSession(tenantId: string, id: string) {
    const s = this.sessions.get(id);
    return s && s.tenantId === tenantId ? clone(s) : null;
  }
  async listSessions(tenantId: string) {
    return [...this.sessions.values()].filter((s) => s.tenantId === tenantId).map(clone);
  }
  async putTickState(ts: SimTickState) { this.ticks.set(`${ts.sessionId}|${ts.tick}`, clone(ts)); }
  async getTickState(tenantId: string, sessionId: string, tick: number) {
    const t = this.ticks.get(`${sessionId}|${tick}`);
    return t && t.tenantId === tenantId ? clone(t) : null;
  }
  async listTickStates(tenantId: string, sessionId: string) {
    return [...this.ticks.values()]
      .filter((t) => t.tenantId === tenantId && t.sessionId === sessionId)
      .sort((a, b) => a.tick - b.tick)
      .map(clone);
  }
  async deleteTicksAfter(tenantId: string, sessionId: string, tick: number) {
    for (const [k, t] of this.ticks) {
      if (t.tenantId === tenantId && t.sessionId === sessionId && t.tick > tick) this.ticks.delete(k);
    }
  }
  async createCheckpoint(cp: SimCheckpoint) { this.checkpoints.set(cp.id, clone(cp)); }
  async getCheckpoint(tenantId: string, id: string) {
    const c = this.checkpoints.get(id);
    return c && c.tenantId === tenantId ? clone(c) : null;
  }
  async listCheckpoints(tenantId: string, sessionId: string) {
    return [...this.checkpoints.values()].filter((c) => c.tenantId === tenantId && c.sessionId === sessionId).map(clone);
  }
  async putPropagationRule(r: PropagationRule) { this.rules.set(r.id, clone(r)); }
  async listPropagationRules(tenantId: string, publishedOnly = true) {
    return [...this.rules.values()]
      .filter((r) => r.tenantId === tenantId && (!publishedOnly || r.status === "PUBLISHED"))
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map(clone);
  }
  // ── 扰动一等公民（WO-P0 · R9 与 pg.ts PgSimRepo 语义须逐条对齐：startTick → 建单先后）──
  async createPerturbation(p: Perturbation) {
    // 重建（同 id upsert）保留原插入序号，避免"改一下就跳到队尾"这种隐形语义漂移。
    const seq = this.perturbations.get(p.id)?.seq ?? this.perturbationSeq++;
    this.perturbations.set(p.id, { seq, p: clone(p) });
  }
  async getPerturbation(tenantId: string, id: string) {
    const e = this.perturbations.get(id);
    return e && e.p.tenantId === tenantId ? clone(e.p) : null;
  }
  async listPerturbations(tenantId: string, sessionId: string) {
    // 与 pg 侧**语义同构**（不是实现同构）：startTick 升序 → 建单先后。
    // 这里用插入序号，pg 用 created_at（微秒）—— 两者表达的是同一件事，且都不依赖随机 id。
    return [...this.perturbations.values()]
      .filter((e) => e.p.tenantId === tenantId && e.p.sessionId === sessionId)
      .sort((a, b) => (a.p.startTick !== b.p.startTick ? a.p.startTick - b.p.startTick : a.seq - b.seq))
      .map((e) => clone(e.p));
  }
  async deletePerturbation(tenantId: string, sessionId: string, id: string) {
    const e = this.perturbations.get(id);
    if (!e || e.p.tenantId !== tenantId || e.p.sessionId !== sessionId) return false;
    this.perturbations.delete(id);
    return true;
  }
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

/**
 * Composite map key (tenant_id ⊕ id) so the in-memory store honours tenant
 * isolation on writes too — two tenants may share an entity id without one's
 * `put` overwriting the other's (CLAUDE.md「tenant_id everywhere」invariant).
 */
function memKey(tenantId: string, id: string): string {
  return `${tenantId}\u0000${id}`;
}

class MemStore<T extends { id: string; tenantId: string }> implements Store<T> {
  protected items = new Map<string, T>();

  async get(tenantId: string, id: string): Promise<T | undefined> {
    const item = this.items.get(memKey(tenantId, id));
    if (!item) return undefined;
    return clone(item);
  }

  async put(item: T): Promise<void> {
    this.items.set(memKey(item.tenantId, item.id), clone(item));
  }

  /**
   * 批量落盘。内存实现里它就是循环 put —— **没有性能意义，只有语义意义**：
   * 接口既然要求两个实现行为等价，这里就必须存在且与 put 的顺序覆盖语义一致
   * （同批同 id 后写覆盖），否则默认走 memory 的测试验的是一条生产不走的路
   * （本仓已记在案的假绿形态：「生产实参与测试实参交集为空」）。
   * 真正省 round-trip 的是 PgStore.putMany —— 见 repo.ts 上的接口注释。
   */
  async putMany(items: T[]): Promise<void> {
    for (const item of items) this.items.set(memKey(item.tenantId, item.id), clone(item));
  }

  async remove(tenantId: string, id: string): Promise<void> {
    this.items.delete(memKey(tenantId, id));
  }

  async list(tenantId: string, pred?: (t: T) => boolean): Promise<T[]> {
    const out: T[] = [];
    for (const item of this.items.values()) {
      if (item.tenantId !== tenantId) continue;
      if (pred && !pred(item)) continue;
      out.push(clone(item));
    }
    return out;
  }
}

class MemExecutionLockStore extends MemStore<ExecutionLockRecord> implements ExecutionLockStore {
  async tryAcquire(input: {
    tenantId: string;
    resourceKind: string;
    resourceKey: string;
    holderId: string;
    leaseMs: number;
    now?: number;
  }): Promise<ExecutionLockRecord | undefined> {
    const nowMs = input.now ?? Date.now();
    const id = `${input.resourceKind}|${input.resourceKey}`;
    const key = memKey(input.tenantId, id);
    const existing = this.items.get(key);
    // Single-process memory store: map ops are atomic w.r.t. the event loop.
    if (existing && existing.tenantId === input.tenantId) {
      if (new Date(existing.leaseUntil).getTime() > nowMs) return undefined; // held, not expired
    }
    const fence = (existing?.fence ?? 0) + 1;
    const rec: ExecutionLockRecord = {
      id,
      tenantId: input.tenantId,
      resourceKind: input.resourceKind,
      resourceKey: input.resourceKey,
      holderId: input.holderId,
      acquiredAt: new Date(nowMs).toISOString(),
      leaseUntil: new Date(nowMs + input.leaseMs).toISOString(),
      fence,
      rerunRequested: false,
    };
    this.items.set(key, clone(rec));
    return clone(rec);
  }
}

class MemUserStore extends MemStore<User> implements UserStore {
  async countAll(): Promise<number> {
    return this.items.size;
  }
}

class MemTenantStore extends MemStore<Tenant> implements TenantStore {
  async listAll(): Promise<Tenant[]> {
    return [...this.items.values()].map(clone);
  }
}

class MemObjectStore extends MemStore<ObjectInstance> implements ObjectStore {
  async listByType(tenantId: string, type: string): Promise<ObjectInstance[]> {
    return this.list(tenantId, (o) => o.type === type);
  }

  async removeWhere(tenantId: string, pred: (o: ObjectInstance) => boolean): Promise<number> {
    let n = 0;
    for (const [id, o] of this.items) {
      if (o.tenantId === tenantId && pred(o)) {
        this.items.delete(id);
        n++;
      }
    }
    return n;
  }
}

class MemLinkStore extends MemStore<LinkInstance> implements LinkStore {
  async removeWhere(tenantId: string, pred: (l: LinkInstance) => boolean): Promise<number> {
    let n = 0;
    for (const [id, l] of this.items) {
      if (l.tenantId === tenantId && pred(l)) {
        this.items.delete(id);
        n++;
      }
    }
    return n;
  }
}

class MemRawRowStore implements RawRowStore {
  private rows = new Map<string, Record<string, unknown>[]>();

  private key(tenantId: string, datasetId: string): string {
    return `${tenantId} ${datasetId}`;
  }

  async replace(tenantId: string, datasetId: string, rows: Record<string, unknown>[]): Promise<void> {
    this.rows.set(this.key(tenantId, datasetId), clone(rows));
  }

  async list(tenantId: string, datasetId: string): Promise<Record<string, unknown>[]> {
    return clone(this.rows.get(this.key(tenantId, datasetId)) ?? []);
  }
}

/** 本体原子规格 §1：租户级 epoch 单调序列（同步自增，批次锚点）。 */
class MemEpochStore implements EpochStore {
  private counters = new Map<string, number>();
  async current(tenantId: string): Promise<number> {
    return this.counters.get(tenantId) ?? 0;
  }
  async next(tenantId: string): Promise<number> {
    const v = (this.counters.get(tenantId) ?? 0) + 1;
    this.counters.set(tenantId, v);
    return v;
  }
}

/**
 * Scheduler job store with SKIP-LOCKED-equivalent semantics: claimDue mutates
 * nextRunAt synchronously (no await between read and write), so a concurrent
 * second tick in the same process never claims the same (job, scheduledAt).
 */
class MemScheduledJobStore extends MemStore<ScheduledJobRecord> implements ScheduledJobStore {
  async claimDue(
    nowIso: string,
    nextFn: (cron: string, timezone: string, afterIso: string) => string,
  ): Promise<ClaimedJob[]> {
    const claimed: ClaimedJob[] = [];
    for (const job of this.items.values()) {
      if (job.status !== "ACTIVE") continue;
      if (job.nextRunAt > nowIso) continue;
      const scheduledAt = job.nextRunAt;
      // Synchronous claim: advance nextRunAt past now before anything awaits.
      job.nextRunAt = nextFn(job.cron, job.timezone, nowIso);
      job.lastRunAt = scheduledAt;
      claimed.push({ job: clone(job), scheduledAt });
    }
    return claimed;
  }
}

class MemTsPointStore implements TsPointStore {
  // tenant|seriesId -> (entityId|ts -> point)
  private series = new Map<string, Map<string, TsPointRecord>>();

  private skey(tenantId: string, seriesId: string): string {
    return `${tenantId}|${seriesId}`;
  }

  async upsert(tenantId: string, points: TsPointRecord[]): Promise<number> {
    let n = 0;
    for (const p of points) {
      const sk = this.skey(tenantId, p.seriesId);
      let m = this.series.get(sk);
      if (!m) {
        m = new Map();
        this.series.set(sk, m);
      }
      m.set(`${p.entityId}|${p.ts}`, { ...p, values: { ...p.values } });
      n++;
    }
    return n;
  }

  async list(tenantId: string, seriesId: string, q?: TsPointQuery): Promise<TsPointRecord[]> {
    const m = this.series.get(this.skey(tenantId, seriesId));
    if (!m) return [];
    const ids = q?.entityIds ? new Set(q.entityIds) : undefined;
    const out: TsPointRecord[] = [];
    for (const p of m.values()) {
      if (ids && !ids.has(p.entityId)) continue;
      if (q?.from && p.ts < q.from) continue;
      if (q?.to && p.ts >= q.to) continue;
      out.push({ ...p, values: { ...p.values } });
    }
    out.sort((a, b) => (a.entityId === b.entityId ? (a.ts < b.ts ? -1 : 1) : a.entityId < b.entityId ? -1 : 1));
    return out;
  }

  async listIngestedSince(tenantId: string, seriesId: string, since: string): Promise<TsPointRecord[]> {
    const m = this.series.get(this.skey(tenantId, seriesId));
    if (!m) return [];
    const out: TsPointRecord[] = [];
    for (const p of m.values()) if (p.ingestedAt > since) out.push({ ...p, values: { ...p.values } });
    return out;
  }

  async maxTs(tenantId: string, seriesId: string): Promise<string | undefined> {
    const m = this.series.get(this.skey(tenantId, seriesId));
    if (!m || m.size === 0) return undefined;
    let max: string | undefined;
    for (const p of m.values()) if (!max || p.ts > max) max = p.ts;
    return max;
  }

  async count(tenantId: string, seriesId?: string): Promise<number> {
    let n = 0;
    for (const [k, m] of this.series) {
      if (!k.startsWith(`${tenantId}|`)) continue;
      if (seriesId && k !== this.skey(tenantId, seriesId)) continue;
      n += m.size;
    }
    return n;
  }

  async removeWhere(tenantId: string, pred: (p: TsPointRecord) => boolean): Promise<number> {
    let n = 0;
    for (const [k, m] of this.series) {
      if (!k.startsWith(`${tenantId}|`)) continue;
      for (const [pk, p] of m) {
        if (pred(p)) {
          m.delete(pk);
          n++;
        }
      }
    }
    return n;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

class MemVectorIndex implements VectorIndex {
  private chunks = new Map<string, KbChunkRecord>();

  async upsert(chunks: KbChunkRecord[]): Promise<void> {
    for (const c of chunks) this.chunks.set(c.id, clone(c));
  }

  async search(
    tenantId: string,
    queryVec: number[],
    topK: number,
    filter?: (c: KbChunkRecord) => boolean,
  ): Promise<VectorHit[]> {
    const hits: VectorHit[] = [];
    for (const c of this.chunks.values()) {
      if (c.tenantId !== tenantId) continue;
      if (filter && !filter(c)) continue;
      hits.push({ chunk: clone(c), score: cosineSimilarity(queryVec, c.embedding) });
    }
    hits.sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1));
    return hits.slice(0, topK);
  }

  async removeByDoc(tenantId: string, docId: string): Promise<void> {
    for (const [id, c] of this.chunks) {
      if (c.tenantId === tenantId && c.docId === docId) this.chunks.delete(id);
    }
  }
}

export function createMemoryRepos(): Repos {
  return {
    tenants: new MemTenantStore(),
    users: new MemUserStore(),
    viewConfigs: new MemStore(),
    policies: new MemStore(),
    connections: new MemStore(),
    syncJobs: new MemStore(),
    rawDatasets: new MemStore(),
    rawRows: new MemRawRowStore(),
    ruleDocs: new MemStore(),
    ruleCandidates: new MemStore(),
    rules: new MemStore(),
    ontologyTypes: new MemStore(),
    ontologyLinks: new MemStore(),
    ontologyDrafts: new MemStore(),
    ontologyVersions: new MemStore(),
    objects: new MemObjectStore(),
    links: new MemLinkStore(),
    derivationRuns: new MemStore(),
    epochs: new MemEpochStore(),
    objectPropHistory: new MemStore(),
    derivationSpecs: new MemStore(),
    derivationValueRuns: new MemStore(),
    sliceSpecs: new MemStore(),
    domains: new MemStore(),
    elementRefs: new MemStore(),
    publishRequests: new MemStore(),
    actionDrafts: new MemStore(),
    actionTypes: new MemStore(),
    decisions: new MemStore(), // WO-C1 · L2 决策内核台账

    industryTemplates: new MemStore(),
    syntheticJobs: new MemStore(),
    outboxEvents: new MemStore(),
    executionLocks: new MemExecutionLockStore(),
    idempotencyRecords: new MemStore(),
    replayProgress: new MemStore(),
    extractSegments: new MemStore(),
    quarantineRows: new MemStore(),
    mergeCandidates: new MemStore(),
    objectMerges: new MemStore(),
    notifications: new MemStore(),
    ontologyWorkflows: new MemStore(),
    buildPipelines: new MemStore(),
    validationRuns: new MemStore(),
    webhooks: new MemStore(),
    sopVersions: new MemStore(),
    solverParams: new MemStore(),
    solverParamsHistory: new MemStore(),
    scheduledJobs: new MemScheduledJobStore(),
    schedulerRuns: new MemStore(),
    kbDocs: new MemStore(),
    kbChunks: new MemVectorIndex(),
    tsSeries: new MemStore(),
    tsPoints: new MemTsPointStore(),
    tsLateArrivals: new MemStore(),
    tsAggSpecs: new MemStore(),
    tsAggRuns: new MemStore(),
    retentionPolicies: new MemStore(),
    simulationClocks: new MemStore(),
    clockTickReports: new MemStore(),
    forecastSnapshots: new MemStore(),
    featureConfigs: new MemStore(),
    importJobs: new MemStore(),
    promptTemplates: new MemStore(),
    llmBudgets: new MemStore(),
    factoryCalendars: new MemStore(),
    dataCategorySettings: new MemStore(),
    writebackEchoes: new MemStore(),
    featureAudit: new MemStore(),
    scenarioPackages: new MemStore(),
    dynamicFeatures: new MemStore(),
    llmProviders: new MemStore(),
    llmPurposeBindings: new MemStore(),
    reportedRefs: new MemStore(),
    calibrationProposals: new MemStore(),
    calibrationHistory: new MemStore(),
    calibrationForecasts: new MemStore(),
    calibrationPairs: new MemStore(),
    riskCases: new MemStore(),
    livedInStates: new MemStore(),
    opsSchedules: new MemStore(),
    opsTickReports: new MemStore(),
    dataBuilderAgents: new MemStore(),
    buildPlans: new MemStore(),
    buildJobs: new MemStore(),
    solverArtifacts: new MemStore(),
    reconcileCandidates: new MemStore(),
    storyBuildRuns: new MemStore(),
    buildWorkflowRuns: new MemStore(),
    metaAccessPolicies: new MemStore(),
    // WO-Q0 · 业务流程层（R9 三处同改之二 —— 与 repo.ts 接口 + pg.ts 同表语义）
    processDomains: new MemStore(),
    processDefinitions: new MemStore(),
    // WO-ENTERPRISE-STATE · 企业状态快照（R9 四处同改之三 —— migrations/030 + repo.ts 接口 + 本行 + pg.ts）
    enterpriseStates: new MemStore(),
    // WO-ORG-WORLD · 组织世界（R9 三处同改之二 —— 与 repo.ts 接口 + pg.ts 同表语义）
    orgPrincipals: new MemStore(),
    orgAuthorities: new MemStore(),
    orgApprovalLimits: new MemStore(),
    orgDelegations: new MemStore(),
    // WO-PROCESS-INSTANCE · 流程运行时层（R9 三处同改之二 —— 与 repo.ts 接口 + pg.ts 同表语义）
    processInstances: new MemStore(),
    processTasks: new MemStore(),
    sim: new MemSimRepo(),
    async ping() {
      /* always ready */
    },
    async close() {
      /* nothing to do */
    },
  };
}
