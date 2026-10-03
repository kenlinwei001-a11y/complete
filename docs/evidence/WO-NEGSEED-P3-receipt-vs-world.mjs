// P3 · 回执 vs 世界态 矛盾取证 —— 每拍追踪 Model.supplyRisk / Material.shortageRisk
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  if (!r.ok) throw new Error(`${p} HTTP ${r.status} ${t.slice(0,150)}`); return JSON.parse(t); };
const T = [["obj_material_elyte", "shortageRisk"], ["obj_model_2170-NCM", "supplyRisk"]];
const s = await g("/sim/sessions", { method: "POST", body: "{}" });
const det = await g(`/sim/sessions/${s.id}`);
let bad = 0, satTicks = 0, n = 0;
for (const [oid, v] of T) {
  const base = det.baseSnapshot[oid][v];
  console.log(`\n${oid}.${v}  base=${base}  λ·base=${(0.37 * base).toFixed(6)}`);
  for (let t = 1; t <= 6; t++) {
    const rt = await g(`/sim/sessions/${s.id}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) });
    const w = await g(`/sim/sessions/${s.id}/world`);
    const sat = (rt.stateVarReport?.saturations || []).find((e) => e.objectId === oid && e.stateVar === v);
    const x = w.state[oid][v]; n += 1;
    const off = sat ? x - sat.value : null;
    if (sat && off !== null && Math.abs(off - 0.37 * base) < 1e-6) { bad += 1; satTicks += 1;
      console.log(`  t${t} 🔴回执「已夹 ${sat.raw.toFixed(4)}→${sat.value} bound=${sat.bound}」但世界态=${x.toFixed(6)} = 夹后值+λ·base（offset=${off.toFixed(6)} 逐位=λ·base）`); }
    else console.log(`  t${t} world=${x.toFixed(6)}  ${sat ? `回执已夹 raw=${sat.raw.toFixed(4)}→${sat.value}` : "核本拍未饱和"}`);
  }
}
console.log(`\n回执与世界态矛盾拍数 = ${bad} / 采样 ${n}`);
// 金丝雀：矛盾必须真的出现（否则探针空转）
if (bad === 0) { console.log("❌ 工具/机制坏了：一次矛盾都没抓到"); process.exit(2); }
console.log("✅ 金丝雀过：矛盾被抓到");
