import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
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
  EpochStore,
  ExecutionLockStore,
  LinkStore,
  ObjectStore,
  RawRowStore,
  Repos,
  ScheduledJobStore,
  Store,
  TenantStore,
  TsPointQuery,
  TsPointStore,
  UserStore,
  VectorHit,
  SimRepo,
  VectorIndex,
} from "./repo.js";
import { cosineSimilarity } from "./memory.js";
import type { Perturbation, PropagationRule, SimCheckpoint, SimSession, SimTickState } from "@platform/contracts";

const { Pool } = pg;

/** 推演沙盘 pg 仓储（migration026·三具名列表 + 传导规则 doc-jsonb；R2 跨租户 null）。 */
class PgSimRepo implements SimRepo {
  constructor(private pool: pg.Pool) {}
  private rowToSession(r: Record<string, unknown>): SimSession {
    return {
      id: r.id as string, tenantId: r.tenant_id as string,
      baseSnapshot: r.base_snapshot as SimSession["baseSnapshot"], scope: r.scope as SimSession["scope"],
      status: r.status as SimSession["status"], curTick: r.cur_tick as number,
      parentCheckpointId: (r.parent_checkpoint_id as string | null) ?? null,
      createdAt: (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)),
    };
  }
  async createSession(s: SimSession) { await this.putSession(s); }
  async putSession(s: SimSession) {
    await this.pool.query(
      `INSERT INTO sim_session (id, tenant_id, base_snapshot, scope, status, cur_tick, parent_checkpoint_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET base_snapshot=$3, scope=$4, status=$5, cur_tick=$6, parent_checkpoint_id=$7`,
      [s.id, s.tenantId, JSON.stringify(s.baseSnapshot), JSON.stringify(s.scope), s.status, s.curTick, s.parentCheckpointId, s.createdAt],
    );
  }
  async getSession(tenantId: string, id: string) {
    const r = await this.pool.query(`SELECT * FROM sim_session WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    return r.rows[0] ? this.rowToSession(r.rows[0]) : null;
  }
  async listSessions(tenantId: string) {
    const r = await this.pool.query(`SELECT * FROM sim_session WHERE tenant_id=$1 ORDER BY created_at`, [tenantId]);
    return r.rows.map((row) => this.rowToSession(row));
  }
  async putTickState(ts: SimTickState) {
    await this.pool.query(
      `INSERT INTO sim_tick_state (session_id, tenant_id, tick, state, pending, trace) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (session_id, tick) DO UPDATE SET state=$4, pending=$5, trace=$6`,
      [ts.sessionId, ts.tenantId, ts.tick, JSON.stringify(ts.state), JSON.stringify(ts.pending), ts.trace ? JSON.stringify(ts.trace) : null],
    );
  }
  private rowToTick(r: Record<string, unknown>): SimTickState {
    return {
      sessionId: r.session_id as string, tenantId: r.tenant_id as string, tick: r.tick as number,
      state: r.state as SimTickState["state"], pending: (r.pending as SimTickState["pending"]) ?? [],
      trace: (r.trace as SimTickState["trace"]) ?? null,
    };
  }
  async getTickState(tenantId: string, sessionId: string, tick: number) {
    const r = await this.pool.query(`SELECT * FROM sim_tick_state WHERE tenant_id=$1 AND session_id=$2 AND tick=$3`, [tenantId, sessionId, tick]);
    return r.rows[0] ? this.rowToTick(r.rows[0]) : null;
  }
  async listTickStates(tenantId: string, sessionId: string) {
    const r = await this.pool.query(`SELECT * FROM sim_tick_state WHERE tenant_id=$1 AND session_id=$2 ORDER BY tick`, [tenantId, sessionId]);
    return r.rows.map((row) => this.rowToTick(row));
  }
  async deleteTicksAfter(tenantId: string, sessionId: string, tick: number) {
    await this.pool.query(`DELETE FROM sim_tick_state WHERE tenant_id=$1 AND session_id=$2 AND tick>$3`, [tenantId, sessionId, tick]);
  }
  async createCheckpoint(cp: SimCheckpoint) {
    await this.pool.query(`INSERT INTO sim_checkpoint (id, session_id, tenant_id, tick, label, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [cp.id, cp.sessionId, cp.tenantId, cp.tick, cp.label, cp.createdAt]);
  }
  private rowToCp(r: Record<string, unknown>): SimCheckpoint {
    return { id: r.id as string, sessionId: r.session_id as string, tenantId: r.tenant_id as string, tick: r.tick as number, label: r.label as string,
      createdAt: (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)) };
  }
  async getCheckpoint(tenantId: string, id: string) {
    const r = await this.pool.query(`SELECT * FROM sim_checkpoint WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    return r.rows[0] ? this.rowToCp(r.rows[0]) : null;
  }
  async listCheckpoints(tenantId: string, sessionId: string) {
    const r = await this.pool.query(`SELECT * FROM sim_checkpoint WHERE tenant_id=$1 AND session_id=$2 ORDER BY tick`, [tenantId, sessionId]);
    return r.rows.map((row) => this.rowToCp(row));
  }
  async putPropagationRule(rule: PropagationRule) {
    await this.pool.query(`INSERT INTO sim_propagation_rule (id, tenant_id, doc) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET doc=$3, updated_at=now()`,
      [rule.id, rule.tenantId, JSON.stringify(rule)]);
  }
  async listPropagationRules(tenantId: string, publishedOnly = true) {
    const r = await this.pool.query(`SELECT doc FROM sim_propagation_rule WHERE tenant_id=$1 ORDER BY doc->>'key'`, [tenantId]);
    const all = r.rows.map((row) => row.doc as PropagationRule);
    return publishedOnly ? all.filter((x) => x.status === "PUBLISHED") : all;
  }
  // ── 扰动一等公民（WO-P0 · migrations/028_perturbations.sql · R9 与 memory.ts MemSimRepo 语义须逐条对齐）──
  async createPerturbation(p: Perturbation) {
    await this.pool.query(
      `INSERT INTO sim_perturbation (id, tenant_id, session_id, doc) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET doc=$4`,
      [p.id, p.tenantId, p.sessionId, JSON.stringify(p)],
    );
  }
  async getPerturbation(tenantId: string, id: string) {
    const r = await this.pool.query(`SELECT doc FROM sim_perturbation WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    return r.rows[0] ? (r.rows[0].doc as Perturbation) : null;
  }
  async listPerturbations(tenantId: string, sessionId: string) {
    // 与 memory 侧**语义同构**：startTick 升序 → 建单先后（memory 用插入序号，这里用 created_at）。
    // `created_at` 是 TIMESTAMPTZ（微秒精度，各 INSERT 各自事务）⇒ 顺序建的两条不会撞。
    // **末位 id 只是兜底的全序保证**，不许把它提到 created_at 前面：id 是 randomBytes，
    // 跨运行不稳定 —— 那正是本单实测踩到的坑（见 repo.ts listPerturbations 注释①）。
    // `(doc->>'startTick')::int` 走 028 建的 sim_perturbation_start 索引。
    const r = await this.pool.query(
      `SELECT doc FROM sim_perturbation WHERE tenant_id=$1 AND session_id=$2 ORDER BY (doc->>'startTick')::int, created_at, id`,
      [tenantId, sessionId],
    );
    return r.rows.map((row) => row.doc as Perturbation);
  }
  async deletePerturbation(tenantId: string, sessionId: string, id: string) {
    const r = await this.pool.query(`DELETE FROM sim_perturbation WHERE tenant_id=$1 AND session_id=$2 AND id=$3`, [tenantId, sessionId, id]);
    return (r.rowCount ?? 0) > 0;
  }
}

