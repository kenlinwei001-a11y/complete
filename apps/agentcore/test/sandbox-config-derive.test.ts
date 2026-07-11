import { describe, expect, it } from "vitest";
import {
  PROPAGATION_STATE_VAR,
  deriveSandboxConfigNeeds,
  hasPropagationSemantics,
  sandboxConfigNeedKeys,
  type ClassificationResult,
  type HiddenReqGraph,
  type MaterializedIntent,
  type QuestionAst,
} from "@platform/contracts";
import { QUESTION_AST_PARSER_VERSION, buildRequirementGraph } from "../src/growth/requirement-graph.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { preAnalyzeQuery, type PreAnalyzeDeps } from "../src/growth/pre-analyze.js";

// ═══════════════════════════════════════════════════════════════════════════
// WO-SANDBOX-CONFIG-DERIVE（补 S0 §3.4 悬置接缝）· 传导语义 → 沙盘配套需求真派生单测
//   T1 green→red 齿：含传导语义的故事（设备故障传导到订单）→ 产 propagation_rule 需求（S0 前恒空）；
//   T2 no-false-positive 齿：纯查询（无扰动/无 affects）→ 零派生（不凭空报配套）；
//   T3 affects 边触发：链路语义="影响"（无扰动事件）→ 亦触发（传导本身）；
//   T4 零幽灵：所有派生需求引用的类型/链路 ∈ RG 真本体节点/边（三白名单同源·requirement-graph:check 同律）；
//   T5 R6：同 RG 双跑字节一致；
//   T6 端到端接缝：sandboxConfigDeriveEnabled → preAnalyzeQuery 的 required 补两类 → gap 真诊断；关闸零变化。
// ═══════════════════════════════════════════════════════════════════════════

const GEN_AT = "2026-07-11T00:00:00.000Z";

// 真本体图夹具（节点=真类型键·边=真 LinkType·端点约定 n-<typeKey>）。
const PUBLISHED = ["Equipment", "Line", "Base", "Model", "Order", "Shipment"];
const GRAPH: HiddenReqGraph = {
  nodes: PUBLISHED.map((key) => ({ key })),
  edges: [
    { from: "n-Equipment", to: "n-Line", label: "equipment_on_line" },
    { from: "n-Line", to: "n-Base", label: "line_belongs_to_base" },
    { from: "n-Order", to: "n-Model", label: "order_for_model" },
    { from: "n-Model", to: "n-Base", label: "model_producible_at" },
  ],
};

/** 含传导语义的故事 AST：设备停机（扰动事件 SHUTDOWN）+ Equipment/Line/Order 实体。 */
function makePropagationAst(overrides: Partial<QuestionAst> = {}): QuestionAst {
  return {
    astId: "ast_prop",
    taskId: "t_prop",
    tenantId: "demo",
    rawText: "设备故障导致产线停机20%，传导到订单交付延期，影响哪些订单？",
    intent: { problemClass: "affected_scope_enumeration", intentKey: "affected_orders", confidence: 0.92 },
    entities: [
      { text: "设备", ontologyType: "Equipment", objectId: null, resolved: true, source: "exact", confidence: 1 },
      { text: "产线", ontologyType: "Line", objectId: null, resolved: true, source: "exact", confidence: 1 },
      { text: "订单", ontologyType: "Order", objectId: null, resolved: true, source: "exact", confidence: 1 },
    ],
    actions: [{ type: "SHUTDOWN", targetType: "Equipment", value: "20%" }],
    constraints: [],
    timeScope: null,
    objectives: [],
    outputs: ["订单"],
    parserVersion: QUESTION_AST_PARSER_VERSION,
    generatedAt: GEN_AT,
    ...overrides,
  };
}

describe("deriveSandboxConfigNeeds · T1 green→red 齿（含传导语义 → 产 propagation_rule 需求）", () => {
  it("设备故障传导到订单：沿真链路产 propagation_rule + state_var 需求（S0 前该数组恒空=红）", () => {
    const rg = buildRequirementGraph({ ast: makePropagationAst(), graph: GRAPH, generatedAt: GEN_AT, hiddenReqEnabled: false });
    const needs = deriveSandboxConfigNeeds(rg);

    // 含传导语义 → 触发。
    expect(hasPropagationSemantics(rg)).toBe(true);
    // 至少一条传导规则需求（S0 前 comprehend/preAnalyze 两数组恒空 → 此断言无本 WO 即红）。
    expect(needs.propagationRuleNeeds.length).toBeGreaterThan(0);

    // Equipment→Line 真链路边 → 对应传导规则需求（键含真类型+真链路 key·sourceStateVar/targetStateVar=抽象 load）。
    const eqLine = needs.propagationRuleNeeds.find((r) => r.viaLinkKey === "equipment_on_line");
    expect(eqLine).toBeTruthy();
    expect(eqLine!.key).toBe("pr_Equipment__equipment_on_line__Line");
    expect(eqLine!.sourceStateVar).toBe(PROPAGATION_STATE_VAR);
    expect(eqLine!.targetStateVar).toBe(PROPAGATION_STATE_VAR);

    // 传导链两端对象类型 → state_var 需求（Equipment/Line 均在）。
    const svTypes = new Set(needs.stateVarNeeds.map((s) => s.typeKey));
    expect(svTypes.has("Equipment")).toBe(true);
    expect(svTypes.has("Line")).toBe(true);
    expect(needs.stateVarNeeds.every((s) => s.stateVar === PROPAGATION_STATE_VAR)).toBe(true);
  });
});

