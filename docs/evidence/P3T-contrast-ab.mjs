// P3T · 独立对照实验（PRD §四 E1/E2/E3）—— 双实例**同刻** A/B
//   X  = 未修（4019，wo-edge-wire 部署树，/world 无 baseStateVarReport）
//   X' = 修复（4401，本分支 dist /tmp/wt-p3）
// 判据（**跑前声明**，见 PRD-WO-3ROOT-P3 §四；⛔ 不做「数变了」这种非判据）：
//   阳性对照 ⓪ STATE_VAR_DOMAINS≥38 ∧ valueRef(Material,shortageRisk) 有登记
//   阳性对照 ① 两实例可分（FIX /world 含 baseStateVarReport，OLD 不含）
//   阳性对照 ② 两实例世界对象数相等且 >4000
//   阳性对照 ③ 每拍世界态在动（变化格数 >1000）
//   E1-Y1(A2) 回执点名格 world===回执.value：X' 须 0 违反，X 须 >0（否则探针空转）
//   E1-Y2(A3) 声明域内格越界数：X' 须 0，X 须 >0
//   E1-Y4(A4) tick0 账非空（X' 须 ≥1；基线 0）
//   E2(A6)   world 恰等于 λ·base 的点位：X' 须 0
//   E3(A7)   obj_material_elyte.shortageRisk：X 恒 = λ·base，X' 须 ≠ 且 ∈ 域
//   A5(tick0 防静默) 两实例 tick0 世界逐格差分：每个变化格必须在 X' 台账里且 value 逐位等于新读数
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const OLD = process.env.OLDBASE || "http://127.0.0.1:4019/a/v1";
const FIX = process.env.FIXBASE || "http://127.0.0.1:4401/a/v1";
const DIST = process.env.DIST || "/tmp/wt-p3/apps/datacore/dist";
const LAM = 0.37, TICKS = Number(process.env.TICKS || 5);
const D = await import(DIST + "/synthetic/battery.js");
const DOMAINS = D.STATE_VAR_DOMAINS;
const g = async (B, p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ FATAL HTTP ${x.status} @${w} :: ${x.t.slice(0, 160)}`); process.exit(3); } return x.j; };
const mk = async (B, l) => { const s = need(await g(B, "/sim/sessions", { method: "POST", body: "{}" }), l);
  const det = need(await g(B, `/sim/sessions/${s.id}`), l + ":det"); return { B, id: s.id, base: det.baseSnapshot, l, create: s }; };

// ---- 阳性对照 ⓪ ----
const nDom = Object.keys(DOMAINS).length;
const refSR = D.stateVarValueRef ? D.stateVarValueRef("Material", "shortageRisk") : undefined;
console.log(`阳性对照⓪: STATE_VAR_DOMAINS=${nDom}（须≥38）· valueRef(Material,shortageRisk)=${refSR !== undefined}（须 true）`);
if (nDom < 38 || refSR === undefined) { console.log("❌ 阳性对照⓪ 不成立 ⇒ 探针读数作废"); process.exit(2); }

const F = await mk(FIX, "FIX"), O = await mk(OLD, "OLD");
const wf0 = need(await g(FIX, `/sim/sessions/${F.id}/world`), "wf0");
const wo0 = need(await g(OLD, `/sim/sessions/${O.id}/world`), "wo0");
const kf = Object.keys(wf0).join(","), ko = Object.keys(wo0).join(",");
console.log(`阳性对照①: FIX /world keys=[${kf}] · OLD=[${ko}]`);
if (!kf.includes("baseStateVarReport") || ko.includes("baseStateVarReport")) { console.log("❌ 阳性对照① 不成立：两实例分不开 ⇒ 差分无意义"); process.exit(2); }
const nf = Object.keys(wf0.state).length, no = Object.keys(wo0.state).length;
console.log(`阳性对照②: 世界对象数 FIX=${nf} OLD=${no}（须相等且>4000）`);
if (nf !== no || nf < 4000) { console.log("❌ 阳性对照② 不成立"); process.exit(2); }

const domOf = (sv) => DOMAINS[sv];
const oob = (st) => { let n = 0; for (const oid of Object.keys(st)) { const cell = st[oid]; if (!cell) continue;
  for (const sv of Object.keys(cell)) { const d = domOf(sv); if (!d) continue; const v = cell[sv];
    if (typeof v !== "number") continue; if (v < d.min || (d.max !== null && v > d.max)) n++; } } return n; };
const lamHits = (st, base) => { let n = 0; for (const oid of Object.keys(st)) { const cell = st[oid], b = base?.[oid]; if (!cell || !b) continue;
  for (const sv of Object.keys(cell)) { const v = cell[sv], bv = b[sv]; if (typeof v !== "number" || typeof bv !== "number") continue;
    if (Math.abs(v - LAM * bv) < 1e-9) n++; } } return n; };

// ---- A5 tick0（两实例唯一同源的一拍）----
const rep0 = wf0.baseStateVarReport;
const sat0 = (rep0 && (rep0.saturations || rep0.entries)) || [];
const named0 = new Map(sat0.map((e) => [`${e.objectId}|${e.stateVar}`, e]));
let diff0 = 0, unnamed0 = 0, valMis0 = 0;
for (const oid of Object.keys(wf0.state)) for (const sv of Object.keys(wf0.state[oid] ?? {})) {
  const a = wf0.state[oid][sv], b = wo0.state[oid]?.[sv];
  if (typeof a !== "number" || typeof b !== "number") continue;
  if (a === b) continue; diff0 += 1;
  const e = named0.get(`${oid}|${sv}`); if (!e) { unnamed0 += 1; if (unnamed0 <= 3) console.log(`   ⚠ 台账外变化: ${oid}.${sv} ${b} -> ${a}`); continue; }
  if (e.value !== a) valMis0 += 1;
}
console.log(`A4/A5 tick0: 账条目=${sat0.length}（须≥1，基线0）· 两实例 tick0 差分格=${diff0} · 台账外变化=${unnamed0}（须0）· 台账 value≠新读数=${valMis0}（须0）`);

// ---- 逐拍 A/B ----
const tgt = "obj_material_elyte";
let prevF = wf0.state, moved = 0;
let fixViol = 0, fixNamed = 0, oldViol = 0, oldNamed = 0;
let fixOOB = 0, oldOOB = 0, fixLam = 0;
const elyte = [];
for (let t = 1; t <= TICKS; t++) {
  const ra = need(await g(FIX, `/sim/sessions/${F.id}/tick`, { method: "POST", body: '{"n":1}' }), `F t${t}`);
  const rb = need(await g(OLD, `/sim/sessions/${O.id}/tick`, { method: "POST", body: '{"n":1}' }), `O t${t}`);
  const wa = need(await g(FIX, `/sim/sessions/${F.id}/world`), `Fw${t}`);
  const wb = need(await g(OLD, `/sim/sessions/${O.id}/world`), `Ow${t}`);
  const sats = (ra.stateVarReport && ra.stateVarReport.saturations) || [];
  const nm = new Map(sats.map((e) => [`${e.objectId}|${e.stateVar}`, e]));
  for (const e of sats) { fixNamed += 1; if (wa.state[e.objectId]?.[e.stateVar] !== e.value) fixViol += 1; }
  const satso = (rb.stateVarReport && rb.stateVarReport.saturations) || [];
  for (const e of satso) { oldNamed += 1; if (wb.state[e.objectId]?.[e.stateVar] !== e.value) oldViol += 1; }
  fixOOB += oob(wa.state); oldOOB += oob(wb.state); fixLam += lamHits(wa.state, F.base);
  let ch = 0; for (const oid of Object.keys(wa.state)) for (const sv of Object.keys(wa.state[oid] ?? {})) {
    const a = wa.state[oid][sv], p = prevF[oid]?.[sv]; if (typeof a === "number" && typeof p === "number" && a !== p) ch += 1; }
  prevF = wa.state; moved += ch;
  const b = F.base[tgt]?.shortageRisk, x = wa.state[tgt]?.shortageRisk, y = wb.state[tgt]?.shortageRisk;
  elyte.push({ t, lamB: Math.round(LAM * b * 1e12) / 1e12, fix: x, old: y, named: nm.has(`${tgt}|shortageRisk`) });
  console.log(`t${t}: 变化格=${ch} 账FIX=${sats.length} 账OLD=${satso.length} 越界FIX=${oob(wa.state)} 越界OLD=${oob(wb.state)} elyte FIX=${x} OLD=${y} λb=${Math.round(LAM * b * 1e12) / 1e12}`);
}
console.log(`\n阳性对照③: ${TICKS} 拍累计变化格=${moved}（须 >1000）`);
if (moved < 1000) { console.log("❌ 阳性对照③ 不成立：世界没动 ⇒ 读数作废"); process.exit(2); }
console.log(`E1-Y1(A2): FIX 点名 ${fixNamed} 点位 world≠回执.value = ${fixViol}（须 0）`);
console.log(`           OLD 点名 ${oldNamed} 点位 world≠回执.value = ${oldViol}（对照臂，须 >0）`);
console.log(`E1-Y2(A3): 越界格 FIX=${fixOOB}（须 0）· OLD=${oldOOB}（对照臂，须 >0）`);
console.log(`E2 (A6): world == λ·base 的点位 FIX=${fixLam}（须 0）`);
const okE3 = elyte.every((r) => r.fix !== r.lamB) && elyte.every((r) => r.fix >= 0 && r.fix <= 100);
const okE3old = elyte.every((r) => Math.abs(r.old - r.lamB) < 1e-6);
console.log(`E3 (A7): elyte.shortageRisk 全 ${TICKS} 拍 FIX≠λ·base 且 ∈[0,100] = ${okE3}（须 true，且逐拍未被点名）· 对照臂 OLD 恒 = λ·base = ${okE3old}（须 true）`);
for (const r of elyte) console.log(`   t${r.t} λb=${r.lamB} FIX=${r.fix} OLD=${r.old} FIX被点名=${r.named}`);
const pass = fixViol === 0 && oldViol > 0 && fixOOB === 0 && oldOOB > 0 && fixLam === 0 && okE3 && okE3old && unnamed0 === 0 && valMis0 === 0 && sat0.length >= 1;
console.log(`\n判定: ${pass ? "✅ 对照实验成立（X→X′ 后 Y 按预言变化：违反 0 / 对照臂仍红 / 对照臂不动）" : "❌ 判据未全部成立 —— 见上逐条"}`);
process.exit(pass ? 0 : 1);
