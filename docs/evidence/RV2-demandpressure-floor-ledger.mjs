/**
 * 评审员#2 · Order.demandPressure 的**同拍**铁证（只读，不 PATCH 规则）：
 *   本拍 saturations 记账里该格被**硬地板**夹（bound=min, value=0），
 *   同拍世界读数恰 = λ·base（λ=引擎自报 0.37）。
 *   ⇒ c 在夹值处被抹掉、合成只补 λ·base —— 一条链上同一拍的两个数，不需要跨会话推断。
 * 判据：命中数必须 > 0（否则本探针无鉴别力，不许读成「不成立」）；并用「未触地板」的单做正对照。
 * ⛔ 只读。
 */
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { } return { status: r.status, ok: r.ok, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const log = (...a) => console.log(...a);
const typeOf = new Map();
for (const [tk, ids] of Object.entries((await g("/sim/view-config")).json.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
if (typeOf.size === 0) { log("❌ 金丝雀坏：typeOf 空"); process.exit(2); }
const isOrder = (id) => typeOf.get(id) === "Order";
if ([...typeOf.values()].filter((t) => t === "Order").length === 0) { log("❌ 金丝雀坏：Order 0 个"); process.exit(2); }

const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
await post(`/sim/sessions/${s.id}/tick`, { n: 20 });
const t = await post(`/sim/sessions/${s.id}/tick`, { n: 1, disclose: true });
const rep = t.json?.stateVarReport;
const lam = rep?.decayApplied?.demandPressure;
log(`会话 ${s.id} · 引擎自报 λ(demandPressure) = ${lam}  ${typeof lam === "number" ? "✅" : "❌ 拿不到，结论作废"}`);
if (typeof lam !== "number") process.exit(2);
const sats = (rep?.saturations ?? []).filter((x) => x.stateVar === "demandPressure" && isOrder(x.objectId));
log(`本拍 demandPressure 饱和记账条目: ${sats.length}`);
const w = (await g(`/sim/sessions/${s.id}/world`)).json;

log(`\n=== 触硬地板档（bound=min, value=0）——同拍世界读数 vs λ·base ===`);
const hit = sats.filter((x) => x.bound === "min");
let ok = 0, bad = 0;
for (const x of hit) {
  const base = det.baseSnapshot?.[x.objectId]?.demandPressure;
  const v = w.state?.[x.objectId]?.demandPressure;
  const pred = lam * base;
  const good = Math.abs(v - pred) < 1e-6 * Math.max(1, Math.abs(pred));
  good ? ok++ : bad++;
  if (hit.indexOf(x) < 10) log(`  ${x.objectId} raw=${x.raw} 夹后=${x.value} 同拍读数=${v}  λ·base=${pred.toFixed(6)}  ${good ? "✅ 逐位闭合" : `❌ 差 ${(v - pred).toFixed(6)}`}`);
}
log(`  ⇒ 触地板档 ${hit.length} 个：闭合 ${ok}，不闭合 ${bad}   ${hit.length > 0 ? "" : "⚠ 本拍无触地板条目 ⇒ 本探针无鉴别力"}`);

log(`\n=== 正对照：本拍未触地板的 demandPressure 单（必须存在，否则探针是坏的）===`);
const freeIds = Object.keys(w.state ?? {}).filter((id) => isOrder(id) && !hit.some((x) => x.objectId === id)
  && typeof w.state[id]?.demandPressure === "number" && typeof det.baseSnapshot?.[id]?.demandPressure === "number");
const free = freeIds.map((id) => ({ id, v: w.state[id].demandPressure, base: det.baseSnapshot[id].demandPressure }))
  .filter((r) => Math.abs(r.v - lam * r.base) > 1e-6 * Math.max(1, Math.abs(r.v)));
log(`  未触地板且 ≠ λ·base 的单: ${free.length} 个  ${free.length > 0 ? "✅ 探针有鉴别力（不是全世界都等于 λ·base）" : "❌ 无鉴别力"}`);
for (const r of free.slice(0, 5)) log(`  ${r.id} 读数=${r.v} base=${r.base} 读数−λ·base=${(r.v - lam * r.base).toFixed(6)}（= c/λ 残留，c 敏感档）`);
log(`\n[eof]`);
