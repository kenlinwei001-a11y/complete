import { describe, expect, it } from "vitest";
import { DecisionPackageSchema } from "@platform/contracts";
import {
  assembleDecisionPackage,
  validateDecisionPackage,
  type DecisionKernelDeps,
  type DecisionKernelRequest,
} from "../src/decision/kernel.js";

/**
 * WO-L2-3 齿（§4.3 / acceptance ①②③④⑤⑥）：
 *  ① scenarios[] 量化+挤占+毛利+受影响+逐单再方案（逐值对账求解器字段·V2）；
 *  ② 推荐确定性 + recommendedKey=null if <2（V3）；
 *  ③ KILL-MOCK 测谎 green→red（V5·注入幽灵方案/无 provId 数字/伪造 delta → validate 报违例）；
 *  ④ explanation 每数字有 provId·alternatives 有据（V4）；
 *  ⑤ R6 双跑字节一致（整包级·V6）；
 *  ⑥ 每 metric/delta/recommendedKey 必可溯 provId（凑不出=null）。
 */

// 真求解器输出形 fixtures
const whatIfDisplacementOut = {
  base: "BASE_CZ",
  displacedOrders: [
    { so: "SO-1001", cust: "宁德", pri: "高", qty: 500, marginPct: 0.28, displaceDays: 5, penaltyWan: 12, reScheme: "延期5天", reSchemes: ["延期5天", "外协消化"] },
    { so: "SO-1002", cust: "比亚迪", pri: "中", qty: 300, marginPct: 0.31, displaceDays: 3, penaltyWan: 6, reScheme: "拆单分线", reSchemes: ["拆单分线"] },
  ],
  totalDisplaced: 2,
  schemes: [
    { key: "delay", name: "延期在手单", feasible: true, displacedCount: 2, promiseDeltaDays: 5, marginPct: 0.30, outsourceRatio: 0, penaltyTotalWan: 18, cashOccupiedWan: 40, note: "" },
    { key: "outsource", name: "外协消化", feasible: true, displacedCount: 1, promiseDeltaDays: 2, marginPct: 0.25, outsourceRatio: 0.3, penaltyTotalWan: 8, cashOccupiedWan: 60, note: "" },
    { key: "split", name: "拆单分线", feasible: false, displacedCount: 0, promiseDeltaDays: 0, marginPct: 0.20, outsourceRatio: 0, penaltyTotalWan: 0, cashOccupiedWan: 0, note: "无认证线" },
  ],
  recommended: "delay",
  dataMode: "LIVE",
};

const multiPlanCompareOut = {
  matrix: [
    { key: "delay", name: "延期在手单", feasible: true, promiseDeltaDays: 5, marginPct: 0.30, displacedCount: 2, outsourceRatio: 0, cashOccupiedWan: 40 },
    { key: "outsource", name: "外协消化", feasible: true, promiseDeltaDays: 2, marginPct: 0.25, displacedCount: 1, outsourceRatio: 0.3, cashOccupiedWan: 60 },
  ],
  recommendedKey: "delay",
  dims: [],
  comparedCount: 2,
  note: "",
  dataMode: "LIVE",
};

const counterfactualTimelineOut = {
  baselineSeries: [12.4, 18.9, 40.2],
  mitigatedSeries: [12.4, 15.1, 22.6],
  threshold: 30,
  factor: "capacity_drop",
  base: "常州基地",
  mitigation: "跨基地调拨",
  delta: { peakCut: 17.6, crossDelayDays: 2, ordersSaved: 3 },
  events: [],
  summary: "",
};

function makeDeps(): DecisionKernelDeps {
  return {
    invokeSolver: async (key) => {
      if (key === "what_if_displacement") return { ...whatIfDisplacementOut };
      if (key === "multi_plan_compare") return { ...multiPlanCompareOut };
      if (key === "counterfactual_timeline") return { ...counterfactualTimelineOut };
      if (key === "affected_orders") return { problems: [], rows: [], affected: [] };
      if (key === "plan_rootcause") return { kpis: [], dag: { nodes: [], edges: [] } };
      throw new Error(`unexpected ${key}`);
    },
  };
}

const req: DecisionKernelRequest = {
  taskId: "task_asm_1",
  tenantId: "demo",
  query: "常州PACK02降20%产能，给优化方案",
  intentKey: "risk_affected_orders",
  slots: { baseId: "BASE_CZ", base: "常州基地", factor: "capacity_drop", horizon: 30 },
  requirementGraphId: null,
  executionPlanId: null,
  generatedAt: "2026-07-11T00:00:00.000Z",
  builderVersion: "l2-kernel@1",
};

