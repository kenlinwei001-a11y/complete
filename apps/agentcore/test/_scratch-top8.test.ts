import { describe, expect, it } from "vitest";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { seedMcpConfigs, seedRegistry } from "../src/mocks/seed.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";

/** 临时取样：为 ③ 对照实验找一句能把某个 deferred 键抬进 top-8 的相关性输入。 */
const CTX = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

const DESCS: Record<string, string> = {
  gap_attribution: "缺口归因：把总缺口拆解到各驱动因子与责任方（gap attribution）",
  decision_play: "决策打法：给出成套对策组合与优先级",
  metric_rollup: "指标汇总：跨层级指标滚动汇总与口径核对",
  credit_exposure: "信用敞口：新单是否使客户敞口超信用额度",
  finance_pnl: "财务损益：毛利与净利口径测算",
  supply_demand_gap_attribution: "供需缺口归因：需求端与供给端双向分摊总缺口",
  atp_check: "可承诺量：现货+在制+交期前可排产能校核",
  bottleneck_matrix: "瓶颈矩阵：瓶颈落在哪道工序、哪条产线",
  base_capacity_outlook: "基地产能展望：基地维度产能利用率与展望",
  generic_inference: "通用推演：沿派生 DAG 重算因子变动影响",
  capacity_forecast: "产能预测：按型号需求增量测算各周产能利用率与缺口",
  affected_orders: "受影响订单：产能/物料变动波及哪些订单",
  kit_readiness: "齐套就绪：物料齐套与净需求测算",
  risk_timeline: "风险时间线：未来 30 天延期风险最高的对象",
  mrp_netting: "物料净需求：MRP 净需求测算（产能校核）",
  yield_diagnosis: "良率诊断：工序良率异常定位与归因",
};

async function run(query: string, t: TestApp): Promise<string[]> {
  const agent = seedRegistry().agents.find((a) => a.id === "agt_seed_analyst")!;
  await t.repos.agents.insert({ ...agent, id: `agt_scratch_${Math.random().toString(36).slice(2, 8)}`, tenantId: TENANT });
  for (const c of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(c.id))) await t.repos.mcpConfigs.insert(c);
  (t.dataCore.catalog as unknown as { solverRegistry: (ctx: unknown) => Promise<{ items: unknown[] }> }).solverRegistry = async () => ({
    items: Object.entries(DESCS).map(([key, description]) => ({
      key, name: key, description, domain: "capacity", argHints: {},
      answersQuestions: [description, "产能利用率是多少", "瓶颈在哪道工序"],
      tags: ["产能", "利用率", "瓶颈", key],
      ontologySignature: { reads: ["Base", "Order", "Model", "Line", "Process"].map((typeKey) => ({ typeKey })) },
    })),
  });
  t.llm.queueAgentTurn(() => ({ content: [text("ok"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "x ⟦ref:0⟧。" }], provenance: [] })] }));
  const before = t.llm.agentRequests.length;
  const inserted = (await t.repos.agents.listByTenant(TENANT)).at(-1)!;
  await t.deps.engine.runRegisteredAgent({
    taskId: `task_scratch_${inserted.id}`, agentId: inserted.id, version: 1, prompt: query, ctx: CTX as never,
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", inserted.id), emit: async () => {},
  });
  const req = t.llm.agentRequests[before]!;
  return req.tools.map((t) => t.name).filter((n) => n.startsWith("mcp__"));
}

describe("scratch", () => {
  it("probe queries", async () => {
    const t = await createTestApp();
    try {
      for (const q of [
        "常州基地当前的产能利用率是多少？瓶颈在哪道工序？",
        "缺口归因：把总缺口拆解到各驱动因子（gap attribution）",
        "gap_attribution 缺口归因",
        "良率诊断：工序良率异常定位与归因",
      ]) {
        const granted = await run(q, t);
        // eslint-disable-next-line no-console
        console.log(`Q=${q}\n  granted(${granted.length})=${granted.join(",")}`);
      }
    } finally {
      await t.app.close();
    }
    expect(true).toBe(true);
  }, 30000);
});
