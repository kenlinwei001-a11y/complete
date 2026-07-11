import { describe, expect, it } from "vitest";
import {
  CounterfactualResultSchema,
  DecisionPackageSchema,
  DecisionScenarioSchema,
  ReasoningTraceSchema,
  ExplanationChainSchema,
} from "../src/index.js";

/**
 * WO-L2-1 契约齿（PRD-L2-decision-kernel.md §3 / acceptance ①②③④）：
 *  ① 四级制品 + 顶层 DecisionPackage 的 zod schema 编译过且能 parse 合法实例；
 *  ② CounterfactualResult 能**无损承载** counterfactual_timeline 真求解器输出
 *     （填补 solver-registry.ts:81 只有 outputShape 字符串、无 zod 契约的缺口）；
 *  ③ 契约 additive/optional——DecisionPackage 是**新**类型，旧消费方零感知（不改任何既有 schema）；
 *  ④ R13 诚实位：无真源字段可为 null（metrics/delta/series），不强造。
 */

/** counterfactual_timeline 真输出形（AS-IS·apps/datacore/src/solvers/risk.ts:774-834 return 语句逐字段）。 */
const realCounterfactualTimelineOutput = {
  baselineSeries: [12.4, 18.9, 24.1, 31.7, 40.2],
  mitigatedSeries: [12.4, 15.1, 17.8, 20.3, 22.6],
  threshold: 30,
  factor: "capacity_drop",
  base: "常州基地",
  mitigation: "跨基地调拨",
  delta: {
    peakCut: 17.6,
    crossDelayDays: 2,
    ordersSaved: 3,
  },
  events: [{ day: 4, kind: "cross" }],
  summary: "如不解决「常州基地·capacity_drop」：峰值 40 → 处置后 23（削 18）、越线日推迟 2 天",
};

