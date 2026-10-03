// 评审员#3 · 独立探针 v2 —— 「域夹值被 C2 合成层丢弃」的**同跑内差分对照**。
//
// 与上游探针不同的地方：不是只看「基值越界」那一小撮格，而是把**每一拍回执里的每一条饱和事件**
// 按 C2 的守卫条件分成两组，逐条判预言：
//   · G-WRITE（C2 会覆写：规格格 ∧ ¬外生 ∧ 本拍衰减过）⇒ 预言 world ≡ 夹后值 + λ·(base − rest)
//   · G-SKIP （C2 必跳过：非规格 ∨ 外生 ∨ 本拍没衰减）⇒ 预言 world ≡ 夹后值（夹值应当存活）
// G-SKIP 是**差分对照臂**：同一个核、同一拍、同一次夹，唯一差别是 C2 写不写它。
// 若 G-SKIP 全部命中而 G-WRITE 全部落空 ⇒ 「夹值被丢弃」归因到 C2 的覆写，不是别的通道。
//
// 否证判据（跑前声明）：
//   F1 G-WRITE 里出现 world ≡ 夹后值（即夹值没被丢）⇒ 机制不成立
//   F2 G-SKIP 里出现 world ≠ 夹后值 ⇒ 丢弃与 C2 无关（另有通道）
//   F3 越界基值的格在 tick≥1 落回域内 ⇒ 有我没看见的夹值通道
//   F4 G-WRITE 里出现 world ≠ 夹后值 + λ·(base−rest) ⇒ 机制算式错
// 正向对照：世界态每拍在动；金丝雀：已知越界格 elyte.shortageRisk 必须被选中且 world 逐位 = λ·base。
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const RR = "/Users/apple/deploy/wo-edge-wire";
const D = await import(`${RR}/apps/datacore/dist/synthetic/battery.js`);
const C = await import(`${RR}/packages/contracts/dist/index.js`);
const DOM = D.STATE_VAR_DOMAINS, vref = D.stateVarValueRef;
const TICKS = 8, EPS = 0.5e-6;
console.log(`金丝雀0 ：DOMAINS=${Object.keys(DOM).length} 项 vref=${typeof vref} buildCellRoles=${typeof C.buildCellRoles}`);
if (typeof vref !== "function" || typeof C.buildCellRoles !== "function" || DOM.shortageRisk?.min !== 0) { console.log("❌ 工具坏了"); process.exit(2); }
const g = async (p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} ; return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}: ${String(x.t).slice(0, 200)}`); process.exit(3); } return x.j; };

// 规则集（与 tick 同一份：已发布 55 条）
const pr = need(await g("/sim/propagation-rules"), "GET propagation-rules");
const rules = pr.items ?? pr;
const cellRoles = C.buildCellRoles(rules.map((r) => ({ sourceTypeKey: r.sourceTypeKey, sourceStateVar: r.sourceStateVar, targetTypeKey: r.targetTypeKey, targetStateVar: r.targetStateVar })));
console.log(`金丝雀0b：规则 ${rules.length} 条；Material|shortageRisk 外生=${cellRoles.isExogenous("Material", "shortageRisk")}（须 false，否则 C2 会跳过它，本探针选错对象）`);
if (cellRoles.isExogenous("Material", "shortageRisk")) { console.log("❌ 选错对象：该格外生"); process.exit(2); }

const created = need(await g("/sim/sessions", { method: "POST", body: "{}" }), "POST sessions");
const sid = created.id;
const det = need(await g(`/sim/sessions/${sid}`), "GET session");
const w0 = need(await g(`/sim/sessions/${sid}/world`), "GET world t0");
const base = det.baseSnapshot;
const vc = need(await g("/sim/view-config"), "GET view-config");
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
console.log(`会话 ${sid} baseSnapshot=${Object.keys(base).length} 对象；类型映射 ${[...Object.keys(base)].filter((o) => typeOf.has(o)).length}`);

const LAM = 0.37;
let GW_n = 0, GW_hit = 0, GW_miss = [], GW_clampDiscarded = 0, GW_lambdaBase = 0;
let GS_n = 0, GS_hit = 0, GS_miss = [], GS_byReason = { nonSpec: 0, exo: 0, noDecay: 0 };
let F3 = [], movedTicks = 0, prev = w0.state;
let outOfDomBase = 0, outOfDomBaseSpec = 0, F1 = [];
const elyte = [];
for (let t = 1; t <= TICKS; t++) {
  const rt = need(await g(`/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `tick t${t}`);
  const w = need(await g(`/sim/sessions/${sid}/world`), `world t${t}`);
  const sat = rt.stateVarReport?.saturations ?? [];
  const dec = rt.stateVarReport?.decayApplied ?? {};
  let moved = 0;
  for (const oid of Object.keys(w.state)) { const a = prev[oid], b = w.state[oid]; if (!a || !b) continue; for (const k of Object.keys(b)) if (a[k] !== b[k]) moved += 1; }
  if (moved > 0) movedTicks += 1;
  console.log(`t${t} tick=${w.tick} saturations=${sat.length} 变化格=${moved}`);
  for (const e of sat) {
    const tk = typeOf.get(e.objectId); if (tk === undefined) continue;
    const dom = DOM[e.stateVar]; if (!dom) continue; // 无域声明 ⇒ 不该有饱和事件
    const b = base[e.objectId]?.[e.stateVar];
    const lam = dec[e.stateVar];
    const spec = vref(tk, e.stateVar) !== undefined;
    const exo = cellRoles.isExogenous(tk, e.stateVar);
    const x = w.state[e.objectId]?.[e.stateVar];
    if (typeof x !== "number" || typeof b !== "number") continue;
    const rest = dom.restPoint ?? 0;
    if (spec && !exo && lam !== undefined) {
      GW_n += 1;
      const pred = e.value + lam * (b - rest);
      if (Math.abs(x - pred) <= EPS) { GW_hit += 1; if (Math.abs(x - (e.value + LAM * b)) <= EPS) GW_lambdaBase += 1; }
      else GW_miss.push(`t${t} ${e.objectId}.${e.stateVar} base=${b} 夹后=${e.value} world=${x} 预言=${pred} raw=${e.raw} bound=${e.bound}`);
      if (Math.abs(x - e.value) > EPS) GW_clampDiscarded += 1;
    } else {
      GS_n += 1;
      if (!spec) GS_byReason.nonSpec += 1; else if (exo) GS_byReason.exo += 1; else GS_byReason.noDecay += 1;
      if (Math.abs(x - e.value) <= EPS) GS_hit += 1;
      else GS_miss.push(`t${t} ${e.objectId}.${e.stateVar} spec=${spec} exo=${exo} lam=${lam} 夹后=${e.value} world=${x}`);
    }
    const lo = dom.min ?? -Infinity, hi = dom.max === null || dom.max === undefined ? Infinity : dom.max;
    if (b < lo || b > hi) { outOfDomBase += 1; if (spec) outOfDomBaseSpec += 1; if (x >= lo && x <= hi) F1.push(`t${t} ${e.objectId}.${e.stateVar} base=${b} world=${x}`); }
    if (e.objectId === "obj_material_elyte" && e.stateVar === "shortageRisk") elyte.push({ t, raw: e.raw, value: e.value, world: x, b });
  }
  prev = w.state;
}
console.log(`\n=== 汇总（${TICKS} 拍；饱和事件按 C2 守卫分组）===`);
console.log(`正向对照：世界态在动的拍数 = ${movedTicks}/${TICKS}`);
console.log(`【G-WRITE·C2 覆写组】采样 ${GW_n}`);
console.log(`   命中 world ≡ 夹后值+λ·(base−rest) = ${GW_hit}；落空 = ${GW_miss.length}`);
console.log(`   其中命中 world ≡ 夹后值+λ·base（rest=0 的逐位形）= ${GW_lambdaBase}`);
console.log(`   「回执报夹到 X 而 world ≠ X」= ${GW_clampDiscarded}/${GW_n}`);
for (const l of GW_miss.slice(0, 5)) console.log(`   🔴 F4 ${l}`);
console.log(`【G-SKIP·C2 跳过组（差分对照臂）】采样 ${GS_n}（非规格 ${GS_byReason.nonSpec} / 外生 ${GS_byReason.exo} / 本拍未衰减 ${GS_byReason.noDecay}）`);
console.log(`   命中 world ≡ 夹后值 = ${GS_hit}；落空 = ${GS_miss.length}`);
for (const l of GS_miss.slice(0, 8)) console.log(`   🔴 F2 ${l}`);
console.log(`【F3】越界基值饱和采样 ${outOfDomBase}（其中规格 ${outOfDomBaseSpec}），tick≥1 落回域内 = ${F1.length}`);
for (const l of F1.slice(0, 5)) console.log(`   ⚠️ ${l}`);
console.log(`【金丝雀·elyte.shortageRisk 逐拍】base=${base["obj_material_elyte"]?.shortageRisk}`);
for (const r of elyte) console.log(`   t${r.t} 夹后=${r.value} world=${r.world} λ·base=${r.b * LAM}`);
const verdict = { GW_n, GW_hit, GW_miss: GW_miss.length, GW_clampDiscarded, GW_lambdaBase, GS_n, GS_hit, GS_miss: GS_miss.length, GS_byReason, F1: F1.length, outOfDomBase, outOfDomBaseSpec, movedTicks };
fs.writeFileSync("/tmp/wo-review3/rv3b-diff.json", JSON.stringify(verdict, null, 1));
console.log(`\n判定：F1(+F3) ${F1.length === 0 ? "0 命中" : "🔴 命中"} / F2 ${GS_miss.length === 0 ? "0 命中（对照臂成立）" : "🔴 命中"} / F4 ${GW_miss.length === 0 ? "0 命中" : "🔴 命中"}`);
