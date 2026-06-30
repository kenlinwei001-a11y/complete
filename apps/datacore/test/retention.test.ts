import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser } from "./helpers.js";
import { RETENTION_DEFAULTS } from "@platform/contracts";
import type { OutboxEvent, SchedulerRunRecord, TsPointRecord } from "../src/domain.js";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function evt(tenantId: string, id: string, status: OutboxEvent["status"], createdAt: string): OutboxEvent {
  return {
    id,
    tenantId,
    eventId: id,
    event: "test.event",
    aggregateKey: id,
    seq: 0,
    payload: {},
    status,
    attempts: 0,
    nextAttemptAt: createdAt,
    createdAt,
  };
}

describe("WO-RETENTION：数据留存/TTL（RETENTION_SWEEP·R2）", () => {
  it("outbox keepDays=0 sweep：旧 DISPATCHED 真删、PENDING 保留；未配 policy 表不动；R2 不跨租户删", async () => {
    const t = await makeApp();
    const now = Date.now();
    const old = iso(now - 5 * DAY);

    // demo 租户：2 已投递（DELIVERED+DEAD）+ 1 PENDING + 1 FAILED（重试中）。
    await t.repos.outboxEvents.put(evt("demo", "evt_d1", "DELIVERED", old));
    await t.repos.outboxEvents.put(evt("demo", "evt_d2", "DEAD", old));
    await t.repos.outboxEvents.put(evt("demo", "evt_p1", "PENDING", old));
    await t.repos.outboxEvents.put(evt("demo", "evt_f1", "FAILED", old));
    // 另一租户：同样有旧 DELIVERED —— 跑 demo 的 sweep 绝不能碰它（R2）。
    await t.repos.outboxEvents.put(evt("other", "evt_o1", "DELIVERED", old));

    // outbox keepDays=0（now 之前皆过期）。
    const put = await t.app.inject({
      method: "PUT",
      url: "/a/v1/retention-policies",
      headers: ADMIN,
      payload: { table: "outbox_events", keepDays: 0 },
    });
    expect(put.statusCode).toBe(200);

    const before = (await t.app.inject({ method: "GET", url: "/a/v1/outbox", headers: ADMIN })).json() as {
      eventId: string;
      status: string;
    }[];
    expect(before).toHaveLength(4);

    const res = (await t.services.retention.sweep("demo", new Date(now))).byTable;
    expect(res.outbox_events).toBe(2); // 删 DELIVERED + DEAD

    const after = (await t.app.inject({ method: "GET", url: "/a/v1/outbox", headers: ADMIN })).json() as {
      eventId: string;
      status: string;
    }[];
    // 计数降：4 → 2（GET /a/v1/outbox 计数降）。
    expect(after).toHaveLength(2);
    const ids = after.map((e) => e.eventId).sort();
    expect(ids).toEqual(["evt_f1", "evt_p1"]); // PENDING + FAILED 保留（未投递不删）
    // R2：另一租户的旧 DELIVERED 未被碰。
    expect(await t.repos.outboxEvents.get("other", "evt_o1")).toBeDefined();
  });

  it("ts_points / scheduler_runs 按时间删旧；RUNNING 不删", async () => {
    const t = await makeApp();
    const now = Date.now();
    const oldTs = iso(now - 400 * DAY); // 超出 ts 默认 365d
    const freshTs = iso(now - 10 * DAY);

    const pts: TsPointRecord[] = [
      { seriesId: "s1", entityId: "e1", ts: oldTs, values: { v: 1 }, ingestedAt: oldTs },
      { seriesId: "s1", entityId: "e1", ts: freshTs, values: { v: 2 }, ingestedAt: freshTs },
    ];
    await t.repos.tsPoints.upsert("demo", pts);

    const oldRun = (n: string, status: SchedulerRunRecord["status"], at: string): SchedulerRunRecord => ({
      id: n,
      tenantId: "demo",
      jobId: "job1",
      scheduledAt: at,
      status,
    });
    const oldAt = iso(now - 200 * DAY); // 超出 scheduler_runs 默认 90d
    await t.repos.schedulerRuns.put(oldRun("run_done", "SUCCEEDED", oldAt));
    await t.repos.schedulerRuns.put(oldRun("run_run", "RUNNING", oldAt)); // RUNNING 不删
    await t.repos.schedulerRuns.put(oldRun("run_fresh", "SUCCEEDED", iso(now - 1 * DAY)));

    // 用默认 keepDays（ts=365·scheduler_runs=90）。
    const res = (await t.services.retention.sweep("demo", new Date(now))).byTable;
    expect(res.ts_points).toBe(1);
    expect(res.scheduler_runs).toBe(1);

    expect(await t.repos.tsPoints.count("demo", "s1")).toBe(1);
    expect(await t.repos.schedulerRuns.get("demo", "run_done")).toBeUndefined();
    expect(await t.repos.schedulerRuns.get("demo", "run_run")).toBeDefined(); // RUNNING 保留
    expect(await t.repos.schedulerRuns.get("demo", "run_fresh")).toBeDefined();
  });

  it("PAUSED 策略跳过该表（不删·向后兼容）；metric dc_retention_purged_total 累加", async () => {
    const t = await makeApp();
    const now = Date.now();
    await t.repos.outboxEvents.put(evt("demo", "evt_d1", "DELIVERED", iso(now - 5 * DAY)));

    await t.app.inject({
      method: "PUT",
      url: "/a/v1/retention-policies",
      headers: ADMIN,
      payload: { table: "outbox_events", keepDays: 0, status: "PAUSED" },
    });
    const paused = (await t.services.retention.sweep("demo", new Date(now))).byTable;
    expect(paused.outbox_events).toBe(0);
    expect(await t.repos.outboxEvents.get("demo", "evt_d1")).toBeDefined();

    // 改回 ACTIVE → 删 + metric 计数。
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/retention-policies",
      headers: ADMIN,
      payload: { table: "outbox_events", keepDays: 0, status: "ACTIVE" },
    });
    await t.services.retention.sweep("demo", new Date(now));
    expect(t.services.metrics.get("dc_retention_purged_total", { table: "outbox_events" })).toBe(1);
  });

  it("GET /a/v1/retention-policies 返回覆盖∪默认；非 admin 403", async () => {
    const t = await makeApp();
    const list = (await t.app.inject({ method: "GET", url: "/a/v1/retention-policies", headers: ADMIN })).json() as {
      policies: { table: string; keepDays: number; status: string }[];
      defaults: Record<string, number>;
    };
    expect(list.policies.map((p) => p.table).sort()).toEqual(["outbox_events", "scheduler_runs", "ts_points"]);
    const outbox = list.policies.find((p) => p.table === "outbox_events")!;
    expect(outbox.keepDays).toBe(RETENTION_DEFAULTS.outbox_events);
    expect(list.defaults.ts_points).toBe(RETENTION_DEFAULTS.ts_points);

    const planner = await t.app.inject({
      method: "GET",
      url: "/a/v1/retention-policies",
      headers: debugUser("demo", "planner", "planner"),
    });
    expect(planner.statusCode).toBe(403);
  });

  it("RETENTION_SWEEP 经调度器 tick 真跑（handler 接线）", async () => {
    const t = await makeApp();
    const now = Date.now();
    await t.repos.outboxEvents.put(evt("demo", "evt_d1", "DELIVERED", iso(now - 5 * DAY)));
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/retention-policies",
      headers: ADMIN,
      payload: { table: "outbox_events", keepDays: 0 },
    });
    // 注册 RETENTION_SWEEP 每日 cron（真启动经 synthetic.runJob 注册；此处 makeApp 轻量 seed 故手动注册），把它拨到 due 后 tick。
    await t.services.scheduler.register("demo", "RETENTION_SWEEP", "tenant", "0 4 * * *");
    const jobs = await t.services.scheduler.listJobs("demo", "RETENTION_SWEEP");
    expect(jobs).toHaveLength(1);
    const job = (await t.repos.scheduledJobs.get("demo", jobs[0]!.id))!;
    job.nextRunAt = iso(now - 1000);
    await t.repos.scheduledJobs.put(job);
    const r = await t.services.scheduler.tick();
    expect(r.executed).toBe(1);
    expect(await t.repos.outboxEvents.get("demo", "evt_d1")).toBeUndefined();
  });
});
