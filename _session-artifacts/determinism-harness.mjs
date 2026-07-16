// 独立复验确定性 harness（不依赖 dev 单测·直击 R6 纯函数命门）
// 直接 import 编译产物 dist·各跑 3 次 + 独立 mock 实例 + 探隐藏非确定性。
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const WT = "/home/user/complete/.claude/worktrees/agent-a96bf73d8a8c6f5c9";
const contracts = await import(pathToFileURL(resolve(WT, "packages/contracts/dist/index.js")).href);
const parserMod = await import(pathToFileURL(resolve(WT, "apps/agentcore/dist/growth/requirement-graph.js")).href);

const { fromLinearPlan, toLinearSteps, isLiftReversible } = contracts;
const { parseQuestionAst } = parserMod;

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures++; };

// ═══════════════════════════════════════════════════════════════════════════
// L1B-1 · fromLinearPlan 确定性 + 往返无损（独立·多步·含 onError/params）
// ═══════════════════════════════════════════════════════════════════════════
console.log("── L1B-1 · fromLinearPlan 双跑字节一致 + 往返无损 ──");
const plan = {
  id: "plan_indep",
  packageId: "pkg_indep",
  key: "indep_intent",
  version: 3,
  status: "PUBLISHED",
  steps: [
    { id: "a", type: "query_objects", params: { objectType: "Order", filter: { status: "OPEN" } } },
    { id: "b", type: "resolve_slice", params: { sliceKey: "capacity_rollup", args: { base: "cz" } }, onError: "SKIP" },
    { id: "c", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: { horizon: 30 } } },
    { id: "d", type: "evaluate_rules", params: { ruleSetKey: "delivery" } },
    { id: "e", type: "render_answer", params: { blocks: [{ kind: "kpi" }, { kind: "table" }] } },
  ],
};
// 3 次独立调用 → 全部字节一致
const liftRuns = [fromLinearPlan(plan), fromLinearPlan(plan), fromLinearPlan(plan)].map((g) => JSON.stringify(g));
if (liftRuns[0] === liftRuns[1] && liftRuns[1] === liftRuns[2]) ok(`fromLinearPlan ×3 字节一致 (${liftRuns[0].length} chars)`);
else bad(`fromLinearPlan 三跑不一致`);

// 注入不同 opts 应产不同图；同 opts 应同图（探 generatedAt/plannerVersion 注入而非取时钟）
const g1 = JSON.stringify(fromLinearPlan(plan, { tenantId: "demo", taskId: "T", generatedAt: "2020-01-01T00:00:00.000Z" }));
const g2 = JSON.stringify(fromLinearPlan(plan, { tenantId: "demo", taskId: "T", generatedAt: "2020-01-01T00:00:00.000Z" }));
if (g1 === g2) ok("同 opts（注入 generatedAt）双跑字节一致");
else bad("同 opts 双跑不一致（疑内部取时钟）");
// 默认 generatedAt 应为固定 LIFT_EPOCH（非 Date.now）
const gd = fromLinearPlan(plan);
if (gd.generatedAt === "1970-01-01T00:00:00.000Z") ok(`默认 generatedAt=LIFT_EPOCH(1970)·非墙钟`);
else bad(`默认 generatedAt=${gd.generatedAt}（非固定 epoch·疑取时钟）`);

// 往返无损：toLinearSteps(fromLinearPlan(p)) ≡ p.steps（逐字节）
const round = JSON.stringify(toLinearSteps(fromLinearPlan(plan)));
if (round === JSON.stringify(plan.steps)) ok("toLinearSteps∘fromLinearPlan ≡ steps（往返无损）");
else bad(`往返有损：\n    round=${round}\n    orig =${JSON.stringify(plan.steps)}`);
if (isLiftReversible(plan) === true) ok("isLiftReversible=true");
else bad("isLiftReversible=false");

// 结构核：线性链 dependsOn/entryNodes/gateways/coverageScore/source
const linChecks = [
  [gd.nodes.length === 5, "5 节点"],
  [JSON.stringify(gd.nodes.map((n) => n.dependsOn)) === JSON.stringify([[], ["a"], ["b"], ["c"], ["d"]]), "dependsOn 单前驱链 []→a→b→c→d"],
  [JSON.stringify(gd.entryNodes) === JSON.stringify(["a"]), "entryNodes=[a]（入度0）"],
  [gd.gateways.length === 0, "无 gateway（线性）"],
  [gd.coverageScore === 1, "coverageScore=1"],
  [gd.nodes.every((n) => n.source === "lift:linear"), "全 source=lift:linear"],
  [gd.nodes.every((n, i) => n.nodeId === plan.steps[i].id), "nodeId=step.id 保序"],
];
for (const [pass, label] of linChecks) pass ? ok(label) : bad(label);

