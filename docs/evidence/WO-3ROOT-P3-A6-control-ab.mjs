// A6 定稿探针：对照臂**同刻双实例 A/B**（不用 17:12 的旧基线档 —— 那台的 4019 已于 17:51 重启，见报告）
// 判据：
//  ① 外生 3 格（procurementDelay，无域）18 点位**逐位不变**（且两实例逐位相同 ⇒ 入口结构性碰不到它）
//  ② 无 valueRef 3 格（ArInvoice.overduePressure）：**若**与 OLD 分叉，必须是「同一常数」且上游分叉格**被点名**
//     （⇒ 反馈），⛔ 不是入口碰了它们自己（那会各差各的、且它们会进 saturations）
//  ③ `world == λ·base` 的点位 = 0（基线 0，须仍为 0）
// 金丝雀：FIX 侧 /world 含 baseStateVarReport 且 OLD 侧不含（否则两实例分不开 = 差分无意义）
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const FIX = "http://127.0.0.1:4399/a/v1", OLD = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/complete/.claude/worktrees/wf_57a1536c-d93-26/apps/datacore/dist/synthetic/battery.js");
const DOMAINS = D.STATE_VAR_DOMAINS, LAM = 0.37;
const g = async (B, p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}`); process.exit(3); } return x.j; };
const mk = async (B, l) => { const s = need(await g(B, "/sim/sessions", { method: "POST", body: "{}" }), l);
  const det = need(await g(B, `/sim/sessions/${s.id}`), l + " det"); return { B, id: s.id, base: det.baseSnapshot, l }; };
const F = await mk(FIX, "FIX"), O = await mk(OLD, "OLD");
const wf0 = need(await g(FIX, `/sim/sessions/${F.id}/world`), "wf0");
const wo0 = need(await g(OLD, `/sim/sessions/${O.id}/world`), "wo0");
console.log(`金丝雀：FIX /world keys=[${Object.keys(wf0).join(",")}]; OLD keys=[${Object.keys(wo0).join(",")}]`);
if (!Object.keys(wf0).includes("baseStateVarReport") || Object.keys(wo0).includes("baseStateVarReport")) { console.log("❌ 工具坏了：两实例分不开"); process.exit(2); }

const EXO = [["obj_purchaseorder_po_0", "procurementDelay"], ["obj_supplier_SUP-015", "procurementDelay"], ["obj_purchaseorder_po_12", "procurementDelay"]];
const NON = [["obj_arinvoice_arinvoice_0_0", "overduePressure"], ["obj_arinvoice_arinvoice_0_1", "overduePressure"], ["obj_arinvoice_arinvoice_0_2", "overduePressure"]];
let exoSame = 0, exoDiff = 0, nonSame = 0, nonFb = 0, nonOdd = 0, hitLamB = 0, pts = 0;
const rows = [];
for (let t = 1; t <= 6; t++) {
  const ra = need(await g(FIX, `/sim/sessions/${F.id}/tick`, { method: "POST", body: '{"n":1}' }), `F t${t}`);
  const rb = need(await g(OLD, `/sim/sessions/${O.id}/tick`, { method: "POST", body: '{"n":1}' }), `O t${t}`);
  const wa = need(await g(FIX, `/sim/sessions/${F.id}/world`), `Fw${t}`);
  const wb = need(await g(OLD, `/sim/sessions/${O.id}/world`), `Ow${t}`);
  const named = new Map((ra.stateVarReport?.saturations ?? []).map((e) => [`${e.objectId}|${e.stateVar}`, e]));
  // 该拍「上游被点名且收回」的格数（反馈来源的证据）
  const satN = (ra.stateVarReport?.saturations ?? []).length;
  const dExo = EXO.map(([o1, s1]) => Math.round((wa.state[o1][s1] - wb.state[o1][s1]) * 1e12) / 1e12);
  const dNon = NON.map(([o1, s1]) => Math.round((wa.state[o1][s1] - wb.state[o1][s1]) * 1e12) / 1e12);
  for (const [o1, s1] of EXO) {
    pts += 1;
    const xa = wa.state[o1][s1], xb = wb.state[o1][s1], b = F.base[o1][s1];
    if (xa === xb) exoSame += 1; else exoDiff += 1;
    const lamB = Math.round(LAM * b * 1e12) / 1e12;
    if (Math.abs(xa - lamB) < 1e-9) hitLamB += 1;
    if (t <= 2) rows.push(`  [外生] ${o1}.${s1} base=${b} λb=${lamB} FIX=${xa} OLD=${xb} ${xa === xb && xa === b ? "逐位=基值" : "⚠"}`);
  }
  const uniq = [...new Set(dNon)];
  for (const [o1, s1] of NON) {
    pts += 1;
    const xa = wa.state[o1][s1], xb = wb.state[o1][s1], b = F.base[o1][s1];
    const lamB = Math.round(LAM * b * 1e12) / 1e12;
    if (Math.abs(xa - lamB) < 1e-9) hitLamB += 1;
    if (xa === xb) nonSame += 1;
    else if (uniq.length === 1 && named.has(`${o1}|${s1}`) === false) nonFb += 1;
    else nonOdd += 1;
  }
  console.log(`t${t} 外生Δ=[${dExo.join(",")}] 非规格Δ=[${dNon.join(",")}] 唯一Δ=(${uniq.join("|")}) 本拍 FIX 点名=${satN} 拍内 FIX 未点名分叉格（反馈上界）=${(function(){let n=0;for(const oid of Object.keys(wa.state))for(const sv of Object.keys(wa.state[oid]??{})){const x=wa.state[oid][sv],y=wb.state[oid][sv];if(typeof x==="number"&&typeof y==="number"&&x!==y&&!named.has(oid+"|"+sv))n++;}return n;})()}`);
  if (t <= 2) for (const [o1, s1] of NON) rows.push(`  [非规格] ${o1}.${s1} base=${F.base[o1][s1]} λb=${Math.round(LAM * F.base[o1][s1] * 1e12) / 1e12} FIX=${wa.state[o1][s1]} OLD=${wb.state[o1][s1]}`);
}
console.log("\n点位明细（t1–t2）："); for (const r of rows) console.log(r);
console.log(`\n外生 18 点位：逐位相同 ${exoSame} / 不同 ${exoDiff}（须 18/0）；且须恒 = 基值 −4/−6/−7`);
console.log(`非规格 18 点位：逐位相同 ${nonSame}；共享常数式分叉（=反馈）${nonFb}；其它形态 ${nonOdd}`);
console.log(`λ·base 命中点位数 = ${hitLamB} / ${pts}（基线 0，须仍为 0）`);
const ok = exoSame === 18 && exoDiff === 0 && hitLamB === 0 && nonOdd === 0;
console.log(`判定：${ok ? "✅ A6 成立（外生逐位不变；非规格分叉全为共享常数反馈；λ·base 仍为 0）" : "❌ A6 有判据未成立"}`);
process.exit(ok ? 0 : 1);
