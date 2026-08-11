#!/usr/bin/env node
/**
 * 门 `bstack-derive:check`（WO-DB-BSTACK-DERIVE·洞B·KILL-MOCK-RED·R6·堵 §8 G-8）：
 * 守 comprehend B 栈（workflow/agent/skill）**按故事真派生**（复杂度敏感·非模板 fan-out）——
 * 无硬编码 `steps: ["invoke_solver", "render"]` / 纯 `systemPrompt: \`针对 ${solverKey} …\`` / `resources: []`；
 * 沙盘划界：不派生 propagation_rule/state_var。green→red 齿见 `datacore/test/bstack-derive.test.ts`。
 * 动态测谎（dist）：两复杂度悬殊 core → workflow.steps/agent.prompt 字节不同。
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §8 G-8。用法：node scripts/check-bstack-derive.mjs
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
  console.error(`⛔ check-bstack-derive.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, existsSync } from "node:fs";
const root = new URL("../", import.meta.url);
const read = (rel) => (existsSync(new URL(rel, root)) ? readFileSync(new URL(rel, root), "utf8") : null);
const fail = [];

const src = read("apps/datacore/src/databuilder/comprehend.ts") ?? "";
const strip = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
for (const sym of ["deriveWorkflowSteps", "deriveAgentPrompt", "deriveSkillResources"])
  if (!new RegExp(`function ${sym}\\b|const ${sym}\\b`).test(strip)) fail.push(`comprehend.ts 缺 ${sym}（B 栈派生器未在位）`);
if (!/workflowKey:[\s\S]{0,80}steps:\s*deriveWorkflowSteps\(s\)/.test(strip)) fail.push("comprehend.ts workflowNeeds.steps 未用 deriveWorkflowSteps（模板 fan-out 未消除）");
if (/systemPrompt:\s*`针对 \$\{s\.solverKey\} 的推演分析 agent/.test(strip)) fail.push("comprehend.ts agent systemPrompt 仍纯 solverKey 模板（无故事上下文）");
if (/resources:\s*\[\]/.test(strip)) fail.push("comprehend.ts skill resources 仍恒 []（非真作用域资源）");

async function dynamic() {
  const dist = new URL("apps/datacore/dist/databuilder/comprehend.js", root);
  const sdist = new URL("apps/datacore/dist/solvers/service.js", root);
  if (!existsSync(dist) || !existsSync(sdist)) { fail.push("dist 未构建——跳过动态"); return; }
  const { assemblePlanBody } = await import(dist.href);
  const { SOLVER_KEYS } = await import(sdist.href);
  const K = SOLVER_KEYS[0];
  const simple = { objectTypes: [{ typeKey: "Order", displayName: "订单", domain: "sales", fields: [{ name: "order_id", dataType: "string", isPrimaryKey: true }] }], rules: [], solverNeeds: [{ solverKey: K, inputFields: [{ typeKey: "Order", propKey: "order_id" }] }] };
  const complex = { objectTypes: [{ typeKey: "Order", displayName: "订单", domain: "sales", fields: [{ name: "order_id", dataType: "string", isPrimaryKey: true }] }, { typeKey: "Process", displayName: "工序", domain: "factory", fields: [{ name: "proc_id", dataType: "string", isPrimaryKey: true }] }], rules: [], solverNeeds: [{ solverKey: K, inputFields: [{ typeKey: "Order", propKey: "order_id" }, { typeKey: "Process", propKey: "proc_id" }] }] };
  const a = assemblePlanBody(simple, "简单故事", 1, SOLVER_KEYS);
  const b = assemblePlanBody(complex, "复杂多约束故事", 1, SOLVER_KEYS);
  if (JSON.stringify(a.workflowNeeds[0].steps) === JSON.stringify(b.workflowNeeds[0].steps)) fail.push("两复杂度悬殊故事 workflow.steps 字节相同（洞B 模板 fan-out 回潮·门无牙）");
  if (a.agentNeeds[0].systemPrompt === b.agentNeeds[0].systemPrompt) fail.push("两故事 agent.systemPrompt 字节相同（无故事上下文）");
  if ((b.propagationRuleNeeds ?? []).length !== 0 || (b.stateVarNeeds ?? []).length !== 0) fail.push("沙盘划界破：派生了 propagation_rule/state_var（防双写）");
}
await dynamic();

if (fail.length) { console.error("✗ bstack-derive:check 失败："); for (const f of fail) console.error("  - " + f); process.exit(1); }
console.log("✓ bstack-derive:check 通过（B 栈按故事真派生·复杂度敏感·非模板·沙盘划界·门有牙）");
