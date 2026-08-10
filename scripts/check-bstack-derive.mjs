#!/usr/bin/env node
/**
 * 门 `bstack-derive:check`（WO-DB-BSTACK-DERIVE·洞B·KILL-MOCK-RED·R6·堵 §8 G-8）：
 * 守 comprehend B 栈（workflow/agent/skill）**按故事真派生**（复杂度敏感·非模板 fan-out）——
 * 无硬编码 `steps: ["invoke_solver", "render"]` / 纯 `systemPrompt: \`针对 ${solverKey} …\`` / `resources: []`；
 * 沙盘划界：不派生 propagation_rule/state_var。green→red 齿见 `datacore/test/bstack-derive.test.ts`。
 * 动态测谎（dist）：两复杂度悬殊 core → workflow.steps/agent.prompt 字节不同。
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §8 G-8。用法：node scripts/check-bstack-derive.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { assertDistFresh } from "./dist-freshness.mjs";
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
  // ⛔ 守卫必须在 import dist **之前**（欠账 #161）：本门静态半读 comprehend.ts **源码**，
  //    动态半 import 它的 dist —— dist 落后就是拿旧产物去印证新源码的断言，两半各说各话。
  assertDistFresh(["apps/datacore/dist/databuilder/comprehend.js", "apps/datacore/dist/solvers/service.js"], {
    gate: "bstack-derive:check",
  });
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
