/**
 * 评审员#2 · 独立复核探针（不复用上游脚本，重新取数）
 *
 * 目的：独立判定待评根因「负边单向传导 + 硬地板 ⇒ 超载侧信息进不了 Order.demandPressure」
 *   ① 触点结构：demandPressure 的入边集合（数量/系数/符号）由**现场路由**重取，不从文档抄。
 *   ② 引擎自报 λ（stateVarReport.decayApplied），**不是**从数据反推的 min(x/base)。
 *   ③ 逐单闭合：x == λ·base 的单数与上穿基值的单数（上界判据）。
 *   ④ ★新★ 「净入流恒 ≤ 0」的前提独立核：全 corpus 的 Model.forecastBias 有没有负数？
 *      （若存在负数 ⇒ c>0 ⇒ 「超载侧不可达」的前提被推翻）
 *   ⑤ ★新★ 反向症状：C2 合成写在夹值**之后** ⇒ 合成值**不经夹值**。
 *      扫全世界：有没有格子越出 STATE_VAR_DOMAINS 声明的 [min,max]？这是同一条
 *      「顺序」事实的另一侧读数，上游未测。
 *   ⑥ 金丝雀：一条必然命中的边 + 一条必然不存在的边名（防「0 命中」被读成「不存在」）。
 *
 * ⛔ 只读：不 PATCH 任何规则、不推扰动、不重启服务。
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p, o = {}) => {
  const r = await fetch(B + p, { headers: H, ...o });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { _raw: t.slice(0, 200) }; }
  return { status: r.status, ok: r.ok, json: j };
};
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const log = (...a) => console.log(...a);

// ── 0) 金丝雀：必然命中 + 必然不命中 ─────────────────────────────────────────
const r0 = await g("/sim/propagation-rules");
if (!r0.ok) { log(`❌ 金丝雀坏：GET propagation-rules HTTP ${r0.status}`); process.exit(2); }
const rules = r0.json.items ?? r0.json;
const pos = rules.filter((r) => r.targetTypeKey === "Order" && r.targetStateVar === "demandPressure");
const neg = rules.filter((r) => r.targetStateVar === "___no_such_statevar___");
log(`金丝雀A（必然命中）: 目标入边 ${pos.length} 条 ${pos.length > 0 ? "✅" : "❌ 工具坏了"}`);
log(`金丝雀B（必然不命中）: 虚构量纲入边 ${neg.length} 条 ${neg.length === 0 ? "✅ 0 命中是可信的" : "❌ 取法有问题"}`);
if (pos.length === 0 || neg.length !== 0) process.exit(2);
for (const r of pos) log(`   入边 key=${r.key} src=${r.sourceTypeKey}.${r.sourceStateVar} coef=${r.coefficient} delay=${r.delayTicks} status=${r.status}`);
const srcEdges = rules.filter((r) => r.sourceTypeKey === "Model" && r.sourceStateVar === "forecastBias");
log(`   forecastBias 出边 ${srcEdges.length} 条: ${srcEdges.map((r) => `${r.key}→${r.targetTypeKey}.${r.targetStateVar}(${r.coefficient})`).join(" | ")}`);
const fbOut = new Map(); for (const r of rules) { const k = `${r.targetTypeKey}|${r.targetStateVar}`; }
// forecastBias 的入度（是否为外生根）
const fbIn = rules.filter((r) => r.targetTypeKey === "Model" && r.targetStateVar === "forecastBias");
log(`   forecastBias 入度 = ${fbIn.length}（0 = 外生根，衰减相豁免）`);

// ── 1) 建会话：tick0 + detail ────────────────────────────────────────────────
const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
const vc = (await g(`/sim/view-config`)).json;
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
const orderIds = [...typeOf.entries()].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
const modelIds = [...typeOf.entries()].filter(([, tk]) => tk === "Model").map(([i]) => i).sort();
log(`\n会话 ${s.id} · Order ${orderIds.length} 个 · Model ${modelIds.length} 个 · baseSnapshot ${Object.keys(det.baseSnapshot ?? {}).length} 对象`);

// ── 2) 推 30 拍，拿引擎自报 λ ────────────────────────────────────────────────
const tk = await post(`/sim/sessions/${s.id}/tick`, { n: 30, disclose: true });
const w = (await g(`/sim/sessions/${s.id}/world`)).json;
const rep = tk.json?.disclosure?.stateVarReport ?? tk.json?.stateVarReport ?? null;
const lamEng = rep?.decayApplied?.demandPressure;
log(`tick HTTP=${tk.status} tick=${w.tick} · 引擎自报 λ(demandPressure) = ${lamEng}  (report=${rep ? "有" : "无"})`);
if (typeof lamEng !== "number") { log("❌ 拿不到引擎自报 λ ⇒ 后面只用实测 min(x/base)，并标注"); }

// ── 3) 逐单闭合 ─────────────────────────────────────────────────────────────
const rows = orderIds.map((id) => ({ id, base: det.baseSnapshot?.[id]?.demandPressure, x: w.state?.[id]?.demandPressure }))
  .filter((r) => typeof r.base === "number" && typeof r.x === "number");
const ratios = rows.filter((r) => r.base > 1e-9).map((r) => r.x / r.base);
const lamData = Math.min(...ratios);
log(`\n③ 逐单：n=${rows.length}  λ_实测=min(x/base)=${lamData}`);
const lam = typeof lamEng === "number" ? lamEng : lamData;
const isLam = (r) => r.base > 1e-9 && Math.abs(r.x - lam * r.base) < 1e-6 * Math.max(1, Math.abs(r.x));
const hit = rows.filter(isLam), free = rows.filter((r) => !isLam(r));
log(`   x == λ·base（λ=${lam}）的单: ${hit.length}/${rows.length}   其余 ${free.length}`);
const over = rows.filter((r) => r.x > r.base + 0.01);
log(`   上穿基值 (+0.01) 的单: ${over.length}   ${over.length === 0 ? "✅ 上界=基值 成立（与上游一致）" : "❌ 上界被击穿 ⇒ 待评根因第 1 环被推翻"}`);
log(`   基值域 [${Math.min(...rows.map((r) => r.base))}, ${Math.max(...rows.map((r) => r.base))}]  终态域 [${Math.min(...rows.map((r) => r.x)).toFixed(6)}, ${Math.max(...rows.map((r) => r.x)).toFixed(6)}]`);
log(`   触地板指纹（前 6，按基值降序）：${hit.slice(0, 6).map((r) => `${r.id} ${r.base}→${r.x}`).join(" · ")}`);

// ── 4) ★ 前提独立核：forecastBias 有没有负数（若有 ⇒ c>0 ⇒ 前提被推翻）────────
const fb = modelIds.map((id) => ({ id, v: w.state?.[id]?.forecastBias, b: det.baseSnapshot?.[id]?.forecastBias }));
log(`\n④ 前提核（净入流恒 ≤ 0 依赖 forecastBias ≥ 0）：`);
log(`   Model.forecastBias tick30: ${fb.map((r) => `${r.id.slice(-12)}=${r.v}`).join(" · ")}`);
const fbNeg = fb.filter((r) => typeof r.v === "number" && r.v < 0).length;
const fbNeg0 = fb.filter((r) => typeof r.b === "number" && r.b < 0).length;
log(`   负值个数 tick0=${fbNeg0}/${fb.length} · tick30=${fbNeg}/${fb.length}  ${fbNeg === 0 && fbNeg0 === 0 ? "⇒ c = −0.222×fb ≤ 0 恒成立 ✅" : "❌ 存在负 bias ⇒ 该单 c>0"}`);
log(`   forecastBias 域声明 [−100,100]，实测域 [${Math.min(...fb.map((r) => r.v))}, ${Math.max(...fb.map((r) => r.v))}]`);

// ── 5) ★ 反向症状：合成值不经夹值 ⇒ 世界态越出声明域？────────────────────────
const dom = (await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js")).STATE_VAR_DOMAINS;
const bad = [];
for (const [objId, bucket] of Object.entries(w.state ?? {})) {
  for (const [sv, v] of Object.entries(bucket)) {
    if (typeof v !== "number") continue;
    const d = dom[sv]; if (!d) continue;
    if (v < d.min - 1e-9 || (d.max !== null && v > d.max + 1e-9)) bad.push({ objId, sv, v, min: d.min, max: d.max, at: typeOf.get(objId) });
  }
}
log(`\n⑤ 反向症状扫描（C2 合成在夹值之后 ⇒ 合成值不被夹）：越域格 ${bad.length} 个`);
for (const b of bad.slice(0, 25)) log(`   ${b.at}.${b.sv} = ${b.v}  域[${b.min},${b.max}]  (${b.objId})`);
// 分解：越域格是不是「归派生规格所有」的（C2 只碰这些）
let specOwned = 0;
try {
  const bat = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
  for (const b of bad) if (bat.stateVarValueRef(b.at, b.sv) !== undefined) specOwned++;
} catch (e) { log(`   (规格归属统计跳过: ${e.message})`); }
log(`   其中「归派生规格所有」（C2 作用域内）的格: ${specOwned}/${bad.length}`);

// ── 6) 饱和记账（若有）：raw 值里是否还留着 c ─────────────────────────────────
const sats = tk.json?.disclosure?.saturations ?? tk.json?.saturations ?? null;
if (Array.isArray(sats)) {
  const ds = sats.filter((x) => x.stateVar === "demandPressure");
  log(`\n⑥ saturations 记账里 demandPressure 的条目: ${ds.length}  ${ds.length > 0 ? "⇒ c 的痕迹在 raw 里保留（未全丢）" : "（本拍无）"}`);
  for (const d of ds.slice(0, 6)) log(`   ${d.objectId} raw=${d.raw} value=${d.value} bound=${d.bound}`);
} else log(`\n⑥ 回包未带 saturations（未披露该字段）`);
log(`\n[eof] 会话 ${s.id}`);
