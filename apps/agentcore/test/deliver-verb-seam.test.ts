import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, TENANT, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { DELIVERY_RISK_RE, planCoordination } from "../src/router/coordinator.js";
import { isCapacityFeasibilityQuery } from "../src/agent/sim-planner.js";

/**
 * WO-DELIVER-VERB-SEAM · 接缝门：「说『接』能答、说『交付』永远答不出」。
 *
 * 病灶（仓主实测·2×2 归属取证坐实）：同一道产能可行性题，动词换成「交付」就被
 * `coordinator.ts` DELIVERY_RISK_RE 认领成「交付风险三角会诊」→ 扇出供应链/生产/质量三个角色 agent
 * （实测 60059/82842/60025 ms）→ 探索超时无答案；而本该拦住它的 `coordinator.ts:84` 护栏
 * `isCapacityFeasibilityQuery` 的词表 13 条全是「接」族，认不出「交付」。
 * **两张词表分处两文件、互不知情** —— 断点在接缝，不在任一模块内部（绿测试 ≠ 能用）。
 *
 * 本门驱动的正是那条接缝：不是各测各的正则，而是断言**两表在同一道题上不再打架**，
 * 且效果层（真 HTTP 路由落到哪条路）随之改变。
 */

/** 生产 demo 租户真实功能集 = 模板默认开 ∪ datacore seed.ts `seedDemoEntitlements` 的 9 条显式点亮。 */
const DEMO_PROD_FEATURES = [
  ...defaultOnKeys(),
  "qos.dril-routing",
  "agent.critic",
  "ceo.free-llm",
  "agent.coordinator",
  "qos.compose-path",
  "qos.reasoning-trace",
  "agent.escalation",
  "qos.deterministic-multi-domain",
  "qos.multi-intent-l3-coupled",
];

/** 用户在基地页选中常州（门③ contextRich 成立 → free-LLM/Coordinator 分路都具备触发条件）。 */
const CTX = {
  view: "capacity",
  selectedObjects: [{ objectType: "Base", objectId: "常州", label: "常州基地" }],
  filters: {},
  pageContext: {
    view: "capacity",
    entities: [{ type: "Base", id: "常州", label: "常州基地", drillRef: "常州" }],
    selection: ["常州"],
    drillPath: [],
    actions: [],
    focus: { base: "常州" },
  },
};

/** 真 Kimi 对仓主原句的实测分类结果（照抄·不臆造）：意图与四槽全对——分类器从来不是病因。 */
const REAL_CLASSIFICATION = {
  candidates: [{ intentKey: "capacity_feasibility", confidence: 0.95 }],
  outOfCatalog: false,
  extractedSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6, base: "常州基地" },
};

async function routeOf(
  query: string,
  ctx: Record<string, unknown> = CTX,
): Promise<{ model: string; status: string; path: string; agentRequests: number }> {
  const t: TestApp = await createTestApp();
  t.deps.features.mock.set(TENANT, DEMO_PROD_FEATURES);
  t.llm.queueClassification(REAL_CLASSIFICATION);
  for (let i = 0; i < 8; i++) {
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结论。" }], provenance: [] })] });
  }
  const r = await submitQuery(t, PLANNER, query, ctx);
  const task = await waitForTask(t, r.taskId, (x) => ["COMPLETED", "FAILED", "AWAITING_CLARIFICATION"].includes(x.status), 25000);
  const out = {
    model: task.classification?.model ?? "(无)",
    status: task.status,
    path: String(task.path ?? "(无)"),
    agentRequests: t.llm.agentRequests.length,
  };
  await t.app.close();
  return out;
}

describe("WO-DELIVER-VERB-SEAM · 「交付」不再把定式产能题打进多角色会诊", () => {
  it("① 效果层 2×2（基地 × 动词正交）：四种说法**全部**落确定性路由，无一被 coordinator 接走", async () => {
    const matrix = [
      "4680-NCM 加 20% 六周能不能接？", // 意图注册例句原文
      "4680-NCM 加 20% 六周能不能交付？", // 只换动词
      "4680-NCM 加 20% 常州基地六周能不能接？", // 只加基地
      "4680-NCM 加 20% 常州基地六周能不能交付？", // ← 仓主实际输入的那句
    ];
    for (const q of matrix) {
      const r = await routeOf(q);
      expect(r.model, `「${q}」被 ${r.model} 接走`).not.toBe("coordinator");
      expect(r.model, `「${q}」被自由 LLM 探索接走`).not.toBe("agent:ceo-free-llm");
      // 效果层（不是"没被某条路接走"，而是"根本没进探索"）：仓主的抱怨原话是「探索模式为何没有找到答案」——
      // 正解是这题压根不该进探索。path≠AGENT + 零 agent 往返 = 确定性求解器直答。
      expect(r.path, `「${q}」落进了 agent 探索路径`).not.toBe("AGENT");
      expect(r.agentRequests, `「${q}」烧了 ${r.agentRequests} 次 agent LLM 往返`).toBe(0);
      expect(r.status).toBe("COMPLETED");
    }
  }, 120_000);

  it("② 接缝不变量（防复发·治同义词打地鼠）：DELIVERY_RISK_RE 的**每一个**词条，配上型号+增量+周数后都必须被护栏认出", () => {
    // 单一来源：直接吃 coordinator.ts 导出的那条正则——将来有人往里加词（如「交货」），本断言立刻变红。
    const words = DELIVERY_RISK_RE.source.replace(/^\(|\)$/g, "").split("|");
    expect(words.length).toBeGreaterThanOrEqual(4);
    for (const w of words) {
      const q = `4680-NCM 加 20% 六周${w}？`;
      expect(isCapacityFeasibilityQuery(q), `护栏认不出「${q}」→ 会被 Coordinator 扇出多角色`).toBe(true);
      expect(planCoordination(q, undefined, []), `「${q}」仍被拆成多角色会诊`).toBeUndefined();
    }
  });

  it("③ 结构信号兜底：连动词都没有，只要「型号增量% + 周数」齐备就认（下一个同义词不必再改词表）", () => {
    expect(isCapacityFeasibilityQuery("4680-NCM 加 20% 六周的情况怎么样")).toBe(true);
    expect(planCoordination("4680-NCM 加 20% 六周内交付有没有问题", undefined, [])).toBeUndefined();
  });

  it("④ 诚实边界·未误伤真会诊：无增量/周数的开放交付风险题**仍**召集三角（三条既有用例逐字不变）", () => {
    expect(planCoordination("常州这批订单的交付风险怎么解", undefined, [])).toBeDefined();
    expect(planCoordination("交付风险怎么解", undefined, [])).toBeDefined();
    expect(planCoordination("常州交付风险：物料齐套、产能瓶颈、良率都看一下", undefined, [])).toBeDefined();
  });

  it("⑤ 诚实边界·用户显式要会诊则让位：即便增量+周数齐备，说了「综合分析/会诊」仍走多角色", () => {
    expect(isCapacityFeasibilityQuery("综合分析 4680-NCM 加 20% 六周的交付风险，物料齐套和良率都要看")).toBe(false);
    expect(planCoordination("综合分析 4680-NCM 加 20% 六周的交付风险，物料齐套和良率都要看", undefined, [])).toBeDefined();
  });

  it("⑥ 既有负例不动：单订单重排（SO-号 + 重排/提前）不被本单误吞", () => {
    expect(isCapacityFeasibilityQuery("SO-3402 提前两周交跨基地重排，产能够不够")).toBe(false);
  });
});