/**
 * 通用 doc-blob 仓储：整个实体 `JSON.stringify` 进 `doc` JSONB 列，读出即 `r.rows[0].doc`。
 * **不逐字段列举** —— 契约加字段无需改本类，也因此本类不可能成为"吞字段"的那一层
 * （WO-D6 的两个吞点都在它之上：service 的手写 `def` 白名单与 route 的 zod schema）。
 * 导出供 `test/upsert-type-roundtrip.test.ts` 拿真实现跑 put→get，把上面这句话钉成断言而非注释里的声称。
 */
export class PgStore<T extends { id: string; tenantId: string }> implements Store<T> {
  constructor(
    protected pool: pg.Pool,
    protected table: string,
    protected extraColumns: (item: T) => Record<string, string> = () => ({}),
  ) {}

  async get(tenantId: string, id: string): Promise<T | undefined> {
    const r = await this.pool.query(
      `SELECT doc FROM ${this.table} WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return r.rows[0]?.doc as T | undefined;
  }

  async put(item: T): Promise<void> {
    const extras = this.extraColumns(item);
    const extraKeys = Object.keys(extras);
    const cols = ["id", "tenant_id", "doc", ...extraKeys];
    const vals = [item.id, item.tenantId, JSON.stringify(item), ...extraKeys.map((k) => extras[k])];
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const updates = ["doc = EXCLUDED.doc", "updated_at = now()"].concat(
      extraKeys.map((k) => `${k} = EXCLUDED.${k}`),
    );
    await this.pool.query(
      `INSERT INTO ${this.table} (${cols.join(",")}) VALUES (${placeholders.join(",")})
       ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`,
      vals,
    );
  }

  /**
   * 批量 upsert：**一次 INSERT 打多行**，把 N 次 round-trip 压成 ⌈N/CHUNK⌉ 次。
   *
   * 三个必须处理的坑（每一个都会让"看起来对"的实现在生产上炸）：
   *
   * ① **同批内 id 重复 → postgres 直接报错**，不是静默取其一：
   *    `ON CONFLICT DO UPDATE command cannot affect row a second time`。
   *    所以必须先按 id 去重、保留**最后一条**（这才等价于依次 put 的后写覆盖语义）。
   *    去重要按 (tenant_id, id)? —— 不：本表主键就是 id 单列（见各 migration 的
   *    `ON CONFLICT (id)`），跨租户共用 id 本就会互相覆盖，这是既有语义，此处不改。
   *
   * ② **绑定参数上限 65535**（pg 线协议 int16）。超了报 `bind message has N parameter
   *    formats but M parameters`。列数随 extraColumns 变（3~5 列），故 chunk 必须**按实际
   *    列数算**而不是写死行数 —— 写死 1000 行在 5 列表上是 5000 个参数（安全），
   *    但这类"当时够用"的常数正是以后加一列就悄悄炸的东西。
   *
   * ③ **extraColumns 逐行求值**：同一张表不同行的 extras 键集合理论上可不同
   *    （extraColumns 是任意函数）。列集合必须对整批取**并集**并对缺失键补 null，
   *    否则少数行会把整批的列布局带偏。实际实现里各 extraColumns 都返回定长键集，
   *    但依赖"实际上都一样"就是在赌一个没人守的约定。
   */
  async putMany(items: T[]): Promise<void> {
    if (items.length === 0) return; // 空批 no-op：绝不发 `VALUES ()` 这种语法错

    // ① 去重：后写覆盖（Map 保留最后一次 set）
    const byId = new Map<string, T>();
    for (const it of items) byId.set(it.id, it);
    const rows = [...byId.values()];

    // ③ 列集合取并集（顺序稳定：先出现的键在前，保证 SQL 文本对同一批可复现）
    const extrasPerRow = rows.map((r) => this.extraColumns(r));
    const extraKeys: string[] = [];
    for (const e of extrasPerRow) for (const k of Object.keys(e)) if (!extraKeys.includes(k)) extraKeys.push(k);
    const cols = ["id", "tenant_id", "doc", ...extraKeys];
    const updates = ["doc = EXCLUDED.doc", "updated_at = now()"].concat(
      extraKeys.map((k) => `${k} = EXCLUDED.${k}`),
    );

    // ② chunk 按列数反算，留出余量（65535 是硬上限，取 60000 免得贴边）
    const chunkRows = Math.max(1, Math.floor(60000 / cols.length));

    for (let off = 0; off < rows.length; off += chunkRows) {
      const slice = rows.slice(off, off + chunkRows);
      const vals: unknown[] = [];
      const tuples = slice.map((item, i) => {
        const extras = extrasPerRow[off + i]!;
        vals.push(item.id, item.tenantId, JSON.stringify(item), ...extraKeys.map((k) => extras[k] ?? null));
        const base = i * cols.length;
        return `(${cols.map((_, c) => `$${base + c + 1}`).join(",")})`;
      });
      await this.pool.query(
        `INSERT INTO ${this.table} (${cols.join(",")}) VALUES ${tuples.join(",")}
         ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`,
        vals,
      );
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE id = $1 AND tenant_id = $2`, [
      id,
      tenantId,
    ]);
  }

