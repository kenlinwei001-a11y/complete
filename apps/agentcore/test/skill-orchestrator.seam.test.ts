import { beforeEach, describe, expect, it } from "vitest";
import { seedRegistry } from "../src/mocks/seed.js";
import { GraphScheduler } from "../src/skill-orchestrator.js";
import type { DataCoreClient } from "../src/tools/clients.js";
import { ADMIN, createTestApp, debugHeaders, type TestApp } from "./helpers.js";

/**
 * WO-SKILL-ORCHESTRATOR-S1 · SEAM 接缝测试
 *
 * 头号判据（本单存在的意义）：**不测函数，从 HTTP 入口打进去**，用**真实种子技能**组一张两层图，
 * 断言「第二层节点拿到了第一层的输出」——不是「排序对不对」，是**数据真的流过了边**。
 *
 * 接缝跨三段：HTTP 路由（server.ts） × 图编译（contracts/skill-graph.ts） × 调度与节点派发
 * （skill-orchestrator.ts） × 真实种子数据（mocks/seed.ts）× 真实求解通道（dataCore.solver.invoke）。
 * 任一段漏即红。
 */

let t: TestApp;

/** 真实出厂技能（`seedRegistry()` 单一来源，不是测试里手捏的假 skill）。 */
beforeEach(async () => {
  t = await createTestApp();
  for (const s of seedRegistry().skills) await t.repos.skills.insert(s);
});

interface GraphRunResponse {
  runId: string;
  tenantId: string;
  source: string;
  /** R11 收口披露（WO-GRAPH-FANOUT-W2）：declared / synthesized。 */
  renderClosure: string;
  status: string;
  layers: { index: number; nodeIds: string[] }[];
  nodeResults: {
    nodeId: string;
    kind: string;
    layer: number;
    status: string;
    output?: unknown;
    error?: { code: string; message: string };
    resolvedParams?: Record<string, unknown>;
    visibleFrom?: string[];
  }[];
}

async function runGraph(body: unknown, user = ADMIN): Promise<{ statusCode: number; json: () => unknown }> {
  return t.app.inject({
    method: "POST",
    url: "/b/v1/skill-graphs/run",
    headers: debugHeaders(user),
    payload: body as Record<string, unknown>,
  });
}

/**
 * 三层图（WO-GRAPH-FANOUT-W2 起带 R11 render 收口）：
 *   层0  skill 节点   → 载入真实种子技能 `capacity_analysis`（seed.ts:1018 skl_seed_capacity）
 *                       它**真的**声明了 references[{kind:"solver", key:"capacity_forecast"}]
 *   层1  solver 节点  → solverKey 来自 `{{steps.load.output.solverKeys[0]}}`，即**第一层的产物**
 *   层2  render 节点  → 收口（R11），solver_summary 投影第二层产物，fromNode=solve
 *
 * 边就是这条数据的通道。掐掉边 → 第二层解析不到 → FAILED（见「变异反证」用例）。
 */
const TWO_LAYER_GRAPH = {
  nodes: [
    { id: "load", kind: "skill", params: { skillKey: "capacity_analysis" } },
    {
      id: "solve",
      kind: "solver",
      params: {
        solverKey: "{{steps.load.output.solverKeys[0]}}",
        args: { modelId: "4680-NCM", weeks: 8, demandDelta: 0.2 },
      },
    },
    {
      id: "out",
      kind: "render",
      params: {
        blocks: [
          { type: "text", markdown: "产能测算结果" },
          { type: "solver_summary", output: "{{steps.solve.output.data}}", fromNode: "solve" },
        ],
      },
    },
  ],
  edges: [
    { from: "load", to: "solve", kind: "seq" },
    { from: "solve", to: "out", kind: "seq" },
  ],
};

