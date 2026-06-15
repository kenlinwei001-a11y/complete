import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, PLANNER } from "./helpers.js";
import { ExecutionLockService, StaleExecutorError } from "../src/execlock.js";
import type { WebhookRegistration } from "../src/domain.js";

describe("execution semantics §1 — execution locks + fencing", () => {
  it("same (kind,key) second acquire is SKIPPED_ALREADY_RUNNING, not queued", async () => {
    const t = await makeApp();
    const svc = t.services.execLocks;
    const a = await svc.acquire("demo", "derivation_spec", "spec1", "holderA");
    expect(a.ok).toBe(true);
    const b = await svc.acquire("demo", "derivation_spec", "spec1", "holderB");
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.code).toBe("SKIPPED_ALREADY_RUNNING");
      expect(b.holderId).toBe("holderA");
    }
    expect(t.services.metrics.get("exec_lock_skipped_total", { kind: "derivation_spec" })).toBe(1);
  });

  it("fence is monotonic across re-acquisition; stale executor write is rejected", async () => {
    const t = await makeApp();
    const svc = t.services.execLocks;
    const a = await svc.acquire("demo", "materialize", "m1", "holderA");
    expect(a.ok && a.fence).toBe(1);
    await svc.release("demo", "materialize", "m1", "holderA");
    const b = await svc.acquire("demo", "materialize", "m1", "holderB");
    expect(b.ok && b.fence).toBe(2);
    // the dead-and-revived holderA (fence 1) must not be able to write
    await expect(svc.assertFence("demo", "materialize", "m1", 1)).rejects.toBeInstanceOf(StaleExecutorError);
    // current holder (fence 2) passes
    await expect(svc.assertFence("demo", "materialize", "m1", 2)).resolves.toBeUndefined();
    expect(t.services.metrics.get("exec_fence_rejects_total", { kind: "materialize" })).toBe(1);
  });

  it("expired lease can be atomically preempted", async () => {
    const t = await makeApp();
    // tiny lease so it expires immediately
    const svc = new ExecutionLockService(t.repos, t.services.metrics, { connection_sync: 5 });
    const a = await svc.acquire("demo", "connection_sync", "c1", "holderA");
    expect(a.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 15));
    const b = await svc.acquire("demo", "connection_sync", "c1", "holderB");
    expect(b.ok).toBe(true);
    expect(b.ok && b.fence).toBe(2);
  });

  it("withLock skips concurrent caller and reruns once when rerun requested (§1.3 merge storm)", async () => {
    const t = await makeApp();
    const svc = t.services.execLocks;
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const first = svc.withLock("demo", "derivation_spec", "d2", async () => {
      runs++;
      await gate; // hold the lock open
    });
    // give the first call time to acquire
    await new Promise((r) => setTimeout(r, 5));
    const second = await svc.withLock(
      "demo",
      "derivation_spec",
      "d2",
      async () => {
        runs++;
      },
      { onSkipped: "rerun" },
    );
    expect(second.skipped).toBe(true);
    release();
    await first;
    // first holder reran once after seeing the rerun flag → total 2 executions of the body
    expect(runs).toBe(2);
  });
});

