#!/usr/bin/env node
/**
 * 门 `execution-planner:check`（WO-L1B-4 · PRD-L1B-execution-planner-workflow-runtime §4.1/§7/§8·
 * 守 R6/R11/R13·闭「计划综合造假 / 非法综合图 / 非确定性择优」）。
 *
 * 立「synthesizePlan 综合的每个节点 ∈ 真注册表、图 DAG 无环、Skill/Agent 择优确定性、覆盖门<0.8 诚实回落
 * 模板（绝不产非法图）」结构不变量——门层坐实 + 自证有牙齿（green→red）：
 *   A· 真需求图 → synthesizePlan → 综合图：validateExecutionGraph.ok（DAG 无环 + solverKey∈SOLVER_REGISTRY）·
 *      solver 节点串成管线（Ch10.13）· 非回落 · 每 invoke_solver.solverKey ∈ REGISTRY_SOLVER_KEYS（真牙齿）。
 *   B· R6 双跑字节一致（同 (reqGraph, 注册表, generatedAt) → 同 JSON·无时钟/随机）。
 *   C· 覆盖门 <0.8 → 诚实回落模板（fromLinearPlan·isFallbackGraph·往返无损·绝不产非法图）。
 *   D· Skill Match/Agent Assign 确定性（双跑同选·历史因子中性 1.0·NG5 不伪造·bound skill 择优胜出）。
 *   E· 牙齿（green→red 测谎）：①幽灵 solverKey 被 filter 剔除（不入图）②综合图注入环→validateExecutionGraph 红
 *      ③无可综合节点→回落（非非法空图）。
 *
 * contracts 不可 import datacore（contracts-only-shared），solverKey∈registry 的真牙齿在门层读 datacore
 * 编译产物对账（对齐 requirement-graph:check / solver-coverage:check 范式）。依赖 contracts+datacore+agentcore 已构建。
 */
const imp = async (p, label) =>
  import(p).catch((e) => {
    console.error(`✗ execution-planner:check 导入 ${label} 失败（先 pnpm -r build）：${e.message}`);
    process.exit(1);
  });

const { RequirementGraphSchema, ExecutionGraphSchema, validateExecutionGraph, fromLinearPlan, toLinearSteps } =
  await imp("../packages/contracts/dist/index.js", "contracts dist");
const { REGISTRY_SOLVER_KEYS } = await imp("../apps/datacore/dist/solvers/solver-registry.js", "datacore dist");
const { synthesizePlan, diffPlannerShadow, isFallbackGraph, scoreSkill, pickBestSkill, pickBestAgent } = await imp(
  "../apps/agentcore/dist/growth/execution-planner.js",
  "agentcore dist",
);

let red = false;
const fail = (m) => {
  console.error("✗ " + m);
  red = true;
};
const note = (m) => console.log(`· ${m}`);

if (!Array.isArray(REGISTRY_SOLVER_KEYS) || REGISTRY_SOLVER_KEYS.length < 2) {
  fail("REGISTRY_SOLVER_KEYS < 2——无法构管线夹具（导入路径漂移？）。");
  process.exit(1);
}

// —— 真注册表白名单（门层权威·synthesizePlan 用真 SOLVER_REGISTRY 键）——
const validSolverKeys = new Set(REGISTRY_SOLVER_KEYS);
const registrySolverKeys = new Set(REGISTRY_SOLVER_KEYS);
const SOLVERS = [REGISTRY_SOLVER_KEYS[0], REGISTRY_SOLVER_KEYS[1]];
const SLICE_TARGETS = ["capacity_rollup", "inventory_rollup"];
const sliceKeys = new Set(SLICE_TARGETS);

// —— 合法 RequirementGraph 夹具（经 RequirementGraphSchema.parse 自证夹具合法）——
const mkReqGraph = (over = {}) =>
  RequirementGraphSchema.parse({
    graphId: "rg_gate",
    taskId: "task_gate",
    tenantId: "demo",
    questionAst: {
      astId: "ast_gate",
      taskId: "task_gate",
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
      generatedAt: "1970-01-01T00:00:00.000Z",
    },
    nodes: [
      { nodeId: "object:Order", kind: "object", name: "Order", ontologyType: "Order", roleType: null, solverKey: null, required: true, confidence: 1, source: "ast:entity", refKey: null },
      { nodeId: `solver:${SOLVERS[0]}`, kind: "solver", name: SOLVERS[0], ontologyType: null, roleType: null, solverKey: SOLVERS[0], required: true, confidence: 1, source: "coverage", refKey: SOLVERS[0] },
    ],
    edges: [],
    problemClass: "bottleneck_detection",
    solverCandidates: SOLVERS,
    dataRequirements: [{ roleType: "capacity_rollup", minRows: 1 }],
    sliceTargets: { rootType: "Order", targets: SLICE_TARGETS },
    coverageScore: 1,
    builderVersion: "rg-builder/1.0.0",
    generatedAt: "1970-01-01T00:00:00.000Z",
    ...over,
  });

