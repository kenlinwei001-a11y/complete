// P3 验证 · 对照臂：λ·base 偏移是不是 C2（spec-base-synthesis）专属
// 预测：C2 :81 跳过外生、:84 跳过无 valueRef ⇒ 这两类格上 λ·base 恒等式**不许**成立。
// 若它们也成立 ⇒ 偏移另有来源 ⇒ 归因被推翻。
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const DOMAINS = D.STATE_VAR_DOMAINS, valueRef = D.stateVarValueRef, LAM = 0.37;
const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}`); process.exit(3); } return x.j; };
const s = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "create");
const det = need(await g(`/sim/sessions/${s.id}`), "det");
const base = det.baseSnapshot;
const vc = need(await g("/sim/view-config"), "vc");
const typeOf = new Map(); for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);

// 抽 3 个外生格（procurementDelay：不在域表、代码自述入度 0）+ 3 个非规格衰减格
const ctrl = [];
for (const [oid, v] of [["obj_purchaseorder_po_0", "procurementDelay"], ["obj_supplier_SUP-015", "procurementDelay"], ["obj_purchaseorder_po_12", "procurementDelay"]])
  if (base[oid]?.[v] !== undefined) ctrl.push({ oid, v, kind: "外生(无域)", b: base[oid][v] });
// 非规格：在第一拍 decayApplied 里找 valueRef 未登记的量
let w0 = need(await g(`/sim/sessions/${s.id}/world`), "w0");
const t1 = need(await g(`/sim/sessions/${s.id}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), "t1");
const dec1 = t1.stateVarReport?.decayApplied ?? {};
for (const oid of Object.keys(base)) {
  const tk = typeOf.get(oid); if (!tk) continue;
  for (const sv of Object.keys(base[oid] ?? {})) {
    if (dec1[sv] === undefined) continue;
    if (valueRef(tk, sv) !== undefined) continue;
    if (DOMAINS[sv] === undefined) continue;
    if (ctrl.some((c) => c.oid === oid && c.v === sv)) continue;
    ctrl.push({ oid, v: sv, kind: "非规格(域内衰减)", b: base[oid][sv], tk });
    if (ctrl.filter((c) => c.kind.startsWith("非规格")).length >= 3) break;
  }
  if (ctrl.filter((c) => c.kind.startsWith("非规格")).length >= 3) break;
}
console.log(`对照臂格数 = ${ctrl.length}`); for (const c of ctrl) console.log(`  ${c.kind} ${c.oid}.${c.v} base=${c.b}`);

const rows = []; let prev = w0.state;
for (let t = 1; t <= 6; t++) {
  const rt = t === 1 ? t1 : need(await g(`/sim/sessions/${s.id}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `t${t}`);
  const w = need(await g(`/sim/sessions/${s.id}/world`), `w${t}`);
  const dec = rt.stateVarReport?.decayApplied ?? {};
  for (const c of ctrl) {
    const x = w.state[c.oid]?.[c.v], lam = dec[c.v];
    const rest = DOMAINS[c.v]?.restPoint ?? 0;
    const lamPred = lam === undefined ? null : Math.round((x - LAM * (c.b - rest)) * 1e9) / 1e9;
    rows.push({ t, ...c, x, lam, lamPred });
  }
  prev = w.state;
}
// 判据：对照格上「world = 夹后值 + λ·base」这条（对本组=world 恒 = b + λ·(b−rest)? 不适用）
// 直接测：world 是否 = λ·base（C2 对负基值格的指纹）
let hitLamB = 0;
for (const r of rows) {
  const lamB = Math.round(LAM * r.b * 1e12) / 1e12;
  if (Math.abs(r.x - lamB) < 1e-9) hitLamB += 1;
}
console.log(`\n对照臂点位 = ${rows.length}；其中 world 恰等于 λ·base 的点位 = ${hitLamB}（预测 0，否则归因被推翻）`);
for (const c of ctrl) {
  const rs = rows.filter((r) => r.oid === c.oid && r.v === c.v);
  console.log(`  ${c.oid}.${c.v} [${c.kind}] base=${c.b} λb=${Math.round(LAM * c.b * 1e12) / 1e12} | world=${rs.map((r) => r.x).join(",")} | lam=${rs.map((r) => r.lam ?? "-").join(",")}`);
}
console.log(`判定：${hitLamB === 0 ? "✅ 对照臂干净 —— λ·base 偏移是规格格专属，归因到 C2 成立" : "❌ 对照臂也出现 λ·base ⇒ 偏移另有来源"}`);
fs.writeFileSync("/tmp/wo-3root/p3v-control.json", JSON.stringify(rows));
