import type { ExecutionResourceKind } from "@platform/contracts";
import { EXEC_SKIPPED_ALREADY_RUNNING, EXEC_STALE_EXECUTOR } from "@platform/contracts";
import type { ExecutionLockRecord } from "./domain.js";
import type { Metrics } from "./metrics.js";
import type { Repos } from "./repo/repo.js";
import { newId } from "./ids.js";

/**
 * §1 管线执行互斥与重入（统一机制，A1/A4/A8/A9/A3 全部适用）。
 *
 * - 获取：原子抢占过期租约（仓储 tryAcquire = INSERT … ON CONFLICT WHERE lease_until<now()），
 *   成功返回单调 fence；
 * - 同键互斥：第二个触发者不排队，立即 SKIPPED_ALREADY_RUNNING（携 holder）；
 *   变更触发类（派生）改置"待重跑"标志，由当前持有者收尾连跑（合并风暴：连续变更只多跑一轮）；
 * - Fencing：写入路径校验 fence ≥ 锁表当前 fence，否则 STALE_EXECUTOR；
 * - 心跳续租：执行中按 1/3 租约续租。
 *
 * WO-T5-LEASE-HEARTBEAT（短租约 + 心跳保鲜模型 · 根因解）
 * ------------------------------------------------------------------
 * 旧模型：租约定为「任务预估时长×2」(最长 60min) → 持锁进程崩 → 租约要等 60min 才过期
 * → 续跑/竞争者被挡 60min（"长租约死锁"）→ 被迫加无条件 `steal` 创可贴（多实例下会双跑）。
 *
 * 新模型（分布式锁标准 lease + fencing 范式）：
 *   1. **短租约 TTL**（量级 ~120s·见 SHORT_LEASE_MS）：acquire 时 lease_until = now + ttl。
 *   2. **心跳保鲜**：withLock 持锁期间每 ttl/3 心跳续租（活着就续约）→ 活持锁者租约恒新鲜
 *      → 他实例常态 acquire 命中 lease_until>now 必 SKIP → **跨实例互斥真成立**；长任务不被误夺。
 *   3. **死锁过期重夺**：进程崩 → 心跳停 → 租约 ~ttl 后自然过期 → 另一实例**常态 acquire**
 *      （WHERE lease_until<now）即可重夺（fence+1 防僵尸写）；不再需要无条件 steal。
 *   4. steal 退化为 **EXECUTION_SINGLETON** 守护的可选优化（单实例 docker 即时续跑·见 ruledocs）。
 * 死活判定从"我猜你死了（steal）"变为"租约新鲜度（心跳）自证"——多实例正确、续跑不卡 60min。
 */

/**
 * 短租约模型默认 TTL：取「最坏单步同步停顿的安全上界」而非「任务总时长」——
 * 长任务由心跳（ttl/3 续租）保鲜，不靠长 ttl 撑。所有 kind 均为异步 I/O（LLM/网络/IO 不阻塞事件循环），
 * 唯一同步风险是巨型 zod parse（秒级），120s >> 任何可信停顿。崩溃后最坏等 ttl(~120s) 即可重夺（vs 旧 60min）。
 */
const SHORT_LEASE_MS = 120_000; // 120s · 心跳间隔随之 = ttl/3 ≈ 40s
const DEFAULT_LEASE_MS: Record<ExecutionResourceKind, number> = {
  derivation_spec: SHORT_LEASE_MS,
  connection_sync: SHORT_LEASE_MS,
  forge_generate: SHORT_LEASE_MS,
  materialize: SHORT_LEASE_MS,
  replay: SHORT_LEASE_MS,
  bundle_import: SHORT_LEASE_MS,
  rule_extraction: SHORT_LEASE_MS, // 抽取真打 LLM 可达数百秒·多段重试 → 心跳 ttl/3 续租保鲜（非靠长租约）
};

export class StaleExecutorError extends Error {
  readonly code = EXEC_STALE_EXECUTOR;
  constructor(
    readonly resourceKind: string,
    readonly resourceKey: string,
    readonly attemptedFence: number,
    readonly currentFence: number,
  ) {
    super(
      `stale executor for ${resourceKind}|${resourceKey}: fence ${attemptedFence} < current ${currentFence}`,
    );
  }
}

export type AcquireResult =
  | { ok: true; fence: number; holderId: string; leaseUntil: string }
  | { ok: false; code: typeof EXEC_SKIPPED_ALREADY_RUNNING; holderId: string };

export class ExecutionLockService {
  constructor(
    private readonly repos: Repos,
    private readonly metrics?: Metrics,
    private readonly leaseOverrides: Partial<Record<ExecutionResourceKind, number>> = {},
  ) {}

  private leaseMs(kind: ExecutionResourceKind): number {
    return this.leaseOverrides[kind] ?? DEFAULT_LEASE_MS[kind];
  }

