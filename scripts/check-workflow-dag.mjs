#!/usr/bin/env node
/**
 * ExecutionGraph 契约不变量门（`workflow-dag:check` · L1-B WO-L1B-1 · 守 R1/R6/R13）。
 *
 * PRD: docs/PRD-L1B-execution-planner-workflow-runtime.md §0.6 / §3 / §7 V10。
 * 本门静态守 ExecutionGraph 契约的五道不变量（牙齿自证·green→red）：
 *   ① DAG 无环（validateExecutionGraph 检出环即红）
 *   ② TaskNode.step.type ∈ PLAN_STEP_TYPES（不引幽灵步）
 *   ③ 节点引用 solverKey ∈ SOLVER_REGISTRY（复用 chain:check 同源白名单）/ 引用完整
 *   ④ 线性 lift 往返无损（toLinearSteps ∘ fromLinearPlan ≡ steps·R6 可逆）
 *   ⑤ 契约漂移守（合法图必过校验器·非法图必被逮·校验器无牙则门自红）
 *
 * 牙齿哲学（同 hidden-req-keys:check / no-fake-data:check 范式）：门内自造合法/非法夹具，
 * 用被测校验器跑——合法图不过 = 契约破坏；非法图不被逮 = 校验器钝（无牙）→ 门 exit1。
 *
 * 用法：node scripts/check-workflow-dag.mjs   （package.json: "workflow-dag:check"）
 * 退出码非 0 即 CI 失败。gates 链前置 `pnpm -r build`，dist 已就绪。
 */
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const fail = [];
const note = (m) => console.log(`· ${m}`);

// ── 导入编译产物（契约 dist·gates 链已 build）─────────────────────────────
const CONTRACTS_DIST = resolve("packages/contracts/dist/index.js");
if (!existsSync(CONTRACTS_DIST)) {
  console.error(`✗ workflow-dag:check 缺 contracts dist（先 pnpm --filter @platform/contracts build）：${CONTRACTS_DIST}`);
  process.exit(1);
}
const contracts = await import(pathToFileURL(CONTRACTS_DIST).href).catch((e) => {
  console.error(`✗ 导入 contracts dist 失败：${e.message}`);
  process.exit(1);
});
const {
  ExecutionGraphSchema,
  fromLinearPlan,
  toLinearSteps,
  isLiftReversible,
  validateExecutionGraph,
  PLAN_STEP_TYPES,
} = contracts;

for (const [name, v] of Object.entries({
  ExecutionGraphSchema,
  fromLinearPlan,
  toLinearSteps,
  isLiftReversible,
  validateExecutionGraph,
  PLAN_STEP_TYPES,
})) {
  if (v === undefined) fail.push(`契约未导出 ${name}（index.ts 漏 export * from "./execution-graph.js"）`);
}
if (fail.length) {
  console.error("\n✗ workflow-dag:check（契约导出缺失）：");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}

// ── 复用 chain:check 同源 solverKey 白名单（datacore dist·best-effort）──────
let solverKeys = null;
const DATACORE_SERVICE = resolve("apps/datacore/dist/solvers/service.js");
if (existsSync(DATACORE_SERVICE)) {
  const mod = await import(pathToFileURL(DATACORE_SERVICE).href).catch(() => null);
  if (mod?.SOLVER_KEYS) solverKeys = new Set(mod.SOLVER_KEYS);
}
const realSolver = solverKeys ? [...solverKeys][0] : "capacity_forecast";
if (!solverKeys) {
  solverKeys = new Set([realSolver]); // 无 datacore dist 时仍能自证机制（牙齿不依赖真注册表）
  note(`datacore dist 未就绪 → 用回退 solverKey 白名单 {${realSolver}}（机制自证不受影响）`);
} else {
  note(`solverKey 白名单：${solverKeys.size} 个（源 datacore SOLVER_REGISTRY·同 chain:check）`);
}

// ── 夹具工厂（真实步类型·非幽灵）───────────────────────────────────────────
const mkPlan = (steps) => ({
  id: "plan_gate",
  packageId: "pkg_gate",
  key: "gate_intent",
  version: 1,
  status: "PUBLISHED",
  steps,
});
const S = {
  query: { id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } },
  slice: { id: "s2", type: "resolve_slice", params: { sliceKey: "capacity_rollup", args: {} }, onError: "SKIP" },
  solver: { id: "s3", type: "invoke_solver", params: { solverKey: realSolver, args: {} } },
  render: { id: "s4", type: "render_answer", params: { blocks: [{ kind: "kpi" }] } },
};

// ═══════════════════════════════════════════════════════════════════════════
// A. 合法图必过（契约漂移守·⑤ 正向）
// ═══════════════════════════════════════════════════════════════════════════
const legalPlan = mkPlan([S.query, S.slice, S.solver, S.render]);
const legalGraph = fromLinearPlan(legalPlan);

