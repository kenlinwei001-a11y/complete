import { describe, expect, it } from "vitest";
import type { ExecutionPlan, RequirementGraph, TaskNode } from "@platform/contracts";
import { validateExecutionGraph } from "@platform/contracts";
import { VALID_SOLVER_KEYS } from "../src/growth/requirement-graph.js";
import {
  buildPlannerShadowRecord,
  diffPlannerShadow,
  isFallbackGraph,
  pickBestAgent,
  pickBestSkill,
  scoreSkill,
  synthesizePlan,
  type PlannerRegistries,
} from "../src/growth/execution-planner.js";
import { createTestApp, submitQuery, waitForTask, PLANNER } from "./helpers.js";

// ═══════════════════════════════════════════════════════════════════════════
// L1-B WO-L1B-4 · Execution Planner synthesizePlan（Ch10 满配·纯函数 R6）+ 影子接线
// PRD-L1B-execution-planner-workflow-runtime.md §4.1 / §8 acceptance C1-C5。
// ═══════════════════════════════════════════════════════════════════════════

const SOLVERS = [...VALID_SOLVER_KEYS].sort();
const S0 = SOLVERS[0]!;
const S1 = SOLVERS[1]!;
const SLICES = ["capacity_rollup", "inventory_rollup"];
const GEN_AT = "1970-01-01T00:00:00.000Z";

function mkReqGraph(over: Partial<RequirementGraph> = {}): RequirementGraph {
  return {
    graphId: "rg_ut",
    taskId: "task_ut",
    tenantId: "demo",
    questionAst: {
      astId: "ast_ut",
      taskId: "task_ut",
      tenantId: "demo",
      rawText: "产能瓶颈与交付影响？",
      intent: { problemClass: "bottleneck_detection", intentKey: "bottleneck_detection", confidence: 0.9 },
      entities: [],
      actions: [],
      constraints: [],
      timeScope: null,
      objectives: ["MAX:交付", "MIN:成本"],
      outputs: [],
      parserVersion: "rg-ast/1.0.0",
      generatedAt: GEN_AT,
    },
    nodes: [
      { nodeId: "object:Order", kind: "object", name: "Order", ontologyType: "Order", roleType: null, solverKey: null, required: true, confidence: 1, source: "ast:entity", refKey: null },
    ],
    edges: [],
    problemClass: "bottleneck_detection",
    solverCandidates: [S0, S1],
    dataRequirements: [{ roleType: "capacity_rollup", minRows: 1 }],
    sliceTargets: { rootType: "Order", targets: SLICES },
    coverageScore: 1,
    builderVersion: "rg-builder/1.0.0",
    generatedAt: GEN_AT,
    ...over,
  };
}

const registries: PlannerRegistries = { validSolverKeys: VALID_SOLVER_KEYS, sliceKeys: new Set(SLICES) };
const opts = { generatedAt: GEN_AT, intentKey: "bottleneck_detection" };

const solverNode: TaskNode = {
  nodeId: `node_solver_${S0}`,
  kind: "SOLVER_RUN",
  step: { id: "x", type: "invoke_solver", params: { solverKey: S0, args: {} } },
  dependsOn: [],
  onError: "FAIL",
  source: `rg:solver:${S0}`,
  assignedSkillId: null,
  assignedAgentId: null,
};

function mkSkill(key: string, criteria?: string[]) {
  return {
    id: `skl_${key}`, tenantId: "demo", key, version: 1, name: key, summary: "", body: "",
    resources: [], mcpServers: [], status: "PUBLISHED" as const,
    ...(criteria ? { methodology: { conclusionTemplate: "", criteria } } : {}),
  };
}

