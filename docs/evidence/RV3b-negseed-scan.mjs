// 评审员#3 · 探针 v3 —— 触发器**完备性**扫描：世界态越域的格子，是不是全由「基值越域」引起？
// 机制陈述的前提是「只要播种基值越出声明域 ⇒ world = 夹后值 + λ·base 越界」。
// 若存在 **基值在域内** 而 world 越域的格 ⇒ 触发器条件写窄了（同一机制的另一支：夹后值 + λ·base 本身越界）。
// 判据 F5（跑前声明）：基值在域内、tick≥1 世界态越域的点位 = 0 ⇒ 机制完备；>0 ⇒ 报告该支并给出样本。
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const DOM = D.STATE_VAR_DOMAINS, vref = D.stateVarValueRef;
const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} ; return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}: ${String(x.t).slice(0, 200)}`); process.exit(3); } return x.j; };
console.log(`金丝雀：DOMAINS=${Object.keys(DOM).length}（须 ≥38）`);
const created = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "POST");
const sid = created.id;
const det = need(await g(`/sim/sessions/${sid}`), "GET session");
const base = det.baseSnapshot;
const vc = need(await g("/sim/view-config"), "GET view-config");
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
console.log(`会话 ${sid}；baseSnapshot ${Object.keys(base).length} 对象`);
// 金丝雀：域内基值样本存在（反向对照），域外基值样本存在
let inN = 0, outN = 0;
for (const oid of Object.keys(base)) for (const [sv, b] of Object.entries(base[oid] ?? {})) {
  const d = DOM[sv]; if (!d || typeof b !== "number") continue;
  const lo = d.min ?? -Infinity, hi = d.max === null || d.max === undefined ? Infinity : d.max;
  if (b < lo || b > hi) outN += 1; else inN += 1;
}
console.log(`金丝雀a：基值在域内格 ${inN}（须 >0）；越域格 ${outN}（须 >0）`);
if (!inN || !outN) { console.log("❌ 工具坏了"); process.exit(2); }

const inDomBase = new Map(); // key -> {oid,sv,tk,b,d}
let breachedInDom = [], breachedOutDom = 0, total = 0;
const distinct = new Map();
for (let t = 1; t <= 4; t++) {
  const rt = need(await g(`/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `tick${t}`);
  const w = need(await g(`/sim/sessions/${sid}/world`), `world${t}`);
  const dec = rt.stateVarReport?.decayApplied ?? {};
  let bIn = 0, bOut = 0, bInSamples = [];
  for (const oid of Object.keys(w.state)) {
    const tk = typeOf.get(oid); if (tk === undefined) continue;
    for (const [sv, x] of Object.entries(w.state[oid])) {
      const d = DOM[sv]; if (!d || typeof x !== "number") continue;
      const b = base[oid]?.[sv]; if (typeof b !== "number") continue;
      const lo = d.min ?? -Infinity, hi = d.max === null || d.max === undefined ? Infinity : d.max;
      const baseOut = b < lo || b > hi;
      if (x < lo || x > hi) {
        total += 1;
        if (baseOut) bOut += 1;
        else { bIn += 1; if (bInSamples.length < 5) bInSamples.push(`t${t} ${oid}.${sv} 域[${lo},${hi}] base=${b} world=${x} λ=${dec[sv]}`); }
        const k = `${tk}|${sv}`; const cur = distinct.get(k) ?? { baseOut: 0, baseIn: 0, sample: "" };
        if (baseOut) cur.baseOut += 1; else { cur.baseIn += 1; cur.sample = cur.sample || `${oid} base=${b} world=${x}`; }
        distinct.set(k, cur);
      }
    }
  }
  console.log(`t${t} 世界态越域点：基值越域 ${bOut} / 基值在域内 ${bIn}${bIn ? "  ← F5 命中" : ""}`);
  for (const s of bInSamples) console.log(`   ⚠️ ${s}`);
}
console.log(`\n总计世界态越域点 = ${total}（基值越域 ${breachedOutDom + (total - breachedOutDom - 0) === total ? "" : ""}）`);
console.log(`【F5】基值在域内而世界态越域 = ${total - [...distinct.values()].reduce((a, c) => a + c.baseOut, 0)}`);
console.log(`按 (类型·量) 聚合：`);
for (const [k, v] of [...distinct].sort((a, b) => (b[1].baseIn + b[1].baseOut) - (a[1].baseIn + a[1].baseOut))) console.log(`   ${k}  基值越域点 ${v.baseOut} / 基值在域内点 ${v.baseIn} ${v.baseIn ? "← " + v.sample : ""}`);
