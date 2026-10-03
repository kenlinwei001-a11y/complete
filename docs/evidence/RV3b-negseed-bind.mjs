// 评审员#3 独立探针（不是上游探针的重跑）—— 目标：独立检验「域夹值被核之后的 C2 合成层丢弃」这一机制。
// 判据先声明（跑之前）：
//   · 机制预言 M1：基值越界 且 本拍回执点名夹过 的格 ⇒ world ≡ 夹后值 + λ·(base − rest)（逐位）
//   · 机制预言 M2：**同一个 tick、同一次夹**，被 C2 跳过的格（valueRef 未登记）world ≡ 夹后值（无 λ·base 项）
//     —— M2 是本探针新加的「同跑内差分对照」：它把「世界态为什么留着越界值」归因到 C2 的守卫，而不是别的通道
//   · 否证 F1：存在越界基值格在 tick≥1 落回域内 ⇒ 机制漏看了别的夹值通道
//   · 否证 F2：存在越界基值格 world ≠ 夹后值 + λ·(base−rest) ⇒ 机制算错
//   · 否证 F3：非规格格（C2 必跳过）里出现「回执夹了而 world ≠ 夹后值」⇒ 丢弃不只发生在 C2
//   · 正向对照：世界态每拍必须在动（否则读数可能是冻结/缓存）
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const DOM = D.STATE_VAR_DOMAINS, vref = D.stateVarValueRef;
const TICKS = 8;
// ── 金丝雀 0：量具活着（域表 / valueRef 必须取到，否则一切结论作废）
console.log(`金丝雀0 ：DOMAINS=${DOM ? Object.keys(DOM).length : "UNDEF"} 项 vref=${typeof vref}`);
console.log(`金丝雀0b：shortageRisk 域=${JSON.stringify(DOM.shortageRisk)}（须 min=0 才能判下界越界）`);
if (!DOM || typeof vref !== "function" || DOM.shortageRisk?.min !== 0) { console.log("❌ 工具坏了"); process.exit(2); }

