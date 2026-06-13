import { describe, expect, it } from "vitest";
import type { QueryTask } from "@platform/contracts";
import { createTestApp, PKG, PLANNER, TENANT, type TestApp } from "./helpers.js";

/** Insert an already-running task on a conversation so a new submit can supersede it. */
async function seedActiveTask(t: TestApp, conversationId: string): Promise<string> {
  const id = `task_active_${conversationId}`;
  const task: QueryTask = {
    id,
    tenantId: TENANT,
    userId: "user-planner",
    packageId: PKG,
    conversationId,
    query: "第一问：为什么常州越线",
    context: { view: "risk", selectedObjects: [], filters: {}, conversationId },
    status: "EXECUTING_AGENT",
    clarificationRounds: 0,
    createdAt: new Date().toISOString(),
  };
  await t.repos.tasks.insert(task);
  return id;
}

function submit(t: TestApp, conversationId: string, keepPrevious?: boolean) {
  return t.app.inject({
    method: "POST",
    url: "/api/v1/queries",
    headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
    payload: {
      packageId: PKG,
      query: "第二问：给我处置方案",
      context: { view: "risk", selectedObjects: [], filters: {}, conversationId },
      ...(keepPrevious !== undefined ? { keepPrevious } : {}),
    },
  });
}

describe("并发一致性 §13.2 — 代次取消（CC3）", () => {
  it("同会话提交新任务 → 仍在执行的旧任务被取消（reason SUPERSEDED），指标 +1", async () => {
    const t = await createTestApp();
    const conv = "conv_supersede_1";
    const oldId = await seedActiveTask(t, conv);

    const res = await submit(t, conv);
    expect(res.statusCode).toBe(202);

    const old = await t.repos.tasks.get(oldId);
    expect(old?.status).toBe("CANCELLED");
    expect(t.metrics.tasksCancelled.get({ reason: "SUPERSEDED" })).toBe(1);
  });

  it("keepPrevious=true → 旧任务保留并行，不取消", async () => {
    const t = await createTestApp();
    const conv = "conv_keep_1";
    const oldId = await seedActiveTask(t, conv);

    const res = await submit(t, conv, true);
    expect(res.statusCode).toBe(202);

    const old = await t.repos.tasks.get(oldId);
    expect(old?.status).toBe("EXECUTING_AGENT"); // untouched
    expect(t.metrics.tasksCancelled.get({ reason: "SUPERSEDED" })).toBe(0);
  });

  it("终态任务不受影响：已 COMPLETED 的同会话任务不会被改写", async () => {
    const t = await createTestApp();
    const conv = "conv_done_1";
    const doneId = `task_done_${conv}`;
    await t.repos.tasks.insert({
      id: doneId,
      tenantId: TENANT,
      userId: "user-planner",
      packageId: PKG,
      conversationId: conv,
      query: "已完成的一问",
      context: { view: "risk", selectedObjects: [], filters: {}, conversationId: conv },
      status: "COMPLETED",
      clarificationRounds: 0,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    await submit(t, conv);
    const done = await t.repos.tasks.get(doneId);
    expect(done?.status).toBe("COMPLETED"); // terminal untouched
  });
});
