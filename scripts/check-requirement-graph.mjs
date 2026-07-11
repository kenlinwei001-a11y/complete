#!/usr/bin/env node
/**
 * 门 `requirement-graph:check`（WO-L1A-2 · PRD-L1A-requirement-graph-engine §4.2/§7 · 守 R6/R11/R14 ·
 * 闭「需求图造假节点」）。
 *
 * 立「**Graph Builder 产出的每个 object/solver/data 节点必 ∈ 三张真实白名单**」结构不变量（by-construction·
 * 越界节点丢弃 + 记 gap·零幽灵）——本门在**门层坐实**并**自证有牙齿**（green→red）：
 *   ① object.ontologyType ∈ 发布类型（本体图 `graph.nodes`）
 *   ② solver.solverKey   ∈ datacore `SOLVER_REGISTRY`（`REGISTRY_SOLVER_KEYS`·真牙齿·非契约层近似）
 *   ③ data.roleType      ∈ `DATADEP_ROLE_CANONICAL`
 *
 * 四道断言：
 *  ① 存在性对账（真跑 builder）——真本体图 + **对抗性 AST（塞幽灵 ontologyType/objectId）**跑
 *     `buildRequirementGraph`，断言所有 object/solver/data 节点逐个 ∈ 对应真白名单·幽灵被剔除·记 gap。
 *  ② 测谎自证（green→red 有牙齿）——往「一份输出副本」注入幽灵 solver/type/role，用**同一**校验器
 *     `nodesOutsideRegistries` 复核：必抓出（否则校验器无牙 → 门红）。证「若 builder 漏 filter，本门必红」。
 *  ③ 契约层白名单 ⊆ 真 SOLVER_REGISTRY——`VALID_SOLVER_KEYS`（builder 用的求解器白名单·契约层近似）
 *     全 ∈ `REGISTRY_SOLVER_KEYS`（datacore 权威）·零幽灵（防契约层白名单本身含幽灵）。
 *  ④ 源码守卫——builder 函数体三白名单 filter 在位（`publishedTypes.has` / `VALID_SOLVER_KEYS.has` /
 *     `VALID_ROLE_TYPES.has`）+ 契约漂移守（RequirementNode/RequirementGraph schema 关键字段在位）。
 *
 * contracts 不可 import datacore（contracts-only-shared），故 solverKey∈registry 的真牙齿在**门层**读
 * datacore 编译产物对账（对齐 solver-coverage:check / hidden-req-keys:check 范式）。
 * 依赖 contracts + datacore + agentcore 已构建（gates 链 pnpm -r build 在前）。
 */
import { readFileSync } from "node:fs";

const imp = async (p, label) =>
  import(p).catch((e) => {
    console.error(`✗ requirement-graph:check 导入 ${label} 失败（先 pnpm -r build）：${e.message}`);
    process.exit(1);
  });

const { SOLVER_DATADEP, DATADEP_ROLE_CANONICAL, coveredSolverKeys } = await imp(
  "../packages/contracts/dist/index.js",
  "contracts dist",
);
const { REGISTRY_SOLVER_KEYS } = await imp("../apps/datacore/dist/solvers/solver-registry.js", "datacore dist");
const { buildRequirementGraph, VALID_SOLVER_KEYS, QUESTION_AST_PARSER_VERSION } = await imp(
  "../apps/agentcore/dist/growth/requirement-graph.js",
  "agentcore dist",
);

let red = false;
const fail = (m) => {
  console.error("✗ " + m);
  red = true;
};

if (!Array.isArray(REGISTRY_SOLVER_KEYS) || REGISTRY_SOLVER_KEYS.length === 0) {
  fail("REGISTRY_SOLVER_KEYS 为空——无法对账（导入路径漂移？）。");
}

// —— 真实本体图夹具（节点=canonical 真类型键·边=真 LinkType·端点约定 n-<typeKey>）——
const PUBLISHED_TYPES = [...new Set(Object.values(DATADEP_ROLE_CANONICAL))];
const GRAPH = {
  nodes: PUBLISHED_TYPES.map((key) => ({ key })),
  edges: [
    { from: "n-Base", to: "n-Line", label: "base_has_line" },
    { from: "n-Line", to: "n-Model", label: "line_produces_model" },
    { from: "n-Model", to: "n-Order", label: "order_uses_model" },
    { from: "n-Order", to: "n-Shipment", label: "order_ships_via" },
  ],
};

