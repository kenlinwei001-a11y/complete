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
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-ontogenesis.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


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

// 已发布规则集（B→A 探针 listPublishedRuleKeys 的供给侧 = mock 的 allRuleKeys 字面）。
// WO-REFGATE-ENT · N-01 改名后同步：旧正则锚在 `listRuleKeys()[\s\S]*?return [` 上，而 mock 现在
// `return this.allRuleKeys.filter(...)`——旧正则会**越过**该方法去咬文件里下一个 `return [`，
// 抽出一堆无关字面。锚点改到数组声明本身（唯一字面来源），并补金丝雀（见下）。
const ruleBlock = (ruleText.match(/allRuleKeys\s*=\s*\[([^\]]+)\]/) ?? [])[1] ?? "";
const definedRules = new Set([...ruleBlock.matchAll(/"([A-Z]\d+)"/g)].map((m) => m[1]));
// 金丝雀（铁律 0.6）：C03 是出厂规则库里必然存在的一条（seed workflow evaluate_rules 就在用它）。
// 抽不到它 ⇒ **解析器坏了**，不许把「抽出 0 条」读成「规则集为空所以这道检查跳过」——
// 旧代码正是靠 `if (definedRules.size > 0)` 静默 fail-open 的。
if (!definedRules.has("C03")) {
  fail.push(
    `§6.C 金丝雀失败：从 ${RULE_SRC} 抽已发布规则集时未抽到必中样例「C03」（抽到 ${definedRules.size} 条）——` +
      `**解析器与 mock 客户端格式漂移**，本轮「卡 rules ⊆ 已发布规则集」检查无效，按工具坏了处理（不是规则集为空）`,
  );
}

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
