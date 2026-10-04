/**
 * WO-NEG-PRESSURE-ROOTCAUSE · 逐格手算 + 规则表取证（**只读已抓下来的 JSON，不发任何请求**）
 * 跑法：node docs/evidence/WO-NEG-PRESSURE-analyze.mjs <evidenceDir>
 * ⛔ 不改任何产品代码 / 测试 / 域声明 / 公式 / 种子。
 */
import fs from "node:fs";

const EV = process.argv[2];
const rd = (p) => JSON.parse(fs.readFileSync(`${EV}/${p}`, "utf8"));
const r6 = (x) => Math.round(x * 1e6) / 1e6;

const world = rd("WO-NEG-PRESSURE-world-tick0.json");
const rules = rd("WO-NEG-PRESSURE-rules.json").items;
const named = fs
  .readFileSync(`${EV}/WO-NEG-PRESSURE-objs-named.jsonl`, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

const out = [];
const say = (s = "") => out.push(s);

say("═══ A · tick0 入口投影的 17 个负格：逐格手算 vs 实测 ═══");
say("（raw = 落进对象 props 的**派生式输出**；world 态里它已被压到 0 —— 两者**同时**存在，别混）");
say("");

// ── A1 Material.shortageRisk ───────────────────────────────────────────────
// 派生式（seed-derivation-specs.ts:126）：
//   COALESCE((this.dailyUse*this.leadTime - this.onHand - this.inTransit) * 100 / (this.dailyUse*this.leadTime), 0)
const negByVar = {};
for (const e of world.baseStateVarReport.saturations.filter((x) => x.bound === "min")) {
  (negByVar[e.stateVar] ??= []).push(e);
}
let MATCH = 0,
  MISMATCH = 0;
// 比对口径：**按实测值自己的精度比**。派生式落盘时是 4 位小数（实测 −78.1686 而全精度是
// −78.168578）—— 拿全精度去要求实测值相等，会把 14/17 格冤判成「不匹配」，
// 那是**我的比对器的精度**在报错，不是公式对不上。两栏都给：全精度 + 按实测精度取整。
const decimalsOf = (x) => {
  const s = String(x);
  return s.includes(".") ? s.split(".")[1].length : 0;
};
const cmp = (label, measured, calc) => {
  const d = decimalsOf(measured);
  const rounded = Number(calc.toFixed(d));
  const ok = Math.abs(measured - rounded) < 1e-12;
  ok ? MATCH++ : MISMATCH++;
  say(`  ${ok ? "✅" : "🔴"} ${label}  实测=${measured}  手算全精度=${calc}  手算取 ${d} 位=${rounded}  ${ok ? "" : "◀ 逐位不匹配"}`);
};

for (const e of negByVar.shortageRisk ?? []) {
  const p = named.find((n) => n.ref === `Material/${e.objectId}`)?.body?.data?.props;
  if (!p) { say(`  ⚠ ${e.objectId} 无 props ⇒ 无法手算`); continue; }
  const den = p.dailyUse * p.leadTime;
  const calc = ((den - p.onHand - p.inTransit) * 100) / den;
  say(`  · ${e.objectId}  props: dailyUse=${p.dailyUse} leadTime=${p.leadTime} onHand=${p.onHand} inTransit=${p.inTransit}`);
  cmp(`    shortageRisk`, e.raw, calc);
}

say("");
// ── A2 Model.supplyRisk ────────────────────────────────────────────────────
// 派生式（seed-derivation-specs.ts:176）：COALESCE(AVG(out(model_uses_material).shortageRisk), 0)
// 输入集 = 沿链 model_uses_material 从 Model 出发的**出边**目标 Material 的 shortageRisk（**投影前**的 raw）。
const rawOf = (id) => {
  const s = world.baseStateVarReport.saturations.find((x) => x.objectId === id && x.stateVar === "shortageRisk" && x.bound === "min");
  if (s) return { v: s.raw, src: "raw(min事件)" };
  return { v: world.state[id]?.shortageRisk, src: "world态(未越界=已是原值)" };
};
for (const e of negByVar.supplyRisk ?? []) {
  const nb = rd(`WO-NEG-PRESSURE-nb-${e.objectId}.json`);
  const parts = [];
  for (const g of nb.groups ?? []) {
    if (g.linkKey !== "model_uses_material") continue;
    if (g.direction !== "out") { say(`  ⚠ ${e.objectId}: model_uses_material 方向是 ${g.direction} 不是 out ⇒ 取法存疑，停手`); continue; }
    for (const it of g.items ?? []) {
      const r = rawOf(it.id);
      parts.push({ tid: it.id, v: r.v, src: r.src });
    }
  }
  if (!parts.length) { say(`  ⚠ ${e.objectId}: neighbors 里找不到 model_uses_material 出边`); continue; }
  const avg = parts.reduce((a, b) => a + b.v, 0) / parts.length;
  say(`  · ${e.objectId}  n(出边)=${parts.length}  各项=${parts.map((p) => `${p.tid}=${p.v}`).join(", ")}`);
  cmp(`    supplyRisk(AVG)`, e.raw, avg);
}

say("");
// ── A3 PurchaseOrder.expeditePressure ──────────────────────────────────────
// 派生式（seed-derivation-specs.ts:108）：COALESCE(this.shipDay * 100 / (this.etaDay - this.orderDay), 0)
for (const e of negByVar.expeditePressure ?? []) {
  const p = named.find((n) => n.ref === `PurchaseOrder/${e.objectId}`)?.body?.data?.props;
  if (!p) { say(`  ⚠ ${e.objectId} 无 props ⇒ 无法手算`); continue; }
  const win = p.etaDay - p.orderDay;
  const calc = (p.shipDay * 100) / win;
  say(`  · ${e.objectId}  props: shipDay=${p.shipDay} etaDay=${p.etaDay} orderDay=${p.orderDay} (窗口=${win})`);
  cmp(`    expeditePressure`, e.raw, calc);
}

say("");
say(`═══ A 小节：手算逐位比对 MATCH=${MATCH} MISMATCH=${MISMATCH} ═══`);
say("");

// ── B · 规则表：这 4 个量各自的出边（谁还在往它们身上写） ───────────────────
say("═══ B · 运行时规则表：入边（谁往这 4 个量里写） ═══");
say(`规则总数=${rules.length}；PUBLISHED=${rules.filter((r) => r.status === "PUBLISHED").length}`);
for (const v of ["shortageRisk", "supplyRisk", "expeditePressure", "demandPressure"]) {
  const inEdges = rules.filter((r) => r.targetStateVar === v);
  say("");
  say(`  ▸ target=${v}  入边 ${inEdges.length} 条`);
  for (const r of inEdges) {
    say(`     key=${r.key}  ${r.sourceTypeKey}.${r.sourceStateVar} --${r.viaLinkKey}--> ${r.targetTypeKey}.${r.targetStateVar}`);
    say(`        coefficient=${r.coefficient} combine=${r.combine} clamp=${JSON.stringify(r.clamp)} decay=${JSON.stringify(r.decay)} weightRef=${JSON.stringify(r.weightRef)} coefRef=${JSON.stringify(r.coefficientRef)} status=${r.status}`);
    if (r.description) say(`        desc=${r.description}`);
  }
}

// ── C · 逐拍回执：stateVarReport.saturations（核内夹值）两臂对照 ────────────
say("");
say("═══ C · 逐拍回执（tick1 / tick2 零扰动对照臂） ═══");
for (const f of ["WO-NEG-PRESSURE-ticks-1.json", "WO-NEG-PRESSURE-ticks-2.json"]) {
  const t = rd(f);
  const rep = t.stateVarReport ?? t.receipt?.stateVarReport ?? t;
  const s = rep.saturations ?? [];
  const byVar = {};
  for (const e of s) { const o = (byVar[e.stateVar] ??= { n: 0, min: 0, max: 0, sum: 0, mn: 1e9, mx: -1e9 }); o.n++; o.bound === "min" ? o.min++ : o.max++; o.sum += e.raw; o.mn = Math.min(o.mn, e.raw); o.mx = Math.max(o.mx, e.raw); }
  say(`  ▸ ${f}: tick=${t.tick ?? t.state?.tick}  饱和总数=${s.length}`);
  for (const [k, o] of Object.entries(byVar)) say(`     ${k}: n=${o.n} min侧=${o.min} max侧=${o.max} Σraw=${r6(o.sum)} raw∈[${o.mn}, ${o.mx}]`);
  // demandPressure 明细
  const dp = s.filter((e) => e.stateVar === "demandPressure");
  say(`     ── demandPressure 逐格（${dp.length} 条）──`);
  for (const e of dp.slice(0, 12)) say(`        ${e.objectId} raw=${e.raw} -> value=${e.value} bound=${e.bound}`);
  if (dp.length > 12) say(`        …（余 ${dp.length - 12} 条）`);
  fs.writeFileSync(`/tmp/wo-neg/dp-${f.includes("ticks-1") ? "t1" : "t2"}.json`, JSON.stringify(dp, null, 1));
  // 该拍世界态里 demandPressure 的取值
  const st = t.state?.state ?? t.state;
  const vals = [];
  for (const [oid, b] of Object.entries(st ?? {})) if (typeof b?.demandPressure === "number") vals.push([oid, b.demandPressure]);
  say(`     ── 该拍落盘 world 里 demandPressure 共 ${vals.length} 格，取值分布（前 8）: ${vals.slice(0, 8).map(([a, b]) => `${a}=${b}`).join(", ")}`);
  const negs = vals.filter(([, v]) => v < 0);
  say(`     落盘 world 里 demandPressure 为负的格数 = ${negs.length}${negs.length ? " ⇒ 🔴 回执说已夹到 0，落盘却是负 ⇒ 两处矛盾" : " ⇒ 与回执自洽（都是 0）"}`);
  // forecastBias 同拍取值（唯一负系数边的源）
  const fb = [];
  for (const [oid, b] of Object.entries(st ?? {})) if (typeof b?.forecastBias === "number") fb.push([oid, b.forecastBias]);
  say(`     ── 该拍 forecastBias（−0.6 边的源）共 ${fb.length} 格: ${fb.map(([a, b]) => `${a}=${b}`).join(", ")}`);
}

fs.writeFileSync("/tmp/wo-neg/analyze.out", out.join("\n") + "\n");
process.stdout.write(out.join("\n") + "\n");
