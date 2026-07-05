/**
 * WO ONTO-SCEN-CONTRACT · PRD-scenario-ontogenesis §4 契约齿（圆整往返 round-trip）。
 * 三 schema（Maturity / Genome / OntogenesisRun）+ Scenario 增维（maturity/genome/lastOntogenesisRunId），
 * 断言：①PRD §4 形状逐字段可解析 ②parse→JSON serialize→re-parse 深等（圆整往返，落库/过线不丢形）
 * ③additive 不破既有（旧形留痕/旧卡无新字段仍可解析——全套件绿断言不变的地基）。
 */
import { describe, expect, it } from "vitest";
import {
  ScenarioGenomeSchema,
  ScenarioMaturitySchema,
  ScenarioOntogenesisRunSchema,
  ScenarioSchema,
} from "../src/index.js";

/** 圆整往返：parse → JSON 序列化 → 再 parse → 深等（模拟 pg JSONB / HTTP 过线）。 */
function roundTrip<S extends { parse(v: unknown): unknown }>(schema: S, input: unknown): unknown {
  const first = schema.parse(input);
  const second = schema.parse(JSON.parse(JSON.stringify(first)));
  expect(second).toEqual(first);
  return first;
}

describe("ScenarioMaturitySchema（§2.6 相位成熟）", () => {
  it("恰好三相位 PROVISIONAL/ADVISORY/GOVERNED，拒绝其它值", () => {
    expect(ScenarioMaturitySchema.options).toEqual(["PROVISIONAL", "ADVISORY", "GOVERNED"]);
    for (const m of ["PROVISIONAL", "ADVISORY", "GOVERNED"]) expect(ScenarioMaturitySchema.parse(m)).toBe(m);
    expect(() => ScenarioMaturitySchema.parse("READY")).toThrow();
  });
});

describe("ScenarioGenomeSchema（§2.1 基因组=目标闭包单一来源）", () => {
  const genome = {
    intentKey: "capacity_gap",
    planSteps: [
      { type: "resolve_slice", params: { sliceKey: "sl_line_capacity" } },
      { type: "invoke_solver", params: { solverKey: "capacity_fill", args: { horizon: 6 } } },
      { type: "evaluate_rules", params: { ruleIds: ["r_util_cap"] } },
      { type: "create_action_draft", params: {} },
      { type: "render_answer", params: {} },
    ],
    renderBindings: [
      { block: "kpi", fromSolverField: "p50" },
      { block: "table", fromSolverField: "monthly" },
    ],
    ruleIds: ["r_util_cap"],
    sliceTargets: ["ProductionLine", "PlanTarget"],
    solverKey: "capacity_fill",
    dataNeeds: ["ProductionLine", "Order"],
  };

  it("PRD §4 全字段解析 + 圆整往返", () => {
    const parsed = roundTrip(ScenarioGenomeSchema, genome) as typeof genome;
    expect(parsed).toEqual(genome);
  });

  it("ruleIds/sliceTargets/dataNeeds 缺省为 []（§4 default）；solverKey 可缺省", () => {
    const minimal = ScenarioGenomeSchema.parse({ intentKey: "k", planSteps: [], renderBindings: [] });
    expect(minimal.ruleIds).toEqual([]);
    expect(minimal.sliceTargets).toEqual([]);
    expect(minimal.dataNeeds).toEqual([]);
    expect(minimal.solverKey).toBeUndefined();
    roundTrip(ScenarioGenomeSchema, minimal);
  });

  it("planSteps.type 只收 §4 枚举五种（resolve_slice/invoke_solver/evaluate_rules/create_action_draft/render_answer）", () => {
    expect(() =>
      ScenarioGenomeSchema.parse({ ...genome, planSteps: [{ type: "llm_compose", params: {} }] }),
    ).toThrow();
  });
});

