// R1 独立探针（评审员#1）：证伪/界定 P3 待评根因的作用域。
// 只读 + 建会话/推 tick，不改产品代码、不写库。
// 三个问题：
//  Q1 待评机制复核：核饱和拍 world == 夹后值 + λ·(base−rest)？（不成立即机制错）
//  Q2 回执回包矛盾：回执说「夹到 X」而同一拍世界态 ≠ X 的点位数
//  Q3 【上次没测的】越界是否只由「base 越界」引起？——把越界世界态按「base 在域内/域外」拆开，
//     并对「base 在域内却越界」的格算 kernelOut = world − λ·(base−rest)：
//     若 kernelOut 仍在域内且该拍回执没点名 ⇒ 越界是合成层造出来的、且全仓无人记账
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const DOMAINS = D.STATE_VAR_DOMAINS, valueRef = D.stateVarValueRef;
const LAM = 0.37, TICKS = 5;

// ── 金丝雀（先自证量法没坏）────────────────────────────────────────────────
console.log(`金丝雀A：STATE_VAR_DOMAINS=${DOMAINS ? Object.keys(DOMAINS).length : "UNDEF"} 项（须 ≥38）`);
if (!DOMAINS || typeof valueRef !== "function" || Object.keys(DOMAINS).length < 38) { console.log("❌ 工具坏了：域表/valueRef 取不到"); process.exit(2); }
console.log(`金丝雀B：shortageRisk 域=${JSON.stringify(DOMAINS.shortageRisk)}（须 min=0 才可判越界）`);
if (DOMAINS.shortageRisk?.min !== 0) { console.log("❌ 工具坏了"); process.exit(2); }

const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, j, t }; };
const need = (x, what) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${what}: ${String(x.t).slice(0, 150)}`); process.exit(3); } return x.j; };

// ── 建会话 + 回读（「没抛异常」≠「调用成功」）──────────────────────────────
const created = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "POST /sim/sessions");
const sid = created.id;
const det = need(await g(`/sim/sessions/${sid}`), "GET session");
if (det.id !== sid) { console.log("❌ 回读 id 不一致"); process.exit(3); }
const base = det.baseSnapshot;
console.log(`会话 ${sid} · baseSnapshot 对象=${Object.keys(base).length}`);

const vc = need(await g("/sim/view-config"), "GET view-config");
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
const w0 = need(await g(`/sim/sessions/${sid}/world`), "GET world t0");
console.log(`金丝雀C：类型映射覆盖 ${Object.keys(base).filter((o) => typeOf.has(o)).length}/${Object.keys(base).length} · tick0=${w0.tick}`);

const domOf = (sv) => { const d = DOMAINS[sv]; if (!d) return null; return { lo: d.min ?? -Infinity, hi: d.max === null || d.max === undefined ? Infinity : d.max, rest: d.restPoint ?? 0 }; };
const inDom = (v, d) => v >= d.lo && v <= d.hi;
const r12 = (x) => Math.round(x * 1e12) / 1e12;

// ── 逐格扫描器：按「base 在域内/域外 × world 在域内/域外」分类 ────────────────
function scan(state) {
  const cells = []; // {oid, tk, sv, b, x, dom, spec, baseOut, worldOut}
  for (const oid of Object.keys(state)) {
    const tk = typeOf.get(oid); if (!tk) continue;
    const bRow = base[oid] ?? {}, xRow = state[oid] ?? {};
    for (const sv of Object.keys(xRow)) {
      const d = domOf(sv); if (!d) continue;
      const b = bRow[sv], x = xRow[sv];
      if (typeof b !== "number" || typeof x !== "number") continue;
      cells.push({ oid, tk, sv, b, x, d, spec: valueRef(tk, sv) !== undefined, baseOut: !inDom(b, d), worldOut: !inDom(x, d) });
    }
  }
  return cells;
}

const t0cells = scan(w0.state);
const t0out = t0cells.filter((c) => c.worldOut);
console.log(`\n[tick0] 世界态越域格 = ${t0out.length}（base 越域 ${t0out.filter((c) => c.baseOut).length} / base 域内 ${t0out.filter((c) => !c.baseOut).length}）`);

const rows = [];
let satSpecPts = 0, offMiss = [], satEqWorld = 0, satNeqWorld = 0;
let createdUndisclosed = [], createdDisclosed = 0, kernelOutOut = 0;
const perTick = [];
for (let t = 1; t <= TICKS; t++) {
  const rt = need(await g(`/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `tick t${t}`);
  const w = need(await g(`/sim/sessions/${sid}/world`), `world t${t}`);
  const sat = rt.stateVarReport?.saturations ?? [], dec = rt.stateVarReport?.decayApplied ?? {};
  const satIdx = new Map(sat.map((e) => [`${e.objectId}|${e.stateVar}`, e]));
  const cells = scan(w.state);
  const out = cells.filter((c) => c.worldOut);
  const outInBase = out.filter((c) => !c.baseOut), outOutBase = out.filter((c) => c.baseOut);
  let created = 0, createdNoSat = 0, createdKernelInDom = 0;
  for (const c of outInBase) {
    const lam = dec[c.sv];
    if (lam === undefined || !c.spec) continue; // 只看 C2 作用域内（本拍衰减过 ∧ 归规格所有）
    const kernelOut = r12(c.x - lam * (c.b - c.d.rest)); // C2 的逆运算 = 核输出
    const s = satIdx.get(`${c.oid}|${c.sv}`);
    if (inDom(kernelOut, c.d)) {
      createdKernelInDom += 1;
      if (!s) { createdNoSat += 1; if (createdUndisclosed.length < 8) createdUndisclosed.push({ t, oid: c.oid, sv: c.sv, b: c.b, x: c.x, kernelOut, dom: [c.d.lo, c.d.hi] }); }
      else createdDisclosed += 1;
    } else kernelOutOut += 1;
  }
  // Q1/Q2：本拍每一条回执（只看 C2 作用域内的格）
  let satSpec = 0, eqW = 0;
  for (const e of sat) {
    const c = cells.find((x) => x.oid === e.objectId && x.sv === e.stateVar);
    if (!c || !c.spec) continue;
    const lam = dec[e.stateVar]; if (lam === undefined) continue;
    satSpec += 1; satSpecPts += 1;
    const pred = r12(e.value + lam * (c.b - c.d.rest));
    if (Math.abs(c.x - pred) > 1e-6) { if (offMiss.length < 8) offMiss.push({ t, ...c, e, pred }); }
    if (Math.abs(c.x - e.value) < 1e-9) { satEqWorld += 1; eqW += 1; } else satNeqWorld += 1;
  }
  perTick.push({ t, out: out.length, outInBase: outInBase.length, outOutBase: outOutBase.length, sat: sat.length, satSpec, satEqWorld: eqW, createdKernelInDom, createdNoSat });
  console.log(`[t${t}] 越域格=${out.length}（base域内 ${outInBase.length} / base域外 ${outOutBase.length}）· 回执 ${sat.length}（规格格 ${satSpec}）· 回执值==世界态 ${eqW}/${satSpec} · C2造的越域(kernelOut在域内) ${createdKernelInDom}（其中回执没点名 ${createdNoSat}）`);
  for (const c of cells) rows.push({ t, oid: c.oid, sv: c.sv, b: c.b, x: c.x, spec: c.spec, baseOut: c.baseOut, worldOut: c.worldOut, sat: satIdx.has(`${c.oid}|${c.sv}`) });
}

