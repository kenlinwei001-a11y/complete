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
      // WO-MOCK-ENGINE-PARITY：linkPath 不再是写死旧路——与真引擎同图同 BFS 现算。
      // 真侧今日 Base→Order 最短路径走 model_demanded_by_order（tie-break：linkKey 字典序
      // "model_demanded_by_order" < "order_for_model"；语义校验见 mock-engine-parity.test.ts §4，
      // 那里两侧现算集合相等，此处只钉「不再返回 P1 之前那条旧路」+ 每条 linkPath 确实是图上的路）。
      expect(prov.linkPath).toEqual(["model_producible_at:in", "model_demanded_by_order:out"]);
      expect(prov.linkPath).not.toContain("order_for_model:in");
    }
    expect(p.queryPlan.hops.length).toBe(2);
  });
});

/**
 * WO-AGENT-REASONER · 接缝：agent 能不能用到推理机的 **what-if** 那一支。
 *
 * 背景（实测，不是推测）：引擎 `datacore/src/ontology/query-engine.ts:211` 的
 * `overrides → recompute(dryRun) → before/after deltas` 分支，**契约有**
 * （`contracts/src/ontology-query.ts` `OntologyQueryInputSchema.overrides`）、
 * **引擎有**、**求解器接了**（`datacore/src/solvers/service.ts` `recompute` dep），
 * 且 **A 侧已有量化对照实验**在守（`datacore/test/generic-inference-query.test.ts:46`：
 * 断言 `after − before === Δqty × unitPrice`，不是「返回了东西就算过」）。
 * 唯独 **B 侧工具契约里没声明 `overrides`**，描述原文还写着「仅遍历+简单聚合…请用 invoke_solver」
 * ⇒ 模型看不见这个参数，就永远不会传它。
 * 形态：「我用『工具已注册』当作『agent 能用到它的推理能力』的证据，而前者并不度量后者。」
 *
 * ⚠ 本组测试**不验 what-if 算得对**（那是 A 侧那条对照实验的活，mock 没有 recompute 引擎）。
 * 它验的是**接缝**：这个参数从 agent 手里出发，有没有**原样**抵达 DataCore。
 * 探针是 mock 的**诚实报缺**——`mocks/clients.ts` 在 `overrides` 非空时抛
 * `MockNoQueryPlanError`（「无 recompute 引擎·诚实报缺不伪造 deltas」）。
 * **正因为它只在参数抵达时才抛，这声抛就是接缝通的证据**：执行器若把 `overrides` 剥掉，
 * 它一声不吭地返回遍历行 —— 那正是反向臂要钉死的失败态。
 */
describe("WO-AGENT-REASONER · agent 可调用推理机的 what-if（overrides 接缝）", () => {
  const WHATIF_ARGS = {
    rootType: "Base",
    rootFilter: [{ field: "name", op: "eq", value: "常州" }],
    select: [{ type: "Order", fields: ["so", "qty"] }],
    overrides: [{ objectType: "Order", objectId: "obj_order_SO-0001", prop: "qty", value: 9999 }],
  };

  it("契约臂：query_ontology 的 inputSchema 声明了 overrides（agent 看得见才可能传）", () => {
    const def = BUILTIN_TOOLS.find((t) => t.name === "query_ontology")!;
    const props = def.inputSchema.properties as Record<string, { type?: string; description?: string }>;
    expect(props.overrides).toBeTruthy();
    expect(props.overrides?.type).toBe("array");
    // 可选：不许挤进 required，否则纯遍历调用全红。
    expect(def.inputSchema.required).toEqual(["rootType", "select"]);
    // 描述里必须点名这个能力——参数在 schema 里而描述说「仅遍历」，模型依旧不会用。
    expect(def.descriptionForLLM).toContain("overrides");
    expect(def.descriptionForLLM).toContain("what-if");
    // 边界必须写明：what-if 走派生链，不是多拍传导（写糊了 agent 会拿它答「三个月后缺多少料」）。
    expect(def.descriptionForLLM).toContain("sim_tick");
    // 反向：不许再出现那句把 agent 支走的绝对化措辞。
    expect(def.descriptionForLLM).not.toContain("仅遍历+简单聚合");
  });

  it("正向臂：带 overrides 调用 → 参数原样抵达 DataCore（mock 诚实报缺，指名 overrides）", async () => {
    const r = await exec().run("query_ontology", WHATIF_ARGS);
    expect(r.ok).toBe(false);
    // 指认粒度：错误必须点名 overrides —— 只断言「失败了」会把「别的东西坏了」也读成通过。
    expect(JSON.stringify(r.payload)).toContain("overrides");
  });

  it("反向臂：同一查询去掉 overrides → 正常返回遍历行（证明上一臂的红不是查询本身坏了）", async () => {
    const { overrides: _drop, ...noWhatIf } = WHATIF_ARGS;
    const r = await exec().run("query_ontology", noWhatIf);
    expect(r.ok).toBe(true);
    const p = (r.payload as { data: { rows: unknown[] } }).data;
    expect(p.rows.length).toBeGreaterThan(0); // 金丝雀：这条查询本身是通的
  });

  it("剥参反证：overrides 为空数组 ⇒ 与不传等价（不许空数组也触发 what-if）", async () => {
    const r = await exec().run("query_ontology", { ...WHATIF_ARGS, overrides: [] });
    expect(r.ok).toBe(true);
    expect((r.payload as { data: { rows: unknown[] } }).data.rows.length).toBeGreaterThan(0);
  });
});
