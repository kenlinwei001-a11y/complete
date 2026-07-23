import { describe, expect, it } from "vitest";
import { TENANT } from "./helpers.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { BUILTIN_TOOLS } from "../src/tools/registry.js";

/**
 * WO-Phase3-B §3.2/§3.6 · Agent 侧 query_ontology 工具（本体多跳遍历查询）：
 * 已注册进内置目录 + 经执行器 OBO 到 DataCore ontology_query 求解器 → 答案带逐行 provenance{typeKey,objId,linkPath}。
 */
const exec = () =>
  new GuardedToolExecutor(
    { dataCore: createMockDataCore(), repos: createMemoryRepos(), metrics: new Metrics() },
    { taskId: "t_oq", ctx: { tenantId: TENANT, userId: "admin", roles: ["admin"] }, budget: new BudgetTracker() },
  );

describe("WO-Phase3-B · Agent query_ontology 工具（本体遍历查询·带 provenance）", () => {
  it("query_ontology 已注册进内置目录（READ·必填 rootType+select）", () => {
    const def = BUILTIN_TOOLS.find((t) => t.name === "query_ontology");
    expect(def).toBeTruthy();
    expect(def!.sideEffect).toBe("READ");
    expect(def!.inputSchema.required).toEqual(["rootType", "select"]);
  });

  it("Agent 调 query_ontology → 遍历结果 + 逐行 provenance{typeKey,objId,linkPath}（可溯 R13）", async () => {
    const r = await exec().run("query_ontology", {
      rootType: "Base",
      rootFilter: [{ field: "name", op: "eq", value: "常州" }],
      select: [{ type: "Order", fields: ["so", "qty"] }],
    });
    expect(r.ok).toBe(true);
    const p = (r.payload as { data: { rows: unknown[]; columns: string[]; provenance: { typeKey: string; objId: string; linkPath: string[] }[]; queryPlan: { hops: unknown[] } } }).data;
    expect(p.rows.length).toBeGreaterThan(0);
    expect(p.columns).toEqual(["Order.so", "Order.qty"]);
    // 答案带 provenance（每行 typeKey+objId+linkPath）
    expect(p.provenance.length).toBe(p.rows.length);
    for (const prov of p.provenance) {
      expect(prov.typeKey).toBe("Order");
      expect(prov.objId).toMatch(/^obj_order_/);
      expect(prov.linkPath).toEqual(["model_producible_at:in", "order_for_model:in"]);
    }
    expect(p.queryPlan.hops.length).toBe(2);
  });
});
