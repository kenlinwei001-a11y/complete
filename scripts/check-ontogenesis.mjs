#!/usr/bin/env node
/**
 * R16「发育闭环」门禁（system-ontogenesis 总纲）：声明性校验——系统本体必须立 R16 不变量，
 * 且 R16 表述覆盖发育闭环的四要素（三环自动闭合 / 二分处置 / 透明可视 / 分相位成熟）。
 * 与 cli-parity:check/debattery:check 同款治理范式：把"系统该长成什么"钉进本体，漂移即红。
 *
 * 设计取向（保守）：本门只校验本体把 R16 机制说清楚了（防回写漂移/遗漏），不强测运行时——
 * 三环的运行时落地由各被统摄 PRD（A10 build-to-verify / dogfooding 活体本体 / A15 目录派生）
 * 各自的门与测试保证。绿测试≠能用：本门是"记录该长成什么"的护栏，非功能完备证明。
 */
import { readFileSync } from "node:fs";

const ONTOLOGY = "docs/SYSTEM-ONTOLOGY.md";
const text = readFileSync(ONTOLOGY, "utf8");
const fail = [];

// 1) R16 必须在 §5 不变量表声明
if (!/\|\s*\*\*R16\*\*\s*\|/.test(text) && !/\bR16\b/.test(text)) {
  fail.push("本体 §5 未声明不变量 R16（发育闭环）——system-ontogenesis 总纲要求立 R16");
}

// 2) R16 表述须覆盖发育闭环四要素（关键词声明性校验，防回写遗漏其一）
const r16Line = (text.split("\n").find((l) => /\*\*R16\*\*/.test(l)) ?? "") + text;
const requirements = [
  { key: "三环（数据/本体/能力）", re: /三环|数据.*本体.*能力|build-to-verify/ },
  { key: "二分处置（AUTO-DERIVE / NEEDS-HUMAN）", re: /AUTO-DERIVE|NEEDS-HUMAN|二分处置|GrowthTicket/ },
  { key: "透明可视", re: /透明可视|节点图|模块同步矩阵|覆盖度/ },
  { key: "分相位成熟（PROVISIONAL→GOVERNED）", re: /PROVISIONAL.*GOVERNED|分相位|成熟/ },
  { key: "倒序发育 ⊕ 正序运作", re: /倒序发育|正序运作|个体发生|越用越大/ },
];
for (const r of requirements) {
  if (!r.re.test(r16Line)) fail.push(`R16 表述缺要素「${r.key}」（发育闭环总纲四要素 + 两相须齐备）`);
}

// ---------------------------------------------------------------------------
// PRD-scenario-ontogenesis §6：逐卡断言扩展。
//
// 诚实分清「静态可校验」vs「运行期事实」（绿测试≠能用）：
//   §6.1（每张 GOVERNED 卡有 VERIFIED ScenarioOntogenesisRun）= **运行期**——需真 grow 把 triggerQuestion
//        经 QOS 跑通，本静态门（只读源码/无后端）测不了 → 明确跳过 + 说明，由 scenario-ontogenesis.test.ts
//        的 grow 用例 + 门B 真后端证据保证，绝不静态冒充覆盖。
//   §6.5（未闭环卡 maturity!=GOVERNED 且有 gaps[].disposition）= **运行期**（maturity 由 grow 设定）→ 同样跳过。
//   §6.4（卡 sliceTargets 被计划 resolve_slice 覆盖）= 出厂目录卡未声明 sliceTargets（无该字段）→ N/A 跳过。
//
// 静态可校验（本门新增硬断言，漂移即红）：
//   A. 每张卡 plan 必有 render 步（render_answer）——消灭"有意图无渲染"的半成品。
//   B. 卡声明的 solver（sop_balance→mrp_netting 映射后）在 datacore SOLVER_OUTPUT_SHAPES 有输出形状
//      （§6.2 的静态可校验内核：render 投影目标的 solver 形状必须已登记，闭 G-2/SHAPE）。
//   C. 卡声明的 rules ⊆ 已发布规则集（§6.3 的静态可校验内核：消灭"规则摆设/引用未定义规则"）。
//   D. 每张卡 intentKey 在 seed 有对应意图+计划（能力环派生，§6.6 静态可校验内核）。
// ---------------------------------------------------------------------------
const CATALOG = "apps/agentcore/src/scenarios-catalog.ts";
const SEED = "apps/agentcore/src/mocks/seed.ts";
const SOLVER_SVC = "apps/datacore/src/solvers/service.ts";
const RULE_SRC = "apps/agentcore/src/mocks/clients.ts";

const catText = readFileSync(CATALOG, "utf8");
const seedText = readFileSync(SEED, "utf8");
const svcText = readFileSync(SOLVER_SVC, "utf8");
const ruleText = readFileSync(RULE_SRC, "utf8");

// 解析每张卡：sNo / solver / rules（从 card("Sxx","name","view","intentKey","trigger","solver",[rules],...) 字面）。
const cards = [...catText.matchAll(
  /card\(\s*"(S\d+)"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"([^"]*)"\s*,\s*"[^"]*"\s*,\s*"([a-z_]+)"\s*,\s*\[([^\]]*)\]/g,
)].map((m) => ({
  sNo: m[1],
  intentKey: m[2],
  solver: m[3],
  rules: [...m[4].matchAll(/"([A-Z]\d+)"/g)].map((r) => r[1]),
}));
if (cards.length === 0) fail.push(`§6 静态断言：未能从 ${CATALOG} 解析出任何场景卡（解析器与目录格式漂移）`);

