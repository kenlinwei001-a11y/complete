#!/usr/bin/env node
/**
 * 门 `rule-closure:check`（PRD-rules-as-references §6.1）：
 * 全代码库**被引用**的规则码 ⋃(SCENARIO_CATALOG.rules, SOLVER_RULE_REFS) ⊆ **已定义**规则库 key 集。
 * 有引用无定义即**红**（列出缺失码）——直接杜绝用户实测的"（当前库中没有找到定义）"回潮。
 *
 * 静态读源（与 boundary-singlesource:check 同范式）：
 *   - 定义集 = `battery.ts` 模板 rules[]（出厂即 PUBLISHED 播种，规则库单一来源）。
 *   - 引用集 = `contracts SOLVER_RULE_REFS`（求解器→规则）∪ `scenarios-catalog.ts` 卡 rules。
 * 仅匹配带引号的 "Cxx"，避开颜色码 #4C90F0 等误报（PRD 附录已注 C90 系误报）。
 */
import { readFileSync } from "node:fs";

const read = (rel) => {
  try {
    return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  } catch {
    console.error(`✗ rule-closure:check 读不到 ${rel}`);
    process.exit(1);
  }
};

// 定义集：battery.ts 规则定义 `{ key: "Cxx", name: ... }`（规则库出厂单一来源，播种即 PUBLISHED）。
const batterySrc = read("apps/datacore/src/synthetic/battery.ts");
const defined = new Set([...batterySrc.matchAll(/key:\s*"(C\d+)",\s*name:/g)].map((m) => m[1]));

// 引用集①：SOLVER_RULE_REFS（contracts 单一来源）。
const contractsSrc = read("packages/contracts/src/datacore.ts");
const refBlock = contractsSrc.match(/SOLVER_RULE_REFS[^{]*\{([\s\S]*?)\n\};/);
const solverRefs = new Set(refBlock ? [...refBlock[1].matchAll(/"(C\d+)"/g)].map((m) => m[1]) : []);

// 引用集②：场景卡 rules（启动器目录）。
const catalogSrc = read("apps/agentcore/src/scenarios-catalog.ts");
const cardRefs = new Set([...catalogSrc.matchAll(/"(C\d+)"/g)].map((m) => m[1]));

const referenced = new Set([...solverRefs, ...cardRefs]);
const missing = [...referenced].filter((k) => !defined.has(k)).sort();

console.log(
  `· rule-closure：定义 ${defined.size} · 引用 ${referenced.size}（SOLVER_RULE_REFS ${solverRefs.size} ∪ 卡 ${cardRefs.size}） · 缺失 ${missing.length}`,
);

if (missing.length > 0) {
  console.error(`✗ rule-closure:check：被引用但未定义的规则码（会致前端"未找到定义"/规则闸空过）：${missing.join(", ")}`);
  console.error(`  → 在 battery.ts rules[] 补齐定义（含 expression/severity/params），或修正引用。`);
  process.exit(1);
}
console.log("✓ rule-closure:check：全部被引用规则码均有定义，无悬空引用。");
