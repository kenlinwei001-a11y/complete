// P1 · 负边单向传导根因 —— 全图「净入流符号」普查
// 取法：GET /a/v1/sim/propagation-rules（真后端 4019，55 条已发布规则）
// ⛔ 报否定结论前先跑金丝雀（本文件自带 GO 金丝雀 + 反向金丝雀）
import fs from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:4019";
const H = { "X-Debug-User": "demo:admin:admin" };

const j = JSON.parse(fs.readFileSync("/tmp/wo-3root/rules.json", "utf8"));
const items = j.items;

// ── 金丝雀 ①（取法自证）：55 条里必须至少有 1 条 PUBLISHED、1 条负系数、1 条正系数
const pub = items.filter((r) => r.status === "PUBLISHED").length;
const neg = items.filter((r) => typeof r.coefficient === "number" && r.coefficient < 0).length;
const pos = items.filter((r) => typeof r.coefficient === "number" && r.coefficient > 0).length;
console.log(`金丝雀①：总 ${items.length} · PUBLISHED ${pub} · 负系数 ${neg} · 正系数 ${pos}`);
if (!(items.length > 0 && pub > 0 && neg > 0 && pos > 0)) {
  console.log("❌ 工具坏了：取法自证失败");
  process.exit(2);
}

// ── 建索引：目标格 → 入边
const inEdges = new Map(); // key `${tk}|${sv}` -> [{coeff, src, via, delay, combine, id}]
const cells = new Set();
for (const r of items) {
  if (r.status !== "PUBLISHED") continue;
  const tk = `${r.targetTypeKey}|${r.targetStateVar}`;
  if (!inEdges.has(tk)) inEdges.set(tk, []);
  inEdges.get(tk).push({
    coeff: r.coefficient,
    src: `${r.sourceTypeKey}.${r.sourceStateVar}`,
    via: r.viaLinkKey,
    delay: r.delayTicks,
    combine: r.combine,
    id: r.key,
  });
  cells.add(tk);
}
console.log(`参与传导的目标格 ${cells.size} 个（(类型·量) 粒度）`);

// ── 金丝雀 ②（反向鉴别）：只在注释/字典里出现的东西不许被数到。
//   规则里没有 "forecastBias" 作为 target（已退役）——若它仍出现在 target 列表里，说明取法混入了别的东西。
const fbTargets = [...cells].filter((c) => c.includes("forecastBias"));
console.log(`金丝雀②（反向）：target 里含 forecastBias 的格 = ${fbTargets.length}（预期 0，已退役）`);

// ── 逐格判符号
const rows = [];
for (const [tk, es] of inEdges) {
  const signs = es.map((e) => Math.sign(e.coeff));
  const nPos = signs.filter((s) => s > 0).length;
  const nNeg = signs.filter((s) => s < 0).length;
  const nZero = signs.filter((s) => s === 0).length;
  const oneWay = nPos === 0 || nNeg === 0; // 净入流符号单一（含全 0）
  rows.push({ tk, indeg: es.length, nPos, nNeg, nZero, oneWay, edges: es });
}

// 金丝雀 ③（正向对照）：已知必中项 —— Order.demandPressure 的入边数应为 1 且系数为负
const dp = rows.find((r) => r.tk === "Order|demandPressure");
console.log(`金丝雀③（正向）：Order|demandPressure 入度=${dp?.indeg} 系数=${dp?.edges.map((e) => e.coeff).join(",")}`);
if (!dp || dp.indeg !== 1 || dp.nNeg !== 1) {
  console.log("❌ 工具坏了：已知必中项没中");
  process.exit(2);
}
// 金丝雀 ④（鉴别力）：必须存在至少一个「正负混合」的格，否则「单向」这个判定没有鉴别力
const mixed = rows.filter((r) => !r.oneWay);
console.log(`金丝雀④（鉴别力）：正负混合的格 = ${mixed.length}（必须 >0，否则 oneWay 判定无鉴别力）`);
if (mixed.length === 0) {
  console.log("❌ 工具坏了：没有任何混合符号的格，判不出「单向」");
  process.exit(2);
}

const oneWays = rows.filter((r) => r.oneWay);
const oneWayNegOnly = oneWays.filter((r) => r.nNeg > 0 && r.nPos === 0);

console.log("");
console.log("════ 总账 ════");
console.log(`有入边的目标格 (类型·量)：${rows.length}`);
console.log(`  净入流符号单一（全正 或 全负）：${oneWays.length}  (${((oneWays.length / rows.length) * 100).toFixed(1)}%)`);
console.log(`  其中 全负（该格永远只能被往下推）：${oneWayNegOnly.length}  (${((oneWayNegOnly.length / rows.length) * 100).toFixed(1)}%)`);
console.log(`  正负混合（双向）：${mixed.length}  (${((mixed.length / rows.length) * 100).toFixed(1)}%)`);
console.log("");
console.log("──── A. 全负入边（恒 ≤ 0，只能被往下压）────");
console.log("目标格".padEnd(42) + "入度 系数");
for (const r of oneWayNegOnly.sort((a, b) => b.indeg - a.indeg)) {
  console.log(r.tk.padEnd(42) + `${String(r.indeg).padEnd(5)}${r.edges.map((e) => e.coeff).join(", ")}`);
}
console.log("");
console.log("──── B. 全正入边（恒 ≥ 0，只能被往上推）────");
console.log("目标格".padEnd(42) + "入度 系数");
for (const r of oneWays.filter((r) => r.nPos > 0 && r.nNeg === 0).sort((a, b) => b.indeg - a.indeg)) {
  console.log(r.tk.padEnd(42) + `${String(r.indeg).padEnd(5)}${r.edges.map((e) => e.coeff).join(", ")}`);
}
console.log("");
console.log("──── C. 双向（既有正也有负入边）────");
for (const r of mixed) {
  const c = r.edges.map((e) => e.coeff);
  console.log(r.tk.padEnd(42) + `入度${r.indeg}  +${r.nPos}/−${r.nNeg}  [${c.join(", ")}]`);
}
console.log("");
console.log("──── D. 全 0 系数（占位边）────");
for (const r of oneWays.filter((r) => r.nZero === r.indeg)) console.log(r.tk.padEnd(42) + `入度${r.indeg} 全 0`);

// 落盘明细
fs.writeFileSync("/tmp/wo-3root/p1-edge-sign-census.json", JSON.stringify(rows, null, 1));
console.log("\n明细 → /tmp/wo-3root/p1-edge-sign-census.json");
