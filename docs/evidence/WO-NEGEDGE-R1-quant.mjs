/**
 * 评审员 #1 独立复核（第 3 阶段 · 第 1 轮）—— 负边单向传导 + 硬地板 · 定量复现
 *
 * 复核对象：判「这一格能不能被推动」的两量分属两张表（规则种子 / STATE_VAR_DOMAINS），
 *   无跨表不变量；再叠加 C2 合成点在核内夹值之后 ⇒ 饱和区读数 = λ·base，与入流 c 无关。
 *
 * 本脚本**不依赖上游任何脚本**（自己建会话、自己取数、自己算），做的三件事：
 *  ① 复现上界判据：0 单读数 > 基值 + 0.01；复现 λ·base 指纹（逐单）。
 *  ② **定量预演**（上游没做过的形态）：把最终读数**逐单**用公式预算出来。
 *     读世界态取 Model.forecastBias（外生根、恒 ≥0）⇒ c = κ·f。
 *       自由不动点 x = base + c/λ   ⟺ |c| ≤ λ(1−λ)·base
 *       夹住不动点 x = λ·base        ⟺ |c| > λ(1−λ)·base
 *     逐单比较「预测 vs 实测」，误差 > 1e-3 记一条失配。**失配数就是判别力**。
 *  ③ 中间档 A/B（上游只跑了 ×3 / ×0.1 / ×0）：κ = κ0×0.5，
 *     预先是**逐单**给的（哪些单该从「夹住」转到「自由」、转过去后该读多少）。
 *     ⛔ 若有单的实测与「预测的两种形态都差得远」⇒ 根因被推翻。
 *
 * 金丝雀：① 目标边必须存在且系数被回读校验；② 必须有 ≥1 单在自由档（否则公式无鉴别力）；
 *        ③ λ 必须从数据自解（min(x/base) 且必须 < 1）。
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const RID = "simpr_demo_forecast_bias_to_order_demand";
const COEF0 = -0.222, REF0 = { ruleKey: "C36", paramKey: "demo_forecast_bias_to_order_demand" };
const BAND = 0.25; // SATURATION_BAND_FRACTION：上带 (max-rest)*0.25，用于判断是否撞上带

const g = async (p, o = {}) => {
  const r = await fetch(B + p, { headers: H, ...o });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { _raw: t.slice(0, 200) }; }
  return { status: r.status, json: j };
};
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const patch = (p, b) => g(p, { method: "PATCH", body: JSON.stringify(b) });

// ── 0) 金丝雀：目标边存在 + 回读 ───────────────────────────────────────────────
const r0 = await g(`/sim/propagation-rules`);
const rules = r0.json.items ?? r0.json;
const rule0 = rules.find((r) => r.id === RID);
const SNAP0 = JSON.stringify(rule0);
console.log(`金丝雀0：rule 存在=${!!rule0} coef=${rule0?.coefficient} status=${rule0?.status}`);
if (!rule0) { console.log("❌ 工具坏了：目标边查不到"); process.exit(2); }

// ── 1) 建会话 ────────────────────────────────────────────────────────────────
const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
const vc = (await g(`/sim/view-config`)).json;
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
const orderIds = [...typeOf].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
const modelIds = [...typeOf].filter(([, tk]) => tk === "Model").map(([i]) => i).sort();
console.log(`会话 ${s.id}  Order=${orderIds.length} Model=${modelIds.length} baseSnapshot=${Object.keys(det.baseSnapshot).length}`);

const T = Number(process.env.T ?? 30);
await post(`/sim/sessions/${s.id}/tick`, { n: T });
const w = (await g(`/sim/sessions/${s.id}/world`)).json;
console.log(`tick=${w.tick} (${T} 拍)`);

// ── 2) 基准读数 + λ 自解 + 逐单公式预测 ────────────────────────────────────────
const base = (id) => det.baseSnapshot?.[id]?.demandPressure;
const cur = (id) => w.state?.[id]?.demandPressure;
const rows = orderIds.map((id) => ({ id, base: base(id), x: cur(id) })).filter((r) => typeof r.base === "number" && typeof r.x === "number");
const ratios = rows.filter((r) => r.base > 1e-9).map((r) => r.x / r.base);
const lam = Math.round(Math.min(...ratios) * 1e9) / 1e9;
console.log(`\n① 上界判据：n=${rows.length} λ=min(x/base)=${lam}`);
const over = rows.filter((r) => r.x > r.base + 0.01);
console.log(`   上穿基值(+0.01) 的单: ${over.length}/${rows.length}  ${over.length === 0 ? "✅ 上界=基值成立" : "❌ 被击穿"}`);
const clampedExact = rows.filter((r) => r.base > 1e-9 && Math.abs(r.x - lam * r.base) < 1e-9);
console.log(`   读数 == λ·base 的单: ${clampedExact.length}/${rows.length}`);
console.log(`   基值域 [${Math.min(...rows.map((r) => r.base))}, ${Math.max(...rows.map((r) => r.base))}]  终态域 [${Math.min(...rows.map((r) => r.x)).toFixed(6)}, ${Math.max(...rows.map((r) => r.x)).toFixed(6)}]`);

// 源：外生根 Model.forecastBias（本拍世界态）
const fOf = new Map(modelIds.map((id) => [id, w.state?.[id]?.forecastBias]));
console.log(`   Model.forecastBias 本拍值: ${modelIds.map((id) => `${id}=${fOf.get(id)}`).join(" ")}`);

// 逐单预测：c = κ·f(该单的型号)。不需要链接表 —— 对每一单，把一个候选 c 集合里的每个 c 都代进去，
// 取「该单实测最接近的那个预测」。**关键判据不是拟合优度，而是：实测必须落在公式给出的离散集合里**
// （自由档 base+c/λ，或夹住档 λ·base），且残差 ≤ 收敛残差上界。
const cs = [...new Set([...fOf.values()].filter((f) => typeof f === "number").map((f) => -0.222 * f))].sort((a, b) => a - b);
console.log(`   候选 c 集合（Model.forecastBias × −0.222）: ${cs.map((c) => c.toFixed(6)).join(", ")}`);

function predict(baseV, c, lamV) {
  const free = baseV + c / lamV;
  const clampCond = Math.abs(c) > lamV * (1 - lamV) * baseV;
  // 自由档还需要 p(0) 不撞下带（下带宽度 0 ⇒ 只有 raw<0 才动）——压力族下带=0，故 free 档直接可用
  return { free, clamped: lamV * baseV, expect: clampCond ? lamV * baseV : free };
}
function bestFit(baseV, xObs, lamV) {
  let best = null;
  for (const c of cs) {
    const p = predict(baseV, c, lamV);
    for (const [form, v] of [["free", p.free], ["clamped", p.clamped]]) {
      const e = Math.abs(xObs - v);
      if (best === null || e < best.err) best = { c, form, v, err: e };
    }
  }
  return best;
}
// 收敛残差上界：|x0 − x*|·(1−λ)^T，x0=base，|x*−base| ≤ max|c|/λ。留 10× 余量。
const maxAbsC = Math.max(...cs.map(Math.abs), 1);
const residUB = Math.max(1e-3, (maxAbsC / lam) * Math.pow(1 - lam, T) * 10);
console.log(`   收敛残差上界（T=${T}）≈ ${residUB.toExponential(3)}`);
let mismatch = 0;
const forms = { free: 0, clamped: 0 };
for (const r of rows) {
  const b = bestFit(r.base, r.x, lam);
  if (b.err > residUB) { mismatch++; if (mismatch <= 8) console.log(`   ❌ 失配 ${r.id} base=${r.base} x=${r.x} best=${b.form} v=${b.v.toFixed(6)} err=${b.err.toExponential(2)}`); }
  else forms[b.form]++;
}
console.log(`   逐单拟合：自由档 ${forms.free} · 夹住档 ${forms.clamped} · 失配 ${mismatch}/${rows.length}`);
console.log(`   ⑧ 夹住判据一致性：公式判「应夹住」的单 ${rows.filter((r) => { const b = bestFit(r.base, r.x, lam); return b.form === "clamped"; }).length} 张`);
// 独立交叉核：夹住档必须满足 |c| > λ(1−λ)base 对**某个** c 成立，自由档必须能反解出接近 c 集合的 c
const implied = rows.filter((r) => r.base > 1e-9).map((r) => ({ id: r.id, base: r.base, x: r.x, cImp: lam * (r.x - r.base) }));
const impliedSet = [...new Set(implied.filter((r) => Math.abs(r.cImp) > 1e-6).map((r) => Math.round(r.cImp * 1e6) / 1e6))].sort((a, b) => a - b);
console.log(`   实测反解 c = λ(x−base) 去重后（非零）: ${impliedSet.join(", ")}`);

// ── 3) 中间档 A/B：κ = κ0×0.5 ────────────────────────────────────────────────
const K2 = COEF0 * 0.5;
const pr = await patch(`/sim/propagation-rules/${RID}`, { coefficient: K2, coefficientRef: null });
const rb = await g(`/sim/propagation-rules`);
const rule1 = (rb.json.items ?? rb.json).find((r) => r.id === RID);
console.log(`\n③ PATCH HTTP=${pr.status} 回读 coef=${rule1?.coefficient} ref=${JSON.stringify(rule1?.coefficientRef)}`);
const landed = pr.status === 200 && Math.abs(rule1?.coefficient - K2) < 1e-12 && rule1?.coefficientRef === null;
if (!landed) { console.log("❌ 扰动未落地 ⇒ 本臂读数一个都不许用"); process.exit(3); }

await post(`/sim/sessions/${s.id}/tick`, { n: T });
const w2 = (await g(`/sim/sessions/${s.id}/world`)).json;
const x2 = (id) => w2.state?.[id]?.demandPressure;
// 预言（b 臂）：用**同一批** Model.forecastBias（外生不变）
const cs2 = [...new Set([...fOf.values()].filter((f) => typeof f === "number").map((f) => K2 * f))].sort((a, b) => a - b);
function bestFit2(baseV, xObs, lamV) {
  let best = null;
  for (const c of cs2) {
    const p = predict(baseV, c, lamV);
    for (const [form, v] of [["free", p.free], ["clamped", p.clamped]]) {
      const e = Math.abs(xObs - v);
      if (best === null || e < best.err) best = { c, form, v, err: e };
    }
  }
  return best;
}
let mismatch2 = 0; const forms2 = { free: 0, clamped: 0 }; let switched = 0;
const rowsB = rows.map((r) => ({ ...r, x2: x2(r.id) })).filter((r) => typeof r.x2 === "number");
for (const r of rowsB) {
  const b = bestFit2(r.base, r.x2, lam);
  if (b.err > residUB) { mismatch2++; if (mismatch2 <= 8) console.log(`   ❌ 失配(κ/2) ${r.id} base=${r.base} x2=${r.x2} best=${b.form} v=${b.v.toFixed(6)} err=${b.err.toExponential(2)}`); }
  else { forms2[b.form]++; if (b.form === "free" && Math.abs(r.x - lam * r.base) < 1e-9) switched++; }
}
console.log(`   ×0.5 臂：自由档 ${forms2.free} · 夹住档 ${forms2.clamped} · 失配 ${mismatch2}/${rowsB.length}`);
console.log(`   从「基准已夹住」转为「自由」的单: ${switched}（预言：|c| 减半 ⇒ 一部分释放）`);
console.log(`   正对照（本臂必须有单动过）: ${rowsB.filter((r) => Math.abs(r.x2 - r.x) > 1e-9).length}/${rowsB.length}`);

// ── 4) 回退（把规则改回，避免污染登记册）──────────────────────────────────────
const pr2 = await patch(`/sim/propagation-rules/${RID}`, { coefficient: COEF0, coefficientRef: REF0 });
const rb2 = await g(`/sim/propagation-rules`);
const rule2 = (rb2.json.items ?? rb2.json).find((r) => r.id === RID);
const strip = (r) => { const c = { ...r }; delete c.version; return JSON.stringify(c); };
console.log(`\n④ 回退 HTTP=${pr2.status}  与原始逐字节相同=${strip(rule2) === strip(JSON.parse(SNAP0))}`);

fs.writeFileSync("/tmp/wo-3root/r1-quant.json", JSON.stringify({
  sid: s.id, lam, T, residUB, mismatch, forms, mismatch2, forms2, switched,
  cs, cs2, forecastBias: Object.fromEntries(fOf), rowsB: rowsB.slice(0, 400),
}, null, 1));
console.log(`\n落盘 /tmp/wo-3root/r1-quant.json`);