  async list(tenantId: string, pred?: (t: T) => boolean): Promise<T[]> {
    const r = await this.pool.query(`SELECT doc FROM ${this.table} WHERE tenant_id = $1`, [
      tenantId,
    ]);
    const items = r.rows.map((row) => row.doc as T);
    return pred ? items.filter(pred) : items;
  }
}

class PgExecutionLockStore extends PgStore<ExecutionLockRecord> implements ExecutionLockStore {
  constructor(pool: pg.Pool) {
    super(pool, "execution_locks");
  }

  /**
   * §1: atomic preemption of an expired lease. Dedicated columns (not the generic
   * doc JSONB) are required so the WHERE-on-conflict and monotonic fence are
   * evaluated server-side. The doc column is kept in sync for generic reads.
   */
  async tryAcquire(input: {
    tenantId: string;
    resourceKind: string;
    resourceKey: string;
    holderId: string;
    leaseMs: number;
    now?: number;
  }): Promise<ExecutionLockRecord | undefined> {
    const id = `${input.resourceKind}|${input.resourceKey}`;
    const leaseSec = Math.max(1, Math.round(input.leaseMs / 1000));
    const r = await this.pool.query(
      `INSERT INTO execution_locks
         (id, tenant_id, resource_kind, resource_key, holder_id, acquired_at, lease_until, fence, rerun_requested, doc)
       VALUES ($1,$2,$3,$4,$5, now(), now() + ($6 || ' seconds')::interval, 1, false, '{}'::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET holder_id = EXCLUDED.holder_id,
             acquired_at = now(),
             lease_until = now() + ($6 || ' seconds')::interval,
             fence = execution_locks.fence + 1,
             rerun_requested = false
         WHERE execution_locks.lease_until < now()
       RETURNING id, tenant_id, resource_kind, resource_key, holder_id, acquired_at, lease_until, fence, rerun_requested`,
      [id, input.tenantId, input.resourceKind, input.resourceKey, input.holderId, String(leaseSec)],
    );
    const row = r.rows[0];
    if (!row) return undefined; // held by an unexpired lease
    const rec: ExecutionLockRecord = {
      id: row.id,
      tenantId: row.tenant_id,
      resourceKind: row.resource_kind,
      resourceKey: row.resource_key,
      holderId: row.holder_id,
      acquiredAt: new Date(row.acquired_at).toISOString(),
      leaseUntil: new Date(row.lease_until).toISOString(),
      fence: Number(row.fence),
      rerunRequested: row.rerun_requested,
    };
    // keep generic doc column coherent for Store.get/list
    await this.put(rec);
    return rec;
  }
}

