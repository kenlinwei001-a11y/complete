import type { Logger } from "pino";
import { newId } from "./ids.js";
import type { OutboxEvent } from "./domain.js";
import type { Metrics } from "./metrics.js";
import type { Repos } from "./repo/repo.js";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

/**
 * §2 退避档位（1m/5m/30m/2h/12h，共 5 档）；档位耗尽后置 DEAD（死信，中台可手动重投）。
 */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];

/** URL → origin；非法 URL 返回 null（**不抛**：一条坏 hook 不该炸掉整轮投递）。 */
function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * C-2 / 执行语义 §2: A→B 零调用 — events are written to an outbox and POSTed to
 * registered webhook URLs.
 *
 * 投递语义（§2）：
 *  - **at-least-once**，**按聚合内有序**：同一 aggregateKey 的事件串行投递（按 seq），
 *    不同聚合并行；全局有序不保证；
 *  - 每事件带全局唯一 eventId 与 (aggregateKey, seq) 供消费端幂等去重；
 *  - 非 2xx 走 5 档退避，耗尽置 DEAD（死信列表，中台可见可手动重投）。
 */
/**
 * 受信内部对端（B 栈）：只有投递到**这个源**的 webhook 才附带 `X-Service-Token`。
 * baseUrl 取 `AGENTCORE_BASE_URL`，token 取 `SERVICE_TOKEN`。
 */
export interface InternalPeer {
  baseUrl: string;
  serviceToken: string;
}

export class OutboxService {
  private timer: NodeJS.Timeout | null = null;
  /** 受信对端的 origin（`http://host:port`）；解析失败或未配置则为 null ⇒ 一律不附带凭证。 */
  private readonly peerOrigin: string | null;

  constructor(
    private repos: Repos,
    private log: Logger,
    private fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private metrics?: Metrics,
    private internalPeer?: InternalPeer,
  ) {
    this.peerOrigin = internalPeer?.baseUrl ? safeOrigin(internalPeer.baseUrl) : null;
  }

  /**
   * 该 hook URL 是否指向受信内部对端（B 栈）。
   *
   * ⚠ **这是本文件最要紧的一处安全判断，别改成 `startsWith(baseUrl)`。**
   * webhook 是**租户自助注册**的（`POST /a/v1/webhooks` 收下 body 里的任意 `url`，
   * `app.ts` 不做白名单）。若无差别给每次投递附带 `X-Service-Token`，任何租户管理员
   * 只要注册一条指向自己服务器的 hook，就能把**两服务共享的服务间密钥**原样收走 ——
   * 那比本次要修的「匿名清缓存」严重得多（凭据外泄 vs 缓存击穿），等于用一个更大的洞补一个小洞。
   *
   * 判据用 **origin 全等**而非前缀匹配：前缀匹配下 `http://agentcore:4002.evil.com`
   * 会命中 `http://agentcore:4002` ——密钥照样送出去。
   */
  private isInternalPeer(url: string): boolean {
    if (!this.peerOrigin) return false;
    const o = safeOrigin(url);
    return o !== null && o === this.peerOrigin;
  }

