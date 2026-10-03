// P1 · 把「边符号集合」与「声明取值域」两张**互不相识**的登记表 join 起来
// 目的：量出「净入流方向 + 边界是否吸收」这一组合的分布。
// 数据源：① /a/v1/sim/propagation-rules（真后端）② STATE_VAR_DOMAINS（dist/synthetic/battery.js）
import { STATE_VAR_DOMAINS } from "/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js";
import fs from "node:fs";

const D = STATE_VAR_DOMAINS;
const rules = JSON.parse(fs.readFileSync("/tmp/wo-3root/rules.json", "utf8")).items.filter((r) => r.status === "PUBLISHED");

// 金丝雀 A：domains 拿得到（否定结论的天敌）
console.log(`金丝雀A（工具活着）：STATE_VAR_DOMAINS 条数 = ${Object.keys(D).length}`);
if (Object.keys(D).length < 20) { console.log("❌ 工具坏了"); process.exit(2); }
// 金丝雀 B：已知必中 —— demandPressure 必须是压力族 [0,100] rest 0
console.log(`金丝雀B（正向必中）：demandPressure = ${JSON.stringify(D["demandPressure"])}`);
if (D["demandPressure"]?.restPoint !== 0 || D["demandPressure"]?.min !== 0) { console.log("❌ 工具坏了"); process.exit(2); }
// 金丝雀 C（反向鉴别）：forecastBias 必须是唯一带负下界的（[-100,100]）
console.log(`金丝雀C（反向）：forecastBias = ${JSON.stringify(D["forecastBias"])}`);

const inE = new Map();
for (const r of rules) {
  const k = `${r.targetTypeKey}|${r.targetStateVar}`;
  if (!inE.has(k)) inE.set(k, []);
  inE.get(k).push(r.coefficient);
}

const rows = [];
for (const [k, cs] of inE) {
  const sv = k.split("|")[1];
  const d = D[sv];
  const nPos = cs.filter((c) => c > 0).length, nNeg = cs.filter((c) => c < 0).length;
  const single = nPos === 0 || nNeg === 0;
  const dir = nNeg === 0 ? +1 : nPos === 0 ? -1 : 0; // 净入流方向
  // 边界是否「吸收」：saturateToDomain 只在 rest===边界 时退化成硬夹（band=0）
  const floorAbsorb = d ? d.restPoint === d.min : null;
  const ceilAbsorb = d ? (d.max !== null && d.restPoint === d.max) : null;
  const intoFloor = single && dir < 0 && floorAbsorb === true;
  const intoCeil = single && dir > 0 && ceilAbsorb === true;
  rows.push({ k, indeg: cs.length, nPos, nNeg, single, dir, d: d ?? null, declared: !!d, floorAbsorb, ceilAbsorb, intoFloor, intoCeil, cs });
}

const single = rows.filter((r) => r.single);
const oneEdge = rows.filter((r) => r.indeg === 1);
console.log("");
console.log("════ JOIN 结果 ════");
console.log(`目标格(类型·量) 总数          ${rows.length}`);
console.log(`  无域声明（引擎不夹不衰减）   ${rows.filter((r) => !r.declared).length}`);
console.log(`  净入流符号单一               ${single.length}  (${(single.length / rows.length * 100).toFixed(1)}%)`);
console.log(`    其中 全正（只能往上推）     ${single.filter((r) => r.dir > 0).length}`);
console.log(`    其中 全负（只能往下压）     ${single.filter((r) => r.dir < 0).length}`);
console.log(`  入度恰好 = 1（单点依赖）      ${oneEdge.length}  (${(oneEdge.length / rows.length * 100).toFixed(1)}%)`);
console.log("");
console.log(`🔴 净入流方向**指向吸收边界**的格（单+该边界 band=0 硬夹）:`);
console.log(`   压向下界（rest===min）  ${rows.filter((r) => r.intoFloor).length}`);
console.log(`   推向上界（rest===max）  ${rows.filter((r) => r.intoCeil).length}`);
for (const r of rows.filter((r) => r.intoFloor || r.intoCeil)) {
  console.log(`   · ${r.k.padEnd(38)} 入度${r.indeg} 系数[${r.cs.join(", ")}] 域[${r.d.min},${r.d.max}] rest=${r.d.restPoint}`);
}
console.log("");
console.log("──── 入度=1 且全负/全正（最脆形态）逐条 ────");
for (const r of oneEdge.sort((a, b) => a.k.localeCompare(b.k))) {
  const mark = r.intoFloor ? "🔴入地板" : r.intoCeil ? "🔴入顶" : "";
  console.log(`   ${r.k.padEnd(38)} c=${String(r.cs[0]).padEnd(12)} 域[${r.d ? r.d.min : "?"},${r.d ? r.d.max : "?"}] ${mark}`);
}
fs.writeFileSync("/tmp/wo-3root/p1-sign-domain-join.json", JSON.stringify(rows, null, 1));
console.log("\n明细 → /tmp/wo-3root/p1-sign-domain-join.json");
