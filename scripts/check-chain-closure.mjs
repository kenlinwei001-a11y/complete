#!/usr/bin/env node
/**
 * 全链闭包门（第一块砖 · 系统本体 R11 / 切片 sys.orch.query_to_answer）。
 *
 * 跨系统静态校验：
 * 1. 场景目录(AgentCore) 声明的每个求解器，DataCore 的 SOLVER_KEYS 必须真注册。
 *    这是任何单包测试都查不到的"场景↔求解器"跨系统接缝（G-1/G-2 同类断点高发区）：
 *    场景声明了一个 DataCore 没有的求解器 = 路径A 跑到一半 SOLVER_NOT_FOUND = 全链断。
 * 2. A3-SUITE-4: slice-planner 输出形状纳入 SHAPE 覆盖，形状漂移 → 门红。
 *
 * 用法：node scripts/check-chain-closure.mjs   （package.json: "chain:check"）
 * 退出码非 0 即 CI 失败。这是统一构建发动机"全链闭包门"的最小落地砖；完整门禁见
 * docs/PRD-unified-build-engine.md（BuildPlan 扩 AgentCore 栈 + ClosureReport CHAIN/SHAPE）。
 */
import { readFileSync, existsSync } from "node:fs";
import { planSlice } from "../apps/datacore/dist/ontology/slice-planner.js";
import { SlicePlanSchema } from "../packages/contracts/dist/slice-planner.js";

const SOLVERS_SRC = "apps/datacore/src/solvers/service.ts";
const CATALOG_SRC = "apps/agentcore/src/scenarios-catalog.ts";
const WORKFLOW_SOLVERS = new Set(["sop_balance"]); // 工作流非注册求解器，走 /a/v1/sop/*

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const fail = [];

const slv = read(SOLVERS_SRC);
if (!slv) { console.error(`✗ 缺少 ${SOLVERS_SRC}`); process.exit(1); }
const block = slv.match(/SOLVER_KEYS\s*=\s*\[([\s\S]*?)\]/);
const SOLVER_KEYS = new Set(block ? [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : []);

const cat = read(CATALOG_SRC);
if (!cat) { console.error(`✗ 缺少 ${CATALOG_SRC}`); process.exit(1); }
// card("S01","name","view","intentKey","triggerQ","solver", ...)
const cards = [...cat.matchAll(/card\(\s*"(S\d+)",\s*"[^"]*",\s*"[^"]*",\s*"([a-z_]+)",\s*"[^"]*",\s*"([a-z_]+)"/g)]
  .map((m) => ({ sNo: m[1], intentKey: m[2], solver: m[3] }));

if (cards.length === 0) fail.push(`场景目录解析为 0 张卡（正则口径需校准 ${CATALOG_SRC}）`);

for (const c of cards) {
  if (WORKFLOW_SOLVERS.has(c.solver)) continue; // 工作流，合法
  if (!SOLVER_KEYS.has(c.solver)) {
    fail.push(`场景 ${c.sNo}(${c.intentKey}) 声明求解器 "${c.solver}"，但 DataCore SOLVER_KEYS 未注册 → 路径A 全链断(SOLVER_NOT_FOUND)`);
  }
}

console.log(`· 求解器注册表：${SOLVER_KEYS.size} 个`);
console.log(`· 场景卡：${cards.length} 张；其中工作流求解器 ${cards.filter((c) => WORKFLOW_SOLVERS.has(c.solver)).length} 张（sop_balance）`);
console.log(`· 场景↔求解器接通：${cards.filter((c) => WORKFLOW_SOLVERS.has(c.solver) || SOLVER_KEYS.has(c.solver)).length}/${cards.length}`);

// R11-SHAPE 覆盖门：每个注册求解器必须声明输出形状（BuildPlan.renderBindings 据此挡 G-2 跨服务形状断）。
const shapeBlock = slv.match(/SOLVER_OUTPUT_SHAPES[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
const shapeKeys = new Set(shapeBlock ? [...shapeBlock[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]) : []);
const missingShape = [...SOLVER_KEYS].filter((k) => !shapeKeys.has(k));
for (const k of missingShape) fail.push(`求解器 "${k}" 已注册但未声明输出形状（SOLVER_OUTPUT_SHAPES）→ 渲染契约无从校验(SHAPE 盲区)`);
console.log(`· R11-SHAPE 输出形状已声明：${shapeKeys.size}/${SOLVER_KEYS.size} 注册求解器`);

// A3-SUITE-4 SHAPE 覆盖门：slice-planner 输出形状漂移检测（R6 确定性 fixture）。
// 用真实 planSlice 对固定小本体做路径规划，并以 SlicePlanSchema 校验产物字段齐全。
const SLICE_FIXTURE_TYPES = [
  { key: "Order", domain: "sales" },
  { key: "Model", domain: "product" },
  { key: "Base", domain: "supply" },
];
const SLICE_FIXTURE_LINKS = [
  { linkKey: "has_model", fromTypeKey: "Order", toTypeKey: "Model" },
  { linkKey: "at_base", fromTypeKey: "Model", toTypeKey: "Base" },
];
const SLICE_REQUEST = { rootType: "Order", targets: ["Model", "Base"], maxHops: 6 };

let slicePlan = null;
try {
  const sliceRes = planSlice(SLICE_FIXTURE_TYPES, SLICE_FIXTURE_LINKS, SLICE_REQUEST);
  if (!sliceRes.ok) {
    fail.push(`slice-planner fixture 规划失败：${JSON.stringify(sliceRes.reason)}`);
  } else {
    slicePlan = sliceRes.plan;
    const shapeCheck = SlicePlanSchema.safeParse(slicePlan);
    if (!shapeCheck.success) {
      fail.push(`slice-planner 输出形状漂移：${shapeCheck.error.message}`);
    } else {
      console.log(`· A3-SUITE-4 slice-planner 输出形状校验通过（${slicePlan.paths.length} 条路径）`);
    }
  }
} catch (err) {
  fail.push(`slice-planner fixture 执行异常：${err.message}`);
}

// Tooth test：临时克隆并删除一个必填字段，验证 SHAPE 门能检测形状缺失 → 门红。
if (slicePlan) {
  const badPlan = { ...slicePlan };
  delete badPlan.pathEvidence; // pathEvidence 为必填字段，删除后应触发 Schema 失败
  const badCheck = SlicePlanSchema.safeParse(badPlan);
  if (badCheck.success) {
    fail.push("A3-SUITE-4 slice-planner SHAPE tooth test 未检测到缺失字段（pathEvidence），形状门失效");
  } else {
    console.log(`· A3-SUITE-4 slice-planner SHAPE tooth test 通过（成功捕获 pathEvidence 缺失）`);
  }
}

if (fail.length) {
  console.error("\n✗ 全链闭包门未通过（场景声明了 DataCore 未注册的求解器）：");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ 全链闭包：每个场景的求解器都在 DataCore 注册（无跨系统 SOLVER_NOT_FOUND 断点）。");
