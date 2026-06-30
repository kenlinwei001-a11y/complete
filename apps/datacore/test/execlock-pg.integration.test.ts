import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createPgRepos } from "../src/repo/pg.js";
import { ExecutionLockService } from "../src/execlock.js";
import type { Repos } from "../src/repo/repo.js";

/**
 * WO-P0-LOCK · execution_locks 真 PG live-fire 回归（env-gated：未配 DATABASE_URL_TEST 则 skip；CI 配真 PG 跑）。
 *
 * 本 bug 正因「只内存测才漏」：PgExecutionLockStore 漏 extraColumns → 通用 put 的 INSERT 元组缺
 * NOT-NULL 列（resource_kind/resource_key/holder_id/lease_until）→ 真 PG 直抛、内存仓储无约束故不暴露。
 * 守「绿测试≠能用」：此测试只在真 PG 上跑，acquire→heartbeat→release 全程不崩、且续租改的是 lease_until 列。
 *
 * 跑法：
 *   DATABASE_URL_TEST=postgres://user:pw@host:5432/db pnpm --filter datacore exec \
 *     vitest run test/execlock-pg.integration.test.ts
 */
const DB = process.env.DATABASE_URL_TEST;
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

describe.skipIf(!DB)("WO-P0-LOCK · execution_locks 真 PG live-fire", () => {
  let repos: Repos;
  let svc: ExecutionLockService;
  let pool: pg.Pool;
  const tenant = "t_lock_livefire";

  /** 直读 lease_until 列（非 doc JSONB）——证续租/释放改的是服务端原子抢占读的那一列。 */
  async function columnLeaseUntil(id: string): Promise<string> {
    const r = await pool.query(`SELECT lease_until FROM execution_locks WHERE id = $1`, [id]);
    return new Date(r.rows[0].lease_until).toISOString();
  }

  beforeAll(async () => {
    repos = await createPgRepos(DB!, migrationsDir);
    svc = new ExecutionLockService(repos);
    pool = new pg.Pool({ connectionString: DB });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM execution_locks WHERE tenant_id = $1`, [tenant]).catch(() => {});
    await pool.query(`DELETE FROM merge_candidates WHERE tenant_id = $1`, [tenant]).catch(() => {});
    await pool.query(`DELETE FROM object_merges WHERE tenant_id = $1`, [tenant]).catch(() => {});
    await pool.end().catch(() => {});
  });

  it("1) acquire 不抛 + 行落库（resource_kind 列非空·漏 extraColumns 时这里必崩 NOT NULL）", async () => {
    const key = `k1_${Date.now()}`;
    const r = await svc.acquire(tenant, "rule_extraction", key, "h1");
    expect(r.ok).toBe(true);
    const lock = await repos.executionLocks.get(tenant, `rule_extraction|${key}`);
    expect(lock?.resourceKind).toBe("rule_extraction");
    // 列层面也非空（通用 put 写齐了 NOT NULL 列）
    const col = await pool.query(
      `SELECT resource_kind, resource_key, holder_id FROM execution_locks WHERE id = $1`,
      [`rule_extraction|${key}`],
    );
    expect(col.rows[0].resource_kind).toBe("rule_extraction");
    expect(col.rows[0].holder_id).toBe("h1");
  });

  it("2) heartbeat 真前移 lease_until 列（证续租改列·非仅 doc → 抢占判定有效）", async () => {
    const key = `k2_${Date.now()}`;
    const acq = await svc.acquire(tenant, "rule_extraction", key, "h2");
    expect(acq.ok).toBe(true);
    if (!acq.ok) return;
    const id = `rule_extraction|${key}`;
    const before = await columnLeaseUntil(id);
    await new Promise((r) => setTimeout(r, 1100));
    const ok = await svc.heartbeat(tenant, "rule_extraction", key, "h2", acq.fence);
    expect(ok).toBe(true);
    const after = await columnLeaseUntil(id);
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it("3) release 后 lease_until 列 ≤ now() → 下一 acquire 可重夺（fence 单调 +1）", async () => {
    const key = `k3_${Date.now()}`;
    const a1 = await svc.acquire(tenant, "rule_extraction", key, "h3a");
    expect(a1.ok).toBe(true);
    if (!a1.ok) return;
    await svc.release(tenant, "rule_extraction", key, "h3a");
    const col = await columnLeaseUntil(`rule_extraction|${key}`);
    expect(new Date(col).getTime()).toBeLessThanOrEqual(Date.now());
    const a2 = await svc.acquire(tenant, "rule_extraction", key, "h3b");
    expect(a2.ok).toBe(true);
    if (a2.ok) expect(a2.fence).toBeGreaterThan(a1.fence); // 单调 fence
  });

  it("4) 续租前未到期时第二抢占者 SKIPPED；过期后可抢（lease_until 列驱动）", async () => {
    const key = `k4_${Date.now()}`;
    // 极短租约：第二抢占者立即 SKIPPED
    const shortSvc = new ExecutionLockService(repos, undefined, { rule_extraction: 60_000 });
    const a1 = await shortSvc.acquire(tenant, "rule_extraction", key, "owner");
    expect(a1.ok).toBe(true);
    const a2 = await shortSvc.acquire(tenant, "rule_extraction", key, "intruder");
    expect(a2.ok).toBe(false); // 未过期 → 不可抢
  });

  it("5) 另一 kind（derivation_spec）同样不崩（证锁通用可用·非仅 rule_extraction）", async () => {
    const key = `k5_${Date.now()}`;
    const r = await svc.acquire(tenant, "derivation_spec", key, "h5");
    expect(r.ok).toBe(true);
  });

  it("7) 同类潜伏修：merge_candidates/object_merges（data 列·无 doc）真 PG put→get→list 不崩", async () => {
    // 修前这两表用裸 PgStore（写不存在的 doc 列）→ 实体合并特性在 PG 整体崩。
    const ts = Date.now();
    const cand = {
      id: `mc_${ts}`,
      tenantId: tenant,
      typeKey: "supplier",
      objectIds: ["obj_a", "obj_b"],
      score: 0.97,
      rule: "归一名称完全一致",
      status: "PENDING" as const,
      createdAt: new Date(0).toISOString(),
    };
    await repos.mergeCandidates.put(cand as never);
    const got = await repos.mergeCandidates.get(tenant, cand.id);
    expect((got as { score?: number } | undefined)?.score).toBe(0.97);
    const listed = await repos.mergeCandidates.list(tenant, (c) => (c as { status?: string }).status === "PENDING");
    expect(listed.some((c) => (c as { id?: string }).id === cand.id)).toBe(true);

    const merge = {
      id: `omg_${ts}`,
      tenantId: tenant,
      typeKey: "supplier",
      goldenId: "obj_a",
      mergedIds: ["obj_a", "obj_b"],
      mergedBy: "u_admin",
      mergedAt: new Date(0).toISOString(),
    };
    await repos.objectMerges.put(merge as never);
    const gm = await repos.objectMerges.get(tenant, merge.id);
    expect((gm as { goldenId?: string } | undefined)?.goldenId).toBe("obj_a");
  });

  it("6) withLock 端到端（acquire→自动心跳→release）真 PG 不崩 + 同键互斥", async () => {
    const key = `k6_${Date.now()}`;
    let ran = 0;
    const out = await svc.withLock(tenant, "rule_extraction", key, async () => {
      ran += 1;
      // 锁持有中，另一触发者应 SKIPPED（不排队）
      const inner = await svc.acquire(tenant, "rule_extraction", key, "other");
      expect(inner.ok).toBe(false);
      return "done";
    });
    expect(out).toEqual({ skipped: false, result: "done" });
    expect(ran).toBe(1);
    // 收尾后已释放 → 可再次 acquire
    const after = await svc.acquire(tenant, "rule_extraction", key, "next");
    expect(after.ok).toBe(true);
  });
});
