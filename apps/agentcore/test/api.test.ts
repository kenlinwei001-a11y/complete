import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("ops endpoints & error envelope", () => {
  it("healthz / readyz / metrics", async () => {
    expect((await t.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    const ready = await t.app.inject({ method: "GET", url: "/readyz" });
    expect(ready.statusCode).toBe(200);
    expect((ready.json() as { dataCoreReachable: unknown }).dataCoreReachable).toBe("unknown");

    // run one path-A task so metrics are populated
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, PLANNER, "影响哪些订单？", {
      view: "risk",
      selectedObjects: [{ objectType: "Base", objectId: "base_changzhou", label: "常州" }],
    });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const metrics = await t.app.inject({ method: "GET", url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    const text = metrics.body;
    expect(text).toContain('qos_tasks_total{path="WORKFLOW",status="COMPLETED"} 1');
    expect(text).toContain("qos_path_a_hit_ratio 1");
    expect(text).toContain("qos_classifier_latency_ms_count 1");
    expect(text).toContain("qos_tool_calls_total");
    expect(text).toContain("ac_nested_invocations_total");
    expect(text).toContain("ac_obo_denied_total");
  });

  it("missing credentials → 401 envelope; unknown package → 404 PACKAGE_NOT_FOUND", async () => {
    const noAuth = await t.app.inject({
      method: "POST",
      url: "/api/v1/queries",
      headers: { "content-type": "application/json" },
      payload: { packageId: "pkg_x", query: "hi", context: { view: "dash", selectedObjects: [], filters: {} } },
    });
    expect(noAuth.statusCode).toBe(401);
    expect((noAuth.json() as { error: { code: string; requestId?: string } }).error.code).toBe("UNAUTHORIZED");

    const notFound = await t.app.inject({
      method: "POST",
      url: "/api/v1/queries",
      headers: debugHeaders(PLANNER),
      payload: { packageId: "pkg_missing", query: "hi", context: { view: "dash", selectedObjects: [], filters: {} } },
    });
    expect(notFound.statusCode).toBe(404);
    expect((notFound.json() as { error: { code: string } }).error.code).toBe("PACKAGE_NOT_FOUND");

    const invalid = await t.app.inject({
      method: "POST",
      url: "/api/v1/queries",
      headers: debugHeaders(PLANNER),
      payload: { packageId: "pkg_battery_manufacturing" }, // missing query/context
    });
    expect(invalid.statusCode).toBe(400);
    expect((invalid.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("OBO token expiring in <60s → tool call refused, ac_obo_denied_total++", async () => {
    const executor = t.deps.engine.makeExecutor("task_obo", {
      tenantId: "tenant-demo",
      userId: "u1",
      roles: ["planner"],
      token: "x.y.z",
      tokenExpiresAt: Math.floor(Date.now() / 1000) + 30, // expires in 30s
    });
    const r = await executor.run("query_objects", { objectType: "Base", filter: {} });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("DENIED");
    expect((r.payload as { error: string }).error).toBe("OBO_TOKEN_EXPIRING");
    expect(t.metrics.oboDenied.get()).toBe(1);
  });

  it("cancel: pending clarification task → CANCELLED + task.cancelled event", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, PLANNER, "影响哪些订单？", { view: "risk", selectedObjects: [] });
    await waitForTask(t, taskId, (x) => x.status === "AWAITING_CLARIFICATION");
    const res = await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/cancel`,
      headers: debugHeaders(PLANNER),
    });
    expect(res.statusCode).toBe(202);
    const task = await waitForTask(t, taskId, (x) => x.status === "CANCELLED");
    expect(task.status).toBe("CANCELLED");
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(events[events.length - 1]?.event).toBe("task.cancelled");
  });

  it("scenario launch: uses body.query when provided, otherwise falls back to triggerQuestion", async () => {
    const launch = (key: string, body: { query?: string }) =>
      t.app.inject({
        method: "POST",
        url: `/b/v1/scenarios/${key}/launch`,
        headers: debugHeaders(PLANNER),
        payload: body,
      });

    // Without body.query → falls back to card.triggerQuestion
    const fallback = await launch("S01", {});
    expect(fallback.statusCode).toBe(202);
    const fallbackBody = fallback.json() as { taskId: string };
    const fallbackTask = await t.repos.tasks.get(fallbackBody.taskId);
    expect(fallbackTask?.query).toBe("4680-NCM 加 20% 六周能不能接？");

    // With body.query → uses user-provided query
    const userQuery = "4680-NCM 1天交付";
    const custom = await launch("S01", { query: userQuery });
    expect(custom.statusCode).toBe(202);
    const customBody = custom.json() as { taskId: string };
    const customTask = await t.repos.tasks.get(customBody.taskId);
    expect(customTask?.query).toBe(userQuery);
  });
});
