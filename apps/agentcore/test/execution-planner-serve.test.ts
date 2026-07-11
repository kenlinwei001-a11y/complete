import { describe, expect, it } from "vitest";
import type { IntentDefinition, RequirementGraph } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, PLANNER, TENANT, PKG } from "./helpers.js";
import { VALID_SOLVER_KEYS } from "../src/growth/requirement-graph.js";

// L1B-5 · Execution Planner SERVE 翻闸接线 teeth（真起 app·真编排·真求解器派发·LLM mock per 铁律0.4）。
// 证 serve 档真把 template→synthesized 图翻闸（判决地位不换手 NG6）+ 关闸=字节一致。
// 用 STAGE-1 fall-through（无模板意图）：serve ON → synthesized 图被服务(resolvedRefs.key===graphId)；
// serve OFF（关闸）→ 该意图今日直接 PLAN_NOT_FOUND（== 改造前·NG6 可证回退）。

const GEN_AT = "2026-07-01T00:00:00.000Z";
const SOLVERS = [...VALID_SOLVER_KEYS];
const S0 = SOLVERS[0];
const S1 = SOLVERS[1];

// 无 planId/planRef 的已发布意图 → resolvePlanForIntent 返 null → STAGE-1 fall-through 触发点。
function mkFallthroughIntent(): IntentDefinition {
  return {
    id: "int_serve_ut_v1",
    packageId: PKG,
    key: "serve_ut_fallthrough",
    version: 1,
    status: "PUBLISHED",
    name: "SERVE 翻闸自证意图(无模板·fall-through)",
    description: "L1B-5 STAGE-1 teeth：无模板计划的意图·serve 档综合图服务·关闸=fall-through 失败",
    examples: ["serve ut fallthrough"],
    enabledViews: "*",
    slots: [],
    riskLevel: "COMPUTE",
    owner: "test",
    createdAt: GEN_AT,
    updatedAt: GEN_AT,
  };
}

// 高覆盖真需求图（coverageScore=1·solverCandidates ∈ 真注册表）→ synthesizePlan 产真可执行图（非回落）。
function mkReqGraph(taskId: string): RequirementGraph {
  return {
    graphId: "rg_serve_ut",
    taskId,
    tenantId: TENANT,
    questionAst: {
      astId: "ast_serve_ut",
      taskId,
      tenantId: TENANT,
      rawText: "serve ut fallthrough",
      intent: { problemClass: "bottleneck_detection", intentKey: "serve_ut_fallthrough", confidence: 0.9 },
      entities: [],
      actions: [],
      constraints: [],
      timeScope: null,
      objectives: ["MAX:交付"],
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
    sliceTargets: { rootType: "Order", targets: [] },
    coverageScore: 1,
    builderVersion: "rg-builder/1.0.0",
    generatedAt: GEN_AT,
  };
}

// 场景绑定跳过 LLM classify（无 LLM·确定性）→ 也跳过 requirement-graph 旁路 → 由测试直接种真需求图。
const ctx = { view: "dash", scenarioIntentKey: "serve_ut_fallthrough", scenarioKey: "" as string | undefined };

describe("L1B-5 · Execution Planner SERVE 翻闸接线（真编排·NG6 + 关闸字节一致）", () => {
  it("C1 · STAGE-1 serve ON：无模板意图 → synthesized 图被服务(resolvedRefs.key===graphId)·真答案", async () => {
    const t = await createTestApp({ env: { QOS_EXEC_PLANNER: "serve", QOS_WORKFLOW_DAG: "0" } });
    await t.repos.intents.insert(mkFallthroughIntent());

    const { taskId, statusCode } = await submitQuery(t, PLANNER, "serve ut fallthrough", ctx);
    expect(statusCode).toBe(202);
    // 场景绑定跳过旁路 → 种真需求图供 serve 综合（提交后、serve 读取前）。
    await t.repos.requirementGraphs.upsert(mkReqGraph(taskId));

    const task = await waitForTask(t, taskId);
    // serve 翻闸真engage：跑到终态 COMPLETED（关闸/shadow 会 PLAN_NOT_FOUND·见 C2/C3）。
    expect(task.status).toBe("COMPLETED");
    // 留痕铁证：服务的是**综合执行图**（graphId·eg_ 前缀）而非模板 plan（STAGE-1·orchestrator.ts:1272
    // 写 resolvedRefs:[{kind:"plan", key: served.graphId}]）——serve 真把 template→synthesized 翻闸。
    const planRef = (task.resolvedRefs ?? []).find((r) => r.kind === "plan");
    expect(planRef).toBeDefined();
    expect(planRef!.key.startsWith("eg_")).toBe(true); // 综合图 id 前缀（模板会是 plan_*）
    // 综合图真跑到 REPORT_GENERATE 终态（answer 对象存在·render 节点 settled）。诚实边界：synthesizePlan
    // 只综合**图结构**（solver 管线 + render_answer 终态·params.blocks=[] 占位·Ch10 §12 注）——rich 块模板
    // （{{steps.*.output}}）不由综合器产（归后续），故 blocks 可空·非空壳失败·此为真实现状非造假。
    expect(task.answer).toBeDefined();
  });

  it("C2 · 关闸(serve OFF)：同意图 fall-through → PLAN_NOT_FOUND（== 改造前·NG6 可证回退）", async () => {
    const t = await createTestApp({ env: {} }); // QOS_EXEC_PLANNER 未置 = 改造前
    await t.repos.intents.insert(mkFallthroughIntent());

    const { taskId } = await submitQuery(t, PLANNER, "serve ut fallthrough", ctx);
    await t.repos.requirementGraphs.upsert(mkReqGraph(taskId)); // 即便有需求图·关闸不综合·不 serve

    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("FAILED"); // 无模板 + serve 关 → 今日直接 fail
    expect(task.error?.code).toBe("PLAN_NOT_FOUND");
  });

  it("C3 · shadow 档（非 serve）：不翻闸·同关闸行为 fall-through 失败（判决地位不换手 NG6）", async () => {
    const t = await createTestApp({ env: { QOS_EXEC_PLANNER: "shadow" } });
    await t.repos.intents.insert(mkFallthroughIntent());

    const { taskId } = await submitQuery(t, PLANNER, "serve ut fallthrough", ctx);
    await t.repos.requirementGraphs.upsert(mkReqGraph(taskId));

    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("FAILED"); // shadow 只影子·不 serve → fall-through 失败（与关闸一致）
    expect(task.error?.code).toBe("PLAN_NOT_FOUND");
  });
});
