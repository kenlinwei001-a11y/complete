// P3 播种基值自身为负 —— 独立验证探针（第二组）
// 只读 + 建会话/推 tick；不写库、不改产品代码。
// 判据：① 核饱和拍 world ≠ λ·base ？ ② 核未饱和拍 world ≠ 核输出+λ·base ？ ③ base 越界格 tick≥1 复合落回域内 ？
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const DOMAINS = D.STATE_VAR_DOMAINS, valueRef = D.stateVarValueRef;
const LAM = 0.37, TICKS = 8, EPS = 1e-9;

// ── 金丝雀 A2：域表与 valueRef 取到了（否则量法全废）
console.log(`金丝雀A2：STATE_VAR_DOMAINS=${DOMAINS ? Object.keys(DOMAINS).length : "UNDEF"} 项, valueRef=${typeof valueRef}`);
if (!DOMAINS || typeof valueRef !== "function") { console.log("❌ 工具坏了：域表/valueRef 没取到"); process.exit(2); }
console.log(`  金丝雀A2b：shortageRisk 域=${JSON.stringify(DOMAINS.shortageRisk)}（须 min=0 才可判越界）`);
if (DOMAINS.shortageRisk?.min !== 0) { console.log("❌ 工具坏了：shortageRisk 域不含下界 0"); process.exit(2); }

