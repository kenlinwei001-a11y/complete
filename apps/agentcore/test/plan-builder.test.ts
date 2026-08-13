import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, PKG, TENANT } from "./helpers.js";

const headers = (user: string) => ({ "x-debug-user": encodeURIComponent(user), "content-type": "application/json" });

function validDSL() {
  return {
    version: "1" as const,
    nodes: [
      { id: "n1", type: "INPUT" as const, label: "输入", position: { x: 0, y: 0 }, outputSchema: { type: "object" as const, properties: { modelId: { type: "string" } } } },
      { id: "n2", type: "SOLVER" as const, label: "产能推演", position: { x: 100, y: 0 }, solverKey: "capacity_forecast", args: { modelId: "4680-NCM", qty: 1000 } },
      { id: "n3", type: "OUTPUT" as const, label: "输出", position: { x: 200, y: 0 }, blocks: [{ type: "text", markdown: "result" }] },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2" },
      { id: "e2", from: "n2", to: "n3" },
    ],
  };
}

describe("WO-A · Plan Builder backend", () => {
  it("创建画布并 round-trip 编译为 ExecutionPlan", async () => {
    const t = await createTestApp();
    const dsl = validDSL();
    const create = await t.app.inject({
      method: "POST",
      url: `/b/v1/plan-builders?packageId=${PKG}`,
      headers: headers(ADMIN),
      payload: { key: "roundtrip", name: "Roundtrip", dsl },
    });
    expect(create.statusCode).toBe(201);
    const canvas = create.json();
    const id = canvas.id as string;

    const compile = await t.app.inject({
      method: "POST",
      url: `/b/v1/plan-builders/${id}/compile`,
      headers: headers(ADMIN),
    });
    expect(compile.statusCode).toBe(200);
    const result = compile.json();
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    const steps = result.plan.steps;
    expect(steps).toHaveLength(2);
    expect(steps[0].type).toBe("invoke_solver");
    expect(steps[0].params.solverKey).toBe("capacity_forecast");
    expect(steps[1].type).toBe("render_answer");
  });

  it("检测画布中环", async () => {
    const t = await createTestApp();
    const dsl = {
      version: "1" as const,
      nodes: [
        { id: "a", type: "SOLVER" as const, label: "A", position: { x: 0, y: 0 }, solverKey: "capacity_forecast", args: {} },
        { id: "b", type: "SOLVER" as const, label: "B", position: { x: 100, y: 0 }, solverKey: "affected_orders", args: {} },
        { id: "c", type: "OUTPUT" as const, label: "C", position: { x: 200, y: 0 }, blocks: [] },
      ],
      edges: [
        { id: "e1", from: "a", to: "b" },
        { id: "e2", from: "b", to: "c" },
        { id: "e3", from: "c", to: "a" },
      ],
    };
    const create = await t.app.inject({
      method: "POST",
      url: `/b/v1/plan-builders?packageId=${PKG}`,
      headers: headers(ADMIN),
      payload: { key: "cycle", name: "Cycle", dsl },
    });
    const id = create.json().id as string;
    const compile = await t.app.inject({
      method: "POST",
      url: `/b/v1/plan-builders/${id}/compile`,
      headers: headers(ADMIN),
    });
    expect(compile.statusCode).toBe(200);
    const result = compile.json();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: { code: string }) => e.code === "CYCLIC_GRAPH")).toBe(true);
  });

  it("缺失 OUTPUT 节点返回 PLAN_VALIDATION_ERROR", async () => {
    const t = await createTestApp();
    const dsl = {
      version: "1" as const,
      nodes: [
        { id: "n1", type: "INPUT" as const, label: "输入", position: { x: 0, y: 0 } },
        { id: "n2", type: "SOLVER" as const, label: "求解器", position: { x: 100, y: 0 }, solverKey: "capacity_forecast", args: {} },
      ],
      edges: [{ id: "e1", from: "n1", to: "n2" }],
    };
    const create = await t.app.inject({
      method: "POST",
      url: `/b/v1/plan-builders?packageId=${PKG}`,
      headers: headers(ADMIN),
      payload: { packageId: PKG, key: "no-output", name: "No Output", dsl },
    });
    const id = create.json().id as string;
    const compile = await t.app.inject({
      method: "POST",
      url: `/b/v1/plan-builders/${id}/compile`,
      headers: headers(ADMIN),
    });
    const result = compile.json();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: { code: string; message: string }) => e.code === "PLAN_VALIDATION_ERROR" && e.message.includes("render_answer"))).toBe(true);
  });

  it("CONDITION 节点返回 UNSUPPORTED_NODE_TYPE", async () => {
    const t = await createTestApp();
    const dsl = {
      version: "1" as const,
      nodes: [
        { id: "n1", type: "INPUT" as const, label: "输入", position: { x: 0, y: 0 } },
        { id: "n2", type: "CONDITION" as const, label: "条件", position: { x: 100, y: 0 }, expr: "x > 0" },
        { id: "n3", type: "OUTPUT" as const, label: "输出", position: { x: 200, y: 0 }, blocks: [] },
      ],
      edges: [{ id: "e1", from: "n1", to: "n2" }, { id: "e2", from: "n2", to: "n3" }],
    };
    const create = await t.app.inject({
      method: "POST",
      url: `/b/v1/plan-builders?packageId=${PKG}`,
      headers: headers(ADMIN),
      payload: { packageId: PKG, key: "cond", name: "Condition", dsl },
    });
    const id = create.json().id as string;
    const compile = await t.app.inject({
      method: "POST",
      url: `/b/v1/plan-builders/${id}/compile`,
      headers: headers(ADMIN),
    });
    const result = compile.json();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: { code: string; nodeId?: string }) => e.code === "UNSUPPORTED_NODE_TYPE" && e.nodeId === "n2")).toBe(true);
  });

  it("发布画布创建已发布 ExecutionPlan", async () => {
    const t = await createTestApp();
    const dsl = validDSL();
    const create = await t.app.inject({
      method: "POST",
      url: `/b/v1/plan-builders?packageId=${PKG}`,
      headers: headers(ADMIN),
      payload: { packageId: PKG, key: "publish-me", name: "Publish", dsl },
    });
    const id = create.json().id as string;
    const publish = await t.app.inject({
      method: "POST",
      url: `/b/v1/plan-builders/${id}/publish`,
      headers: headers(ADMIN),
      payload: {},
    });
    expect(publish.statusCode).toBe(200);
    const result = publish.json();
    expect(result.ok).toBe(true);
    expect(result.canvas.compiledPlanId).toBeTruthy();
    const plan = await t.repos.plans.get(result.canvas.compiledPlanId as string);
    expect(plan).toBeDefined();
    expect(plan!.status).toBe("PUBLISHED");
    expect(plan!.steps[plan!.steps.length - 1].type).toBe("render_answer");
  });

  it("admin.plan-builder 关闭时路由返回 404 FEATURE_NOT_FOUND", async () => {
    const t = await createTestApp();
    t.deps.features.mock.disable(TENANT, "admin.plan-builder");
    const res = await t.app.inject({
      method: "GET",
      url: `/b/v1/plan-builders?packageId=${PKG}`,
      headers: headers(ADMIN),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("FEATURE_NOT_FOUND");
  });
});
