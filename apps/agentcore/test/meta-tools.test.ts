import { describe, expect, it } from "vitest";
import { TENANT } from "./helpers.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { BUILTIN_TOOLS } from "../src/tools/registry.js";

/**
 * Dogfooding P3：meta 内置工具——Agent 经 query_system_ontology / get_breakpoint / impact_of
 * 问运行中的系统自己（OBO 透传 → DataCore /meta,受 MetaAccessPolicy 白名单门控）。
 */
const exec = () =>
  new GuardedToolExecutor(
    { dataCore: createMockDataCore(), repos: createMemoryRepos(), metrics: new Metrics() },
    { taskId: "t_meta", ctx: { tenantId: TENANT, userId: "u", roles: ["admin"] }, budget: new BudgetTracker() },
  );

describe("Dogfooding P3 · meta 内置工具（问系统自己）", () => {
  it("三个工具已注册进内置目录", () => {
    const names = BUILTIN_TOOLS.map((t) => t.name);
    expect(names).toContain("query_system_ontology");
    expect(names).toContain("get_breakpoint");
    expect(names).toContain("impact_of");
  });

  it("impact_of(R14) → 受影响节点;get_breakpoint(G-8) → 状态+关联;query_system_ontology → 摘要", async () => {
    const e = exec();
    const imp = await e.run("impact_of", { node: "R14" });
    expect(imp.ok).toBe(true);
    expect((imp.payload as { affected: unknown[] }).affected.length).toBeGreaterThan(0);

    const bp = await e.run("get_breakpoint", { id: "G-8" });
    expect(bp.ok).toBe(true);
    expect((bp.payload as { props: { status: string } }).props.status).toBeTruthy();

    const onto = await e.run("query_system_ontology", {});
    expect(onto.ok).toBe(true);
    expect((onto.payload as { byKind: Record<string, number> }).byKind.SystemBreakpoint).toBe(8);
  });
});
