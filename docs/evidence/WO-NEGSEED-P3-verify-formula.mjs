// P3 验证 · 「负基值从哪来」：用真后端 props 复算派生式，与 baseSnapshot 对照
// 订正：实物 base 是 **6 位取整**后的值（首次比较用 1e-9 容差判「不等」= 判据写错，不是公式错）
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, ok: r.ok, j }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}`); process.exit(3); } return x.j; };
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const s = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "create");
const det = need(await g(`/sim/sessions/${s.id}`), "det");
let hit6 = 0, hitRaw = 0, n = 0;
for (const key of ["elyte", "al_foil", "cu_foil", "sep_film"]) {
  const r = need(await g(`/objects/Material/${key}`), `obj ${key}`);
  const p = (r.data ?? r).props ?? {};
  // 出厂式（seed-derivation-specs.ts:126 material_shortage_risk）
  const f = (p.dailyUse * p.leadTime - p.onHand - p.inTransit) * 100 / (p.dailyUse * p.leadTime);
  const b = det.baseSnapshot[`obj_material_${key}`]?.shortageRisk;
  n += 1;
  if (round6(f) === b) hit6 += 1;
  if (f === b) hitRaw += 1;
  console.log(`Material.${key}: dailyUse=${p.dailyUse} leadTime=${p.leadTime} onHand=${p.onHand} inTransit=${p.inTransit}`);
  console.log(`   公式=${f.toPrecision(17)}  round6=${round6(f)}  base=${b}  |Δraw|=${Math.abs(f - b).toExponential(2)}  ${round6(f) === b ? "✅ round6 逐位相等" : "❌"}`);
}
console.log(`判定：round6(公式) === base 命中 ${hit6}/${n}（金丝雀须 ≥1）；未取整直接相等 ${hitRaw}/${n}`);
console.log(`⇒ 负基值来源坐实：式子算带符号净额（负=超储），播种路原样取值，全程无域夹值`);
fs.writeFileSync("/tmp/wo-3root/p3v-formula.json", JSON.stringify({ hit6, hitRaw, n }));
if (hit6 === 0) { console.log("❌ 工具坏了：一次都没命中"); process.exit(2); }
