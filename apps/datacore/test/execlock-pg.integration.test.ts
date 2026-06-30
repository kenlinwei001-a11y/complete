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

  it("8) WO-T5-RESUME-LEASE：steal 无条件夺未过期租约（重启续跑）·fence 单调 +1", async () => {
    const key = `k8_${Date.now()}`;
    // 模拟"崩溃进程"持有未过期长租约（60min）
    const a1 = await svc.acquire(tenant, "rule_extraction", key, "dead_holder");
    expect(a1.ok).toBe(true);
    if (!a1.ok) return;
    const col = await columnLeaseUntil(`rule_extraction|${key}`);
    expect(new Date(col).getTime()).toBeGreaterThan(Date.now()); // 租约未过期
    // 常态抢占（不 steal）应 SKIPPED（未过期）
    const blocked = await svc.acquire(tenant, "rule_extraction", key, "normal");
    expect(blocked.ok).toBe(false);
    // 续跑 steal 应夺锁成功（绕未过期租约）·fence 递增（证真夺锁，对照母单"fence 恒=1 卡死"）
    const stolen = await repos.executionLocks.tryAcquire({
      tenantId: tenant, resourceKind: "rule_extraction", resourceKey: key, holderId: "resume", leaseMs: 60_000, steal: true,
    });
    expect(stolen).toBeDefined();
    expect(stolen!.holderId).toBe("resume");
    expect(stolen!.fence).toBeGreaterThan(a1.fence);
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

  // =====================================================================
  // WO-T5-LEASE-HEARTBEAT · 短租约 + 心跳保鲜 + 死锁过期重夺 + 多实例互斥（真 PG live-fire）
  // ---------------------------------------------------------------------
  // 模型：两个 ExecutionLockService（svcA/svcB）共享同一 PG execution_locks 表 =
  // 模拟两 app 实例，PG 行级原子 INSERT…ON CONFLICT WHERE lease_until<now() 是跨实例唯一裁决者。
  // 用极短 TTL（leaseOverrides）+ 受控 sleep 验 TTL 语义，断言确定（R6：不依赖墙钟随机，只依赖 TTL 已过/未过）。
  // =====================================================================
  describe("WO-T5-LEASE-HEARTBEAT · 短租约+心跳", () => {
    // PG tryAcquire 以秒为粒度（Math.round(leaseMs/1000)）→ 取整秒 TTL 避免取整意外。
    const TTL = 2000; // 2s 短租约（生产 ~120s 同语义，测试取小以可控验 TTL）
    const EXPIRE_WAIT = TTL + 1200; // 过期等待 = TTL + 余量（覆盖秒粒度 + 调度抖动）
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // 两"实例"——各自独立 service 对象，但共享同一 repos（= 同一 PG 表）。
    let svcA: ExecutionLockService;
    let svcB: ExecutionLockService;
    beforeAll(() => {
      svcA = new ExecutionLockService(repos, undefined, { rule_extraction: TTL });
      svcB = new ExecutionLockService(repos, undefined, { rule_extraction: TTL });
    });

    it("T5-1) 短租约下不心跳 → 过 TTL → 另一实例可重夺（死锁过期重夺·常态 acquire 非 steal）", async () => {
      const key = `lh1_${Date.now()}`;
      // 实例A 夺锁后"崩溃"（不再心跳）
      const a = await svcA.acquire(tenant, "rule_extraction", key, "instA");
      expect(a.ok).toBe(true);
      if (!a.ok) return;
      // TTL 内：实例B 常态 acquire 被挡（租约未过期·跨实例互斥）
      const blocked = await svcB.acquire(tenant, "rule_extraction", key, "instB");
      expect(blocked.ok).toBe(false);
      // 等过 TTL（无心跳 → 租约自然过期）
      await sleep(EXPIRE_WAIT);
      // 实例B 常态 acquire（非 steal）即可重夺 · fence 单调递增（防僵尸写）
      const reclaim = await svcB.acquire(tenant, "rule_extraction", key, "instB");
      expect(reclaim.ok).toBe(true);
      if (reclaim.ok) expect(reclaim.fence).toBeGreaterThan(a.fence);
    }, 15_000); // 含受控 sleep(EXPIRE_WAIT) 跨 TTL 边界，超默认 5s testTimeout

    it("T5-2) 持锁方持续心跳 → 租约保鲜 → 另一实例过 TTL 后仍拿不到（活锁心跳有效·长任务不被误夺）", async () => {
      const key = `lh2_${Date.now()}`;
      const a = await svcA.acquire(tenant, "rule_extraction", key, "liveHolder");
      expect(a.ok).toBe(true);
      if (!a.ok) return;
      // 实例A 持续心跳（每 TTL/3 续租），模拟 withLock 自动保鲜
      const hbTimer = setInterval(() => {
        void svcA.heartbeat(tenant, "rule_extraction", key, "liveHolder", a.fence);
      }, Math.floor(TTL / 3));
      try {
        // 等到「若无心跳早该过期」的 2 倍 TTL 之后
        await sleep(TTL * 2 + 200);
        // 实例B 仍拿不到（活持锁者心跳让租约恒新鲜 → 跨实例互斥未被时间击穿）
        const stillBlocked = await svcB.acquire(tenant, "rule_extraction", key, "instB");
        expect(stillBlocked.ok).toBe(false);
      } finally {
        clearInterval(hbTimer);
      }
      // 停心跳后过 TTL → 才放行（证拿不到确因心跳保鲜而非锁坏）
      await sleep(EXPIRE_WAIT);
      const afterDeath = await svcB.acquire(tenant, "rule_extraction", key, "instB");
      expect(afterDeath.ok).toBe(true);
    }, 15_000); // 心跳 2×TTL + 停心跳过 TTL，总耗时 >5s 默认 testTimeout

    it("T5-3) 两实例并发 acquire 同 key → 恰一个成功（多实例互斥·PG 行级原子裁决）", async () => {
      const key = `lh3_${Date.now()}`;
      // 同一时刻两实例抢同 key（Promise.all 真并发打 PG）
      const [ra, rb] = await Promise.all([
        svcA.acquire(tenant, "rule_extraction", key, "raceA"),
        svcB.acquire(tenant, "rule_extraction", key, "raceB"),
      ]);
      const winners = [ra, rb].filter((r) => r.ok);
      expect(winners.length).toBe(1); // 恰一个赢
      const losers = [ra, rb].filter((r) => !r.ok);
      expect(losers.length).toBe(1); // 另一个 SKIPPED
      // 输方拿到的 holder 应指向赢方（携当前持有者）
      const loser = losers[0];
      if (!loser.ok) expect(["raceA", "raceB"]).toContain(loser.holderId);
    });

    it("T5-4) 重夺后 fence 递增 → 旧持有者写被 fencing 拒（无僵尸写）", async () => {
      const key = `lh4_${Date.now()}`;
      // 旧持有者A 夺锁拿到 oldFence，随后"卡死"（不心跳）
      const a = await svcA.acquire(tenant, "rule_extraction", key, "zombieHolder");
      expect(a.ok).toBe(true);
      if (!a.ok) return;
      const oldFence = a.fence;
      // 旧持有者持 oldFence 的写在被重夺前是合法的
      await expect(svcA.assertFence(tenant, "rule_extraction", key, oldFence)).resolves.toBeUndefined();
      // 等过 TTL → 实例B 常态重夺，fence 递增
      await sleep(EXPIRE_WAIT);
      const reclaim = await svcB.acquire(tenant, "rule_extraction", key, "freshHolder");
      expect(reclaim.ok).toBe(true);
      if (!reclaim.ok) return;
      expect(reclaim.fence).toBeGreaterThan(oldFence);
      // 旧持有者"复活"想写 → 持过期 oldFence → fencing 必拒（StaleExecutorError）→ 无僵尸写
      await expect(
        svcA.assertFence(tenant, "rule_extraction", key, oldFence),
      ).rejects.toThrow(/stale executor/);
      // 新持有者持新 fence 写合法
      await expect(
        svcB.assertFence(tenant, "rule_extraction", key, reclaim.fence),
      ).resolves.toBeUndefined();
    }, 15_000); // 含受控 sleep(EXPIRE_WAIT) 跨 TTL 边界，超默认 5s testTimeout
  });
});