describe("deriveSandboxConfigNeeds · T2 no-false-positive 齿（纯查询无传导 → 零派生）", () => {
  it("无扰动事件、无 affects 边（纯罗列）→ 空需求（不凭空报配套·同 S0 F4 惰性）", () => {
    // 同实体/同真图，但去掉扰动事件（actions:[]）——GRAPH 边 label 语义无"影响/impact"（on/belongs/for/at）。
    const rg = buildRequirementGraph({ ast: makePropagationAst({ actions: [] }), graph: GRAPH, generatedAt: GEN_AT, hiddenReqEnabled: false });
    expect(hasPropagationSemantics(rg)).toBe(false);
    const needs = deriveSandboxConfigNeeds(rg);
    expect(needs.propagationRuleNeeds).toEqual([]);
    expect(needs.stateVarNeeds).toEqual([]);
  });
});

describe("deriveSandboxConfigNeeds · T3 affects 边触发（传导语义=链路'影响'语义·无扰动事件亦触发）", () => {
  it("链路 label 语义为'影响'→ affects 边 → 触发派生", () => {
    const affectsGraph: HiddenReqGraph = {
      nodes: PUBLISHED.map((key) => ({ key })),
      edges: [{ from: "n-Equipment", to: "n-Line", label: "equipment_affects_line" }],
    };
    // 无 action（actions:[]）——纯靠 affects 边触发。
    const ast = makePropagationAst({
      actions: [],
      entities: [
        { text: "设备", ontologyType: "Equipment", objectId: null, resolved: true, source: "exact", confidence: 1 },
        { text: "产线", ontologyType: "Line", objectId: null, resolved: true, source: "exact", confidence: 1 },
      ],
    });
    const rg = buildRequirementGraph({ ast, graph: affectsGraph, generatedAt: GEN_AT, hiddenReqEnabled: false });
    // 该边被 linkKindOf 折为 affects（"affect" 命中）。
    expect(rg.edges.some((e) => e.kind === "affects")).toBe(true);
    expect(hasPropagationSemantics(rg)).toBe(true);
    const needs = deriveSandboxConfigNeeds(rg);
    expect(needs.propagationRuleNeeds.some((r) => r.viaLinkKey === "equipment_affects_line")).toBe(true);
  });
});

describe("deriveSandboxConfigNeeds · T4 零幽灵（引用类型/链路 ∈ RG 真本体节点/边）", () => {
  it("所有 state_var typeKey ∈ 发布类型·所有 propagation viaLinkKey ∈ 真链路 label", () => {
    const rg = buildRequirementGraph({ ast: makePropagationAst(), graph: GRAPH, generatedAt: GEN_AT, hiddenReqEnabled: true });
    const needs = deriveSandboxConfigNeeds(rg);
    const publishedTypes = new Set(GRAPH.nodes.map((n) => n.key));
    const realLinks = new Set(GRAPH.edges.map((e) => e.label));
    for (const s of needs.stateVarNeeds) expect(publishedTypes.has(s.typeKey), `${s.typeKey} ∈ 发布类型`).toBe(true);
    for (const r of needs.propagationRuleNeeds) {
      expect(realLinks.has(r.viaLinkKey), `${r.viaLinkKey} ∈ 真链路`).toBe(true);
      // 键内嵌的两类型也须∈发布类型（pr_<S>__<link>__<T>）。
      const m = /^pr_(.+)__(.+)__(.+)$/.exec(r.key)!;
      expect(publishedTypes.has(m[1]!)).toBe(true);
      expect(publishedTypes.has(m[3]!)).toBe(true);
    }
  });
});

describe("deriveSandboxConfigNeeds · T5 R6 确定性（同 RG 双跑字节一致·键升序去重）", () => {
  it("双跑字节一致 + 需求键升序", () => {
    const rg = buildRequirementGraph({ ast: makePropagationAst(), graph: GRAPH, generatedAt: GEN_AT, hiddenReqEnabled: true });
    const a = deriveSandboxConfigNeeds(rg);
    const b = deriveSandboxConfigNeeds(rg);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const prKeys = a.propagationRuleNeeds.map((r) => r.key);
    expect(prKeys).toEqual([...prKeys].sort());
    const svKeys = a.stateVarNeeds.map((s) => `${s.typeKey}.${s.stateVar}`);
    expect(svKeys).toEqual([...svKeys].sort());
  });
});

// —— T6 端到端接缝：派生需求经 preAnalyzeQuery 并入 required → diffGap 真诊断（含关闸对照）——

const classification = (intentKeys: string[]): ClassificationResult => ({
  candidates: intentKeys.map((k) => ({ intentKey: k, confidence: 0.9 })),
  outOfCatalog: false,
  extractedSlots: {},
  latencyMs: 0,
  model: "deterministic:test",
});