// —— 三张真实白名单（门层权威·solver 用 datacore REGISTRY_SOLVER_KEYS 真牙齿）——
const publishedTypeKeys = new Set(GRAPH.nodes.map((n) => n.key));
const registrySolverKeys = new Set(REGISTRY_SOLVER_KEYS);
const canonicalRoleKeys = new Set(Object.keys(DATADEP_ROLE_CANONICAL));

/** 同一校验器（①②共用·防「宽松校验器假绿」）：返回不在真实白名单内的节点明细（空=全合法）。 */
function nodesOutsideRegistries(nodes) {
  const bad = [];
  for (const n of nodes ?? []) {
    if (n.kind === "object" && !publishedTypeKeys.has(n.ontologyType)) bad.push(`object.ontologyType:${n.ontologyType}`);
    if (n.kind === "solver" && !registrySolverKeys.has(n.solverKey)) bad.push(`solver.solverKey:${n.solverKey}`);
    if (n.kind === "data" && !canonicalRoleKeys.has(n.roleType)) bad.push(`data.roleType:${n.roleType}`);
  }
  return bad;
}

// —— ① 存在性对账：对抗性 AST（塞幽灵 ontologyType）跑真 builder → 节点必全 ∈ 真白名单 ——
const GHOST_TYPE = "GHOST_TYPE_ø";
const adversarialAst = {
  astId: "ast_gate",
  taskId: "gate",
  tenantId: "gate",
  rawText: "对抗性问句：幽灵基地停机影响订单",
  intent: { problemClass: "affected_scope_enumeration", intentKey: "affected_orders", confidence: 0.9 },
  entities: [
    { text: "幽灵厂", ontologyType: GHOST_TYPE, objectId: "g1", resolved: true, source: "exact", confidence: 1 },
    { text: "常州基地", ontologyType: "Base", objectId: "cz", resolved: true, source: "unique_name", confidence: 0.9 },
    { text: "订单", ontologyType: "Order", objectId: null, resolved: true, source: "exact", confidence: 1 },
  ],
  actions: [{ type: "SHUTDOWN", targetType: "Line", value: "20%" }],
  constraints: [{ kind: "OBJECTIVE", metric: "Cost", operator: "NONE", value: null, direction: "MIN" }],
  timeScope: { kind: "FUTURE_WINDOW", from: null, to: null, window: 30, granularity: "DAY" },
  objectives: ["MIN:Cost"],
  outputs: ["订单"],
  parserVersion: QUESTION_AST_PARSER_VERSION,
  generatedAt: "2026-07-11T00:00:00.000Z",
};

const gaps = [];
const rg = buildRequirementGraph({ ast: adversarialAst, graph: GRAPH, generatedAt: "2026-07-11T00:00:00.000Z", gapsSink: gaps });
const leaked = nodesOutsideRegistries(rg.nodes);
if (leaked.length > 0) {
  fail(`①存在性：buildRequirementGraph 产出白名单外幽灵节点（造假）：${leaked.join(", ")}`);
} else {
  console.log(
    `· ①存在性：对抗性 AST（塞幽灵 ${GHOST_TYPE}）→ ${rg.nodes.length} 节点（` +
      `${rg.nodes.filter((n) => n.kind === "object").length} object/${rg.nodes.filter((n) => n.kind === "solver").length} solver/` +
      `${rg.nodes.filter((n) => n.kind === "data").length} data）全 ∈ 三真白名单（零幽灵）。`,
  );
}
// 幽灵类型被剔除且记 gap（正向坐实 by-construction + 诚实）。
if (rg.nodes.some((n) => n.ontologyType === GHOST_TYPE)) fail(`①存在性：幽灵类型 ${GHOST_TYPE} 混入图（filter 失效）`);
if (!gaps.some((g) => g.kind === "object" && g.key === GHOST_TYPE)) {
  fail(`①存在性：幽灵类型 ${GHOST_TYPE} 被剔除但未记 gap（不诚实·应留痕）`);
}

