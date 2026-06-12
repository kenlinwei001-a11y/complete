import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";

describe("S3 scheduler (V10)", () => {
  it("V10: connection with cron auto-registers; concurrent double-tick executes once; pause; MISSED", async () => {
    const t = await makeApp();
    // creating a connection with schedule.cron auto-registers a CONNECTOR_SYNC job
    const conn = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/connections",
        headers: ADMIN,
        payload: { connectorTypeKey: "mock_erp", name: "erp", config: {}, schedule: { cron: "* * * * *" } },
      })
    ).json() as { id: string };
    const jobs = (
      await t.app.inject({ method: "GET", url: "/a/v1/scheduler/jobs?kind=CONNECTOR_SYNC", headers: ADMIN })
    ).json() as { id: string; refId: string; status: string; nextRunAt: string }[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.refId).toBe(conn.id);
    expect(jobs[0]!.status).toBe("ACTIVE");
    const jobId = jobs[0]!.id;

    // make the job due NOW (within the missed grace window) and tick twice concurrently
    const job = (await t.repos.scheduledJobs.get("demo", jobId))!;
    job.nextRunAt = new Date(Date.now() - 1000).toISOString();
    await t.repos.scheduledJobs.put(job);
    const syncBefore = (await t.repos.syncJobs.list("demo")).length;
    const [r1, r2] = await Promise.all([t.services.scheduler.tick(), t.services.scheduler.tick()]);
    // SKIP-LOCKED-equivalent claim: exactly one tick executed the job
    expect(r1.executed + r2.executed).toBe(1);
    const syncAfter = (await t.repos.syncJobs.list("demo")).length;
    expect(syncAfter - syncBefore).toBe(1);
    const runs1 = (
      await t.app.inject({ method: "GET", url: `/a/v1/scheduler/jobs/${jobId}/runs`, headers: ADMIN })
    ).json() as { status: string; scheduledAt: string }[];
    expect(runs1.filter((r) => r.status === "SUCCEEDED")).toHaveLength(1);

    // idempotency key (jobId, scheduledAt): re-delivering the same occurrence is skipped
    const claimedAt = runs1[0]!.scheduledAt;
    const j2 = (await t.repos.scheduledJobs.get("demo", jobId))!;
    j2.nextRunAt = claimedAt;
    await t.repos.scheduledJobs.put(j2);
    const r3 = await t.services.scheduler.tick();
    expect(r3.executed).toBe(0);
    expect(r3.skipped).toBe(1);

    // pause → due job is not claimed
    await t.app.inject({ method: "POST", url: `/a/v1/scheduler/jobs/${jobId}/pause`, headers: ADMIN });
    const paused = (await t.repos.scheduledJobs.get("demo", jobId))!;
    paused.nextRunAt = new Date(Date.now() - 1000).toISOString();
    await t.repos.scheduledJobs.put(paused);
    const r4 = await t.services.scheduler.tick();
    expect(r4.executed + r4.missed + r4.skipped).toBe(0);

    // resume + overdue beyond the grace window → MISSED history, no backfill
    await t.app.inject({ method: "POST", url: `/a/v1/scheduler/jobs/${jobId}/resume`, headers: ADMIN });
    const resumed = (await t.repos.scheduledJobs.get("demo", jobId))!;
    resumed.nextRunAt = new Date(Date.now() - 10 * 60_000).toISOString();
    await t.repos.scheduledJobs.put(resumed);
    const syncBeforeMissed = (await t.repos.syncJobs.list("demo")).length;
    const r5 = await t.services.scheduler.tick();
    expect(r5.missed).toBe(1);
    expect(r5.executed).toBe(0);
    expect((await t.repos.syncJobs.list("demo")).length).toBe(syncBeforeMissed); // not backfilled
    const runs2 = (
      await t.app.inject({ method: "GET", url: `/a/v1/scheduler/jobs/${jobId}/runs`, headers: ADMIN })
    ).json() as { status: string }[];
    expect(runs2.some((r) => r.status === "MISSED")).toBe(true);

    // PATCH connection schedule null → CONNECTOR_SYNC job unregistered
    await t.app.inject({
      method: "PATCH",
      url: `/a/v1/connections/${conn.id}`,
      headers: ADMIN,
      payload: { schedule: null },
    });
    const after = (
      await t.app.inject({ method: "GET", url: "/a/v1/scheduler/jobs?kind=CONNECTOR_SYNC", headers: ADMIN })
    ).json() as unknown[];
    expect(after).toHaveLength(0);
  });

  it("synthetic job registers tenant-default DERIVATION_FULL / RULE_SCAN / TS_AGGREGATE jobs", async () => {
    const t = await makeApp();
    await t.app.inject({
      method: "POST",
      url: "/a/v1/synthetic/jobs",
      headers: ADMIN,
      payload: { industry: "battery-manufacturing", scale: "S", seed: 42 },
    });
    const jobs = (
      await t.app.inject({ method: "GET", url: "/a/v1/scheduler/jobs", headers: ADMIN })
    ).json() as { kind: string }[];
    const kinds = jobs.map((j) => j.kind);
    expect(kinds).toEqual(expect.arrayContaining(["DERIVATION_FULL", "RULE_SCAN", "TS_AGGREGATE"]));
  });
});