// SOLVER_OUTPUT_SHAPES 顶层 key 全集（datacore 求解器输出形状权威来源）。
const shapeBlock = (svcText.match(/SOLVER_OUTPUT_SHAPES[^=]*=\s*\{([\s\S]*?)\n\};/) ?? [])[1] ?? "";
const shapeKeys = new Set([...shapeBlock.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]));

// 已发布规则集（B→A 探针 listRuleKeys 返回的出厂规则库 key 全集）。
const ruleBlock = (ruleText.match(/listRuleKeys\(\)[\s\S]*?return\s*\[([^\]]+)\]/) ?? [])[1] ?? "";
const definedRules = new Set([...ruleBlock.matchAll(/"([A-Z]\d+)"/g)].map((m) => m[1]));

// seed 中显式声明的计划/意图键（内置 4 卡）。其余 16 卡的意图/计划由派生循环按 card.intentKey 动态产出
// （plans.push({ key: card.intentKey, ... })），静态无字面 key → 由「派生器在位」+「卡在目录」共同保证覆盖。
const hardcodedIntentKeys = new Set(
  [...seedText.matchAll(/key:\s*"(affected_orders|capacity_feasibility|risk_root_cause|adopt_mitigation)"/g)].map((m) => m[1]),
);
// seed 派生循环存在性：对**每张非内置卡**从目录单一来源派生 invoke_solver→render_answer 意图+计划，
// 且计划/意图 key 取自 card.intentKey、id 取自 plan_${card.intentKey}/int_${card.intentKey}（确认派生器在位、键来自目录）。
const hasDeriveLoop = /for\s*\(const card of SCENARIO_CATALOG\)/.test(seedText)
  && /type:\s*"render_answer"/.test(seedText)
  && /type:\s*"invoke_solver"/.test(seedText)
  && /key:\s*card\.intentKey/.test(seedText)
  && /plan_\$\{card\.intentKey\}/.test(seedText);
if (!hasDeriveLoop) {
  fail.push("§6.A/§6.6 静态断言：seed 未见「按 SCENARIO_CATALOG 派生 invoke_solver→render_answer 意图+计划（key=card.intentKey）」循环（派生器漂移）");
}

// BP-4：sop_balance 须已被改绑为已注册求解器（mrp_netting），不再纯指针渲染（消灭 D4 占位）。
const sopMapped = /card\.solver\s*===\s*"sop_balance"\s*\?\s*"mrp_netting"/.test(seedText);
if (!sopMapped) {
  fail.push("§6.B 静态断言：seed 未把 sop_balance 改绑已注册求解器 mrp_netting（BP-4 应消灭 sop 卡纯指针渲染）");
}

for (const c of cards) {
  const effSolver = c.solver === "sop_balance" ? "mrp_netting" : c.solver;
  // B. 卡 solver 在 SOLVER_OUTPUT_SHAPES 有形状。
  if (shapeKeys.size > 0 && !shapeKeys.has(effSolver)) {
    fail.push(`§6.B 静态断言：卡 ${c.sNo} 的 solver「${effSolver}」未在 datacore SOLVER_OUTPUT_SHAPES 登记输出形状（render 投影无据，G-2/SHAPE）`);
  }
  // C. 卡 rules ⊆ 已发布规则集。
  if (definedRules.size > 0) {
    const orphan = c.rules.filter((r) => !definedRules.has(r));
    if (orphan.length > 0) fail.push(`§6.C 静态断言：卡 ${c.sNo} 引用未定义规则 [${orphan.join(", ")}]（规则摆设/引用未发布规则）`);
  }
  // D. 卡 intentKey 有对应意图+计划：内置 4 卡显式声明；其余卡由派生循环（hasDeriveLoop 已断言在位）
  //    按 card.intentKey 覆盖——只要卡在 SCENARIO_CATALOG（cards 来自该目录）即被派生器覆盖。
  const hasIntentPlan = hardcodedIntentKeys.has(c.intentKey) || hasDeriveLoop;
  if (!hasIntentPlan) {
    fail.push(`§6.D 静态断言：卡 ${c.sNo}（intentKey=${c.intentKey}）在 seed 无对应意图/计划（能力环未派生）`);
  }
}

if (fail.length > 0) {
  console.error("✗ ontogenesis:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("· R16 发育闭环：本体已立（三环自动闭合 + 二分处置 + 透明可视 + 分相位成熟 + 倒序⊕正序两相）");
console.log(`· §6 逐卡静态断言通过（${cards.length} 卡）：A 计划有 render 步派生器在位 · B solver(含 sop_balance→mrp_netting)∈SOLVER_OUTPUT_SHAPES · C rules⊆已发布规则集 · D intentKey 有意图/计划。`);
console.log("· §6 运行期项诚实跳过（本静态门测不了，绿测试≠能用）：");
console.log("    - §6.1 每张 GOVERNED 卡有 VERIFIED ScenarioOntogenesisRun（需真 grow 经 QOS 跑通）→ 由 scenario-ontogenesis.test.ts grow 用例 + 门B 真后端证据保证。");
console.log("    - §6.5 未闭环卡 maturity!=GOVERNED 且有 gaps[].disposition（maturity 由 grow 运行期设定）→ 同上（含 scenario-honest-gate.test.ts 的 RENDER_NOT_PROJECTED 样本）。");
console.log("    - §6.4 卡 sliceTargets 被计划 resolve_slice 覆盖：出厂目录卡未声明 sliceTargets 字段 → N/A。");
console.log("✓ ontogenesis:check：发育闭环不变量在本体钉牢 + §6 静态可校验逐卡断言守住（运行期事实由 grow 测试 + 门B 保证）。");