// ═══════════════════════════════════════════════════════════════════════════
// L1A-1 · parseQuestionAst 确定性（独立 mock·3 次 + 独立实例·探 slots key 序）
// ═══════════════════════════════════════════════════════════════════════════
console.log("── L1A-1 · parseQuestionAst 双跑字节一致（独立 mock 本体）──");
const DATASET = {
  Base: [{ id: "常州", type: "Base", props: { baseId: "cz", name: "常州基地" } }],
  Line: [{ id: "PACK02", type: "Line", props: { lineId: "PACK02", name: "PACK02 产线" } }],
  Order: [{ id: "SO-1", type: "Order", props: { so: "SO-1", name: "订单 SO-1" } }],
};
const LABELS = { Base: "生产基地", Line: "产线", Order: "订单" };
const notImpl = () => { throw new Error("not impl"); };
function makeOntology() {
  return {
    async getObject(_c, t, id) {
      const row = (DATASET[t] ?? []).find((r) => r.id === id);
      if (!row) throw new Error(`404 ${t}/${id}`);
      return { data: { id: row.id, type: row.type, props: row.props }, snapshotVersion: "v1" };
    },
    async queryObjects(_c, t, filter) {
      let rows = DATASET[t] ?? [];
      const name = filter?.name;
      if (typeof name === "string") rows = rows.filter((r) => r.props.name === name);
      return { data: rows.map((r) => ({ id: r.id, type: r.type, props: r.props })), snapshotVersion: "v1" };
    },
    async listObjectTypeKeys() { return Object.keys(DATASET); },
    async listObjectTypes() {
      return Object.keys(DATASET).map((k) => ({ key: k, label: LABELS[k] ?? k, domain: "battery", instanceCount: (DATASET[k] ?? []).length }));
    },
    resolveSlice: notImpl, planSlice: notImpl, aggregateObjects: notImpl, getSimClock: notImpl,
    getScenarioPack: notImpl, crossValidate: notImpl, fillData: notImpl, provisionWorld: notImpl,
    validateOutput: notImpl, queryMetaOntology: notImpl, getMetaBreakpoint: notImpl, metaImpact: notImpl,
  };
}
const ctx = { tenantId: "demo", userId: "u1", roles: ["planner"] };
const GEN_AT = "2026-07-11T00:00:00.000Z";
// classification.extractedSlots 键顺序故意打乱 → 探 collectInstanceCandidates 是否 sort 稳定
const classA = { candidates: [{ intentKey: "affected_orders", confidence: 0.92 }], outOfCatalog: false, extractedSlots: { line: "PACK02", base: "常州基地", model: "x" }, latencyMs: 0, model: "det:test" };
const classB = { candidates: [{ intentKey: "affected_orders", confidence: 0.92 }], outOfCatalog: false, extractedSlots: { model: "x", base: "常州基地", line: "PACK02" }, latencyMs: 0, model: "det:test" };
const baseInput = { taskId: "task_indep", tenantId: "demo", rawText: "未来30天常州基地PACK02产线停机20%，影响哪些订单？", authCtx: ctx, generatedAt: GEN_AT };

const r1 = JSON.stringify(await parseQuestionAst({ ...baseInput, classification: classA, ontology: makeOntology() }));
const r2 = JSON.stringify(await parseQuestionAst({ ...baseInput, classification: classA, ontology: makeOntology() }));
const r3 = JSON.stringify(await parseQuestionAst({ ...baseInput, classification: classA, ontology: makeOntology() }));
if (r1 === r2 && r2 === r3) ok(`parseQuestionAst ×3（独立 mock 实例）字节一致 (${r1.length} chars)`);
else bad(`parseQuestionAst 三跑不一致`);

// 键顺序打乱（classA vs classB·extractedSlots 同内容不同键序）→ 应字节一致（证 sort 稳定·无 key 序泄漏）
const rShuffled = JSON.stringify(await parseQuestionAst({ ...baseInput, classification: classB, ontology: makeOntology() }));
if (r1 === rShuffled) ok("extractedSlots 键序打乱 → AST 字节一致（collectInstanceCandidates sort 稳定）");
else bad("键序打乱产生不同 AST（隐藏 key-order 非确定性）");

// generatedAt 逐字透传（内部不覆写·证不取时钟）
const astObj = JSON.parse(r1);
if (astObj.generatedAt === GEN_AT) ok("generatedAt 注入值逐字透传（内部不取时钟）");
else bad(`generatedAt=${astObj.generatedAt}≠注入值`);
if (astObj.astId === "ast_task_indep") ok("astId=ast_${taskId} 确定性派生（非随机 UUID）");
else bad(`astId=${astObj.astId}（疑随机）`);

console.log(failures === 0 ? "\n✓✓ 确定性 harness 全通过（L1A parser + L1B lift·R6 真凭实据）" : `\n✗ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