// zod schema 必须解析合法 lift 产物
try {
  ExecutionGraphSchema.parse(legalGraph);
} catch (e) {
  fail.push(`合法 lift 产物 ExecutionGraphSchema.parse 失败（契约漂移）：${e.message}`);
}
// 校验器对合法图必 ok
{
  const r = validateExecutionGraph(legalGraph, { solverKeys });
  if (!r.ok) fail.push(`合法图未过 validateExecutionGraph（契约破坏或校验器误红）：${r.errors.join("; ")}`);
  else note(`A· 合法线性图（4 节点）→ validateExecutionGraph ok`);
}

// ═══════════════════════════════════════════════════════════════════════════
// B. 线性 lift 往返无损（④·R6 可逆）
// ═══════════════════════════════════════════════════════════════════════════
for (const [label, plan] of [
  ["单步", mkPlan([S.render])],
  ["多步", legalPlan],
]) {
  const round = toLinearSteps(fromLinearPlan(plan));
  const same = JSON.stringify(round) === JSON.stringify(plan.steps);
  if (!same) fail.push(`lift 往返不无损（${label}）：toLinearSteps∘fromLinearPlan ≠ steps`);
  if (!isLiftReversible(plan)) fail.push(`isLiftReversible(${label}) 报 false（往返可逆自证失败）`);
}
// R6：双跑字节一致
if (JSON.stringify(fromLinearPlan(legalPlan)) !== JSON.stringify(fromLinearPlan(legalPlan))) {
  fail.push(`fromLinearPlan 双跑字节不一致（R6 违例·疑取时钟/随机）`);
}
if (!fail.some((f) => f.includes("lift") || f.includes("R6"))) note(`B· 线性 lift 往返无损（单步/多步）+ R6 双跑字节一致`);

// ═══════════════════════════════════════════════════════════════════════════
// C. 牙齿：非法图必被逮（校验器无牙则门红·green→red 测谎）
// ═══════════════════════════════════════════════════════════════════════════
const clone = (g) => JSON.parse(JSON.stringify(g));
const teeth = [];

// ① 注入环 → 必检出「环」
{
  const g = clone(legalGraph);
  g.nodes.find((n) => n.nodeId === "s1").dependsOn = ["s4"]; // s1→s4→s3→s1 环
  const r = validateExecutionGraph(g, { solverKeys });
  teeth.push(["注入环", r.ok === false && r.errors.some((e) => e.includes("环"))]);
}
// ② 注入幽灵步类型 → 必检出「幽灵步」
{
  const g = clone(legalGraph);
  g.nodes[0].step.type = "teleport_data";
  const r = validateExecutionGraph(g, { solverKeys });
  teeth.push(["幽灵步类型", r.ok === false && r.errors.some((e) => e.includes("幽灵步"))]);
}
// ③ 注入幽灵 solverKey（白名单外）→ 必检出「幽灵 solverKey」
{
  const g = clone(legalGraph);
  g.nodes.find((n) => n.nodeId === "s3").step.params.solverKey = "GHOST_SOLVER_ø";
  const r = validateExecutionGraph(g, { solverKeys });
  teeth.push(["幽灵 solverKey", r.ok === false && r.errors.some((e) => e.includes("幽灵 solverKey"))]);
}
// ④ lift 不可逆（篡改 round-trip 语义）→ toLinearSteps 对非纯链必抛错
{
  const g = clone(legalGraph);
  g.nodes.find((n) => n.nodeId === "s4").dependsOn = ["s1", "s3"]; // 多前驱扇入·非纯链
  let threw = false;
  try {
    toLinearSteps(g);
  } catch {
    threw = true;
  }
  teeth.push(["非纯链 toLinearSteps 抛错", threw]);
}
// ⑤ 悬空前驱 → 必检出「悬空前驱」
{
  const g = clone(legalGraph);
  g.nodes.find((n) => n.nodeId === "s4").dependsOn = ["GHOST_NODE"];
  const r = validateExecutionGraph(g, { solverKeys });
  teeth.push(["悬空前驱", r.ok === false && r.errors.some((e) => e.includes("悬空前驱"))]);
}

for (const [label, caught] of teeth) {
  if (!caught) fail.push(`牙齿钝：非法图「${label}」未被校验器逮住（无牙→门无效）`);
}
if (!fail.some((f) => f.includes("牙齿钝"))) note(`C· 牙齿自证：${teeth.length} 个非法图全部被逮（环/幽灵步/幽灵solver/非纯链/悬空前驱）`);

// ═══════════════════════════════════════════════════════════════════════════
if (fail.length) {
  console.error("\n✗ workflow-dag:check 未通过：");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ workflow-dag:check 通过（ExecutionGraph 契约不变量 + 线性 lift 可逆 + 牙齿自证）");
