// RV2B · 评审员#2 独立复评：C2 合成在核之后 ⇒ 域夹值被丢弃
// 设计（与上游 P3 探针不同）：不预筛「base 越域」的 360 对，而是取**全量 saturations 事件**，
//   对每条事件做 2×2 判别：
//     分组 A = 该格「归派生规格所有」(stateVarValueRef≠undefined) ∧ 本拍该量纲有 λ
//              ⇒ 机制预言：world − 回执夹后值 == λ·base（C2 后写）
//     分组 B = 其余（非规格 / 本拍无 λ）
//              ⇒ 机制预言：world − 回执夹后值 == 0（没有第二个后写者）
//   若 B 组出现非零偏移 ⇒ 「C2 是唯一的后写者」不成立 ⇒ 机制不完整（= 我在找的反例）。
// 另两条反例扫描：① 有饱和事件的格，其 world 是否回到域内（夹值生效？）；② 机制预言逐位校验。
// 只读 + 建会话/推 tick；不写库、不改产品代码。
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const DOMAINS = D.STATE_VAR_DOMAINS, valueRef = D.stateVarValueRef;
const TICKS = 8;

// 金丝雀开跑前必须为真，否则量法全废
console.log(`金丝雀C1：STATE_VAR_DOMAINS=${DOMAINS ? Object.keys(DOMAINS).length : "UNDEF"} 项 / valueRef=${typeof valueRef}`);
console.log(`金丝雀C2：shortageRisk 域 = ${JSON.stringify(DOMAINS?.shortageRisk?.min)}..${JSON.stringify(DOMAINS?.shortageRisk?.max)}（须 0..100）`);
if (!DOMAINS || typeof valueRef !== "function" || DOMAINS.shortageRisk?.min !== 0) { console.log("❌ 工具坏"); process.exit(2); }