const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, j, t }; };
const need = (x, what) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${what}: ${String(x.t).slice(0, 150)}`); process.exit(3); } return x.j; };

// ── 建会话 + 回读资源（「没抛异常」≠「调用成功」：查状态码 + 回读）
const created = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "POST /sim/sessions");
const sid = created.id;
const det = need(await g(`/sim/sessions/${sid}`), "GET session");
const w0 = need(await g(`/sim/sessions/${sid}/world`), "GET world t0");
console.log(`会话 ${sid} 创建 HTTP=200 ok; 回读 id=${det.id === sid ? "一致" : "❌不一致"} curTick=${det.curTick ?? "?"} baseSnapshot 对象=${Object.keys(det.baseSnapshot).length}`);
if (det.id !== sid) process.exit(3);
const base = det.baseSnapshot, typeOf = new Map();
const vc = need(await g("/sim/view-config"), "GET view-config");
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
// 服务的自陈（独立于 dist 导入）：stateVarValueRefs —— 用于与 dist 的 valueRef 交叉核对
const apiRef = vc.stateVarValueRefs ?? {};
let refDisagree = 0, refN = 0;
for (const [o, tk] of typeOf) for (const sv of Object.keys(base[o] ?? {})) {
  refN += 1;
  const apiHas = apiRef[tk] ? (Array.isArray(apiRef[tk]) ? apiRef[tk].includes(sv) : (sv in apiRef[tk])) : undefined;
  if (apiHas !== undefined && apiHas !== (valueRef(tk, sv) !== undefined)) refDisagree += 1;
}
console.log(`金丝雀A3：API 自陈 stateVarValueRefs 与 dist valueRef 交叉核对 ${refN} 格，不一致 ${refDisagree}`);
const objN = Object.keys(base).length, mapped = Object.keys(base).filter((o) => typeOf.has(o)).length;
console.log(`金丝雀A1：对象→类型映射覆盖 ${mapped}/${objN}（须 >50%）`);
if (!(mapped > objN * 0.5)) { console.log("❌ 工具坏了：类型映射没建起来"); process.exit(2); }

// ── 目标层：base 越出域的 (对象·量) 对
const pairs = []; // {oid, tk, sv, b, dom, spec}
for (const oid of Object.keys(base)) {
  const tk = typeOf.get(oid); if (!tk) continue;
  for (const [sv, b] of Object.entries(base[oid] ?? {})) {
    const dom = DOMAINS[sv]; if (!dom || typeof b !== "number") continue;
    const lo = dom.min ?? -Infinity, hi = dom.max ?? Infinity;
    if (b < lo || b > hi) pairs.push({ oid, tk, sv, b, dom, spec: valueRef(tk, sv) !== undefined });
  }
}
const specPairs = pairs.filter((p) => p.spec), nonSpec = pairs.filter((p) => !p.spec);
console.log(`越界 base 的 (对象·量) 对 = ${pairs.length}（规格 ${specPairs.length} / 非规格 ${nonSpec.length}）`);

// ── 逐拍推进（n=1，逐拍取回执与世界态）
const rows = []; let satPts=0, unsatDecayPts=0, receiptContradict=0, receiptSamples=[]; let http = [], tickMoved = 0, clampBackSpec = [], clampBackNonSpec = [], satMismatch = [], corePlusLambdaMiss = [], constPinned = [];
let prevState = w0.state;
const key = (p) => `${p.oid}|${p.sv}`;
const tgtIdx = new Map(pairs.map((p) => [key(p), p]).concat(specPairs.map((p) => [key(p), p])));
for (let t = 1; t <= TICKS; t++) {
  const rt = need(await g(`/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `tick t${t}`);
  http.push(rt?.stateVarReport ? 200 : 200);
  const w = need(await g(`/sim/sessions/${sid}/world`), `world t${t}`);
  const sat = rt.stateVarReport?.saturations ?? [];
  const dec = rt.stateVarReport?.decayApplied ?? {};
  // 正向对照：世界态本拍真的在动吗（同一批对象里有多少格变了）
  let moved = 0;
  for (const oid of Object.keys(w.state)) { const a = prevState[oid], b = w.state[oid]; if (!a || !b) continue;
    for (const k of Object.keys(b)) if (a[k] !== b[k]) moved += 1; }
  if (moved > 0) tickMoved += 1;
  console.log(`t${t} HTTP=200 tick=${w.tick} saturations=${sat.length} 本拍变化格数=${moved}(须>0=正向对照)`);
  for (const p of pairs) {
    const x = w.state[p.oid]?.[p.sv];
    const s = sat.find((e) => e.objectId === p.oid && e.stateVar === p.sv);
    const lam = dec[p.sv];
    const rec = { t, ...p, x, sat: s ? { raw: s.raw, value: s.value, bound: s.bound } : null, lam };
    rows.push(rec);
    const xPrev = prevState[p.oid]?.[p.sv];
    // ① 核饱和拍（本拍回执点名该格）⇒ world 须 = λ·base（rest=0）
    if (s) {
      satPts += 1;
      if (Math.abs(x - s.value) > 1e-6) { receiptContradict += 1; if (receiptSamples.length < 6) receiptSamples.push(`t${t} ${p.oid}.${p.sv} base=${p.b} 回执「夹 ${s.raw.toFixed(4)} → ${s.value} bound=${s.bound}」世界态读 ${x}`); }
      const rest = p.dom.restPoint ?? 0;
      const pred = s.value + LAM * (p.b - rest);
      if (Math.abs(x - pred) > 1e-6) satMismatch.push(rec);
      else if (p.b < (p.dom.min ?? -Infinity) && Math.abs(x - LAM * (p.b - rest)) < 1e-6) { /* 命中机制 */ }
      // ③ 夹回域内？
      const lo = p.dom.min ?? -Infinity, hi = p.dom.max ?? Infinity;
      if (x >= lo && x <= hi) (p.spec ? clampBackSpec : clampBackNonSpec).push(rec);
    } else if (lam !== undefined) {
      unsatDecayPts += 1;
      // ② 核未饱和且本拍衰减过 ⇒ world 须 = cur + λ·(base−rest)，cur = 核输出（不可直读）
      //    可测的推论：world − λ·(base−rest) 必须落回「核输出」应有的量级：对压力族(rest=0)须 ≥0 或至少不动点外的漂移
      const off = x - LAM * (p.b - (p.dom.restPoint ?? 0));
      rec.off = off;
      if (p.b < (p.dom.min ?? -Infinity) && off < -1e-9) corePlusLambdaMiss.push({ ...rec, why: "world−λ·base < 0 ⇒ 核输出为负 ⇒ 核未夹住（② 命中）" });
    }
  }
  prevState = w.state;
}
// ── 汇总
const negSpec = specPairs.filter((p) => p.b < 0);
console.log(`\n=== 汇总（${TICKS} 拍 × ${pairs.length} 越界对 = ${rows.length} 采样点）===`);
console.log(`正向对照：世界态发生变化的拍数 = ${tickMoved}/${TICKS}（须 ≥1，否则读数可能被缓存/冻结）`);
console.log(`① 饱和拍（分母 ${satPts}）world ≠ 夹后值+λ·base 的点位 = ${satMismatch.length}`);
console.log(`   回执↔世界态直判：回执报「夹到 X」而世界态 ≠ X 的点位 = ${receiptContradict}/${satPts}`);
for (const l of receiptSamples) console.log(`   🔴 ${l}`);
for (const r of satMismatch.slice(0, 4)) console.log(`   🔴 t${r.t} ${r.oid}.${r.sv} base=${r.b} world=${r.x} 回执=${JSON.stringify(r.sat)}`);
console.log(`③ 规格格 base 越界但 tick≥1 落回域内的点位 = ${clampBackSpec.length}（非规格 = ${clampBackNonSpec.length}）`);
for (const r of clampBackSpec.slice(0, 6)) console.log(`   ⚠️ t${r.t} ${r.oid}.${r.sv} base=${r.b} world=${r.x} 域=[${r.dom.min},${r.dom.max}]`);
console.log(`② 未饱和衰减拍（分母 ${unsatDecayPts}）world−λ·base < 0 的点位 = ${corePlusLambdaMiss.length}`);
// 机制直测：负基值规格格、核连饱和时 world 是否恒 λ·base
console.log(`\n=== 机制逐对象（负基值规格格）===`);
const byPair = new Map();
for (const r of rows) { const k = `${r.oid}.${r.sv}`; if (!byPair.has(k)) byPair.set(k, []); byPair.get(k).push(r); }
for (const [k, rs] of byPair) {
  const p = rs[0]; if (!(p.b < 0) || !p.spec) continue;
  const lamB = Math.round(LAM * p.b * 1e12) / 1e12;
  const allEq = rs.every((r) => Math.abs(r.x - lamB) < 1e-9);
  const satCount = rs.filter((r) => r.sat).length;
  const raws = rs.map((r) => r.sat ? r.sat.raw.toFixed(3) : "-").join(",");
  const line = `  ${k} base=${p.b} λ·base=${lamB} | world=${rs.map((r) => (Math.abs(r.x - lamB) < 1e-9 ? "λb" : r.x.toFixed(6))).join(",")} | 回执点名 ${satCount}/${rs.length}\n      回执raw序列=[${raws}]`;
  console.log(line);
}
fs.writeFileSync("/tmp/wo-3root/p3v-rows.json", JSON.stringify({ sid, ticks: TICKS, rows: rows.slice(0, 600) }));
console.log(`\n判定：① ${satMismatch.length === 0 ? "机制未推翻" : "❌推翻"} / ③ 夹回 ${clampBackSpec.length} 点 ${clampBackSpec.length === 0 ? "未见漏看通道" : "❌推翻「夹值被丢弃」"} / ② ${corePlusLambdaMiss.length} 点`);
if (tickMoved === 0) { console.log("❌ 工具坏了：正向对照失败，世界态一次都没动"); process.exit(2); }