class PgUserStore extends PgStore<User> implements UserStore {
  constructor(pool: pg.Pool) {
    super(pool, "users");
  }

  async countAll(): Promise<number> {
    const r = await this.pool.query(`SELECT count(*)::int AS n FROM users`);
    return (r.rows[0]?.n as number) ?? 0;
  }
}

class PgTenantStore extends PgStore<Tenant> implements TenantStore {
  constructor(pool: pg.Pool) {
    super(pool, "tenants");
  }

  async listAll(): Promise<Tenant[]> {
    const r = await this.pool.query(`SELECT doc FROM tenants`);
    return r.rows.map((row) => row.doc as Tenant);
  }
}

class PgObjectStore extends PgStore<ObjectInstance> implements ObjectStore {
  constructor(pool: pg.Pool) {
    super(pool, "objects", (o) => ({ object_type: o.type, origin_type: o.origin.type }));
  }

  async listByType(tenantId: string, type: string): Promise<ObjectInstance[]> {
    const r = await this.pool.query(
      `SELECT doc FROM objects WHERE tenant_id = $1 AND object_type = $2`,
      [tenantId, type],
    );
    return r.rows.map((row) => row.doc as ObjectInstance);
  }

  async removeWhere(tenantId: string, pred: (o: ObjectInstance) => boolean): Promise<number> {
    const items = await this.list(tenantId, pred);
    for (const item of items) await this.remove(tenantId, item.id);
    return items.length;
  }
}

class PgLinkStore extends PgStore<LinkInstance> implements LinkStore {
  constructor(pool: pg.Pool) {
    super(pool, "links", (l) => ({ link_type: l.type, origin_type: l.origin.type }));
  }

  async removeWhere(tenantId: string, pred: (l: LinkInstance) => boolean): Promise<number> {
    const items = await this.list(tenantId, pred);
    for (const item of items) await this.remove(tenantId, item.id);
    return items.length;
  }
}

class PgRawRowStore implements RawRowStore {
  constructor(private pool: pg.Pool) {}

  async replace(tenantId: string, datasetId: string, rows: Record<string, unknown>[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM raw_dataset_rows WHERE tenant_id = $1 AND dataset_id = $2`, [
        tenantId,
        datasetId,
      ]);
      for (let i = 0; i < rows.length; i++) {
        await client.query(
          `INSERT INTO raw_dataset_rows (tenant_id, dataset_id, idx, row) VALUES ($1,$2,$3,$4)`,
          [tenantId, datasetId, i, JSON.stringify(rows[i])],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async list(tenantId: string, datasetId: string): Promise<Record<string, unknown>[]> {
    const r = await this.pool.query(
      `SELECT row FROM raw_dataset_rows WHERE tenant_id = $1 AND dataset_id = $2 ORDER BY idx`,
      [tenantId, datasetId],
    );
    return r.rows.map((row) => row.row as Record<string, unknown>);
  }
}

/** S3 scheduler — multi-replica safety via FOR UPDATE SKIP LOCKED. */
class PgScheduledJobStore extends PgStore<ScheduledJobRecord> implements ScheduledJobStore {
  constructor(pool: pg.Pool) {
    super(pool, "scheduled_jobs", (j) => ({
      kind: j.kind,
      status: j.status,
      next_run_at: j.nextRunAt,
    }));
  }

  async claimDue(
    nowIso: string,
    nextFn: (cron: string, timezone: string, afterIso: string) => string,
  ): Promise<ClaimedJob[]> {
    const client = await this.pool.connect();
    const claimed: ClaimedJob[] = [];
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT doc FROM scheduled_jobs
          WHERE status = 'ACTIVE' AND next_run_at <= $1
          FOR UPDATE SKIP LOCKED`,
        [nowIso],
      );
      for (const row of r.rows) {
        const job = row.doc as ScheduledJobRecord;
        const scheduledAt = job.nextRunAt;
        job.nextRunAt = nextFn(job.cron, job.timezone, nowIso);
        job.lastRunAt = scheduledAt;
        await client.query(
          `UPDATE scheduled_jobs SET doc = $2, next_run_at = $3, updated_at = now() WHERE id = $1`,
          [job.id, JSON.stringify(job), job.nextRunAt],
        );
        claimed.push({ job, scheduledAt });
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return claimed;
  }
}

/**
 * A8 raw timeseries — ts_points has real columns (series_id, entity_id, ts,
 * values). On TimescaleDB-enabled instances the migration converts it to a
 * hypertable; on vanilla PG it is a plain table with a (series_id, entity_id,
 * ts DESC) index.
 */
class PgTsPointStore implements TsPointStore {
  constructor(private pool: pg.Pool) {}