const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, j, t }; };
const need = (x, what) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${what}: ${String(x.t).slice(0,200)}`); process.exit(3); } return x.j; };

const created = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "POST /sim/sessions");
const sid = created.id;
const det = need(await g(`/sim/sessions/${sid}`), "GET session");
const w0 = need(await g(`/sim/sessions/${sid}/world`), "GET world t0");
console.log(`会话 ${sid} · 回读一致=${det.id === sid} · curTick=${det.curTick} · baseSnapshot 对象=${Object.keys(det.baseSnapshot).length}`);
if (det.id !== sid) process.exit(3);
const vc = need(await g("/sim/view-config"), "GET view-config");
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
console.log(`金丝雀C3：对象→类型映射 ${typeOf.size} 个（须 >1000）`);
if (typeOf.size < 1000) { console.log("❌ 工具坏：类型映射"); process.exit(2); }

const base = det.baseSnapshot;
const r12 = (x) => Math.round(x * 1e12) / 1e12;
const dom = (sv) => DOMAINS[sv];
const outOf = (sv, v) => { const d = dom(sv); if (!d || typeof v !== "number") return false;
  return v < d.min || (d.max !== null && v > d.max); };

// 全量：base 越域格（用于反例③）
const baseBreach = [];
for (const oid of Object.keys(base)) { const tk = typeOf.get(oid); if (!tk) continue;
  for (const [sv, b] of Object.entries(base[oid] ?? {})) if (typeof b === "number" && outOf(sv, b) && dom(sv))
    baseBreach.push({ oid, tk, sv, b, spec: valueRef(tk, sv) !== undefined }); }
console.log(`口径：base 越域格 = ${baseBreach.length}（规格 ${baseBreach.filter(p=>p.spec).length} / 非规格 ${baseBreach.filter(p=>!p.spec).length}）`);

const A = [], Bg = [], holes = [], stillOut = [], moved = [], worldMinusClampNotZero = [];
let prev = w0.state, satTotal = 0, tickOK = 0;
for (let t = 1; t <= TICKS; t++) {
  const rt = need(await g(`/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `tick ${t}`);
  const w = need(await g(`/sim/sessions/${sid}/world`), `world ${t}`);
  const sat = rt.stateVarReport?.saturations ?? [];
  const dec = rt.stateVarReport?.decayApplied ?? {};
  let n = 0;
  for (const oid of Object.keys(w.state)) { const a = prev[oid], b = w.state[oid]; if (!a || !b) continue;
    for (const k of Object.keys(b)) if (a[k] !== b[k]) n += 1; }
  moved.push(n); if (n > 0) tickOK += 1;
  console.log(`t${t} HTTP=${rt ? 200 : "?"} tick=${w.tick} saturations=${sat.length} 本拍变化格=${n}`);
  for (const s of sat) {
    satTotal += 1;
    const tk = typeOf.get(s.objectId); const b = base?.[s.objectId]?.[s.stateVar]; const lam = dec[s.stateVar];
    if (typeof b !== "number" || typeof lam !== "number") continue; // 无基值/本拍无量纲衰减 ⇒ C2 不作用
    const spec = tk !== undefined && valueRef(tk, s.stateVar) !== undefined;
    const x = w.state?.[s.objectId]?.[s.stateVar];
    if (typeof x !== "number") continue;
    const d = r12(x - s.value);
    const pred = r12(lam * (b - (dom(s.stateVar)?.restPoint ?? 0)));
    const row = { t, oid: s.objectId, sv: s.stateVar, raw: s.raw, clamped: s.value, world: x, base: b, lam, d, pred, spec };
    if (spec) { A.push(row); if (d !== pred) worldMinusClampNotZero.push(row); if (d === 0) holes.push(row); }
    else { Bg.push(row); if (d !== 0) worldMinusClampNotZero.push(row); }
    if (x < dom(s.stateVar).min || (dom(s.stateVar).max !== null && x > dom(s.stateVar).max)) stillOut.push(row);
  }
}
console.log(`\n=== 判别结果（${TICKS} 拍）===`);
console.log(`正向对照：世界态变化拍数 ${tickOK}/${TICKS}（须 =${TICKS}）`);
console.log(`分组 A（规格 ∧ 本拍有 λ）= ${A.length} 条；world−夹后值 == λ·base 逐位成立 = ${A.filter(r=>r.d===r.pred).length}`);
console.log(`   其中 d==0（= 夹值存活，机制漏判）= ${holes.length}`);
console.log(`分组 B（其余：非规格或无 λ）= ${Bg.length} 条；d==0（= 无第二后写者，预言）= ${Bg.filter(r=>r.d===0).length}；d≠0（反例）= ${Bg.filter(r=>r.d!==0).length}`);
console.log(`❌ 机制预言不符的点 = ${worldMinusClampNotZero.length}`);
for (const r of worldMinusClampNotZero.slice(0, 8)) console.log(`   t${r.t} ${r.oid}.${r.sv} spec=${r.spec} world=${r.world} 夹=${r.clamped} d=${r.d} 预言=${r.pred}`);
console.log(`反例③：饱和拍上 world 仍在域外的点 = ${stillOut.length} / ${satTotal} 条饱和事件`);
for (const r of stillOut.slice(0, 6)) console.log(`   t${r.t} ${r.oid}.${r.sv} world=${r.world} 域=[${dom(r.sv).min},${dom(r.sv).max}] 夹后=${r.clamped} spec=${r.spec} λ·base=${r12(r.lam*r.base)}`);
// 反例③另测：base 越域格在 tick≥1 的 world 是否落回域内
let backIn = 0, tested = 0;
const lastWorld = null; // 逐拍已在下面单独取
console.log(`\nbase 越域格 ${baseBreach.length} 个（tick≥1 是否落回域内见下）`);
// 逐拍单独扫描（用同一会话最后一次 world 不够，改逐拍：这里重放一个 2 拍的小扫描）
{
  const c2 = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "POST /sim/sessions#2");
  const s2 = c2.id;
  const d2 = need(await g(`/sim/sessions/${s2}`), "GET session#2");
  const b2 = d2.baseSnapshot;
  // 金丝雀 C4：第二会话的 base 必须与第一会话在越域格上逐位相同，否则第二次扫描无意义
  let same = 0, diff = 0;
  for (const p of baseBreach) { const v2 = b2?.[p.oid]?.[p.sv]; if (typeof v2 !== "number") { diff += 1; continue; } if (v2 === p.b) same += 1; else diff += 1; }
  console.log(`金丝雀C4：两会话 base 在 ${baseBreach.length} 个越域格上 相同=${same} 不同=${diff}（须 不同=0）`);
  if (diff !== 0) { console.log("❌ 基值两会话不一致 ⇒ 第二次扫描口径坏"); process.exit(2); }
  for (let t = 1; t <= 4; t++) {
    need(await g(`/sim/sessions/${s2}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `tick#2 ${t}`);
    const w = need(await g(`/sim/sessions/${s2}/world`), `world#2 ${t}`);
    for (const p of baseBreach) { const tk = typeOf.get(p.oid); if (!tk) continue;
      const spec = valueRef(tk, p.sv) !== undefined; if (!spec) continue;
      const x = w.state?.[p.oid]?.[p.sv]; if (typeof x !== "number") continue;
      tested += 1; if (!outOf(p.sv, x)) backIn += 1; }
  }
  console.log(`反例③（第二次扫描，4 拍）：base 越域规格格采样 ${tested} 点，落回域内 = ${backIn}`);
}
console.log(`\n判定：A 组逐位成立 ${A.filter(r=>r.d===r.pred).length}/${A.length}，B 组反例 ${Bg.filter(r=>r.d!==0).length}，反例③ ${backIn}`);
console.log("CAPTURED_RC=0");