const OPTS = { generatedAt: "1970-01-01T00:00:00.000Z", intentKey: "bottleneck_detection" };
const templatePlan = {
  id: "plan_gate",
  packageId: "pkg_gate",
  key: "bottleneck_detection",
  version: 1,
  status: "PUBLISHED",
  steps: [
    { id: "t1", type: "resolve_slice", params: { sliceKey: "capacity_rollup", args: {} }, onError: "SKIP" },
    { id: "t2", type: "invoke_solver", params: { solverKey: SOLVERS[0], args: {} } },
    { id: "t3", type: "render_answer", params: { blocks: [] } },
  ],
};

// ═══ A· 真综合图合法 + 管线 + 节点∈真注册表 ══════════════════════════════════
{
  const g = synthesizePlan(mkReqGraph(), { validSolverKeys, sliceKeys }, OPTS);
  ExecutionGraphSchema.parse(g); // 契约漂移守
  const v = validateExecutionGraph(g, { solverKeys: validSolverKeys, sliceKeys });
  if (!v.ok) fail(`真综合图未过 validateExecutionGraph：${v.errors.join("; ")}`);
  if (isFallbackGraph(g)) fail("真高覆盖需求图不应回落模板（coverage=1）。");
  // 每 invoke_solver.solverKey ∈ 真 SOLVER_REGISTRY（真牙齿·非契约近似）。
  for (const n of g.nodes) {
    if (n.step.type === "invoke_solver" && !registrySolverKeys.has(n.step.params.solverKey)) {
      fail(`综合图 invoke_solver 节点 "${n.nodeId}" solverKey "${n.step.params.solverKey}" ∉ REGISTRY_SOLVER_KEYS`);
    }
    if (n.step.type === "resolve_slice" && !sliceKeys.has(n.step.params.sliceKey)) {
      fail(`综合图 resolve_slice 节点 "${n.nodeId}" sliceKey ∉ 白名单`);
    }
  }
  // Ch10.13 管线：两求解器 → 后一求解器 depends_on 前一（串管线·非并行·综合按 solverKey 排序钉序 R6）。
  const sorted = [...SOLVERS].sort();
  const s1 = g.nodes.find((n) => n.nodeId === `node_solver_${sorted[0]}`);
  const s2 = g.nodes.find((n) => n.nodeId === `node_solver_${sorted[1]}`);
  if (!s1 || !s2) fail("两求解器候选应各产一 SOLVER_RUN 节点。");
  else if (!s2.dependsOn.includes(s1.nodeId)) fail("Ch10.13 管线断裂：后一求解器未 depends_on 前一。");
  // Ch10.12 并行：两 slice 入度0（并行前沿）。
  const entries = g.entryNodes;
  if (entries.length < 2) fail(`并行前沿应含 2 个 slice 入度0 节点，实得 ${entries.length}。`);
  if (!red) note(`A· 真综合图合法（${g.nodes.length} 节点·管线+并行·节点全∈真注册表）`);
}

// ═══ B· R6 双跑字节一致 ══════════════════════════════════════════════════════
{
  const a = synthesizePlan(mkReqGraph(), { validSolverKeys, sliceKeys }, OPTS);
  const b = synthesizePlan(mkReqGraph(), { validSolverKeys, sliceKeys }, OPTS);
  if (JSON.stringify(a) !== JSON.stringify(b)) fail("R6 违例：synthesizePlan 双跑字节不一致（疑取时钟/随机/迭代序不稳）。");
  else note("B· R6 双跑字节一致（同 reqGraph+注册表+generatedAt → 同 JSON）");
}

// ═══ C· 覆盖门 <0.8 诚实回落模板（绝不产非法图）══════════════════════════════
{
  const g = synthesizePlan(mkReqGraph({ coverageScore: 0.5 }), { validSolverKeys, sliceKeys }, { ...OPTS, templateFallback: templatePlan });
  if (!isFallbackGraph(g)) fail("覆盖门 <0.8 应回落模板（isFallbackGraph=true）。");
  const v = validateExecutionGraph(g, { solverKeys: validSolverKeys });
  if (!v.ok) fail(`回落模板图非法（应合法）：${v.errors.join("; ")}`);
  // 回落 = 模板线性 lift：往返无损。
  const round = toLinearSteps(g);
  if (JSON.stringify(round) !== JSON.stringify(templatePlan.steps)) fail("回落模板往返不无损（toLinearSteps ≠ 模板 steps）。");
  const div = diffPlannerShadow(templatePlan, g);
  if (!div.fellBackToTemplate) fail("divergence.fellBackToTemplate 应为 true（回落态）。");
  if (!div.sameStepTypeMultiset) fail("回落模板步类型多重集应与模板一致。");
  if (!red) note("C· 覆盖门<0.8 → 诚实回落模板（合法图·往返无损·divergence 标记回落）");
}

