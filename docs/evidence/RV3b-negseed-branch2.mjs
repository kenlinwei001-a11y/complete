// 评审员#3 · 探针 v4 —— 越域世界态的第二支：**核根本没夹过**（无饱和事件）而 C2 合成把世界态顶出域。
// 判据：对每个 (对象·量) 域格，tick 后 world 越域时问两件事：
//   ① 本拍回执有没有该格的饱和事件？（有 = 夹值被丢弃；无 = 合成自己就越界）
//   ② world − λ·(base−rest) 是否落在域内？（= 核输出在域内，越界完全由 C2 的那一项造成）
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const DOM = D.STATE_VAR_DOMAINS, vref = D.stateVarValueRef;
const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} ; return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}: ${String(x.t).slice(0, 200)}`); process.exit(3); } return x.j; };
const created = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "POST");
const sid = created.id;
const det = need(await g(`/sim/sessions/${sid}`), "GET session");
const base = det.baseSnapshot;
const vc = need(await g("/sim/view-config"), "GET view-config");
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
console.log(`金丝雀：DOMAINS=${Object.keys(DOM).length} 会话 ${sid}`);
const stats = { clampedDiscarded: 0, synthAlone: 0, synthAloneKernelInDom: 0, unknown: 0 };
const samples = [], byCell = new Map();
for (let t = 1; t <= 2; t++) {
  const rt = need(await g(`/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `tick${t}`);
  const w = need(await g(`/sim/sessions/${sid}/world`), `world${t}`);
  const satIdx = new Map((rt.stateVarReport?.saturations ?? []).map((e) => [e.objectId + "|" + e.stateVar, e]));
  const dec = rt.stateVarReport?.decayApplied ?? {};
  console.log(`t${t} saturations=${(rt.stateVarReport?.saturations ?? []).length}`);
  for (const oid of Object.keys(w.state)) {
    const tk = typeOf.get(oid); if (tk === undefined) continue;
    for (const [sv, x] of Object.entries(w.state[oid])) {
      const d = DOM[sv]; if (!d || typeof x !== "number") continue;
      const lo = d.min ?? -Infinity, hi = d.max === null || d.max === undefined ? Infinity : d.max;
      if (!(x < lo || x > hi)) continue;
      const b = base[oid]?.[sv];
      const lam = dec[sv];
      const sat = satIdx.get(oid + "|" + sv);
      const spec = vref(tk, sv) !== undefined;
      if (sat) { stats.clampedDiscarded += 1; }
      else if (typeof b === "number" && lam !== undefined) {
        const kernelOut = x - lam * (b - (d.restPoint ?? 0));
        stats.synthAlone += 1;
        if (kernelOut >= lo && kernelOut <= hi) stats.synthAloneKernelInDom += 1;
        if (samples.length < 8) samples.push(`t${t} ${oid}.${sv} 域[${lo},${hi}] base=${b} world=${x} λ=${lam} 核输出估=${kernelOut} spec=${spec} base在域内=${b >= lo && b <= hi}`);
      } else stats.unknown += 1;
      const k = `${tk}|${sv}`; byCell.set(k, (byCell.get(k) ?? 0) + 1);
    }
  }
}
console.log(`\n=== 越域世界态两支分解（t1–t2）===`);
console.log(`① 有饱和事件（夹值被 C2 丢弃）= ${stats.clampedDiscarded}`);
console.log(`② 无饱和事件（核没夹过，C2 合成自己把世界态顶出域）= ${stats.synthAlone}，其中「核输出估在域内」= ${stats.synthAloneKernelInDom}`);
console.log(`③ 无饱和且拿不到 base/λ（判不了）= ${stats.unknown}`);
for (const s of samples) console.log(`   ⚠️ ${s}`);
console.log(`\n按 (类型·量)：`);
for (const [k, n] of [...byCell].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${k}  ${n}`);
console.log(`\n金丝雀（分支①必须中）：elyte.shortageRisk 的世界态与回执见独立探针 v1/v2；本探针只做分解。`);