const mi = (over: Partial<MaterializedIntent> & { key: string }): MaterializedIntent => ({
  id: `mint_${over.key}`, tenantId: "demo", key: over.key, name: over.key, description: "", examples: [], slots: [],
  mode: "WORKFLOW_FIRST",
  bindings: { solverKey: "", ruleKeys: [], constraintKeys: [], skillId: "", ontologySliceKey: "" },
  status: "PUBLISHED", version: 1, ...over,
});

/** A 栈快照 fetch（含 state_var/propagation_rule 现状 → snapshotAvailable=true·两类不被诚实降级丢弃）。 */
const snapshotFetch = (snapshot: Record<string, string[]>): typeof fetch =>
  (async () => ({ ok: true, json: async () => snapshot })) as unknown as typeof fetch;

describe("preAnalyzeQuery · T6 接缝（sandboxConfigDeriveEnabled → 沙盘配套需求经 RG 传导语义真诊断）", () => {
  const buildDeps = (): PreAnalyzeDeps => ({
    repos: createMemoryRepos(),
    config: { DATACORE_BASE_URL: "http://x", SERVICE_TOKEN: "svc" },
    // 现状：Equipment.load 状态变量已有 + 无任何传导规则（→ 派生的规则全 MISSING·派生的 Line.load MISSING）。
    fetchImpl: snapshotFetch({
      solver: ["affected_orders"], rule: [], slice: [], ontology_type: [], dataset: [], kb_doc: [],
      state_var: ["Equipment.load"], propagation_rule: [],
    }),
  });

  const seed = async (deps: PreAnalyzeDeps) => {
    await deps.repos.materializedIntents.upsert(mi({ key: "affected_orders", bindings: { solverKey: "affected_orders", ruleKeys: [], constraintKeys: [], skillId: "", ontologySliceKey: "" } }));
    // 存 RG（= orchestrator sideband 产物·本 task 的传导语义图）。
    const rg = buildRequirementGraph({ ast: makePropagationAst({ taskId: "task_derive" }), graph: GRAPH, generatedAt: GEN_AT, hiddenReqEnabled: false });
    await deps.repos.requirementGraphs.upsert(rg);
  };

  const run = (deps: PreAnalyzeDeps, sandboxConfigDeriveEnabled: boolean) =>
    preAnalyzeQuery(deps, {
      tenantId: "demo", taskId: "task_derive", query: "设备故障传导到订单交付？",
      classification: classification(["affected_orders"]), generatedAt: GEN_AT, sandboxConfigDeriveEnabled,
    });

  it("开闸：RG 传导语义 → gap 出现 propagation_rule/state_var 两类（派生的规则 MISSING·已有 Equipment.load EXISTS）", async () => {
    const deps = buildDeps();
    await seed(deps);
    const report = await run(deps, true);
    const kinds = new Set(report.gapAnalysis!.entries.map((e) => e.kind));
    expect(kinds.has("propagation_rule")).toBe(true);
    expect(kinds.has("state_var")).toBe(true);
    const flat = report.gapAnalysis!.entries.flatMap((e) => e.items.map((i) => ({ kind: e.kind, ...i })));
    // 派生的 Equipment→Line 传导规则 MISSING（现状无传导规则·咨询信号 WARNING 非误红）。
    const pr = flat.find((f) => f.kind === "propagation_rule" && f.key === "pr_Equipment__equipment_on_line__Line")!;
    expect(pr.status).toBe("MISSING");
    expect(pr.severity).toBe("WARNING");
    // Equipment.load 现状已有 → EXISTS；Line.load 现状缺 → MISSING。
    expect(flat.find((f) => f.kind === "state_var" && f.key === "Equipment.load")!.status).toBe("EXISTS");
    expect(flat.find((f) => f.kind === "state_var" && f.key === "Line.load")!.status).toBe("MISSING");
    // §10：预分析永不 BLOCKER/ERROR。
    expect(flat.every((f) => f.severity !== "BLOCKER" && f.severity !== "ERROR")).toBe(true);
  });

  it("关闸（默认）：sandboxConfigDeriveEnabled=false → 不据 RG 派生 → 两类不出现（S0 原行为字节一致）", async () => {
    const deps = buildDeps();
    await seed(deps);
    const report = await run(deps, false);
    const kinds = new Set(report.gapAnalysis!.entries.map((e) => e.kind));
    expect(kinds.has("propagation_rule")).toBe(false);
    expect(kinds.has("state_var")).toBe(false);
  });

  it("sandboxConfigNeedKeys 命名空间与 provisioners.planned 一字不差（state_var=`Type.var`·propagation_rule=key）", () => {
    const rg = buildRequirementGraph({ ast: makePropagationAst(), graph: GRAPH, generatedAt: GEN_AT, hiddenReqEnabled: false });
    const keys = sandboxConfigNeedKeys(deriveSandboxConfigNeeds(rg));
    expect(keys.state_var).toContain("Equipment.load");
    expect(keys.state_var).toContain("Line.load");
    expect(keys.propagation_rule).toContain("pr_Equipment__equipment_on_line__Line");
  });
});
