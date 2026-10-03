// RV2B 追查二：① 主探针里 96 个「d==0」是不是外生豁免（C2 明确跳过）⇒ 属机制内，不是洞；
//                ② 落回域内那 9 点是否与订正机制一致（world − λ·base 是否仍在域内）。
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const C = await import("/Users/apple/deploy/wo-edge-wire/packages/contracts/dist/index.js");
const DOMAINS = D.STATE_VAR_DOMAINS, valueRef = D.stateVarValueRef, r12 = (x) => Math.round(x * 1e12) / 1e12;
const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}`); process.exit(3); } return x.j; };

// 规则（用于 buildCellRoles / isExogenous）
const rules = (await g("/sim/propagation-rules")).j;
const rl = Array.isArray(rules) ? rules : (rules?.rules ?? rules?.items ?? []);
console.log(`金丝雀R1：规则数 = ${rl.length}（须 >0）`);
if (!(rl.length > 0)) { console.log("❌ 规则取不到"); process.exit(2); }
const roles = C.buildCellRoles(rl);
console.log(`金丝雀R2：isExogenous 可用 = ${typeof roles?.isExogenous}；抽样 Material|shortageRisk 外生? = ${roles.isExogenous("Material", "shortageRisk")}；Model|forecastBias 外生? = ${roles.isExogenous("Model", "forecastBias")}`);

const s = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "POST sessions");
const sid = s.id;
const det = need(await g(`/sim/sessions/${sid}`), "GET session");
const base = det.baseSnapshot;
const vc = need(await g("/sim/view-config"), "GET view-config");
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
const dom = (sv) => DOMAINS[sv];
const outOf = (sv, v) => { const d = dom(sv); return !!d && (v < d.min || (d.max !== null && v > d.max)); };

let dZeroExo = 0, dZeroLamBZero = 0, dZeroOther = 0; const otherSamples = [];
let backInConsistent = 0, backInInconsistent = 0; const backInRows = [];
const TICKS = 4;
for (let t = 1; t <= TICKS; t++) {
  const rt = need(await g(`/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `tick ${t}`);
  const w = need(await g(`/sim/sessions/${sid}/world`), `world ${t}`);
  const dec = rt.stateVarReport?.decayApplied ?? {};
  for (const ev of rt.stateVarReport?.saturations ?? []) {
    const tk = typeOf.get(ev.objectId); const b = base?.[ev.objectId]?.[ev.stateVar]; const lam = dec[ev.stateVar];
    if (typeof b !== "number" || typeof lam !== "number" || tk === undefined) continue;
    if (valueRef(tk, ev.stateVar) === undefined) continue; // 只看规格格
    const x = w.state?.[ev.objectId]?.[ev.stateVar]; if (typeof x !== "number") continue;
    const d = r12(x - ev.value), lamB = r12(lam * (b - (dom(ev.stateVar)?.restPoint ?? 0)));
    if (d === 0) {
      if (roles.isExogenous(tk, ev.stateVar)) dZeroExo += 1; else if (lamB === 0) dZeroLamBZero += 1;
      else { dZeroOther += 1; if (otherSamples.length < 5) otherSamples.push(`t${t} ${ev.objectId}.${ev.stateVar} tk=${tk} world=${x} 夹=${ev.value} base=${b} λ=${lam} λ·base=${lamB} spec=${valueRef(tk, ev.stateVar) !== undefined}`); }
    }
  }
  // ② 落回域内的点（规格 ∧ base 越域）
  for (const oid of Object.keys(w.state)) {
    const tk = typeOf.get(oid); if (!tk) continue;
    for (const [sv, x] of Object.entries(w.state[oid])) {
      if (typeof x !== "number" || !outOf(sv, base[oid]?.[sv]) || !dom(sv)) continue;
      if (valueRef(tk, sv) === undefined) continue;
      if (!outOf(sv, x)) { // world 落回域内
        const lam = dec[sv]; const b = base[oid][sv];
        const inferred = typeof lam === "number" ? r12(x - lam * b) : null;
        const ok = inferred !== null && !outOf(sv, inferred);
        if (ok) backInConsistent += 1; else backInInconsistent += 1;
        if (backInRows.length < 12) backInRows.push(`t${t} ${oid}.${sv} base=${b} world=${x} λ=${lam ?? "-"} 反推核输出=${inferred} 域=[${dom(sv).min},${dom(sv).max}] ${ok ? "（核输出在域内 ⇒ 复合值入域，机制内）" : "（核输出越域 ⇒ 与机制不符❗）"}`);
      }
    }
  }
}
console.log(`\n① d==0 的 96 类：外生豁免 = ${dZeroExo}；λ·base==0（偏移本就是 0）= ${dZeroLamBZero}；其余未解释 = ${dZeroOther}`);
for (const l of otherSamples) console.log("   ❗ " + l);
console.log(`\n② 落回域内点：与订正机制一致 = ${backInConsistent}，不一致 = ${backInInconsistent}`);
for (const l of backInRows) console.log("   " + l);
console.log(`\nCAPTURED_RC=0`);
