import { describe, expect, it } from "vitest";
import {
  CounterfactualResultSchema,
  ReasoningTraceSchema,
} from "@platform/contracts";
import {
  buildReasoning,
  buildCounterfactuals,
  buildReasoningAndCounterfactuals,
  type DecisionKernelDeps,
  type DecisionKernelRequest,
} from "../src/decision/kernel.js";

/**
 * WO-L2-2 齿（PRD-L2-decision-kernel.md §4.1-4.2 / acceptance ①②③④⑤）：
 *  ① 三模式 ReasoningTrace（Path/Impact/Counterfactual·chain 有据）；
 *  ② 反事实 World A/B/Δ **逐值等于** counterfactual_timeline 求解器输出（非近似·V1）；
 *  ③ 沿因果重算经 recompute(dryRun) dryRunDeltas → objectDeltas（对象级 delta 非造·V1）；
 *  ④ R6 双跑字节一致（reasoning/cf 级）；
 *  ⑤ dataMode 诚实透传 + KILL-MOCK：无真双轨 → 不产 CF（不合成峰值/delta）。
 *
 * fixtures 取真求解器输出**形状**（risk.ts / service.ts / ontology-core.ts AS-IS 字段名），
 * 经 mock invokeSolver 喂入（LLM/网络/时钟不入·R6）。
 */

// ── 真求解器输出形 fixtures ─────────────────────────────────────────
const affectedOrdersOut = {
  baseId: "BASE_CZ",
  affected: [
    { so: "SO-1001", cust: "宁德", model: "PACK02", qty: 500, due: "2026-08-01", dueDay: 20, delay: 5, revenueWan: 320, impact: 0.8 },
    { so: "SO-1002", cust: "比亚迪", model: "PACK02", qty: 300, due: "2026-08-05", dueDay: 24, delay: 3, revenueWan: 190, impact: 0.5 },
  ],
  total: 2,
  count: 2,
  columns: ["so", "cust", "model", "qty", "due"],
  rows: [],
  fallback: false,
  problems: [
    {
      category: "ramp",
      title: "产能爬坡不足",
      orderCount: 2,
      financeImpact: 0.51,
      rootCauseSummary: "PACK02 产线降产 20% → 日产能缺口",
      rootChains: [
        {
          orderId: "SO-1001",
          layers: [
            { kind: "order", label: "SO-1001 宁德 PACK02" },
            { kind: "judgement", label: "交期越线 5 天" },
            { kind: "rootCause", label: "PACK02 产能 -20%", ref: { kind: "object", key: "Line:PACK02" } },
            { kind: "remedy", label: "跨基地调拨", ref: { kind: "action", key: "adopt_mitigation" } },
          ],
        },
      ],
    },
  ],
};

const planRootcauseOut = {
  kpis: [
    { kpiId: "KPI_DELIVERY", name: "准时交付率", category: "delivery", ksfRef: "KSF_CAP", actual: 0.86, target: 0.95, floorVal: 0.9, unit: "%", gap: -0.09, offTarget: true, status: "RED" },
    { kpiId: "KPI_GM", name: "毛利率", category: "finance", ksfRef: "KSF_COST", actual: 0.30, target: 0.30, floorVal: 0.25, unit: "%", gap: 0, offTarget: false, status: "GREEN" },
  ],
  dag: {
    nodes: [
      { id: "KPI_DELIVERY", kind: "kpi", label: "准时交付率" },
      { id: "KSF_CAP", kind: "ksf", label: "产能保障" },
      { id: "F_RAMP", kind: "factor", label: "产能爬坡不足" },
      { id: "E_LINE", kind: "evidence", label: "PACK02 -20%" },
    ],
    edges: [
      { from: "KPI_DELIVERY", to: "KSF_CAP", weight: 1, kind: "kpi_ksf" },
      { from: "KSF_CAP", to: "F_RAMP", weight: 0.7, kind: "ksf_factor" },
      { from: "F_RAMP", to: "E_LINE", weight: 0.9, kind: "factor_evidence" },
    ],
  },
  offTargetCount: 1,
  excludedFactors: [],
  summary: "准时交付率越线：主因产能爬坡不足",
  ruleRefs: [],
};