describe("WO-L2-1 · 决策内核契约（DecisionPackage 四级制品）", () => {
  it("② CounterfactualResult 无损承载 counterfactual_timeline 真输出（填补无 schema 缺口）", () => {
    const o = realCounterfactualTimelineOutput;
    // 映射：真求解器输出 → CounterfactualResult（World A/B/Δ·engine 诚实标）
    const cf = {
      cfId: "cf_0",
      taskId: "task_1",
      tenantId: "demo",
      scenarioKey: "跨基地调拨",
      engine: "counterfactual_timeline" as const,
      worldA: { label: "现实/do-nothing", series: o.baselineSeries, kpis: { threshold: o.threshold } },
      worldB: { label: "假设/处置后", series: o.mitigatedSeries, kpis: { threshold: o.threshold } },
      delta: {
        kpis: { peak: -o.delta.peakCut },
        peakCut: o.delta.peakCut,
        crossDelayDays: o.delta.crossDelayDays,
        ordersSaved: o.delta.ordersSaved,
      },
      distribution: null,
      dataMode: "LIVE",
      provIds: ["prov_cf_series"],
      generatedAt: "2026-07-11T00:00:00.000Z",
    };
    const parsed = CounterfactualResultSchema.parse(cf);
    // 无损：核心序列/delta 逐值等于求解器真输出（非近似·非哈希）。
    expect(parsed.worldA.series).toEqual(o.baselineSeries);
    expect(parsed.worldB.series).toEqual(o.mitigatedSeries);
    expect(parsed.delta.peakCut).toBe(o.delta.peakCut);
    expect(parsed.delta.crossDelayDays).toBe(o.delta.crossDelayDays);
    expect(parsed.delta.ordersSaved).toBe(o.delta.ordersSaved);
    expect(parsed.engine).toBe("counterfactual_timeline");
  });

  it("④ R13 诚实位：无真源时序/delta 可 null（不强造 series/peak）", () => {
    const cf = CounterfactualResultSchema.parse({
      cfId: "cf_1",
      taskId: "task_1",
      tenantId: "demo",
      scenarioKey: "do_nothing",
      engine: "generic_inference" as const,
      worldA: { label: "现实", series: null, kpis: {} },
      worldB: { label: "假设", series: null, kpis: {} },
      delta: { kpis: {}, peakCut: null, crossDelayDays: null, ordersSaved: null },
      distribution: null,
      dataMode: "PARTIAL",
      provIds: [],
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    expect(cf.worldA.series).toBeNull();
    expect(cf.delta.peakCut).toBeNull();
    expect(cf.dataMode).toBe("PARTIAL");
  });

  it("① 顶层 DecisionPackage parse 合法实例（四级制品汇入）", () => {
    const reasoning = {
      traceId: "rt_0",
      taskId: "task_1",
      tenantId: "demo",
      requirementGraphId: null,
      executionPlanId: null,
      steps: [
        {
          stepId: "s0",
          mode: "PATH" as const,
          solverKey: "affected_orders",
          inputRefs: ["obj_base_cz"],
          chain: [{ from: "Line:PACK02", to: "Order:O-1", relation: "affects", reason: "降产→延期" }],
          outputRefs: ["Order:O-1"],
          provIds: ["prov_ao"],
        },
      ],
      builderVersion: "l2-kernel@1",
      generatedAt: "2026-07-11T00:00:00.000Z",
    };
    ReasoningTraceSchema.parse(reasoning);

    const scenario = {
      key: "延期",
      name: "延期交付",
      sourceSolverKey: "what_if_displacement",
      metrics: {
        deliveryRate: 0.92,
        grossMarginPct: 0.31,
        costDelta: 12000,
        carbonDelta: null,
        displacedCount: 3,
        cashOccupied: null,
        riskLevel: "MEDIUM",
      },
      feasible: true,
      hardViolations: [],
      affectedOrders: [
        {
          orderId: "Order:O-1",
          orderRef: "SO-2026-0001",
          impact: "延期",
          reProfile: { action: "顺延", promiseDeltaDays: 5, note: "交期后移" },
          provId: "prov_ao_1",
        },
      ],
      proposedActionDraftPayload: { actionTypeKey: "adopt_mitigation" },
      provIds: ["prov_wid"],
    };
    DecisionScenarioSchema.parse(scenario);

    const explanation = {
      explanationId: "ex_0",
      taskId: "task_1",
      tenantId: "demo",
      why: { recommendedKey: "延期", rationale: ["最低延期风险", "成本可接受"] },
      evidenceProvIds: ["prov_wid", "prov_ao"],
      alternatives: [{ scenarioKey: "外协", whyNot: ["外协比过高", "毛利受损"] }],
      decisionTraceRef: "task_1",
      generatedAt: "2026-07-11T00:00:00.000Z",
    };
    ExplanationChainSchema.parse(explanation);

    const pkg = DecisionPackageSchema.parse({
      packageId: "dpkg_0",
      taskId: "task_1",
      tenantId: "demo",
      problem: "未来30天常州基地PACK02产线降低20%产能，哪些客户订单无法按期交付？",
      requirementGraphId: null,
      executionPlanId: null,
      reasoning,
      counterfactuals: [],
      scenarios: [scenario],
      recommendation: {
        recommendedKey: "延期",
        method: "multi_plan_compare",
        weights: null,
        compareMatrix: [{ key: "延期", grossMarginPct: 0.31, displacedCount: 3 }],
      },
      explanation,
      provenance: [
        {
          id: "prov_wid",
          source: "TOOL_RESULT",
          toolCallId: "call_1",
          toolName: "what_if_displacement",
          outputPath: "$.schemes[0].marginPct",
        },
      ],
      dataMode: "LIVE",
      status: "READY",
      decisionRef: null,
      actionDraftRefs: [],
      builderVersion: "l2-kernel@1",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    expect(pkg.packageId).toBe("dpkg_0");
    expect(pkg.scenarios).toHaveLength(1);
    // R13：provenance 复用 qos.ProvenanceRef（不重造）——source 枚举有效。
    expect(pkg.provenance[0].source).toBe("TOOL_RESULT");
  });

  it("③ recommendedKey=null 合法（<2 可比方案·诚实不强推·Ch12 诚实边界）", () => {
    const pkg = DecisionPackageSchema.parse({
      packageId: "dpkg_1",
      taskId: "task_2",
      tenantId: "demo",
      problem: "单方案",
      requirementGraphId: null,
      executionPlanId: null,
      reasoning: {
        traceId: "rt_1",
        taskId: "task_2",
        tenantId: "demo",
        requirementGraphId: null,
        executionPlanId: null,
        steps: [],
        builderVersion: "l2-kernel@1",
        generatedAt: "2026-07-11T00:00:00.000Z",
      },
      counterfactuals: [],
      scenarios: [],
      recommendation: { recommendedKey: null, method: "multi_plan_compare", weights: null, compareMatrix: [] },
      explanation: {
        explanationId: "ex_1",
        taskId: "task_2",
        tenantId: "demo",
        why: { recommendedKey: null, rationale: [] },
        evidenceProvIds: [],
        alternatives: [],
        decisionTraceRef: null,
        generatedAt: "2026-07-11T00:00:00.000Z",
      },
      provenance: [],
      dataMode: "PARTIAL",
      status: "DRAFT",
      decisionRef: null,
      actionDraftRefs: [],
      builderVersion: "l2-kernel@1",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    expect(pkg.recommendation.recommendedKey).toBeNull();
  });
});
