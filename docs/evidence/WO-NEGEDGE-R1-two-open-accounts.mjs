/**
 * 评审员 #1 · 独立复核 ③——上游登记的两条**未解释账**，本脚本判它们是否被同一机制解释：
 *  (甲) 阳对照里 `Base.loadIndex`（入边全正）13 个对象中 8 个**相对基值下穿** —— 有没有同族吸收？
 *  (乙) 「关边臂零变化」是冻住还是没贡献（上游称决定性实验，判据在早拍会话 tick=2）。
 * 做法：
 *  (甲) 打印每个 Base 的 loadIndex（基值 / t30 读数 / 比值）+ 6 个 Model 的 demandLoad（基值/读数），
 *       并用**同一套离散拟合**判：读数是否 = base + c/λ 或 λ·base，c = 0.222×demandLoad(某型号)。
 *       ⚠ 关键预测：**λ·base < base**（λ<1）⇒ 任何被**夹住**的格都必然「下穿基值」，
 *         与入流正负无关 —— 若成立，(甲) 不需要第二条机制。
 *  (乙) 新会话 tick=2（早拍）→ counterfactual 关目标边 → 与起点逐字节比；
 *       对照：同一会话不关边的 next 与起点比。
 */
const B = "http://127.0.0.1:4019/a/v1";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const g = async (p, o = {}) => {
  const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { _raw: t.slice(0, 120) }; }
  return { status: r.status, json: j };
};
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const K = -0.222, LAM = 0.37;

// ══ 甲 ═════════════════════════════════════════════════════════════════════
const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
await post(`/sim/sessions/${s.id}/tick`, { n: 30 });
const w = (await g(`/sim/sessions/${s.id}/world`)).json;
const vc = (await g("/sim/view-config")).json;
const ids = (tk) => (vc.nodeObjectIds?.[tk] ?? []).slice().sort();
const models = ids("Model"), bases = ids("Base");
console.log(`会话 ${s.id} tick=${w.tick}`);
const dl = models.map((m) => ({ m, d0: det.baseSnapshot?.[m]?.demandLoad, d30: w.state?.[m]?.demandLoad }));
console.log("Model.demandLoad（基值 → t30）: " + dl.map((r) => `${r.m.replace("obj_model_", "")}:${r.d0}→${r.d30}`).join(" "));
const cs = dl.filter((r) => typeof r.d30 === "number").map((r) => 0.222 * r.d30);
console.log("候选 c = 0.222×demandLoad(t30): " + [...new Set(cs.map((c) => c.toFixed(4)))].join(", "));
let up = 0, down = 0, eq = 0;
const rows = bases.map((b) => ({ b, x0: det.baseSnapshot?.[b]?.loadIndex, x1: w.state?.[b]?.loadIndex })).filter((r) => typeof r.x0 === "number");
console.log("\nBase.loadIndex 逐对象（基值 / t30 / 比值 / 拟合）:");
for (const r of rows) {
  const ratio = r.x1 / r.x0;
  let best = null;
  for (const c of cs) for (const [form, v] of [["free", r.x0 + c / LAM], ["clamped", LAM * r.x0]]) {
    const e = Math.abs(r.x1 - v); if (best === null || e < best.e) best = { form, c, e };
  }
  if (r.x1 > r.x0 + 0.01) up++; else if (r.x1 < r.x0 - 0.01) down++; else eq++;
  console.log(`  ${r.b.padEnd(24)} ${r.x0.toFixed(4).padStart(10)} ${r.x1.toFixed(4).padStart(12)} r=${ratio.toFixed(4)}  best=${best.form} c=${best.c.toFixed(4)} err=${best.e.toExponential(2)}`);
}
console.log(`  上穿 ${up} · 下穿 ${down} · 持平 ${eq}   （上游记「8/13 下穿、5/13 上穿」）`);
console.log(`  ⚠ 判别：被夹住的格读数 = λ·base = ${LAM}·base **恒 < base** ⇒ 下穿由「夹住」解释，不需要第二条机制`);

// ══ 乙 ═════════════════════════════════════════════════════════════════════
const s2 = (await post("/sim/sessions", {})).json;
await post(`/sim/sessions/${s2.id}/tick`, { n: 2 });
const w2 = (await g(`/sim/sessions/${s2.id}/world`)).json;
const start = w2.state;
const cf = await post(`/sim/sessions/${s2.id}/counterfactual`, { n: 5, disabledRuleKeys: ["demo_forecast_bias_to_order_demand"] });
const base = await post(`/sim/sessions/${s2.id}/counterfactual`, { n: 5, disabledRuleKeys: [] });
const dif = (a, b) => { let n = 0; for (const id of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) for (const v of new Set([...Object.keys(a?.[id] ?? {}), ...Object.keys(b?.[id] ?? {})])) if (a?.[id]?.[v] !== b?.[id]?.[v]) n++; return n; };
const orderIds = ids("Order");
const dpDiff = (a, b) => orderIds.filter((i) => a?.[i]?.demandPressure !== b?.[i]?.demandPressure).length;
console.log(`\n乙) 早拍会话 ${s2.id} tick=${w2.tick}`);
console.log(`   关边臂 HTTP=${cf.status}  == 起点(tick2) 的单: ${orderIds.length - dpDiff(cf.json?.counterfactualState, start)}/${orderIds.length}   全图不同格=${dif(cf.json?.counterfactualState, start)}`);
console.log(`   不关边臂 HTTP=${base.status} == 起点(tick2) 的单: ${orderIds.length - dpDiff(base.json?.counterfactualState, start)}/${orderIds.length}   全图不同格=${dif(base.json?.counterfactualState, start)}`);
console.log(`   两臂 demandPressure 不同单数 = ${dpDiff(cf.json?.counterfactualState, base.json?.counterfactualState)}`);
console.log(`   判读：关边 ⇒ 该格入度 0 ⇒ isExogenous ⇒ 衰减豁免 + C2 跳过 ⇒ 冻在起点（≠「没贡献」）`);