describe("L1B-4 · synthesizePlan（Ch10 满配·纯函数 R6）", () => {
  it("C1 · 真需求图 → 综合图：节点全∈注册表·DAG 无环·管线+并行", () => {
    const g = synthesizePlan(mkReqGraph(), registries, opts);
    expect(isFallbackGraph(g)).toBe(false);
    const v = validateExecutionGraph(g, { solverKeys: VALID_SOLVER_KEYS, sliceKeys: new Set(SLICES) });
    expect(v.ok).toBe(true); // Kahn 无环 + 节点∈注册表
    // 每 invoke_solver.solverKey ∈ 真白名单。
    for (const n of g.nodes) {
      if (n.step.type === "invoke_solver") expect(VALID_SOLVER_KEYS.has(n.step.params.solverKey)).toBe(true);
    }
    // Ch10.13 管线：后一求解器 depends_on 前一。
    const first = g.nodes.find((n) => n.nodeId === `node_solver_${S0}`)!;
    const second = g.nodes.find((n) => n.nodeId === `node_solver_${S1}`)!;
    expect(second.dependsOn).toContain(first.nodeId);
    // Ch10.12 并行：两 slice 入度0 并行前沿。
    expect(g.entryNodes.length).toBe(2);
    // Ch10.14 多目标向量（排序·去重）。
    expect(g.objectiveVector).toEqual(["MAX:交付", "MIN:成本"]);
    // 终态 render 扇入。
    expect(g.nodes.some((n) => n.step.type === "render_answer")).toBe(true);
  });

  it("C2 · R6 双跑字节一致（无时钟/随机）", () => {
    const a = synthesizePlan(mkReqGraph(), registries, opts);
    const b = synthesizePlan(mkReqGraph(), registries, opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("覆盖门 <0.8 → 诚实回落模板（绝不产非法图）", () => {
    const template: ExecutionPlan = {
      id: "plan_ut", packageId: "pkg", key: "bottleneck_detection", version: 1, status: "PUBLISHED",
      steps: [
        { id: "t1", type: "resolve_slice", params: { sliceKey: "capacity_rollup", args: {} }, onError: "SKIP" },
        { id: "t2", type: "invoke_solver", params: { solverKey: S0, args: {} } },
        { id: "t3", type: "render_answer", params: { blocks: [] } },
      ],
    };
    const g = synthesizePlan(mkReqGraph({ coverageScore: 0.5 }), registries, { ...opts, templateFallback: template });
    expect(isFallbackGraph(g)).toBe(true);
    expect(validateExecutionGraph(g, { solverKeys: VALID_SOLVER_KEYS }).ok).toBe(true);
    const div = diffPlannerShadow(template, g);
    expect(div.fellBackToTemplate).toBe(true);
    expect(div.sameStepTypeMultiset).toBe(true);
  });

  it("幽灵 solverKey 被 filter 剔除（不入图·R11）", () => {
    const g = synthesizePlan(mkReqGraph({ solverCandidates: [S0, "GHOST_ø"] }), registries, opts);
    expect(g.nodes.some((n) => n.step.type === "invoke_solver" && n.step.params.solverKey === "GHOST_ø")).toBe(false);
  });

  it("无可综合节点（无 slice 无 solver）→ 回落（非非法空图）", () => {
    const g = synthesizePlan(mkReqGraph({ solverCandidates: [], sliceTargets: null }), registries, opts);
    expect(isFallbackGraph(g)).toBe(true);
    expect(validateExecutionGraph(g, { solverKeys: VALID_SOLVER_KEYS }).ok).toBe(true);
  });
});

describe("L1B-4 · Ch10.8 Skill Match / Ch10.9 Agent Assign（确定性·NG5 历史中性1.0）", () => {
  it("scoreSkill：历史/成本因子中性 1.0（诚实·不伪造历史）", () => {
    const sc = scoreSkill(mkSkill(S0, [S0]), solverNode, mkReqGraph(), new Set());
    expect(sc.factors.historicalSuccess).toBe(1.0);
    expect(sc.factors.cost).toBe(1.0);
  });

  it("pickBestSkill：bound skill（scenarioMatch 高）择优胜出 + 双跑确定", () => {
    const skills = [mkSkill(S0, [S0]), mkSkill(`${S0}_alt`, [S0])];
    const bound = new Set([S0]);
    const p1 = pickBestSkill(solverNode, skills, mkReqGraph(), bound);
    const p2 = pickBestSkill(solverNode, skills, mkReqGraph(), bound);
    expect(p1?.skillKey).toBe(S0);
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });

  it("pickBestAgent：能力交集（scopeDeclaration.objectTypes ∩ 需求图对象）确定性", () => {
    const agents = [
      { id: "agt_a", tenantId: "demo", key: "supply", version: 1, status: "PUBLISHED" as const, scopeDeclaration: { objectTypes: ["Order"], toolNames: [] } },
      { id: "agt_b", tenantId: "demo", key: "finance", version: 1, status: "PUBLISHED" as const, scopeDeclaration: { objectTypes: ["Invoice"], toolNames: [] } },
    ];
    const a1 = pickBestAgent(agents as never, mkReqGraph());
    const a2 = pickBestAgent(agents as never, mkReqGraph());
    expect(a1?.agentId).toBe("agt_a");
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
  });

  it("综合图对本体匹配的 solver 节点确定性指派 skill（诚实·仅匹配处指派）", () => {
    const withSkills: PlannerRegistries = { ...registries, skills: [mkSkill(S0, [S0])], boundSkillKeys: new Set([S0]) };
    const g1 = synthesizePlan(mkReqGraph(), withSkills, opts);
    const g2 = synthesizePlan(mkReqGraph(), withSkills, opts);
    // 本体匹配的 S0 求解器节点获指派；确定性（双跑同图）。
    const s0node = g1.nodes.find((n) => n.nodeId === `node_solver_${S0}`)!;
    expect(s0node.assignedSkillId).toBe(`skl_${S0}`);
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  });
});

describe("L1B-4 · diffPlannerShadow / buildPlannerShadowRecord（parity 聚合口·C4）", () => {
  it("综合图 vs 模板 divergence（拓扑差·非回落）", () => {
    const g = synthesizePlan(mkReqGraph(), registries, opts);
    const template: ExecutionPlan = {
      id: "plan_ut", packageId: "pkg", key: "bottleneck_detection", version: 1, status: "PUBLISHED",
      steps: [{ id: "t1", type: "render_answer", params: { blocks: [] } }],
    };
    const div = diffPlannerShadow(template, g);
    expect(div.fellBackToTemplate).toBe(false);
    expect(div.templateStepCount).toBe(1);
    expect(div.synthesizedNodeCount).toBe(g.nodes.length);
    expect(div.addedStepTypes.length).toBeGreaterThan(0); // 综合多出 slice/solver 步
    const rec = buildPlannerShadowRecord(mkReqGraph(), g, div);
    expect(rec.graphId).toBe(g.graphId);
    expect(rec.coverageScore).toBe(1);
    expect(rec.intentKey).toBe("bottleneck_detection");
  });
});

describe("L1B-4 · 影子接线（shadow only·暗发·NG6 additive·可回退）", () => {
  const QUERY = "影响哪些订单？";
  // affected_orders 需 base 槽 → 经 selectedObjects 带入 → 进 Path A（runPathA·影子段所在）。
  const CTX = { view: "risk", selectedObjects: [{ objectType: "Base", objectId: "base_changzhou", label: "常州" }] };
  const classifyAffected = () => ({ candidates: [{ intentKey: "affected_orders", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
  const done = (x: { status: string }) => x.status === "COMPLETED";

  it("C3 · 影子期零用户可见变化：flag-ON(shadow) vs baseline answer 逐字节一致", async () => {
    // baseline：仅 QOS_REQUIREMENT_GRAPH=1（需求图旁路）·无 planner 影子。
    const base = await createTestApp({ env: { QOS_REQUIREMENT_GRAPH: "1" } });
    base.llm.queueClassification(classifyAffected());
    const b = await submitQuery(base, PLANNER, QUERY, CTX);
    const baseTask = await waitForTask(base, b.taskId, done);

    // shadow：QOS_REQUIREMENT_GRAPH=1 + QOS_EXEC_PLANNER=shadow（planner 影子跑）。
    const shadow = await createTestApp({ env: { QOS_REQUIREMENT_GRAPH: "1", QOS_EXEC_PLANNER: "shadow" } });
    shadow.llm.queueClassification(classifyAffected());
    const s = await submitQuery(shadow, PLANNER, QUERY, CTX);
    const shadowTask = await waitForTask(shadow, s.taskId, done);

    // NG6：answer 逐字节一致（影子不改判决/路由/answer）。归一化每实例随机 ULID（prov_/tc_·
    // 跨 app 实例天然不同·与 planner flag 无关）后对比——证影子零改答案内容/结构。
    const norm = (a: unknown) => JSON.stringify(a).replace(/(?:prov_|tc_)[0-9A-Z]+/g, "ID");
    expect(shadowTask.status).toBe(baseTask.status);
    expect(norm(shadowTask.answer)).toBe(norm(baseTask.answer));
    // 影子确实跑了（否则 NG6 test 无意义）。
    expect(shadow.deps.orchestrator.getPlannerShadow(s.taskId)).toBeDefined();
  });

  it("C4 · 影子期落 divergence 记录（sideband·可读·按 intent 聚合）", async () => {
    const t = await createTestApp({ env: { QOS_REQUIREMENT_GRAPH: "1", QOS_EXEC_PLANNER: "shadow" } });
    t.llm.queueClassification(classifyAffected());
    const { taskId } = await submitQuery(t, PLANNER, QUERY, CTX);
    await waitForTask(t, taskId, done);
    const rec = t.deps.orchestrator.getPlannerShadow(taskId);
    expect(rec).toBeDefined();
    expect(rec!.taskId).toBe(taskId);
    expect(rec!.intentKey).toBe("affected_orders");
    expect(rec!.divergence).toBeDefined();
    expect(typeof rec!.divergence.synthesizedNodeCount).toBe("number");
  });

  it("回退：QOS_EXEC_PLANNER 未置 → 无影子记录（关闸=改造前系统）", async () => {
    const t = await createTestApp({ env: { QOS_REQUIREMENT_GRAPH: "1" } });
    t.llm.queueClassification(classifyAffected());
    const { taskId } = await submitQuery(t, PLANNER, QUERY, CTX);
    await waitForTask(t, taskId, done);
    expect(t.deps.orchestrator.getPlannerShadow(taskId)).toBeUndefined();
  });
});
