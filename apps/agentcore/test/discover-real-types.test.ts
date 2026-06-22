import { describe, expect, it } from "vitest";
import { TENANT } from "./helpers.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";

/**
 * CL.3 · discover 暴露真实对象类型名（agent 不再猜错英文名）。
 * discover{object_types} 列真实 key+标签+域+计数；query_objects 未知 typeKey → UNKNOWN_TYPE+did-you-mean；
 * 类型存在但 0 实例 → 区分"空 vs 不存在"提示引导（不让 agent 误判无数据）。
 */
const exec = () =>
  new GuardedToolExecutor(
    { dataCore: createMockDataCore(), repos: createMemoryRepos(), metrics: new Metrics() },
    { taskId: "t_dtn", ctx: { tenantId: TENANT, userId: "admin", roles: ["admin"] }, budget: new BudgetTracker() },
  );

describe("CL.3 · discover 真实类型名 + did-you-mean", () => {
  it("discover{object_types} → 真实 key+中文标签+域+实例数（agent 据此查，不猜）", async () => {
    const r = await exec().run("discover", { kind: "object_types" });
    expect(r.ok).toBe(true);
    const items = (r.payload as { items: { key: string; label: string; instanceCount: number }[] }).items;
    const base = items.find((i) => i.key === "Base");
    expect(base).toBeTruthy();
    expect(base!.label).toBe("生产基地");
    expect(base!.instanceCount).toBeGreaterThan(0);
  });

  it("query_objects(未知类型 plan_version) → UNKNOWN_TYPE + validTypes + did-you-mean，不静默返空", async () => {
    const r = await exec().run("query_objects", { objectType: "plan_version", filter: {} });
    expect(r.ok).toBe(true);
    const p = r.payload as { error?: string; validTypes?: string[]; suggestion?: string; data?: unknown };
    expect(p.error).toBe("UNKNOWN_TYPE");
    expect(Array.isArray(p.validTypes)).toBe(true);
    expect(p.data).toBeUndefined(); // 未静默返空集
  });

  it("query_objects(真实类型 Order) → 正常返回；类型存在但 0 实例（Material）→ empty 标记 + 引导提示", async () => {
    const e = exec();
    const ok = await e.run("query_objects", { objectType: "Order", filter: {} });
    expect((ok.payload as { error?: string }).error).toBeUndefined();
    expect((ok.payload as { data: { total: number } }).data.total).toBeGreaterThan(0);

    // Material 是已发布类型（在类型集内）但 mock 无实例 → 区分"空 vs 不存在"
    const empty = await e.run("query_objects", { objectType: "Material", filter: {} });
    const ep = empty.payload as { error?: string; empty?: boolean; hint?: string };
    expect(ep.error).toBeUndefined(); // 不是 UNKNOWN_TYPE（类型存在）
    expect(ep.empty).toBe(true);
    expect(ep.hint).toContain("引导");
  });
});