// ═══ D· Skill Match/Agent Assign 确定性 + 历史中性1.0（NG5）═══════════════════
{
  const skill = (key, methodologyCriteria) => ({
    id: `skl_${key}`, tenantId: "demo", key, version: 1, name: key, summary: "", body: "",
    resources: [], mcpServers: [], status: "PUBLISHED",
    ...(methodologyCriteria ? { methodology: { conclusionTemplate: "", criteria: methodologyCriteria } } : {}),
  });
  const rg = mkReqGraph();
  const solverNode = { nodeId: `node_solver_${SOLVERS[0]}`, kind: "SOLVER_RUN", step: { id: "x", type: "invoke_solver", params: { solverKey: SOLVERS[0], args: {} } }, dependsOn: [], onError: "FAIL", source: `rg:solver:${SOLVERS[0]}`, assignedSkillId: null, assignedAgentId: null };
  // 历史/成本因子中性 1.0（诚实·NG5）。
  const sc = scoreSkill(skill(SOLVERS[0], [SOLVERS[0]]), solverNode, rg, new Set());
  if (sc.factors.historicalSuccess !== 1.0) fail(`Ch10.8 historicalSuccess 应中性 1.0（NG5 不伪造历史），实得 ${sc.factors.historicalSuccess}`);
  if (sc.factors.cost !== 1.0) fail(`Ch10.8 cost 应中性 1.0，实得 ${sc.factors.cost}`);
  // bound skill（scenarioMatch=1）择优胜过 unbound 同本体（scenarioMatch=0.5）。
  const skills = [skill(SOLVERS[0], [SOLVERS[0]]), skill(`${SOLVERS[0]}_alt`, [SOLVERS[0]])];
  const bound = new Set([SOLVERS[0]]);
  const pick1 = pickBestSkill(solverNode, skills, rg, bound);
  const pick2 = pickBestSkill(solverNode, skills, rg, bound);
  if (!pick1 || pick1.skillKey !== SOLVERS[0]) fail(`Skill Match 应择 bound skill（scenarioMatch 高），实得 ${pick1?.skillKey}`);
  if (JSON.stringify(pick1) !== JSON.stringify(pick2)) fail("Skill Match 双跑不确定（R6 违例）。");
  // Agent Assign：能力交集（scopeDeclaration.objectTypes ∩ 需求图对象类型 Order）确定性。
  const agents = [
    { id: "agt_a", tenantId: "demo", key: "supply", version: 1, status: "PUBLISHED", scopeDeclaration: { objectTypes: ["Order"], toolNames: [] } },
    { id: "agt_b", tenantId: "demo", key: "finance", version: 1, status: "PUBLISHED", scopeDeclaration: { objectTypes: ["Invoice"], toolNames: [] } },
  ];
  const ag1 = pickBestAgent(agents, rg);
  const ag2 = pickBestAgent(agents, rg);
  if (!ag1 || ag1.agentId !== "agt_a") fail(`Agent Assign 应择能力交集 agent（Order），实得 ${ag1?.agentId}`);
  if (JSON.stringify(ag1) !== JSON.stringify(ag2)) fail("Agent Assign 双跑不确定（R6 违例）。");
  if (!red) note("D· Skill/Agent 择优确定性（历史/成本中性1.0·bound 胜出·能力交集匹配·双跑同选）");
}

// ═══ E· 牙齿（green→red 测谎）═══════════════════════════════════════════════
{
  const teeth = [];
  // ① 幽灵 solverKey 被 filter 剔除（不入综合图）。
  const gGhost = synthesizePlan(mkReqGraph({ solverCandidates: [SOLVERS[0], "GHOST_SOLVER_ø"] }), { validSolverKeys, sliceKeys }, OPTS);
  const hasGhost = gGhost.nodes.some((n) => n.step.type === "invoke_solver" && n.step.params.solverKey === "GHOST_SOLVER_ø");
  teeth.push(["幽灵 solverKey 剔除", !hasGhost && !isFallbackGraph(gGhost)]);
  // ② 综合图注入环 → validateExecutionGraph 红。
  const gCyc = JSON.parse(JSON.stringify(synthesizePlan(mkReqGraph(), { validSolverKeys, sliceKeys }, OPTS)));
  const entry = gCyc.nodes.find((n) => n.dependsOn.length === 0);
  entry.dependsOn = ["node_render"]; // 制造环
  const rc = validateExecutionGraph(gCyc, { solverKeys: validSolverKeys });
  teeth.push(["注入环被逮", rc.ok === false && rc.errors.some((e) => e.includes("环"))]);
  // ③ 无可综合节点（无 slice 无 solver）→ 回落（非非法空图）。
  const gEmpty = synthesizePlan(mkReqGraph({ solverCandidates: [], sliceTargets: null }), { validSolverKeys, sliceKeys }, { ...OPTS, templateFallback: templatePlan });
  teeth.push(["无可综合→回落", isFallbackGraph(gEmpty) && validateExecutionGraph(gEmpty, { solverKeys: validSolverKeys }).ok]);

  for (const [label, ok] of teeth) if (!ok) fail(`牙齿钝：「${label}」未如预期（机制无效）。`);
  if (!red) note(`E· 牙齿自证：${teeth.length} 项全过（幽灵剔除/环被逮/无可综合回落）`);
}

if (red) {
  console.error("\n✗ execution-planner:check 未通过。");
  process.exit(1);
}
console.log("\n✓ execution-planner:check 通过（Ch10 综合合法 + R6 确定性 + 覆盖门回落 + Skill/Agent 择优 + 牙齿自证）");