const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} ; return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}: ${String(x.t).slice(0, 160)}`); process.exit(3); } return x.j; };

const created = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "POST sessions");
const sid = created.id;
const det = need(await g(`/sim/sessions/${sid}`), "GET session");
const w0 = need(await g(`/sim/sessions/${sid}/world`), "GET world t0");
const base = det.baseSnapshot;
console.log(`会话 ${sid} curTick=${det.curTick} baseSnapshot 对象=${Object.keys(base).length} 回读id=${det.id === sid ? "一致" : "❌"}`);
if (det.id !== sid || Object.keys(base).length < 100) { console.log("❌ 会话/基值没建起来"); process.exit(3); }
const vc = need(await g("/sim/view-config"), "GET view-config");
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
console.log(`金丝雀0c：对象→类型映射 ${[...Object.keys(base)].filter((o) => typeOf.has(o)).length}/${Object.keys(base).length}`);

// ── 独立复核「播种路逐字节取对象 props」（F2）—— 走 REST 对象端点，不走 dist
console.log(`\n=== 播种路 base ≡ 对象 props 复核（REST /objects/<类型>/<id>）===`);
let propEqual = 0, propN = 0, propBad = [];
for (const [oid, tk] of [["obj_material_elyte", "Material"], ["obj_material_al_foil", "Material"], ["obj_purchaseorder_po_12", "PurchaseOrder"], ["obj_purchaseorder_po_6", "PurchaseOrder"], ["obj_model_2170-NCM", "Model"]]) {
  const o = need(await g(`/objects/${tk}/${oid}`), `object ${oid}`);
  const props = o.data?.props ?? {};
  for (const [sv, bv] of Object.entries(base[oid] ?? {})) {
    if (!(sv in props)) continue;
    propN += 1;
    if (props[sv] === bv) propEqual += 1; else propBad.push(`${oid}.${sv} props=${props[sv]} base=${bv}`);
  }
}
console.log(`对比格数=${propN} 逐位相等=${propEqual} 不等=${propBad.length}`);
for (const l of propBad.slice(0, 5)) console.log(`   🔴 ${l}`);
console.log(`金丝雀0d：props 端点确有数字（elyte.shortageRisk=${(await g(`/objects/Material/obj_material_elyte`)).j.data.props.shortageRisk}，须为负 = 越界基值的真身）`);

// ── 目标集合：base 越出声明域
const pairs = [];
for (const oid of Object.keys(base)) {
  const tk = typeOf.get(oid); if (!tk) continue;
  for (const [sv, b] of Object.entries(base[oid] ?? {})) {
    const d = DOM[sv]; if (!d || typeof b !== "number") continue;
    if (b < (d.min ?? -Infinity) || (d.max !== null && d.max !== undefined && b > d.max)) pairs.push({ oid, tk, sv, b, d, spec: vref(tk, sv) !== undefined });
  }
}
const specP = pairs.filter((p) => p.spec), nonSpecP = pairs.filter((p) => !p.spec);
console.log(`\n越界基值 (对象·量) 对 = ${pairs.length}（规格 ${specP.length} / 非规格 ${nonSpecP.length}）`);
if (pairs.length === 0) { console.log("❌ 金丝雀坏了：一对都没选中（已知 elyte.shortageRisk=−161 必须被选中）"); process.exit(2); }
if (!pairs.some((p) => p.oid === "obj_material_elyte" && p.sv === "shortageRisk")) { console.log("❌ 金丝雀坏了：elyte.shortageRisk 没被选中"); process.exit(2); }

// ── 逐拍：n=1，拿回执 + 世界态
let M1 = 0, M1miss = [], M1hit = 0, F1 = [], F1n = 0, F3 = 0, F3miss = [];
let satSpec = 0, clampDiscard = 0, exactLambdaBase = 0;
let M2n = 0, M2hit = 0, M2miss = [];
let movedTicks = 0, prev = w0.state;
const byPair = new Map(pairs.map((p) => [p.oid + "|" + p.sv, []]));
const idx = new Map(pairs.map((p) => [p.oid + "|" + p.sv, p]));
// 非规格格的 sat（C2 必跳过）
const nonSpecSat = new Map(nonSpecP.map((p) => [p.oid + "|" + p.sv, p]));
for (let t = 1; t <= TICKS; t++) {
  const rt = need(await g(`/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `tick t${t}`);
  const w = need(await g(`/sim/sessions/${sid}/world`), `world t${t}`);
  const sat = rt.stateVarReport?.saturations ?? [];
  const dec = rt.stateVarReport?.decayApplied ?? {};
  let moved = 0;
  for (const oid of Object.keys(w.state)) { const a = prev[oid], b = w.state[oid]; if (!a || !b) continue; for (const k of Object.keys(b)) if (a[k] !== b[k]) moved += 1; }
  if (moved > 0) movedTicks += 1;
  console.log(`t${t} HTTP=${rt ? 200 : "?"} tick=${w.tick} saturations=${sat.length} 变化格=${moved}`);
  const satIdx = new Map(sat.map((e) => [e.objectId + "|" + e.stateVar, e]));
  // ── M1（规格格）
  for (const p of specP) {
    const k = p.oid + "|" + p.sv; const x = w.state[p.oid]?.[p.sv]; const s = satIdx.get(k);
    byPair.get(k).push({ t, x, base: p.b, rest: p.d.restPoint ?? 0, sat: s ? { raw: s.raw, value: s.value, bound: s.bound } : null, lam: dec[p.sv] });
    const lo = p.d.min ?? -Infinity, hi = p.d.max === null || p.d.max === undefined ? Infinity : p.d.max;
    if (s) {
      satSpec += 1;
      const lam = dec[p.sv] ?? 0.37; // 回执给 λ；缺则用默认 0.37（判据仍逐位）
      const pred = s.value + lam * (p.b - (p.d.restPoint ?? 0));
      if (Math.abs(x - pred) <= 1e-6) { M1hit += 1; if (Math.abs(x - (s.value + 0.37 * p.b)) <= 1e-6) exactLambdaBase += 1; }
      else { M1miss.push(`t${t} ${k} base=${p.b} world=${x} 夹后=${s.value} 预言=${pred}`); }
      if (Math.abs(x - s.value) > 1e-6) clampDiscard += 1;
      if (x >= lo && x <= hi) F1.push(`t${t} ${k} base=${p.b} world=${x}`); // 越界基值却落回域内
    } else if (dec[p.sv] !== undefined) {
      // 未饱和衰减拍：核输出 = world − λ·base 必须仍在域内（否则核没夹住）
      const coreOut = x - (dec[p.sv]) * (p.b - (p.d.restPoint ?? 0));
      if (coreOut < lo - 1e-9 || coreOut > hi + 1e-9) F1n += 1;
    }
  }
  // ── M2（同跑内差分对照）：非规格格被夹 ⇒ world 必须 ≡ 夹后值（C2 不碰它们）
  for (const [k, p] of nonSpecSat) {
    const s = satIdx.get(k); if (!s) continue;
    const x = w.state[p.oid]?.[p.sv];
    M2n += 1;
    if (typeof x === "number" && Math.abs(x - s.value) <= 1e-6) M2hit += 1;
    else M2miss.push(`t${t} ${k} 夹后=${s.value} world=${x}`);
    if (typeof x === "number" && Math.abs(x - s.value) > 1e-6) F3 += 1;
  }
  prev = w.state;
}
console.log(`\n=== 汇总（${TICKS} 拍）===`);
console.log(`正向对照：世界态在动的拍数 = ${movedTicks}/${TICKS}`);
console.log(`【M1】规格格饱和采样 ${satSpec} 点；world ≡ 夹后值+λ·(base−rest) 命中 ${M1hit}；落空 ${M1miss.length}`);
for (const l of M1miss.slice(0, 6)) console.log(`   🔴 ${l}`);
console.log(`   ↳ 其中 world ≡ 夹后值+λ·base（rest=0）逐位 = ${exactLambdaBase}`);
console.log(`   ↳ 「回执报夹到 X 而 world ≠ X」= ${clampDiscard}/${satSpec}`);
console.log(`【否证 F1】越界基值规格格 tick≥1 落回域内 = ${F1.length}`);
for (const l of F1.slice(0, 6)) console.log(`   ⚠️ ${l}`);
console.log(`【否证 F1b】未饱和拍「world−λ·base 越出域」= ${F1n}（核未夹住的反证）`);
console.log(`【M2·同跑内差分】非规格格被夹采样 ${M2n} 点；world ≡ 夹后值 命中 ${M2hit}；落空 ${M2miss.length}`);
for (const l of M2miss.slice(0, 6)) console.log(`   🔴 ${l}`);
console.log(`【否证 F3】非规格格 world ≠ 夹后值 = ${F3}`);
// 逐对象轨迹（只印规格格）
console.log(`\n=== 规格格轨迹（λb = 逐位等于 λ·base）===`);
for (const [k, rs] of byPair) {
  const p = idx.get(k); if (!rs.length) continue;
  const lam = 0.37; const seq = rs.map((r) => (Math.abs(r.x - lam * p.b) <= 1e-6 ? "λb" : Number(r.x).toFixed(6))).join(",");
  const named = rs.filter((r) => r.sat).length;
  console.log(`  ${k} base=${p.b} 域[${p.d.min},${p.d.max}] | ${seq} | 回执点名 ${named}/${rs.length}`);
}
fs.writeFileSync("/tmp/wo-review3/rv3b-summary.json", JSON.stringify({ sid, pairs: pairs.length, spec: specP.length, nonSpec: nonSpecP.length, M1hit, M1miss, clampDiscard, exactLambdaBase, F1, F1n, M2n, M2hit, M2miss, movedTicks }, null, 1));
console.log(`\n判定：M1 ${M1miss.length === 0 ? "未推翻" : "🔴 被推翻"} / F1 ${F1.length === 0 ? "0 命中" : "🔴 命中"} / M2 ${M2miss.length === 0 ? "未推翻（C2 跳过 ⇒ 夹值存活）" : "🔴 被推翻"}`);
