// RV2B 追查四：① 会话 baseSnapshot 的负值是否=对象库 props 逐字节（链条第 2 环：基值来自 props，非世界态产物）；
//              ② WO 问题里引的两个数（−59.72 / −10.89）到底是"基值"还是"λ·base 的世界态值"。
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}: ${String(x.t).slice(0,150)}`); process.exit(3); } return x.j; };

const s = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "POST sessions");
const det = need(await g(`/sim/sessions/${s.id}`), "GET session"); const base = det.baseSnapshot;

// ① 基值是不是「派生式算出来的」：用会话自己的 tick0 行**复算** material_shortage_risk
//    = (dailyUse×leadTime − onHand − inTransit)×100/(dailyUse×leadTime)，与 base 逐位对照。
console.log(`\n① 用 tick0 行复算派生式（自证基值不是哈希占位）：`);
let ok = 0, tot = 0;
for (const oid of Object.keys(base)) {
  const row = base[oid]; if (!row || typeof row.shortageRisk !== "number") continue;
  const { dailyUse, leadTime, onHand, inTransit } = row;
  if ([dailyUse, leadTime, onHand, inTransit].some((v) => typeof v !== "number")) continue;
  const hand = Math.round(((dailyUse * leadTime - onHand - inTransit) * 100 / (dailyUse * leadTime)) * 1e6) / 1e6;
  const b = Math.round(row.shortageRisk * 1e6) / 1e6;
  tot += 1; if (hand === b) ok += 1;
  else if (tot <= 6) console.log(`   ❗ ${oid}: 复算=${hand} base=${b}`);
}
console.log(`   shortageRisk 格 ${tot} 个：复算==base（round6）${ok}/${tot}`);
console.log(`   样例 obj_material_elyte：dailyUse=${base["obj_material_elyte"]?.dailyUse} leadTime=${base["obj_material_elyte"]?.leadTime} onHand=${base["obj_material_elyte"]?.onHand} inTransit=${base["obj_material_elyte"]?.inTransit} ⇒ 复算=${Math.round(((base["obj_material_elyte"].dailyUse * base["obj_material_elyte"].leadTime - base["obj_material_elyte"].onHand - base["obj_material_elyte"].inTransit) * 100 / (base["obj_material_elyte"].dailyUse * base["obj_material_elyte"].leadTime)) * 1e6) / 1e6} / base=${base["obj_material_elyte"].shortageRisk}`);
console.log(`   出处章（服务自陈）：elyte.shortageRisk=${det.baseSnapshotProvenance?.["obj_material_elyte"]?.shortageRisk}（measured=取自对象真读数）`);
console.log(`   金丝雀：有 shortageRisk 格的对象 = ${Object.keys(base).filter((o) => typeof base[o]?.shortageRisk === "number").length}（须 >0）`);

console.log(`\n② WO 问题引用的两个数是不是 "基值"：`);
for (const [oid, sv, quoted] of [["obj_material_elyte", "shortageRisk", -59.72], ["obj_model_2170-NCM", "supplyRisk", -10.89]]) {
  const b = base?.[oid]?.[sv];
  const lamB = Math.round(b * 0.37 * 1e12) / 1e12;
  // 两名数都是 2 位小数（0.005 容差）；基值 −161.42 / −29.44 与引用数差 >100 ⇒ 判据有鉴别力
  const isBase = (x) => Math.abs(x - quoted) < 0.005;
  const verdict = isBase(b) && !isBase(lamB) ? "引用的是基值"
    : (!isBase(b) && isBase(lamB) ? "引用的是 世界态值(λ·base 的 2 位小数)，⛔ 不是基值" : "对不上（基值/世界态都不匹配）");
  console.log(`   ${oid}.${sv}: baseSnapshot=${b}（=${b.toFixed(2)}）· 0.37×base=${lamB}（=${lamB.toFixed(2)}）· WO 引用数=${quoted} ⇒ ${verdict}`);
}
console.log(`CAPTURED_RC=0`);