describe("WO-L2-3 · Decision Package 装配 + Pareto 推荐 + Explanation", () => {
  it("① scenarios 逐值对账求解器字段（毛利/挤占/受影响/逐单再方案）", async () => {
    const pkg = await assembleDecisionPackage(makeDeps(), req);
    DecisionPackageSchema.parse(pkg);
    const delay = pkg.scenarios.find((s) => s.key === "delay")!;
    expect(delay.sourceSolverKey).toBe("what_if_displacement");
    expect(delay.metrics.grossMarginPct).toBe(0.30); // = schemes[0].marginPct
    expect(delay.metrics.displacedCount).toBe(2);
    expect(delay.metrics.cashOccupied).toBe(40);
    // 受影响 + 逐单再方案（so→orderId, displaceDays→promiseDeltaDays, reScheme→action）
    expect(delay.affectedOrders).toHaveLength(2);
    expect(delay.affectedOrders[0].orderId).toBe("SO-1001");
    expect(delay.affectedOrders[0].reProfile).toEqual({ action: "延期5天", promiseDeltaDays: 5, note: "延期5天；外协消化" });
    // 不可行方案诚实：feasible=false + hardViolations 列 note
    const split = pkg.scenarios.find((s) => s.key === "split")!;
    expect(split.feasible).toBe(false);
    expect(split.hardViolations).toEqual(["无认证线"]);
  });

  it("② 推荐确定性 = multi_plan_compare.recommendedKey；compareMatrix 溯自方案字段", async () => {
    const pkg = await assembleDecisionPackage(makeDeps(), req);
    expect(pkg.recommendation.recommendedKey).toBe("delay");
    expect(pkg.recommendation.method).toBe("multi_plan_compare");
    expect(pkg.recommendation.compareMatrix).toHaveLength(2);
  });

  it("② recommendedKey=null 当 multi_plan_compare 报 <2 可比（诚实不强推）", async () => {
    const deps: DecisionKernelDeps = {
      invokeSolver: async (key) => {
        if (key === "what_if_displacement") return { ...whatIfDisplacementOut, schemes: [whatIfDisplacementOut.schemes[0]] };
        if (key === "multi_plan_compare") return { matrix: [], recommendedKey: null, dims: [], comparedCount: 1, note: "可比方案不足2·不强推", dataMode: "LIVE" };
        if (key === "counterfactual_timeline") return { ...counterfactualTimelineOut };
        if (key === "affected_orders") return { problems: [], rows: [], affected: [] };
        if (key === "plan_rootcause") return { kpis: [], dag: { nodes: [], edges: [] } };
        throw new Error(`unexpected ${key}`);
      },
    };
    const pkg = await assembleDecisionPackage(deps, req);
    expect(pkg.recommendation.recommendedKey).toBeNull();
  });

  it("④ explanation：why 有据 + alternatives why-not 有据 + decisionTraceRef=taskId", async () => {
    const pkg = await assembleDecisionPackage(makeDeps(), req);
    expect(pkg.explanation.why.recommendedKey).toBe("delay");
    expect(pkg.explanation.why.rationale.length).toBeGreaterThan(0);
    expect(pkg.explanation.decisionTraceRef).toBe("task_asm_1");
    const outAlt = pkg.explanation.alternatives.find((a) => a.scenarioKey === "split")!;
    expect(outAlt.whyNot).toContain("不可行");
    // 每 evidenceProvId ∈ provenance[]（无死角）
    const provIds = new Set(pkg.provenance.map((p) => p.id));
    for (const pid of pkg.explanation.evidenceProvIds) expect(provIds.has(pid)).toBe(true);
  });

  it("⑤ R6 双跑字节一致（整包·generatedAt 注入·无随机/时钟）", async () => {
    const a = await assembleDecisionPackage(makeDeps(), req);
    const b = await assembleDecisionPackage(makeDeps(), req);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("⑥ 真 kernel 输出经 validateDecisionPackage 零违例（干净）", async () => {
    const pkg = await assembleDecisionPackage(makeDeps(), req);
    expect(validateDecisionPackage(pkg)).toEqual([]);
  });

  it("③ KILL-MOCK green→red：注入幽灵方案/无 provId 数字/伪造 delta/越白名单引擎 → validate 必报", async () => {
    const clean = await assembleDecisionPackage(makeDeps(), req);
    expect(validateDecisionPackage(clean)).toEqual([]); // green

    // 幽灵方案（sourceSolverKey 非真求解器）
    const ghost = structuredClone(clean);
    ghost.scenarios.push({ key: "ghost", name: "凭空", sourceSolverKey: "handwritten", metrics: { deliveryRate: 0.99, grossMarginPct: null, costDelta: null, carbonDelta: null, displacedCount: null, cashOccupied: null, riskLevel: null }, feasible: true, hardViolations: [], affectedOrders: [], proposedActionDraftPayload: null, provIds: [] });
    expect(validateDecisionPackage(ghost).some((v) => /幽灵方案/.test(v))).toBe(true);

    // 无 provId 的数字
    const noProv = structuredClone(clean);
    noProv.scenarios[0].provIds = [];
    expect(validateDecisionPackage(noProv).some((v) => /无 provId/.test(v))).toBe(true);

    // 伪造 delta（cf 有 delta 无 provId）
    const fakeDelta = structuredClone(clean);
    fakeDelta.counterfactuals[0].provIds = [];
    expect(validateDecisionPackage(fakeDelta).some((v) => /伪造 delta/.test(v))).toBe(true);

    // 越白名单引擎
    const badEngine = structuredClone(clean);
    // @ts-expect-error 故意注入非法引擎证 gate 有牙
    badEngine.counterfactuals[0].engine = "handrolled_engine";
    expect(validateDecisionPackage(badEngine).some((v) => /越白名单/.test(v))).toBe(true);

    // 幽灵推荐（recommendedKey 非任何方案键）
    const ghostRec = structuredClone(clean);
    ghostRec.recommendation.recommendedKey = "nonexistent";
    expect(validateDecisionPackage(ghostRec).some((v) => /幽灵推荐/.test(v))).toBe(true);
  });
});