  /** Try to take the lock; returns SKIPPED (with current holder) if held. */
  async acquire(
    tenantId: string,
    kind: ExecutionResourceKind,
    key: string,
    holderId: string = newId("exec"),
    opts: { steal?: boolean } = {},
  ): Promise<AcquireResult> {
    const lock = await this.repos.executionLocks.tryAcquire({
      tenantId,
      resourceKind: kind,
      resourceKey: key,
      holderId,
      leaseMs: this.leaseMs(kind),
      steal: opts.steal,
    });
    if (!lock) {
      const current = await this.current(tenantId, kind, key);
      this.metrics?.inc("exec_lock_skipped_total", { kind });
      return { ok: false, code: EXEC_SKIPPED_ALREADY_RUNNING, holderId: current?.holderId ?? "unknown" };
    }
    return { ok: true, fence: lock.fence, holderId, leaseUntil: lock.leaseUntil };
  }

  private async current(
    tenantId: string,
    kind: ExecutionResourceKind,
    key: string,
  ): Promise<ExecutionLockRecord | undefined> {
    return this.repos.executionLocks.get(tenantId, `${kind}|${key}`);
  }

  /** Renew the lease (call at ~1/3 lease interval). Returns false if no longer holder. */
  async heartbeat(
    tenantId: string,
    kind: ExecutionResourceKind,
    key: string,
    holderId: string,
    fence: number,
  ): Promise<boolean> {
    const lock = await this.current(tenantId, kind, key);
    if (!lock || lock.holderId !== holderId || lock.fence !== fence) return false;
    await this.repos.executionLocks.put({
      ...lock,
      leaseUntil: new Date(Date.now() + this.leaseMs(kind)).toISOString(),
    });
    return true;
  }

  /**
   * §1.2 Fencing: a write must carry the fence it acquired; reject if a newer
   * executor has since taken the lock (the old one "came back from the dead").
   */
  async assertFence(
    tenantId: string,
    kind: ExecutionResourceKind,
    key: string,
    fence: number,
  ): Promise<void> {
    const lock = await this.current(tenantId, kind, key);
    const currentFence = lock?.fence ?? 0;
    if (fence < currentFence) {
      this.metrics?.inc("exec_fence_rejects_total", { kind });
      throw new StaleExecutorError(kind, key, fence, currentFence);
    }
  }

  /** §1.3 变更触发类：当前正被占用时登记"待重跑"。 */
  async requestRerun(tenantId: string, kind: ExecutionResourceKind, key: string): Promise<void> {
    const lock = await this.current(tenantId, kind, key);
    if (lock) await this.repos.executionLocks.put({ ...lock, rerunRequested: true });
  }

  /** 持有者收尾时检查并清除"待重跑"标志；返回是否需要连跑一轮。 */
  async consumeRerun(
    tenantId: string,
    kind: ExecutionResourceKind,
    key: string,
    holderId: string,
  ): Promise<boolean> {
    const lock = await this.current(tenantId, kind, key);
    if (!lock || lock.holderId !== holderId || !lock.rerunRequested) return false;
    await this.repos.executionLocks.put({ ...lock, rerunRequested: false });
    return true;
  }

  /** Release the lock if we still hold it (idempotent). */
  async release(
    tenantId: string,
    kind: ExecutionResourceKind,
    key: string,
    holderId: string,
  ): Promise<void> {
    const lock = await this.current(tenantId, kind, key);
    if (lock && lock.holderId === holderId) {
      // expire immediately so the next acquire wins (fence preserved by store)
      await this.repos.executionLocks.put({ ...lock, leaseUntil: new Date(0).toISOString() });
    }
  }

  /**
   * Run `fn` under the lock. If already held, returns { skipped:true } without
   * queueing (§1.3). Heartbeats automatically; releases on completion. The
   * acquired fence is passed to `fn` so result writes can be fenced.
   */
  async withLock<T>(
    tenantId: string,
    kind: ExecutionResourceKind,
    key: string,
    fn: (ctx: { fence: number; holderId: string }) => Promise<T>,
    opts: { onSkipped?: "rerun"; steal?: boolean } = {},
  ): Promise<{ skipped: true; holderId: string } | { skipped: false; result: T }> {
    const holderId = newId("exec");
    // WO-T5-RESUME-LEASE：steal 仅供重启续跑——绕过崩溃进程遗留的未过期租约（fencing 防僵尸写）。
    const acq = await this.acquire(tenantId, kind, key, holderId, { steal: opts.steal });
    if (!acq.ok) {
      if (opts.onSkipped === "rerun") await this.requestRerun(tenantId, kind, key);
      return { skipped: true, holderId: acq.holderId };
    }
    const interval = Math.max(1000, Math.floor(this.leaseMs(kind) / 3));
    const timer = setInterval(() => {
      void this.heartbeat(tenantId, kind, key, holderId, acq.fence);
    }, interval);
    if (typeof timer.unref === "function") timer.unref();
    try {
      let result = await fn({ fence: acq.fence, holderId });
      // §1.3 合并风暴：持有者收尾连跑（最多一轮）
      if (await this.consumeRerun(tenantId, kind, key, holderId)) {
        result = await fn({ fence: acq.fence, holderId });
      }
      return { skipped: false, result };
    } finally {
      clearInterval(timer);
      await this.release(tenantId, kind, key, holderId);
    }
  }
}
