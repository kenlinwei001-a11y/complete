import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN, createTestApp, debugHeaders, lastToolCallId, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

async function produceFallbackTrace(): Promise<string> {
  t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
  t.llm.queueAgentTurn(
    { content: [toolUse("query_objects", { objectType: "Base", filter: {} })] },
    (req) => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "对比完成 ⟦ref:0⟧。" }],
          provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.data.items" }],
        }),
      ],
    }),
  );
  const { taskId } = await submitQuery(t, PLANNER, "对比一下储能基地和动力基地的平均利用率 20%", { view: "dash" });
  await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
  const trace = await t.repos.fallbackTraces.getByTask(taskId);
  return trace?.id as string;
}

describe("Ops incubation loop (§12 E1) & publish validation (E2)", () => {
  it("E1: fallback-stats clusters; promote → DRAFT skeleton; publish rejected (slots empty)", async () => {
    const traceId = await produceFallbackTrace();

    const stats = await t.app.inject({
      method: "GET",
      url: `/api/v1/ops/fallback-stats?packageId=${encodeURIComponent("pkg_battery_manufacturing")}`,
      headers: debugHeaders(ADMIN),
    });
    expect(stats.statusCode).toBe(200);
    const items = (stats.json() as { items: { querySample: string; count: number; topToolSketch: unknown[] }[] }).items;
    expect(items.length).toBe(1);
    expect(items[0]?.count).toBe(1);
    expect(items[0]?.topToolSketch.length).toBeGreaterThan(0);

    const promote = await t.app.inject({
      method: "POST",
      url: `/api/v1/ops/fallback/${traceId}/promote`,
      headers: debugHeaders(ADMIN),
    });
    expect(promote.statusCode).toBe(201);
    const { intentId, planId } = promote.json() as { intentId: string; planId: string };

    const intent = await t.repos.intents.get(intentId);
    expect(intent?.status).toBe("DRAFT");
    expect(intent?.slots).toEqual([]); // 留空待人工补全
    expect(intent?.examples).toEqual(["对比一下储能基地和动力基地的平均利用率 20%"]);
    const plan = await t.repos.plans.get(planId);
    expect(plan?.status).toBe("DRAFT");
    expect(plan?.steps.some((s) => s.type === "query_objects")).toBe(true);
    expect(plan?.steps[plan.steps.length - 1]?.type).toBe("render_answer");

    // publish must fail with a clear slots-empty message
    const publish = await t.app.inject({
      method: "POST",
      url: `/api/v1/catalog/intents/${intentId}/publish`,
      headers: debugHeaders(ADMIN),
    });
    expect(publish.statusCode).toBe(400);
    const err = (publish.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("PLAN_VALIDATION_ERROR");
    expect(err.message).toContain("slots 为空");
  });

  it("E2: forward ref / render_answer not last / ACTION_DRAFT escalation → PLAN_VALIDATION_ERROR", async () => {
    // ① forward reference
    const p1 = await t.app.inject({
      method: "POST",
      url: "/api/v1/catalog/packages/pkg_battery_manufacturing/plans",
      headers: debugHeaders(ADMIN),
      payload: {
        key: "bad_forward_ref",
        steps: [
          { id: "s1", type: "query_objects", params: { objectType: "Base", filter: { x: "{{steps.s2.output.data}}" } } },
          { id: "s2", type: "query_objects", params: { objectType: "Order", filter: {} } },
          { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "ok" }] } },
        ],
      },
    });
    expect(p1.statusCode).toBe(201);
    const plan1 = p1.json() as { id: string };
    const pub1 = await t.app.inject({
      method: "POST",
      url: `/api/v1/catalog/plans/${plan1.id}/publish`,
      headers: debugHeaders(ADMIN),
    });
    expect(pub1.statusCode).toBe(400);
    expect((pub1.json() as { error: { code: string } }).error.code).toBe("PLAN_VALIDATION_ERROR");

    // ② render_answer not last
    const p2 = await t.app.inject({
      method: "POST",
      url: "/api/v1/catalog/packages/pkg_battery_manufacturing/plans",
      headers: debugHeaders(ADMIN),
      payload: {
        key: "bad_render_position",
        steps: [
          { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "ok" }] } },
          { id: "s1", type: "query_objects", params: { objectType: "Base", filter: {} } },
        ],
      },
    });
    expect(p2.statusCode).toBe(201);
    const pub2 = await t.app.inject({
      method: "POST",
      url: `/api/v1/catalog/plans/${(p2.json() as { id: string }).id}/publish`,
      headers: debugHeaders(ADMIN),
    });
    expect(pub2.statusCode).toBe(400);
    expect((pub2.json() as { error: { code: string } }).error.code).toBe("PLAN_VALIDATION_ERROR");

    // ③ ACTION_DRAFT escalation: plan with create_action_draft bound to a COMPUTE intent
    const p3 = await t.app.inject({
      method: "POST",
      url: "/api/v1/catalog/packages/pkg_battery_manufacturing/plans",
      headers: debugHeaders(ADMIN),
      payload: {
        key: "escalating_plan",
        steps: [
          { id: "s1", type: "create_action_draft", params: { actionType: "x", payload: {} } },
          { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "ok" }] } },
        ],
      },
    });
    const plan3 = p3.json() as { id: string };
    const pub3 = await t.app.inject({
      method: "POST",
      url: `/api/v1/catalog/plans/${plan3.id}/publish`,
      headers: debugHeaders(ADMIN),
    });
    expect(pub3.statusCode).toBe(200); // plan-level OK（riskLevel 在意图发布时校验）

    const i3 = await t.app.inject({
      method: "POST",
      url: "/api/v1/catalog/packages/pkg_battery_manufacturing/intents",
      headers: debugHeaders(ADMIN),
      payload: {
        key: "escalating_intent",
        name: "越级意图",
        description: "测试 ACTION_DRAFT 越级",
        examples: ["测试"],
        enabledViews: "*",
        slots: [{ name: "x", type: "string", required: false, description: "x" }],
        planId: plan3.id,
        riskLevel: "COMPUTE",
        owner: "test",
      },
    });
    expect(i3.statusCode).toBe(201);
    const pub4 = await t.app.inject({
      method: "POST",
      url: `/api/v1/catalog/intents/${(i3.json() as { id: string }).id}/publish`,
      headers: debugHeaders(ADMIN),
    });
    expect(pub4.statusCode).toBe(400);
    const err = (pub4.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("PLAN_VALIDATION_ERROR");
    expect(err.message).toContain("create_action_draft");
  });

  it("catalog endpoints require catalog_admin", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/catalog/packages/pkg_battery_manufacturing/plans",
      headers: debugHeaders(PLANNER),
      payload: { key: "x", steps: [{ id: "r", type: "render_answer", params: { blocks: [] } }] },
    });
    expect(res.statusCode).toBe(401);
  });
});
