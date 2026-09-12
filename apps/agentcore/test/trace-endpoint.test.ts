import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, submitQuery, waitForTask, PLANNER, type TestApp } from "./helpers.js";
import { InferenceTraceSchema } from "@platform/contracts";

// GET /api/v1/queries/:taskId/trace（PRD-IND-story §5）：真实任务投影 + tenant 隔离 + /b/v1 别名。

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("GET /queries/:taskId/trace", () => {
  it("把真实 QueryTask 投影为 10 节点编排 DAG（schema 合法 + 12 边）", async () => {
    const { taskId } = await submitQuery(t, PLANNER, "常州工厂的产能瓶颈在哪里？");
    await waitForTask(t, taskId);
    const res = await t.app.inject({ method: "GET", url: `/api/v1/queries/${taskId}/trace`, headers: debugHeaders(PLANNER) });
    expect(res.statusCode).toBe(200);
    const trace = InferenceTraceSchema.parse(res.json());
    expect(trace.taskId).toBe(taskId);
    expect(trace.nodes).toHaveLength(10);
    expect(trace.edges).toHaveLength(12);
    expect(trace.scenario).toBe("常州工厂的产能瓶颈在哪里？");
    // ① 解析场景应已达成（分类一定跑过）
    expect(trace.nodes.find((n) => n.id === 1)!.status).not.toBe("pending");
    // ⑩ 执行回采无同步步骤 → 诚实 pending
    expect(trace.nodes.find((n) => n.id === 10)!.status).toBe("pending");
  });

  it("/b/v1 别名等价", async () => {
    const { taskId } = await submitQuery(t, PLANNER, "常州工厂的产能瓶颈在哪里？");
    await waitForTask(t, taskId);
    const res = await t.app.inject({ method: "GET", url: `/b/v1/queries/${taskId}/trace`, headers: debugHeaders(PLANNER) });
    expect(res.statusCode).toBe(200);
    expect(InferenceTraceSchema.parse(res.json()).taskId).toBe(taskId);
  });

  it("跨租户 → 404 TASK_NOT_FOUND", async () => {
    const { taskId } = await submitQuery(t, PLANNER, "常州工厂的产能瓶颈在哪里？");
    await waitForTask(t, taskId);
    const res = await t.app.inject({ method: "GET", url: `/api/v1/queries/${taskId}/trace`, headers: debugHeaders("other-tenant:user-x:planner") });
    expect(res.statusCode).toBe(404);
  });

  it("确定性：同任务两次投影字节级一致（R6）", async () => {
    const { taskId } = await submitQuery(t, PLANNER, "常州工厂的产能瓶颈在哪里？");
    await waitForTask(t, taskId);
    const h = debugHeaders(PLANNER);
    const a = (await t.app.inject({ method: "GET", url: `/api/v1/queries/${taskId}/trace`, headers: h })).body;
    const b = (await t.app.inject({ method: "GET", url: `/api/v1/queries/${taskId}/trace`, headers: h })).body;
    expect(a).toBe(b);
  });
});