// —— ② 测谎自证（green→red 有牙齿）：往输出副本注入幽灵 → 同一校验器必抓出 ——
const poisoned = [
  ...rg.nodes,
  { nodeId: "x1", kind: "solver", name: "ghost", ontologyType: null, roleType: null, solverKey: "ghost_solver_ø", required: true, confidence: 1, source: "INJECTED", refKey: "ghost_solver_ø" },
  { nodeId: "x2", kind: "object", name: "ghost", ontologyType: "GHOST_OBJ_ø", roleType: null, solverKey: null, required: true, confidence: 1, source: "INJECTED", refKey: null },
  { nodeId: "x3", kind: "data", name: "ghost", ontologyType: null, roleType: "ghost_role_ø", solverKey: null, required: true, confidence: 1, source: "INJECTED", refKey: "ghost_role_ø" },
];
const caught = nodesOutsideRegistries(poisoned);
const caughtAll =
  caught.some((b) => b.includes("ghost_solver_ø")) &&
  caught.some((b) => b.includes("GHOST_OBJ_ø")) &&
  caught.some((b) => b.includes("ghost_role_ø"));
if (!caughtAll) {
  fail(`②测谎：注入幽灵 solver/type/role 后校验器未全抓出（抓到 ${JSON.stringify(caught)}）→ 校验器无牙齿（本门形同虚设）`);
} else {
  console.log(`· ②测谎：注入 3 幽灵（solver/type/role）→ 校验器抓出 ${caught.length} 项越界节点（green→red 有牙齿·自证）。`);
}

// —— ③ 契约层白名单 VALID_SOLVER_KEYS ⊆ 真 SOLVER_REGISTRY（防白名单本身含幽灵）——
const covered = new Set(coveredSolverKeys());
const validSolverGhosts = [...VALID_SOLVER_KEYS].filter((k) => !registrySolverKeys.has(k));
if (validSolverGhosts.length > 0) {
  fail(
    `③白名单：builder 的 VALID_SOLVER_KEYS 含 ${validSolverGhosts.length} 个 ∉ SOLVER_REGISTRY 的 key：` +
      `${validSolverGhosts.join(", ")}（契约层白名单漂移·先在 datacore 注册或从 SOLVER_COVERAGE/SOLVER_DATADEP 删）。`,
  );
} else {
  console.log(
    `· ③白名单：VALID_SOLVER_KEYS（${VALID_SOLVER_KEYS.size} key = coveredSolverKeys ${covered.size} ∪ SOLVER_DATADEP ${Object.keys(SOLVER_DATADEP).length}）全 ∈ SOLVER_REGISTRY（${REGISTRY_SOLVER_KEYS.length} 注册·零幽灵）。`,
  );
}

// —— ④ 源码守卫：builder 三白名单 filter 在位 + 契约字段在位 ——
const builderSrc = readFileSync(new URL("../apps/agentcore/src/growth/requirement-graph.ts", import.meta.url), "utf8");
const fnStart = builderSrc.indexOf("export function buildRequirementGraph");
if (fnStart < 0) {
  fail("④源码：未找到 buildRequirementGraph 定义");
} else {
  const body = builderSrc.slice(fnStart);
  for (const guard of ["publishedTypes.has", "VALID_SOLVER_KEYS.has", "VALID_ROLE_TYPES.has"]) {
    if (!body.includes(guard)) fail(`④源码：buildRequirementGraph 缺白名单守卫 ${guard}（疑似漏 filter·幽灵可穿透）`);
  }
  // 复用不重造守卫：builder 必调 L0 expandHiddenRequirements（隐性需求不新造引擎·NG1）。
  if (!body.includes("expandHiddenRequirements")) {
    fail("④源码：buildRequirementGraph 未调 expandHiddenRequirements（隐性需求应复用 L0·不新造·NG1）");
  }
}
const contractSrc = readFileSync(new URL("../packages/contracts/src/requirement-graph.ts", import.meta.url), "utf8");
for (const field of ["ontologyType", "roleType", "solverKey", "solverCandidates", "dataRequirements", "sliceTargets", "coverageScore"]) {
  if (!contractSrc.includes(field)) fail(`④契约漂移：requirement-graph.ts 缺字段 ${field}（契约漂移·下游投影/三白名单失据）`);
}
if (!red) console.log("· ④源码：builder 三白名单 filter + expandHiddenRequirements 复用在位·契约关键字段无漂移。");

if (red) {
  console.error("\n✗ requirement-graph:check 未过：需求图构建存在造假节点/漏 filter/白名单漂移（违 R11/R14·§4.2 三白名单）。");
  process.exit(1);
}
console.log(
  "✓ requirement-graph:check 通过（AST→RG 三白名单 by-construction·object∈发布类型/solver∈SOLVER_REGISTRY/" +
    "data∈DATADEP_ROLE_CANONICAL·零幽灵·green→red 自证有牙齿·隐性需求复用 L0）。",
);
