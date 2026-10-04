// P3T · 对照实验 v2（**干净基线臂**）
//   X  = 未修：4402 = wo-edge-wire/dist（P2 tip 构建）**全新启动**（4019 长期被多 agent 驱动，对象库已漂移 ⇒ 只作旁证）
//   X' = 修复：4401 = 本分支 224dbdd52 构建
// v1 的 299「台账外变化」经 4402 对照判定为 **4019 实例漂移**，不是本单静默改动 —— 本版用干净臂重测。
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const OLD = "http://127.0.0.1:4402/a/v1", FIX = "http://127.0.0.1:4401/a/v1", DRIFT = "http://127.0.0.1:4019/a/v1";
const DIST = "/tmp/wt-p3/apps/datacore/dist", LAM = 0.37, TICKS = 4;
const D = await import(DIST + "/synthetic/battery.js");
const DOM = D.STATE_VAR_DOMAINS;
const g = async (B, p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ FATAL HTTP ${x.status} @${w}`); process.exit(3); } return x.j; };
const mk = async (B) => { const s = need(await g(B, "/sim/sessions", { method: "POST", body: "{}" }), "mk");
  const d = need(await g(B, `/sim/sessions/${s.id}`), "det"); return { B, id: s.id, base: d.baseSnapshot, det: d }; };
const nDom = Object.keys(DOM).length, refSR = D.stateVarValueRef?.("Material", "shortageRisk");
console.log(`阳性对照⓪ STATE_VAR_DOMAINS=${nDom}（≥38）valueRef(Material,shortageRisk)=${refSR !== undefined}`);
if (nDom < 38 || refSR === undefined) { console.log("❌ ⓪ 不成立"); process.exit(2); }
const F = await mk(FIX), O = await mk(OLD);
const wf = need(await g(FIX, `/sim/sessions/${F.id}/world`), "wf"), wo = need(await g(OLD, `/sim/sessions/${O.id}/world`), "wo");
const kf = Object.keys(wf).join(","), ko = Object.keys(wo).join(",");
console.log(`阳性对照① FIX keys=[${kf}] OLD keys=[${ko}]`);
if (!kf.includes("baseStateVarReport") || ko.includes("baseStateVarReport")) { console.log("❌ ① 不成立"); process.exit(2); }
console.log(`阳性对照② 对象数 FIX=${Object.keys(wf.state).length} OLD=${Object.keys(wo.state).length}`);

const oob = (st) => { let n = 0; for (const oid of Object.keys(st)) for (const sv of Object.keys(st[oid] ?? {})) { const d = DOM[sv], v = st[oid][sv];
  if (!d || typeof v !== "number") continue; if (v < d.min || (d.max !== null && v > d.max)) n++; } return n; };
// 世界态与播种基值是否逐位相同（判「入口之外还有没有第二个投影」）
let wbSame = 0, wbDiff = 0;
for (const oid of Object.keys(wf.state)) for (const sv of Object.keys(wf.state[oid] ?? {})) { const a = wf.state[oid][sv], b = F.base?.[oid]?.[sv];
  if (typeof a !== "number" || typeof b !== "number") continue; if (a === b) wbSame++; else wbDiff++; }
console.log(`FIX tick0：world === baseSnapshot 逐位 相同=${wbSame} 不同=${wbDiff}（须 不同<=账条目数）`);

const sat0 = wf.baseStateVarReport.saturations || [];
const nm0 = new Map(sat0.map((e) => [`${e.objectId}|${e.stateVar}`, e]));
let d0 = 0, un0 = 0, vm0 = 0, ex0 = 0;
for (const oid of Object.keys(wf.state)) for (const sv of Object.keys(wf.state[oid] ?? {})) {
  const a = wf.state[oid][sv], b = wo.state[oid]?.[sv];
  if (typeof a !== "number" || typeof b !== "number" || a === b) continue;
  d0++; const e = nm0.get(`${oid}|${sv}`);
  if (!e) { un0++; if (un0 <= 3) console.log(`   ⚠ 台账外: ${oid}.${sv} OLD=${b} FIX=${a}`); continue; }
  if (e.value !== a) vm0++; if (e.raw !== b) ex0++;
}
console.log(`A5 tick0（干净臂 4402）：差异格=${d0} · 台账外=${un0}（须0）· 台账 value≠world=${vm0}（须0）· 台账 raw≠OLD=${ex0}（须0）· 账条目=${sat0.length}（须≥1）`);
console.log(`A4 tick0 越界：FIX=${oob(wf.state)}（须0）· OLD=${oob(wo.state)}（须>0）`);

const EXO = [["obj_purchaseorder_po_0", "procurementDelay"], ["obj_supplier_SUP-015", "procurementDelay"], ["obj_purchaseorder_po_12", "procurementDelay"]];
const NON = [["obj_arinvoice_arinvoice_0_0", "overduePressure"], ["obj_arinvoice_arinvoice_0_1", "overduePressure"], ["obj_arinvoice_arinvoice_0_2", "overduePressure"]];
let fV = 0, fN = 0, oV = 0, oN = 0, fLam = 0, armExo = 0, armExoSame = 0, move = 0, moved = 0;
let prev = wf.state;
for (let t = 1; t <= TICKS; t++) {
  const ra = need(await g(FIX, `/sim/sessions/${F.id}/tick`, { method: "POST", body: '{"n":1}' }), `t${t}F`);
  const rb = need(await g(OLD, `/sim/sessions/${O.id}/tick`, { method: "POST", body: '{"n":1}' }), `t${t}O`);
  const wa = need(await g(FIX, `/sim/sessions/${F.id}/world`), `w${t}F`);
  const wb = need(await g(OLD, `/sim/sessions/${O.id}/world`), `w${t}O`);
  const sa = ra.stateVarReport?.saturations ?? [], sb = rb.stateVarReport?.saturations ?? [];
  for (const e of sa) { fN++; if (wa.state[e.objectId]?.[e.stateVar] !== e.value) fV++; }
  for (const e of sb) { oN++; if (wb.state[e.objectId]?.[e.stateVar] !== e.value) oV++; }
  for (const [o1, s1] of [...EXO, ...NON]) { const v = wa.state[o1]?.[s1], b = F.base?.[o1]?.[s1]; if (typeof v === "number" && Math.abs(v - LAM * b) < 1e-9) fLam++; }
  for (const [o1, s1] of EXO) { armExo++; if (wa.state[o1]?.[s1] === wb.state[o1]?.[s1]) armExoSame++; }
  let ch = 0; for (const oid of Object.keys(wa.state)) for (const sv of Object.keys(wa.state[oid] ?? {})) { const a = wa.state[oid][sv], p = prev[oid]?.[sv];
    if (typeof a === "number" && typeof p === "number" && a !== p) ch++; }
  prev = wa.state; move += ch; moved += ch;
  console.log(`t${t}: 变化格=${ch} 账FIX=${sa.length} 账OLD=${sb.length} 越界FIX=${oob(wa.state)} 越界OLD=${oob(wb.state)}`);
}
console.log(`阳性对照③ 累计变化格=${moved}（须>1000）`);
console.log(`E1-Y1(A2): FIX 点名=${fN} world≠回执.value=${fV}（须0）| OLD 点名=${oN} 违反=${oV}（须>0）`);
console.log(`E1-Y2(A3): 越界 FIX=${oob(prev)}（须0）· OLD=${oob((await g(OLD, `/sim/sessions/${O.id}/world`)).j.state)}（须>0）`);
console.log(`E2(A6) 对照臂 24 点位 world==λ·base 命中=${fLam}（须0）· 外生 12 点位两实例逐位相同=${armExoSame}/${armExo}`);
const neg = Object.keys(F.base).filter((o) => typeof F.base[o]?.shortageRisk === "number" && F.base[o].shortageRisk < 0);
console.log(`E3(A7) 负基值 shortageRisk 对象=${neg.length} 个：${neg.slice(0, 4).join(",")}`);
for (const o of neg.slice(0, 3)) console.log(`   ${o}: base=${F.base[o].shortageRisk} λ·base=${Math.round(LAM * F.base[o].shortageRisk * 1e12) / 1e12} FIX world(t${TICKS})=${prev[o]?.shortageRisk} 域=${JSON.stringify(DOM.shortageRisk && [DOM.shortageRisk.min, DOM.shortageRisk.max])}`);
const pass = un0 === 0 && vm0 === 0 && ex0 === 0 && sat0.length >= 1 && d0 > 0 && fV === 0 && oV > 0 && fLam === 0;
console.log(`\n判定: ${pass ? "✅ 干净臂对照成立" : "❌ 见上逐条"}`);
process.exit(pass ? 0 : 1);
