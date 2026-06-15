import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

const CTX = { tenantId: "tenant-demo", userId: "u1", roles: ["planner"] };

/**
 * #6 任务内 READ 记忆化：同一执行器（=一次任务运行）内，相同 READ 工具+相同参数只 dispatch 一次；
 * COMPUTE/有副作用工具（invoke_solver）不缓存（保 M11 forecastSnapshots/calibrationForecasts 契约）。
 */
describe("#6 任务内 READ 结果缓存", () => {
  it("相同 query_objects 参数二次调用走缓存（仅 dispatch 1 次）；不同参数不命中", async () => {
    const t = await createTestApp();
    let calls = 0;
    const orig = t.dataCore.ontology.queryObjects.bind(t.dataCore.ontology);
    t.dataCore.ontology.queryObjects = async (...a: Parameters<typeof orig>) => {
      calls++;
      return orig(...a);
    };
    const ex = t.deps.engine.makeExecutor("task_cache", CTX);
    const r1 = await ex.run("query_objects", { objectType: "Base", filter: {} });
    const r2 = await ex.run("query_objects", { filter: {}, objectType: "Base" }); // 同参数（键序不同）
    expect(calls).toBe(1); // 第二次命中缓存（canonicalArgs 键序无关）
    expect(r2.payload).toEqual(r1.payload);
    await ex.run("query_objects", { objectType: "Order", filter: {} }); // 不同参数
    expect(calls).toBe(2);
  });

  it("invoke_solver（COMPUTE，有副作用）不缓存：相同参数两次仍各 dispatch", async () => {
    const t = await createTestApp();
    let sc = 0;
    t.dataCore.solver.invoke = async () => {
      sc++;
      return { data: { total: 0, affected: [] }, snapshotVersion: "1.1" };
    };
    const ex = t.deps.engine.makeExecutor("task_nocache", CTX);
    await ex.run("invoke_solver", { solverKey: "affected_orders", args: { baseId: "changzhou" } });
    await ex.run("invoke_solver", { solverKey: "affected_orders", args: { baseId: "changzhou" } });
    expect(sc).toBe(2); // 未缓存（副作用工具不可缓存）
  });

  it("缓存按执行器隔离：另一任务的执行器不复用上一任务缓存", async () => {
    const t = await createTestApp();
    let calls = 0;
    const orig = t.dataCore.ontology.queryObjects.bind(t.dataCore.ontology);
    t.dataCore.ontology.queryObjects = async (...a: Parameters<typeof orig>) => {
      calls++;
      return orig(...a);
    };
    const exA = t.deps.engine.makeExecutor("task_a", CTX);
    const exB = t.deps.engine.makeExecutor("task_b", CTX);
    await exA.run("query_objects", { objectType: "Base", filter: {} });
    await exB.run("query_objects", { objectType: "Base", filter: {} });
    expect(calls).toBe(2); // 两个执行器各自 dispatch
  });
});
