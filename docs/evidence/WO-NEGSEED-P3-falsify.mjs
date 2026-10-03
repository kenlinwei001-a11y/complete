// P3 否证检验 F1/F2 —— 判据写在 /tmp/wo-3root/P3-negative-seed-base-analysis.md §8，跑在其后
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  if (!r.ok) throw new Error(`${p} HTTP ${r.status} ${t.slice(0,150)}`); return JSON.parse(t); };
const TARGETS = [
  ["obj_material_elyte", "shortageRisk"], ["obj_material_al_foil", "shortageRisk"],
  ["obj_model_2170-NCM", "supplyRisk"], ["obj_purchaseorder_po_0", "procurementDelay"],
  ["obj_supplier_SUP-015", "procurementDelay"],
];
const s = await g("/sim/sessions", { method: "POST", body: "{}" });
const det = await g(`/sim/sessions/${s.id}`);
const w0 = await g(`/sim/sessions/${s.id}/world`);

// ── F2：base 是否 === 对象库 props（逐字节）
let f2ok = true, f2n = 0;
for (const [oid, v] of TARGETS) {
  const tk = oid.split("_")[1] === "material" ? "Material" : oid.split("_")[1] === "model" ? "Model"
    : oid.split("_")[1] === "purchaseorder" ? "PurchaseOrder" : "Supplier";
  const key = oid.replace(/^obj_[a-z]+_/, "");
  const r = await g(`/objects/${tk}/${key}`);
  const p = (r.data ?? r).props ?? {};
  const b = det.baseSnapshot[oid]?.[v];
  const eq = b === p[v];
  f2n += 1; if (!eq) f2ok = false;
  console.log(`F2 ${oid}.${v}  base=${b}  props=${p[v]}  ${eq ? "相等" : "❌不等"}`);
}
console.log(`F2 判定：${f2ok ? "✅ 未推翻（播种路逐字节取值）" : "❌ 推翻"}  (n=${f2n})`);
// 金丝雀：必须有一个真不相等的对照位（取一个非规格格）
const base0 = det.baseSnapshot["obj_material_elyte"]; const w00 = w0.state["obj_material_elyte"];
console.log(`金丝雀(反向)：base 与 world0 应逐字节相等 ⇒ ${JSON.stringify(base0) === JSON.stringify(w00) ? "✅ 相等" : "❌ 不等"}`);

// ── F1：推 5 拍，越界规格格须停在 λ·base
await g(`/sim/sessions/${s.id}/tick`, { method: "POST", body: JSON.stringify({ n: 5 }) });
const w5 = await g(`/sim/sessions/${s.id}/world`);
const LAM = 0.37;
let f1ok = true;
for (const [oid, v] of TARGETS) {
  const b = det.baseSnapshot[oid][v]; const x5 = w5.state[oid][v]; const pred = Math.round(LAM * b * 1e12) / 1e12;
  const hold = Math.abs(x5 - pred) < 1e-6;
  // 只对「外生不衰减」的 procurementDelay 与「饱和不动点」的 risk 分别判
  const note = v === "procurementDelay" ? "(外生⇒应恒 = base)" : "(饱和不动点⇒应 = λ·base)";
  const ok = v === "procurementDelay" ? Math.abs(x5 - b) < 1e-6 : hold;
  if (!ok) f1ok = false;
  console.log(`F1 ${oid}.${v} base=${b} t5=${x5} 预测=${v === "procurementDelay" ? b : pred} ${ok ? "✅" : "❌"} ${note}`);
}
console.log(`F1 判定：${f1ok ? "✅ 未推翻（5 拍停在不动点）" : "❌ 推翻"}`);
fs.writeFileSync("/tmp/wo-3root/p3-falsify.json", JSON.stringify({ sid: s.id, f1ok, f2ok }));