describe("ScenarioOntogenesisRunSchema（§4 发育运行一等留痕·三环+验证+缺口+相位）", () => {
  const prdShapeRun = {
    runId: "sor_1",
    tenantId: "demo",
    scenarioKey: "S01",
    ranAt: "2026-07-05T00:00:00.000Z",
    rings: { data: true, ontology: true, capability: true },
    verification: { status: "VERIFIED", path: "WORKFLOW", gapCode: null, answerPreview: "P50=132GWh", taskId: "task_1" },
    gaps: [{ gapCode: "NO_SLICE", disposition: "NEEDS_HUMAN", detail: "切片未覆盖", ticketId: "gtk_1" }],
    maturity: "GOVERNED",
  };

  it("PRD §4 形状（含 tenantId + gaps.ticketId）解析 + 圆整往返", () => {
    const parsed = ScenarioOntogenesisRunSchema.parse(prdShapeRun);
    expect(parsed.tenantId).toBe("demo");
    expect(parsed.gaps[0]!.ticketId).toBe("gtk_1");
    roundTrip(ScenarioOntogenesisRunSchema, prdShapeRun);
  });

  it("verification.status 收 §4 全枚举（含 PROVISIONAL_ANSWER）+ 既有 NOT_RUN（additive）", () => {
    for (const s of ["VERIFIED", "NOT_VERIFIED", "PROVISIONAL_ANSWER", "NOT_RUN"]) {
      const r = ScenarioOntogenesisRunSchema.parse({
        ...prdShapeRun,
        verification: { ...prdShapeRun.verification, status: s },
      });
      expect(r.verification.status).toBe(s);
    }
    expect(() =>
      ScenarioOntogenesisRunSchema.parse({ ...prdShapeRun, verification: { ...prdShapeRun.verification, status: "OK" } }),
    ).toThrow();
  });

  it("additive 不破既有：旧形留痕（无 tenantId、gaps 只带 detail、status NOT_RUN）仍可解析，ticketId 缺省 null", () => {
    const legacy = {
      runId: "sor_legacy",
      scenarioKey: "S02",
      ranAt: "2026-06-01T00:00:00.000Z",
      rings: { data: false, ontology: true, capability: false },
      verification: { status: "NOT_RUN" },
      gaps: [{ gapCode: "MISSING_INTENT", disposition: "AUTO_DERIVE", detail: "意图未发布" }],
      maturity: "PROVISIONAL",
    };
    const parsed = ScenarioOntogenesisRunSchema.parse(legacy);
    expect(parsed.tenantId).toBeUndefined();
    expect(parsed.gaps[0]!.detail).toBe("意图未发布");
    expect(parsed.gaps[0]!.ticketId).toBeNull();
    roundTrip(ScenarioOntogenesisRunSchema, legacy);
  });
});

describe("Scenario 增维（§4：maturity/genome/lastOntogenesisRunId，additive）", () => {
  const baseCard = {
    id: "scn_1",
    tenantId: "demo",
    scenarioKey: "S01",
    name: "产能缺口",
    targetView: "capacity",
    intentKey: "capacity_gap",
    triggerQuestion: "4680-NCM 加 20% 六周能不能接",
    presetContext: { targetView: "capacity", selectedObjects: [], slotPresets: {} },
  };

  it("携 genome + lastOntogenesisRunId 的卡解析 + 圆整往返", () => {
    const card = {
      ...baseCard,
      maturity: "GOVERNED",
      genome: { intentKey: "capacity_gap", planSteps: [], renderBindings: [{ block: "kpi", fromSolverField: "p50" }] },
      lastOntogenesisRunId: "sor_1",
    };
    const parsed = ScenarioSchema.parse(card);
    expect(parsed.genome?.intentKey).toBe("capacity_gap");
    expect(parsed.lastOntogenesisRunId).toBe("sor_1");
    expect(parsed.maturity).toBe("GOVERNED");
    roundTrip(ScenarioSchema, card);
  });

  it("additive 不破既有：旧卡（无 maturity/genome/lastOntogenesisRunId）仍可解析", () => {
    const parsed = ScenarioSchema.parse(baseCard);
    expect(parsed.maturity).toBeUndefined();
    expect(parsed.genome).toBeUndefined();
    expect(parsed.lastOntogenesisRunId).toBeUndefined();
    roundTrip(ScenarioSchema, baseCard);
  });
});