describe("execution semantics §2 — outbox at-least-once, ordering, dead-letter", () => {
  function failingApp(failures: { n: number }) {
    return makeApp({
      fetchImpl: (async () => {
        if (failures.n > 0) {
          failures.n--;
          return { ok: false, status: 503 } as Response;
        }
        return { ok: true, status: 200 } as Response;
      }) as unknown as typeof fetch,
    });
  }

  async function registerHook(t: Awaited<ReturnType<typeof makeApp>>): Promise<void> {
    const hook: WebhookRegistration = {
      id: "wh_test",
      tenantId: "demo",
      url: "http://consumer.local/hook",
      events: [],
      status: "ACTIVE",
    };
    await t.repos.webhooks.put(hook);
  }

  it("emitted events carry eventId + (aggregateKey, seq)", async () => {
    const t = await makeApp();
    const e1 = await t.services.outbox.emit("demo", "rules.updated", { ruleKey: "r1" }, "agg-x");
    const e2 = await t.services.outbox.emit("demo", "rules.updated", { ruleKey: "r1" }, "agg-x");
    expect(e1.eventId).toBe(e1.id);
    expect(e1.aggregateKey).toBe("agg-x");
    expect(e1.seq).toBe(0);
    expect(e2.seq).toBe(1);
  });

  it("retries with backoff then moves to DEAD; dead-letter is listable and redeliverable", async () => {
    const failures = { n: 100 }; // always fail
    const t = await failingApp(failures);
    await registerHook(t);
    await t.services.outbox.emit("demo", "ontology.published", { version: "1.1" });

    // drive 6 attempts (force due each pass by clearing backoff)
    for (let i = 0; i < 6; i++) {
      const r = await t.services.outbox.processOnce("demo");
      if (r.dead > 0) break;
      const [evt] = await t.repos.outboxEvents.list("demo");
      if (evt && evt.status === "PENDING") {
        await t.repos.outboxEvents.put({ ...evt, nextAttemptAt: new Date(0).toISOString() });
      }
    }
    const dead = await t.services.outbox.listDead("demo");
    expect(dead.length).toBe(1);
    expect(dead[0]!.status).toBe("DEAD");
    expect(dead[0]!.attempts).toBe(6);

    // recovery: stop failing, redeliver, deliver succeeds
    failures.n = 0;
    const ok = await t.services.outbox.redeliver("demo", dead[0]!.id);
    expect(ok).toBe(true);
    const r = await t.services.outbox.processOnce("demo");
    expect(r.delivered).toBe(1);
    expect(await t.services.outbox.listDead("demo")).toHaveLength(0);
  });

  it("per-aggregate ordering: a failed head blocks later seq in the same aggregate", async () => {
    const failures = { n: 1 }; // first delivery fails, rest succeed
    const t = await failingApp(failures);
    await registerHook(t);
    await t.services.outbox.emit("demo", "action.pending_approval", { draftId: "d1" }, "act-d1");
    await t.services.outbox.emit("demo", "action.approved", { draftId: "d1" }, "act-d1");

    // first pass: head (seq0) fails and is rescheduled; seq1 must NOT be delivered
    const r1 = await t.services.outbox.processOnce("demo");
    expect(r1.delivered).toBe(0);
    const afterFirst = await t.repos.outboxEvents.list("demo", (e) => e.status === "DELIVERED");
    expect(afterFirst).toHaveLength(0);

    // force head due; second pass delivers seq0
    const pending = await t.repos.outboxEvents.list("demo", (e) => e.status === "PENDING");
    const head = pending.sort((a, b) => a.seq - b.seq)[0]!;
    await t.repos.outboxEvents.put({ ...head, nextAttemptAt: new Date(0).toISOString() });
    const r2 = await t.services.outbox.processOnce("demo");
    expect(r2.delivered).toBe(1);
    // third pass delivers seq1
    const r3 = await t.services.outbox.processOnce("demo");
    expect(r3.delivered).toBe(1);
  });
});

describe("execution semantics — admin endpoints", () => {
  it("dead-letter + exec-lock endpoints are admin-only", async () => {
    const t = await makeApp();
    const denied = await t.app.inject({ method: "GET", url: "/a/v1/outbox/dead", headers: PLANNER });
    expect(denied.statusCode).toBe(403);
    const ok = await t.app.inject({ method: "GET", url: "/a/v1/outbox/dead", headers: ADMIN });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ items: [] });

    await t.services.execLocks.acquire("demo", "replay", "r1", "h1");
    const locks = await t.app.inject({ method: "GET", url: "/a/v1/exec-locks", headers: ADMIN });
    expect(locks.statusCode).toBe(200);
    const items = locks.json().items as Array<{ resourceKind: string; active: boolean }>;
    expect(items.some((l) => l.resourceKind === "replay" && l.active)).toBe(true);
  });

  it("redeliver returns 404 for unknown id", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/outbox/nope/redeliver", headers: ADMIN });
    expect(res.statusCode).toBe(404);
  });
});
