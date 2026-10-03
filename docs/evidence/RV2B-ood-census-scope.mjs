// RV2B 追查三：tick≥1 世界态越域格的**归属普查**——是否全部落在 C2 的写入作用域内？
//   若存在「C2 作用域外」的越域格 ⇒ 机制不完整（还有第二个破坏不变量的通道）。
//   作用域判据照 `spec-base-synthesis.ts:76-88` 三条：λ 本拍有 ∧ !isExogenous ∧ valueRef≠undefined。
// 顺带：把 saturateToDomain 作用在世界态上，数越域格是否清零（该函数的返回值必在域内）。
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const C = await import("/Users/apple/deploy/wo-edge-wire/packages/contracts/dist/index.js");
const P = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/sim/propagation.js");
const DOMAINS = D.STATE_VAR_DOMAINS, valueRef = D.stateVarValueRef;
const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}: ${String(x.t).slice(0,150)}`); process.exit(3); } return x.j; };
const rules = (await g("/sim/propagation-rules")).j; const rl = Array.isArray(rules) ? rules : (rules?.rules ?? rules?.items ?? []);
const roles = C.buildCellRoles(rl);
console.log(`金丝雀：规则 ${rl.length} 条 / isExogenous 可用=${typeof roles.isExogenous} / 域表 ${Object.keys(DOMAINS).length} 项`);
// 金丝雀②：判据必须有鉴别力 —— Base.loadIndex 必非外生、Model.forecastBias 必外生；否则 buildCellRoles 是空表
const exoProbe = [["Base", "loadIndex"], ["Model", "forecastBias"]].map(([tk, sv]) => `${tk}.${sv}=${roles.isExogenous(tk, sv)}`).join(" · ");
console.log(`金丝雀②：${exoProbe}（须 Base.loadIndex=false ∧ Model.forecastBias=true）`);
if (rl.length === 0 || roles.isExogenous("Base", "loadIndex") !== false) { console.log("❌ 工具坏：规则/角色表取不到，作用域判据无鉴别力"); process.exit(2); }

const s = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "POST sessions");
const det = need(await g(`/sim/sessions/${s.id}`), "GET session"); const base = det.baseSnapshot;
const vc = need(await g("/sim/view-config"), "GET view-config");
const typeOf = new Map(); for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);

const domOf = (sv) => DOMAINS[sv];
const outOf = (sv, v) => { const d = domOf(sv); return !!d && typeof v === "number" && (v < d.min || (d.max !== null && v > d.max)); };

const rows = [];
for (let t = 1; t <= 8; t++) {
  const rt = need(await g(`/sim/sessions/${s.id}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `tick ${t}`);
  const w = need(await g(`/sim/sessions/${s.id}/world`), `world ${t}`);
  const dec = rt.stateVarReport?.decayApplied ?? {};
  let inScope = 0, outScope = 0, outScopeNonSpec = 0, clampedAway = 0, total = 0; const outSamples = [];
  for (const oid of Object.keys(w.state)) {
    const tk = typeOf.get(oid); if (tk === undefined) continue;
    for (const [sv, x] of Object.entries(w.state[oid])) {
      if (!outOf(sv, x)) continue;
      total += 1;
      const lam = dec[sv];
      const scoped = typeof lam === "number" && !roles.isExogenous(tk, sv) && valueRef(tk, sv) !== undefined;
      if (scoped) inScope += 1; else { outScope += 1; if (valueRef(tk, sv) === undefined) outScopeNonSpec += 1;
        if (outSamples.length < 4) outSamples.push(`t${t} ${oid}.${sv} tk=${tk} world=${x} λ=${lam ?? "-"} spec=${valueRef(tk, sv) !== undefined} exo=${roles.isExogenous(tk, sv)}`); }
      const d = domOf(sv);
      if (Math.abs(P.saturateToDomain(x, d.min, d.max, d.restPoint ?? 0) - x) > 1e-12) clampedAway += 1;
    }
  }
  rows.push({ t, total, inScope, outScope, outScopeNonSpec, clampedAway });
  console.log(`t${t} 越域格=${total} · 落在 C2 作用域内=${inScope} · 作用域外=${outScope}（其中非规格 ${outScopeNonSpec}） · 「合成后再夹一次」会动的格=${clampedAway}`);
  for (const l of outSamples) console.log("   ⚠ " + l);
}
const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
console.log(`\n合计 8 拍：越域格采样 ${sum("total")} · C2 作用域内 ${sum("inScope")} · 作用域外 ${sum("outScope")}（非规格 ${sum("outScopeNonSpec")}）`);
console.log(`「合成后再夹一次」可消除 ${sum("clampedAway")}/${sum("total")} 格（saturateToDomain 返回必落域内）`);
console.log(`CAPTURED_RC=0`);