describe("SEAM · 两层 Skill Graph：第二层真的拿到了第一层的输出", () => {
  it("HTTP 入口 → 真实种子技能 → 边 → 求解器：数据流过了边", async () => {
    const res = await runGraph({ graph: TWO_LAYER_GRAPH });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GraphRunResponse;

    // —— 分层正确（这只是前置条件，不是本用例的判据）——
    expect(body.layers).toEqual([
      { index: 0, nodeIds: ["load"] },
      { index: 1, nodeIds: ["solve"] },
      { index: 2, nodeIds: ["out"] },
    ]);
    expect(body.status).toBe("COMPLETED");
    // R11 收口披露：作者自己写了 render → declared
    expect(body.renderClosure).toBe("declared");

    const load = body.nodeResults.find((r) => r.nodeId === "load")!;
    const solve = body.nodeResults.find((r) => r.nodeId === "solve")!;
    expect(load.status).toBe("COMPLETED");
    expect(solve.status).toBe("COMPLETED");

    // —— 第一层产物来自**真实种子技能**（不是测试捏的）——
    const loadOut = load.output as { key: string; version: number; solverKeys: string[] };
    expect(loadOut.key).toBe("capacity_analysis");
    expect(loadOut.version).toBe(1);
    expect(loadOut.solverKeys).toEqual(["capacity_forecast"]);

    // ★★ 头号判据：第二层**解析后的实参**里的 solverKey，正是第一层产出的那个值。
    //    这就是「数据真的流过了边」——不是"排序对了"，是"值到了"。
    expect(solve.resolvedParams?.solverKey).toBe("capacity_forecast");
    expect(solve.resolvedParams?.solverKey).toBe(loadOut.solverKeys[0]);

    // ★★ 而且这个值**真的被用来调求解器了**（不是解析出来就扔）：
    //    mock capacity_forecast 返回 capWanP50/capWanP90/mainBottleneck；
    //    未知求解器走的是通用兜底 `{solverKey, ok:true, args}`——**没有 capWanP50**。
    //    所以 capWanP50 是数字 ⇒ 真的按第一层给的 key 调到了 capacity_forecast，而非兜底。
    const solveOut = solve.output as { solverKey: string; data: Record<string, unknown> };
    expect(solveOut.solverKey).toBe("capacity_forecast");
    expect(typeof solveOut.data.capWanP50).toBe("number");
    expect(typeof solveOut.data.capWanP90).toBe("number");
    expect(solveOut.data.demandDelta).toBe(0.2); // 本节点自己的 args 也真的到达了求解器

    // —— 边 = 可见性授权：第二层能看见第一层，正是因为有这条边 ——
    expect(solve.visibleFrom).toEqual(["load"]);
    expect(load.visibleFrom).toEqual([]);

    // ★ R11 收口执行侧（WO-GRAPH-FANOUT-W2）：render 节点**真的**把上游产物投成了 Answer ——
    //   solver_summary 块来自 `{{steps.solve.output.data}}`（第二层产物），不是静态文案。
    const out = body.nodeResults.find((r) => r.nodeId === "out")!;
    expect(out.status).toBe("COMPLETED");
    expect(out.visibleFrom).toEqual(["solve", "load"]); // ancestorsOf 近端优先传递闭包序
    const answer = out.output as {
      trustLevel: string;
      blocks: { type: string; provId?: string }[];
      provenance: { id: string; toolCallId: string; toolName: string }[];
      unverifiedNumerics: boolean;
    };
    expect(answer.trustLevel).toBe("VERIFIED_WORKFLOW");
    expect(answer.blocks.length).toBeGreaterThan(1); // text + solver_summary 投影块
    expect(answer.blocks.some((b) => b.type === "text")).toBe(true);
    // 投影块真的吃到了求解器输出：capWanP50 是数字 ⇒ 投影里有 KPI/表块（不是空投影）
    expect(answer.blocks.some((b) => b.type === "kpi" || b.type === "table")).toBe(true);
    // 溯源诚实标注：图节点不经 GuardedToolExecutor，toolCallId 标 graph-node: 前缀；
    // provId 确定性（R6：同图两次跑 nodeResults 逐字节一致靠它）
    expect(answer.provenance).toEqual([
      { id: "prov_out_1", toolCallId: "graph-node:solve", toolName: "graph-node", outputPath: "$.data", source: "TOOL_RESULT" },
    ]);
  });

  it("变异反证（掐掉边）：同一张图删掉边 → 第二层拿不到第一层输出 → FAILED", async () => {
    // 唯一改动：edges 置空。节点、params、模板引用一字不改。
    const res = await runGraph({ graph: { ...TWO_LAYER_GRAPH, edges: [] } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GraphRunResponse;

    const solve = body.nodeResults.find((r) => r.nodeId === "solve")!;
    // 边没了 → 第一层的输出对第二层不可见 → 模板解析失败
    expect(solve.status).toBe("FAILED");
    expect(solve.error?.code).toBe("TEMPLATE_RESOLUTION_ERROR");
    expect(solve.error?.message).toContain("steps.load.output.solverKeys[0]");
    expect(solve.visibleFrom).toEqual([]);
    expect(body.status).toBe("FAILED");

    // 对照：第一层自身照常完成 —— 红的是"数据没流过来"，不是"整个图跑不起来"
    expect(body.nodeResults.find((r) => r.nodeId === "load")!.status).toBe("COMPLETED");
  });

  /**
   * ★ 真正咬住「边 = 数据可见性授权」的一条。
   *
   * 为什么需要它：上一条「删掉全部边」的用例**咬不住这个不变量** —— 边都删光时两个节点都成了
   * 入度 0，落在**同一层并发**执行，下游解析模板时上游根本还没产出，于是它照样报
   * TEMPLATE_RESOLUTION_ERROR，但那是**时序**造成的，不是可见性门造成的。
   * （实测：把 scopeFor 改成"谁都能读谁"，那条用例仍然全绿 —— 断言对了、理由错了。）
   *
   * 本用例把时序因素排除干净：`b` 在第 0 层、**先完成**，`c` 在第 1 层、**后执行**，
   * 产物明明已经在手边，但 `c` 与 `b` 之间**没有边** ⇒ 必须仍然读不到。
   * 唯有"祖先才可见"这条规则成立，本用例才会绿。
   */
  it("★ 无边即不可见：上游已完成且产物在手，但没有边连过来 → 仍然读不到", async () => {
    const res = await runGraph({
      graph: {
        nodes: [
          { id: "a", kind: "skill", params: { skillKey: "sop_meeting" } },
          { id: "b", kind: "skill", params: { skillKey: "capacity_analysis" } },
          // c 引用的是 b，但边只有 a→c。b 与 c 之间无边。
          { id: "c", kind: "solver", params: { solverKey: "{{steps.b.output.solverKeys[0]}}" } },
          // R11 收口（W2）：c→out；c 失败时 out 被毒化 SKIPPED，不影响本用例判据。
          { id: "out", kind: "render", params: { blocks: [{ type: "text", markdown: "x" }] } },
        ],
        edges: [
          { from: "a", to: "c", kind: "seq" },
          { from: "c", to: "out", kind: "seq" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GraphRunResponse;

    // 时序前提：b 确实在第 0 层且**已完成**（产物就在手边，不是"还没跑出来"）
    expect(body.layers[0]!.nodeIds).toEqual(["a", "b"]);
    expect(body.layers[1]!.nodeIds).toEqual(["c"]);
    expect(body.nodeResults.find((r) => r.nodeId === "b")!.status).toBe("COMPLETED");

    // 判据：即便如此，c 仍读不到 b —— 因为没有边
    const c = body.nodeResults.find((r) => r.nodeId === "c")!;
    expect(c.visibleFrom).toEqual(["a"]); // 只有 a 是它的祖先
    expect(c.status).toBe("FAILED");
    expect(c.error?.code).toBe("TEMPLATE_RESOLUTION_ERROR");
    expect(c.error?.message).toContain("steps.b.output.solverKeys[0]");
  });

  it("同层并发：两个 solver 兄弟同层，且**都**拿到了第一层的输出", async () => {
    const res = await runGraph({
      graph: {
        nodes: [
          { id: "load", kind: "skill", params: { skillKey: "capacity_analysis" } },
          { id: "solveA", kind: "solver", params: { solverKey: "{{steps.load.output.solverKeys[0]}}", args: { modelId: "4680-NCM", weeks: 8 } } },
          { id: "solveB", kind: "solver", params: { solverKey: "{{steps.load.output.solverKeys[0]}}", args: { modelId: "4680-NCM", weeks: 12 } } },
          { id: "out", kind: "render", params: { blocks: [{ type: "text", markdown: "汇总" }] } },
        ],
        edges: [
          { from: "load", to: "solveA", kind: "parallel" },
          { from: "load", to: "solveB", kind: "parallel" },
          { from: "solveA", to: "out", kind: "seq" },
          { from: "solveB", to: "out", kind: "seq" },
        ],
        maxParallelNodes: 2,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GraphRunResponse;
    expect(body.layers).toEqual([
      { index: 0, nodeIds: ["load"] },
      { index: 1, nodeIds: ["solveA", "solveB"] },
      { index: 2, nodeIds: ["out"] },
    ]);
    for (const id of ["solveA", "solveB"]) {
      const n = body.nodeResults.find((r) => r.nodeId === id)!;
      expect(n.status, id).toBe("COMPLETED");
      expect(n.resolvedParams?.solverKey, id).toBe("capacity_forecast");
      expect(typeof (n.output as { data: Record<string, unknown> }).data.capWanP50, id).toBe("number");
    }
  });
});

describe("SEAM · 环检测有牙（不许静默跑成线性）", () => {
  it("有环的图 → 422 + CYCLIC_INVOCATION + 可读环路径，且一个节点都没跑", async () => {
    const res = await runGraph({
      graph: {
        nodes: [
          { id: "a", kind: "solver", params: { solverKey: "capacity_forecast" } },
          { id: "b", kind: "solver", params: { solverKey: "capacity_forecast" } },
          { id: "c", kind: "solver", params: { solverKey: "capacity_forecast" } },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "a" },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    const err = res.json() as { error: { code: string; message: string; requestId?: string } };
    expect(err.error.code).toBe("CYCLIC_INVOCATION");
    // 可读原因：说得出环在哪，而不是一句「校验失败」
    expect(err.error.message).toContain("a -> b -> c -> a");
    // R7 错误信封统一
    expect(err.error.requestId).toBeTruthy();
  });
});

describe("SEAM · 诚实边界：未实现的节点类型显式 NOT_IMPLEMENTED，不静默跳过", () => {
  it("rule 节点 → 422 NOT_IMPLEMENTED 并点名是哪个节点、哪个 kind", async () => {
    const res = await runGraph({
      graph: {
        nodes: [
          { id: "load", kind: "skill", params: { skillKey: "capacity_analysis" } },
          { id: "checkRules", kind: "rule", params: { ruleIds: ["C03"] } },
        ],
        edges: [{ from: "load", to: "checkRules" }],
      },
    });
    expect(res.statusCode).toBe(422);
    const err = res.json() as { error: { code: string; message: string } };
    expect(err.error.code).toBe("NOT_IMPLEMENTED");
    expect(err.error.message).toContain("checkRules");
    expect(err.error.message).toContain("rule");
  });

  it("cond 边 → 422 NOT_IMPLEMENTED（不许当成 seq 悄悄跑）", async () => {
    const res = await runGraph({
      graph: {
        nodes: [
          { id: "load", kind: "skill", params: { skillKey: "capacity_analysis" } },
          { id: "solve", kind: "solver", params: { solverKey: "capacity_forecast" } },
        ],
        edges: [{ from: "load", to: "solve", kind: "cond" }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe("NOT_IMPLEMENTED");
  });
});

describe("SEAM · R6 确定性 + R2 租户隔离 + 鉴权", () => {
  it("同一张图跑两次：layers[] 与 nodeResults 逐字节一致", async () => {
    const a = (await runGraph({ graph: TWO_LAYER_GRAPH })).json() as GraphRunResponse;
    const b = (await runGraph({ graph: TWO_LAYER_GRAPH })).json() as GraphRunResponse;
    expect(JSON.stringify(a.layers)).toBe(JSON.stringify(b.layers));
    // runId 每次新生成（本就该不同）；除它以外逐字节一致。
    expect(a.runId).not.toBe(b.runId);
    expect(JSON.stringify({ ...a, runId: "" })).toBe(JSON.stringify({ ...b, runId: "" }));
  });

  it("跨租户看不到本租户技能 → skill 节点 SKILL_NOT_FOUND（R2）", async () => {
    const res = await runGraph({ graph: TWO_LAYER_GRAPH }, "other-tenant:u1:catalog_admin");
    expect(res.statusCode).toBe(200);
    const body = res.json() as GraphRunResponse;
    expect(body.tenantId).toBe("other-tenant");
    const load = body.nodeResults.find((r) => r.nodeId === "load")!;
    expect(load.status).toBe("FAILED");
    expect(load.error?.code).toBe("SKILL_NOT_FOUND");
    // 上游失败 → 下游不执行（不是拿着 undefined 硬跑）
    expect(body.nodeResults.find((r) => r.nodeId === "solve")!.status).toBe("SKIPPED");
  });

  it("无凭据 → 401 错误信封", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/skill-graphs/run",
      headers: { "content-type": "application/json" },
      payload: { graph: TWO_LAYER_GRAPH },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("并发上限不许无上限：maxParallelNodes 越界 → 400 VALIDATION_ERROR", async () => {
    const res = await runGraph({ graph: { ...TWO_LAYER_GRAPH, maxParallelNodes: 999 } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });
});

/**
 * 审核方 2026-08-09 对名裁决在 **HTTP 层**的落点。
 * 判据 #1：走了哪一路，响应里必须说得出来 ——「静默回落 legacy」= 功能等于没做而测试照绿。
 */
describe("SEAM · Skill.execution 对名裁决：执行来源在响应里可见", () => {
  const LEGACY_STEPS = [
    { id: "p1", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: { modelId: "4680-NCM", weeks: 8 } } },
  ];

  it("execution.graph（新路·图）→ source=execution.graph 且真跑出结果", async () => {
    const res = await runGraph({ execution: { graph: TWO_LAYER_GRAPH } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GraphRunResponse;
    expect(body.source).toBe("execution.graph");
    expect(body.status).toBe("COMPLETED");
    expect(body.nodeResults.find((r) => r.nodeId === "solve")!.resolvedParams?.solverKey).toBe("capacity_forecast");
  });

  it("execution.steps（新路·线性，元素就是 PlanStep）→ source=execution.steps 且编成 seq 链 + R11 合成收口披露", async () => {
    const res = await runGraph({ execution: { steps: [...LEGACY_STEPS, { id: "p2", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: { modelId: "4680-NCM", weeks: 12 } } }] } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GraphRunResponse;
    expect(body.source).toBe("execution.steps");
    // 保守链式退化：两层各一个（不做隐式并行推断）+ 末尾合成 render 收口层（W2·R11）
    expect(body.layers).toEqual([
      { index: 0, nodeIds: ["p1"] },
      { index: 1, nodeIds: ["p2"] },
      { index: 2, nodeIds: ["__auto_render"] },
    ]);
    expect(body.status).toBe("COMPLETED");
    // 合成收口必须披露（不装成作者声明），且语义 = executor 兜底答案
    expect(body.renderClosure).toBe("synthesized");
    const tail = body.nodeResults.find((r) => r.nodeId === "__auto_render")!;
    expect(tail.status).toBe("COMPLETED");
    const tailAnswer = tail.output as { blocks: { type: string; markdown?: string }[] };
    expect(tailAnswer.blocks).toEqual([{ type: "text", markdown: "工作流执行完成。" }]);
  });

  it("★ 只给 legacy plan.steps → source=legacy.plan.steps（回落**可见**，不静默）", async () => {
    const res = await runGraph({ planSteps: LEGACY_STEPS });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GraphRunResponse;
    expect(body.source).toBe("legacy.plan.steps");
    expect(body.status).toBe("COMPLETED");
    expect(body.renderClosure).toBe("synthesized");
  });

  it("★ 三路皆空 → 422，不是「跑通了但什么都没做」", async () => {
    const res = await runGraph({});
    expect(res.statusCode).toBe(422);
    const err = res.json() as { error: { code: string; message: string } };
    expect(err.error.code).toBe("GRAPH_INVALID");
    expect(err.error.message).toContain("三路皆空");
  });

  /**
   * 裁决 v3 约束①：步骤形状的单一来源是 **`validatePlanSteps` 这个函数**，不是 `PlanStep` 这个闭合类型名。
   * `ExtraToolStep` 三类（query_timeseries_agg / search_knowledge / plan_slice）是**真实可执行**步骤
   * （`workflow/executor.ts:19`，`validatePlanSteps` 实际收 `PlanStep | ExtraToolStep`）。
   * 若把 steps 钉死成闭合 `PlanStepSchema`，它们会在 **zod 解析层**就被挡掉 → 用这三类的技能解析即失败。
   */
  it("★ ExtraToolStep 三类不得在解析层被挡掉，且要拿到**点名**的诚实错误", async () => {
    for (const type of ["query_timeseries_agg", "search_knowledge", "plan_slice"]) {
      const res = await runGraph({
        execution: { steps: [{ id: "x1", type, params: { foo: 1 } }] },
      });
      // 不是 400 VALIDATION_ERROR（那才是"解析即失败"）
      expect(res.statusCode, type).toBe(422);
      const err = res.json() as { error: { code: string; message: string } };
      // 是 422 NOT_IMPLEMENTED，且说得出是哪个步骤的哪个 type
      expect(err.error.code, type).toBe("NOT_IMPLEMENTED");
      expect(err.error.message, type).toContain(type);
      expect(err.error.message, type).toContain("x1");
    }
  });

  it("★ 约束①真接线：线性路上 validatePlanSteps 的语义错真的会拦（不是只写在注释里）", async () => {
    // 悬空步骤引用 —— 这是 validatePlanSteps 的判据，不是 zod 结构地板能看见的
    const res = await runGraph({
      planSteps: [
        { id: "p1", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: { m: "{{steps.ghost.output.x}}" } } },
      ],
    });
    expect(res.statusCode).toBe(422);
    const err = res.json() as { error: { code: string; message: string } };
    expect(err.error.code).toBe("PLAN_VALIDATION_ERROR");
    expect(err.error.message).toContain("ghost");
  });

  it("优先级 graph > steps > legacy：三路同给，走图且如实上报", async () => {
    const res = await runGraph({
      execution: { graph: TWO_LAYER_GRAPH, steps: LEGACY_STEPS },
      planSteps: LEGACY_STEPS,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as GraphRunResponse).source).toBe("execution.graph");
  });
});

/**
 * R11（WO-GRAPH-FANOUT-W2）在 **HTTP 层**的落点：
 * 手写图不带 render 收口 → 422 RENDER_CLOSURE_MISSING 并**点名**；
 * render 节点的 fromNode 必须是可见祖先 —— 渲染侧与模板解析同一条「边 = 可见性授权」纪律。
 */
describe("SEAM · R11 render 收口（拒发点名 / fromNode 可见性）", () => {
  it("手写图没有 render → 422 RENDER_CLOSURE_MISSING，点名入口与悬空终点", async () => {
    const res = await runGraph({
      graph: {
        nodes: [
          { id: "load", kind: "skill", params: { skillKey: "capacity_analysis" } },
          { id: "solve", kind: "solver", params: { solverKey: "capacity_forecast" } },
        ],
        edges: [{ from: "load", to: "solve", kind: "seq" }],
      },
    });
    expect(res.statusCode).toBe(422);
    const err = res.json() as { error: { code: string; message: string } };
    expect(err.error.code).toBe("RENDER_CLOSURE_MISSING");
    expect(err.error.message).toContain("load");
    expect(err.error.message).toContain("solve");
  });

  it("render 声明的 fromNode 不在可见祖先集 → 该节点 FAILED（没边连过来就不许溯源到它）", async () => {
    const res = await runGraph({
      graph: {
        nodes: [
          { id: "s1", kind: "solver", params: { solverKey: "capacity_forecast", args: { modelId: "4680-NCM", weeks: 8 } } },
          { id: "s2", kind: "solver", params: { solverKey: "capacity_forecast", args: { modelId: "4680-NCM", weeks: 8 } } },
          // out 只与 s1 有边；却声明 fromNode: s2 —— 没边连过来就不许溯源到它
          { id: "out", kind: "render", params: { blocks: [{ type: "kpi", label: "x", value: "ok", fromNode: "s2" }] } },
        ],
        edges: [{ from: "s1", to: "out", kind: "seq" }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GraphRunResponse;
    const out = body.nodeResults.find((r) => r.nodeId === "out")!;
    expect(out.status).toBe("FAILED");
    expect(out.error?.code).toBe("VALIDATION_ERROR");
    expect(out.error?.message).toContain("s2");
    expect(body.status).toBe("FAILED");
  });
});

/**
 * A2（PRD §10）：扇出执行序**真的拓扑** —— 同层真并发，屏障证明，不靠墙钟。
 *
 * 为什么用屏障不用耗时断言：本机负载可以很高，墙钟断言会假性红；屏障与负载无关——
 * 真并发必会合，假并发（串行化变异）必不合。变异反证天然成立：把调度器的波前并发改成
 * 逐个 await，第一个 barrier_probe 永远等不到第二个开始 → BARRIER_TIMEOUT → 红。
 */
describe("SEAM · 菱形扇出同层真并发（屏障会合，串行化即红）", () => {
  it("diamond：b1/b2 两个并行分支同时在跑（屏障会合），render 汇收", async () => {
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    const barrierDataCore = {
      solver: {
        invoke: async (_auth: unknown, solverKey: string) => {
          if (solverKey === "barrier_probe") {
            arrived += 1;
            if (arrived >= 2) release();
            await Promise.race([
              both,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("BARRIER_TIMEOUT：同层节点未真并发（串行化变异检出）")), 8000),
              ),
            ]);
          }
          return { data: { solverKey, ok: true } };
        },
      },
    };
    const scheduler = new GraphScheduler({
      repos: t.repos,
      dataCore: barrierDataCore as unknown as DataCoreClient,
    });
    const result = await scheduler.run(
      { tenantId: "t1", userId: "u1", roles: ["catalog_admin"] },
      {
        execution: {
          graph: {
            nodes: [
              { id: "entry", kind: "solver", params: { solverKey: "plain" } },
              { id: "b1", kind: "solver", params: { solverKey: "barrier_probe" } },
              { id: "b2", kind: "solver", params: { solverKey: "barrier_probe" } },
              { id: "out", kind: "render", params: { blocks: [{ type: "text", markdown: "done" }] } },
            ],
            edges: [
              { from: "entry", to: "b1", kind: "parallel" },
              { from: "entry", to: "b2", kind: "parallel" },
              { from: "b1", to: "out", kind: "seq" },
              { from: "b2", to: "out", kind: "seq" },
            ],
            maxParallelNodes: 4,
          },
        },
      },
      { runId: "run_barrier" },
    );
    // 拓扑序：diamond 三层，并行分支同层
    expect(result.layers.map((l) => l.nodeIds)).toEqual([["entry"], ["b1", "b2"], ["out"]]);
    expect(result.status).toBe("COMPLETED");
    // 屏障确实被两个分支都到达过（不是只跑了一个）
    expect(arrived).toBe(2);
  }, 20000);
});
