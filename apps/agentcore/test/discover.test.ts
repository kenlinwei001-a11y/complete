import { describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers.js";

const CTX = { tenantId: "tenant-demo", userId: "u1", roles: ["planner"] };

describe("能力发现与路由 §1 — discover 元工具（Agent 侧）", () => {
  it("discover(kind=slices) 经执行器路由到 DataCore 目录，返回带 key+description 的条目", async () => {
    const t: TestApp = await createTestApp();
    const executor = t.deps.engine.makeExecutor("task_disc", CTX);
    const r = await executor.run("discover", { kind: "slices" });
    expect(r.ok).toBe(true);
    const items = (r.payload as { items: { key: string; description: string }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.key && i.description)).toBe(true);
  });

  it("discover(kind=solvers, query) 关键词过滤", async () => {
    const t = await createTestApp();
    const executor = t.deps.engine.makeExecutor("task_disc2", CTX);
    const r = await executor.run("discover", { kind: "solvers", query: "产能" });
    expect(r.ok).toBe(true);
    const items = (r.payload as { items: { key: string }[] }).items;
    expect(items.map((i) => i.key)).toContain("capacity_forecast");
  });

  it("非法 kind → 工具返回 error 而非崩溃", async () => {
    const t = await createTestApp();
    const executor = t.deps.engine.makeExecutor("task_disc3", CTX);
    const r = await executor.run("discover", { kind: "nope" });
    expect((r.payload as { error?: string }).error).toBeDefined();
  });
});