  /**
   * 批量 upsert：一次 INSERT 打多行。原实现是 BEGIN → 逐行 INSERT → COMMIT，
   * 事务只有一个但 **round-trip 有 N 个** —— demo 播种 164970 个点全走这条路。
   * 「包在事务里」省的是 fsync，不是网络往返；慢的是后者（详见 repo.ts Store.putMany 注释）。
   *
   * 冲突键是 (tenant_id, series_id, entity_id, ts) 四元组（非单列 id），故同批去重
   * 必须按这个四元组，否则同样触发 `ON CONFLICT DO UPDATE command cannot affect
   * row a second time`。tenantId 对整批是常量，键里仍带上以防将来跨租户批量写。
   */
  async upsert(tenantId: string, points: TsPointRecord[]): Promise<number> {
    if (points.length === 0) return 0;
    // 同批去重（后写覆盖，等价于原来的逐行顺序 upsert）
    const byKey = new Map<string, TsPointRecord>();
    for (const p of points) byKey.set(`${tenantId}\u0000${p.seriesId}\u0000${p.entityId}\u0000${p.ts}`, p);
    const rows = [...byKey.values()];

    const COLS = 8;
    const chunkRows = Math.floor(60000 / COLS); // 绑定参数上限 65535，留余量
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (let off = 0; off < rows.length; off += chunkRows) {
        const slice = rows.slice(off, off + chunkRows);
        const vals: unknown[] = [];
        const tuples = slice.map((p, i) => {
          vals.push(tenantId, p.seriesId, p.entityId, p.ts, JSON.stringify(p.values), p.ingestedAt, p.tick ?? 0, p.origin ?? null);
          const base = i * COLS;
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`;
        });
        await client.query(
          `INSERT INTO ts_points (tenant_id, series_id, entity_id, ts, vals, ingested_at, tick, origin)
           VALUES ${tuples.join(",")}
           ON CONFLICT (tenant_id, series_id, entity_id, ts)
           DO UPDATE SET vals = EXCLUDED.vals, ingested_at = EXCLUDED.ingested_at, tick = EXCLUDED.tick, origin = EXCLUDED.origin`,
          vals,
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    // ⚠ 返回 points.length 而非 rows.length（去重后）—— **刻意与 memory 实现保持一致**。
    // MemTsPointStore.upsert 逐点计数、不去重，返回的就是入参长度。此处若改成"实际落盘行数"，
    // pg 与 memory 在有重复输入时会返回不同的数 ⇒ 违反「仓储双实现行为等价」。
    // 哪个口径更"对"是另一个问题，要改必须两边一起改（且过一遍调用方）；本次只治启动时长。
    return points.length;
  }

  private rowToPoint(row: Record<string, unknown>): TsPointRecord {
    return {
      seriesId: row.series_id as string,
      entityId: row.entity_id as string,
      ts: new Date(row.ts as string).toISOString(),
      values: row.vals as Record<string, number>,
      ingestedAt: new Date(row.ingested_at as string).toISOString(),
      tick: (row.tick as number) ?? 0,
      ...(row.origin ? { origin: row.origin as "SYNTHETIC" | "LIVE" } : {}),
    };
  }

  async list(tenantId: string, seriesId: string, q?: TsPointQuery): Promise<TsPointRecord[]> {
    const conds = ["tenant_id = $1", "series_id = $2"];
    const vals: unknown[] = [tenantId, seriesId];
    if (q?.entityIds && q.entityIds.length > 0) {
      vals.push(q.entityIds);
      conds.push(`entity_id = ANY($${vals.length})`);
    }
    if (q?.from) {
      vals.push(q.from);
      conds.push(`ts >= $${vals.length}`);
    }
    if (q?.to) {
      vals.push(q.to);
      conds.push(`ts < $${vals.length}`);
    }
    const r = await this.pool.query(
      `SELECT * FROM ts_points WHERE ${conds.join(" AND ")} ORDER BY entity_id, ts`,
      vals,
    );
    return r.rows.map((row) => this.rowToPoint(row as Record<string, unknown>));
  }

  async listIngestedSince(tenantId: string, seriesId: string, since: string): Promise<TsPointRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM ts_points WHERE tenant_id = $1 AND series_id = $2 AND ingested_at > $3`,
      [tenantId, seriesId, since],
    );
    return r.rows.map((row) => this.rowToPoint(row as Record<string, unknown>));
  }

  async maxTs(tenantId: string, seriesId: string): Promise<string | undefined> {
    const r = await this.pool.query(
      `SELECT max(ts) AS m FROM ts_points WHERE tenant_id = $1 AND series_id = $2`,
      [tenantId, seriesId],
    );
    const m = r.rows[0]?.m as string | null;
    return m ? new Date(m).toISOString() : undefined;
  }

  async count(tenantId: string, seriesId?: string): Promise<number> {
    const r = seriesId
      ? await this.pool.query(
          `SELECT count(*)::int AS n FROM ts_points WHERE tenant_id = $1 AND series_id = $2`,
          [tenantId, seriesId],
        )
      : await this.pool.query(`SELECT count(*)::int AS n FROM ts_points WHERE tenant_id = $1`, [
          tenantId,
        ]);
    return (r.rows[0]?.n as number) ?? 0;
  }

  async removeWhere(tenantId: string, pred: (p: TsPointRecord) => boolean): Promise<number> {
    // Predicate-based deletion (used by clock reset, tick > 0): fetch + filter.
    const r = await this.pool.query(`SELECT * FROM ts_points WHERE tenant_id = $1`, [tenantId]);
    let n = 0;
    for (const row of r.rows) {
      const p = this.rowToPoint(row as Record<string, unknown>);
      if (!pred(p)) continue;
      await this.pool.query(
        `DELETE FROM ts_points WHERE tenant_id = $1 AND series_id = $2 AND entity_id = $3 AND ts = $4`,
        [tenantId, p.seriesId, p.entityId, p.ts],
      );
      n++;
    }
    return n;
  }
}

/**
 * S4 pgvector index. When the `vector` extension is unavailable the migration
 * falls back to a JSONB embedding column; this class then computes cosine
 * similarity app-side (and logs a warning once at startup).
 */
class PgVectorIndex implements VectorIndex {
  constructor(
    private pool: pg.Pool,
    private hasPgVector: boolean,
  ) {}

  async upsert(chunks: KbChunkRecord[]): Promise<void> {
    for (const c of chunks) {
      if (this.hasPgVector) {
        await this.pool.query(
          `INSERT INTO kb_chunks (id, tenant_id, conn_id, doc_id, seq, chunk_text, span, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)
           ON CONFLICT (id) DO UPDATE SET chunk_text = EXCLUDED.chunk_text, span = EXCLUDED.span, embedding = EXCLUDED.embedding`,
          [c.id, c.tenantId, c.connId, c.docId, c.seq, c.text, JSON.stringify(c.span), JSON.stringify(c.embedding)],
        );
      } else {
        await this.pool.query(
          `INSERT INTO kb_chunks (id, tenant_id, conn_id, doc_id, seq, chunk_text, span, embedding_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET chunk_text = EXCLUDED.chunk_text, span = EXCLUDED.span, embedding_json = EXCLUDED.embedding_json`,
          [c.id, c.tenantId, c.connId, c.docId, c.seq, c.text, JSON.stringify(c.span), JSON.stringify(c.embedding)],
        );
      }
    }
  }

  async search(
    tenantId: string,
    queryVec: number[],
    topK: number,
    filter?: (c: KbChunkRecord) => boolean,
  ): Promise<VectorHit[]> {
    if (this.hasPgVector) {
      const r = await this.pool.query(
        `SELECT id, tenant_id, conn_id, doc_id, seq, chunk_text, span,
                1 - (embedding <=> $2::vector) AS score
           FROM kb_chunks WHERE tenant_id = $1
          ORDER BY embedding <=> $2::vector ASC LIMIT $3`,
        [tenantId, JSON.stringify(queryVec), topK * 5],
      );
      const hits = r.rows.map((row) => ({
        chunk: {
          id: row.id as string,
          tenantId: row.tenant_id as string,
          connId: row.conn_id as string,
          docId: row.doc_id as string,
          seq: row.seq as number,
          text: row.chunk_text as string,
          span: row.span as { start: number; end: number },
          embedding: [],
        },
        score: Number(row.score),
      }));
      return hits.filter((h) => !filter || filter(h.chunk)).slice(0, topK);
    }
    const r = await this.pool.query(
      `SELECT id, tenant_id, conn_id, doc_id, seq, chunk_text, span, embedding_json
         FROM kb_chunks WHERE tenant_id = $1`,
      [tenantId],
    );
    const hits: VectorHit[] = [];
    for (const row of r.rows) {
      const chunk: KbChunkRecord = {
        id: row.id as string,
        tenantId: row.tenant_id as string,
        connId: row.conn_id as string,
        docId: row.doc_id as string,
        seq: row.seq as number,
        text: row.chunk_text as string,
        span: row.span as { start: number; end: number },
        embedding: row.embedding_json as number[],
      };
      if (filter && !filter(chunk)) continue;
      hits.push({ chunk, score: cosineSimilarity(queryVec, chunk.embedding) });
    }
    hits.sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1));
    return hits.slice(0, topK);
  }