// ── 负基值规格格逐条轨迹（待评根因的头条场景）──────────────────────────────
const negKeys = new Map();
for (const p of t0cells) if (p.spec && p.b < p.d.lo) negKeys.set(`${p.oid}|${p.sv}`, p);
console.log(`\n=== 负基值规格格（${negKeys.size} 个对象·量）逐拍：x=世界态, λb=λ·base, sat=回执是否点名 ===`);
let negIdx = 0;
for (const [k, p0] of negKeys) {
  if (negIdx++ >= 6) break;
  const tr = rows.filter((r) => `${r.oid}|${r.sv}` === k).map((r) => (Math.abs(r.x - r12(LAM * p0.b)) < 1e-9 ? "λb" : r.x.toFixed(6)) + (r.sat ? "*" : ""));
  console.log(`  ${k} base=${p0.b} λ·base=${r12(LAM * p0.b)} | ${tr.join(" , ")}   (*=本拍回执点名)`);
}

console.log(`\n=== 汇总（${TICKS} 拍）===`);
console.log(`Q1 机制复核：饱和拍 world ≠ 夹后值+λ·(base−rest) 的点位 = ${offMiss.length}（分母 ${satSpecPts}）`);
for (const m of offMiss) console.log(`   🔴 t${m.t} ${m.oid}.${m.sv} base=${m.b} world=${m.x} 回执=${JSON.stringify(m.e)} 预测=${m.pred}`);
console.log(`Q2 回执↔世界态：回执值 == 世界态 ${satEqWorld} / 回执值 ≠ 世界态 ${satNeqWorld}（分母 ${satSpecPts}）`);
console.log(`Q3 越域全量：tick0 = ${t0out.length}（base域内 ${t0out.filter((c) => !c.baseOut).length}）`);
for (const p of perTick) console.log(`   t${p.t} 越域 ${p.out}（base域内 ${p.outInBase} / base域外 ${p.outOutBase}）`);
console.log(`Q3 细分：C2 造的越域（base 域内 ∧ C2 作用域 ∧ kernelOut 仍在域内）= ${perTick.reduce((a, b) => a + b.createdKernelInDom, 0)}`);
console.log(`        其中本拍回执【没点名】= ${perTick.reduce((a, b) => a + b.createdNoSat, 0)} · 回执点名了 = ${createdDisclosed} · kernelOut 也在域外 = ${kernelOutOut}`);
for (const c of createdUndisclosed) console.log(`   ⚠️ t${c.t} ${c.oid}.${c.sv} base=${c.b}(域内) world=${c.x} 域=[${c.dom[0]},${c.dom[1]}] kernelOut=${c.kernelOut}(域内) 回执无此格`);
fs.writeFileSync("/tmp/wo-3root/R1-rows.json", JSON.stringify({ sid, ticks: TICKS, perTick, negKeys: [...negKeys.keys()] }));
console.log(`\n判定：Q1 ${offMiss.length === 0 ? "未推翻" : "❌推翻"} · Q2 矛盾 ${satNeqWorld}/${satSpecPts} · Q3 C2造越域 ${perTick.reduce((a, b) => a + b.createdKernelInDom, 0)} 且全无回执记账`);