// counterfactual_timeline 真输出（risk.ts:820-834 return 逐字段）。
const counterfactualTimelineOut = {
  baselineSeries: [12.4, 18.9, 24.1, 31.7, 40.2],
  mitigatedSeries: [12.4, 15.1, 17.8, 20.3, 22.6],
  threshold: 30,
  factor: "capacity_drop",
  base: "常州基地",
  mitigation: "跨基地调拨",
  delta: { peakCut: 17.6, crossDelayDays: 2, ordersSaved: 3 },
  events: [{ day: 4, kind: "cross" }],
  summary: "如不解决…",
};

// recompute(dryRun) 经 POST /a/v1/inference/whatif 重塑输出（app.ts:2949 {deltas,affectedObjects}）。
const recomputeDryRunResult = {
  deltas: [
    { objId: "Order:SO-1001", type: "Order", prop: "promiseDate", before: "2026-08-01", after: "2026-08-06" },
    { objId: "Capacity:CZ-PACK02", type: "Capacity", prop: "dailyOutput", before: 1000, after: 800 },
  ],
  affectedObjects: 2,
};

function makeDeps(overrides?: Partial<Record<string, unknown>>): DecisionKernelDeps {
  return {
    invokeSolver: async (key) => {
      if (key === "affected_orders") return { ...affectedOrdersOut };
      if (key === "plan_rootcause") return { ...planRootcauseOut };
      if (key === "counterfactual_timeline") return { ...counterfactualTimelineOut };
      throw new Error(`unexpected solver ${key}`);
    },
    recomputeDryRun: async () => ({ ...recomputeDryRunResult }),
    ...overrides,
  } as DecisionKernelDeps;
}

const baseReq: DecisionKernelRequest = {
  taskId: "task_cz_1",
  tenantId: "demo",
  query: "未来30天常州基地PACK02产线降低20%产能，哪些客户订单无法按期交付？给三个优化方案",
  intentKey: "risk_affected_orders",
  slots: { baseId: "BASE_CZ", base: "常州基地", factor: "capacity_drop", horizon: 30, mitigationKey: "跨基地调拨", apply: [{ objectType: "Capacity", objectId: "Capacity:CZ-PACK02", prop: "dailyOutput", value: 800 }] },
  requirementGraphId: null,
  executionPlanId: null,
  generatedAt: "2026-07-11T00:00:00.000Z",
  builderVersion: "l2-kernel@1",
};

