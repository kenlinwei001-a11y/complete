// 现算：真 40 条状态变量下，「今天扰不动」名单有多少条（= 契约因子册 ∖ 后端 stateVars）。
// 金丝雀：册长必须 20（0 ⇒ 工具坏了）。
import { CAPACITY_FACTOR_BINDINGS } from "../../packages/contracts/dist/index.js";
import { readFileSync } from "node:fs";

const src = readFileSync("apps/datacore/src/seed.ts", "utf8");
const vars = [
  ...new Set([...src.matchAll(/(?:source|target)StateVar:\s*"([a-zA-Z_]+)"/g)].map((m) => m[1])),
].sort();

console.log(`金丝雀 · 契约因子册条数 = ${CAPACITY_FACTOR_BINDINGS.length}（期望 20；0 ⇒ 工具坏了）`);
console.log(`金丝雀 · seed 状态变量数 = ${vars.length}（期望 40；0 ⇒ 工具坏了）`);
if (CAPACITY_FACTOR_BINDINGS.length === 0 || vars.length === 0) process.exit(2);

const live = new Set(vars);
const blocked = CAPACITY_FACTOR_BINDINGS.filter((b) => !live.has(b.prop));
console.log(`\n扰不动 = ${blocked.length} / ${CAPACITY_FACTOR_BINDINGS.length}`);
for (const b of blocked) console.log(`  ${b.mark} ${b.factorName.padEnd(12)} ${b.objectType}.${b.prop}`);
const passable = CAPACITY_FACTOR_BINDINGS.filter((b) => live.has(b.prop));
console.log(`\n册里今天真扰得动的 = ${passable.length}：${passable.map((b) => b.prop).join(", ") || "（一个都没有）"}`);