  /**
   * Append an event. `aggregateKey` groups events that must be delivered in
   * order (e.g. all events for one action_id); omit for independent events
   * (each becomes its own single-element aggregate, delivered in parallel).
   */
  async emit(
    tenantId: string,
    event: string,
    payload: Record<string, unknown>,
    aggregateKey?: string,
  ): Promise<OutboxEvent> {
    const id = newId("evt");
    const aggKey = aggregateKey ?? id;
    // seq = next position within this aggregate (per-aggregate monotonic)
    const siblings = await this.repos.outboxEvents.list(tenantId, (e) => e.aggregateKey === aggKey);
    const seq = siblings.reduce((m, e) => Math.max(m, e.seq + 1), 0);
    const evt: OutboxEvent = {
      id,
      tenantId,
      eventId: id,
      event,
      aggregateKey: aggKey,
      seq,
      payload,
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    await this.repos.outboxEvents.put(evt);
    return evt;
  }

  /** Single delivery pass over due PENDING events (also used directly by tests). */
  async processOnce(tenantId: string): Promise<{ delivered: number; failed: number; dead: number }> {
    const now = Date.now();
    const pending = await this.repos.outboxEvents.list(tenantId, (e) => e.status === "PENDING");
    const hooks = await this.repos.webhooks.list(tenantId, (w) => w.status === "ACTIVE");

    // §2 按聚合内有序：每个 aggregate 只投递其最小未投递 seq（head），失败则该聚合本轮阻塞
    const byAggregate = new Map<string, OutboxEvent[]>();
    for (const e of pending) {
      const arr = byAggregate.get(e.aggregateKey) ?? [];
      arr.push(e);
      byAggregate.set(e.aggregateKey, arr);
    }

    let delivered = 0;
    let failed = 0;
    let dead = 0;
    for (const [, events] of byAggregate) {
      events.sort((a, b) => a.seq - b.seq);
      const head = events[0]; // lowest-seq undelivered in this aggregate
      if (!head) continue;
      if (new Date(head.nextAttemptAt).getTime() > now) continue; // head not due yet → whole aggregate waits
      const outcome = await this.deliver(tenantId, head, hooks);
      if (outcome === "delivered") delivered++;
      else if (outcome === "dead") dead++;
      else failed++;
    }
    return { delivered, failed, dead };
  }

  private async deliver(
    tenantId: string,
    evt: OutboxEvent,
    hooks: Awaited<ReturnType<Repos["webhooks"]["list"]>>,
  ): Promise<"delivered" | "failed" | "dead"> {
    const targets = hooks.filter((h) => h.events.length === 0 || h.events.includes(evt.event));
    if (targets.length === 0) {
      await this.repos.outboxEvents.put({ ...evt, status: "DELIVERED" });
      return "delivered";
    }
    let allOk = true;
    let lastError: string | undefined;
    for (const hook of targets) {
      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "idempotency-key": evt.eventId,
        };
        // 只对受信内部对端附带服务间凭证（B 侧 `/b/v1/internal/invalidate` 已收口为 SERVICE_TOKEN；
        // 不带 = 缓存失效链**静默**断掉：投递方只看到 401 → 退避重试 → 最终死信，而
        // B 侧缓存靠 TTL 60s 兜底，业务面无红、测试面无红 —— 正是最难发现的那种断法）。
        if (this.isInternalPeer(hook.url) && this.internalPeer) {
          headers["x-service-token"] = this.internalPeer.serviceToken;
          headers["x-service-caller"] = "datacore-outbox";
        }
        const res = await this.fetchImpl(hook.url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: evt.id,
            eventId: evt.eventId,
            event: evt.event,
            aggregateKey: evt.aggregateKey,
            seq: evt.seq,
            tenantId,
            payload: evt.payload,
          }),
        });
        if (!res.ok) {
          allOk = false;
          lastError = `HTTP ${res.status} from ${hook.url}`;
        }
      } catch (err) {
        allOk = false;
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    if (allOk) {
      await this.repos.outboxEvents.put({ ...evt, status: "DELIVERED", attempts: evt.attempts + 1 });
      this.metrics?.inc("outbox_delivered_total", { event: evt.event });
      return "delivered";
    }
    const attempts = evt.attempts + 1;
    if (attempts > BACKOFF_MS.length) {
      await this.repos.outboxEvents.put({ ...evt, attempts, status: "DEAD", lastError });
      this.metrics?.inc("outbox_dead_total", { event: evt.event });
      this.log.error({ eventId: evt.eventId, attempts, lastError }, "webhook event moved to dead-letter");
      return "dead";
    }
    const backoffMs = BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
    await this.repos.outboxEvents.put({
      ...evt,
      attempts,
      status: "PENDING",
      lastError,
      nextAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
    });
    this.metrics?.inc("outbox_retry_total", { event: evt.event });
    this.log.warn({ eventId: evt.eventId, attempts, lastError }, "webhook delivery failed");
    return "failed";
  }

  /** §2 死信列表（中台可见）。 */
  async listDead(tenantId: string): Promise<OutboxEvent[]> {
    return this.repos.outboxEvents.list(tenantId, (e) => e.status === "DEAD");
  }

  /** §2 手动重投：DEAD → PENDING，退避档位重置。 */
  async redeliver(tenantId: string, id: string): Promise<boolean> {
    const evt = await this.repos.outboxEvents.get(tenantId, id);
    if (!evt || evt.status !== "DEAD") return false;
    await this.repos.outboxEvents.put({
      ...evt,
      status: "PENDING",
      attempts: 0,
      lastError: undefined,
      nextAttemptAt: new Date().toISOString(),
    });
    return true;
  }

  /** Background dispatcher for known tenants; failures are isolated per event. */
  start(tenantIdsProvider: () => Promise<string[]>, intervalMs = 5000): void {
    this.timer = setInterval(() => {
      void (async () => {
        try {
          for (const tid of await tenantIdsProvider()) await this.processOnce(tid);
        } catch (err) {
          this.log.warn({ err }, "outbox pass failed");
        }
      })();
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