describe("WO-L2-2 · Reasoning Engine + Counterfactual 编排", () => {
  it("① 三模式 ReasoningTrace（Path/Impact/Counterfactual）+ 契约合法", async () => {
    const { trace } = await buildReasoning(makeDeps(), baseReq);
    ReasoningTraceSchema.parse(trace);
    const modes = trace.steps.map((s) => s.mode);
    expect(modes).toContain("PATH");
    expect(modes).toContain("IMPACT");
    expect(modes).toContain("COUNTERFACTUAL");

    const path = trace.steps.find((s) => s.mode === "PATH")!;
    expect(path.solverKey).toBe("affected_orders");
    // Path 链源自 problems[].rootChains[].layers[]（连续层成边·非造）。
    expect(path.chain.length).toBe(3); // 4 layers → 3 edges
    expect(path.chain[0].from).toContain("SO-1001");
    expect(path.outputRefs).toContain("SO-1001");

    const impact = trace.steps.find((s) => s.mode === "IMPACT")!;
    expect(impact.solverKey).toBe("plan_rootcause");
    expect(impact.chain.length).toBe(3); // 3 dag edges
    expect(impact.chain[0].reason).toMatch(/贡献占比/);
    expect(impact.outputRefs).toEqual(["KPI_DELIVERY"]); // 仅 offTarget KPI
  });

  it("② 反事实 World A/B/Δ 逐值等于 counterfactual_timeline 求解器输出（非近似）", async () => {
    const { counterfactuals } = await buildCounterfactuals(makeDeps(), baseReq);
    const ts = counterfactuals.find((c) => c.engine === "counterfactual_timeline")!;
    CounterfactualResultSchema.parse(ts);
    expect(ts.worldA.series).toEqual(counterfactualTimelineOut.baselineSeries);
    expect(ts.worldB.series).toEqual(counterfactualTimelineOut.mitigatedSeries);
    expect(ts.delta.peakCut).toBe(counterfactualTimelineOut.delta.peakCut);
    expect(ts.delta.crossDelayDays).toBe(counterfactualTimelineOut.delta.crossDelayDays);
    expect(ts.delta.ordersSaved).toBe(counterfactualTimelineOut.delta.ordersSaved);
    expect(ts.scenarioKey).toBe("跨基地调拨");
  });

  it("③ 沿因果重算：recompute(dryRun) dryRunDeltas → objectDeltas（对象级·objId→objectId）", async () => {
    const { counterfactuals } = await buildCounterfactuals(makeDeps(), baseReq);
    const obj = counterfactuals.find((c) => c.engine === "generic_inference")!;
    CounterfactualResultSchema.parse(obj);
    expect(obj.delta.objectDeltas).toHaveLength(2);
    expect(obj.delta.objectDeltas![0]).toEqual({
      objectId: "Order:SO-1001",
      type: "Order",
      prop: "promiseDate",
      before: "2026-08-01",
      after: "2026-08-06",
    });
    expect(obj.dataMode).toBe("LIVE"); // 有真 dryRunDeltas
  });

  it("④ R6 双跑字节一致（generatedAt 注入·prov 确定性·无随机/时钟）", async () => {
    const a = await buildReasoningAndCounterfactuals(makeDeps(), baseReq);
    const b = await buildReasoningAndCounterfactuals(makeDeps(), baseReq);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // prov id 确定性（同 taskId+toolName+outputPath 同 id）。
    expect(a.provenance.every((p) => /^prov_[0-9a-f]{8}$/.test(p.id))).toBe(true);
  });

  it("⑤ KILL-MOCK：counterfactual_timeline 无真双轨（抛错）→ 不产时序反事实（不合成峰值）", async () => {
    const deps = makeDeps({
      invokeSolver: async (key: string) => {
        if (key === "affected_orders") return { ...affectedOrdersOut };
        if (key === "plan_rootcause") return { ...planRootcauseOut };
        if (key === "counterfactual_timeline") throw new Error("无可推演风险卡（无真数据源）");
        throw new Error(`unexpected ${key}`);
      },
    });
    const { counterfactuals } = await buildCounterfactuals(deps, baseReq);
    // 时序反事实缺失（诚实）；对象级仍可产（apply+recompute 真）。
    expect(counterfactuals.find((c) => c.engine === "counterfactual_timeline")).toBeUndefined();
    expect(counterfactuals.find((c) => c.engine === "generic_inference")).toBeDefined();
  });

  it("⑤b KILL-MOCK：series 非数值数组 → 该 CF 不产（不 coerce/兜底）", async () => {
    const deps = makeDeps({
      invokeSolver: async (key: string) => {
        if (key === "counterfactual_timeline") return { ...counterfactualTimelineOut, baselineSeries: [1, "NaN", 3] };
        if (key === "affected_orders") return { ...affectedOrdersOut };
        if (key === "plan_rootcause") return { ...planRootcauseOut };
        throw new Error(`unexpected ${key}`);
      },
      recomputeDryRun: undefined,
    });
    const { counterfactuals } = await buildCounterfactuals(deps, { ...baseReq, slots: { ...baseReq.slots, apply: undefined } });
    expect(counterfactuals).toHaveLength(0); // 无真双轨 + 无 apply → 空（诚实空态）
  });
});
