import type { Logger } from "pino";
import { newId } from "./ids.js";
import type { OutboxEvent } from "./domain.js";
import type { Repos } from "./repo/repo.js";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

const MAX_ATTEMPTS = 5;

/**
 * C-2: A→B 零调用 — events (ontology.published / rules.updated / ...) are written
 * to an outbox and POSTed to registered webhook URLs with retry. Delivery
 * failures never affect System A.
 */
export class OutboxService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private repos: Repos,
    private log: Logger,
    private fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  async emit(tenantId: string, event: string, payload: Record<string, unknown>): Promise<OutboxEvent> {
    const evt: OutboxEvent = {
      id: newId("evt"),
      tenantId,
      event,
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
  async processOnce(tenantId: string): Promise<{ delivered: number; failed: number }> {
    const now = new Date().toISOString();
    const pending = await this.repos.outboxEvents.list(
      tenantId,
      (e) => e.status === "PENDING" && e.nextAttemptAt <= now,
    );
    const hooks = await this.repos.webhooks.list(tenantId, (w) => w.status === "ACTIVE");
    let delivered = 0;
    let failed = 0;
    for (const evt of pending) {
      const targets = hooks.filter((h) => h.events.length === 0 || h.events.includes(evt.event));
      if (targets.length === 0) {
        await this.repos.outboxEvents.put({ ...evt, status: "DELIVERED" });
        delivered++;
        continue;
      }
      let allOk = true;
      for (const hook of targets) {
        try {
          const res = await this.fetchImpl(hook.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: evt.id, event: evt.event, tenantId, payload: evt.payload }),
          });
          if (!res.ok) allOk = false;
        } catch {
          allOk = false;
        }
      }
      if (allOk) {
        await this.repos.outboxEvents.put({ ...evt, status: "DELIVERED", attempts: evt.attempts + 1 });
        delivered++;
      } else {
        const attempts = evt.attempts + 1;
        const backoffMs = Math.min(60_000, 1000 * 2 ** attempts);
        await this.repos.outboxEvents.put({
          ...evt,
          attempts,
          status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
          nextAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
        });
        failed++;
        this.log.warn({ eventId: evt.id, attempts }, "webhook delivery failed");
      }
    }
    return { delivered, failed };
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