  async removeByDoc(tenantId: string, docId: string): Promise<void> {
    await this.pool.query(`DELETE FROM kb_chunks WHERE tenant_id = $1 AND doc_id = $2`, [
      tenantId,
      docId,
    ]);
  }
}

export async function runMigrations(pool: pg.Pool, migrationsDir: string): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const done = await pool.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [file]);
    if (done.rowCount && done.rowCount > 0) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    await pool.query(sql);
    await pool.query(`INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [
      file,
    ]);
  }
}

/** 本体原子规格 §1：租户级 epoch 单调序列（INSERT…ON CONFLICT DO UPDATE 原子自增）。 */
class PgEpochStore implements EpochStore {
  constructor(private pool: pg.Pool) {}
  async current(tenantId: string): Promise<number> {
    const r = await this.pool.query(`SELECT epoch FROM ontology_epochs WHERE tenant_id = $1`, [tenantId]);
    return Number(r.rows[0]?.epoch ?? 0);
  }
  async next(tenantId: string): Promise<number> {
    const r = await this.pool.query(
      `INSERT INTO ontology_epochs (tenant_id, epoch, updated_at) VALUES ($1, 1, now())
       ON CONFLICT (tenant_id) DO UPDATE SET epoch = ontology_epochs.epoch + 1, updated_at = now()
       RETURNING epoch`,
      [tenantId],
    );
    return Number(r.rows[0]?.epoch ?? 1);
  }
}

export async function createPgRepos(databaseUrl: string, migrationsDir: string): Promise<Repos> {
  const pool = new Pool({ connectionString: databaseUrl });
  await runMigrations(pool, migrationsDir);
  const ext = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
  const hasPgVector = (ext.rowCount ?? 0) > 0;
  if (!hasPgVector) {
    console.warn(
      "[datacore] pgvector extension unavailable — kb_chunks falls back to JSONB embeddings with app-side cosine similarity",
    );
  }
  return {
    tenants: new PgTenantStore(pool),
    users: new PgUserStore(pool),
    viewConfigs: new PgStore(pool, "view_configs"),
    policies: new PgStore(pool, "permission_policies"),
    connections: new PgStore(pool, "connections"),
    syncJobs: new PgStore(pool, "sync_jobs"),
    rawDatasets: new PgStore(pool, "raw_datasets"),
    rawRows: new PgRawRowStore(pool),
    ruleDocs: new PgStore(pool, "rule_docs"),
    ruleCandidates: new PgStore(pool, "rule_candidates"),
    rules: new PgStore(pool, "rules"),
    ontologyTypes: new PgStore(pool, "ontology_types"),
    ontologyLinks: new PgStore(pool, "ontology_links"),
    ontologyDrafts: new PgStore(pool, "ontology_drafts"),
    ontologyVersions: new PgStore(pool, "ontology_versions"),
    objectInterfaces: new PgStore(pool, "object_interfaces"), // WO-69 P3 · 对象接口（R9 四方同步）
    objects: new PgObjectStore(pool),
    links: new PgLinkStore(pool),
    derivationRuns: new PgStore(pool, "derivation_runs"),
    epochs: new PgEpochStore(pool),
    objectPropHistory: new PgStore(pool, "object_prop_history"),
    derivationSpecs: new PgStore(pool, "derivation_specs"),
    derivationValueRuns: new PgStore(pool, "derivation_value_runs"),
    sliceSpecs: new PgStore(pool, "slice_specs"),
    domains: new PgStore(pool, "domains"),
    elementRefs: new PgStore(pool, "element_refs"),
    publishRequests: new PgStore(pool, "publish_requests"),
    actionDrafts: new PgStore(pool, "action_drafts"),
    actionTypes: new PgStore(pool, "action_types"),
    decisions: new PgStore(pool, "decisions"), // WO-C1 · L2 决策内核台账

    industryTemplates: new PgStore(pool, "industry_templates"),
    syntheticJobs: new PgStore(pool, "synthetic_jobs"),
    outboxEvents: new PgStore(pool, "outbox_events"),
    executionLocks: new PgExecutionLockStore(pool),
    idempotencyRecords: new PgStore(pool, "idempotency_records"),
    replayProgress: new PgStore(pool, "replay_progress"),
    extractSegments: new PgStore(pool, "extract_segments"),
    quarantineRows: new PgStore(pool, "quarantine_rows"),
    mergeCandidates: new PgStore(pool, "merge_candidates"),
    objectMerges: new PgStore(pool, "object_merges"),
    notifications: new PgStore(pool, "notifications"),
    ontologyWorkflows: new PgStore(pool, "ontology_workflows"),
    buildPipelines: new PgStore(pool, "build_pipelines"),
    validationRuns: new PgStore(pool, "validation_runs"),
    webhooks: new PgStore(pool, "webhooks"),
    sopVersions: new PgStore(pool, "sop_versions"),
    solverParams: new PgStore(pool, "solver_params"),
    solverParamsHistory: new PgStore(pool, "solver_params_history"),
    scheduledJobs: new PgScheduledJobStore(pool),
    schedulerRuns: new PgStore(pool, "scheduler_runs"),
    kbDocs: new PgStore(pool, "kb_docs"),
    kbChunks: new PgVectorIndex(pool, hasPgVector),
    tsSeries: new PgStore(pool, "ts_series"),
    tsPoints: new PgTsPointStore(pool),
    tsLateArrivals: new PgStore(pool, "ts_late_arrivals"),
    tsAggSpecs: new PgStore(pool, "ts_agg_specs"),
    tsAggRuns: new PgStore(pool, "ts_agg_runs"),
    retentionPolicies: new PgStore(pool, "retention_policies"),
    simulationClocks: new PgStore(pool, "simulation_clocks"),
    clockTickReports: new PgStore(pool, "clock_tick_reports"),
    forecastSnapshots: new PgStore(pool, "forecast_snapshots"),
    featureConfigs: new PgStore(pool, "feature_configs"),
    importJobs: new PgStore(pool, "import_jobs"),
    promptTemplates: new PgStore(pool, "prompt_templates"),
    llmBudgets: new PgStore(pool, "llm_budgets"),
    factoryCalendars: new PgStore(pool, "factory_calendars"),
    dataCategorySettings: new PgStore(pool, "data_category_settings"),
    writebackEchoes: new PgStore(pool, "writeback_echoes"),
    featureAudit: new PgStore(pool, "feature_audit"),
    scenarioPackages: new PgStore(pool, "scenario_packages"),
    dynamicFeatures: new PgStore(pool, "dynamic_features"),
    llmProviders: new PgStore(pool, "llm_providers"),
    llmPurposeBindings: new PgStore(pool, "llm_purpose_bindings"),
    reportedRefs: new PgStore(pool, "reported_refs"),
    calibrationProposals: new PgStore(pool, "calibration_proposals"),
    calibrationHistory: new PgStore(pool, "calibration_history"),
    calibrationForecasts: new PgStore(pool, "calibration_forecasts"),
    calibrationPairs: new PgStore(pool, "calibration_pairs"),
    riskCases: new PgStore(pool, "risk_cases"),
    livedInStates: new PgStore(pool, "lived_in_states"),
    opsSchedules: new PgStore(pool, "ops_schedules"),
    opsTickReports: new PgStore(pool, "ops_tick_reports"),
    dataBuilderAgents: new PgStore(pool, "data_builder_agents"),
    buildPlans: new PgStore(pool, "build_plans"),
    buildJobs: new PgStore(pool, "build_jobs"),
    solverArtifacts: new PgStore(pool, "solver_artifacts"),
    reconcileCandidates: new PgStore(pool, "reconcile_candidates"),
    storyBuildRuns: new PgStore(pool, "story_build_runs"),
    buildWorkflowRuns: new PgStore(pool, "build_workflow_runs"),
    metaAccessPolicies: new PgStore(pool, "meta_access_policies"),
    // WO-Q0 · 业务流程层（R9 三处同改之三 · migrations/029_process_definitions.sql）。
    // 表名与 migration 里的 CREATE TABLE 逐字一致 —— 写错这里不会编译报错，只会在 pg 模式下运行时炸，
    // 而测试默认走 memory ⇒ 单测全绿也证明不了这一行对（本仓「生产实参与测试实参交集为空」的老形态）。
    // 故 process-layer.test.ts 另有一条断言：把 migration 文件里的表名抽出来，与此处的字面量比对。
    processDomains: new PgStore(pool, "process_domains"),
    processDefinitions: new PgStore(pool, "process_definitions"),
    // WO-ENTERPRISE-STATE · 企业状态快照（R9 四处同改之四 · migrations/030_enterprise_states.sql）。
    // 同上：表名写错只在 pg 模式下运行时炸，memory 默认的单测证明不了这一行 ——
    // 故 enterprise-state.seam.test.ts 里另有一条断言，把 030 migration 的 CREATE TABLE 名字抽出来与本行比对。
    enterpriseStates: new PgStore(pool, "enterprise_states"),
    // WO-ORG-WORLD · 组织世界（R9 三处同改之三 · migrations/032_org_world.sql）。
    // 同 processDefinitions 的理由：表名写错**不会编译报错**，只在 pg 模式运行时炸，而测试默认走 memory
    // ⇒ 单测全绿证明不了这四行对。故 org-world.test.ts 有一条断言把该 migration 里的 CREATE TABLE
    // 表名抽出来与此处字面量比对（含金丝雀，抽不到 4 张就报「工具坏了」而不是「表名对」）。
    orgPrincipals: new PgStore(pool, "org_principals"),
    orgAuthorities: new PgStore(pool, "org_authorities"),
    orgApprovalLimits: new PgStore(pool, "org_approval_limits"),
    orgDelegations: new PgStore(pool, "org_delegations"),
    // WO-PROCESS-INSTANCE · 流程运行时层（R9 三处同改之三 · migrations/033_process_instances.sql）。
    // 同上：表名写错不编译报错、memory 单测也测不到 —— process-instance.test.ts 复用同一条
    // 「migration 抽表名 ↔ 本文件字面量」对账断言把这两行也纳入。
    processInstances: new PgStore(pool, "process_instances"),
    processTasks: new PgStore(pool, "process_tasks"),
    sim: new PgSimRepo(pool),
    async ping() {
      await pool.query("SELECT 1");
    },
    async close() {
      await pool.end();
    },
  };
}
