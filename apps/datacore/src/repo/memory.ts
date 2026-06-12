import type {
  KbChunkRecord,
  LinkInstance,
  ObjectInstance,
  ScheduledJobRecord,
  TsPointRecord,
} from "../domain.js";
import type {
  ClaimedJob,
  LinkStore,
  ObjectStore,
  RawRowStore,
  Repos,
  ScheduledJobStore,
  Store,
  TsPointQuery,
  TsPointStore,
  VectorHit,
  VectorIndex,
} from "./repo.js";

function clone<T>(v: T): T {
  return structuredClone(v);
}

class MemStore<T extends { id: string; tenantId: string }> implements Store<T> {
  protected items = new Map<string, T>();

  async get(tenantId: string, id: string): Promise<T | undefined> {
    const item = this.items.get(id);
    if (!item || item.tenantId !== tenantId) return undefined;
    return clone(item);
  }

  async put(item: T): Promise<void> {
    this.items.set(item.id, clone(item));
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const item = this.items.get(id);
    if (item && item.tenantId === tenantId) this.items.delete(id);
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
    tenants: new MemStore(),
    users: new MemStore(),
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
    actionDrafts: new MemStore(),
    actionTypes: new MemStore(),
    industryTemplates: new MemStore(),
    syntheticJobs: new MemStore(),
    outboxEvents: new MemStore(),
    webhooks: new MemStore(),
    sopVersions: new MemStore(),
    solverParams: new MemStore(),
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
    featureAudit: new MemStore(),
    calibrationProposals: new MemStore(),
    calibrationHistory: new MemStore(),
    async ping() {
      /* always ready */
    },
    async close() {
      /* nothing to do */
    },
  };
}
